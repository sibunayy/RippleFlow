import { describe, expect, it } from "vitest";
import { avcLevel } from "./encodeMp4";

describe("avcLevel", () => {
  it("picks 3.1 for 720p30", () => expect(avcLevel(1280, 720, 30)).toBe(0x1f));
  it("picks 4.0 for 1080p30", () => expect(avcLevel(1920, 1080, 30)).toBe(0x28));
  it("picks 4.2 for 1080p60", () => expect(avcLevel(1920, 1080, 60)).toBe(0x2a));
  it("picks 4.0 for vertical 1080x1920 at 30", () => expect(avcLevel(1080, 1920, 30)).toBe(0x28));
  it("picks 5.1 for 4K30", () => expect(avcLevel(3840, 2160, 30)).toBe(0x33));
});
