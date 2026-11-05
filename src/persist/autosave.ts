import type { Composition } from "../core/types";
import { deserialize, serialize } from "./serialize";
import type { ProjectStore } from "./store";

export type SaveState = "saved" | "dirty" | "saving" | "error";

export interface AutosaveOptions {
  readonly store: ProjectStore;
  readonly id: string;
  readonly delayMs?: number;
  readonly onState?: (s: SaveState, error?: unknown) => void;
}

/**
 * Debounced saver. `touch(doc)` after every committed edit. Saves never overlap
 * (an edit during a save queues exactly one more), and `flush()` writes the
 * newest document immediately, for when the page is being hidden.
 */
export class Autosaver {
  private latest: Composition | null = null;
  private saved: Composition | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  /** Until the stored project has been read, edits must not be written over it. */
  private locked = true;

  constructor(private readonly o: AutosaveOptions) {}

  /**
   * Loading finished: `doc` is what is on disk (or the starting document when
   * nothing usable was there). Saving is enabled from here on.
   */
  markSaved(doc: Composition): void {
    this.saved = doc;
    this.latest = doc;
    this.locked = false;
    this.o.onState?.("saved");
  }

  touch(doc: Composition): void {
    if (this.locked) return;
    this.latest = doc;
    if (doc === this.saved) return;
    this.o.onState?.("dirty");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.o.delayMs ?? 800);
  }

  async flush(): Promise<void> {
    if (this.locked) return;
    clearTimeout(this.timer);
    while (this.inFlight) await this.inFlight; // never two writes at once
    const doc = this.latest;
    if (!doc || doc === this.saved) return;
    this.o.onState?.("saving");
    const write = this.o.store.save(this.o.id, serialize(doc)).then(
      () => {
        this.saved = doc;
        // Edits that arrived while writing get their own save.
        if (this.latest !== doc) this.timer = setTimeout(() => void this.flush(), 0);
        else this.o.onState?.("saved");
      },
      (e) => this.o.onState?.("error", e),
    );
    this.inFlight = write;
    await write;
    this.inFlight = null;
  }
}

export type LoadResult = { kind: "empty" } | { kind: "ok"; doc: Composition } | { kind: "corrupt"; error: Error; text: string };

/** Read the project, never throwing: the caller decides what to do with a damaged file. */
export async function loadProject(store: ProjectStore, id: string): Promise<LoadResult> {
  const text = await store.load(id);
  if (text === null) return { kind: "empty" };
  try {
    return { kind: "ok", doc: deserialize(text) };
  } catch (e) {
    return { kind: "corrupt", error: e instanceof Error ? e : new Error(String(e)), text };
  }
}
