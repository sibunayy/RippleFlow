import { IDENTITY, type Affine } from "../core/affine";
import type { Mesh } from "../geometry/mesh";
import type { BlendMode, Gradient, MaskMode, MatteMode } from "../core/types";
import { Nv12Readback } from "./nv12Readback";
import { FxEngine } from "./fxEngine";
import type { ResolvedFx } from "../core/effects";

export interface Draw {
  /** Vertices in the draw's local coordinates. */
  mesh: Mesh;
  /** Straight (non-premultiplied) RGBA, 0..1. */
  color: readonly [number, number, number, number];
  /** Local to output-pixel transform. Defaults to identity. Change later with setTransform. */
  transform?: Affine;
  /** Multiplies the color's alpha. Defaults to 1. */
  opacity?: number;
  /**
   * Draw this image across the mesh instead of a flat color. Texture coordinates
   * are the vertex positions divided by the mesh's maximum x and y, so a
   * rectangle from (0,0) to (w,h) shows the whole image. `color` is ignored.
   */
  image?: ImageBitmap;
  /**
   * Draw this decoded video frame across the mesh (same texture coordinates as
   * `image`). Sampled through an external texture, which also does the YUV to RGB
   * conversion. Replace it every frame with `setFrame`; the renderer never closes it.
   */
  frame?: VideoFrame;
  /** Paint this gradient across `bbox` (in the mesh's local coordinates) instead of the flat color. */
  gradient?: GradientPaint;
  /** How it combines with what is behind it. Defaults to "normal". */
  blend?: BlendMode;
  /** Set on every draw of a layer that has effects, masks or a matte. */
  group?: GroupInfo;
  /** What a draw inside a group is for. Unset: the layer's own picture. */
  role?: "matte" | { readonly mask: number };
}

/**
 * Draws that belong to one layer with effects. Those draws are rendered together
 * into their own texture (at full opacity, normal blend), the effects run over
 * it, and the result is composited with this opacity and blend mode. The `id`
 * says which draws belong together; the rest may change every frame.
 */
export interface GroupInfo {
  readonly id: number;
  readonly fx: readonly ResolvedFx[];
  readonly opacity: number;
  readonly blend: BlendMode;
  /** Applied in order before the effects. Each mask's own draws carry `role: { mask: index }`. */
  readonly masks?: readonly { readonly mode: MaskMode; readonly feather: number; readonly opacity: number; readonly inverted: boolean }[];
  /** Applied after the effects. The matte layer's draws carry `role: "matte"`. */
  readonly matte?: { readonly mode: MatteMode };
}

export interface GradientPaint {
  readonly gradient: Gradient;
  readonly bbox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/** A draw whose transform and opacity are both set. */
export type PlacedDraw = Draw & { transform: Affine; opacity: number };

const SHADER = /* wgsl */ `
// m0 = (a, b, c, d), m1 = (e, f, _, _): x' = a*x + c*y + e, y' = b*x + d*y + f
struct U { size: vec2f, pad: vec2f, color: vec4f, m0: vec4f, m1: vec4f }
@group(0) @binding(0) var<uniform> u: U;

@vertex
fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f {
  let w = vec2f(u.m0.x * p.x + u.m0.z * p.y + u.m1.x, u.m0.y * p.x + u.m0.w * p.y + u.m1.y);
  // Output pixel coordinates, origin top-left, y down.
  return vec4f(w.x / u.size.x * 2.0 - 1.0, 1.0 - w.y / u.size.y * 2.0, 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(u.color.rgb * u.color.a, u.color.a);
}
`;

// Same vertex stage, plus a texture coordinate per vertex (position / extent unless the mesh brings its own).
const TEXTURED_SHADER = /* wgsl */ `
struct U { size: vec2f, extent: vec2f, color: vec4f, m0: vec4f, m1: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var img: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@location(0) p: vec2f, @location(1) t: vec2f) -> VOut {
  let w = vec2f(u.m0.x * p.x + u.m0.z * p.y + u.m1.x, u.m0.y * p.x + u.m0.w * p.y + u.m1.y);
  var o: VOut;
  o.pos = vec4f(w.x / u.size.x * 2.0 - 1.0, 1.0 - w.y / u.size.y * 2.0, 0.0, 1.0);
  o.uv = t;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  // The texture is stored premultiplied, so fading is a plain multiply.
  return textureSample(img, samp, i.uv) * u.color.a;
}
`;

// Video frames come in as an external texture (YUV handled by the browser). Opaque, so opacity is the only alpha.
const EXTERNAL_SHADER = TEXTURED_SHADER.replace("texture_2d<f32>", "texture_external")
  .replace("textureSample(img, samp, i.uv) * u.color.a", "vec4f(textureSampleBaseClampToEdge(img, samp, i.uv).rgb, 1.0) * u.color.a");

// Gradient fill: colour is computed per pixel from the local position, so it stays exact on any triangulation.
const GRADIENT_SHADER = /* wgsl */ `
struct U { size: vec2f, pad: vec2f, color: vec4f, m0: vec4f, m1: vec4f, bbox: vec4f, g: vec4f, offs: array<vec4f, 8>, cols: array<vec4f, 8> }
@group(0) @binding(0) var<uniform> u: U;

struct VOut { @builtin(position) pos: vec4f, @location(0) p: vec2f }

@vertex
fn vs(@location(0) p: vec2f) -> VOut {
  let w = vec2f(u.m0.x * p.x + u.m0.z * p.y + u.m1.x, u.m0.y * p.x + u.m0.w * p.y + u.m1.y);
  var o: VOut;
  o.pos = vec4f(w.x / u.size.x * 2.0 - 1.0, 1.0 - w.y / u.size.y * 2.0, 0.0, 1.0);
  o.p = p;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let uv = (i.p - u.bbox.xy) / max(u.bbox.zw, vec2f(1e-6));
  var t: f32;
  if (u.g.x < 0.5) {
    let d = vec2f(cos(u.g.y), sin(u.g.y));
    t = 0.5 + dot(uv - vec2f(0.5), d) / max(abs(d.x) + abs(d.y), 1e-6);
  } else {
    t = length(uv - vec2f(0.5)) / 0.70710678;
  }
  t = clamp(t, 0.0, 1.0);
  let n = i32(u.g.z);
  var c = u.cols[0];
  for (var k = 1; k < n; k++) {
    let o0 = u.offs[k - 1].x;
    let o1 = u.offs[k].x;
    if (t >= o0) {
      c = mix(u.cols[k - 1], u.cols[k], clamp((t - o0) / max(o1 - o0, 1e-6), 0.0, 1.0));
    }
  }
  return vec4f(c.rgb * c.a, c.a) * u.color.a;
}
`;

type Kind = "solid" | "textured" | "external" | "gradient";

/** Blend state for premultiplied output. The backdrop is always opaque, which keeps multiply exact. */
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

const UNIFORM_FLOATS = 120;
const SAMPLES = 4;

interface Gpu {
  device: GPUDevice;
  format: GPUTextureFormat;
}

interface Prepared {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  ubuf: GPUBuffer;
  bind?: GPUBindGroup;
  count: number;
  /** Mesh extent (max x, max y) for texture coordinates; only used by image draws. */
  extent: [number, number];
  textured: boolean;
  blend: BlendMode;
  group?: GroupInfo;
  role?: Draw["role"];
  gradient?: GradientPaint;
  /** Current video frame; the draw is skipped until one is set. */
  external: boolean;
  frame?: VideoFrame;
  color: Draw["color"];
  transform: Affine;
  opacity: number;
}

/** (x, y, u, v) per vertex. Texture coordinates come from the mesh, or default to position over extent. */
function interleave(mesh: Mesh, ex: number, ey: number): Float32Array {
  const n = mesh.positions.length / 2;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 2]!;
    const y = mesh.positions[i * 2 + 1]!;
    out[i * 4] = x;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = mesh.uvs ? mesh.uvs[i * 2]! : x / ex;
    out[i * 4 + 3] = mesh.uvs ? mesh.uvs[i * 2 + 1]! : y / ey;
  }
  return out;
}

export class MeshRenderer {
  private modules!: Record<Kind, GPUShaderModule>;
  private layouts!: Record<Kind, GPUBindGroupLayout>;
  private pipelineLayouts!: Record<Kind, GPUPipelineLayout>;
  private pipelines = new Map<string, GPURenderPipeline>();
  private fxEngine?: FxEngine;
  private sampler: GPUSampler;
  /** Uploaded images by bitmap identity, so editing other layers never re-uploads a photo. */
  private textures = new Map<ImageBitmap, GPUTexture>();
  private msaa?: GPUTexture;
  private prepared: Prepared[] = [];
  /** Background the frame is cleared to. Use alpha 1 for video export. */
  clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

  private constructor(
    private gpu: Gpu,
    /** Held so the browser's GPU instance is not garbage-collected while we render. */
    private adapter: GPUAdapter,
    private ctx: GPUCanvasContext,
    readonly canvas: HTMLCanvasElement,
  ) {
    const { device } = gpu;
    const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const uniform: GPUBindGroupLayoutEntry = { binding: 0, visibility: both, buffer: { type: "uniform" } };
    const samp: GPUBindGroupLayoutEntry = { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } };
    this.layouts = {
      solid: device.createBindGroupLayout({ entries: [uniform] }),
      gradient: device.createBindGroupLayout({ entries: [uniform] }),
      textured: device.createBindGroupLayout({ entries: [uniform, samp, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }] }),
      external: device.createBindGroupLayout({ entries: [uniform, samp, { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} }] }),
    };
    this.pipelineLayouts = Object.fromEntries(
      (Object.keys(this.layouts) as Kind[]).map((k) => [k, device.createPipelineLayout({ bindGroupLayouts: [this.layouts[k]] })]),
    ) as Record<Kind, GPUPipelineLayout>;
    this.modules = {
      solid: device.createShaderModule({ code: SHADER }),
      textured: device.createShaderModule({ code: TEXTURED_SHADER }),
      external: device.createShaderModule({ code: EXTERNAL_SHADER }),
      gradient: device.createShaderModule({ code: GRADIENT_SHADER }),
    };
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  }

  /** Pipelines are made on first use: most scenes only ever need "normal". */
  private pipelineFor(kind: Kind, blend: BlendMode): GPURenderPipeline {
    const key = `${kind}:${blend}`;
    let p = this.pipelines.get(key);
    if (!p) {
      const module = this.modules[kind];
      p = this.gpu.device.createRenderPipeline({
        layout: this.pipelineLayouts[kind],
        vertex: {
          module,
          entryPoint: "vs",
          buffers: [
            kind === "textured" || kind === "external"
              ? { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }, { shaderLocation: 1, offset: 8, format: "float32x2" }] }
              : { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
          ],
        },
        fragment: { module, entryPoint: "fs", targets: [{ format: this.gpu.format, blend: blendState(blend) }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        multisample: { count: SAMPLES },
      });
      this.pipelines.set(key, p);
    }
    return p;
  }

  private textureFor(bitmap: ImageBitmap): GPUTexture {
    let tex = this.textures.get(bitmap);
    if (!tex) {
      tex = this.gpu.device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.gpu.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex, premultipliedAlpha: true }, [bitmap.width, bitmap.height]);
      this.textures.set(bitmap, tex);
    }
    return tex;
  }

  static async create(canvas: HTMLCanvasElement): Promise<MeshRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU is not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    device.addEventListener("uncapturederror", (e) => console.error("WebGPU error:", (e as GPUUncapturedErrorEvent).error.message));
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("Could not get a webgpu canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    return new MeshRenderer({ device, format }, adapter, ctx, canvas);
  }

  /** Upload draws. Call again to replace the scene. */
  setScene(draws: readonly Draw[]): void {
    for (const p of this.prepared) {
      p.vbuf.destroy();
      p.ibuf.destroy();
      p.ubuf.destroy();
    }
    const { device } = this.gpu;
    this.prepared = draws
      .filter((d) => d.mesh.indices.length > 0)
      .map((d) => {
        const isImage = !!d.image || !!d.frame;
        let ex = 0;
        let ey = 0;
        if (isImage) {
          for (let i = 0; i < d.mesh.positions.length; i += 2) {
            ex = Math.max(ex, d.mesh.positions[i]!);
            ey = Math.max(ey, d.mesh.positions[i + 1]!);
          }
        }
        // Picture draws carry (x, y, u, v) per vertex; everything else just (x, y).
        const verts: Float32Array = isImage ? interleave(d.mesh, ex || 1, ey || 1) : d.mesh.positions;
        const vbuf = device.createBuffer({
          size: verts.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vbuf, 0, verts as Float32Array<ArrayBuffer>);
        const ibuf = device.createBuffer({
          size: d.mesh.indices.byteLength,
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(ibuf, 0, d.mesh.indices as Uint32Array<ArrayBuffer>);
        const ubuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const textured = !!d.image;
        const external = !!d.frame;
        const gradient = d.image || d.frame ? undefined : d.gradient;
        const kind: Kind = external ? "external" : textured ? "textured" : gradient ? "gradient" : "solid";
        const bind = external
          ? undefined
          : device.createBindGroup({
              layout: this.layouts[kind],
              entries: [
                { binding: 0, resource: { buffer: ubuf } },
                ...(textured
                  ? [
                      { binding: 1, resource: this.sampler },
                      { binding: 2, resource: this.textureFor(d.image!).createView() },
                    ]
                  : []),
              ],
            });
        return {
          vbuf,
          ibuf,
          ubuf,
          bind,
          extent: [ex || 1, ey || 1] as [number, number],
          textured,
          blend: d.blend ?? "normal",
          group: d.group,
          role: d.role,
          gradient,
          external,
          frame: d.frame,
          count: d.mesh.indices.length,
          color: d.color,
          transform: d.transform ?? IDENTITY,
          opacity: d.opacity ?? 1,
        };
      });
    // Free pictures that no draw uses any more (deleted layers, replaced video-frame bitmaps).
    const live = new Set(draws.map((d) => d.image).filter((i): i is ImageBitmap => !!i));
    for (const [bitmap, tex] of this.textures) {
      if (!live.has(bitmap)) {
        tex.destroy();
        this.textures.delete(bitmap);
      }
    }
  }

  /** New vertex positions for a picture draw whose mesh keeps its size (a warped picture). */
  setMesh(index: number, mesh: Mesh): void {
    const p = this.prepared[index];
    if (!p || !p.textured) return;
    this.gpu.device.queue.writeBuffer(p.vbuf, 0, interleave(mesh, p.extent[0], p.extent[1]) as Float32Array<ArrayBuffer>);
  }

  /** Update the effect group of draw `index` (values change every frame; membership is fixed by setScene). */
  setGroup(index: number, group: GroupInfo | undefined): void {
    const p = this.prepared[index];
    if (!p) throw new Error(`No draw at index ${index}`);
    p.group = group;
  }

  /** Swap the video frame of draw `index` (a draw created with `frame`). Cheap: no geometry upload. */
  setFrame(index: number, frame: VideoFrame | undefined): void {
    const p = this.prepared[index];
    if (!p || !p.external) throw new Error(`Draw ${index} is not a video draw`);
    p.frame = frame;
  }

  get format(): GPUTextureFormat {
    return this.gpu.format;
  }

  /**
   * Move, rotate, scale or fade draw `index` without touching its geometry. This
   * is a uniform update only, so it is the cheap per-frame animation path.
   * `index` counts the draws passed to setScene, skipping any with no triangles.
   */
  setTransform(index: number, transform: Affine, opacity = 1): void {
    const p = this.prepared[index];
    if (!p) throw new Error(`No draw at index ${index}`);
    p.transform = transform;
    p.opacity = opacity;
  }

  get drawCount(): number {
    return this.prepared.length;
  }

  /** Create a reusable readback target for the current canvas size. */
  /** Release GPU resources. The renderer is unusable afterwards. */
  destroy(): void {
    for (const p of this.prepared) {
      p.vbuf.destroy();
      p.ibuf.destroy();
      p.ubuf.destroy();
    }
    this.prepared = [];
    this.fxEngine?.destroy();
    for (const t of this.textures.values()) t.destroy();
    this.textures.clear();
    this.msaa?.destroy();
    this.gpu.device.destroy();
  }

  /** Offscreen render plus GPU conversion to BT.709 limited-range NV12 (see Nv12Readback). */
  createNv12Readback(): Nv12Readback {
    return new Nv12Readback(this.gpu.device, this.gpu.format, this.canvas.width, this.canvas.height, (enc, tex, w, h) => this.encode(enc, tex, w, h));
  }

  createReadback(): FrameReadback {
    return new FrameReadback(this.gpu.device, this.gpu.format, this.canvas.width, this.canvas.height, (enc, tex, w, h) =>
      this.encode(enc, tex, w, h),
    );
  }

  private ensureMsaa(w: number, h: number): GPUTexture {
    if (!this.msaa || this.msaa.width !== w || this.msaa.height !== h) {
      this.msaa?.destroy();
      this.msaa = this.gpu.device.createTexture({
        size: [w, h],
        sampleCount: SAMPLES,
        format: this.gpu.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    return this.msaa;
  }

  private encode(enc: GPUCommandEncoder, target: GPUTexture, w: number, h: number): void {
    // Runs of consecutive draws: plain ones go straight into the frame; a layer with effects is drawn
    // into its own texture, run through its effects and composited back.
    const runs: { group?: GroupInfo; list: Prepared[] }[] = [];
    for (const p of this.prepared) {
      const last = runs[runs.length - 1];
      if (last && (last.group?.id ?? -1) === (p.group?.id ?? -1) && (p.group || !last.group)) last.list.push(p);
      else runs.push({ ...(p.group ? { group: p.group } : {}), list: [p] });
    }
    if (!runs.some((r) => r.group)) {
      const pass = this.msaaPass(enc, target, this.clearColor, w, h);
      this.drawList(pass, this.prepared, w, h, 0);
      pass.end();
      return;
    }
    const fx = (this.fxEngine ??= new FxEngine(this.gpu.device, this.gpu.format));
    fx.begin(w, h);
    let cur: GPUTexture | null = null;
    runs.forEach((run, i) => {
      const last = i === runs.length - 1;
      if (!run.group) {
        const out: GPUTexture = last ? target : fx.nextAccum(cur);
        const pass = this.msaaPass(enc, out, cur ? { r: 0, g: 0, b: 0, a: 0 } : this.clearColor, w, h);
        if (cur) fx.copyInto(pass, cur);
        this.drawList(pass, run.list, w, h, 0);
        pass.end();
        cur = out;
        return;
      }
      const g = run.group;
      const own = run.list.filter((p) => p.role === undefined);
      const layer = fx.layerTarget;
      const pass = this.msaaPass(enc, layer, { r: 0, g: 0, b: 0, a: 0 }, w, h);
      this.drawList(pass, own, w, h, 1);
      pass.end();
      let tex: GPUTexture = layer;
      if (g.masks?.length) {
        let cover = fx.named("coverA");
        let spare = fx.named("coverB");
        fx.fill(enc, cover, g.masks[0]!.mode === "add" ? 0 : 1);
        g.masks.forEach((mk, mi) => {
          const shape = fx.named("maskShape");
          const mp = this.msaaPass(enc, shape, { r: 0, g: 0, b: 0, a: 0 }, w, h);
          this.drawList(mp, run.list.filter((p) => typeof p.role === "object" && p.role.mask === mi), w, h, 1);
          mp.end();
          const soft = fx.blurred(enc, shape, mk.feather);
          fx.maskOp(enc, spare, cover, soft, mk.mode, mk.opacity, mk.inverted);
          [cover, spare] = [spare, cover];
        });
        const masked = fx.named("masked");
        fx.mulAlpha(enc, masked, tex, cover);
        tex = masked;
      }
      tex = fx.applyEffects(enc, tex, g.fx);
      if (g.matte) {
        const mt = fx.named("matteShape");
        const mp = this.msaaPass(enc, mt, { r: 0, g: 0, b: 0, a: 0 }, w, h);
        this.drawList(mp, run.list.filter((p) => p.role === "matte"), w, h, 2);
        mp.end();
        const matted = fx.named("matted");
        fx.applyMatte(enc, matted, tex, mt, g.matte.mode);
        tex = matted;
      }
      const result = tex;
      const out: GPUTexture = last ? target : fx.nextAccum(cur);
      fx.composite(enc, out, cur, result, run.group.opacity, run.group.blend, this.clearColor);
      cur = out;
    });
  }

  private msaaPass(enc: GPUCommandEncoder, resolveTo: GPUTexture, clear: GPUColor, w: number, h: number): GPURenderPassEncoder {
    return enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ensureMsaa(w, h).createView(),
          resolveTarget: resolveTo.createView(),
          clearValue: clear,
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
  }

  /** `mode` 1: full opacity, normal blend (the layer's group applies those later). 2: keep each draw's opacity, normal blend. */
  private drawList(pass: GPURenderPassEncoder, list: readonly Prepared[], w: number, h: number, mode: 0 | 1 | 2): void {
    const flat = mode !== 0;
    const { device } = this.gpu;
    let current: GPURenderPipeline | null = null;
    const data = new Float32Array(UNIFORM_FLOATS);
    for (const p of list) {
      if (p.external && !p.frame) continue; // no decoded frame yet
      const kind: Kind = p.external ? "external" : p.textured ? "textured" : p.gradient ? "gradient" : "solid";
      const want = this.pipelineFor(kind, flat ? "normal" : p.blend);
      if (want !== current) {
        pass.setPipeline(want);
        current = want;
      }
      const [a, b, c, d, e, f] = p.transform;
      const [r, g, bl, al] = p.textured || p.external || p.gradient ? [1, 1, 1, 1] : p.color;
      data.fill(0);
      data.set([w, h, p.extent[0], p.extent[1], r, g, bl, al * (mode === 1 ? 1 : p.opacity), a, b, c, d, e, f, 0, 0]);
      if (p.gradient) {
        const { gradient: gr, bbox } = p.gradient;
        data.set([bbox.x, bbox.y, bbox.w, bbox.h, gr.kind === "radial" ? 1 : 0, (gr.angle * Math.PI) / 180, gr.stops.length, 0], 16);
        gr.stops.forEach((st, i) => {
          data[24 + i * 4] = st.offset;
          data.set(st.color, 56 + i * 4);
        });
      }
      device.queue.writeBuffer(p.ubuf, 0, data);
      pass.setBindGroup(
        0,
        p.external
          ? device.createBindGroup({
              layout: this.layouts.external,
              entries: [
                { binding: 0, resource: { buffer: p.ubuf } },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: device.importExternalTexture({ source: p.frame! }) },
              ],
            })
          : p.bind!,
      );
      pass.setVertexBuffer(0, p.vbuf);
      pass.setIndexBuffer(p.ibuf, "uint32");
      pass.drawIndexed(p.count);
    }
  }

  /** Draw the scene to the canvas. */
  render(): void {
    const enc = this.gpu.device.createCommandEncoder();
    this.encode(enc, this.ctx.getCurrentTexture(), this.canvas.width, this.canvas.height);
    this.gpu.device.queue.submit([enc.finish()]);
  }

  /**
   * Draw the scene to an offscreen texture and read it back as RGBA bytes
   * (premultiplied). Independent of canvas presentation, so it is reliable for tests.
   */
  async readPixels(): Promise<{ width: number; height: number; data: Uint8Array }> {
    const { device, format } = this.gpu;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const tex = device.createTexture({
      size: [w, h],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    this.encode(enc, tex, w, h);
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [w, h]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange());
    const data = new Uint8Array(w * h * 4);
    const bgra = format === "bgra8unorm";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * bytesPerRow + x * 4;
        const d = (y * w + x) * 4;
        data[d] = raw[bgra ? s + 2 : s]!;
        data[d + 1] = raw[s + 1]!;
        data[d + 2] = raw[bgra ? s : s + 2]!;
        data[d + 3] = raw[s + 3]!;
      }
    }
    buf.unmap();
    buf.destroy();
    tex.destroy();
    return { width: w, height: h, data };
  }
}

/**
 * Reusable offscreen render + CPU readback. Avoids allocating a texture and
 * buffer per frame. `read()` returns rows padded to `bytesPerRow`, in the
 * canvas format (BGRA or RGBA), premultiplied alpha.
 */
export class FrameReadback {
  readonly bytesPerRow: number;
  private tex: GPUTexture;
  private buf: GPUBuffer;

  constructor(
    private device: GPUDevice,
    readonly format: GPUTextureFormat,
    readonly width: number,
    readonly height: number,
    private encodeScene: (enc: GPUCommandEncoder, tex: GPUTexture, w: number, h: number) => void,
  ) {
    this.bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    this.tex = device.createTexture({
      size: [width, height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.buf = device.createBuffer({
      size: this.bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** Render the scene and return a copy of the pixels (padded rows). */
  async read(): Promise<Uint8Array<ArrayBuffer>> {
    const enc = this.device.createCommandEncoder();
    this.encodeScene(enc, this.tex, this.width, this.height);
    enc.copyTextureToBuffer({ texture: this.tex }, { buffer: this.buf, bytesPerRow: this.bytesPerRow }, [this.width, this.height]);
    this.device.queue.submit([enc.finish()]);
    await this.buf.mapAsync(GPUMapMode.READ);
    const out = new Uint8Array(this.buf.getMappedRange().slice(0));
    this.buf.unmap();
    return out;
  }

  destroy(): void {
    this.tex.destroy();
    this.buf.destroy();
  }
}
