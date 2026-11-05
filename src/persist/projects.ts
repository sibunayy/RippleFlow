import type { Composition } from "../core/types";
import { deserialize, serialize } from "./serialize";
import type { ProjectStore } from "./store";

/** What the project list shows. */
export interface ProjectInfo {
  readonly id: string;
  readonly name: string;
  readonly modified: number;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly layers: number;
  /** True when the file could not be read (it can still be deleted). */
  readonly broken?: boolean;
}

/** Old single-slot id used before there was a project list. It appears in the list like any other project. */
export const LEGACY_ID = "autosave";

export const newProjectId = (): string => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Names like "Untitled 3": the first number not already used. */
export function untitledName(existing: readonly string[]): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) if (!used.has(`Untitled ${n}`)) return `Untitled ${n}`;
}

export const blankProject = (name: string): Composition => ({ name, width: 1920, height: 1080, fps: 30, duration: 6, layers: [] });

/** Newest first. Damaged files and backups of damaged files are listed, but flagged. */
export async function listProjects(store: ProjectStore): Promise<ProjectInfo[]> {
  const out: ProjectInfo[] = [];
  for (const { id, modified } of await store.list()) {
    if (id.endsWith(".corrupt")) continue;
    try {
      const c = deserialize((await store.load(id)) ?? "");
      out.push({ id, name: c.name ?? (id === LEGACY_ID ? "Earlier work" : "Untitled"), modified, width: c.width, height: c.height, duration: c.duration, layers: c.layers.length });
    } catch {
      out.push({ id, name: "Unreadable project", modified, width: 0, height: 0, duration: 0, layers: 0, broken: true });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** Copy a project under a new id and name. Media is shared (assets are stored by content hash). */
export async function duplicateProject(store: ProjectStore, id: string, name: string): Promise<string> {
  const c = deserialize((await store.load(id)) ?? "");
  const copy = newProjectId();
  await store.save(copy, serialize({ ...c, name }));
  return copy;
}

const CURRENT_KEY = "rf.current";
export function rememberCurrent(id: string): void {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* private mode: just open the newest project next time */
  }
}
export function recallCurrent(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
