import type { Composition } from "./types";

/** A pure edit: returns a new composition, or throws and changes nothing. */
export interface Command {
  readonly label: string;
  apply(comp: Composition): Composition;
}

/**
 * Undo/redo over immutable compositions. Because a composition is never
 * mutated, undo is just restoring an earlier reference; structural sharing
 * keeps the snapshots cheap.
 */
export class History {
  private past: Composition[] = [];
  private future: Composition[] = [];
  private present: Composition;
  private labels: string[] = [];

  constructor(
    initial: Composition,
    private readonly limit = 200,
  ) {
    this.present = initial;
  }

  get current(): Composition {
    return this.present;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** Label of the edit that undo would revert, if any. */
  get undoLabel(): string | undefined {
    return this.labels[this.labels.length - 1];
  }

  /** Apply a command. If it throws, the history is unchanged. Clears the redo stack. */
  execute(cmd: Command): Composition {
    const next = cmd.apply(this.present);
    if (next === this.present) return next; // no-op edits do not pollute the undo stack
    this.past.push(this.present);
    this.labels.push(cmd.label);
    if (this.past.length > this.limit) {
      this.past.shift();
      this.labels.shift();
    }
    this.future = [];
    this.present = next;
    return next;
  }

  undo(): Composition {
    const prev = this.past.pop();
    if (prev) {
      this.labels.pop();
      this.future.push(this.present);
      this.present = prev;
    }
    return this.present;
  }

  redo(): Composition {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.present);
      this.labels.push("redo");
      this.present = next;
    }
    return this.present;
  }
}
