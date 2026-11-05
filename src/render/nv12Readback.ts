/**
 * Renders a scene, converts it on the GPU to BT.709 limited-range NV12 (Y 16..235,
 * Cb/Cr 16..240), and reads the planes back. Giving the encoder YUV we computed
 * ourselves means the range in the file is the range we say it is, whatever
 * RGB-to-YUV conversion a particular browser's encoder would have applied.
 */

const SHADER = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

const KR = 0.2126;
const KB = 0.0722;
const KG = 0.7152;

fn luma(c: vec3f) -> f32 { return KR * c.r + KG * c.g + KB * c.b; }

@fragment
fn fsY(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(pos.xy), 0).rgb;
  return vec4f((16.0 + 219.0 * luma(c)) / 255.0, 0.0, 0.0, 1.0);
}

// One chroma sample per 2x2 block of pixels (box average; chroma is linear in R'G'B').
@fragment
fn fsUV(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let b = vec2i(pos.xy) * 2;
  let c = (textureLoad(src, b, 0).rgb + textureLoad(src, b + vec2i(1, 0), 0).rgb
         + textureLoad(src, b + vec2i(0, 1), 0).rgb + textureLoad(src, b + vec2i(1, 1), 0).rgb) * 0.25;
  let y = luma(c);
  let cb = (128.0 + 224.0 * (c.b - y) / (2.0 * (1.0 - KB))) / 255.0;
  let cr = (128.0 + 224.0 * (c.r - y) / (2.0 * (1.0 - KR))) / 255.0;
  return vec4f(cb, cr, 0.0, 1.0);
}
`;

export class Nv12Readback {
  /** Bytes per row of both planes in the data returned by read() (rows are padded to 256). */
  readonly stride: number;
  private src: GPUTexture;
  private yTex: GPUTexture;
  private uvTex: GPUTexture;
  private buf: GPUBuffer;
  private yPipeline: GPURenderPipeline;
  private uvPipeline: GPURenderPipeline;
  /** Auto layouts are per pipeline, so each pass needs a bind group made from its own pipeline. */
  private yBind: GPUBindGroup;
  private uvBind: GPUBindGroup;

  constructor(
    private device: GPUDevice,
    format: GPUTextureFormat,
    readonly width: number,
    readonly height: number,
    private encodeScene: (enc: GPUCommandEncoder, tex: GPUTexture, w: number, h: number) => void,
  ) {
    if (width % 2 || height % 2) throw new Error("NV12 needs even dimensions");
    this.stride = Math.ceil(width / 256) * 256;
    this.src = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const planeUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
    this.yTex = device.createTexture({ size: [width, height], format: "r8unorm", usage: planeUsage });
    this.uvTex = device.createTexture({ size: [width / 2, height / 2], format: "rg8unorm", usage: planeUsage });
    this.buf = device.createBuffer({ size: (this.stride * height * 3) / 2, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const module = device.createShaderModule({ code: SHADER });
    const make = (entry: string, target: GPUTextureFormat) =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: entry, targets: [{ format: target }] },
        primitive: { topology: "triangle-list" },
      });
    this.yPipeline = make("fsY", "r8unorm");
    this.uvPipeline = make("fsUV", "rg8unorm");
    const view = this.src.createView();
    this.yBind = device.createBindGroup({ layout: this.yPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] });
    this.uvBind = device.createBindGroup({ layout: this.uvPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }] });
  }

  /** Render the scene and return the NV12 planes: Y (stride x height) followed by interleaved CbCr (stride x height/2). */
  async read(): Promise<Uint8Array<ArrayBuffer>> {
    const { device, width: w, height: h, stride } = this;
    const enc = device.createCommandEncoder();
    this.encodeScene(enc, this.src, w, h);
    const pass = (tex: GPUTexture, pipeline: GPURenderPipeline, bind: GPUBindGroup) => {
      const p = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      p.setPipeline(pipeline);
      p.setBindGroup(0, bind);
      p.draw(3);
      p.end();
    };
    pass(this.yTex, this.yPipeline, this.yBind);
    pass(this.uvTex, this.uvPipeline, this.uvBind);
    enc.copyTextureToBuffer({ texture: this.yTex }, { buffer: this.buf, bytesPerRow: stride }, [w, h]);
    enc.copyTextureToBuffer({ texture: this.uvTex }, { buffer: this.buf, offset: stride * h, bytesPerRow: stride }, [w / 2, h / 2]);
    device.queue.submit([enc.finish()]);
    await this.buf.mapAsync(GPUMapMode.READ);
    const out = new Uint8Array(this.buf.getMappedRange().slice(0));
    this.buf.unmap();
    return out;
  }

  destroy(): void {
    this.src.destroy();
    this.yTex.destroy();
    this.uvTex.destroy();
    this.buf.destroy();
  }
}

/** CPU reference for the same conversion, 8-bit RGB in, limited-range BT.709 YCbCr out (rounded). For tests. */
export function rgbToYuv709Limited(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  return [
    Math.round(16 + 219 * y),
    Math.round(128 + (224 * (B - y)) / (2 * (1 - 0.0722))),
    Math.round(128 + (224 * (R - y)) / (2 * (1 - 0.2126))),
  ];
}
