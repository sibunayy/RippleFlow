import { describe, expect, it } from "vitest";
import type { Composition } from "../core/types";
import { renameComposition } from "../core/commands";
import { assetsOf, BundleError, packBundle, unpackBundle } from "./bundle";
import { MemoryAssets } from "./assets";
import { blankProject, duplicateProject, listProjects, untitledName } from "./projects";
import { deserialize, serialize } from "./serialize";
import { MemoryStore } from "./store";

const A = "a".repeat(32);
const B = "b".repeat(32);
const withMedia: Composition = {
  ...blankProject("Media"),
  layers: [
    { id: "i", name: "i", kind: "image", transform: { anchorX: { keys: [] }, anchorY: { keys: [] }, x: { keys: [] }, y: { keys: [] }, scaleX: { keys: [] }, scaleY: { keys: [] }, rotation: { keys: [] }, opacity: { keys: [] } }, image: { asset: A, width: 4, height: 4 } },
    { id: "v", name: "v", kind: "video", transform: { anchorX: { keys: [] }, anchorY: { keys: [] }, x: { keys: [] }, y: { keys: [] }, scaleX: { keys: [] }, scaleY: { keys: [] }, rotation: { keys: [] }, opacity: { keys: [] } }, video: { asset: B, codedWidth: 8, codedHeight: 8, rotation: 0, duration: 1, start: 0 } },
  ],
};

describe("project names", () => {
  it("picks the first unused Untitled number", () => expect(untitledName(["Untitled 1", "Untitled 3", "Logo"])).toBe("Untitled 2"));
  it("survives a save/load round trip", () => expect(deserialize(serialize(blankProject("Hi"))).name).toBe("Hi"));
  it("renames, trims, and refuses blank", () => {
    expect(renameComposition("  New  ").apply(blankProject("Old")).name).toBe("New");
    expect(() => renameComposition("  ").apply(blankProject("Old"))).toThrow();
  });
});

describe("project list", () => {
  it("lists newest first, flags damaged files, hides .corrupt copies", async () => {
    const s = new MemoryStore();
    await s.save("p-1", serialize(blankProject("First")));
    await s.save("p-2", serialize(blankProject("Second")));
    await s.save("p-3", "garbage");
    await s.save("autosave.corrupt", "garbage");
    const l = await listProjects(s);
    expect(l.map((p) => p.name)).toEqual(["Unreadable project", "Second", "First"]);
    expect(l[0]!.broken).toBe(true);
  });
  it("duplicates under a new id and name", async () => {
    const s = new MemoryStore();
    await s.save("p-1", serialize(blankProject("Logo")));
    const id = await duplicateProject(s, "p-1", "Logo copy");
    expect(id).not.toBe("p-1");
    expect(deserialize((await s.load(id))!).name).toBe("Logo copy");
    expect(deserialize((await s.load("p-1"))!).name).toBe("Logo");
  });
});

describe("bundle", () => {
  it("collects the assets a composition uses", () => expect(assetsOf(withMedia).sort()).toEqual([A, B]));
  it("round-trips a project and its media bytes", async () => {
    const assets = new MemoryAssets();
    await assets.put(A, new Blob([new Uint8Array([1, 2, 3])]));
    await assets.put(B, new Blob([new Uint8Array([9, 8, 7, 6, 5])]));
    const { blob, missing } = await packBundle(withMedia, assets);
    expect(missing).toEqual([]);
    const out = await unpackBundle(blob);
    expect(out.comp).toEqual(withMedia);
    expect([...new Uint8Array(await out.assets.find((a) => a.id === A)!.blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(await out.assets.find((a) => a.id === B)!.blob.arrayBuffer())]).toEqual([9, 8, 7, 6, 5]);
  });
  it("reports media missing from the store instead of failing", async () => {
    const { missing } = await packBundle(withMedia, new MemoryAssets());
    expect([...missing].sort()).toEqual([A, B]);
  });
  it("rejects other files and truncated bundles", async () => {
    await expect(unpackBundle(new Blob(["hello world, not a bundle"]))).rejects.toThrow(BundleError);
    const assets = new MemoryAssets();
    await assets.put(A, new Blob([new Uint8Array(100)]));
    await assets.put(B, new Blob([new Uint8Array(100)]));
    const { blob } = await packBundle(withMedia, assets);
    await expect(unpackBundle(blob.slice(0, blob.size - 10))).rejects.toThrow(/cut short/);
  });
});
