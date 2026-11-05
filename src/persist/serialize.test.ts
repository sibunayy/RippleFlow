import { describe, expect, it } from "vitest";
import type { Composition, Layer, Track } from "../core/types";
import { deserialize, FORMAT_VERSION, FormatError, serialize } from "./serialize";

const empty: Track = { keys: [] };
const layer = (id: string, over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  kind: "shape",
  shape: { path: "M0 0 H10 V10 Z", fill: [1, 0, 0, 1], stroke: { color: [0, 0, 0, 1], width: 2, join: "round", cap: "square" } },
  transform: {
    anchorX: empty, anchorY: empty, scaleX: empty, scaleY: empty, rotation: empty, opacity: empty,
    x: { keys: [{ id: "k1", t: 0, value: 5 }, { id: "k2", t: 2, value: 50, ease: [0.42, 0, 0.58, 1] }] },
    y: empty,
  },
  ...over,
});
const comp = (...layers: Layer[]): Composition => ({ width: 1920, height: 1080, fps: 30, duration: 6, layers });
const bad = (mutate: (o: any) => void, msg: RegExp) => {
  const o = JSON.parse(serialize(comp(layer("a"), layer("b", { parent: "a" }))));
  mutate(o);
  expect(() => deserialize(JSON.stringify(o))).toThrow(FormatError);
  expect(() => deserialize(JSON.stringify(o))).toThrow(msg);
};

describe("round trip", () => {
  it("restores an identical composition", () => {
    const c = comp(layer("a", { inPoint: 1, outPoint: 4 }), layer("b", { parent: "a" }));
    expect(deserialize(serialize(c))).toEqual(c);
  });
  it("keeps the version in the file", () => {
    expect(JSON.parse(serialize(comp())).version).toBe(FORMAT_VERSION);
  });
  it("sorts unsorted keys", () => {
    const o = JSON.parse(serialize(comp(layer("a"))));
    o.composition.layers[0].transform.x.keys.reverse();
    expect(deserialize(JSON.stringify(o)).layers[0]!.transform.x.keys.map((k) => k.t)).toEqual([0, 2]);
  });
  it("fills in missing tracks as empty", () => {
    const o = JSON.parse(serialize(comp(layer("a"))));
    delete o.composition.layers[0].transform.rotation;
    expect(deserialize(JSON.stringify(o)).layers[0]!.transform.rotation.keys).toEqual([]);
  });
});

describe("rejects bad input", () => {
  it("garbage and foreign files", () => {
    expect(() => deserialize("nope")).toThrow(/valid JSON/);
    expect(() => deserialize("{}")).toThrow(/not a RippleFlow/);
    expect(() => deserialize("[]")).toThrow(FormatError);
  });
  it("unsupported version", () => bad((o) => (o.version = 99), /version 99/));
  it("bad dimensions", () => {
    bad((o) => (o.composition.width = 0), /width/);
    bad((o) => (o.composition.fps = "30"), /fps/);
  });
  it("duplicate ids", () => {
    bad((o) => (o.composition.layers[1].id = "a"), /duplicate layer id/);
    bad((o) => o.composition.layers[0].transform.x.keys[1].id = "k1", /duplicate key id/);
  });
  it("dangling and cyclic parents", () => {
    bad((o) => (o.composition.layers[1].parent = "zzz"), /missing parent/);
    bad((o) => (o.composition.layers[0].parent = "b"), /cycle/);
  });
  it("NaN-ish and negative values", () => {
    bad((o) => (o.composition.layers[0].transform.x.keys[0].value = null), /finite/);
    bad((o) => (o.composition.layers[0].transform.x.keys[0].t = -1), /negative/);
  });
  it("bad easing and stroke", () => {
    bad((o) => (o.composition.layers[0].transform.x.keys[1].ease = [2, 0, 0.5, 1]), /x handles/);
    bad((o) => (o.composition.layers[0].shape.stroke.width = 0), /positive/);
    bad((o) => (o.composition.layers[0].shape.stroke.join = "pointy"), /join/);
  });
  it("unknown layer kind", () => bad((o) => (o.composition.layers[0].kind = "text"), /kind/));
});

describe("image layers", () => {
  const imgLayer = (over: Record<string, unknown> = {}) =>
    ({ id: "i", name: "pic", kind: "image", image: { asset: "0123456789abcdef0123456789abcdef", width: 640, height: 480 }, transform: layer("x").transform, ...over }) as unknown as Layer;
  it("round trips", () => {
    const c = comp(imgLayer());
    expect(deserialize(serialize(c))).toEqual(c);
  });
  it("rejects an image layer with no image, a bad asset id, or a bad size", () => {
    for (const bad of [{ image: undefined }, { image: { asset: "../../etc/passwd", width: 1, height: 1 } }, { image: { asset: "0123456789abcdef", width: 0, height: 1 } }]) {
      expect(() => deserialize(serialize(comp(imgLayer(bad))))).toThrow(FormatError);
    }
  });
});

describe("video layers", () => {
  const vid = { asset: "0123456789abcdef0123456789abcdef", codedWidth: 1920, codedHeight: 1080, rotation: 90, duration: 4.29, start: 1.5 };
  const vLayer = (over: Record<string, unknown> = {}) => ({ id: "v", name: "clip", kind: "video", video: vid, transform: layer("x").transform, ...over }) as unknown as Layer;
  it("round trips", () => {
    const c = comp(vLayer());
    expect(deserialize(serialize(c))).toEqual(c);
  });
  it("rejects missing content, bad rotation, bad sizes and bad asset ids", () => {
    for (const bad of [{ video: undefined }, { video: { ...vid, rotation: 45 } }, { video: { ...vid, codedWidth: 0 } }, { video: { ...vid, duration: -1 } }, { video: { ...vid, asset: "x/../y" } }, { video: { ...vid, start: "0" } }]) {
      expect(() => deserialize(serialize(comp(vLayer(bad))))).toThrow(FormatError);
    }
  });
});
