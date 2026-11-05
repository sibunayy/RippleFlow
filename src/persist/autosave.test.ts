import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Composition } from "../core/types";
import { Autosaver, loadProject } from "./autosave";
import { serialize } from "./serialize";
import { MemoryStore, type ProjectStore } from "./store";

const doc = (n: number): Composition => ({ width: 100, height: 100, fps: 30, duration: n, layers: [] });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Autosaver", () => {
  it("ignores edits until loading has finished, then saves normally", async () => {
    const store = new MemoryStore();
    await store.save("p", "existing");
    const a = new Autosaver({ store, id: "p", delayMs: 10 });
    a.touch(doc(1)); // initial empty document, before the stored project is read
    await a.flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(store.files.get("p")).toBe("existing");
    a.markSaved(doc(1));
    a.touch(doc(2));
    await vi.advanceTimersByTimeAsync(20);
    expect((await loadProject(store, "p") as any).doc.duration).toBe(2);
  });

  it("debounces bursts into one write of the latest document", async () => {
    const store = new MemoryStore();
    const save = vi.spyOn(store, "save");
    const a = new Autosaver({ store, id: "p", delayMs: 500 });
    a.markSaved(doc(0));
    a.touch(doc(1));
    a.touch(doc(2));
    a.touch(doc(3));
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await loadProject(store, "p") as any).doc.duration).toBe(3);
  });

  it("does not write a document that is already stored", async () => {
    const store = new MemoryStore();
    const save = vi.spyOn(store, "save");
    const d = doc(1);
    const a = new Autosaver({ store, id: "p" });
    a.markSaved(d);
    a.touch(d);
    await a.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("flush writes immediately", async () => {
    const store = new MemoryStore();
    const a = new Autosaver({ store, id: "p", delayMs: 10_000 });
    a.markSaved(doc(0));
    a.touch(doc(7));
    await a.flush();
    expect((await loadProject(store, "p") as any).doc.duration).toBe(7);
  });

  it("an edit during a save gets saved afterwards, never concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const files = new Map<string, string>();
    const store: ProjectStore = {
      load: async (id) => files.get(id) ?? null,
      remove: async () => {},
      list: async () => [],
      save: async (id, text) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 100));
        files.set(id, text);
        active--;
      },
    };
    const a = new Autosaver({ store, id: "p", delayMs: 10 });
    a.markSaved(doc(0));
    a.touch(doc(1));
    await vi.advanceTimersByTimeAsync(20); // first write in flight
    a.touch(doc(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(maxActive).toBe(1);
    expect((await loadProject(store as any, "p") as any).doc.duration).toBe(2);
  });

  it("reports errors and keeps the document dirty so a later flush retries", async () => {
    const store = new MemoryStore();
    const states: string[] = [];
    let fail = true;
    const orig = store.save.bind(store);
    store.save = async (id, t) => { if (fail) throw new Error("disk full"); return orig(id, t); };
    const a = new Autosaver({ store, id: "p", onState: (s) => states.push(s) });
    a.markSaved(doc(0));
    a.touch(doc(1));
    await a.flush();
    expect(states.at(-1)).toBe("error");
    fail = false;
    await a.flush();
    expect(states.at(-1)).toBe("saved");
  });
});

describe("loadProject", () => {
  it("distinguishes empty, ok and corrupt", async () => {
    const store = new MemoryStore();
    expect((await loadProject(store, "p")).kind).toBe("empty");
    await store.save("p", serialize(doc(2)));
    expect((await loadProject(store, "p")).kind).toBe("ok");
    await store.save("p", "{broken");
    const r = await loadProject(store, "p");
    expect(r.kind).toBe("corrupt");
    if (r.kind === "corrupt") expect(r.text).toBe("{broken");
  });
});
