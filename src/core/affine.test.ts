import { describe, expect, it } from "vitest";
import { apply, IDENTITY, invert, maxScale, multiply, rotate, scale, translate } from "./affine";

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("affine", () => {
  it("translates and scales points", () => {
    close(apply(translate(3, 4), 1, 1), [4, 5]);
    close(apply(scale(2, 3), 1, 1), [2, 3]);
  });
  it("rotates clockwise in y-down space: +90 degrees sends +x to +y", () => {
    close(apply(rotate(Math.PI / 2), 1, 0), [0, 1]);
  });
  it("multiply applies the second transform first", () => {
    // scale by 2, then translate by (10, 0)
    close(apply(multiply(translate(10, 0), scale(2)), 1, 1), [12, 2]);
    // translate, then scale: different result
    close(apply(multiply(scale(2), translate(10, 0)), 1, 1), [22, 2]);
  });
  it("multiply is associative with the identity", () => {
    const m = multiply(translate(5, -2), rotate(0.7));
    close(multiply(m, IDENTITY), m);
    close(multiply(IDENTITY, m), m);
  });
  it("invert round-trips a point", () => {
    const m = multiply(translate(7, 3), multiply(rotate(0.4), scale(2, 0.5)));
    const inv = invert(m)!;
    const [x, y] = apply(m, 3, -4);
    close(apply(inv, x, y), [3, -4]);
  });
  it("invert returns null for a singular matrix", () => {
    expect(invert(scale(0, 1))).toBeNull();
  });
  it("maxScale is the largest stretch", () => {
    expect(maxScale(scale(3, 2))).toBeCloseTo(3);
    expect(maxScale(rotate(1.2))).toBeCloseTo(1);
    expect(maxScale(multiply(rotate(0.5), scale(1, 4)))).toBeCloseTo(4);
  });
});
