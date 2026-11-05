import type { BlendMode, Rgba } from "../core/types";
import type { ResolvedFx } from "../core/effects";

/**
 * Full-screen passes used to give a layer effects: copy, composite with a blend
 * mode, and one small fragment shader per effect. Every texture holds
 * premultiplied RGBA in the canvas format. Pixels are read with textureLoad
 * (no sampler), and anything outside the texture reads as transparent.
 */

const COMMON = /* wgsl */ `
struct FU { p0: vec4f, p1: vec4f, p2: vec4f, p3: vec4f, size: vec2f, time: f32, pad: f32 }
@group(0) @binding(0) var<uniform> u: FU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var aux: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f }

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  return o;
}

fn load(p: vec2i) -> vec4f {
  let d = vec2i(u.size);
  if (p.x < 0 || p.y < 0 || p.x >= d.x || p.y >= d.y) { return vec4f(0.0); }
  return textureLoad(src, p, 0);
}
fn unpremul(c: vec4f) -> vec3f { return select(vec3f(0.0), c.rgb / c.a, c.a > 0.00001); }
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn here(i: VOut) -> vec4f { return textureLoad(src, vec2i(i.pos.xy), 0); }
`;

const BODIES: Record<string, string> = {
  // p0 = (mode 0 add / 1 subtract / 2 intersect, opacity, inverted). src = coverage so far, aux = this mask. Writes alpha to every channel.
  maskop: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let m = textureLoad(src, vec2i(i.pos.xy), 0).a;
  var c = textureLoad(aux, vec2i(i.pos.xy), 0).a;
  if (u.p0.z > 0.5) { c = 1.0 - c; }
  c = c * u.p0.y;
  var a = m + c * (1.0 - m);
  if (u.p0.x > 0.5 && u.p0.x < 1.5) { a = m * (1.0 - c); }
  if (u.p0.x > 1.5) { a = m * c; }
  return vec4f(a);
}`,
  // layer (src) times a coverage texture (aux)
  mulalpha: `@fragment fn fs(i: VOut) -> @location(0) vec4f { return here(i) * textureLoad(aux, vec2i(i.pos.xy), 0).a; }`,
  // p0.x = 0 alpha, 1 alpha inverted, 2 luma, 3 luma inverted. aux = the matte layer drawn on its own.
  matte: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let t = textureLoad(aux, vec2i(i.pos.xy), 0);
  var m = t.a;
  if (u.p0.x > 1.5) { m = lum(unpremul(t)) * t.a; }
  if ((u.p0.x > 0.5 && u.p0.x < 1.5) || u.p0.x > 2.5) { m = 1.0 - m; }
  return here(i) * m;
}`,
  copy: `@fragment fn fs(i: VOut) -> @location(0) vec4f { return here(i); }`,
  composite: `@fragment fn fs(i: VOut) -> @location(0) vec4f { return here(i) * u.p0.x; }`,
  // p0 = (dir.xy, sigma, mode: 1 = keep only alpha), p1.xy = sampling offset in px
  blur: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let sigma = max(u.p0.z, 0.0001);
  let step = max(1.0, ceil(sigma * 3.0 / 24.0));
  let n = i32(min(24.0, ceil(sigma * 3.0 / step)));
  let base = vec2f(i.pos.xy) - u.p1.xy;
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var k = -n; k <= n; k++) {
    let o = f32(k) * step;
    let w = exp(-(o * o) / (2.0 * sigma * sigma));
    acc += w * load(vec2i(floor(base + u.p0.xy * o)));
    wsum += w;
  }
  var c = acc / wsum;
  if (u.p0.w > 0.5) { c = vec4f(0.0, 0.0, 0.0, c.a); }
  return c;
}`,
  // p0 = colour (straight rgba), p1.x = intensity. aux = blurred alpha.
  combine: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  let s = clamp(textureLoad(aux, vec2i(i.pos.xy), 0).a * u.p1.x, 0.0, 1.0) * u.p0.a;
  return c + vec4f(u.p0.rgb * s, s) * (1.0 - c.a);
}`,
  // p0 = (inBlack, inWhite, gamma), p1 = (outBlack, outWhite)
  levels: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  var x = clamp((unpremul(c) - vec3f(u.p0.x)) / max(u.p0.y - u.p0.x, 0.0001), vec3f(0.0), vec3f(1.0));
  x = pow(x, vec3f(1.0 / max(u.p0.z, 0.01)));
  x = mix(vec3f(u.p1.x), vec3f(u.p1.y), x);
  return vec4f(clamp(x, vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}`,
  // p0 = (brightness, contrast)
  bc: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  let k = u.p0.y;
  let f = select(1.0 + k, 1.0 / (1.0 - k * 0.999), k > 0.0);
  let x = (unpremul(c) - vec3f(0.5)) * f + vec3f(0.5 + u.p0.x);
  return vec4f(clamp(x, vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}`,
  exposure: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  return vec4f(clamp(unpremul(c) * exp2(u.p0.x), vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}`,
  // p0 = (hue degrees, saturation, lightness)
  hs: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  var x = unpremul(c);
  let a = u.p0.x * 3.14159265 / 180.0;
  let cs = cos(a);
  let sn = sin(a);
  let r0 = vec3f(0.299 + 0.701 * cs + 0.168 * sn, 0.587 - 0.587 * cs + 0.330 * sn, 0.114 - 0.114 * cs - 0.497 * sn);
  let r1 = vec3f(0.299 - 0.299 * cs - 0.328 * sn, 0.587 + 0.413 * cs + 0.035 * sn, 0.114 - 0.114 * cs + 0.292 * sn);
  let r2 = vec3f(0.299 - 0.300 * cs + 1.250 * sn, 0.587 - 0.588 * cs - 1.050 * sn, 0.114 + 0.886 * cs - 0.203 * sn);
  x = vec3f(dot(r0, x), dot(r1, x), dot(r2, x));
  let l = dot(x, vec3f(0.299, 0.587, 0.114));
  x = mix(vec3f(l), x, 1.0 + u.p0.y);
  x = select(mix(x, vec3f(0.0), -u.p0.z), mix(x, vec3f(1.0), u.p0.z), u.p0.z > 0.0);
  return vec4f(clamp(x, vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}`,
  // p0 = tint colour, p1.x = amount
  tint: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  let x = unpremul(c);
  let l = lum(x);
  let ramp = select(mix(u.p0.rgb, vec3f(1.0), (l - 0.5) * 2.0), mix(vec3f(0.0), u.p0.rgb, l * 2.0), l < 0.5);
  return vec4f(mix(x, ramp, u.p1.x) * c.a, c.a);
}`,
  invert: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  return vec4f(mix(unpremul(c), vec3f(1.0) - unpremul(c), u.p0.x) * c.a, c.a);
}`,
  post: `
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  let n = max(u.p0.x, 2.0);
  return vec4f(floor(unpremul(c) * n * 0.9999) / (n - 1.0) * c.a, c.a);
}`,
  // p0 = (amount, grain size px, mono, speed fps)
  noise: `
fn hash(p: vec2f) -> f32 {
  var q = fract(p * vec2f(0.1031, 0.1030));
  q += dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let c = here(i);
  let cell = floor(i.pos.xy / max(u.p0.y, 1.0));
  let seed = floor(u.time * u.p0.w) * vec2f(37.0, 17.0);
  let n0 = hash(cell + seed);
  let n = select(vec3f(hash(cell + seed + vec2f(11.0, 5.0)), hash(cell + seed + vec2f(23.0, 31.0)), hash(cell + seed + vec2f(47.0, 7.0))), vec3f(n0), u.p0.z > 0.5);
  let x = unpremul(c) + (n - vec3f(0.5)) * u.p0.x * 2.0;
  return vec4f(clamp(x, vec3f(0.0), vec3f(1.0)) * c.a, c.a);
}`,
};

const SLOT = 256;
const SLOTS = 512;
const SAMPLES = 4;

function blendState(mode: BlendMode): GPUBlendState {
  const alpha: GPUBlendComponent = { srcFactor: "one", dstFactor: "one-minus-src-alpha" };
  switch (mode) {
    case "multiply":
      return { color: { srcFactor: "dst", dstFactor: "one-minus-src-alpha" }, alpha };
    case "screen":
      return { color: { srcFactor: "one", dstFactor: "one-minus-src" }, alpha };
    case "add":
      return { color: { srcFactor: "one", dstFactor: "one" }, alpha };
    default:
      return { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha };
  }
}

type Vec4 = readonly [number, number, number, number];
const rgba = (c: Rgba | undefined): Vec4 => (c ? [c[0], c[1], c[2], c[3]] : [1, 1, 1, 1]);

export class FxEngine {
  private readonly bgl: GPUBindGroupLayout;
  private readonly layout: GPUPipelineLayout;
  private readonly modules = new Map<string, GPUShaderModule>();
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly ubuf: GPUBuffer;
  private slot = 0;
  private textures = new Map<string, GPUTexture>();
  private size: [number, number] = [0, 0];
  private pool: GPUTexture[] = [];
  private accum: GPUTexture[] = [];
  private layerTex: GPUTexture | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {
    const f = GPUShaderStage.FRAGMENT;
    this.bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: f, buffer: { type: "uniform" } },
        { binding: 1, visibility: f, texture: { sampleType: "unfilterable-float" } },
        { binding: 2, visibility: f, texture: { sampleType: "unfilterable-float" } },
      ],
    });
    this.layout = device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    this.ubuf = device.createBuffer({ size: SLOT * SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** Call at the start of every encode: uniform slots are reused per frame. */
  begin(w: number, h: number): void {
    this.slot = 0;
    if (this.size[0] !== w || this.size[1] !== h) {
      this.releaseTextures();
      this.size = [w, h];
    }
  }

  private make(): GPUTexture {
    return this.device.createTexture({ size: this.size, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  }
  private releaseTextures(): void {
    for (const t of [...this.pool, ...this.accum, ...this.textures.values(), ...(this.layerTex ? [this.layerTex] : [])]) t.destroy();
    this.textures.clear();
    this.pool = [];
    this.accum = [];
    this.layerTex = null;
  }

  /** The texture a layer is drawn into before its effects run. */
  get layerTarget(): GPUTexture {
    return (this.layerTex ??= this.make());
  }
  /** A scratch texture that lives until the size changes. Distinct names are distinct textures. */
  named(name: string): GPUTexture {
    let t = this.textures.get(name);
    if (!t) {
      t = this.make();
      this.textures.set(name, t);
    }
    return t;
  }

  /** Clear `tex` to a constant (used to seed mask coverage with 0 or 1). */
  fill(enc: GPUCommandEncoder, tex: GPUTexture, v: number): void {
    enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", clearValue: { r: v, g: v, b: v, a: v }, storeOp: "store" }] }).end();
  }

  maskOp(enc: GPUCommandEncoder, dst: GPUTexture, coverage: GPUTexture, mask: GPUTexture, mode: "add" | "subtract" | "intersect", opacity: number, inverted: boolean): void {
    this.fullscreen(enc, dst, "maskop", coverage, mask, [mode === "add" ? 0 : mode === "subtract" ? 1 : 2, opacity, inverted ? 1 : 0, 0]);
  }
  mulAlpha(enc: GPUCommandEncoder, dst: GPUTexture, layer: GPUTexture, coverage: GPUTexture): void {
    this.fullscreen(enc, dst, "mulalpha", layer, coverage);
  }
  applyMatte(enc: GPUCommandEncoder, dst: GPUTexture, layer: GPUTexture, matte: GPUTexture, mode: "alpha" | "alphaInverted" | "luma" | "lumaInverted"): void {
    this.fullscreen(enc, dst, "matte", layer, matte, [{ alpha: 0, alphaInverted: 1, luma: 2, lumaInverted: 3 }[mode], 0, 0, 0]);
  }

  /** Gaussian blur of a whole texture (radius in px). The result is a pooled texture, valid until the next effect pass. */
  blurred(enc: GPUCommandEncoder, src: GPUTexture, radius: number): GPUTexture {
    if (radius < 0.05) return src;
    const a = this.pick(src);
    this.fullscreen(enc, a, "blur", src, src, [1, 0, radius / 2, 0]);
    const b = this.pick(src, a);
    this.fullscreen(enc, b, "blur", a, a, [0, 1, radius / 2, 0]);
    return b;
  }

  /** Alternates between two textures, so a result never overwrites the one it was built on. */
  nextAccum(not: GPUTexture | null): GPUTexture {
    while (this.accum.length < 2) this.accum.push(this.make());
    return this.accum[0] === not ? this.accum[1]! : this.accum[0]!;
  }
  private pick(...not: GPUTexture[]): GPUTexture {
    while (this.pool.length < 4) this.pool.push(this.make());
    return this.pool.find((t) => !not.includes(t))!;
  }

  private pipeline(name: string, samples: number, blend?: BlendMode): GPURenderPipeline | null {
    const key = `${name}:${samples}:${blend ?? ""}`;
    let p = this.pipelines.get(key);
    if (!p) {
      const body = BODIES[name];
      if (!body) return null;
      let module = this.modules.get(name);
      if (!module) {
        module = this.device.createShaderModule({ code: COMMON + body });
        this.modules.set(name, module);
      }
      p = this.device.createRenderPipeline({
        layout: this.layout,
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: this.format, ...(blend ? { blend: blendState(blend) } : {}) }] },
        primitive: { topology: "triangle-list" },
        multisample: { count: samples },
      });
      this.pipelines.set(key, p);
    }
    return p;
  }

  private bind(src: GPUTexture, aux: GPUTexture, p0: Vec4 = [0, 0, 0, 0], p1: Vec4 = [0, 0, 0, 0], time = 0): GPUBindGroup | null {
    if (this.slot >= SLOTS) return null;
    const offset = this.slot++ * SLOT;
    this.device.queue.writeBuffer(this.ubuf, offset, new Float32Array([...p0, ...p1, 0, 0, 0, 0, 0, 0, 0, 0, this.size[0], this.size[1], time, 0]));
    return this.device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.ubuf, offset, size: 80 } },
        { binding: 1, resource: src.createView() },
        { binding: 2, resource: aux.createView() },
      ],
    });
  }

  private fullscreen(enc: GPUCommandEncoder, dst: GPUTexture, name: string, src: GPUTexture, aux: GPUTexture, p0?: Vec4, p1?: Vec4, time?: number): void {
    const pipe = this.pipeline(name, 1);
    const bg = this.bind(src, aux, p0, p1, time);
    if (!pipe || !bg) return;
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst.createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  /** Run an effect stack over `src`. Returns the texture holding the result (`src` itself when nothing applied). */
  applyEffects(enc: GPUCommandEncoder, src: GPUTexture, chain: readonly ResolvedFx[]): GPUTexture {
    let cur = src;
    const one = (name: string, p0?: Vec4, p1?: Vec4, t = 0) => {
      const out = this.pick(cur);
      this.fullscreen(enc, out, name, cur, cur, p0, p1, t);
      cur = out;
    };
    const blur = (radius: number, mode: number, offset: readonly [number, number], keepInput = false) => {
      const sigma = radius / 2;
      const a = this.pick(cur);
      this.fullscreen(enc, a, "blur", cur, cur, [1, 0, sigma, mode], [offset[0], offset[1], 0, 0]);
      const b = this.pick(cur, a);
      this.fullscreen(enc, b, "blur", a, a, [0, 1, sigma, 0], [0, 0, 0, 0]);
      return b;
    };
    for (const fx of chain) {
      const v = fx.v;
      switch (fx.type) {
        case "blur": {
          if ((v.radius ?? 0) < 0.05) break;
          const a = this.pick(cur);
          this.fullscreen(enc, a, "blur", cur, cur, [1, 0, v.radius! / 2, 0]);
          const b = this.pick(cur, a);
          this.fullscreen(enc, b, "blur", a, a, [0, 1, v.radius! / 2, 0]);
          cur = b;
          break;
        }
        case "dropShadow":
        case "glow": {
          const shadow = fx.type === "dropShadow";
          const ang = ((v.angle ?? 0) * Math.PI) / 180;
          const dist = shadow ? (v.distance ?? 0) : 0;
          const s = blur(v.blur ?? 0, 1, [Math.cos(ang) * dist, Math.sin(ang) * dist]);
          const out = this.pick(cur, s);
          const c = rgba(fx.color);
          this.fullscreen(enc, out, "combine", cur, s, c, [shadow ? (v.opacity ?? 1) : (v.intensity ?? 1), 0, 0, 0]);
          cur = out;
          break;
        }
        case "noise":
          one("noise", [v.amount ?? 0, v.size ?? 1, v.mono ?? 1, v.speed ?? 0], undefined, fx.t);
          break;
        case "levels":
          one("levels", [v.inBlack ?? 0, v.inWhite ?? 1, v.gamma ?? 1, 0], [v.outBlack ?? 0, v.outWhite ?? 1, 0, 0]);
          break;
        case "brightnessContrast":
          one("bc", [v.brightness ?? 0, v.contrast ?? 0, 0, 0]);
          break;
        case "exposure":
          one("exposure", [v.stops ?? 0, 0, 0, 0]);
          break;
        case "hueSaturation":
          one("hs", [v.hue ?? 0, v.saturation ?? 0, v.lightness ?? 0, 0]);
          break;
        case "tint":
          one("tint", rgba(fx.color), [v.amount ?? 1, 0, 0, 0]);
          break;
        case "invert":
          one("invert", [v.amount ?? 1, 0, 0, 0]);
          break;
        case "posterize":
          one("post", [v.levels ?? 4, 0, 0, 0]);
          break;
      }
    }
    return cur;
  }

  /**
   * Write `base` (if any) and then `layer` (with opacity and blend mode) into `dst`.
   * With no base the target starts as `clear`.
   */
  composite(enc: GPUCommandEncoder, dst: GPUTexture, base: GPUTexture | null, layer: GPUTexture, opacity: number, blend: BlendMode, clear: GPUColor): void {
    const copy = base ? this.pipeline("copy", 1) : null;
    const comp = this.pipeline("composite", 1, blend);
    const bgBase = base ? this.bind(base, base) : null;
    const bgLayer = this.bind(layer, layer, [opacity, 0, 0, 0]);
    if (!comp || !bgLayer) return;
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst.createView(), loadOp: "clear", clearValue: base ? { r: 0, g: 0, b: 0, a: 0 } : clear, storeOp: "store" }] });
    if (copy && bgBase) {
      pass.setPipeline(copy);
      pass.setBindGroup(0, bgBase);
      pass.draw(3);
    }
    pass.setPipeline(comp);
    pass.setBindGroup(0, bgLayer);
    pass.draw(3);
    pass.end();
  }

  /** Inside an MSAA pass: paint `tex` over the whole target (used to continue after a composite). */
  copyInto(pass: GPURenderPassEncoder, tex: GPUTexture): void {
    const pipe = this.pipeline("copy", SAMPLES);
    const bg = this.bind(tex, tex);
    if (!pipe || !bg) return;
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.draw(3);
  }

  destroy(): void {
    this.releaseTextures();
    this.ubuf.destroy();
  }
}
