import { createResource, createSignal, For, Show } from "solid-js";
import type { Composition } from "../core/types";
import { packBundle } from "../persist/bundle";
import type { AssetStore } from "../persist/assets";
import { listProjects, type ProjectInfo } from "../persist/projects";
import type { ProjectStore } from "../persist/store";

export interface ProjectsDialogProps {
  store: ProjectStore;
  assets: AssetStore;
  currentId: string;
  comp: () => Composition;
  onRename: (name: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onClose: () => void;
  /** Make sure the open project is on disk before the list is read. */
  flush: () => Promise<void>;
}

const when = (ms: number) => {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Project list: open, new, duplicate, delete, rename, and back up to / restore from a single file. */
export function ProjectsDialog(p: ProjectsDialogProps) {
  let fileInput!: HTMLInputElement;
  const [list, { refetch }] = createResource(async () => {
    await p.flush();
    return listProjects(p.store);
  });
  const [confirm, setConfirm] = createSignal<string | null>(null);
  const [note, setNote] = createSignal<string | null>(null);
  const [backup, setBackup] = createSignal<{ url: string; file: File; name: string } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const prepareBackup = () =>
    run(async () => {
      await p.flush();
      const { blob, missing } = await packBundle(p.comp(), p.assets);
      const name = `${(p.comp().name ?? "project").replace(/[^\w.-]+/g, "-")}.rippleflow`;
      const old = backup();
      if (old) URL.revokeObjectURL(old.url);
      setBackup({ url: URL.createObjectURL(blob), file: new File([blob], name, { type: "application/octet-stream" }), name });
      if (missing.length) setNote(`${missing.length} media file${missing.length === 1 ? " was" : "s were"} not found on this device, so the backup lacks ${missing.length === 1 ? "it" : "them"}.`);
    });

  const share = async () => {
    const b = backup();
    if (!b) return;
    try {
      if (navigator.canShare?.({ files: [b.file] })) await navigator.share({ files: [b.file], title: b.name });
      else setNote("Sharing files is not supported here. Use Download.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setNote(`Could not open the share sheet (${e instanceof Error ? e.message : String(e)}). Use Download.`);
    }
  };

  const close = () => {
    const b = backup();
    if (b) URL.revokeObjectURL(b.url);
    p.onClose();
  };

  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label="Projects">
      <div class="sheet">
        <h2>Projects</h2>
        <label class="field">
          This project's name
          <input
            type="text"
            aria-label="Project name"
            maxLength="80"
            value={p.comp().name ?? ""}
            onChange={(e) => {
              try {
                p.onRename(e.currentTarget.value);
                void p.flush().then(() => refetch());
              } catch {
                e.currentTarget.value = p.comp().name ?? "";
              }
            }}
          />
        </label>
        <div class="row left">
          <button class="primary" disabled={busy()} onClick={() => p.onNew()}>New project</button>
          <button disabled={busy()} onClick={() => fileInput.click()}>Open backup file…</button>
          <input
            ref={fileInput}
            type="file"
            accept=".rippleflow,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (f) void run(() => p.onImport(f));
            }}
          />
        </div>
        <ul class="plist">
          <Show when={list()} fallback={<li class="muted">Loading…</li>}>
            <For each={list()}>
              {(it: ProjectInfo) => (
                <li classList={{ current: it.id === p.currentId }}>
                  <button class="pick" disabled={busy() || it.broken} onClick={() => (it.id === p.currentId ? close() : p.onOpen(it.id))}>
                    <strong>{it.name}</strong>
                    <span class="muted">
                      {it.broken ? "Could not be read" : `${it.width}×${it.height} · ${it.layers} layer${it.layers === 1 ? "" : "s"} · ${when(it.modified)}`}
                      {it.id === p.currentId ? " · open now" : ""}
                    </span>
                  </button>
                  <Show when={!it.broken}>
                    <button disabled={busy()} onClick={() => void run(() => p.onDuplicate(it.id))}>Duplicate</button>
                  </Show>
                  <button
                    class={confirm() === it.id ? "danger" : ""}
                    disabled={busy()}
                    onClick={() => {
                      if (confirm() !== it.id) return setConfirm(it.id);
                      setConfirm(null);
                      void run(() => p.onDelete(it.id));
                    }}
                  >
                    {confirm() === it.id ? "Confirm delete" : "Delete"}
                  </button>
                </li>
              )}
            </For>
          </Show>
        </ul>
        <h2>Back up this project</h2>
        <p class="muted">One file with the project and its pictures and clips. Keep a copy outside the browser: iOS can clear website storage.</p>
        <div class="row left">
          <Show when={!backup()} fallback={
            <>
              <button class="primary" onClick={() => void share()}>Save / Share</button>
              <a class="btn" href={backup()!.url} download={backup()!.name}>Download</a>
            </>
          }>
            <button disabled={busy()} onClick={() => void prepareBackup()}>Prepare backup file</button>
          </Show>
        </div>
        <Show when={note()}>
          <p class="warn">{note()}</p>
        </Show>
        <div class="row">
          <button onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
