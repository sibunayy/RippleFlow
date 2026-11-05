import type { Composition } from "../core/types";
import { deserialize, serialize } from "./serialize";
import type { AssetStore } from "./assets";

/**
 * A single file holding a project and its media, for backup and moving between
 * devices (iOS may evict browser storage, so this is the real safety net).
 *
 * Layout: "RIPFLOW1" | u32 header length | header JSON | asset bytes back to back.
 * The header lists each asset's id and byte length. Blobs are sliced, not
 * loaded, so a large clip does not have to fit in memory twice.
 */
const MAGIC = "RIPFLOW1";

interface Header {
  readonly project: string;
  readonly assets: readonly { id: string; size: number }[];
}

/** Content hashes of every picture and clip the composition uses. */
export function assetsOf(comp: Composition): string[] {
  const ids = new Set<string>();
  for (const l of comp.layers) {
    if (l.image) ids.add(l.image.asset);
    if (l.video) ids.add(l.video.asset);
  }
  return [...ids];
}

export interface PackResult {
  readonly blob: Blob;
  /** Assets the project refers to that were not in the store (the file will open with grey boxes there). */
  readonly missing: readonly string[];
}

export async function packBundle(comp: Composition, assets: AssetStore): Promise<PackResult> {
  const found: { id: string; blob: Blob }[] = [];
  const missing: string[] = [];
  for (const id of assetsOf(comp)) {
    const b = await assets.get(id);
    if (b) found.push({ id, blob: b });
    else missing.push(id);
  }
  const header: Header = { project: serialize(comp), assets: found.map((a) => ({ id: a.id, size: a.blob.size })) };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length, false);
  return { blob: new Blob([MAGIC, len, head, ...found.map((a) => a.blob)], { type: "application/octet-stream" }), missing };
}

export class BundleError extends Error {}

export interface Unpacked {
  readonly comp: Composition;
  readonly assets: readonly { id: string; blob: Blob }[];
}

export async function unpackBundle(file: Blob): Promise<Unpacked> {
  const bad = (m: string): never => {
    throw new BundleError(`Not a usable RippleFlow file: ${m}`);
  };
  if (file.size < MAGIC.length + 4) bad("too small");
  if ((await file.slice(0, MAGIC.length).text()) !== MAGIC) bad("wrong header");
  const headLen = new DataView(await file.slice(MAGIC.length, MAGIC.length + 4).arrayBuffer()).getUint32(0, false);
  const start = MAGIC.length + 4;
  if (headLen > 64 * 1024 * 1024 || start + headLen > file.size) bad("damaged header");
  let header: Header;
  try {
    header = JSON.parse(await file.slice(start, start + headLen).text()) as Header;
  } catch {
    return bad("damaged header");
  }
  if (typeof header.project !== "string" || !Array.isArray(header.assets)) bad("damaged header");
  const comp = deserialize(header.project);
  const assets: { id: string; blob: Blob }[] = [];
  let at = start + headLen;
  for (const a of header.assets) {
    if (typeof a.id !== "string" || !/^[0-9a-f]{16,64}$/.test(a.id) || !Number.isInteger(a.size) || a.size < 0) bad("bad asset entry");
    if (at + a.size > file.size) bad("file is cut short");
    assets.push({ id: a.id, blob: file.slice(at, at + a.size) });
    at += a.size;
  }
  return { comp, assets };
}
