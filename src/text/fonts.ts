import interUrl from "./fonts/Inter-Bold.ttf?url";
import poppinsUrl from "./fonts/Poppins-Bold.woff?url";
import bebasUrl from "./fonts/BebasNeue-Regular.woff?url";
import playfairUrl from "./fonts/PlayfairDisplay-Bold.woff?url";
import pacificoUrl from "./fonts/Pacifico-Regular.woff?url";
import spaceMonoUrl from "./fonts/SpaceMono-Bold.woff?url";
import { DEFAULT_FONT, fontLoaded, setFontData } from "./glyphs";

export interface FontInfo {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

/** Bundled fonts (all SIL OFL; the non-default ones are Latin subsets, so other scripts draw nothing). */
export const FONTS: readonly FontInfo[] = [
  { id: DEFAULT_FONT, label: "Inter Bold", url: interUrl },
  { id: "poppins", label: "Poppins Bold", url: poppinsUrl },
  { id: "bebas", label: "Bebas Neue", url: bebasUrl },
  { id: "playfair", label: "Playfair Bold", url: playfairUrl },
  { id: "pacifico", label: "Pacifico", url: pacificoUrl },
  { id: "spacemono", label: "Space Mono Bold", url: spaceMonoUrl },
];

const pending = new Map<string, Promise<boolean>>();

/** Fetch and parse a bundled font once. Resolves false (never throws) if it cannot be loaded. */
export function ensureFont(id: string = DEFAULT_FONT): Promise<boolean> {
  if (fontLoaded(id)) return Promise.resolve(true);
  const info = FONTS.find((f) => f.id === id);
  if (!info) return Promise.resolve(false);
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(info.url);
        if (!res.ok) return false;
        setFontData(await res.arrayBuffer(), id);
        return true;
      } catch {
        return false;
      } finally {
        pending.delete(id);
      }
    })();
    pending.set(id, p);
  }
  return p;
}
