import { ensureFont } from "./fonts";

/** Fetch and parse the default font. Resolves false (never throws) if it cannot be loaded, so the app still opens. */
export const loadBundledFont = (): Promise<boolean> => ensureFont();
