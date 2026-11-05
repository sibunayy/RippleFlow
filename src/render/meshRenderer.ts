import { IDENTITY, type Affine } from "../core/affine";
import type { Mesh } from "../geometry/mesh";

export interface Draw {
  /** Vertices in the draw's local coordinates. */
  mesh: Mesh;
  /** Straight (non-premultiplied) RGBA, 0..1. */
  color: readonly [number, number, number, number];
  /** Local to output-pixel transform. Defaults to identity. Change later with setTransform. */
  transform?: Affine;
  /** Multiplies the color's alpha. Defaults to 1. */
  opacity?: number;
}

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

const SAMPLES = 4;

interface Gpu {
  device: GPUDevice;
  format: GPUTextureFormat;
}

interface Prepared {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  ubuf: GPUBuffer;
  bind: GPUBindGroup;
  count: number;
  color: Draw["color"];
  transform: Affine;
  opacity: number;
}

export class MeshRenderer {
  private pipeline: GPURenderPipeline;
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
    const { device, format } = gpu;
    const module = device.createShaderModule({ code: SHADER });
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }],
      },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      multisample: { count: SAMPLES },
    });
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
        const ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const bind = device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: ubuf } }],
        });
        return {
          vbuf,
          ibuf,
          ubuf,
          bind,
          count: d.mesh.indices.length,
          color: d.color,
          transform: d.transform ?? IDENTITY,
          opacity: d.opacity ?? 1,
        };
      });
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
    this.msaa?.destroy();
    this.gpu.device.destroy();
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
    pass.setPipeline(this.pipeline);
    for (const p of this.prepared) {
      const [a, b, c, d, e, f] = p.transform;
      const [r, g, bl, al] = p.color;
      device.queue.writeBuffer(p.ubuf, 0, new Float32Array([w, h, 0, 0, r, g, bl, al * p.opacity, a, b, c, d, e, f, 0, 0]));
      pass.setBindGroup(0, p.bind);
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
