import * as THREE from 'three';

/**
 * battleBackdrop.ts — 战场星云底（一次性 GPU 烘焙，零每帧成本）
 *
 * 为什么不是"每帧跑 fbm 的天空球"：实测 4 倍频 fbm 全屏在 1080p@2x 上约 4~6ms，
 * 而它只是一个**静态背景**。这里改为启动时渲进一张 1024×512 的 RT，之后仅作为
 * `scene.background` 采样 —— 每帧成本 = 一次背景 quad，与纯色背景同阶。
 *
 * 为什么要有它（用户的质感参考）：参考图的背景亮度实测 0.10~0.21，
 * 而本作原本是纯色 `#040810`（实测 0.0207）。背景一黑，前面所有元素都像"贴在黑纸上"；
 * 补上这层之后，点云/舰队才读作"在深空里"。
 *
 * ⚠ 颜色是**线性空间**写入的（CRT 着色器在该阶段之后才做 sRGB 编码）。
 *   写 0.02 在屏幕上约等于 0.15 的显示亮度，别按屏幕值直接填。
 */

const NEBULA_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;

  float hash(vec3 p){
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; }
    return s;
  }

  void main(){
    // equirect：u → 经度，v → 纬度
    float lon = (vUv.x - 0.5) * 6.2831853;
    float lat = (vUv.y - 0.5) * 3.1415926;
    vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

    float c  = fbm(dir * 2.2);
    float c2 = fbm(dir * 7.7 + 11.0);
    float grain = fbm(dir * 26.0);

    float band = smoothstep(0.26, 0.78, c * 0.80 + c2 * 0.42);
    vec3 deep  = vec3(0.0040, 0.0055, 0.0080);
    vec3 cloud = mix(vec3(0.0190, 0.0250, 0.0300), vec3(0.0380, 0.0315, 0.0264), c2);
    vec3 col = mix(deep, cloud, band * 0.9);

    // 细颗粒：让背景像照片而不像渐变（"脏"与"有质感"的差别主要在这一层）
    col *= 0.45 + 1.05 * grain;

    // 极淡的暖调偏移，避免整片死蓝
    col = mix(col, col * vec3(1.06, 1.00, 0.94), 0.55);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const BAKE_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export interface NebulaOptions {
  /** 烘焙分辨率（宽）。默认 1024；高度取一半 */
  width?: number;
}

/**
 * 烘焙一次星云，返回可作 `scene.background` 的纹理。
 * 失败（上下文丢失等）返回 null —— 调用方应保持原纯色背景，不要抛。
 */
export function createNebulaTexture(
  renderer: THREE.WebGLRenderer,
  opts: NebulaOptions = {},
): THREE.Texture | null {
  const w = Math.max(64, Math.floor(opts.width ?? 1024));
  const h = Math.max(32, Math.floor(w / 2));
  let rt: THREE.WebGLRenderTarget | null = null;
  let scene: THREE.Scene | null = null;
  let cam: THREE.OrthographicCamera | null = null;
  try {
    rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    scene = new THREE.Scene();
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: BAKE_VERT,
      fragmentShader: NEBULA_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    scene.add(quad);

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);

    // 烘焙用的临时对象立刻释放，只留下 RT 的纹理
    quad.geometry.dispose();
    mat.dispose();

    const tex = rt.texture;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  } catch (err) {
    console.warn('[battleBackdrop] 星云烘焙失败，退回纯色背景:', err);
    rt?.dispose();
    return null;
  } finally {
    // scene / cam 是纯 JS 对象，无需释放；几何与材质已在上方释放
    scene = null;
    cam = null;
  }
}
