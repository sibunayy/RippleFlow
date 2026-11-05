import { IDENTITY, type Affine } from "../core/affine";
import type { Mesh } from "../geometry/mesh";
import type { BlendMode, Gradient } from "../core/types";
import { Nv12Readback } from "./nv12Readback";

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

// Same vertex stage; `pad` carries the mesh extent so uv = position / extent.
const TEXTURED_SHADER = /* wgsl */ `
struct U { size: vec2f, extent: vec2f, color: vec4f, m0: vec4f, m1: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var img: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@location(0) p: vec2f) -> VOut {
  let w = vec2f(u.m0.x * p.x + u.m0.z * p.y + u.m1.x, u.m0.y * p.x + u.m0.w * p.y + u.m1.y);
  var o: VOut;
  o.pos = vec4f(w.x / u.size.x * 2.0 - 1.0, 1.0 - w.y / u.size.y * 2.0, 0.0, 1.0);
  o.uv = p / u.extent;
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
  gradient?: GradientPaint;
  /** Current video frame; the draw is skipped until one is set. */
  external: boolean;
  frame?: VideoFrame;
  color: Draw["color"];
  transform: Affine;
  opacity: number;
}

export class MeshRenderer {
  private modules!: Record<Kind, GPUShaderModule>;
  private layouts!: Record<Kind, GPUBindGroupLayout>;
  private pipelineLayouts!: Record<Kind, GPUPipelineLayout>;
  private pipelines = new Map<string, GPURenderPipeline>();
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
        vertex: { module, entryPoint: "vs", buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] },
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
        const vbuf = device.createBuffer({
          size: d.mesh.positions.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vbuf, 0, d.mesh.positions as Float32Array<ArrayBuffer>);
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
        const isImage = textured || external;
        let ex = 0;
        let ey = 0;
        if (isImage) {
          for (let i = 0; i < d.mesh.positions.length; i += 2) {
            ex = Math.max(ex, d.mesh.positions[i]!);
            ey = Math.max(ey, d.mesh.positions[i + 1]!);
          }
        }
        return {
          vbuf,
          ibuf,
          ubuf,
          bind,
          extent: [ex || 1, ey || 1] as [number, number],
          textured,
          blend: d.blend ?? "normal",
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
    const { device } = this.gpu;
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ensureMsaa(w, h).createView(),
          resolveTarget: target.createView(),
          clearValue: this.clearColor,
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    let current: GPURenderPipeline | null = null;
    const data = new Float32Array(UNIFORM_FLOATS);
    for (const p of this.prepared) {
      if (p.external && !p.frame) continue; // no decoded frame yet
      const kind: Kind = p.external ? "external" : p.textured ? "textured" : p.gradient ? "gradient" : "solid";
      const want = this.pipelineFor(kind, p.blend);
      if (want !== current) {
        pass.setPipeline(want);
        current = want;
      }
      const [a, b, c, d, e, f] = p.transform;
      const [r, g, bl, al] = p.textured || p.external || p.gradient ? [1, 1, 1, 1] : p.color;
      data.fill(0);
      data.set([w, h, p.extent[0], p.extent[1], r, g, bl, al * p.opacity, a, b, c, d, e, f, 0, 0]);
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
    pass.end();
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
