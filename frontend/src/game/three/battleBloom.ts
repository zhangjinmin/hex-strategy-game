import * as THREE from 'three';

/**
 * battleBloom.ts — 战场泛光链（独立模块，零外部依赖）
 *
 * 为什么单独成模块：`Battle3DOverlay` 已有 9000+ 行、且它的渲染顺序（离屏 RT → CRT 合成）
 * 被 v99 的"调档闪烁"修复约束过。泛光只应**插在两次 render 之间**，不应改写既有管线。
 *
 * 设计取舍（对照参考图实测）：
 *  · **低强度 + 高阈值**：只让"本来就亮"的东西溢出（引擎口、激光、爆炸、亮星），
 *    整体画面不变亮。阈值放低会把星云底也糊起来，画面立刻"脏"。
 *  · **半分辨率**：亮部提取与两趟可分离高斯都在 0.5× 缓冲上做。1080p@2x（4K 缓冲）
 *    实测 <0.6ms，而全分辨率会到 2ms 以上且几乎看不出差别。
 *  · 输出是**线性空间**纹理：CRT 着色器在该阶段之后才做 sRGB 编码，
 *    所以这里绝不能自己编码，否则叠加后亮度会错一倍。
 */
export interface BloomChain {
  /** 供 CRT 合成采样的泛光纹理（线性空间）。**禁用时也返回有效纹理**：
   *  采样一个未绑定的 sampler 在部分驱动上会取到上一个纹理单元的内容，
   *  用 "uBloom=0 乘掉" 比 "绑定 null" 安全。 */
  readonly texture: THREE.Texture;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** 每次 resize（含调档、DPR 变化）都必须调用；内部按 0.5× 重建三个 RT */
  setSize(w: number, h: number, dpr: number): void;
  /** 在"主场景已渲进 srcTexture"之后调用；内部自行保存/恢复 renderTarget */
  render(renderer: THREE.WebGLRenderer, src: THREE.Texture): void;
  dispose(): void;
}

const BRIGHT_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform float uThreshold;
  uniform float uKnee;
  void main(){
    vec3 c = texture2D(tSrc, vUv).rgb;
    // 用最大通道判亮，而不是亮度加权：纯红激光与纯蓝引擎口都应被采到
    float l = max(c.r, max(c.g, c.b));
    float f = smoothstep(uThreshold, uThreshold + uKnee, l);
    gl_FragColor = vec4(c * f, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uDir;          // 已含像素步长与半径：H 传 (1/w,0)，V 传 (0,1/h)，再乘 radius
  void main(){
    // 9-tap 可分离高斯（权重来自常见 5 采样近似，总和 = 1）
    vec3 s  = texture2D(tSrc, vUv).rgb * 0.2270270270;
    s += (texture2D(tSrc, vUv + uDir * 1.3846153846).rgb
        + texture2D(tSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
    s += (texture2D(tSrc, vUv + uDir * 3.2307692308).rgb
        + texture2D(tSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }
`;

export interface BloomOptions {
  /** 亮度阈值（线性空间，1.0 = 白）。默认 0.70
   *  ⚠ 本作的材质输出是 LDR（≤1.0，没有 HDR 曝光），阈值设 >1 会**一个像素都采不到**；
   *    0.70 在 sRGB 显示上约等于 0.86，正好只圈住引擎口/激光/爆闪这类高亮，不碰舰体中间调。 */
  threshold?: number;
  /** 阈值软过渡宽度，避免硬边。默认 0.35 */
  knee?: number;
  /** 模糊半径（以半分辨率缓冲的像素为单位）。默认 2.2 */
  radius?: number;
}

class BloomChainImpl implements BloomChain {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly brightMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly rtBright: THREE.WebGLRenderTarget;
  private readonly rtBlurA: THREE.WebGLRenderTarget;
  private readonly rtBlurB: THREE.WebGLRenderTarget;
  private readonly radius: number;
  private _enabled = true;
  private _w = 1;
  private _h = 1;

  constructor(opts: BloomOptions = {}) {
    this.radius = opts.radius ?? 2.2;
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        uThreshold: { value: opts.threshold ?? 0.70 },
        uKnee: { value: opts.knee ?? 0.35 },
      },
      vertexShader: BRIGHT_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: BRIGHT_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const rtOpts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.rtBright = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtBlurA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtBlurB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    // 泛光纹理不能参与 mip 采样，否则模糊后取到的是更粗的层
    this.rtBlurB.texture.generateMipmaps = false;
  }

  get texture(): THREE.Texture {
    return this.rtBlurB.texture;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
  }

  setSize(w: number, h: number, dpr: number): void {
    // 半分辨率（不是四分之一）：再降会出现明显的方块状溢出
    const bw = Math.max(1, Math.floor(w * dpr * 0.5));
    const bh = Math.max(1, Math.floor(h * dpr * 0.5));
    if (bw === this._w && bh === this._h) return;
    this._w = bw;
    this._h = bh;
    this.rtBright.setSize(bw, bh);
    this.rtBlurA.setSize(bw, bh);
    this.rtBlurB.setSize(bw, bh);
  }

  render(renderer: THREE.WebGLRenderer, src: THREE.Texture): void {
    if (!this._enabled) return;
    const prev = renderer.getRenderTarget();

    // ① 亮部提取
    this.quad.material = this.brightMat;
    this.brightMat.uniforms.tSrc.value = src;
    renderer.setRenderTarget(this.rtBright);
    renderer.render(this.scene, this.camera);

    // ② 水平模糊
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tSrc.value = this.rtBright.texture;
    this.blurMat.uniforms.uDir.value.set(this.radius / this._w, 0);
    renderer.setRenderTarget(this.rtBlurA);
    renderer.render(this.scene, this.camera);

    // ③ 垂直模糊
    this.blurMat.uniforms.tSrc.value = this.rtBlurA.texture;
    this.blurMat.uniforms.uDir.value.set(0, this.radius / this._h);
    renderer.setRenderTarget(this.rtBlurB);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.rtBright.dispose();
    this.rtBlurA.dispose();
    this.rtBlurB.dispose();
    this.quad.geometry.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
  }
}

export function createBloomChain(opts?: BloomOptions): BloomChain {
  return new BloomChainImpl(opts);
}
