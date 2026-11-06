import type { JSX } from "solid-js";

/** Stroke icons (factories: a Solid JSX node can only live in one place in the DOM) from the RippleFlow design (24px grid, 1.8 stroke, round caps). Decorative: the button carries the name. */
const PATHS = {
  select: () => <path d="M6 3.5l12.5 8.3-5.9 1.5-2.4 5.9z" />,
  shapes: () => (
    <>
      <rect x="3.5" y="11" width="9" height="9" rx="1.8" />
      <circle cx="15.5" cy="8.5" r="5" />
    </>
  ),
  pen: () => (
    <>
      <path d="M4 20l1-4.4L16.3 4.3a1.9 1.9 0 012.7 0l.7.7a1.9 1.9 0 010 2.7L8.4 19z" />
      <path d="M14.3 6.3l3.4 3.4" />
    </>
  ),
  text: () => <path d="M5.5 6.5v-2h13v2M12 4.5v15M9 19.5h6" />,
  media: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  null: () => (
    <>
      <path d="M12 3.5v17M3.5 12h17" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  chevron: () => <path d="M7 10l5 5 5-5" />,
  undo: () => (
    <>
      <path d="M9 6L4.5 10.5 9 15" />
      <path d="M5 10.5h8.5a5.5 5.5 0 010 11H10" />
    </>
  ),
  duplicate: () => (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5" />
    </>
  ),
  trash: () => <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />,
  points: () => (
    <>
      <circle cx="6" cy="17" r="2.2" />
      <circle cx="18" cy="7" r="2.2" />
      <path d="M8 16c5.5 0 3.5-8 8-8.6" />
    </>
  ),
  pin: () => (
    <>
      <circle cx="12" cy="9" r="4" />
      <path d="M12 13v7.5" />
    </>
  ),
  panel: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
    </>
  ),
  sheet: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 14h17" />
    </>
  ),
  minus: () => <path d="M6 12h12" />,
  plus: () => <path d="M6 12h12M12 6v12" />,
  more: () => (
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18" cy="12" r="1.7" />
    </g>
  ),
  eye: () => (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: () => (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <path d="M4 20L20 4" />
    </>
  ),
  grip: () => (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="7" r="1.5" />
      <circle cx="15" cy="7" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="17" r="1.5" />
      <circle cx="15" cy="17" r="1.5" />
    </g>
  ),
  play: () => <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: () => <path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor" stroke="none" />,
  record: () => <circle cx="12" cy="12" r="5.5" />,
  diamond: () => <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />,
  close: () => <path d="M6 6l12 12M18 6L6 18" />,
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(p: { name: IconName; size?: number; fill?: string; stroke?: number; style?: JSX.CSSProperties; class?: string }) {
  const s = p.size ?? 22;
  return (
    <svg
      class={p.class}
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={p.fill ?? "none"}
      stroke="currentColor"
      stroke-width={p.stroke ?? 1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ flex: "none", ...p.style }}>
      {PATHS[p.name]()}
    </svg>
  );
}

/** The RippleFlow mark: a dot and two rings. */
export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="14" cy="14" r="3.4" fill="var(--mint)" />
      <circle cx="14" cy="14" r="8" stroke="var(--mint)" stroke-width="2" />
      <circle cx="14" cy="14" r="12.4" stroke="var(--mint)" stroke-width="1.6" opacity=".45" />
    </svg>
  );
}
