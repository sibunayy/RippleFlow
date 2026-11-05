import { scale, type Affine } from "../core/affine";

/** How a decoded VideoFrame reaches the GPU. */
export type UploadMode =
  /** frame.copyTo() to CPU memory, then queue.writeTexture. Slow, but needs no external-image support. */
  | "cpu"
  /** queue.copyExternalImageToTexture({ source: frame }) */
  | "copy"
  /** createImageBitmap(frame), then copyExternalImageToTexture */
  | "bitmap"
  /** device.importExternalTexture({ source: frame }) */
  | "external";

const SHADER = (texDecl: string, sample: string) => /* wgsl */ `
struct U { dst: vec2f, vid: vec2f, m0: vec4f, m1: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) ${texDecl}

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var c = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let uv = c[i];
  let p = uv * u.vid; // local video pixels
  let w = vec2f(u.m0.x * p.x + u.m0.z * p.y + u.m1.x, u.m0.y * p.x + u.m0.w * p.y + u.m1.y);
  var o: VOut;
  o.pos = vec4f(w.x / u.dst.x * 2.0 - 1.0, 1.0 - w.y / u.dst.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return ${sample};
}
`;

const FORMAT: GPUTextureFormat = "rgba8unorm";

/**
 * Draws one video frame as a transformed quad into an offscreen texture, using
 * a chosen upload path. Used by the video spike to find which paths work on a
 * given browser and how fast they are. Not a general compositor.
 */
export class VideoQuadRenderer {
  private target: GPUTexture;
  private sampler: GPUSampler;
  private ubuf: GPUBuffer;
  private copyPipeline: GPURenderPipeline;
  private externalPipeline: GPURenderPipeline;
  private frameTex?: GPUTexture;
  private copyBind?: GPUBindGroup;
  private frameW = 0;
  private frameH = 0;
  /** Set if the browser destroys or loses the device (e.g. an unsupported upload path). */
  lostReason: string | null = null;

  private constructor(
    private device: GPUDevice,
    /** Held so the browser's GPU instance is not garbage-collected. */
    private adapter: GPUAdapter,
    readonly width: number,
    readonly height: number,
  ) {
    void device.lost.then((info) => {
      this.lostReason = `${info.reason}: ${info.message}`;
    });
    this.target = device.createTexture({
      size: [width, height],
      format: FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const make = (texDecl: string, sample: string) => {
      const module = device.createShaderModule({ code: SHADER(texDecl, sample) });
      return device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
    };
    this.copyPipeline = make("var tex: texture_2d<f32>;", "textureSample(tex, samp, in.uv)");
    this.externalPipeline = make("var tex: texture_external;", "textureSampleBaseClampToEdge(tex, samp, in.uv)");
  }

  static async create(width: number, height: number): Promise<VideoQuadRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU is not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    return new VideoQuadRenderer(device, adapter, width, height);
  }

  /** Resolves after all submitted GPU work has finished. */
  idle(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
  }

  private ensureFrameTexture(w: number, h: number): GPUTexture {
    if (!this.frameTex || this.frameW !== w || this.frameH !== h) {
      this.frameTex?.destroy();
      this.frameTex = this.device.createTexture({
        size: [w, h],
        format: FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.frameW = w;
      this.frameH = h;
      this.copyBind = undefined;
    }
    return this.frameTex;
  }

  /**
   * Upload `frame` with `mode` and draw it into the offscreen target, scaled to
   * fit by default. Throws if the browser rejects the upload path. Does not close the frame.
   */
  async draw(frame: VideoFrame, mode: UploadMode, transform?: Affine): Promise<void> {
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    const m = transform ?? scale(this.width / w, this.height / h);
    const [a, b, c, d, e, f] = m;
    this.device.queue.writeBuffer(
      this.ubuf,
      0,
      new Float32Array([this.width, this.height, w, h, a, b, c, d, e, f, 0, 0]),
    );

    this.device.pushErrorScope("validation");
    let bind: GPUBindGroup;
    let pipeline: GPURenderPipeline;
    let thrown: unknown;
    try {
      if (mode === "external") {
        const ext = this.device.importExternalTexture({ source: frame });
        pipeline = this.externalPipeline;
        bind = this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.ubuf } },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: ext },
          ],
        });
      } else {
        const tex = this.ensureFrameTexture(w, h);
        if (mode === "cpu") {
          const buf = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
          await frame.copyTo(buf, { format: "RGBA" });
          this.device.queue.writeTexture({ texture: tex }, buf, { bytesPerRow: w * 4 }, [w, h]);
        } else if (mode === "bitmap") {
          const bmp = await createImageBitmap(frame);
          try {
            this.device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [w, h]);
          } finally {
            bmp.close();
          }
        } else {
          this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: tex }, [w, h]);
        }
        pipeline = this.copyPipeline;
        this.copyBind ??= this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.ubuf } },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: tex.createView() },
          ],
        });
        bind = this.copyBind;
      }

      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: this.target.createView(), clearValue: { r: 1, g: 0, b: 1, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(6);
      pass.end();
      this.device.queue.submit([enc.finish()]);
    } catch (e) {
      thrown = e;
    }
    // Pop the scope even after a throw, but never let it hide the original error.
    let scopeError: GPUError | null = null;
    try {
      scopeError = await this.device.popErrorScope();
    } catch (e) {
      thrown ??= e;
    }
    if (thrown) throw thrown;
    if (scopeError) throw new Error(`WebGPU validation error: ${scopeError.message}`);
  }

  /** Read one row of the rendered target as RGBA bytes. */
  async readRow(y: number): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil((this.width * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.target, origin: [0, y, 0] }, { buffer: buf, bytesPerRow }, [this.width, 1, 1]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const out = new Uint8Array(buf.getMappedRange().slice(0, this.width * 4));
    buf.unmap();
    buf.destroy();
    return out;
  }

  destroy(): void {
    this.target.destroy();
    this.frameTex?.destroy();
    this.ubuf.destroy();
  }
}

