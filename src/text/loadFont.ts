import fontUrl from "./fonts/Inter-Bold.ttf?url";
import { setFontData } from "./glyphs";

/** Fetch and parse the bundled font. Resolves false (never throws) if it cannot be loaded, so the app still opens. */
export async function loadBundledFont(): Promise<boolean> {
  try {
    const res = await fetch(fontUrl);
    if (!res.ok) return false;
    setFontData(await res.arrayBuffer());
    return true;
  } catch {
    return false;
  }
}
