import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { useSettingsStore } from '../../store/settingsStore';

// ============================================================
// Three.js 战略星图渲染器（完整移植桌面 demo 细节）
// 星球错位 / 大陆纹理 / 星系行星 / 12女神首饰 / 要塞 / 费沙卫星
// 驻留舰队 / 跃迁门 / 星云 / 星空分层 / 星芒十字 / 全息穹顶 / 小地图
// ============================================================

// 坐标映射（动态计算边界，适配游戏实际节点坐标范围）
const SCALE = 0.03;
let CX = (-2378 + 1905) / 2;
let CY = (-435 + 1485) / 2;
let WORLD_W = (1905 - (-2378)) * SCALE;
let WORLD_H = (1485 - (-435)) * SCALE;
const MIN_NODE_SCALE = 0.02;  // 若地图过大，进一步缩小避免星球间距失控

// ===== 阿凡达全息沙盘坐标系 =====
// 指挥官站在桌边俯视：发光桌面在下方，战略星图悬浮在桌面之上（光柱立体版图）
const TABLE_Y = -5.2;   // 发光全息桌面高度（托盘/桌面位于此）
const HOLO_Y = 1.6;     // 星球悬浮带中心高度（星球中心大致悬于此）
const HOLO_SPAN = 2.6;  // 星球上下错落幅度（±1.3，形成立体层次，避免平铺在同一平面）

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(w: number, h: number, cell: number, seed: number) {
  const rnd = mulberry32(seed);
  const cw = Math.ceil(w / cell) + 2, ch = Math.ceil(h / cell) + 2;
  const grid: number[] = [];
  for (let i = 0; i < cw * ch; i++) grid.push(rnd());
  const get = (gx: number, gy: number) => grid[gy * cw + gx];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    const fx = (x - gx * cell) / cell, fy = (y - gy * cell) / cell;
    const a = get(gx, gy), b = get(gx + 1, gy), c = get(gx, gy + 1), d = get(gx + 1, gy + 1);
    const u = smooth(fx), v = smooth(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// 大陆纹理：透明背景 + 大块大陆斑块（低频噪声）
function makeContinentalTex(seed: number, rgb: [number, number, number], w = 256, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  const cell1 = Math.max(20, Math.round(w / 6));
  const cell2 = Math.max(8, Math.round(w / 16));
  const n1 = valueNoise2D(w, h, cell1, seed + 31);
  const n2 = valueNoise2D(w, h, cell2, seed + 71);
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const latW = 0.7 + Math.sin((y / h) * Math.PI) * 0.3;
    for (let x = 0; x < w; x++) {
      const v = (n1(x, y) * 0.78 + n2(x, y) * 0.22) * latW;
      const i = (y * w + x) * 4;
      if (v > 0.5) {
        const a = Math.min(1, (v - 0.5) * 2.8);
        img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2];
        img.data[i + 3] = Math.round(a * 255);
      } else {
        img.data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

// 云层纹理（半透明白色噪点）
function makeCloudTex(seed: number): THREE.CanvasTexture {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const n1 = valueNoise2D(W, H, 40, seed + 333);
  ctx.clearRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const v = n1(x, y);
    if (v > 0.55) {
      ctx.fillStyle = `rgba(255,255,255,${(v - 0.55) * 0.6})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return new THREE.CanvasTexture(c);
}

// 走廊导流虚线纹理（平行虚线 + 箭头，随 texture.offset 流动）
function makeCorridorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  // 上下两条平行虚线
  for (const y of [14, 50]) {
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 14]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  // 中央箭头
  ctx.fillStyle = 'rgba(180, 240, 255, 0.7)';
  ctx.beginPath();
  ctx.moveTo(248, 32);
  ctx.lineTo(228, 24);
  ctx.lineTo(228, 40);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

function makeGlowTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, `rgba(${color},0.8)`);
  g.addColorStop(0.35, `rgba(${color},0.2)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const makeCircleParticleTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// 星芒十字纹理（十字光刺）
function makeStarCrossTex(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  const core = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 10);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(S / 2, S / 2, 10, 0, Math.PI * 2); ctx.fill();
  for (const [ang, len] of [[0, S * 0.42], [Math.PI / 2, S * 0.42], [Math.PI, S * 0.42], [Math.PI * 1.5, S * 0.42]]) {
    const g = ctx.createLinearGradient(S / 2 + Math.cos(ang) * 6, S / 2 + Math.sin(ang) * 6,
      S / 2 + Math.cos(ang) * len, S / 2 + Math.sin(ang) * len);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(ang) * 6, S / 2 + Math.sin(ang) * 6);
    ctx.lineTo(S / 2 + Math.cos(ang) * len, S / 2 + Math.sin(ang) * len);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

// 星云纹理（噪声 + 径向柔化）
function makeNebulaTex(seed: number, hue: [number, number, number]): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  const noise = valueNoise2D(S, S, 32, seed + 7);
  const img = ctx.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = noise(x, y);
    if (v > 0.52) {
      const i = (y * S + x) * 4;
      const a = (v - 0.52) * 1.4;
      img.data[i] = hue[0]; img.data[i + 1] = hue[1]; img.data[i + 2] = hue[2];
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const rg = ctx.createRadialGradient(S / 2, S / 2, S * 0.15, S / 2, S / 2, S * 0.6);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = rg; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// 势力配色方案（可切换，费沙保持琥珀金不变）
import { FACTION_SCHEMES, type FactionSchemeKey } from '../../config/factionThemes';

// 阵营配色（可变，根据 settingsStore 的方案切换；费沙 = 琥珀金不变）
const FAC_COLOR: Record<number, { main: number; glow: string; cont: [number, number, number] }> = {
  1: { main: 0x2dd4bf, glow: '45,212,191', cont: [45, 212, 191] },
  2: { main: 0xc084fc, glow: '192,132,252', cont: [192, 132, 252] },
  0: { main: 0xfbbf24, glow: '251,191,36', cont: [251, 191, 36] },
};

// ===== 宇宙模式视觉可调参数（目视微调用，改动此处即可重刷观感）=====
// 目标：星球更实、势力边界更淡更透（边界弱于星球，让星球主体凸显）。
// 星球大陆球体不透明度（原 0.85 太透明看不清 → 调实）
const PLANET_CONT_OPACITY = 0.95;
// 势力边界 metaball 底色 alpha 系数（原 0.12 太浓盖过星球 → 调淡）
const BOUNDARY_BASE_ALPHA = 0.06;
// 边界边缘发光 alpha 系数（原 0.08）
const BOUNDARY_EDGE_ALPHA = 0.04;
// 边界等高线波纹 alpha 系数（原 0.05）
const BOUNDARY_WAVE_ALPHA = 0.03;
// 边界颜色去饱和程度（0=原色，1=完全灰；越大越低饱和越低调）
const BOUNDARY_DESAT = 0.55;

// 应用配色方案（费沙不动）
function applyFactionScheme(key: FactionSchemeKey) {
  const s = FACTION_SCHEMES.find((x) => x.key === key) || FACTION_SCHEMES[0];
  FAC_COLOR[1] = s.ally;
  FAC_COLOR[2] = s.empire;
}
const hexToRgb = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

export interface ThreeStrategicMapOptions {
  onNodeClick?: (nodeId: number) => void;
  onFleetClick?: (fleetId: number) => void;
  onNodeContextMenu?: (nodeId: number, screenX: number, screenY: number) => void;
  minimapEl?: HTMLElement | null;   // 小地图容器（可选）
  topViewBtnEl?: HTMLElement | null; // 俯视按钮
  // 是否处于暂停态（用于触发"暂停自动回正 + 微浮动"）。可选，缺省视为未暂停
  isStrategicPaused?: () => boolean;
  // 是否启用 3D 悬浮板（锚桩 + 光柱）。宇宙模式关掉即不创建；悬浮板模式开启
  enableHoloBoards?: boolean;
  // 3D 悬浮信息板锚点：每帧回传锚点在屏幕上的位置，供 Vue 面板"贴"在托盘角落
  // 新版新增 rotX/rotY：面板相对相机的三维偏转角（度），Vue 用 CSS perspective+rotateX/rotateY 呈现
  // 侧向 3D 效果 —— 旋转视角时板随地图侧转出立体感，暂停回正后板面正对玩家
  // 兼容性新增字段（不删旧字段）：
  //   z     —— 锚点到相机的距离（世界单位）：离相机近值小 → Vue 用它算 zIndex 做 3D 深度遮挡排序
  //   scale —— 相对基准距离的缩放比（>1 相机近、板放大；<1 缩远）。Vue 用它动态调板尺寸，避免地图放大时框过小
  onHoloBoardAnchor?: (key: string, screen: { x: number; y: number; rotX: number; rotY: number; visible: boolean; z?: number; scale?: number }) => void;
}

export class ThreeStrategicMap {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private container: HTMLElement;
  private opts: ThreeStrategicMapOptions;

  private nodeMeshes = new Map<number, THREE.Object3D>();
  private nodeGlows = new Map<number, THREE.Sprite>();
  private nodeLabels = new Map<number, CSS2DObject>();
  // 阿凡达全息沙盘：每个星系一根从桌面升起的发光光柱（挂 scene，避免随星球自转）
  private holoPillars = new Map<number, THREE.Mesh>();
  private orbiters = new Map<number, { sat: THREE.Object3D; r: number; incX: number; incZ: number; phase0: number; speed: number }[]>();
  private stationShips = new Map<number, { group: THREE.Group; shipColor: number; engineColor: number; orbitR: number; seed: number; ships: any[]; rnd: () => number; shared: any }>();
  private gateGroups: { group: THREE.Group; flash: THREE.Mesh; flashMat: THREE.MeshBasicMaterial; phase: number; period: number; scale: number; structMat: THREE.MeshBasicMaterial; channelMat: THREE.MeshBasicMaterial }[] = [];
  private twinkles: { spr: THREE.Sprite; phase: number; speed: number; base: number; amp: number }[] = [];
  private nebulas: { group: THREE.Group; bx: number; by: number; bz: number; ax: number; az: number; ox: number; oz: number; subs: { spr: THREE.Sprite; px: number; py: number; pz: number; ax: number; az: number; ph: number; spd: number; base: number; amp: number; bs: number; sa: number }[] }[] = [];
  private edgePulses: { line: THREE.Line; t: number; speed: number; mat: THREE.LineBasicMaterial }[] = [];
  private edgeFlows: { curve: THREE.CatmullRomCurve3; mesh: THREE.Mesh; geom: THREE.BufferGeometry; t: number; speed: number; dir: number }[] = [];
  private edgePathPool: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private _flowUp = new THREE.Vector3(0, 1, 0);
  private _flowN = new THREE.Vector3();
  private _flowT = new THREE.Vector3();
  // 3D 悬浮信息板：key -> { anchor (锚桩), baseY }。anchor 挂 scene 作位置锚桩；
  // 每帧把 anchor 的世界坐标投影成屏幕坐标回传给 Vue，Vue 板用锚点定位 + 自身 3D transform
  // 呈现"垂直立在托盘边缘、随相机侧转"的立体观感（稳定方案，不依赖 CSS3DRenderer）。
  private holoBoardAnchors = new Map<string, { anchor: THREE.Object3D; baseY: number }>();
  // 锚点微浮动用的时间累积（用 this.clock.elapsedTime 亦可，单独存避免歧义）
  private _holoDist = new THREE.Vector3();
  private _holoFrom = new THREE.Vector3();
  private _flowP0 = new THREE.Vector3();
  private _flowP1 = new THREE.Vector3();
  private fleetGroup: THREE.Group;
  private fleetMeshes = new Map<number, { mesh: THREE.Object3D; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; etaEl: HTMLDivElement | null; etaObj: CSS2DObject | null }>();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private clock = new THREE.Clock();
  private store: any;
  private prevNodeOwnership = new Map<number, number>();
  private prevMapVersion = -1;
  private disposed = false;
  private cameraTween: any = null;
  private nodeCache: { id: number; x: number; z: number; fac: number; type: string; name: string }[] = [];
  private mmCanvas: HTMLCanvasElement | null = null;
  private mmCtx: CanvasRenderingContext2D | null = null;
  private currentFocus: number | null = null;
  private isTopView = false;
  private minimapHidden = false;
  // 后处理管线
  private composer: EffectComposer;
  private crtPass: ShaderPass;
  // 视差深空背景层（极远星系/暗星云，随相机反向微移）
  private parallaxGroup = new THREE.Group();
  private farGalaxyGroup = new THREE.Group();
  // 势力范围光幕（模块二，无界势能场）
  private factionBoundaryGroup = new THREE.Group();
  private factionFields: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  // 要塞雷达波纹（模块三）
  private radarRings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number; phase: number; period: number }[] = [];
  // 走廊导流光带（模块三）
  private corridorFlows: { tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; tube: THREE.Mesh }[] = [];
  // 动态深空背景（Shader 层 + uTime）
  private bgPlane: THREE.Mesh | null = null;
  private bgMat: THREE.ShaderMaterial | null = null;
  // 阿凡达全息桌面（Shader + uTime 呼吸光环）
  private tableMat: THREE.ShaderMaterial | null = null;
  // 鼠标视差（俯视沙盘整体随鼠标轻微偏移，增强立体感）
  private mouseParallax = new THREE.Vector2();
  private targetParallax = new THREE.Vector2();
  private playerFaction: 'alliance' | 'empire' | 'generic' = 'generic';
  // 战略星图显示模式：'universe' 宇宙模式（无悬浮板，纯星际状态）；'holo' 悬浮板（三维竖牌随地图侧转）
  private displayMode: 'universe' | 'holo' = 'holo';

  // ===== 暂停自动回正 + 微漂浮（信息板三维感核心）=====
  // 玩家手动暂停时，相机以缓速 tween 回正到"正对悬浮星图"的默认俯视视角，
  // 回正后锚点叠加微小 sin 浮动，让悬浮板"活着"。恢复时请求退出回正（由玩家环绕接管）。
  private recenterActive = false;     // 当前是否处于"正在回正"
  private recenterHold = false;       // 回正完成后是否停留在"回正+微漂浮"状态
  private recenterTween: { startP: THREE.Vector3; startT: THREE.Vector3; start: number; dur: number } | null = null;
  private viewBase = new THREE.Vector3(); // 回正后的默认相机位置（动态估算）
  private homeCam = new THREE.Vector3();   // "正对玩家"的位置缓存（建立于首次后，回正用）
  private holoBeams: { key: string; mat: THREE.LineBasicMaterial; geom: THREE.BufferGeometry; base: THREE.Vector3 }[] = []; // 板→桌角 细线光柱（每根关联锚点）
  private holoBoardBoxes: { botL: THREE.Object3D; botR: THREE.Object3D } | null = null;

  constructor(container: HTMLElement, store: any, opts: ThreeStrategicMapOptions = {}) {
    this.container = container;
    this.store = store;
    this.opts = opts;
    this.displayMode = opts.enableHoloBoards === false ? 'universe' : 'holo';

    // 应用势力配色方案（从设置读取，持久化）
    const settingsStore = useSettingsStore();
    applyFactionScheme((settingsStore.factionColorScheme as unknown as FactionSchemeKey) || 'default');
    // 玩家阵营（决定舷窗边线与光锥配色）
    const pAdmId = store.playerAdmiralId?.value !== undefined ? store.playerAdmiralId.value : (store.playerAdmiralId ?? null);
    const pAdm = (store.allAdmirals || []).find((a: any) => a.id === pAdmId);
    this.playerFaction = pAdm?.faction === 'empire' ? 'empire' : pAdm?.faction === 'alliance' ? 'alliance' : 'generic';

    // 动态计算地图边界（从实际节点数据）
    const rawNodes = store.strategicNodes;
    const initNodes = rawNodes?.value !== undefined ? rawNodes.value : (rawNodes || []);
    if (initNodes.length) {
      const xs = initNodes.map((n: any) => n.x);
      const ys = initNodes.map((n: any) => n.y);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      CX = (xMin + xMax) / 2;
      CY = (yMin + yMax) / 2;
      WORLD_W = (xMax - xMin) * SCALE;
      WORLD_H = (yMax - yMin) * SCALE;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);   // 极暗 fallback（动态 Shader 背景层在其上）

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 800);
    const camDist = Math.max(WORLD_W, WORLD_H) * 1.35;
    // 阿凡达全息沙盘视角：指挥官站在桌边向下俯视悬浮星图
    // 相机较高 → 俯视悬浮的星图；z 前移 → 桌面/光柱有真实纵深，文字不压扁
    this.camera.position.set(0, camDist * 0.62, camDist * 0.92);
    this.camera.lookAt(0, HOLO_Y, 0);   // 注视悬浮星球带中心，而非桌面

    // 动态深空背景（Shader 层挂在相机，uTime 驱动双阵营暗场流动 + 中央战云扰动）
    this.scene.add(this.camera);
    this.buildDynamicBackground();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minDistance = 6;
    this.controls.maxDistance = Math.max(WORLD_W, WORLD_H) * 4;

    // ===== 后处理管线：泛光 + 全息 CRT（扫描线/暗角/色差/微噪点） =====
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth * 0.5, container.clientHeight * 0.5),
      0.38,   // strength（降低：避免整张地图被辉光糊住）
      0.4,    // radius
      0.52,   // threshold（提高：只高亮星芒/光柱发光，势力板/桌面不再泛白）
    );
    this.composer.addPass(bloomPass);
    this.crtPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec2 uResolution;
        varying vec2 vUv;
        void main(){
          vec2 uv = vUv;
          // 色差（Chromatic Aberration）：径向极轻微 RGB 分离
          vec2 center = uv - 0.5;
          float dist = length(center);
          float ca = dist * 0.004;
          vec2 dir = center / max(dist, 0.001);
          vec3 col;
          col.r = texture2D(tDiffuse, uv - dir * ca).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv + dir * ca).b;
          // 暗角（Vignette）
          float vig = smoothstep(0.9, 0.3, dist * 1.4);
          col *= mix(0.72, 1.0, vig);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.composer.addPass(this.crtPass);

    this.fleetGroup = new THREE.Group();
    this.scene.add(this.fleetGroup);

    // 宇宙背景：星星点点 + 彩色气团（必须先于其他 UI 构建）
    this.buildBackground();
    // 阿凡达全息沙盘：桌面光效由 buildBackground 的矩形托盘承载（已移除冗余圆形托盘）
    this.initMinimap();
    this.bindInteraction();
    this.bindTopView();
    this.buildHoloBoardAnchors();

    const anim = () => {
      if (this.disposed) return;
      requestAnimationFrame(anim);
      this.update();
    };
    requestAnimationFrame(anim);
  }

  private worldX(x: number) { return (x - CX) * SCALE; }
  private worldZ(y: number) { return (y - CY) * SCALE; }

  // ============ 小地图 ============
  private initMinimap() {
    const el = this.opts.minimapEl;
    if (!el) return;
    this.mmCanvas = document.createElement('canvas');
    this.mmCanvas.width = 260; this.mmCanvas.height = 180;
    this.mmCanvas.style.width = '100%'; this.mmCanvas.style.height = '100%';
    el.appendChild(this.mmCanvas);
    this.mmCtx = this.mmCanvas.getContext('2d');
    // 小地图点击跳转
    this.mmCanvas.addEventListener('click', (e) => {
      const rect = this.mmCanvas!.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * 260;
      const py = (e.clientY - rect.top) / rect.height * 180;
      const mmPad = 14;
      const mmScale = Math.min((260 - mmPad * 2) / WORLD_W, (180 - mmPad * 2) / WORLD_H);
      const wx = (px - 130) / mmScale, wz = (py - 90) / mmScale;
      let nearest: any = null, minD = Infinity;
      for (const n of this.nodeCache) {
        const d = Math.hypot(n.x - wx, n.z - wz);
        if (d < minD) { minD = d; nearest = n; }
      }
      if (nearest && minD < 6) this.flyToNode(nearest.id);
    });
    this.drawMinimap();
  }

  private drawMinimap(highlightId: number | null = null) {
    if (!this.mmCtx || !this.mmCanvas) return;
    const ctx = this.mmCtx;
    const mmPad = 14;
    const mmScale = Math.min((260 - mmPad * 2) / WORLD_W, (180 - mmPad * 2) / WORLD_H);
    const mmX = (wx: number) => 130 + wx * mmScale;
    const mmY = (wz: number) => 90 + wz * mmScale;
    ctx.clearRect(0, 0, 260, 180);
    ctx.fillStyle = 'rgba(2,8,16,1)';
    ctx.fillRect(0, 0, 260, 180);
    ctx.strokeStyle = 'rgba(0,204,102,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, 256, 176);
    // 航线
    this.nodeCache.forEach((n) => {
      const src = this.getNode(n.id);
      (src?.connections || []).forEach((cid: number) => {
        const tgt = this.getNode(cid);
        if (!tgt) return;
        ctx.strokeStyle = 'rgba(0,204,102,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mmX(n.x), mmY(n.z));
        ctx.lineTo(mmX(this.worldX(tgt.x)), mmY(this.worldZ(tgt.y)));
        ctx.stroke();
      });
    });
    // 节点
    this.nodeCache.forEach((n) => {
      const px = mmX(n.x), py = mmY(n.z);
      const isCap = n.type === 'capital';
      const isFocus = n.id === highlightId;
      const col = n.fac === 1 ? '45,212,191' : (n.fac === 2 ? '192,132,252' : '251,191,36');
      if (isFocus) {
        ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,0,0.3)';
        ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,0,0.9)';
        ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${col},${isCap ? 0.3 : 0.15})`;
      ctx.arc(px, py, isCap ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = `rgba(${col},0.95)`;
      ctx.arc(px, py, isCap ? 2.2 : 1.5, 0, Math.PI * 2);
      ctx.fill();
      if (isCap) {
        ctx.strokeStyle = `rgba(${col},0.7)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 4, py - 4, 8, 8);
      }
    });
    // 首都名
    [14, 56].forEach((id) => {
      const n = this.getNode(id);
      if (!n) return;
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = 'rgba(0,255,136,0.7)';
      ctx.fillText(n.name, mmX(this.worldX(n.x)) + 5, mmY(this.worldZ(n.y)) - 4);
    });
  }

  private flyToNode(nodeId: number) {
    const n = this.getNode(nodeId);
    if (!n) return;
    this.currentFocus = nodeId;
    this.drawMinimap(nodeId);
    const endTarget = new THREE.Vector3(this.worldX(n.x), 0, this.worldZ(n.y));
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const dir = new THREE.Vector3().subVectors(startPos, startTarget).normalize();
    const dist = 14;
    const endPos = endTarget.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, 8, 0));
    this.cameraTween = { start: performance.now(), dur: 800, startPos, endPos, startTarget, endTarget };
  }

  private bindTopView() {
    const btn = this.opts.topViewBtnEl;
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isTopView = !this.isTopView;
      if (this.isTopView) {
        this.controls.maxPolarAngle = Math.PI / 2;
        this.camera.position.set(0, 55, 0.01);
        this.controls.target.set(0, 0, 0);
      } else {
        // 顶视取消 → 回到俯视悬浮星图（用 WORLD 尺寸动态计算）
        const camDist2 = Math.max(WORLD_W, WORLD_H);
        this.controls.maxPolarAngle = Math.PI * 0.45;
        this.camera.position.set(0, camDist2 * 0.62, camDist2 * 0.92);
        this.controls.target.set(0, HOLO_Y, 0);
      }
      this.controls.update();
    });
  }

  // ============ 3D 悬浮信息板锚点（四个角落的全息竖牌，垂直托盘、随地图侧转） ============
  // 用不可见 Object3D 作为"锚桩"，钉在桌面矩形的四个角（板底支撑点，贴近桌面）。
  // 竖牌朝向：板面法线为 +Z（正对玩家默认视角），从锚点向上立起一块垂直于托盘的透明全息屏。
  // 每帧把锚点世界坐标投影成屏幕坐标 + 依相机视线算出板面 rotX/rotY，回传给 Vue；
  // Vue 板用 left/top 定位 + 自身 CSS perspective/rotateX/rotateY 呈现真实 3D 立牌侧转感。
  // 内容由 Vue 模板承载（响应式、可交互），Engine 只负责"把它立在哪儿、面朝哪"。
  private buildHoloBoardAnchors() {
    if (!this.opts.onHoloBoardAnchor && !this.opts.enableHoloBoards) return;
    const maxDim = Math.max(WORLD_W, WORLD_H);
    const trayScale = maxDim * 0.82;
    const bw = trayScale, bh = trayScale * (WORLD_H / WORLD_W);
    // 竖牌底支撑点高度：贴近桌面顶部（板"立"在桌沿，而非悬浮在高空）→ 解决"上下距离"问题
    const Y = TABLE_Y + 0.5;
    // 四角信息屏组（锚桩世界坐标：x/z 定在托盘四角上沿，y 为板底支撑点）
    //   顶部导航 nav 不在此（独立为屏幕顶部固定条，两种模式都常驻）
    //   brie  左上：军情简报
    //   radar 右上：战术雷达
    //   minimap 右下：小地图
    //   roster 左下：提督名册/关系网入口（可交互）
    const anchors: Record<string, [number, number, number]> = {
      brie: [-bw * 0.84, Y, bh * 0.24],
      radar: [bw * 0.84, Y, bh * 0.24],
      minimap: [bw * 0.70, Y, -bh * 0.70],
      roster: [-bw * 0.70, Y, -bh * 0.70],
    };
    // 光柱落点（垂直下落）：取锚点正下方桌面（与锚点同 x/z，y=TABLE_Y）——不再斜连到桌角。
    // 每帧 update 把柱顶（顶点1/2）设到锚点实时高度，底部固定 → 形成"从板底正下方竖直下落到桌面"的支撑光柱。
    Object.entries(anchors).forEach(([key, pos]) => {
      const anchor = new THREE.Object3D();
      anchor.position.set(pos[0], pos[1], pos[2]);
      this.scene.add(anchor);
      // baseY 为板底支撑点高度（浮动/bob 以它为中心）
      this.holoBoardAnchors.set(key, { anchor, baseY: pos[1] });

      // 细线光柱（垂直）：底=锚点正下方桌面(TABLE_Y, 同 x/z)，顶=锚点当前位置（每帧贴合板底）
      const base = new THREE.Vector3(pos[0], TABLE_Y, pos[2]);
      const beamMat = new THREE.LineBasicMaterial({ color: key === 'radar' ? 0x22d3ee : 0x00cc66, transparent: true, opacity: 0.4 });
      const beamGeom = new THREE.BufferGeometry().setFromPoints([base, base, anchor.position.clone()]);
      const beam = new THREE.Line(beamGeom, beamMat);
      beam.frustumCulled = false;
      this.scene.add(beam);
      this.holoBeams.push({ key, mat: beamMat, geom: beamGeom, base: base.clone() });
    });
  }

  // 设置战略星图显示模式：'universe' 宇宙（无悬浮板，纯星际）/ 'holo' 悬浮板（三维竖牌）
  public setDisplayMode(mode: 'universe' | 'holo') {
    this.displayMode = mode;
    // 宇宙模式：隐藏所有光柱；悬浮板模式：恢复
    this.holoBeams.forEach((b) => { b.mat.opacity = mode === 'holo' ? 0.3 : 0; });
  }

  // 每帧投影锚点到屏幕坐标（位置跟随 + 真实 3D 竖牌朝向 + 微浮动），回传给 Vue
  private updateHoloBoardAnchors() {
    if (this.displayMode === 'universe') {
      // 宇宙模式：无悬浮板，直接清空光柱可见性，不驱动板
      this.holoBeams.forEach((b) => { b.mat.opacity = 0; });
      return;
    }
    if (!this.opts.onHoloBoardAnchor && !this.opts.enableHoloBoards) return;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const t = this.clock.elapsedTime;
    // 暂停（用户手动暂停）→ 触发相机回正
    const paused = !!this.opts.isStrategicPaused?.();
    this.updatePauseRecenter(paused, t);

    // 每块板：锚点投影回传坐标 + 板面朝向角度（Vue 用它做 left/top/rotX/rotY）
    this.holoBoardAnchors.forEach((entry, key) => {
      const { anchor, baseY } = entry;
      // —— 微浮动：暂停且回正完成后，锚点叠加微小 sin 浮动（只改 y，让板"活着"）——
      if (anchor.userData.bx === undefined) { anchor.userData.bx = anchor.position.x; anchor.userData.bz = anchor.position.z; }
      let fy = 0;
      if (this.recenterHold && paused) {
        const ph = (key === 'brie' ? 0 : key === 'radar' ? 1.7 : key === 'minimap' ? 3.0 : key === 'roster' ? 4.4 : 5.5);
        fy = Math.sin(t * 0.7 + ph) * 0.14;
      }
      anchor.position.y = baseY + fy;

      const worldPos = anchor.getWorldPosition(this._holoFrom);

      // —— 光柱：柱顶贴到板底锚点实时高度 + 透明度呼吸 ——
      this.holoBeams.forEach((b) => {
        if (b.key !== key) return;
        const posAttr = b.geom.attributes.position as THREE.BufferAttribute;
        posAttr.setXYZ(1, worldPos.x, worldPos.y, worldPos.z);
        posAttr.setXYZ(2, worldPos.x, worldPos.y, worldPos.z);
        posAttr.needsUpdate = true;
        b.mat.opacity = 0.3 + Math.sin(t * 1.6 + key.length) * 0.1;
      });

      // —— 竖牌三维朝向：板面法线(+Z) vs 相机视线 → rotX/rotY（Vue 用 CSS 立牌呈现）——
      // 回正状态下：rotX/rotY≈0（板面正对玩家）；环绕/缩放时板随地图真实侧转
      this._holoDist.subVectors(this.camera.position, this._holoFrom).normalize();
      let rotY = 0, rotX = 0;
      if (!this.recenterHold) {
        // 板面法线固定世界 +Z；算它相对视线方向绕 Y / X 的偏转角
        rotY = Math.atan2(this._holoDist.x, this._holoDist.z);
        rotX = Math.atan2(-this._holoDist.y, Math.hypot(this._holoDist.x, this._holoDist.z));
        // 钳制（还原真实侧转力度，避免极端角度）
        rotY = THREE.MathUtils.clamp(rotY * 180 / Math.PI, -42, 42);
        rotX = THREE.MathUtils.clamp(rotX * 180 / Math.PI, -30, 30);
      }
      // 基础立牌后仰角度：让板默认微微仰向玩家（立牌感）——叠加到 rotX
      const baseTilt = 16;   // 板面默认上仰 16°（面朝玩家、立在桌面）
      const finalRotX = rotX + baseTilt;

      // —— 深度 z / 缩放 scale：距相机近的板 z-index 更大（遮挡远的板）、尺寸适度放大 ——
      // 基准距离取该板锚点与实际相机距离在"回到最近锚点"与"默认俯瞰距离"之间的映射。
      //   距离越近（相机贴近地图）→ z 越大（画在前）且 scale 越大（放大可读）；越远 → 反之。
      // 默认俯瞰基准：用世界长边 × 1.4 作为"标准近"距离（此时 scale≈1.0，尺寸为基准）。
      const distToCam = this.camera.position.distanceTo(worldPos);
      const baseDist = Math.max(WORLD_W, WORLD_H) * 1.4;
      // scale：相对基准（1.0）。相机拉近时 distToCam 变小 → scale >1 变大；拉远 → <1 变小。
      const scale = THREE.MathUtils.clamp(baseDist / distToCam, 0.65, 1.5);
      // zDepth：用一个较大的基础值扣掉归一化距离，离相机近（distToCam 小）⇒ zDepth 大 ⇒ z-index 高。
      const zDepth = THREE.MathUtils.clamp((baseDist / distToCam) * 100, 1, 200);

      // 投影到屏幕坐标回传给 Vue（Vue 板用锚点定位 + 该角度呈现 3D 立牌）
      const proj = worldPos.clone().project(this.camera);
      const visible = proj.z < 1 && proj.z > -1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      this.opts.onHoloBoardAnchor!(key, { x: sx, y: sy, rotX: finalRotX, rotY, visible, z: zDepth, scale });
    });
  }

  // 暂停 → 相机缓速回正（玩家视角），回正后叠加微浮动；恢复播放 → 退出回正让玩家接管
  private updatePauseRecenter(paused: boolean, t: number) {
    if (paused && !this.recenterActive) {
      // 触发回正：从当前相机位置缓速 tween 到"正对悬浮星图"的默认俯视视角
      this.recenterActive = true;
      this.recenterHold = false;
      const camDist = Math.max(WORLD_W, WORLD_H) * 1.35;
      this.viewBase.set(0, camDist * 0.62, camDist * 0.92); // 回正后的默认相机位
      this.homeCam.set(0, HOLO_Y, 0);                        // 回正后的注视目标（悬浮星图中心）
      this.recenterTween = {
        startP: this.camera.position.clone(),
        startT: this.controls.target.clone(),
        start: performance.now(),
        dur: 1400,
      };
    }
    if (!paused && this.recenterActive) {
      // 玩家恢复/环绕 → 退出回正状态（不做 tween 瞬切，交由 controls 接管）
      this.recenterActive = false;
      this.recenterHold = false;
      this.recenterTween = null;
    }
    // 执行回正 tween
    if (this.recenterActive && this.recenterTween) {
      const tt = Math.min(1, (performance.now() - this.recenterTween.start) / this.recenterTween.dur);
      const e = 1 - Math.pow(1 - tt, 3);
      this.camera.position.lerpVectors(this.recenterTween.startP, this.viewBase, e);
      this.controls.target.lerpVectors(this.recenterTween.startT, this.homeCam, e);
      if (tt >= 1) {
        this.recenterTween = null;
        this.recenterHold = true; // 回正完成 → 进入微浮动模式
      }
    }
  }

  // ============ 动态深空背景（径向渐变 + 双阵营暗场 + 中央战云扰动，uTime 驱动） ============
  private buildDynamicBackground() {
    // 双阵营偏色从当前配色方案读取（转暗色，明度约 8~12%）
    const allyC = FAC_COLOR[1].cont, empC = FAC_COLOR[2].cont;
    const allyVec = new THREE.Vector3(allyC[0] / 255 * 0.18, allyC[1] / 255 * 0.18, allyC[2] / 255 * 0.18);
    const empVec = new THREE.Vector3(empC[0] / 255 * 0.18, empC[1] / 255 * 0.18, empC[2] / 255 * 0.18);
    this.bgMat = new THREE.ShaderMaterial({
      depthWrite: false, depthTest: false,
      uniforms: { uTime: { value: 0 }, uAlly: { value: allyVec }, uEmpire: { value: empVec } },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uAlly;
        uniform vec3 uEmpire;
        void main(){
          vec2 center = vUv - 0.5;
          float dist = length(center);
          // 径向渐变：中心冷墨青灰 → 四周极暗海蓝
          float vig = 1.0 - smoothstep(0.0, 0.7, dist);
          vec3 base = mix(vec3(0.008, 0.016, 0.039), vec3(0.043, 0.082, 0.157), vig);
          // 双阵营偏色：左同盟 / 右帝国（随配色方案），中央中立暗区
          float fmix = smoothstep(0.25, 0.75, vUv.x);
          float fstrength = 1.0 - smoothstep(0.1, 0.5, abs(center.x));
          vec3 faction = mix(uAlly, uEmpire, fmix) * fstrength * 0.6;
          // 中央战云扰动（暗流涌动，缓慢流动）
          float war = sin(vUv.y * 12.0 - uTime * 0.25) * sin(center.x * 4.0 + uTime * 0.15);
          float cloud = smoothstep(0.3, 0.0, abs(center.x)) * war * 0.04;
          vec3 col = base + faction + cloud;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), this.bgMat);
    this.bgPlane.position.set(0, 0, -600);   // 相机前方极远，覆盖全屏
    this.bgPlane.frustumCulled = false;
    this.camera.add(this.bgPlane);           // 挂相机 → 始终面向镜头
  }

  // ============ 极远星系层（低饱和银河旋臂/星系核，视差最小） ============
  private buildFarGalaxyLayer() {
    const maxDim = Math.max(WORLD_W, WORLD_H);
    const R = maxDim * 2.4;   // 极远距离
    const rnd = mulberry32(20240818);
    // 3~4 个低饱和冷色大星系光雾（仙女座 M31 风格）
    for (let i = 0; i < 4; i++) {
      const hue: [number, number, number] = [
        70 + rnd() * 45, 95 + rnd() * 45, 135 + rnd() * 60,
      ];
      const tex = makeNebulaTex(Math.floor(rnd() * 100000), hue);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const s = R * (0.55 + rnd() * 0.5);
      spr.scale.set(s, s * 0.72, 1);
      const angle = rnd() * Math.PI * 2;
      const dist = R * (0.5 + rnd() * 0.4);
      spr.position.set(Math.cos(angle) * dist, (rnd() - 0.5) * 40, Math.sin(angle) * dist);
      this.farGalaxyGroup.add(spr);
    }
    // 极远稀疏暗星云（更淡，填充深层）
    for (let i = 0; i < 3; i++) {
      const tex = makeNebulaTex(Math.floor(rnd() * 100000), [40, 50, 80]);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const s = R * (0.7 + rnd() * 0.5);
      spr.scale.set(s, s, 1);
      const angle = rnd() * Math.PI * 2;
      const dist = R * (0.3 + rnd() * 0.5);
      spr.position.set(Math.cos(angle) * dist, (rnd() - 0.5) * 50, Math.sin(angle) * dist);
      this.farGalaxyGroup.add(spr);
    }
    // 极远微光恒星（稀疏）
    const starCount = 500;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = R * (0.4 + rnd() * 0.6);
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(2 * rnd() - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) * 0.5;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.farGalaxyGroup.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0x8090b8, size: 0.5, map: makeCircleParticleTex,
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, alphaTest: 0.01, sizeAttenuation: true,
    })));
  }

  // ============ 背景（星星点点 + 彩色气团，宇宙感，性能友好） ============
  private buildBackground() {
    // 视差层挂载：极远星系层 + 中层星云/恒星层
    this.scene.add(this.farGalaxyGroup);
    this.scene.add(this.parallaxGroup);

    // ===== 极远星系层（低饱和银河旋臂/星系核，视差最小） =====
    this.buildFarGalaxyLayer();

    // 星云：每次随机数量/位置（环绕地图外围环带随机分布，打破对称）
    const nebRnd = Math.random;
    const nebCount = 6 + Math.floor(nebRnd() * 3);   // 6-8 个
    const maxDim = Math.max(WORLD_W, WORLD_H);
    const nebulaSpecs: { x: number; z: number; s: number; seed: number; hue: [number, number, number] }[] = [];
    for (let i = 0; i < nebCount; i++) {
      const angle = nebRnd() * Math.PI * 2;                              // 随机角度
      const dist = maxDim * (0.5 + nebRnd() * 0.28);                     // 外围环带 0.5~0.78 倍
      nebulaSpecs.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist * (WORLD_H / WORLD_W),                 // z 按长宽比拉伸
        s: 20 + nebRnd() * 16,                                           // 随机大小
        seed: Math.floor(nebRnd() * 100000),
        hue: [
          70 + nebRnd() * 150,
          80 + nebRnd() * 120,
          150 + nebRnd() * 90,
        ],
      });
    }
    nebulaSpecs.forEach((ns, i) => {
      const k = WORLD_H / 145;
      const rnd = mulberry32(ns.seed + 999);
      const by = -14 + rnd() * 26;   // 随机高度（打破固定的 y 分层）
      const baseSize = ns.s * 2 * k;
      // 每个气团 = 3 个子星云 Sprite 叠加，各自独立流动 → 云气形态不断散开/聚拢（非整块平移）
      const group = new THREE.Group();
      group.position.set(ns.x, by, ns.z);
      const subs: any[] = [];
      const SUB_COUNT = 3;
      for (let s = 0; s < SUB_COUNT; s++) {
        const subTex = makeNebulaTex(ns.seed + s * 17 + 3, [
          ns.hue[0] + (rnd() - 0.5) * 30,
          ns.hue[1] + (rnd() - 0.5) * 20,
          ns.hue[2] + (rnd() - 0.5) * 30,
        ]);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: subTex, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        const size = baseSize * (0.55 + rnd() * 0.5);
        spr.scale.set(size, size, 1);
        // 子气团相对 group 中心偏移
        const px = (rnd() - 0.5) * baseSize * 0.35;
        const py = (rnd() - 0.5) * 6;
        const pz = (rnd() - 0.5) * baseSize * 0.35;
        spr.position.set(px, py, pz);
        group.add(spr);
        subs.push({
          spr, px, py, pz,
          ax: (rnd() - 0.5) * baseSize * 0.18,   // 子气团相对漂移幅度
          az: (rnd() - 0.5) * baseSize * 0.18,
          ph: rnd() * Math.PI * 2,
          spd: 0.1 + rnd() * 0.12,               // 子气团各自速度（不同步 → 形态流动）
          base: 0.1 + rnd() * 0.08,
          amp: 0.06 + rnd() * 0.07,
          bs: size,
          sa: 0.08 + rnd() * 0.1,
        });
      }
      this.parallaxGroup.add(group);
      this.nebulas.push({
        group,
        bx: ns.x, by, bz: ns.z,
        ax: (rnd() - 0.5) * 8, az: (rnd() - 0.5) * 8,   // 整体缓慢漂移（幅度适中）
        ox: rnd() * Math.PI * 2, oz: rnd() * Math.PI * 2,
        subs,
      });
    });

    // 星空 2000（球形分布 → 无矩形轮廓感；尺寸适中）
    const starCount = 2000;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const rndS = mulberry32(4242);
    const R = Math.max(WORLD_W, WORLD_H) * 1.15;   // 球形半径
    const flat = 0.55;                              // Y 压缩（保持扁平但球体轮廓）
    for (let i = 0; i < starCount; i++) {
      const r = R * Math.cbrt(rndS());              // 球内均匀
      const theta = rndS() * Math.PI * 2;
      const phi = Math.acos(2 * rndS() - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) * flat;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      starSizes[i] = rndS() < 0.8 ? 0.3 + rndS() * 0.25 : 0.8 + rndS() * 0.9;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
    this.parallaxGroup.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xbfd4ff, size: 0.3, map: makeCircleParticleTex,
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, alphaTest: 0.01, sizeAttenuation: true,
    })));

    // 星芒十字 8 颗（尺寸随地图比例，带缓慢闪烁）
    const crossTex = makeStarCrossTex();
    const crossRnd = mulberry32(777);
    const k2 = WORLD_H / 58;
    for (let i = 0; i < 8; i++) {
      const crossSpr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: crossTex, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const sz = (0.7 + crossRnd() * 1.2) * k2;
      crossSpr.scale.set(sz, sz, 1);
      // 球形分布（避免矩形轮廓）
      const r = R * (0.7 + crossRnd() * 0.5);
      const theta = crossRnd() * Math.PI * 2;
      const phi = Math.acos(2 * crossRnd() - 1);
      crossSpr.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * flat,
        r * Math.sin(phi) * Math.sin(theta)
      );
      this.parallaxGroup.add(crossSpr);
      this.twinkles.push({ spr: crossSpr, phase: crossRnd() * Math.PI * 2, speed: 0.5 + crossRnd() * 0.7, base: 0.4, amp: 0.4 });
    }

    // 闪烁星 10 颗（星光闪烁，脉动 alpha）
    const twRnd = mulberry32(9999);
    for (let i = 0; i < 10; i++) {
      const twSpr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeCircleParticleTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const s = (0.2 + twRnd() * 0.5) * k2;
      twSpr.scale.set(s, s, 1);
      const r = R * (0.6 + twRnd() * 0.6);
      const theta = twRnd() * Math.PI * 2;
      const phi = Math.acos(2 * twRnd() - 1);
      twSpr.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * flat,
        r * Math.sin(phi) * Math.sin(theta)
      );
      this.parallaxGroup.add(twSpr);
      this.twinkles.push({ spr: twSpr, phase: twRnd() * Math.PI * 2, speed: 0.9 + twRnd() * 1.7, base: 0.25, amp: 0.45 });
    }

    // 全息穹顶已移除：宇宙感由星云气团 + 星空 + 闪烁星承载（几何框太出戏）

    // 托盘（边框 + 刻度 + 网格）：覆盖整个星图视觉范围（星球 + 外围星云气团）
    const trayScale = Math.max(WORLD_W, WORLD_H) * 0.82;
    const bw = trayScale, bh = trayScale * (WORLD_H / WORLD_W);
    const trayY = TABLE_Y;   // 桌面高度（不再是 -4，改为全息桌面基准）
    // 全息桌面：极淡投影底板（无呼吸光圈，不遮挡地图）
    const tableMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main(){
          vec2 c = vUv - 0.5;
          float d = length(c);
          // 中央到边缘极淡渐隐（无明亮光圈，仅提供"桌面是投影来的"底色）
          float vign = 1.0 - smoothstep(0.2, 0.85, d);
          float a = vign * 0.045;
          vec3 col = vec3(0.015, 0.5, 0.4);  // 墨青全息，极淡
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(bw * 2 + 6, bh * 2 + 6), tableMat);
    tableMesh.rotation.x = -Math.PI / 2;
    tableMesh.position.y = trayY;
    tableMesh.frustumCulled = false;
    this.scene.add(tableMesh);
    this.tableMat = tableMat;
    // 桌面边缘发光框（更亮，全息桌轮廓）
    const borderMat = new THREE.LineBasicMaterial({ color: 0x00cc66, transparent: true, opacity: 0.28 });
    this.scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-bw, trayY, -bh), new THREE.Vector3(bw, trayY, -bh),
      new THREE.Vector3(bw, trayY, bh), new THREE.Vector3(-bw, trayY, bh),
    ]), borderMat));
    const tickMat = new THREE.LineBasicMaterial({ color: 0x00cc66, transparent: true, opacity: 0.1 });
    for (let x = -bw + 2; x < bw; x += 2) {
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, trayY, -bh), new THREE.Vector3(x, trayY, -bh + 0.6)]), tickMat));
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, trayY, bh), new THREE.Vector3(x, trayY, bh - 0.6)]), tickMat));
    }
    for (let y = -bh + 2; y < bh; y += 2) {
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-bw, trayY, y), new THREE.Vector3(-bw + 0.6, trayY, y)]), tickMat));
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(bw, trayY, y), new THREE.Vector3(bw - 0.6, trayY, y)]), tickMat));
    }
    const grid = new THREE.GridHelper(Math.max(WORLD_W, WORLD_H) * 1.05, 28, 0x0a3a2a, 0x0a3a2a);
    grid.position.y = trayY - 0.5;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.07;
    this.scene.add(grid);
  }

  // 节点球面投影 UV
  private applySphereUV(mesh: THREE.Mesh, radius: number) {
    const pos = mesh.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      uv[i * 2] = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
      uv[i * 2 + 1] = 0.5 - Math.asin(y / radius) / Math.PI;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  private getNode(id: number): any {
    const nodes = this.getNodes();
    return nodes.find((n: any) => n.id === id);
  }

  // ============ 星球构建 ============
  private buildNodes(nodes: any[]) {
    // 清理旧节点
    this.nodeMeshes.forEach(m => this.scene.remove(m));
    this.nodeMeshes.clear();
    this.nodeGlows.forEach(g => this.scene.remove(g));
    this.nodeGlows.clear();
    this.nodeLabels.forEach(l => this.scene.remove(l));
    this.nodeLabels.clear();
    // 清理全息光柱
    this.holoPillars.forEach(p => { this.scene.remove(p); p.geometry.dispose(); (p.material as THREE.Material).dispose(); });
    this.holoPillars.clear();
    this.orbiters.clear();
    // 清理雷达波纹
    this.radarRings.forEach(r => { this.scene.remove(r.mesh); r.mat.dispose(); r.mesh.geometry.dispose(); });
    this.radarRings = [];
    // 驻留舰队共享资源 dispose（避免重建时泄漏）
    this.stationShips.forEach(entry => {
      if (entry.shared) {
        Object.values(entry.shared).forEach((res: any) => {
          if (res && typeof res.dispose === 'function') res.dispose();
        });
      }
    });
    this.stationShips.clear();
    this.nodeCache = [];

    nodes.forEach((n: any) => {
      const w = { x: this.worldX(n.x), z: this.worldZ(n.y) };
      const seed = (n.id * 2654435761 + 12345) % 100000;
      const isCapital = n.type === 'capital';
      const isFortress = n.type === 'fortress';
      const isEmpty = n.type === 'empty';
      const facId = n.ownerFactionId;
      const pal = FAC_COLOR[facId] || FAC_COLOR[0];
      // empty 节点也绘制星球（比普通略小，与 demo 行为一致）
      const radius = isCapital ? 1.15 : (isFortress ? 1.0 : (isEmpty ? 0.42 + (seed % 4) * 0.05 : 0.5 + (seed % 4) * 0.07));

      const g = new THREE.Group();
      // 悬浮高度：星球悬于桌面之上，带上下错落（立体层次，避免平铺在同一平面）
      // 用固定 seed 决定错落量（避免每次重建随机跳动）
      const seedFloat = ((seed % 100) / 100 - 0.5) * HOLO_SPAN;
      g.position.set(w.x, HOLO_Y + seedFloat, w.z);  // 错位 ±1.3
      g.userData.nodeId = n.id;

      // 透明球壳
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius, 3),
        new THREE.MeshBasicMaterial({ color: pal.main, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide })
      );
      g.add(shell);

      // ===== 阿凡达全息沙盘：发光光柱（从桌面 TABLE_Y 升到星球底部，挂 scene 避免自转） =====
      const pillarBottom = TABLE_Y;
      const pillarTop = g.position.y - radius * 0.55;
      const pillarH = pillarTop - pillarBottom;
      if (pillarH > 0.2) {
        const pillarGeo = new THREE.CylinderGeometry(radius * 0.16, radius * 0.3, pillarH, 8, 1, true);
        const pillarMat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uColor: { value: new THREE.Color(pal.main) },
            uTop: { value: pillarTop },
            uBot: { value: pillarBottom },
          },
          vertexShader: `
            varying float vY;
            void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          `,
          fragmentShader: `
            varying float vY;
            uniform vec3 uColor;
            uniform float uTop;
            uniform float uBot;
            void main(){
              float h = (vY - uBot) / max(0.001, uTop - uBot);  // 0=底 1=顶
              float a = (1.0 - h) * 0.3 + 0.05;                 // 底部更亮，向上渐隐但始终可见
              float glow = smoothstep(0.0, 0.3, h) * (1.0 - smoothstep(0.7, 1.0, h));
              a += glow * 0.18;
              // 横向羽化（圆柱面无填充 → 用 UV 隐藏背面？这里用 alpha 做柔和柱体）
              a = clamp(a, 0.0, 1.0);
              gl_FragColor = vec4(uColor, a);
            }
          `,
        });
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(w.x, (pillarTop + pillarBottom) / 2, w.z);
        pillar.frustumCulled = false;
        this.scene.add(pillar);
        this.holoPillars.set(n.id, pillar);
      }

      // 大陆纹理球（宇宙模式：星球调实 → opacity 0.85 → 0.95）
      const contTex = makeContinentalTex(seed + n.id * 7, pal.cont);
      const contMat = new THREE.MeshPhongMaterial({
        map: contTex, transparent: true, opacity: PLANET_CONT_OPACITY,
        emissive: pal.main, emissiveIntensity: 0.55, emissiveMap: contTex,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending, shininess: 0,
      });
      const contSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 0.995, 3), contMat);
      this.applySphereUV(contSphere, radius);
      g.add(contSphere);

      // 云层（部分星球）
      if (seed % 3 !== 0) {
        const cloudTex = makeCloudTex(seed + 999);
        const cloud = new THREE.Mesh(
          new THREE.IcosahedronGeometry(radius * 1.02, 2),
          new THREE.MeshPhongMaterial({ map: cloudTex, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })
        );
        this.applySphereUV(cloud, radius * 1.02);
        g.add(cloud);
      }

      // 阵营辉光
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(pal.glow), transparent: true, opacity: isCapital ? 0.38 : 0.2, depthWrite: false,
      }));
      glow.scale.set(radius * (isCapital ? 2.8 : 2.2), radius * (isCapital ? 2.8 : 2.2), 1);
      g.add(glow);
      this.nodeGlows.set(n.id, glow);

      // 自转轴
      g.userData.axis = new THREE.Vector3(
        (Math.random() - 0.5) * 0.6, 0.7 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6
      ).normalize();
      g.userData.spin = (0.02 + Math.random() * 0.06) * (Math.random() > 0.15 ? 1 : -1);

      // ===== 星系（特化：地球太阳系 / 伊谢尔伦要塞 / 海尼森首饰 / 费沙卫星 / 其他常理）=====
      const pRnd = mulberry32(seed + 555);
      const planets: { sat: THREE.Object3D; r: number; incX: number; incZ: number; phase0: number; speed: number }[] = [];
      const addOrbitRing = (oR: number, color: number) => {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(oR * 0.985, oR, 48),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        g.add(ring);
      };
      const addOrbiter = (obj: THREE.Object3D, oR: number, speed: number, phase: number) => {
        g.add(obj);
        // 轨道倾角加大（±0.7 → 行星上下错落，立体感）
        planets.push({ sat: obj, r: oR, incX: (pRnd() - 0.5) * 1.4, incZ: (pRnd() - 0.5) * 1.4, phase0: phase, speed });
      };
      const makePlanetMesh = (size: number, pSeed: number, rgb: [number, number, number], ringColor: number | null): THREE.Group => {
        const pg = new THREE.Group();
        const pShell = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 6),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
        const pTex = makeContinentalTex(pSeed, rgb, 96, 48);
        const pMat = new THREE.MeshPhongMaterial({
          map: pTex, transparent: true, opacity: 0.85,
          emissive: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255), emissiveIntensity: 0.55, emissiveMap: pTex,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, shininess: 0,
        });
        const pLand = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 6), pMat);
        this.applySphereUV(pLand, size);
        pg.add(pShell);
        pg.add(pLand);
        if (ringColor) {
          const pr = new THREE.Mesh(new THREE.RingGeometry(size * 1.3, size * 2.1, 24),
            new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
          pr.rotation.x = Math.PI / 2.3;
          pg.add(pr);
        }
        return pg;
      };

      if (n.id === 99) {
        // ===== 地球 = 真实太阳系 =====
        shell.material.color.setHex(0xfff2cc);
        (shell.material as THREE.MeshBasicMaterial).opacity = 0.2;
        const sunTex = makeContinentalTex(seed, [255, 200, 110]);
        contSphere.material = new THREE.MeshPhongMaterial({
          map: sunTex, transparent: true, opacity: 0.9,
          emissive: 0xffcc77, emissiveIntensity: 0.6, emissiveMap: sunTex,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, shininess: 0,
        });
        const SOLAR: [string, number, number, number, boolean][] = [
          ['水星', 0.39, 0.382, 0x9a9a9a, false],
          ['金星', 0.72, 0.95, 0xeeddaa, false],
          ['地球', 1.0, 1.0, 0x55aaff, false],
          ['火星', 1.52, 0.53, 0xff7744, false],
          ['木星', 5.2, 11.2, 0xddb377, false],
          ['土星', 9.58, 9.46, 0xf0e0a0, true],
          ['天王星', 19.2, 4.0, 0x9fdcde, false],
          ['海王星', 30.1, 3.88, 0x4f6fe0, false],
        ];
        SOLAR.forEach(([pName, au, rE, color, hasRing]) => {
          const oR = radius * (1.15 + Math.pow(au, 0.45) * 0.9);
          const size = Math.max(0.045, Math.min(0.2, 0.045 + Math.sqrt(rE) * 0.048));
          addOrbitRing(oR, 0x88aaff);
          const pm = makePlanetMesh(size, seed + pName.length * 31, hexToRgb(color), hasRing ? 0xf0e0a0 : null);
          addOrbiter(pm, oR, 0.42 / Math.sqrt(au), pRnd() * Math.PI * 2);
        });
      } else if (n.id === 1) {
        // ===== 伊谢尔伦 = 孤独恒星 + 人工要塞 =====
        shell.material.color.setHex(0xbbddff);
        (shell.material as THREE.MeshBasicMaterial).opacity = 0.2;
        const starTex = makeContinentalTex(seed, [140, 190, 255]);
        contSphere.material = new THREE.MeshPhongMaterial({
          map: starTex, transparent: true, opacity: 0.9,
          emissive: 0xaaddff, emissiveIntensity: 0.6, emissiveMap: starTex,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, shininess: 0,
        });
        const fortR = radius * 1.9;
        addOrbitRing(fortR, 0x88ccff);
        const fort = new THREE.Group();
        const fortCore = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6),
          new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
        const fortRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.009, 6, 20),
          new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
        fort.add(fortCore); fort.add(fortRing);
        addOrbiter(fort, fortR, 0.25, pRnd() * Math.PI * 2);
        // 红色防线环
        const ring2 = new THREE.Mesh(new THREE.RingGeometry(radius * 2.1, radius * 2.14, 48),
          new THREE.MeshBasicMaterial({ color: 0xff6655, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
        ring2.rotation.x = Math.PI / 2.3;
        g.add(ring2);
      } else if (n.id !== 14) {
        // ===== 其他节点 = 天文学常理 + 双星 =====
        if (pRnd() < 0.45) {
          const compR = radius * (2.4 + pRnd() * 1.4);
          const compSize = radius * (0.4 + pRnd() * 0.3);
          const compColors = [0xff8866, 0xffd0b0, 0xaaccff];
          const compColor = compColors[seed % 3];
          addOrbitRing(compR, compColor);
          const comp = makePlanetMesh(compSize, seed + 999, hexToRgb(compColor), null);
          addOrbiter(comp, compR, 0.12 + pRnd() * 0.06, pRnd() * Math.PI * 2);
        }
        const pCount = 1 + (seed % 4);
        const rockColors = [0x9a9a9a, 0xc0a080, 0xb08060];
        const gasColors = [0xddb377, 0x9fdcde, 0xe0d8b0];
        for (let p = 0; p < pCount; p++) {
          const isRock = p === 0 || pRnd() < 0.45;
          const oR = radius * (1.7 + p * 1.15 + pRnd() * 0.7);
          const size = isRock ? 0.05 + pRnd() * 0.035 : 0.11 + pRnd() * 0.06;
          const color = isRock ? rockColors[p % 3] : gasColors[p % 3];
          addOrbitRing(oR, 0x88ffaa);
          const pm = makePlanetMesh(size, seed + p * 77 + 3, hexToRgb(color), (!isRock && pRnd() < 0.35) ? 0xe0d8b0 : null);
          addOrbiter(pm, oR, 0.32 / Math.sqrt(p + 1.3), pRnd() * Math.PI * 2);
        }
      }
      this.orbiters.set(n.id, planets);

      // ===== 驻留舰队（动态：按节点 garrisonFleets 实际数量绕转，可实时增减）=====
      const garrison = (n.garrisonFleets || []).length;
      const shipColor = facId === 1 ? 0x2dd4bf : (facId === 2 ? 0xc084fc : 0xfbbf24);
      const engineColor = facId === 1 ? 0x66ffcc : (facId === 2 ? 0xffcc66 : 0x66ccff);
      const stationGroup = new THREE.Group();
      const orbitR = radius * 2.2;
      const rnd = mulberry32(seed + 7777);
      // 共享资源（每节点一套材质+几何，多船复用，杜绝泄漏）
      const shared = {
        hullGeo: new THREE.BoxGeometry(0.14, 0.05, 0.45),
        bridgeGeo: new THREE.BoxGeometry(0.05, 0.07, 0.08),
        wingGeo: new THREE.BoxGeometry(0.06, 0.015, 0.18),
        bowGeo: new THREE.ConeGeometry(0.04, 0.12, 4),
        thrusterGeo: new THREE.ConeGeometry(0.018, 0.08, 4),
        hullMat: new THREE.MeshBasicMaterial({ color: shipColor, wireframe: true, transparent: true, opacity: 0.9 }),
        bridgeMat: new THREE.MeshBasicMaterial({ color: shipColor, wireframe: true, transparent: true, opacity: 0.75 }),
        wingMat: new THREE.MeshBasicMaterial({ color: shipColor, wireframe: true, transparent: true, opacity: 0.7 }),
        bowMat: new THREE.MeshBasicMaterial({ color: shipColor, wireframe: true, transparent: true, opacity: 0.8 }),
        thrusterMat: new THREE.MeshBasicMaterial({ color: engineColor, transparent: true, opacity: 0.6 }),
      };
      const ships: any[] = [];
      if (garrison > 0) {
        for (let s = 0; s < garrison; s++) {
          ships.push(this.makeStationShip(shared, orbitR, garrison, s, rnd, stationGroup));
        }
        g.add(stationGroup);
      }
      this.stationShips.set(n.id, { group: stationGroup, shipColor, engineColor, orbitR, seed: seed + 7777, ships, rnd, shared });

      // ===== 海尼森 12 女神首饰卫星 =====
      if (n.id === 14) {
        const rnd = mulberry32(seed + 1234);
        const sats: any[] = [];
        for (let s = 0; s < 12; s++) {
          const satR = radius * (1.8 + rnd() * 0.6);
          const size = 0.1 + rnd() * 0.08;
          const sat = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0),
            new THREE.MeshBasicMaterial({ color: 0x88ccff, wireframe: true, transparent: true, opacity: 0.9 }));
          const inclinationX = (rnd() - 0.5) * 1.2;
          const inclinationZ = (rnd() - 0.5) * 1.2;
          const phase0 = rnd() * Math.PI * 2;
          const speed = 0.25 + rnd() * 0.3;
          sat.position.set(satR, 0, 0);
          g.add(sat);
          sats.push({ sat, r: satR, incX: inclinationX, incZ: inclinationZ, phase0, speed });
        }
        const necklace = new THREE.Mesh(new THREE.RingGeometry(radius * 1.7, radius * 1.75, 48),
          new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.08, side: THREE.DoubleSide }));
        necklace.rotation.x = Math.PI / 2.3;
        g.add(necklace);
        this.orbiters.set(n.id, sats);
      }

      // ===== 费沙卫星 =====
      if (n.id === 29) {
        const pSat = makePlanetMesh(radius * 0.22, seed + 888, pal.cont, null);
        pSat.position.set(radius * 1.8, radius * 0.3, 0);
        g.add(pSat);
      }

      // ===== CSS2D 标签 =====
      const label = document.createElement('div');
      label.textContent = n.name;
      label.style.cssText = `color:rgba(${pal.glow},0.95);font-size:${isCapital ? '13px' : '11px'};font-weight:bold;font-family:'Courier New',monospace;text-shadow:0 0 6px rgba(${pal.glow},0.5);white-space:nowrap;pointer-events:none;`;
      const labelObj = new CSS2DObject(label);
      labelObj.position.set(0, radius + 1.1, 0);
      g.add(labelObj);
      this.nodeLabels.set(n.id, labelObj);

      this.scene.add(g);
      this.nodeMeshes.set(n.id, g);
      this.nodeCache.push({ id: n.id, x: w.x, z: w.z, fac: facId, type: n.type, name: n.name });

      // ===== 要塞/首都：多环雷达波纹（模块三） =====
      if (isCapital || isFortress) {
        const ringCount = isCapital ? 3 : 2;
        for (let ri = 0; ri < ringCount; ri++) {
          const rmat = new THREE.MeshBasicMaterial({
            color: pal.main, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const rmesh = new THREE.Mesh(new THREE.RingGeometry(radius * 1.4, radius * 1.55, 48), rmat);
          rmesh.rotation.x = -Math.PI / 2;
          rmesh.position.set(w.x, g.position.y + 0.15, w.z);
          this.scene.add(rmesh);
          this.radarRings.push({
            mesh: rmesh, mat: rmat,
            base: radius * 1.4,
            phase: ri / ringCount,
            period: 2.2 + ri * 0.5,
          });
        }
      }
    });

    this.drawMinimap();
    this.buildFactionBoundaries();
  }

  // ============ 势力范围视觉化（无界势能场 Field，模块二） ============
  // 阿凡达全息沙盘：势力板块升级为"三维悬浮体"。
  // 做法：沿垂直方向堆叠多层元球势能面（Top 亮 / 向下渐暗），从俯视沙盘的角度看去，
  // 板块呈现真实"厚度"的发光斜台层叠（不再是单张贴地平面）；整体随沙盘在场景中，
  // 相机环绕 / 缩放 / 托盘随动时自然一起旋转缩放；慢速浮沉 ±0.4 加强悬浮感。
  private buildFactionBoundaries() {
    // 清理旧
    this.factionBoundaryGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.factionBoundaryGroup.clear();
    this.factionFields = [];

    const nodes = this.getNodes();
    const maxDim = Math.max(WORLD_W, WORLD_H);
    [1, 2].forEach((fac) => {
      const facNodes = nodes.filter((n: any) => n.ownerFactionId === fac);
      if (facNodes.length < 3) return;
      const color = FAC_COLOR[fac].main;

      // 星球"坐在"势力板块上 → 板块作为"托盘上的能量基座"，下沉到桌面，星球立于其上、光柱从桌面穿板块而过。
      // 原 Y_TOP = HOLO_Y - 0.5 → 悬浮在星球带同平面会遮住星球；现下沉到桌面(TABLE_Y)上方一点，避免和星球同高穿插。
      const Y_TOP = TABLE_Y + 0.15;
      const THICK = 0.9;            // 板块总厚度（俯视斜看时的可见高度，向下落到桌面下方少许）
      const LAYERS = 5;             // 沿垂直方向堆叠的势能层数

      // 星系坐标数组（平面局部坐标：worldX, -worldZ）
      const nodeCoords = facNodes.map((n: any) => new THREE.Vector2(this.worldX(n.x), -this.worldZ(n.y)));
      const capital = facNodes.find((n: any) => n.type === 'capital') || facNodes[0];
      const capCoord = new THREE.Vector2(this.worldX(capital.x), -this.worldZ(capital.y));

      const MAX_NODES = 40;
      const uNodes = new Float32Array(MAX_NODES * 2);
      nodeCoords.forEach((c, i) => { if (i < MAX_NODES) { uNodes[i * 2] = c.x; uNodes[i * 2 + 1] = c.y; } });
      const uCount = Math.min(nodeCoords.length, MAX_NODES);

      const planeGeo = new THREE.PlaneGeometry(maxDim * 1.6, maxDim * 1.6 * (WORLD_H / WORLD_W));
      for (let li = 0; li < LAYERS; li++) {
        const frac = li / (LAYERS - 1);          // 0 = 顶面，1 = 底面
        const ly = Y_TOP - frac * THICK;          // 层高沿 Y 递减
        const alphaScale = 1.0 - frac * 0.7;      // 顶面最亮，向下渐暗 → 形成发光厚度

        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uColor: { value: new THREE.Color(color) },
            uNodes: { value: uNodes },
            uCount: { value: uCount },
            uCapital: { value: capCoord },
            uTime: { value: 0 },
            uAlpha: { value: alphaScale },
            uEdgeGlow: { value: frac < 0.35 ? 1.0 : 0.45 },  // 顶面边缘更亮
            uDesat: { value: BOUNDARY_DESAT },                // 颜色去饱和（越低饱和越低调）
          },
          vertexShader: `
            varying vec2 vPos;
            void main(){ vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          `,
          fragmentShader: `
            varying vec2 vPos;
            uniform vec3 uColor;
            uniform vec2 uNodes[40];
            uniform int uCount;
            uniform vec2 uCapital;
            uniform float uTime;
            uniform float uAlpha;
            uniform float uEdgeGlow;
            uniform float uDesat;
            void main(){
              // 元球势能场（Metaball）：高斯核叠加 → 相邻自然融合成连续板块
              float R = 6.5;
              float field = 0.0;
              for (int i = 0; i < 40; i++) {
                if (i >= uCount) break;
                float d = distance(vPos, uNodes[i]);
                field += exp(-(d * d) / (2.0 * R * R));
              }
              // 阈值过滤：势能超阈值显示半透明底色
              float core = smoothstep(0.32, 0.5, field);
              float alpha = core * ${BOUNDARY_BASE_ALPHA.toFixed(3)} * uAlpha;
              // 边缘微弱发光边界（有机水滴融合感）—— 调淡，弱于星球
              float edge = smoothstep(0.26, 0.32, field) * (1.0 - smoothstep(0.32, 0.55, field));
              alpha += edge * ${BOUNDARY_EDGE_ALPHA.toFixed(3)} * uAlpha * uEdgeGlow;
              // 等高线波纹（以首都为中心向外扩散，仅在势力内部）—— 顶面才显示，增强"能量罩"质感
              float capD = distance(vPos, uCapital);
              float wave = sin(capD * 1.05 - uTime * 0.6);
              float line = 1.0 - smoothstep(0.0, 0.14, abs(wave));
              alpha += line * ${BOUNDARY_WAVE_ALPHA.toFixed(3)} * core * uAlpha * uEdgeGlow;
              // 颜色去饱和：把原色往灰色方向混合（越低饱和越低调），让边界不跟星球抢色
              float lum = dot(uColor, vec3(0.299, 0.587, 0.114));
              vec3 desatColor = mix(uColor, vec3(lum), uDesat);
              gl_FragColor = vec4(desatColor, alpha);
            }
          `,
        });

        const plane = new THREE.Mesh(planeGeo, mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = ly;
        plane.frustumCulled = false;
        this.factionBoundaryGroup.add(plane);
        this.factionFields.push({ mesh: plane, mat });
      }
    });

    this.scene.add(this.factionBoundaryGroup);
  }

  // 生成一艘驻留舰船（绕节点公转）
  // 生成一艘驻留舰船（共享材质+几何：每节点一套资源，多船复用，避免泄漏）
  private makeStationShip(shared: any, orbitR: number, total: number, sIdx: number, rnd: () => number, group: THREE.Group): any {
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(shared.hullGeo, shared.hullMat);
    ship.add(hull);
    const bridge = new THREE.Mesh(shared.bridgeGeo, shared.bridgeMat);
    bridge.position.set(0, 0.06, -0.05);
    ship.add(bridge);
    [-0.09, 0.09].forEach((ox) => {
      const wing = new THREE.Mesh(shared.wingGeo, shared.wingMat);
      wing.position.set(ox, 0, 0.05);
      ship.add(wing);
    });
    const bow = new THREE.Mesh(shared.bowGeo, shared.bowMat);
    bow.rotation.x = Math.PI / 2;
    bow.position.z = 0.28;
    ship.add(bow);
    [-0.04, 0.04].forEach((ox) => {
      const thruster = new THREE.Mesh(shared.thrusterGeo, shared.thrusterMat);
      thruster.rotation.x = -Math.PI / 2;
      thruster.position.set(ox, 0, -0.28);
      ship.add(thruster);
    });
    const ang0 = (sIdx / Math.max(1, total)) * Math.PI * 2 + rnd() * 0.5;
    const r = orbitR * (1 + (rnd() - 0.5) * 0.12);
    const baseY = (rnd() - 0.5) * 0.3;
    ship.position.set(Math.cos(ang0) * r, baseY, Math.sin(ang0) * r);
    ship.rotation.y = -ang0;
    group.add(ship);
    return { ship, ang0, r, baseY, speed: 0.15 + rnd() * 0.1, bob: rnd() * Math.PI * 2 };
  }

  // 驻留舰队实时同步：garrisonFleets 数量变化 → 增删舰船
  private syncGarrison(nodes: any[]) {
    nodes.forEach((n: any) => {
      const entry = this.stationShips.get(n.id);
      if (!entry) return;
      const want = (n.garrisonFleets || []).length;
      const cur = entry.ships.length;
      if (want > cur) {
        for (let i = cur; i < want; i++) {
          entry.ships.push(this.makeStationShip(entry.shared, entry.orbitR, want, i, entry.rnd, entry.group));
        }
      } else if (want < cur) {
        const removed = entry.ships.splice(want);
        removed.forEach(r => entry.group.remove(r.ship));
      }
    });
  }

  // ============ 航线 + 跃迁门 ============
  private buildEdges(nodes: any[]) {
    this.edgePulses.forEach(e => this.scene.remove(e.line));
    this.edgePulses = [];
    this.edgeFlows.forEach(f => {
      this.scene.remove(f.mesh);
      f.geom.dispose();
      (f.mesh.material as THREE.Material).dispose();
    });
    this.edgeFlows = [];
    this.edgePathPool = [];
    // 清理走廊光带（dispose tube 与纹理）
    this.corridorFlows.forEach(c => { this.scene.remove(c.tube); c.tex.dispose(); c.mat.dispose(); c.tube.geometry.dispose(); });
    this.corridorFlows = [];
    this.gateGroups.forEach(g => this.scene.remove(g.group));
    this.gateGroups = [];

    const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));
    const keyTypes = ['capital', 'fortress'];
    // linkSet 去重：无论连接在单侧还是双侧声明都能画
    const linkSet = new Set<string>();
    nodes.forEach((n: any) => {
      (n.connections || []).forEach((cid: number) => {
        if (!nodeMap.has(cid)) return;
        const key = n.id < cid ? `${n.id}-${cid}` : `${cid}-${n.id}`;
        linkSet.add(key);
      });
    });

    linkSet.forEach((key) => {
      const [aId, bId] = key.split('-').map(Number);
      const n = nodeMap.get(aId);
      const t = nodeMap.get(bId);
      if (!n || !t) return;
      const aMesh = this.nodeMeshes.get(n.id);
      const bMesh = this.nodeMeshes.get(t.id);
      const a = new THREE.Vector3(this.worldX(n.x), aMesh ? aMesh.position.y : 0, this.worldZ(n.y));
      const b = new THREE.Vector3(this.worldX(t.x), bMesh ? bMesh.position.y : 0, this.worldZ(t.y));
        const mid = a.clone().lerp(b, 0.5);
        mid.y = Math.max(a.y, b.y) + 2.4;   // 拱形光桥：中点抬得更高 → 立体悬浮于两柱之间
        const curve = new THREE.CatmullRomCurve3([a, mid, b]);
        const pts = curve.getPoints(24);
        const palA = FAC_COLOR[n.ownerFactionId] || FAC_COLOR[0];
        const palB = FAC_COLOR[t.ownerFactionId] || FAC_COLOR[0];
        let linkColor: number;
        if (n.ownerFactionId === 1 && t.ownerFactionId === 1) linkColor = palA.main;
        else if (n.ownerFactionId === 2 && t.ownerFactionId === 2) linkColor = palA.main;
        else if (n.ownerFactionId === 0 && t.ownerFactionId === 0) linkColor = palA.main;
        else linkColor = 0x88ffcc;
        const mat = new THREE.LineBasicMaterial({ color: linkColor, transparent: true, opacity: 0.28 });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        this.scene.add(line);
        this.edgePulses.push({ line, t: Math.random(), speed: 0.01 + Math.random() * 0.015, mat });

        // 收集航线到流星池（后续流星随机挑选路径 + 随机方向）
        this.edgePathPool.push({ a: a.clone(), b: b.clone() });

        // ===== 走廊导流光带（伊谢尔伦 id1 / 费沙 id29 的航道） =====
        if (n.id === 1 || t.id === 1 || n.id === 29 || t.id === 29) {
          const corridorTex = makeCorridorTexture();
          const corridorMat = new THREE.MeshBasicMaterial({
            map: corridorTex, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          });
          const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.22, 8, false), corridorMat);
          this.scene.add(tube);
          this.corridorFlows.push({ tex: corridorTex, mat: corridorMat, tube });
        }

        // ===== 跃迁门（仅 keyTypes 节点相连的航道）=====
        if (!keyTypes.includes(n.type) && !keyTypes.includes(t.type)) return;
        const midPoint = curve.getPoint(0.5);
        const tangent = curve.getTangent(0.5);
        const gateGroup = new THREE.Group();
        gateGroup.position.copy(midPoint);
        const gateR = 0.18;
        const structMat = new THREE.MeshBasicMaterial({
          color: linkColor, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        [-0.1, 0, 0.1].forEach((z) => {
          const torus = new THREE.Mesh(new THREE.TorusGeometry(gateR, 0.005, 4, 24), structMat);
          torus.position.z = z;
          gateGroup.add(torus);
        });
        for (let v = 0; v < 4; v++) {
          const a2 = (v / 4) * Math.PI * 2;
          const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 4), structMat);
          strut.rotation.x = Math.PI / 2;
          strut.position.set(Math.cos(a2) * gateR, Math.sin(a2) * gateR, 0);
          gateGroup.add(strut);
        }
        const channelMat = new THREE.MeshBasicMaterial({
          color: linkColor, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const channel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), channelMat);
        channel.rotation.x = Math.PI / 2;
        gateGroup.add(channel);
        [-1, 1].forEach((dir) => {
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 8), structMat);
          horn.rotation.x = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
          horn.position.z = dir * 0.16;
          gateGroup.add(horn);
        });
        gateGroup.lookAt(midPoint.clone().add(tangent));
        this.scene.add(gateGroup);

        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        flash.scale.set(0.4, 0.4, 8);
        gateGroup.add(flash);

        this.gateGroups.push({
          group: gateGroup, flash, flashMat: flash.material as THREE.MeshBasicMaterial,
          phase: Math.random(), period: 10 + Math.random() * 5,
          scale: 0, structMat, channelMat,
        });
      });

    // ===== 航线流星：从航线池随机挑选路径 + 随机方向，动态游走 =====
    if (this.edgePathPool.length > 0) {
      const SEGS = 20;
      const flowCount = Math.min(14, Math.max(8, Math.floor(this.edgePathPool.length * 0.3)));
      for (let k = 0; k < flowCount; k++) {
        const { a, b } = this.edgePathPool[Math.floor(Math.random() * this.edgePathPool.length)];
        const mid = a.clone().lerp(b, 0.5); mid.y = Math.max(a.y, b.y) + 1.2;
        const curve = new THREE.CatmullRomCurve3([a, mid, b]);
        const positions = new Float32Array((SEGS + 1) * 2 * 3);
        const uvs = new Float32Array((SEGS + 1) * 2 * 2);
        const indices: number[] = [];
        for (let i = 0; i <= SEGS; i++) {
          const u = i / SEGS;
          uvs[(i * 2) * 2] = u; uvs[(i * 2) * 2 + 1] = 0;
          uvs[(i * 2 + 1) * 2] = u; uvs[(i * 2 + 1) * 2 + 1] = 1;
          if (i < SEGS) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        }
        const geom = new THREE.BufferGeometry();
        geom.setIndex(indices);
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        const flowMat = new THREE.ShaderMaterial({
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          uniforms: { uColor: { value: new THREE.Color(0xffe9b0) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          fragmentShader: `
            varying vec2 vUv; uniform vec3 uColor;
            void main(){
              float headGlow = 1.0 - smoothstep(0.0, 1.0, vUv.x);
              float alpha = pow(headGlow, 1.7);
              float edge = 1.0 - smoothstep(0.3, 0.5, abs(vUv.y - 0.5));
              gl_FragColor = vec4(uColor, alpha * edge * 0.9);
            }
          `,
        });
        const mesh = new THREE.Mesh(geom, flowMat);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.edgeFlows.push({
          curve, mesh, geom,
          t: Math.random() * 1.2,
          speed: 0.35 + Math.random() * 0.25,
          dir: Math.random() < 0.5 ? 1 : -1,
        });
      }
    }
  }

  // ============ 舰队（含瓦普跃迁特效 + ETA 天数提示）============
  private syncFleets(fleets: any[]) {
    const TICKS_PER_DAY = 10;
    const totalTicks = this.store.totalTicks?.value ?? this.store.totalTicks ?? 0;
    const alive = new Set(fleets.map((f: any) => f.id));
    this.fleetMeshes.forEach((entry, id) => {
      if (!alive.has(id)) {
        this.fleetGroup.remove(entry.mesh);
        this.fleetGroup.remove(entry.ring);
        if (entry.etaObj) this.scene.remove(entry.etaObj);
        this.fleetMeshes.delete(id);
      }
    });
    fleets.forEach((f: any) => {
      let entry = this.fleetMeshes.get(f.id);
      const pal = FAC_COLOR[f.factionId] || FAC_COLOR[0];
      if (!entry) {
        // 舰队三角箭头
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.22);
        shape.lineTo(-0.14, -0.14);
        shape.lineTo(0.14, -0.14);
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        const mat = new THREE.MeshBasicMaterial({ color: pal.main, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.fleetId = f.id;
        this.fleetGroup.add(mesh);
        // 瓦普跃迁环（默认隐藏，移动时显示）
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x88ccff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 32), ringMat);
        ring.rotation.x = Math.PI / 2;
        this.fleetGroup.add(ring);
        // ETA 标签
        const etaEl = document.createElement('div');
        etaEl.style.cssText = 'font-size:11px;font-weight:bold;font-family:"Courier New",monospace;color:#66ffcc;text-shadow:0 0 6px rgba(102,255,204,0.8);white-space:nowrap;pointer-events:none;text-align:center;';
        const etaObj = new CSS2DObject(etaEl);
        this.scene.add(etaObj);
        entry = { mesh, ring, ringMat, etaEl, etaObj };
        this.fleetMeshes.set(f.id, entry);
      }
      // 数据同步：位置 + 跃迁特效 + ETA
      const nodeMap = new Map((this.getNodes() || []).map((n: any) => [n.id, n]));
      const cur = nodeMap.get(f.currentNodeId);
      const tgt = f.targetNodeId ? nodeMap.get(f.targetNodeId) : null;
      const isMoving = !!tgt && f.moveProgress !== undefined && f.moveProgress > 0;
      if (cur) {
        const cx = this.worldX(cur.x), cz = this.worldZ(cur.y);
        const posX = isMoving && tgt ? cx + (this.worldX(tgt.x) - cx) * Math.min(1, f.moveProgress) : cx;
        const posZ = isMoving && tgt ? cz + (this.worldZ(tgt.y) - cz) * Math.min(1, f.moveProgress) : cz;
        const midY = isMoving && tgt ? 0.8 + Math.abs(Math.sin(Math.min(1, f.moveProgress) * Math.PI)) * 2.5 : 0.8;
        entry.mesh.position.set(posX, midY + Math.sin(this.clock.elapsedTime * 3 + f.id) * 0.08, posZ);
        // 瓦普跃迁环：移动时显示并旋转
        if (isMoving) {
          entry.ring.visible = true;
          entry.ringMat.opacity = 0.35 + 0.2 * Math.sin(this.clock.elapsedTime * 6 + f.id);
          entry.ring.position.copy(entry.mesh.position);
          entry.ring.rotation.z += 0.08;
          entry.ring.scale.setScalar(1 + 0.15 * Math.sin(this.clock.elapsedTime * 4 + f.id));
          // ETA 天数（etaDay 绝对 tick → 剩余天数）
          if (f.etaDay != null && entry.etaObj && entry.etaEl) {
            const remainDays = Math.max(1, Math.ceil((f.etaDay - totalTicks) / TICKS_PER_DAY));
            entry.etaEl.textContent = `瓦普跃迁 · ${remainDays} 日后抵达`;
            entry.etaEl.style.display = '';
            entry.etaObj.position.set(posX, midY + 1.2, posZ);
          } else if (entry.etaObj && entry.etaEl) {
            entry.etaEl.style.display = 'none';
          }
        } else {
          entry.ring.visible = false;
          if (entry.etaObj && entry.etaEl) entry.etaEl.style.display = 'none';
        }
      }
    });
  }

  private getNodes(): any[] {
    const raw = this.store.strategicNodes;
    return raw?.value !== undefined ? raw.value : (raw || []);
  }
  private getFleets(): any[] {
    const raw = this.store.strategicFleets;
    return raw?.value !== undefined ? raw.value : (raw || []);
  }

  private bindInteraction() {
    // 鼠标视差：舰桥前景反向微移（2-3 像素级），建立立体纵深
    this.renderer.domElement.addEventListener('mousemove', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.targetParallax.x = (e.clientX - rect.left) / rect.width - 0.5;
      this.targetParallax.y = (e.clientY - rect.top) / rect.height - 0.5;
    });
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const nodeHits = this.raycaster.intersectObjects([...this.nodeMeshes.values()], true);
      if (nodeHits.length > 0) {
        let obj: any = nodeHits[0].object;
        while (obj && obj.userData?.nodeId === undefined) obj = obj.parent;
        if (obj?.userData?.nodeId !== undefined) {
          this.opts.onNodeClick?.(obj.userData.nodeId);
          return;
        }
      }
      const fleetHits = this.raycaster.intersectObjects([...this.fleetMeshes.values()].map(e => e.mesh), false);
      if (fleetHits.length > 0) {
        const fid = fleetHits[0].object.userData.fleetId;
        if (fid !== undefined) this.opts.onFleetClick?.(fid);
      }
    });
    // 右键：节点菜单
    this.renderer.domElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const nodeHits = this.raycaster.intersectObjects([...this.nodeMeshes.values()], true);
      if (nodeHits.length > 0) {
        let obj: any = nodeHits[0].object;
        while (obj && obj.userData?.nodeId === undefined) obj = obj.parent;
        if (obj?.userData?.nodeId !== undefined) {
          this.opts.onNodeContextMenu?.(obj.userData.nodeId, e.clientX, e.clientY);
        }
      }
    });
  }

  private update() {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    this.controls.update();

    // 相机 tween（小地图跳转）
    if (this.cameraTween) {
      const tt = Math.min(1, (performance.now() - this.cameraTween.start) / this.cameraTween.dur);
      const e = 1 - Math.pow(1 - tt, 3);
      this.camera.position.lerpVectors(this.cameraTween.startPos, this.cameraTween.endPos, e);
      this.controls.target.lerpVectors(this.cameraTween.startTarget, this.cameraTween.endTarget, e);
      if (tt >= 1) this.cameraTween = null;
    }

    // 星球自转（自转轴）
    this.nodeMeshes.forEach((m) => {
      const ax = m.userData.axis;
      if (ax) {
        const q = new THREE.Quaternion().setFromAxisAngle(ax, dt * (m.userData.spin || 0.04));
        m.quaternion.premultiply(q);
      }
    });

    // 星系行星/卫星公转
    this.orbiters.forEach((list) => {
      list.forEach((s) => {
        const ang = s.phase0 + t * s.speed;
        const x0 = Math.cos(ang) * s.r;
        const z0 = Math.sin(ang) * s.r;
        const cosX = Math.cos(s.incX), sinX = Math.sin(s.incX);
        const cosZ = Math.cos(s.incZ), sinZ = Math.sin(s.incZ);
        const y1 = -z0 * sinX;
        const z1 = z0 * cosX;
        s.sat.position.set(x0 * cosZ - y1 * sinZ, x0 * sinZ + y1 * cosZ, z1);
      });
    });

    // 驻留舰队绕转
    this.stationShips.forEach((entry) => {
      entry.ships.forEach((s) => {
        const ang = s.ang0 + t * s.speed;
        s.ship.position.set(Math.cos(ang) * s.r, s.baseY + Math.sin(t + s.bob) * 0.08, Math.sin(ang) * s.r);
        s.ship.rotation.y = -ang;
      });
    });

    // 星光闪烁（星芒十字 + 闪烁星脉动）
    this.twinkles.forEach((tw) => {
      tw.spr.material.opacity = tw.base + tw.amp * Math.sin(t * tw.speed + tw.phase);
    });

    // 要塞/首都雷达波纹：循环扩散 + 淡出
    this.radarRings.forEach((r) => {
      const cyc = ((t / r.period) + r.phase) % 1;
      r.mesh.scale.setScalar(1 + cyc * 1.9);
      r.mat.opacity = 0.5 * (1 - cyc);
    });

    // 势力势能场：更新 uTime（等高线波纹扩散）+ 整体缓慢上下漂浮（真正悬浮感）
    this.factionFields.forEach((f) => { f.mat.uniforms.uTime.value = t; });
    // 三维悬浮体：轻微上下浮沉（原 ±0.4 太大，会与桌面/星球穿插；现降为极小 ±0.04）+ 极缓慢左右摇摆（roll）
    this.factionBoundaryGroup.position.y = Math.sin(t * 0.3) * 0.04;
    this.factionBoundaryGroup.rotation.z = Math.sin(t * 0.12) * 0.01;

    // 星云气团：整体缓慢漂移 + 子气团各自流动（散开/聚拢/蒸发）
    this.nebulas.forEach((nb) => {
      nb.group.position.x = nb.bx + Math.sin(t * 0.1 + nb.ox) * nb.ax;
      nb.group.position.z = nb.bz + Math.cos(t * 0.08 + nb.oz) * nb.az;
      nb.group.position.y = nb.by + Math.sin(t * 0.06 + nb.oz) * 2;
      // 子气团独立流动：位置漂移 + 尺寸呼吸 + 透明度忽隐忽现（相位/速度各异 → 形态不断变化）
      nb.subs.forEach((sub) => {
        sub.spr.position.x = sub.px + Math.sin(t * sub.spd + sub.ph) * sub.ax;
        sub.spr.position.z = sub.pz + Math.cos(t * sub.spd * 0.85 + sub.ph * 1.3) * sub.az;
        sub.spr.position.y = sub.py + Math.sin(t * sub.spd * 0.6 + sub.ph * 2.1) * 2.5;
        const breathe = Math.sin(t * sub.spd * 0.9 + sub.ph) * 0.6 + Math.sin(t * sub.spd * 2.4 + sub.ph * 1.7) * 0.4;
        sub.spr.material.opacity = Math.max(0.03, sub.base + sub.amp * breathe);
        const s = sub.bs * (1 + Math.sin(t * sub.spd * 0.7 + sub.ph) * sub.sa);
        sub.spr.scale.set(s, s, 1);
      });
    });

    // 跃迁门生命周期
    this.gateGroups.forEach((gate) => {
      const CHARGE = 1.2, FLASH = 0.4, DISCHARGE = 1.2, ACTIVE = CHARGE + FLASH + DISCHARGE;
      const cyc = (t + gate.phase * gate.period) % gate.period;
      let sc = 0, so = 0, co = 0, fo = 0, fz = 0;
      if (cyc < ACTIVE) {
        if (cyc < CHARGE) {
          const f = cyc / CHARGE, e = 1 - Math.pow(1 - f, 3);
          sc = e; so = e * 0.55; co = e * 0.15;
        } else if (cyc < CHARGE + FLASH) {
          const f = (cyc - CHARGE) / FLASH, p = Math.sin(f * Math.PI);
          sc = 1; so = 0.55 + p * 0.35; co = 0.15 + p * 0.4; fo = p * 0.9; fz = -0.28 + f * 0.56;
        } else {
          const f = (cyc - CHARGE - FLASH) / DISCHARGE, e = Math.pow(f, 3);
          sc = 1 - e; so = (1 - e) * 0.55; co = (1 - e) * 0.15;
        }
        gate.group.scale.setScalar(Math.max(0.001, sc));
        gate.structMat.opacity = so;
        gate.channelMat.opacity = co;
        gate.flash.visible = fo > 0.01;
        if (gate.flash.visible) { gate.flash.position.z = fz; gate.flashMat.opacity = fo; }
      } else {
        gate.group.scale.setScalar(0);
        gate.flash.visible = false;
      }
    });

    // 航线脉冲
    this.edgePulses.forEach((e) => {
      e.t = (e.t + dt * e.speed) % 1;
      e.mat.opacity = 0.15 + Math.abs(Math.sin(e.t * Math.PI * 4)) * 0.25;
    });

    // 走廊导流光带：虚线纹理流动
    this.corridorFlows.forEach((c) => {
      c.tex.offset.x -= dt * 0.5;
    });

    // 航线流星：单一拉长光带，沿曲线重采样顶点（头亮尾渐隐由 Shader 控制）
    const FLOW_TAIL = 0.16;   // 拖尾长度（曲线参数跨度）
    const FLOW_SEGS = 20;
    const FLOW_W = 0.032;     // 光带半宽：极细，只比路径线粗一点点（路径发光感）
    this.edgeFlows.forEach((f) => {
      f.t += dt * f.speed;
      // 等待期（t<0）整条隐藏
      f.mesh.visible = f.t > 0;
      if (!f.mesh.visible) return;
      const posAttr = f.geom.attributes.position as THREE.BufferAttribute;
      const d = f.dir;
      const sample = (tt: number) => f.curve.getPoint(d > 0 ? tt : 1 - tt);
      for (let i = 0; i <= FLOW_SEGS; i++) {
        const u = i / FLOW_SEGS;                 // 0=头 1=尾
        let tt = f.t - u * FLOW_TAIL;
        tt = tt < 0 ? 0 : (tt > 1 ? 1 : tt);     // clamp 到曲线范围
        // 差分求切线（更稳，按方向采样）
        const t0 = tt - 0.002, t1 = tt + 0.002;
        this._flowP0.copy(sample(t0 < 0 ? 0 : t0));
        this._flowP1.copy(sample(t1 > 1 ? 1 : t1));
        this._flowT.subVectors(this._flowP1, this._flowP0).normalize();
        this._flowN.crossVectors(this._flowT, this._flowUp).normalize();
        const p = sample(tt);
        const w = FLOW_W * (1 - u * 0.35);       // 头部略宽、尾部略窄
        posAttr.setXYZ(i * 2, p.x + this._flowN.x * w, p.y + this._flowN.y * w, p.z + this._flowN.z * w);
        posAttr.setXYZ(i * 2 + 1, p.x - this._flowN.x * w, p.y - this._flowN.y * w, p.z - this._flowN.z * w);
      }
      posAttr.needsUpdate = true;
      // 头部越过终点 → 随机换一条路径 + 随机方向，随机等待后再划过
      if (f.t > 1 + FLOW_TAIL && this.edgePathPool.length > 0) {
        const { a, b } = this.edgePathPool[Math.floor(Math.random() * this.edgePathPool.length)];
        const mid = a.clone().lerp(b, 0.5); mid.y = Math.max(a.y, b.y) + 1.2;
        f.curve = new THREE.CatmullRomCurve3([a, mid, b]);
        f.dir = Math.random() < 0.5 ? 1 : -1;
        f.speed = 0.35 + Math.random() * 0.25;
        f.t = -(0.5 + Math.random() * 1.5);
      }
    });

    // 数据同步
    const nodes = this.getNodes();
    const fleets = this.getFleets();
    const currVersion = this.store.strategicMapVersion?.value ?? this.store.strategicMapVersion ?? 0;
    if (nodes.length && (this.nodeMeshes.size === 0 || currVersion !== this.prevMapVersion)) {
      this.buildNodes(nodes);
      this.buildEdges(nodes);
      this.prevMapVersion = currVersion;
    }
    // 归属权着色
    nodes.forEach((n: any) => {
      const prev = this.prevNodeOwnership.get(n.id);
      if (prev !== n.ownerFactionId) {
        const mesh = this.nodeMeshes.get(n.id);
        if (mesh) {
          const pal = FAC_COLOR[n.ownerFactionId] || FAC_COLOR[0];
          mesh.children.forEach((c: any) => {
            if (c.isMesh && c.material) {
              if (c.material.emissive) c.material.emissive.setHex(pal.main);
              else if (c.material.color && !(c.material as any).map) c.material.color.setHex(pal.main);
            }
          });
          const glow = this.nodeGlows.get(n.id);
          if (glow) {
            const oldMap = (glow.material as THREE.SpriteMaterial).map;
            if (oldMap) oldMap.dispose();  // 释放旧纹理，防泄漏
            (glow.material as THREE.SpriteMaterial).map = makeGlowTexture(pal.glow);
          }
          const label = this.nodeLabels.get(n.id);
          if (label) {
            const el = (label as any).element as HTMLElement;
            if (el) el.style.color = `rgba(${pal.glow},0.95)`;
          }
          // 缓存更新
          const c = this.nodeCache.find(nn => nn.id === n.id);
          if (c) c.fac = n.ownerFactionId;
        }
        this.prevNodeOwnership.set(n.id, n.ownerFactionId);
      }
    });
    this.syncGarrison(nodes);
    this.syncFleets(fleets);

    // 视差背景（随相机反向微移，拉开深空纵深：极远层更慢，中层稍快）
    this.farGalaxyGroup.position.x = -this.camera.position.x * 0.012;
    this.farGalaxyGroup.position.y = -this.camera.position.y * 0.012;
    this.farGalaxyGroup.position.z = -this.camera.position.z * 0.012;
    this.parallaxGroup.position.x = -this.camera.position.x * 0.04;
    this.parallaxGroup.position.y = -this.camera.position.y * 0.04;
    this.parallaxGroup.position.z = -this.camera.position.z * 0.04;

    // 桌面边缘固定贴合桌面（不加视差微移，保持与全息桌面整体一致）
    this.mouseParallax.lerp(this.targetParallax, 0.06);

    // CRT 后处理 + 渲染
    if (this.bgMat) this.bgMat.uniforms.uTime.value = t;
    if (this.tableMat) this.tableMat.uniforms.uTime.value = t;   // 桌面呼吸光环
    this.crtPass.uniforms.uTime.value = t;
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);

    // 3D 悬浮信息板锚点：每帧投影回传给 Vue（面板位置随托盘/相机实时变化）
    this.updateHoloBoardAnchors();
  }

  // 指令交互反馈：短促高频震颤（外部在移动/进攻/跃迁指令时调用）
  public triggerShake(intensity = 0.3) {
    // 短促相机抖动（基于基准位置，0.4s 内衰减）
    const base = this.camera.position.clone();
    const t0 = performance.now();
    const dur = 400;
    const tick = () => {
      if (this.disposed) return;
      const p = (performance.now() - t0) / dur;
      if (p >= 1) { this.camera.position.copy(base); return; }
      const d = (1 - p) * intensity;
      this.camera.position.set(base.x + (Math.random() - 0.5) * d, base.y + (Math.random() - 0.5) * d, base.z);
      requestAnimationFrame(tick);
    };
    tick();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.crtPass.uniforms.uResolution.value.set(w, h);
  }

  destroy() {
    this.disposed = true;
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    if (this.labelRenderer.domElement.parentElement) this.labelRenderer.domElement.parentElement.removeChild(this.labelRenderer.domElement);
  }
}
