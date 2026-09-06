/**
 * Battle3DOverlay — 3D 战场覆盖层（Three.js 渲染器）。
 *
 * 架构（T-3D-ARCH-001 拍板方案）：BattleScene（Phaser）继续作为逻辑引擎正常运行
 * （AI/CP/占领/补给零改动），进入 3D 战场模式时其画布被 CSS 隐藏，本类叠加一个
 * Three.js 渲染层，每帧从 BattleScene 公开字段同步状态并渲染 3D 视觉。
 *
 * 数据来源（BattleScene 内部结构，标注 any 来源）：
 *  - battleScene.tilesList: any[] —— 每项 { q,r,x,y,type,typeName,ownerId,connected,hp,maxHp,sprite,text,... }
 *    （x/y 为 Phaser 像素坐标，pointy-top 轴测；见 renderHexMap L1035-1040）
 *  - battleScene.factionMap: Map<factionId, faction>（update 每帧重建；faction.color 为阵营色）
 *    注意：factionMap 为 private，overlay 经构造传入的 scene 引用以 any 读取（来源注释），
 *    阵营色兜底从 store.factions 查。
 *  - battleScene.globalFleets: any[] —— fleet.units 每项 { sprite(Phaser.Container), factionId,
 *    hp,maxHp, classType('战列'|'巡洋'|'驱逐'|'突击'|'电子'|'补给'|'无'|campaign 英文), state... }
 *  - battleScene.hexRadius: number —— 六边形外接圆半径（像素值直接当世界单位）
 *  - 特效：每帧 drainFx3d() 消费 BattleScene 推送的事件。
 *
 * 生命周期照抄 ThreeStrategicMap 模式：requestAnimationFrame 闭包检查 this.disposed 自断、
 * pixelRatio ≤ 2、resize() 公开、destroy() 全量释放。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { drainFx3d, type Fx3dEvent } from '../battle3dFx';
import {
  SHIP_CLASS_ALIAS, FLAGSHIP_MODEL_ALIAS,
  acquireShipModelByFiles, type ShipModelReg,
} from './shipModels';
import { SUPPLY_SOURCE_RADIUS, SUPPLY_AUX_RADIUS } from '../SupplyChainSystem';
import { useSettingsStore } from '../../store/settingsStore';

// ============================================================
// 舰船 GLB 模型：注册表/加载/命名规范已抽至 shipModels.ts（与模型巡览共享）
// 本文件只做消费：buildShip 候选解析 → 线条化渲染 → 就绪原地换装。
// ============================================================

// ============================================================
// 常量（对齐 3d-tactical-demo 原型）
// ============================================================

/** 点顶六边形相邻格中心距系数（flat 间距 = √3 × R；BattleScene 像素系下 x 间距同值） */
const SQ3 = Math.sqrt(3);
/** 绘制半径比例：留缝隙做视觉分隔（原型 HEX_GAP） */
const HEX_GAP_K = 0.92;
/** 柱体向下延伸基准厚度（原型 SKIRT） */
const SKIRT_K = 1.1;
/** 线框自适应增益目标亮度（原型 WIRE_TARGET_LUMA） */
const WIRE_TARGET_LUMA = 0.145;

/**
 * 地形类型 → { 颜色, 相对高度 }（相对高度 × hexRadius = 世界高度）。
 * 取值来源：BattleScene renderHexMap / update 迷雾段的 2D 填充色 + 原型 TILE_TYPE 高度表。
 * 高度排序：海 < 废墟 < 平原(pending) < 码头 < 行星 < 塔 < 矿 < 司令部(castle)。
 */
const TILE_3D: Record<string, { color: number; h: number }> = {
  sea:      { color: 0x1e3a8a, h: 0.15 },
  ruined:   { color: 0x1c1917, h: 0.45 },
  pending:  { color: 0x2d3446, h: 0.35 },
  pier:     { color: 0x0284c7, h: 0.30 },
  planet:   { color: 0x92400e, h: 0.95 },
  gold_mine:{ color: 0x8b6914, h: 1.10 },
  mine:     { color: 0x8b6914, h: 1.00 },
  tower:    { color: 0x4a3a6a, h: 1.20 },
  barracks: { color: 0x3b556e, h: 0.55 },
  castle:   { color: 0x334155, h: 1.60 },
  fortress: { color: 0x3a3a4a, h: 2.20 },
};

/**
 * fbm 分形噪声（原型移植）：4 个八度，值域约 ±1。
 * 驱动坐标必须是【按 hexR 归一化的格坐标】（= t.x / hexR，等价于 demo 的世界坐标 HEX_R=1），
 * 不是像素坐标也不是世界坐标——直接喂像素坐标会让基波只跨约 2.5 格，退化成逐格随机凸起
 * （实机地形锯齿的根因）。归一化后相邻格取值连续，从根上消除"一格一格凸起"的楼梯感。
 */
function fbm(x: number, z: number): number {
  let v = 0, a = 1, f = 0.055;
  for (let i = 0; i < 4; i++) {
    v += a * Math.sin(x * f * 1.31 + Math.cos(z * f * 0.87) * 2.1);
    v += a * 0.7 * Math.cos(z * f * 1.13 + Math.sin(x * f * 0.61) * 1.7);
    a *= 0.5; f *= 2.07;
  }
  return v * 0.42;
}

/** 舰种尺寸比例（对齐原型 SHIP_DIMS：战列舰长 = 0.733 × √3 × hexRadius） */const SHIP_RATIO: Record<string, { L: number; W: number; H: number }> = {
  battleship:      { L: 0.733, W: 0.244, H: 0.150 },
  carrier:         { L: 0.933, W: 0.311, H: 0.170 },
  fast_battleship: { L: 0.660, W: 0.222, H: 0.140 },
  cruiser:         { L: 0.556, W: 0.200, H: 0.120 },
  destroyer:       { L: 0.400, W: 0.133, H: 0.090 },
  fighter:         { L: 0.170, W: 0.060, H: 0.040 },
};
const BOAT_OUT = 1.15;
const BOAT_BACK = 1.05;
/** 登陆艇实例池上限；超出部分本帧不绘制（宁可少画几条，也不越界写 instanceMatrix） */
const BOAT_MAX = 48;

interface BoatAnim {
  srcShipKey: string;
  captureKey: string;
  sx: number; sy: number; sz: number;
  tx: number; ty: number; tz: number;
  t: number;
  phase: 'out' | 'back';
  faction: number;
}
interface CaptureState {
  planet: { x: number; y: number; z: number; r: number };
  faction: number;
  color: number;
  shipKeys: string[];
  startT: number;
  pulseDone: boolean;
}
/** buildShip 产物：pendingModel 存在表示"模型加载中，就绪后请原地换装"；modelVer=构建时的模型版本 */
interface BuiltShip {
  group: THREE.Group;
  flame: THREE.Mesh;
  glow: THREE.Mesh;
  pendingModel?: ShipModelReg;
  modelVer?: number;
}

interface ShipEntry {
  key: string;
  group: THREE.Group;
  flame: THREE.Mesh;
  glow: THREE.Mesh;
  u: any;
  fleet: any;
  lastX: number;
  lastY: number;
  cruiseY: number;
  /** 尾焰粒子状态（每舰 FLAME_PER_SHIP 个，错峰起步避免整齐划一） */
  flameP: { t: number; jitter: number }[];
  /** 待换装模型（GLB 晚于舰船生成才就绪时，据此原地换装） */
  pendingModel?: ShipModelReg;
  /** 构建时的模型版本（0 = 程序化兜底） */
  modelVer?: number;
  /** 旗舰标识与旗舰模型 key（每舰队 units[0]，换装重建时需保持） */
  isFlagship?: boolean;
  flagshipKey?: string;
}
/** 单支舰队的 billboard DOM 句柄（3D 模式下的 HP/补给/姿态呈现层） */
interface FleetBillboard {
  root: HTMLDivElement;
  nameEl: HTMLDivElement;
  hpFill: HTMLDivElement | null;
  supplyFill: HTMLDivElement | null;
  stanceBtns: HTMLButtonElement[];
  /** 上次渲染的姿态，用于 active 态 diff（避免每帧写 DOM） */
  lastStance: string;
  lastTeam: number;
  lastHpPct: number;
  lastSupply: number;
}
/** 中文舰种 → 英文 key（BattleScene 两套命名并存：演习中文 classType / 战役英文） */
const CLS_ALIAS: Record<string, string> = {
  '战列': 'battleship', '巡洋': 'cruiser', '驱逐': 'destroyer',
  '突击': 'carrier', '电子': 'cruiser', '补给': 'destroyer', '无': 'destroyer',
};

// ============================================================
// 护盾定向半球涟漪 shader（原样移植自原型，GLSL 注意 pow(负底数,y) 未定义行为）
// ============================================================
const SHIELD_VS = `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SHIELD_FS = `
precision highp float;
uniform vec3  uColor;
uniform float uTime;
uniform float uAlpha;
uniform float uRingPos;
uniform float uGridScale;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;

vec2 hexCoords(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

void main() {
  float dp   = clamp((1.0 - vUv.y) * 2.0, 0.0, 1.0);
  float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.2);
  float hd   = hexDist(hexCoords(vUv * vec2(uGridScale * 2.0, uGridScale)));
  float grid = smoothstep(0.40, 0.50, hd);
  // 环宽 0.12（正式项目调参版；原型为 0.15）；(dp-uRingPos) 会取负 → 必须 x*x，禁 pow
  float rd   = (dp - uRingPos) / 0.12;
  float ring = exp(-rd * rd);
  float cd   = dp / 0.30;
  float core = exp(-cd * cd) * max(0.0, 1.0 - uTime * 2.4);
  vec3  col = uColor * (0.30 + fres * 0.95 + ring * 0.55)
            + vec3(0.75, 0.90, 1.0) * core * 0.9;
  float a   = (0.10 + fres * 0.58 + grid * 0.26 + ring * 0.50 + core * 0.65) * uAlpha;
  gl_FragColor = vec4(col * a, a);
}`;

// ============================================================
// 工具
// ============================================================

/** 线框自适应增益：暗色多提、亮色少提（原型 wireGain） */
const wireGainCache = new Map<number, number>();
const gainTmp = new THREE.Color();
function wireGain(hex: number): number {
  const cached = wireGainCache.get(hex);
  if (cached !== undefined) return cached;
  gainTmp.setHex(hex);
  const luma = 0.2126 * gainTmp.r + 0.7152 * gainTmp.g + 0.0722 * gainTmp.b;
  const g = Math.min(3.2, Math.max(1.10, WIRE_TARGET_LUMA / Math.max(0.004, luma)));
  wireGainCache.set(hex, g);
  return g;
}

interface OverlayOpts {
  onTileClick?: (tile: any) => void; // any 来源：BattleScene tile 对象
  onError?: (msg: string) => void;
  /** 3D 地形首次构建成功时触发一次（App.vue 收到后才隐藏 2D 画布，防黑屏） */
  onReady?: () => void;
}

interface LaserEntry { mesh: THREE.Mesh; life: number; max: number; }
interface HitEntry  { sprite: THREE.Sprite; life: number; max: number; }
interface ShieldEntry {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  active: boolean;
  t: number;
  R0: number; R1: number; R2: number;
}

/**
 * 3D 舰队 billboard 样式。
 * 必须自带样式：App.vue 的 .fleet-float-ui 等类是 <style scoped>，带 data-v 属性选择器，
 * 注入到 overlay 容器里的 DOM 拿不到那些属性，直接复用类名不会生效。
 * 视觉参数对齐 App.vue 的 2D 跟随层，保证 2D/3D 切换观感一致。
 */
const BB_STYLE_ID = 'b3d-billboard-style';
const BB_CSS = `
.b3d-bb-layer{position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden}
.b3d-bb{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;
  font-family:inherit;white-space:nowrap;will-change:transform,opacity;
  padding:3px 5px;border-radius:5px;background:rgba(10,16,28,.72);
  border:1px solid rgba(148,163,184,.35);backdrop-filter:blur(3px)}
.b3d-bb-name{font-size:11px;font-weight:900;line-height:1.1;margin-bottom:2px;text-shadow:0 1px 2px #000}
.b3d-bb-bar{height:3px;border-radius:2px;background:rgba(30,41,59,.9);overflow:hidden;margin-top:2px}
.b3d-bb-bar>div{height:100%;transition:width .2s linear}
.b3d-bb-stances{display:flex;gap:2px;margin-top:3px}
.b3d-bb-btn{pointer-events:auto;cursor:pointer;font-family:inherit;font-size:9px;font-weight:800;
  padding:1px 4px;line-height:1.4;border-radius:3px;color:#94a3b8;
  background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.4)}
.b3d-bb-btn:hover{color:#0a0f1c;background:#4a9eff;border-color:#4a9eff}
.b3d-bb-btn.active{color:#0a0f1c;background:#4a9eff;border-color:#4a9eff}
`;

// ── 尾焰粒子系统（原型移植）──
const FLAME_PER_SHIP = 14;      // 每舰粒子数
const FLAME_LIFE = 0.55;        // 单粒子寿命（秒）
const FLAME_CAP_SHIPS = 96;     // 支持的最大舰数，超出部分不发射尾焰
const FLAME_CAP = FLAME_PER_SHIP * FLAME_CAP_SHIPS;

const SHIELD_DUR = 0.85;
const easeOutBack = (x: number): number => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** 阵营色兜底链：faction.color → 玩家同盟蓝/帝国红 */
function factionColor(fac: any): number {
  if (fac && typeof fac.color === 'number') return fac.color;
  if (fac?.team === 1) return 0x3b82f6;
  if (fac?.team === 2) return 0xef4444;
  return 0x64748b;
}

// ============================================================
// 主类
// ============================================================
export class Battle3DOverlay {
  private container: HTMLElement;
  /** any 来源：Phaser.Scene（实际为 BattleScene），读取其公开运行时字段驱动渲染 */
  private battleScene: any;
  private store: any; // any 来源：Pinia gameStore
  private opts: OverlayOpts;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private disposed = false;
  private clock = new THREE.Clock();

  // 尾焰粒子系统
  private flamePoints: THREE.Points | null = null;
  private flameGeo: THREE.BufferGeometry | null = null;
  private flamePos = new Float32Array(FLAME_CAP * 3);
  private flameAlpha = new Float32Array(FLAME_CAP);
  private flameSize = new Float32Array(FLAME_CAP);
  private flameHeat = new Float32Array(FLAME_CAP);

  // CRT 后处理管线（原型移植：色差 + 扫描线 + 滚动亮带 + 暗扫掠 + 暗角 + 噪点）
  private rt: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private crtU = {
    tDiffuse: { value: null as THREE.Texture | null },
    // 默认 100（用户拍板：demo 100 档效果最好）；晕眩感来自全屏暗角+噪点，
    // 暗角系数已较原型减弱（0.85→0.50），噪点保持 demo 的 0.055 但改在 sRGB 编码之后施加
    // （1:1 反映到屏幕，不再被暗区 12.9 倍导数放大），扫描线/色差/亮带保持原型。
    uIntensity: { value: 1.0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  };

  // 地形
  private hexInst: THREE.InstancedMesh | null = null;
  private wireGeo: THREE.BufferGeometry | null = null;
  private tileMeta: { t: any; wireStart: number; wireCount: number; lastOwner: number; h: number }[] = [];
  private hexR = 26;
  /** 地图跨度（buildTerrain 时计算：max(宽,高)），固定雾参数与相机预设用 */
  private mapSpan = 0;
  private tileByKey = new Map<string, { h: number; idx: number }>();
  /** 战舰巡航余量（世界单位，= √3 × hexR 的比例） */
  private cruiseClearance = 12;
  /** 硬性最小离地（地形平滑滞后时兜底防穿模） */
  private minClearance = 6;
  /** 星球/要塞中心与半径（3D 径向避让用） */
  private planetCenters: { x: number; y: number; z: number; r: number }[] = [];

  // ---------- 指挥制后勤战 3D 可视化 ----------
  /**
   * 2D 补给链可视化（BattleScene.drawSupplyChain）画在 Phaser 层，3D 模式画布被 CSS 隐藏
   * → 指挥制 3D 战场完全看不到后勤元素（用户实报）。这里在 Three.js 层补画：
   * 后勤站八面体+补给圈 / 星球中继圈 / 运输舰橙锥+补给圈+母队连线 / 舰队补给状态环。
   * 数据源（BattleScene 公开/私有字段，any 读取）：supplyInfo、auxShips、tilesList、store.factions.castlePos。
   * 开关沿用设置项 showSupplyChain（注意：该字段在 settingsStore，gameStore 上没有——
   * 2D 版读 gameStore 恒 undefined 导致从未真正绘制；这里读 settingsStore，无 pinia 环境默认开）。
   */
  private supplyGroup: THREE.Group | null = null;
  /** 后勤站标记：factionId → 八面体 + SUPPLY_SOURCE_RADIUS 补给圈 */
  private supCastle = new Map<number, { oct: THREE.Mesh; ring: THREE.LineLoop }>();
  /** 星球中继圈：tile 对象 → 小圈（中立灰 / 占领后转阵营色） */
  private supPlanets = new Map<any, THREE.LineLoop>();
  /** 运输舰标记：unit 对象（稳定，aux 包装对象每帧重建不能当 key）→ 橙锥 + 补给圈 + 母队连线 */
  private supAux = new Map<any, { cone: THREE.Mesh; ring: THREE.LineLoop; link: THREE.Line }>();
  /** 舰队补给状态环：fleet 对象 → 绿环（在链）/ 红环（断链） */
  private supFleetRings = new Map<any, THREE.LineLoop>();

  // 舰船
  private shipGroup = new THREE.Group();
  private ships = new Map<string, ShipEntry>();

  // 3D 舰队 billboard 状态条（App.vue 的 2D 跟随层在 3D 模式被整层隐藏，此处补回）
  private bbLayer: HTMLDivElement | null = null;
  private billboards = new Map<string, FleetBillboard>();
  /** 每帧复用，避免 updateBillboards 内反复 new */
  private bbProjV = new THREE.Vector3();
  private bbAccum = new Map<string, { fleet: any; n: number; sx: number; sy: number; sz: number }>();

  // 特效池
  private lasers: LaserEntry[] = [];
  private hits: HitEntry[] = [];
  private shields: ShieldEntry[] = [];

  // 占领作战视觉
  private boatInst!: THREE.InstancedMesh;
  private boatDummy = new THREE.Object3D();
  private boats: BoatAnim[] = [];
  private captures = new Map<string, CaptureState>();

  // 点击拾取
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private downPos = { x: 0, y: 0 };
  private dragMoved = false;
  private selRing: THREE.LineSegments;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;

  private ready = false;
  /** 指挥制（command）：纯 3D 宇宙空间，不建六棱柱地形，改画 Tron 式网格平面 + 星域 */
  private spaceMode = false;
  private spaceBuilt = false;
  private spaceGroup: THREE.Group | null = null;
  /** 构造时间戳：onReady 迟迟不触发时供外部判断降级 */
  readonly createdAt = Date.now();

  constructor(container: HTMLElement, scene: Phaser.Scene, store: any, opts: OverlayOpts = {}) {
    this.container = container;
    this.battleScene = scene;
    this.store = store;
    this.opts = opts;

    // 指挥制检测：tacticalState 或 BattleScene.mapStyle 任一为 'command' 即进入纯宇宙空间模式
    const ts = store?.tacticalState;
    this.spaceMode = ts?.mapStyle === 'command' || (scene as any)?.mapStyle === 'command';

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040810);
    this.scene.fog = new THREE.Fog(0x040810, 600, 1600);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 4000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.zIndex = '5';
    // P0 修复：App.vue 的 body.battle3d-mode #phaser-canvas-container canvas { visibility:hidden }
    // 用后代选择器命中所有 canvas，会连 3D 层一起隐藏——本 canvas 必须豁免。
    this.renderer.domElement.style.visibility = 'visible';
    container.appendChild(this.renderer.domElement);

    // 3D 舰队 billboard 状态条层（补回被 battle3d-mode 隐藏的 2D 跟随层）
    this.initBillboardLayer();

    // ── CRT 后处理：离屏 MSAA 渲染 + 全屏合成（对齐原型观感）──
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.rt = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)), { samples: 4 });
    this.crtU.tDiffuse.value = this.rt.texture;
    this.crtU.uRes.value.set(w, h);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.crtU as any,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: [
        'varying vec2 vUv; uniform sampler2D tDiffuse;',
        'uniform float uIntensity; uniform float uTime; uniform vec2 uRes;',
        'void main(){',
        '  vec2 uv=vUv, d=uv-0.5;',
        '  float ca=0.004*uIntensity;',
        '  vec3 col;',
        '  col.r=texture2D(tDiffuse, uv-d*ca).r;',
        '  col.g=texture2D(tDiffuse, uv).g;',
        '  col.b=texture2D(tDiffuse, uv+d*ca).b;',
        '  float sl=sin((uv.y+uTime*0.030)*uRes.y*1.6)*0.5+0.5;',
        '  col*=1.0-sl*0.16*uIntensity;',
        '  float band=sin((uv.y-uTime*0.085)*6.28318)*0.5+0.5;',
        '  col*=1.0+band*0.055*uIntensity;',
        '  float sweep=sin((uv.y+uTime*0.045)*3.14159)*0.5+0.5;',
        '  col*=1.0-sweep*0.035*uIntensity;',
        // 暗角较原型减弱：大地图空域占比高，全屏叠加会显"脏"且晕（demo 图密感知不明显）
        '  col*=1.0-dot(d,d)*(0.50*uIntensity);',
        // 线性→sRGB 输出编码：主场景以线性值写入 RT，自定义 ShaderMaterial 不会像内置材质
        // 那样自动追加 <colorspace_fragment>，缺这一步整幅画面会被压暗约 4 倍（实测
        // 平均亮度 12.54 → 2.87，非背景像素 21% → 1.6%）。必须先 clamp，pow 负底数未定义。
        '  col=clamp(col, 0.0, 1.0);',
        '  col=mix(col*12.92, 1.055*pow(col, vec3(0.41666))-0.055, step(vec3(0.0031308), col));',
        // 噪点必须在 sRGB 编码【之后】施加：若在线性空间（编码前）叠加，暗区导数≈12.9 会把
        // ±0.032 的扰动放大成约 ±0.2 的显示噪声（用户实机截图暗区噪点爆掉的根因）。
        // 编码后施加则 1:1 反映在屏幕上，幅度即可对齐 demo 的 0.055。
        '  float n=fract(sin(dot(uv*(uTime+1.0), vec2(12.9898,78.233)))*43758.5453);',
        '  col+=(n-0.5)*0.055*uIntensity;',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'),
    })));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    if (this.spaceMode) {
        // 指挥制纯宇宙：无"地平线穿帮"问题，放开为全向自由旋转（对齐战略地图手感）
        this.controls.minPolarAngle = 0.05;
        this.controls.maxPolarAngle = Math.PI * 0.49;
    } else {
        // 俯角限制对齐原型：maxPolar 27°（仰角下限，Q1 拍板值）——防止拉平看穿地平线外的雾；
        // minPolar 14.4° 防止完全垂直时 UI 拾取失真。
        this.controls.minPolarAngle = Math.PI * 0.08;
        this.controls.maxPolarAngle = Math.PI * 0.35;
    }
    // 距离上下限在 buildTerrain 按地图跨度定（此处先给安全占位）
    this.controls.minDistance = 60;
    this.controls.maxDistance = 3000;

    // 灯光（对齐原型：半球环境 + 主光 + 边缘光 + 底部补光）
    this.scene.add(new THREE.AmbientLight(0x5577bb, 1.05));
    const key = new THREE.DirectionalLight(0xbfe0ff, 1.55);
    key.position.set(300, 600, 300);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4466ff, 0.75);
    rim.position.set(-300, 150, -300);
    this.scene.add(rim);
    const under = new THREE.DirectionalLight(0x224488, 0.45);
    under.position.set(0, -400, 100);
    this.scene.add(under);

    // 星空（简单 Points）
    this.buildStars();

    this.scene.add(this.shipGroup);
    // 尾焰粒子（全局 Points，需在舰船组之后加入以保证加法混合叠加正确）
    this.buildFlames();

    // 登陆艇：合并为 1 draw call，用于占领作战视觉
    this.boatInst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      BOAT_MAX);
    this.boatInst.frustumCulled = false;
    this.boatInst.count = 0;
    // 预建 instanceColor：若等首次 setColorAt 才建，材质已按"无顶点色"编译过一次，
    // 需要 needsUpdate 重编译；首帧就建好可避开这第二次编译。
    this.boatInst.setColorAt(0, new THREE.Color(0xffffff));
    this.scene.add(this.boatInst);

    // 相机初始位：55° 俯角（polar ≈ 0.61 rad）对准地图中心，等首帧同步后按地图尺寸拉远
    this.camera.position.set(0, 900, 640);
    this.controls.target.set(0, 0, 0);

    // 选中高亮环
    this.selRing = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(1.06, 1.06, 0.06, 6)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
    );
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    // 点击拾取（非拖拽才触发）
    this.onPointerDown = (e) => { this.downPos = { x: e.clientX, y: e.clientY }; this.dragMoved = false; };
    this.onPointerMove = (e) => {
      if (e.buttons && (Math.abs(e.clientX - this.downPos.x) > 4 || Math.abs(e.clientY - this.downPos.y) > 4)) this.dragMoved = true;
    };
    this.onPointerUp = (e) => this.handlePick(e);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    const anim = () => {
      if (this.disposed) return;
      requestAnimationFrame(anim);
      this.tick();
    };
    requestAnimationFrame(anim);
  }

  /**
   * 尾焰粒子系统（原型 flameSystem 移植）。
   * 单个全局 Points：所有舰船共用一份 buffer，1 draw call。
   * 粒子色沿寿命渐变——喷口炽白 → 中段青蓝 → 尾端深蓝，模拟等离子焰流。
   */
  private buildFlames() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.flamePos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.flameAlpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.flameSize, 1));
    geo.setAttribute('aHeat', new THREE.BufferAttribute(this.flameHeat, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uPix: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: [
        'attribute float aAlpha; attribute float aSize; attribute float aHeat;',
        'varying float vAlpha; varying float vHeat;',
        'uniform float uPix;',
        'void main(){',
        '  vAlpha = aAlpha; vHeat = aHeat;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aSize * uPix * (260.0 / max(1.0, -mv.z));',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying float vAlpha; varying float vHeat;',
        'void main(){',
        '  vec2 c = gl_PointCoord - 0.5;',
        '  float d = length(c);',
        '  if (d > 0.5) discard;',
        '  float fall = pow(1.0 - d * 2.0, 1.6);',
        '  vec3 hot  = vec3(1.0, 0.96, 0.85);',
        '  vec3 mid  = vec3(0.45, 0.82, 1.0);',
        '  vec3 cool = vec3(0.12, 0.30, 0.85);',
        '  vec3 col = (vHeat > 0.6) ? mix(mid, hot, (vHeat - 0.6) / 0.4) : mix(cool, mid, vHeat / 0.6);',
        '  gl_FragColor = vec4(col, fall * vAlpha);',
        '}'
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.name = 'shipFlames';
    this.scene.add(points);
    this.flameGeo = geo;
    this.flamePoints = points;
  }

  /** 每帧推进尾焰粒子：从舰尾喷口向后拖出并衰减 */
  private updateFlames(dt: number) {
    const geo = this.flameGeo;
    if (!geo) return;
    const { flamePos: pos, flameAlpha: aAlpha, flameSize: aSize, flameHeat: aHeat } = this;

    let i = 0;
    for (const entry of this.ships.values()) {
      if (i >= FLAME_CAP) break;
      const d = entry.group.userData.dims as { L: number; W: number; H: number } | undefined;
      if (!d) continue;
      const g = entry.group;
      const ang = g.rotation.y;
      // 喷口在舰尾（局部 +z，舰首朝 -z），绕 Y 旋转到世界
      const bx = g.position.x + Math.sin(ang) * d.L * 0.55;
      const bz = g.position.z + Math.cos(ang) * d.L * 0.55;

      for (const p of entry.flameP) {
        if (i >= FLAME_CAP) break;
        p.t += dt * (0.85 + p.jitter * 0.3);
        if (p.t > FLAME_LIFE) p.t -= FLAME_LIFE;
        const k = p.t / FLAME_LIFE;                          // 0=刚喷出 1=即将消散
        const back = k * d.L * (1.5 + p.jitter * 0.8);       // 沿舰尾方向拉出
        const wob = Math.sin(p.t * 26 + p.jitter * 17) * d.W * 0.10 * k;  // 横向抖动
        pos[i * 3] = bx + Math.sin(ang) * back + Math.cos(ang) * wob;
        pos[i * 3 + 1] = g.position.y;
        pos[i * 3 + 2] = bz + Math.cos(ang) * back - Math.sin(ang) * wob;
        aHeat[i] = Math.max(0, 1 - k * 1.35);                // 越靠喷口越热
        aAlpha[i] = (1 - k) * (1 - k) * 0.85;                // 二次衰减，尾端柔和
        aSize[i] = d.L * (0.55 + (1 - k) * 1.15);
        i++;
      }
    }
    // 未占用的槽位透明度归零（舰船数减少时残留粒子立刻消失）
    for (let j = i; j < FLAME_CAP; j++) aAlpha[j] = 0;

    geo.setDrawRange(0, i);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aHeat.needsUpdate = true;
  }

  // ---------- 星空 ----------
  private buildStars() {
    const N = 1200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 2500 + Math.random() * 1500;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.6 + 300;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // 圆形星点贴图：PointsMaterial 默认 gl.POINTS 是方块（用户反馈"方块星星丑爆了"），
    // 用径向渐变 canvas 贴图 + alphaTest 裁出软边圆点，1 draw call 不变。
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    const starTex = new THREE.CanvasTexture(cv);
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9fc4e8, size: this.hexR * 1.2, map: starTex, alphaTest: 0.08,
      transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true,
      // 星空必须脱离雾体系：星点半径写死 2500~4000，而雾程 near = camD + mapSpan×1.05 随
      // 地图尺度缩放，两者脱钩——小地图档雾程仍会侵蚀过半星点。雾色 0x040810 与背景同色，
      // 被雾吞掉的星点表现为"星空发灰/看不见"（修完 far 后用户会直接看到这一条）。
      fog: false,
    }));
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  // ---------- 像素 → 世界 ----------
  /** BattleScene 像素坐标 → 3D 世界坐标（y 取反成 z，heights 单位=像素） */
  private pxToWorld(x: number, y: number, extraY = 0): THREE.Vector3 {
    return new THREE.Vector3(x, extraY, -y);
  }

  /** 查某像素点所在格的地形高度 */
  private heightAtPx(px: number, py: number): number {
    // 指挥制纯宇宙：基准面即 y=0 网格平面，舰船固定巡航高度飞行
    if (this.spaceMode) return 0;
    // 点顶六边形：中心距 x = √3·R·(q + r/2)，y = 1.5·R·r（renderHexMap 同源公式）
    const r3 = this.hexR * 1.5;
    const rCand = Math.round(py / r3);
    let best = 0;
    let bestD = Infinity;
    for (let r = rCand - 1; r <= rCand + 1; r++) {
      const qCand = Math.round(px / (this.hexR * SQ3) - r / 2);
      for (let q = qCand - 1; q <= qCand + 1; q++) {
        const hit = this.tileByKey.get(`${q},${r}`);
        if (!hit) continue;
        const wx = this.hexR * (SQ3 * q + SQ3 / 2 * r);
        const wy = r3 * r;
        const d = (wx - px) * (wx - px) + (wy - py) * (wy - py);
        if (d < bestD) { bestD = d; best = hit.h; }
      }
    }
    return best;
  }

  /** 计算单格 3D 高度（原型三段式移植，世界单位）。
   *  核心格（planet/fortress/castle）保持自身高度 ± 微扰；
   *  普通格 = 类型基准 + fbm 连续起伏；空域（sea/ruined）只做缓波。
   *  关键：fbm 喂的是按 hexR 归一化的坐标（demo 世界坐标 HEX_R=1 的等比尺度），
   *  直接喂像素坐标会让基波只跨约 2.5 格，退化为逐格随机凸起（实机截图锯齿的根因）。 */
  private tileHeight(t: any): number {
    const R = this.hexR;
    const def = TILE_3D[t.type] || TILE_3D.pending;
    const nx = t.x / R, ny = t.y / R;              // 像素坐标 → 归一化（≈demo 世界坐标）
    const n = fbm(nx, ny);                          // ±1
    const isCore = t.type === 'planet' || t.type === 'fortress' || t.type === 'castle';
    const isVoid = t.type === 'sea' || t.type === 'ruined';
    let hk: number;                                 // 相对高度（× R）
    if (isCore) {
      hk = def.h + n * 0.22;
    } else if (isVoid) {
      hk = def.h + n * 0.46;                        // 空域缓波
    } else {
      // 陆地：类型基准 + 山丘隆起（幅度对齐 demo：0.55 主波 + 0.18 次波）
      hk = def.h + 0.42 + n * 0.55 + 0.18 * fbm(nx * 0.55 + 13.7, ny * 0.55 - 8.3);
    }
    return Math.max(0.14 * R, hk * R);
  }

  // ---------- 地形 ----------
  private buildTerrain() {
    const bs = this.battleScene;
    const tiles: any[] = bs.tilesList || []; // any 来源：BattleScene.tilesList
    if (tiles.length === 0) return;
    this.hexR = bs.hexRadius || 26;
    this.cruiseClearance = this.hexR * 3.6;
    this.minClearance = this.hexR * 1.8;

    // 记录星球/要塞位置，供舰船 3D 径向避让（tileByKey 尚未填充，高度直接按类型取）
    this.planetCenters = tiles
      .filter((t: any) => t.type === 'planet' || t.type === 'fortress')
      .map((t: any) => {
        const r = this.hexR * (t.type === 'fortress' ? 2.6 : 1.5);
        const h = Math.max(0.14 * this.hexR, (TILE_3D[t.type] || TILE_3D.pending).h * this.hexR);
        return { x: t.x, y: h + r * 0.8, z: -t.y, r };
      });

    // 相机对准地图中心并按地图尺寸拉远
    const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), this.hexR * 8);
    this.mapSpan = span;
    const dist = Math.max(span * 1.15, this.hexR * 20);
    this.controls.target.set(cx, 0, -cy);
    // 55° 俯角
    this.camera.position.set(cx, dist * Math.sin(0.96), -cy + dist * Math.cos(0.96));
    this.controls.minDistance = this.hexR * 3;
    // 收紧缩放上限：此前 dist*3 在大地图上远超雾远端（near=camD+span*0.32），
    // 拉太远画面整片没入雾→黑屏（用户实报）。上限=初始视距×1.6，保证最远仍能看清地图轮廓。
    this.controls.maxDistance = dist * 1.6;
    this.controls.update();
    // 首帧前就把裁剪面对齐地图尺度，避免第一帧整片地形被切掉
    this.syncClipPlanes(this.camera.position.distanceTo(this.controls.target), true);

    const hexGap = this.hexR * HEX_GAP_K;
    const skirt = this.hexR * SKIRT_K;

    // 六棱柱 InstancedMesh
    const prism = new THREE.CylinderGeometry(hexGap, hexGap, 1, 6);
    const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, flatShading: true, shininess: 10 });
    const inst = new THREE.InstancedMesh(prism, mat, tiles.length);
    inst.name = 'hexTerrain';
    const dummy = new THREE.Object3D();
    const baseColor = new THREE.Color();

    // 线框（顶面 6 边 + 垂直棱，vertexColors）
    const lp: number[] = [];
    const lc: number[] = [];
    const tmpC = new THREE.Color();

    tiles.forEach((t, i) => {
      const def = TILE_3D[t.type] || TILE_3D.pending;
      // 高度：三段式 fbm（类型基准 + 世界坐标连续噪声）——消除相邻格突变
      const h = this.tileHeight(t);
      t._h3d = h; // 挂回 tile 供 heightAtPx 使用
      this.tileByKey.set(`${t.q},${t.r}`, { h, idx: i });

      const bot = -skirt;
      dummy.position.set(t.x, (h + bot) / 2, -t.y);
      dummy.scale.set(1, h - bot, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      const hex = t.ownerId > 0 ? factionColor(this.getFac(t.ownerId)) : def.color;
      // 不可通行地形（海/废墟）：压暗到 45%，与可通行格拉开明暗差，形成"禁区"视觉语义
      const dimK = (t.type === 'sea' || t.type === 'ruined') ? 0.45 : 0.88;
      baseColor.setHex(hex).multiplyScalar(dimK);
      inst.setColorAt(i, baseColor);

      // 线框色 = 阵营/地形色 × 增益
      tmpC.setHex(hex).multiplyScalar(wireGain(hex));
      const cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
      const wireStart = lc.length / 3;
      // 顶面 6 边
      for (let k = 0; k < 6; k++) {
        const a1 = (k / 6) * Math.PI * 2, a2 = ((k + 1) / 6) * Math.PI * 2;
        lp.push(t.x + hexGap * Math.sin(a1), h, -t.y + hexGap * Math.cos(a1));
        lp.push(t.x + hexGap * Math.sin(a2), h, -t.y + hexGap * Math.cos(a2));
        lc.push(cr, cg, cb, cr, cg, cb);
      }
      // 垂直棱（底端渐隐）
      const db = 0.14;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const pxx = t.x + hexGap * Math.sin(a), pzz = -t.y + hexGap * Math.cos(a);
        lp.push(pxx, h, pzz, pxx, bot, pzz);
        lc.push(cr, cg, cb, cr * db, cg * db, cb * db);
      }
      this.tileMeta.push({ t, wireStart, wireCount: lc.length / 3 - wireStart, lastOwner: t.ownerId ?? 0, h });
    });

    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.hexInst = inst;
    this.scene.add(inst);

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    wg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    this.wireGeo = wg;
    const wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    wire.frustumCulled = false;
    this.scene.add(wire);

    // 选中环尺寸对齐格子
    this.selRing.scale.setScalar(hexGap);

    this.buildTerrainMarkers(tiles);
  }

  /**
   * 指挥制（command）：纯 3D 宇宙空间 —— 对标参考图的 Tron 扫描画面。
   * - 绿色网格平面（细格 + 主线双层）= 空间坐标扫描基准面
   * - 橙色线框圆柱 + 顶环 = "引力异常区"装饰天体（不参与战斗逻辑）
   * - 星域由 buildStars 提供；舰船在 y=0 基准面上方固定巡航高度飞行
   * - 相机全向自由旋转（构造器已放宽 polar 限制）
   */
  private buildSpaceWorld() {
    const bs = this.battleScene;
    const tiles: any[] = bs.tilesList || [];
    this.hexR = bs.hexRadius || 26;
    this.cruiseClearance = this.hexR * 3.6;
    this.minClearance = this.hexR * 1.8;

    // 空间以战场逻辑范围为准（指挥制 tilesList 仍会构建，用作尺寸参照）
    let span = this.hexR * 40;
    let cx = 0, cy = 0;
    if (tiles.length > 0) {
      const xs = tiles.map((t: any) => t.x), ys = tiles.map((t: any) => t.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), this.hexR * 20);
    }
    this.mapSpan = span;

    const grp = new THREE.Group();
    grp.name = 'spaceWorld';

    // ── 1. 绿色网格平面（细格弱线 + 主线亮线，参考图的疏密层次）──
    const planeSize = span * 2.6;
    const subDiv = Math.max(24, Math.round(planeSize / (this.hexR * 4)));
    const gridSub = new THREE.GridHelper(planeSize, subDiv, 0x117a55, 0x117a55);
    (gridSub.material as THREE.Material).transparent = true;
    (gridSub.material as THREE.Material).opacity = 0.20;
    gridSub.position.set(cx, 0, -cy);
    grp.add(gridSub);

    const gridMajor = new THREE.GridHelper(planeSize, Math.max(6, Math.round(subDiv / 6)), 0x1fd28f, 0x1fd28f);
    (gridMajor.material as THREE.Material).transparent = true;
    (gridMajor.material as THREE.Material).opacity = 0.45;
    gridMajor.position.set(cx, 0, -cy);
    grp.add(gridMajor);

    // ── 2. 橙色线框引力异常（5-6 个盘状/柱状装饰体）──
    const wellMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, wireframe: true, transparent: true, opacity: 0.5 });
    const wellCount = 5;
    for (let i = 0; i < wellCount; i++) {
      const r = this.hexR * (2.2 + Math.random() * 2.2);
      const h = this.hexR * (0.8 + Math.random() * 1.4);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 14, 3), wellMat);
      const ang = (i / wellCount) * Math.PI * 2 + Math.random() * 0.9;
      const dist = span * (0.18 + Math.random() * 0.42);
      cyl.position.set(cx + Math.cos(ang) * dist, h / 2 + this.hexR * 0.2, -cy + Math.sin(ang) * dist);
      grp.add(cyl);
      // 顶部轴口环（参考图圆柱顶端的小凸起）
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.42, Math.max(1, this.hexR * 0.07), 6, 18),
        wellMat,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cyl.position.x, cyl.position.y + h / 2 + this.hexR * 0.28, cyl.position.z);
      grp.add(ring);
    }

    // ── 3. 相机取景：55° 俯角对准战场中心，距离上下限按跨度 ──
    const dist = Math.max(span * 1.05, this.hexR * 24);
    this.controls.target.set(cx, 0, -cy);
    this.camera.position.set(cx, dist * Math.sin(0.96), -cy + dist * Math.cos(0.96));
    this.controls.minDistance = this.hexR * 4;
    this.controls.maxDistance = dist * 2.2;
    this.controls.update();
    this.syncClipPlanes(this.camera.position.distanceTo(this.controls.target), true);

    // 选中环按空间尺度
    this.selRing.scale.setScalar(this.hexR * 2.2);

    this.spaceGroup = grp;
    this.scene.add(grp);
    this.spaceBuilt = true;
  }

  /**
   * 特殊地形 3D 标记物（问题2：只有颜色+高度看不懂什么是什么）。
   * 每种地形一个标志性形状，语义一眼可辨；共享几何体，特殊格数量少（<40）。
   * sea/ruined（不可通行）不立标记，而是把柱体压暗+顶部加警示斜纹色，
   * 与可通行格形成"凹地/禁区"的视觉差。
   */
  private buildTerrainMarkers(tiles: any[]) {
    const R = this.hexR;
    const mkMat = (hex: number, opts: Partial<THREE.MeshPhongMaterialParameters> = {}) =>
      new THREE.MeshPhongMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.35, shininess: 60, transparent: true, opacity: 0.95, ...opts });

    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);      // 行星
    const octaGeo = new THREE.OctahedronGeometry(1);            // 要塞/矿
    const coneGeo = new THREE.ConeGeometry(1, 2, 8);            // 塔
    const ringGeo = new THREE.TorusGeometry(1, 0.18, 8, 24);    // 码头
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); // 司令部光柱

    const mats = {
      planet: mkMat(0x22c55e),
      fortress: mkMat(0xef4444),
      mine: mkMat(0xfbbf24),
      tower: mkMat(0xa78bfa),
      castle: mkMat(0x00ffff, { opacity: 0.5 }),
      pier: mkMat(0x38bdf8),
    };

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, s: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.setScalar(s);
      m.rotation.y = ry;
      this.scene.add(m);
      return m;
    };

    tiles.forEach((t) => {
      const h = t._h3d ?? 0.35 * R;
      const x = t.x, z = -t.y;
      switch (t.type) {
        case 'planet':
          add(sphereGeo, mats.planet, x, h + R * 0.55, z, R * 0.55);
          break;
        case 'fortress':
          add(octaGeo, mats.fortress, x, h + R * 0.7, z, R * 0.5);
          break;
        case 'gold_mine':
        case 'mine':
          add(octaGeo, mats.mine, x, h + R * 0.45, z, R * 0.32, Math.PI / 4);
          break;
        case 'tower':
          add(coneGeo, mats.tower, x, h + R * 0.7, z, R * 0.35);
          break;
        case 'pier':
          add(ringGeo, mats.pier, x, h + R * 0.3, z, R * 0.42, Math.PI / 2);
          break;
        case 'castle': {
          // 半透明光柱：司令部位置远处可见
          const beam = add(cylGeo, mats.castle, x, h + R * 1.5, z, R * 0.3);
          beam.scale.y = R * 3;
          break;
        }
        default:
          break;
      }
    });
  }

  private getFac(id: number): any {
    // any 来源：factionMap 为 BattleScene private，经 store.factions 兜底查阵营色
    const f = this.battleScene.factionMap?.get?.(id);
    if (f) return f;
    return (this.store?.factions || []).find((x: any) => x.id === id);
  }

  /** 每帧 diff：ownerId 变化的格刷新 instanceColor 与线框色 */
  private refreshTileOwners() {
    if (!this.hexInst || !this.wireGeo) return;
    const colAttr = this.wireGeo.attributes.color as THREE.BufferAttribute;
    const baseColor = new THREE.Color();
    const tmpC = new THREE.Color();
    let instDirty = false;
    this.tileMeta.forEach((meta, i) => {
      const t = meta.t;
      const owner = t.ownerId ?? 0;
      if (owner === meta.lastOwner) return;
      meta.lastOwner = owner;
      const def = TILE_3D[t.type] || TILE_3D.pending;
      const hex = owner > 0 ? factionColor(this.getFac(owner)) : def.color;
      baseColor.setHex(hex).multiplyScalar(0.88);
      this.hexInst!.setColorAt(i, baseColor);
      instDirty = true;
      tmpC.setHex(hex).multiplyScalar(wireGain(hex));
      const db = 0.14;
      let idx = meta.wireStart;
      for (let k = 0; k < 12; k++) colAttr.setXYZ(idx++, tmpC.r, tmpC.g, tmpC.b);
      for (let k = 0; k < 6; k++) {
        colAttr.setXYZ(idx++, tmpC.r, tmpC.g, tmpC.b);
        colAttr.setXYZ(idx++, tmpC.r * db, tmpC.g * db, tmpC.b * db);
      }
    });
    if (instDirty && this.hexInst.instanceColor) this.hexInst.instanceColor.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  // ---------- 舰船 ----------
  private dimsOf(classType: string): { L: number; W: number; H: number } {
    const ratio = SHIP_RATIO[classType] || SHIP_RATIO[CLS_ALIAS[classType]] || SHIP_RATIO.destroyer;
    return { L: ratio.L * SQ3 * this.hexR, W: ratio.W * SQ3 * this.hexR, H: ratio.H * SQ3 * this.hexR };
  }

  /** 程序化/模型建船总入口（舰首局部 -z）。
   *  1) assets/ship/ 下有匹配 GLB → 真实模型线条化渲染。候选顺序：
   *     flagship_{旗舰key}.glb（专属旗舰）→ {faction}_{class}.glb → {class}.glb；
   *  2) 模型加载中 → 程序化兜底 + pendingModel（就绪后场上原地换装）；
   *  3) 无模型文件 → 纯程序化造型（帝国战列舰走精细描形，其余通用造型）。 */
  private buildShip(classType: string, facColor: number, isEmpire?: boolean, flagshipKey?: string): BuiltShip {
    const d = this.dimsOf(classType);
    const cls = SHIP_CLASS_ALIAS[classType] || null;
    const factionKey: 'empire' | 'alliance' = isEmpire ? 'empire' : 'alliance';

    const candidates: string[] = [];
    if (cls) {
      if (flagshipKey) candidates.push(`flagship_${flagshipKey}.glb`);
      candidates.push(`${factionKey}_${cls}.glb`, `${cls}.glb`);
    }

    let reg: ShipModelReg | null = candidates.length ? acquireShipModelByFiles(candidates) : null;
    if (reg && reg.status === 'ready' && reg.geo) {
      const built = this.buildShipFromModel(reg, d, facColor);
      built.modelVer = reg.version;
      return built;
    }

    // 程序化兜底：帝国战列舰走精细描形，其余通用造型
    const built: BuiltShip = (cls === 'battleship' && isEmpire)
      ? this.buildEmpireBattleship(d, facColor)
      : this.buildGenericShip(d, facColor, classType);
    if (reg) built.pendingModel = reg;
    return built;
  }

  /** 通用程序化造型（无模型的舰种兜底）：三层材质 + 分件线框 */
  private buildGenericShip(d: { L: number; W: number; H: number }, facColor: number, classType: string): { group: THREE.Group; flame: THREE.Mesh; glow: THREE.Mesh } {
    const group = new THREE.Group();
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc, flatShading: true });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

    const addPart = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rotX = 0) => {
      const m = new THREE.Mesh(geo, bodyMat);
      m.position.set(x, y, z);
      m.rotation.x = rotX;
      group.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wireMat);
      e.position.copy(m.position);
      e.rotation.copy(m.rotation);
      group.add(e);
      return m;
    };
    // 主体
    addPart(new THREE.BoxGeometry(d.W, d.H, d.L * 0.72), 0, 0, 0);
    // 舰首（锥体朝 -z）
    addPart(new THREE.ConeGeometry(d.W * 0.5, d.L * 0.42, 4), 0, 0, -d.L * 0.57, -Math.PI / 2);
    // 上层建筑
    addPart(new THREE.BoxGeometry(d.W * 0.55, d.H * 0.7, d.L * 0.22), 0, d.H * 0.7, d.L * 0.08);
    // 舷台（航母/战列）
    const engKey = SHIP_RATIO[classType] ? classType : CLS_ALIAS[classType];
    if (engKey === 'carrier' || engKey === 'battleship') {
      addPart(new THREE.BoxGeometry(d.W * 1.9, d.H * 0.32, d.L * 0.3), 0, -d.H * 0.1, d.L * 0.05);
    }
    // 引擎发光核 ×2
    const gg = new THREE.SphereGeometry(Math.max(0.5, d.W * 0.16), 6, 5);
    const glow = new THREE.Mesh(gg, glowMat);
    glow.position.set(d.W * 0.3, 0, d.L * 0.42);
    group.add(glow);
    const glow2 = new THREE.Mesh(gg, glowMat);
    glow2.position.set(-d.W * 0.3, 0, d.L * 0.42);
    group.add(glow2);
    // 引擎喷口亮核（受创变红的可视点）
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.4, d.W * 0.18), 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xaae6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.position.set(0, 0, d.L * 0.55);
    group.add(flame);
    group.userData.dims = d;
    return { group, flame, glow };
  }

  /**
   * GLB 模型 → 线条化渲染（阵营色 Phong 体 + 单条轮廓线框，几何全体舰共享）。
   * 任意舰种通用：模型由注册表提供，缩放归一到该舰种占位长度。
   */
  private buildShipFromModel(reg: ShipModelReg, d: { L: number; W: number; H: number }, facColor: number): BuiltShip {
    const L = d.L;
    const group = new THREE.Group();
    const geo = reg.geo!;
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const modelLen = Math.max(size.x, size.y, size.z) || 1;
    const s = (L * 0.96) / modelLen;

    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xaae6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

    const body = new THREE.Mesh(geo, bodyMat);
    body.scale.setScalar(s);
    group.add(body);
    if (reg.wire) {
      const wire = new THREE.LineSegments(reg.wire, wireMat);
      wire.scale.setScalar(s);
      group.add(wire);
    }

    // 尾焰/光核挂点：模型包围盒后端（+z 舰尾）
    const rearZ = geo.boundingBox!.max.z * s;
    const flame = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.4, L * 0.02), 8, 6), flameMat);
    flame.position.set(0, 0, rearZ);
    group.add(flame);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.3, L * 0.016), 8, 6), glowMat);
    glow.position.set(0, 0, rearZ * 0.88);
    group.add(glow);

    group.userData.dims = d;
    return { group, flame, glow };
  }

  /**
   * 帝国标准战舰程序化兜底（多视角参考图描形，舰首 -z）：
   * 有 GLB 模型时本函数不会被调用（buildShip 分流）。
   * 所有静态件 merge 成单 Mesh（1 draw call）+ 单条 EdgesGeometry 轮廓线框，
   * 几十艘同屏不增加对象数；引擎光核/尾焰挂点兼容原管线。
   */
  private buildEmpireBattleship(d: { L: number; W: number; H: number }, facColor: number): { group: THREE.Group; flame: THREE.Mesh; glow: THREE.Mesh } {
    // ── 程序化描形兜底 ──
    const L = d.L;
    const group = new THREE.Group();
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc, flatShading: true });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xaae6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

    // ── 静态部件收集（先建几何 → 平移/旋转 → 合并）──
    // 注意：ExtrudeGeometry（龙骨）是非索引几何，Box/Cylinder/Sphere 是索引几何，
    // mergeGeometries 混用两者会返回 null（表现为帝国战列舰退化成裸箱体）——统一转非索引。
    const parts: THREE.BufferGeometry[] = [];
    const add = (geoRaw: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
      const geo = geoRaw.index ? geoRaw.toNonIndexed() : geoRaw;
      if (geo !== geoRaw) geoRaw.dispose();
      geo.translate(x, y, z);
      parts.push(geo);
    };

    // ============ 按参考图侧视轮廓逐点描形（全部方正硬朗，无圆球颈）============
    // 侧视实量（L=全长）：前段舰体高 0.124L；后段主舱高 0.18L；垂体最深处再向下 0.12L。
    // 坐标约定：舰首 -z，舰尾 +z。

    // 1. 前段舰体：整块侧影拉伸（含舰首小斜切），不是积木拼接
    //    Shape：x=距舰首距离(0~0.44)，y=垂直(±0.062)；轮廓在舰首处上下各切一角
    const fs = new THREE.Shape();
    fs.moveTo(0.005 * L, -0.042 * L);   // 舰首下斜角
    fs.lineTo(0.032 * L, -0.062 * L);   // 下缘起点
    fs.lineTo(0.44 * L, -0.062 * L);    // 下缘平直
    fs.lineTo(0.44 * L, 0.062 * L);     // 前段末端（与结合部对接）
    fs.lineTo(0.032 * L, 0.062 * L);    // 上缘平直
    fs.lineTo(0.005 * L, 0.042 * L);    // 舰首上斜角
    fs.closePath();
    const fwd = new THREE.ExtrudeGeometry(fs, { depth: 0.055 * L, bevelEnabled: false });
    fwd.translate(0, 0, -0.0275 * L);   // 宽度居中
    fwd.rotateY(-Math.PI / 2);          // Shape +x → 世界 +z；x=0（舰首）落在 z=-0.50
    add(fwd, 0, 0, -0.50 * L);

    // 2. 前段上缘窄沿条（参考图上缘的凸起细线）
    add(new THREE.BoxGeometry(0.036 * L, 0.013 * L, 0.40 * L), 0, 0.069 * L, -0.28 * L);

    // 3. 结合部颈箱（前后舰体直接对接的方正过渡，比前段宽、比后段窄）
    add(new THREE.BoxGeometry(0.095 * L, 0.105 * L, 0.13 * L), 0, 0.005 * L, 0.005 * L);

    // 4/5. 结合部双炮塔座（参考图侧视的两个大圆——嵌在颈箱上方两侧的塔座，
    //      大部分埋入船体，只露出上缘和侧鼓包；不是连接颈）
    add(new THREE.SphereGeometry(0.046 * L, 12, 10), -0.028 * L, 0.015 * L, 0);
    add(new THREE.SphereGeometry(0.046 * L, 12, 10), 0.028 * L, 0.015 * L, 0);

    // 6. 后段主舱（直接对接颈箱；参考图高 0.18L、宽 0.19L、长 0.38L）
    add(new THREE.BoxGeometry(0.19 * L, 0.18 * L, 0.38 * L), 0, 0.015 * L, 0.25 * L);
    // 7. 后段顶板（出檐面板层）
    add(new THREE.BoxGeometry(0.17 * L, 0.026 * L, 0.34 * L), 0, 0.118 * L, 0.24 * L);

    // 8. 腹部梯形垂体（按参考图斜角实量：前缘陡斜 ~66°，前下角为最深点）
    const vs = new THREE.Shape();
    vs.moveTo(0.10 * L, -0.075 * L);   // 前上（与主舱底面相接）
    vs.lineTo(0.44 * L, -0.075 * L);   // 后上
    vs.lineTo(0.44 * L, -0.125 * L);   // 后下（浅）
    vs.lineTo(0.155 * L, -0.195 * L);  // 前下（最深点）
    vs.closePath();
    const ventral = new THREE.ExtrudeGeometry(vs, { depth: 0.15 * L, bevelEnabled: false });
    ventral.translate(0, 0, -0.075 * L);
    ventral.rotateY(-Math.PI / 2);
    add(ventral, 0, 0, 0);

    // 9/10. 尾部上排引擎 ×2（后端面上方两侧，露出短圆柱）
    const engUp = new THREE.CylinderGeometry(0.028 * L, 0.028 * L, 0.09 * L, 12);
    engUp.rotateX(Math.PI / 2);
    add(engUp.clone(), -0.05 * L, 0.06 * L, 0.475 * L);
    add(engUp.clone(), 0.05 * L, 0.06 * L, 0.475 * L);
    // 11. 尾部下大引擎（中轴偏下）
    const engDn = new THREE.CylinderGeometry(0.044 * L, 0.044 * L, 0.10 * L, 12);
    engDn.rotateX(Math.PI / 2);
    add(engDn, 0, -0.032 * L, 0.48 * L);
    // 12. 司令塔（后段顶部中央的小方塔 + 顶球）
    add(new THREE.BoxGeometry(0.022 * L, 0.040 * L, 0.032 * L), 0, 0.151 * L, 0.36 * L);
    add(new THREE.SphereGeometry(0.012 * L, 8, 6), 0, 0.175 * L, 0.36 * L);

    // ── 合并为单 Mesh + 单条轮廓线框 ──
    const merged = mergeGeometries(parts, false);
    parts.forEach(p => p.dispose());
    if (merged) {
      const body = new THREE.Mesh(merged, bodyMat);
      group.add(body);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 18), wireMat);
      group.add(wire);
    } else {
      // 合并失败兜底：退回通用箱型（保持可玩）
      console.warn('[Battle3DOverlay] empire battleship merge failed, fallback to generic hull');
      const fb = new THREE.Mesh(new THREE.BoxGeometry(d.W, d.H, d.L * 0.72), bodyMat);
      group.add(fb);
    }

    // ── 喷口发光盘 ×3（品字形：2 上 1 下大，朝 +z）──
    const nozzles: [number, number, number, number][] = [
      [-0.05, 0.06, 0.525, 0.021],
      [0.05, 0.06, 0.525, 0.021],
      [0, -0.032, 0.535, 0.036],
    ];
    for (const [nx, ny, nz, nr] of nozzles) {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(nr * L, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      disc.position.set(nx * L, ny * L, nz * L);
      group.add(disc);
    }

    // ── 引擎光核 ×3（兼容原接口返回第一个）+ 尾焰亮核（下主喷口）──
    let glow: THREE.Mesh | null = null;
    for (const [nx, ny, nz] of [[-0.05, 0.06, 0.48], [0.05, 0.06, 0.48], [0, -0.032, 0.49]] as const) {
      const gm = new THREE.Mesh(new THREE.SphereGeometry(0.017 * L, 8, 6), glowMat);
      gm.position.set(nx * L, ny * L, nz * L);
      group.add(gm);
      if (!glow) glow = gm;
    }
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.027 * L, 8, 6), flameMat);
    flame.position.set(0, -0.032 * L, 0.545 * L);
    group.add(flame);

    // 全长 -0.50 ~ +0.535 ≈ 1.035L → 基本贴合占位
    group.scale.setScalar(0.96);
    group.userData.dims = d;
    return { group, flame, glow: glow! };
  }

  /** 每帧 diff 同步舰队 */
  private syncShips(dt: number) {
    const bs = this.battleScene;
    const fleets: any[] = bs.globalFleets || []; // any 来源：BattleScene.globalFleets
    const alive = new Set<string>();
    const now = performance.now() / 1000;

    fleets.forEach((fleet) => {
      (fleet.units || []).forEach((u: any) => {
        if (!u.sprite || u.hp <= 0) return;
        // unit 无稳定 id：用 fleetId + sprite 容器引用做 key（sprite 生命周期=unit 生命周期）
        const key = `${fleet.factionId}:${u.sprite._b3dKey || (u.sprite._b3dKey = Math.random().toString(36).slice(2))}`;
        alive.add(key);

        let entry = this.ships.get(key);
        if (!entry) {
          const fac = this.getFac(u.factionId) || {};
          const color = factionColor(fac);
          // 帝国侧判定：战役 factionId=2；模拟模式阵营 id 为提督 id，用 trait/faction 字段
          const isEmpire = u.factionId === 2
            || (fac as any).trait === 'empire'
            || (fac as any).faction === 'empire';
          // 专属旗舰：每舰队 units[0] 为旗舰；旗舰名经 fleet.commanderId（演习=fac.id，战役=序列化提督id）查提督数据
          const isFlagshipUnit = (fleet.units as any[]).indexOf(u) === 0;
          let flagshipKey: string | null = null;
          if (isFlagshipUnit) {
            const adm = (this.store.allAdmirals as any[]).find((a: any) => a.id === (fleet.commanderId ?? u.factionId));
            flagshipKey = adm?.flagshipName ? (FLAGSHIP_MODEL_ALIAS[adm.flagshipName] || null) : null;
          }
          const built = this.buildShip(String(u.classType || 'destroyer'), color, isEmpire, flagshipKey ?? undefined);
          this.shipGroup.add(built.group);
          const flameP: { t: number; jitter: number }[] = [];
          for (let fi = 0; fi < FLAME_PER_SHIP; fi++) {
            // 错峰起步：均匀分布相位 + 轻微随机，避免所有舰的尾焰整齐闪烁
            flameP.push({ t: (fi / FLAME_PER_SHIP) * FLAME_LIFE + Math.random() * 0.05, jitter: Math.random() });
          }
          entry = { key, group: built.group, flame: built.flame, glow: built.glow, u, fleet, lastX: u.sprite.x, lastY: u.sprite.y, cruiseY: 0, flameP, pendingModel: built.pendingModel, modelVer: built.modelVer ?? 0, isFlagship: isFlagshipUnit, flagshipKey: flagshipKey ?? undefined };
          this.ships.set(key, entry);
        } else if (entry.pendingModel && entry.pendingModel.geo && entry.pendingModel.version !== entry.modelVer) {
          // GLB 模型晚于舰船生成才就绪 → 原地换装（任意舰种通用）
          const pending = entry.pendingModel;
          this.shipGroup.remove(entry.group);
          entry.group.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!(m as any).isMesh && !(o as any).isLineSegments) return;
            // 模型几何为同型舰共享，不可销毁；仅释放兜底造型的私有资源
            if (m.geometry !== pending.geo && m.geometry !== pending.wire) m.geometry.dispose();
            const mat = m.material as THREE.Material;
            if (Array.isArray(mat)) mat.forEach(mm => mm.dispose()); else mat.dispose();
          });
          const fac = this.getFac(u.factionId) || {};
          const color = factionColor(fac);
          const isEmpire = u.factionId === 2
            || (fac as any).trait === 'empire'
            || (fac as any).faction === 'empire';
          const built = this.buildShip(String(u.classType || 'destroyer'), color, isEmpire, entry.flagshipKey);
          entry.group = built.group;
          entry.flame = built.flame;
          entry.glow = built.glow;
          entry.pendingModel = built.pendingModel;
          entry.modelVer = built.modelVer ?? 0;
          this.shipGroup.add(built.group);
        }

        const g = entry.group;
        const h = this.heightAtPx(u.sprite.x, u.sprite.y);
        // 位置：地形高度 + 巡航余量，指数平滑；再用硬性最小离地兜底防穿模。
        // 旧实现 clearance 太小（0.28√3R ≈ 0.49R），地形起伏 2.2R，战舰明显贴地爬坡。
        const targetY = h + this.cruiseClearance;
        if (entry.cruiseY === 0) entry.cruiseY = targetY;
        entry.cruiseY += (targetY - entry.cruiseY) * (1 - Math.exp(-dt / 0.9));
        let y = Math.max(entry.cruiseY, h + this.minClearance);
        let x = u.sprite.x, z = -u.sprite.y;

        // 星球 3D 径向避让：不允许战舰进入星球/要塞球体（兜底，主防线仍靠 2D 逻辑绕开）
        for (const p of this.planetCenters) {
          const R = p.r + this.hexR * 0.8;
          const vx = x - p.x, vy = y - p.y, vz = z - p.z;
          const d3 = Math.hypot(vx, vy, vz);
          if (d3 < R) {
            const k = R / Math.max(0.001, d3);
            x = p.x + vx * k; y = p.y + vy * k; z = p.z + vz * k;
          }
        }
        // 占领作战：参与舰船被临时推向外围，形成"其余舰船环绕星球"视觉
        // 只加一个随流程起落的径向偏移，不接管位置——2D 精灵仍在自由移动，避免结束后硬跳。
        let spreadX = 0, spreadZ = 0;
        for (const cap of this.captures.values()) {
          if (!cap.shipKeys.includes(key)) continue;
          const sdx = x - cap.planet.x, sdz = z - cap.planet.z;
          const sd = Math.hypot(sdx, sdz) || 1;
          const elapsed = now - cap.startT;
          const envelope = Math.max(0, Math.sin(Math.min(1, elapsed / (BOAT_OUT + BOAT_BACK + 0.4)) * Math.PI));
          const push = cap.planet.r * 1.3 * envelope;
          spreadX += (sdx / sd) * push;
          spreadZ += (sdz / sd) * push;
        }
        x += spreadX; z += spreadZ;
        g.position.set(x, y, z);

        // 朝向：优先移动向量，静止时用舰队 facingAngle
        // 舰首局部 -z，rotation.y=θ 后鼻向 = (-sinθ, -cosθ)；像素 forward=(cos fa, sin fa) → 世界 (cos fa, -sin fa)
        const dx = u.sprite.x - entry.lastX;
        const dz = -(u.sprite.y - entry.lastY);
        if (dx * dx + dz * dz > 0.01) {
          g.rotation.y = Math.atan2(-dx, -dz);   // sinθ=-ux, cosθ=-uz
        } else {
          const fa = fleet.facingAngle || 0;
          g.rotation.y = Math.atan2(-Math.cos(fa), Math.sin(fa));
        }
        entry.lastX = u.sprite.x;
        entry.lastY = u.sprite.y;

        // HP < 50%：受创色 + 火焰点变红放大
        const hpPct = u.maxHp > 0 ? u.hp / u.maxHp : 1;
        const damaged = hpPct < 0.5;
        const flameMat = entry.flame.material as THREE.MeshBasicMaterial;
        flameMat.color.setHex(damaged ? 0xff5533 : 0xaae6ff);
        entry.flame.scale.setScalar(damaged ? 1.6 : 1.0);
        (entry.glow.material as THREE.MeshBasicMaterial).color.setHex(damaged ? 0xff6644 : 0xffcc66);
      });
    });

    // 销毁已死 unit 的 mesh
    this.ships.forEach((entry, key) => {
      if (alive.has(key)) return;
      this.shipGroup.remove(entry.group);
      entry.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material;
          if (Array.isArray(m)) m.forEach(mm => mm.dispose()); else m.dispose();
        } else if (o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.ships.delete(key);
    });
  }

  // ---------- 3D 舰队 billboard 状态条 ----------
  /**
   * 补回被隐藏的 2D 跟随层：App.vue 的 `body.battle3d-mode .fleet-ui-layer{display:none}`
   * 把舰队 HP/补给条与姿态按钮（dispatchFleetCommand 全项目仅有的三处调用）一并藏了，
   * 导致 3D 模式下看不到舰队状态、也切不了姿态。这里用 3D→屏幕投影驱动 DOM 呈现，
   * 与战略层 ThreeStrategicMap 的全息板锚点同款做法（手动 project，便于接点击与 store action）。
   */
  private initBillboardLayer() {
    if (this.bbLayer) return;
    if (!document.getElementById(BB_STYLE_ID)) {
      const st = document.createElement('style');
      st.id = BB_STYLE_ID;
      st.textContent = BB_CSS;
      document.head.appendChild(st);
    }
    const layer = document.createElement('div');
    layer.className = 'b3d-bb-layer';
    this.container.appendChild(layer);
    this.bbLayer = layer;
  }

  private createBillboard(fleet: any, team: number): FleetBillboard {
    const root = document.createElement('div');
    root.className = 'b3d-bb';

    const nameEl = document.createElement('div');
    nameEl.className = 'b3d-bb-name';
    root.appendChild(nameEl);

    const hpBar = document.createElement('div');
    hpBar.className = 'b3d-bb-bar';
    const hpFill = document.createElement('div');
    hpBar.appendChild(hpFill);
    root.appendChild(hpBar);

    const spBar = document.createElement('div');
    spBar.className = 'b3d-bb-bar';
    const supplyFill = document.createElement('div');
    spBar.appendChild(supplyFill);
    root.appendChild(spBar);

    // 姿态按钮只给我方（team===1）：与 App.vue:35 的 v-if 口径一致
    const stanceBtns: HTMLButtonElement[] = [];
    if (team === 1) {
      const wrap = document.createElement('div');
      wrap.className = 'b3d-bb-stances';
      for (const stance of ['search', 'siege', 'defend'] as const) {
        const btn = document.createElement('button');
        btn.className = 'b3d-bb-btn';
        btn.dataset.stance = stance;
        btn.textContent = stance === 'search' ? '索敌' : stance === 'siege' ? '攻坚' : '驻守';
        // 阻止冒泡到 canvas：否则点按钮会连带触发地块拾取/框选
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fid = fleet?.id;
          if (fid === undefined) return;
          const fn = this.store?.dispatchFleetCommand;
          if (typeof fn === 'function') fn(fid, 'stance', stance);
          else this.opts.onError?.(`[3D] 姿态切换失败：store.dispatchFleetCommand 不可用`);
        });
        wrap.appendChild(btn);
        stanceBtns.push(btn);
      }
      root.appendChild(wrap);
    }

    this.bbLayer!.appendChild(root);
    return {
      root, nameEl, hpFill, supplyFill, stanceBtns,
      lastStance: '', lastTeam: team, lastHpPct: -1, lastSupply: -1,
    };
  }

  private destroyBillboard(bb: FleetBillboard) {
    bb.root.remove();
  }

  /** 每帧投影更新：舰队 3D 锚点（所属舰船质心 + 抬高）→ 屏幕坐标 */
  private updateBillboards() {
    if (!this.bbLayer) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;

    // 1) 按舰队聚合质心（复用 Map，避免每帧分配）
    const acc = this.bbAccum;
    acc.clear();
    this.ships.forEach((entry) => {
      const fleet = entry.fleet;
      if (!fleet) return;
      const fid = fleet.id !== undefined ? fleet.id : fleet.factionId;
      const key = `f${fid}`;
      let a = acc.get(key);
      if (!a) { a = { fleet, n: 0, sx: 0, sy: 0, sz: 0 }; acc.set(key, a); }
      a.n++;
      a.sx += entry.group.position.x;
      a.sy += entry.group.position.y;
      a.sz += entry.group.position.z;
    });

    const alive = new Set<string>();
    const camPos = this.camera.position;

    acc.forEach((a, key) => {
      alive.add(key);
      const fleet = a.fleet;
      const fac = this.getFac(fleet.factionId) || {};
      const team = fac.team ?? (fleet.factionId === 1 ? 1 : 2);
      const units: any[] = fleet.units || [];

      // 数据：HP 取全舰求和，补给取旗舰（与 BattleScene 生成 fleetsUI 的口径一致）
      let hp = 0, maxHp = 0;
      units.forEach((u: any) => { hp += u.hp || 0; maxHp += u.maxHp || 0; });
      const supply = units.length ? (units[0].supply ?? 100) : 100;
      const hpPct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;

      let bb = this.billboards.get(key);
      if (!bb) {
        bb = this.createBillboard(fleet, team);
        this.billboards.set(key, bb);
      }

      // 文本/数值 diff 后才写 DOM
      const name = fac.name || (team === 1 ? '我方舰队' : '敌方舰队');
      if (bb.lastTeam !== team) { bb.lastTeam = team; }
      if (bb.nameEl.textContent !== `${name} ${units.length}艘`) {
        bb.nameEl.textContent = `${name} ${units.length}艘`;
      }
      const teamColor = team === 1 ? '#4a9eff' : '#ff5544';
      if (bb.nameEl.style.color !== teamColor) bb.nameEl.style.color = teamColor;
      if (bb.lastHpPct !== hpPct) {
        bb.lastHpPct = hpPct;
        if (bb.hpFill) {
          bb.hpFill.style.width = `${(hpPct * 100).toFixed(1)}%`;
          bb.hpFill.style.background = team === 1 ? '#4a9eff' : '#ff5544';
        }
      }
      if (bb.lastSupply !== supply) {
        bb.lastSupply = supply;
        if (bb.supplyFill) {
          bb.supplyFill.style.width = `${Math.max(0, Math.min(100, supply)).toFixed(1)}%`;
          bb.supplyFill.style.background = supply > 30 ? '#22c55e' : '#f59e0b';
        }
      }
      const stance = String(fleet.stance || '');
      if (bb.lastStance !== stance) {
        bb.lastStance = stance;
        bb.stanceBtns.forEach((b) => {
          b.classList.toggle('active', b.dataset.stance === stance);
        });
      }

      // 2) 投影：质心抬到舰船上方（约 1.6 格）作为标签锚点
      const v = this.bbProjV.set(a.sx / a.n, a.sy / a.n + this.hexR * 1.6, a.sz / a.n);
      const dist = v.distanceTo(camPos);
      v.project(this.camera);
      const inFrustum = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      // 过远淡化/隐藏：地形遮挡不做精确射线检测（3169 格 InstancedMesh 逐帧 raycast 太贵），
      // 用距离衰减近似——这与"远处标签让位给战场"的观感目标一致。
      const fade = THREE.MathUtils.clamp(1.35 - dist / (this.mapSpan * 1.8 || 1), 0.12, 1);
      const show = inFrustum && dist < (this.mapSpan * 2.4 || Infinity);
      if (!show) {
        if (bb.root.style.display !== 'none') bb.root.style.display = 'none';
        return;
      }
      if (bb.root.style.display === 'none') bb.root.style.display = '';
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      bb.root.style.transform = `translate(-50%,-100%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      bb.root.style.opacity = fade.toFixed(2);
      bb.root.style.zIndex = String(Math.max(1, Math.round(2000 - dist / (this.mapSpan || 1) * 100)));
    });

    // 3) 回收已解散舰队的 DOM
    this.billboards.forEach((bb, key) => {
      if (alive.has(key)) return;
      this.destroyBillboard(bb);
      this.billboards.delete(key);
    });
  }

  // ---------- 指挥制后勤战 3D 可视化 ----------
  /** 像素地面高度：指挥制纯宇宙模式无地形，恒 0；3D 沙盘模式走 heightAtPx */
  private groundYAt(xPix: number, yPix: number): number {
    return this.spaceMode ? 0 : this.heightAtPx(xPix, yPix);
  }

  /** 水平圆圈（XZ 平面 LineLoop），半径以世界单位计 */
  private makeSupplyRing(radius: number, color: number, opacity: number, segments = 72): THREE.LineLoop {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    return new THREE.LineLoop(geo, mat);
  }

  private disposeObject(o: any) {
    o?.geometry?.dispose?.();
    const m = o?.material;
    if (Array.isArray(m)) m.forEach((mm: any) => mm?.dispose?.());
    else m?.dispose?.();
  }

  /** 每帧同步后勤可视化：后勤站 / 星球中继 / 运输舰 / 舰队补给状态环 */
  private updateSupplyViz() {
    // 开关：showSupplyChain 在 settingsStore；无 pinia（无头测试台）时默认开
    let show = true;
    try { show = (useSettingsStore() as any)?.showSupplyChain !== false; } catch { /* headless 默认开 */ }
    if (!show || this.mapSpan <= 0) {
      if (this.supplyGroup) this.supplyGroup.visible = false;
      return;
    }
    if (!this.supplyGroup) {
      this.supplyGroup = new THREE.Group();
      this.supplyGroup.name = 'supplyViz';
      this.scene.add(this.supplyGroup);
    }
    this.supplyGroup.visible = true;

    const bs: any = this.battleScene;
    const R = this.hexR;
    const teamColor = (team: number | undefined) => (team === 1 ? 0x22c55e : 0xa855f7);

    // ── 1) 后勤站：castlePos 处八面体 + SUPPLY_SOURCE_RADIUS 补给圈（阵营色）──
    const facs: any[] = (this.store as any)?.factions || [];
    const seenFac = new Set<number>();
    facs.forEach((f: any) => {
      if (!f?.castlePos) return;
      const tf = this.getFac(f.id) || f;
      const team = tf.team ?? f.team;
      seenFac.add(f.id);
      let m = this.supCastle.get(f.id);
      if (!m) {
        const col = teamColor(team);
        const oct = new THREE.Mesh(
          new THREE.OctahedronGeometry(R * 1.1),
          new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, transparent: true, opacity: 0.92 }),
        );
        const ring = this.makeSupplyRing(SUPPLY_SOURCE_RADIUS, col, 0.26);
        this.supplyGroup!.add(oct, ring);
        m = { oct, ring };
        this.supCastle.set(f.id, m);
      }
      const gy = this.groundYAt(f.castlePos.x, f.castlePos.y);
      m.oct.position.set(f.castlePos.x, gy + R * 2.2, -f.castlePos.y);
      ((m.oct.material as THREE.MeshPhongMaterial).color).setHex(teamColor(team));
      m.ring.position.set(f.castlePos.x, gy + R * 0.3, -f.castlePos.y);
      (m.ring.material as THREE.LineBasicMaterial).color.setHex(teamColor(team));
    });
    this.supCastle.forEach((m, id) => {
      if (seenFac.has(id)) return;
      this.supplyGroup!.remove(m.oct, m.ring);
      this.disposeObject(m.oct); this.disposeObject(m.ring);
      this.supCastle.delete(id);
    });

    // ── 2) 星球中继：小圈（中立灰 0x9ca3af；占领后转阵营色）──
    const tiles: any[] = bs.tilesList || [];
    const seenTiles = new Set<any>();
    tiles.forEach((t: any) => {
      if (t?.type !== 'planet') return;
      seenTiles.add(t);
      const tf = t.ownerId > 0 ? this.getFac(t.ownerId) : null;
      const col = tf ? teamColor(tf.team) : 0x9ca3af;
      let ring = this.supPlanets.get(t);
      if (!ring) {
        ring = this.makeSupplyRing(R * 1.6, col, 0.55, 48);
        this.supplyGroup!.add(ring);
        this.supPlanets.set(t, ring);
      }
      (ring.material as THREE.LineBasicMaterial).color.setHex(col);
      ring.position.set(t.x, this.groundYAt(t.x, t.y) + R * 0.3, -t.y);
    });
    this.supPlanets.forEach((ring, t) => {
      if (seenTiles.has(t)) return;
      this.supplyGroup!.remove(ring);
      this.disposeObject(ring);
      this.supPlanets.delete(t);
    });

    // ── 3) 运输舰：橙色锥体 + SUPPLY_AUX_RADIUS 补给圈 + 到母队连线（表现前出/返航）──
    const auxShips: any[] = bs.auxShips || [];
    const seenAux = new Set<any>();
    auxShips.forEach((aux: any) => {
      const fl = aux?.fleet;
      if (!fl || !fl.units || fl.units.length === 0 || !aux.unit) return;
      const key = aux.unit;   // aux 包装对象每帧重建，unit 引用稳定
      seenAux.add(key);
      const ax = fl.x + (aux.ox || 0);
      const ay = fl.y + (aux.oy || 0);
      let m = this.supAux.get(key);
      if (!m) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(R * 0.5, R * 1.3, 4),
          new THREE.MeshPhongMaterial({ color: 0xfb923c, emissive: 0xfb923c, emissiveIntensity: 0.35, transparent: true, opacity: 0.95 }),
        );
        const ring = this.makeSupplyRing(SUPPLY_AUX_RADIUS, 0xfb923c, 0.30, 56);
        const linkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const link = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.5, depthWrite: false }));
        this.supplyGroup!.add(cone, ring, link);
        m = { cone, ring, link };
        this.supAux.set(key, m);
      }
      const gyA = this.groundYAt(ax, ay);
      const gyF = this.groundYAt(fl.x, fl.y);
      m.cone.position.set(ax, gyA + R * 1.6, -ay);
      m.ring.position.set(ax, gyA + R * 0.3, -ay);
      const pos = (m.link.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, fl.x, gyF + R * 0.5, -fl.y);
      pos.setXYZ(1, ax, gyA + R * 1.6, -ay);
      pos.needsUpdate = true;
    });
    this.supAux.forEach((m, key) => {
      if (seenAux.has(key)) return;
      this.supplyGroup!.remove(m.cone, m.ring, m.link);
      this.disposeObject(m.cone); this.disposeObject(m.ring); this.disposeObject(m.link);
      this.supAux.delete(key);
    });

    // ── 4) 舰队补给状态环：在链绿环 / 断链红环 ──
    const supplyInfo: Map<any, any> = bs.supplyInfo || new Map();
    const seenFl = new Set<any>();
    supplyInfo.forEach((info: any, fl: any) => {
      if (!fl?.units || fl.units.length === 0) return;
      seenFl.add(fl);
      const col = info.inSupply ? 0x22c55e : 0xef4444;
      let ring = this.supFleetRings.get(fl);
      if (!ring) {
        ring = this.makeSupplyRing(R * 1.4, col, 0.65, 48);
        this.supplyGroup!.add(ring);
        this.supFleetRings.set(fl, ring);
      }
      (ring.material as THREE.LineBasicMaterial).color.setHex(col);
      ring.position.set(fl.x, this.groundYAt(fl.x, fl.y) + R * 0.35, -fl.y);
    });
    this.supFleetRings.forEach((ring, fl) => {
      if (seenFl.has(fl)) return;
      this.supplyGroup!.remove(ring);
      this.disposeObject(ring);
      this.supFleetRings.delete(fl);
    });
  }

  // ---------- 占领作战视觉 ----------
  /**
   * 星球易主时播放作战过程：参与舰船环绕 → 投放登陆艇 → 抵达触发能量罩脉冲 → 返航归队。
   * 纯视觉层，不改任何游戏逻辑（归属切换已由 BattleScene 完成）。
   */
  private startCapture(px: number, py: number, factionId: number, color: number) {
    const key = `${Math.round(px)},${Math.round(py)}`;
    if (this.captures.has(key)) return;

    const r = this.hexR * 1.5;
    const h = this.heightAtPx(px, py);
    const planet = { x: px, y: h + r * 0.8, z: -py, r };

    // 挑同阵营离星球最近的 3 艘作为登陆艇母舰
    const picks: { key: string; d2: number }[] = [];
    this.ships.forEach((entry, k) => {
      if (entry.fleet?.factionId !== factionId) return;
      const p = entry.group.position;
      picks.push({ key: k, d2: (p.x - px) * (p.x - px) + (p.z + py) * (p.z + py) });
    });
    picks.sort((a, b) => a.d2 - b.d2);
    const shipKeys = picks.slice(0, 3).map(p => p.key);
    if (shipKeys.length === 0) return;

    this.captures.set(key, { planet, faction: factionId, color, shipKeys, startT: performance.now() / 1000, pulseDone: false });

    shipKeys.forEach((sk, i) => {
      const entry = this.ships.get(sk);
      if (!entry) return;
      const p = entry.group.position;
      this.boats.push({
        srcShipKey: sk,
        captureKey: key,
        sx: p.x, sy: p.y, sz: p.z,
        tx: planet.x, ty: h + r * 1.35, tz: planet.z,
        t: -i * 0.16, phase: 'out', faction: factionId,
      });
    });
  }

  /** 登陆艇每帧推进（合并 InstancedMesh，1 draw call） */
  private updateBoats(dt: number) {
    if (this.boats.length === 0) {
      if (this.boatInst.count !== 0) this.boatInst.count = 0;
      return;
    }
    const tmpC = new THREE.Color();
    let n = 0;
    for (let i = this.boats.length - 1; i >= 0; i--) {
      // 实例池写满：停笔（越界 setMatrixAt 会静默写坏 instanceMatrix，宁可漏画）
      if (n >= BOAT_MAX) break;
      const b = this.boats[i];
      b.t += dt;
      let k: number;
      if (b.t < 0) k = 0;                                  // 发射间隔
      else if (b.phase === 'out') {
        k = Math.min(1, b.t / BOAT_OUT);
        if (k >= 1) {
          b.phase = 'back'; b.t = 0;
          // 抵达星球 → 触发一次能量罩脉冲（半球罩扣住星球）
          const cap = this.captures.get(b.captureKey);
          if (cap && !cap.pulseDone) {
            cap.pulseDone = true;
            this.spawnShield(
              new THREE.Vector3(cap.planet.x, cap.planet.y - cap.planet.r * 0.8, cap.planet.z),
              new THREE.Vector3(0, -1, 0), cap.planet.r * 2.4, cap.color);
          }
        }
      } else {
        k = 1 - Math.min(1, b.t / BOAT_BACK);
        if (b.t >= BOAT_BACK) { this.boats.splice(i, 1); continue; }
      }
      const e = k * k * (3 - 2 * k);                       // smoothstep
      // 起点跟随母舰：舰船仍在移动，艇从当前位置出发 / 归队
      const src = this.ships.get(b.srcShipKey);
      const sp = src ? src.group.position : null;
      const sx = sp ? sp.x : b.sx, sy = sp ? sp.y : b.sy, sz = sp ? sp.z : b.sz;
      const x = sx + (b.tx - sx) * e;
      const y = sy + (b.ty - sy) * e + Math.sin(e * Math.PI) * this.hexR * 0.35;
      const z = sz + (b.tz - sz) * e;
      this.boatDummy.position.set(x, y, z);
      this.boatDummy.scale.setScalar(this.hexR * 0.07);
      this.boatDummy.updateMatrix();
      this.boatInst.setMatrixAt(n, this.boatDummy.matrix);
      const fac = this.getFac(b.faction);
      tmpC.setHex(fac ? factionColor(fac) : 0xffffff);
      this.boatInst.setColorAt(n, tmpC);
      n++;
    }
    this.boatInst.count = n;
    this.boatInst.instanceMatrix.needsUpdate = true;
    if (this.boatInst.instanceColor) this.boatInst.instanceColor.needsUpdate = true;
  }

  /** 占领流程超时清理 */
  private updateCaptures() {
    if (this.captures.size === 0) return;
    const now = performance.now() / 1000;
    for (const [key, cap] of this.captures) {
      if (now - cap.startT > BOAT_OUT + BOAT_BACK + 0.6) this.captures.delete(key);
    }
  }

  // ---------- 特效 ----------
  private handleFx(e: Fx3dEvent) {
    if (e.kind === 'laser' && e.from && e.to) {
      const from = this.pxToWorld(e.from.x, e.from.y, this.heightAtPx(e.from.x, e.from.y) + this.cruiseClearance);
      const to = this.pxToWorld(e.to.x, e.to.y, this.heightAtPx(e.to.x, e.to.y) + this.cruiseClearance);
      this.spawnLaser(from, to, e.color, e.power);
    } else if (e.kind === 'shield' && e.at) {
      const at = this.pxToWorld(e.at.x, e.at.y, this.heightAtPx(e.at.x, e.at.y) + this.cruiseClearance * 0.6);
      const dir = e.dir ? new THREE.Vector3(e.dir.x, 0, -e.dir.y).normalize() : new THREE.Vector3(0, 0, 1);
      const shipLen = this.dimsOf('battleship').L;
      this.spawnShield(at, dir, shipLen, e.color);
    } else if (e.kind === 'hit' && e.at) {
      const at = this.pxToWorld(e.at.x, e.at.y, this.heightAtPx(e.at.x, e.at.y) + this.cruiseClearance * 0.6);
      this.spawnHit(at, e.color);
    } else if (e.kind === 'capture' && e.at && e.factionId !== undefined) {
      this.startCapture(e.at.x, e.at.y, e.factionId, e.color);
    }
  }

  /** 激光束（原型 spawnLaser：CylinderGeometry 光束，0.4s 淡出） */
  private spawnLaser(from: THREE.Vector3, to: THREE.Vector3, color: number, power?: number) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1) return;
    const radius = power !== undefined && power >= 2 ? 0.022 * this.hexR : 0.035 * this.hexR;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, len, 5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(m);
    this.lasers.push({ mesh: m, life: 0.4, max: 0.4 });
  }

  /** 定向半球护盾涟漪（原型 spawnShield 原样移植，按阵营色着色） */
  private spawnShield(hitPoint: THREE.Vector3, incomingDir: THREE.Vector3, shipLen: number, color: number) {
    const outward = incomingDir.clone().negate().normalize();
    const L = Math.max(shipLen, this.hexR * 0.5);
    const R1 = L * 1.15;

    let s = this.shields.find(x => !x.active);
    if (!s) {
      const geo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        vertexShader: SHIELD_VS, fragmentShader: SHIELD_FS,
        uniforms: {
          uColor: { value: new THREE.Color(0x6fd0ff) },
          uTime: { value: 0 }, uAlpha: { value: 1 },
          uRingPos: { value: 0 }, uGridScale: { value: 9 },
        },
        transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      s = { mesh, mat, active: false, t: 0, R0: 0, R1: 0, R2: 0 };
      this.shields.push(s);
    }
    s.active = true; s.t = 0;
    s.R0 = L * 0.35; s.R1 = R1; s.R2 = L * 1.55;
    s.mesh.visible = true;
    s.mesh.position.copy(hitPoint).addScaledVector(outward, -s.R0 * 0.25);
    s.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    s.mesh.scale.setScalar(s.R0);
    // 阵营亮色：提亮到 wire 级
    (s.mat.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(wireGain(color));
    s.mat.uniforms.uGridScale.value = Math.max(6, Math.round((L / this.hexR) * 9));
    s.mat.uniforms.uTime.value = 0;
    s.mat.uniforms.uAlpha.value = 1;
    s.mat.uniforms.uRingPos.value = 0;
  }

  /** 命中小闪光（Sprite 加法混合，0.25s） */
  private spawnHit(at: THREE.Vector3, color: number) {
    const size = this.hexR * 0.55;
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},0.9)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(at);
    sp.scale.setScalar(size);
    this.scene.add(sp);
    this.hits.push({ sprite: sp, life: 0.25, max: 0.25 });
  }

  private updateFx(dt: number) {
    // laser 淡出
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const L = this.lasers[i];
      L.life -= dt;
      (L.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, L.life / L.max) * 0.95;
      if (L.life <= 0) {
        this.scene.remove(L.mesh);
        L.mesh.geometry.dispose();
        (L.mesh.material as THREE.Material).dispose();
        this.lasers.splice(i, 1);
      }
    }
    // hit 淡出
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const H = this.hits[i];
      H.life -= dt;
      (H.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, H.life / H.max);
      H.sprite.scale.setScalar(this.hexR * (0.55 + (1 - H.life / H.max) * 0.5));
      if (H.life <= 0) {
        this.scene.remove(H.sprite);
        (H.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (H.sprite.material as THREE.SpriteMaterial).dispose();
        this.hits.splice(i, 1);
      }
    }
    // shield 三段动画（原型 updateShields）
    for (const s of this.shields) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / SHIELD_DUR;
      if (k >= 1) { s.active = false; s.mesh.visible = false; continue; }
      let r: number, a: number;
      if (k < 0.22) {
        r = s.R0 + (s.R1 - s.R0) * easeOutBack(k / 0.22);
        a = Math.min(1, k / 0.07);
      } else if (k < 0.52) {
        r = s.R1; a = 1;
      } else {
        const x = (k - 0.52) / 0.48;
        r = s.R1 + (s.R2 - s.R1) * (1 - Math.pow(1 - x, 2));
        a = Math.pow(1 - x, 1.8);
      }
      s.mesh.scale.setScalar(r);
      s.mat.uniforms.uTime.value = k;
      s.mat.uniforms.uAlpha.value = a;
      s.mat.uniforms.uRingPos.value = Math.min(1.15, (k / 0.55) * 1.15);
    }
  }

  // ---------- 点击拾取 ----------
  private handlePick(e: PointerEvent) {
    if (this.dragMoved) return;
    if (this.spaceMode) {
      // 指挥制：无六棱柱可拾取，射线对准 y=0 基准面 → 最近地块 → 中继给 BattleScene
      if (!this.spaceBuilt) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPt = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plane, hitPt)) return;
      const px = hitPt.x, py = -hitPt.z;
      const tiles: any[] = (this.battleScene as any).tilesList || [];
      let best: any = null, bestD = Infinity;
      for (const t of tiles) {
        const d = (t.x - px) * (t.x - px) + (t.y - py) * (t.y - py);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (!best || bestD > this.hexR * this.hexR * 4) return;
      this.selRing.position.set(best.x, this.hexR * 0.15, -best.y);
      this.selRing.visible = true;
      this.syncTileClick(best);
      return;
    }
    if (!this.hexInst) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.hexInst);
    if (!hits.length || hits[0].instanceId === undefined) return;
    const meta = this.tileMeta[hits[0].instanceId];
    if (!meta) return;

    // 选中高亮环
    this.selRing.position.set(meta.t.x, meta.h + this.hexR * 0.04, -meta.t.y);
    this.selRing.visible = true;

    // 接入 BattleScene 原有点击逻辑（见 syncTileClick 注释）
    this.syncTileClick(meta.t);
  }

  /**
   * 3D 点击 → 等价 2D 点击。
   * BattleScene.handleTileClick 签名为 (pointer: Phaser.Input.Pointer, tile, poly, txt)，
   * 且首行用 pointer.getDistance() > 30 区分拖拽、pointer.button 区分左右键。
   * 直接复用：构造最小 Phaser pointer 替身（getDistance=0 / button=0，视角拖拽已由
   * overlay 自己的 dragMoved 判定过滤），poly/txt 传 tile 上挂的原生 sprite/text。
   * handleTileClick 内部通过 store 写 selectedTile/gold/ownerId 并调 updateSupplyNetwork，
   * 不依赖 Phaser 场景对象本身，替身方案可行。
   */
  private syncTileClick(tile: any) {
    const bs = this.battleScene;
    const handle = bs.handleTileClick;
    if (typeof handle !== 'function') {
      this.opts.onTileClick?.(tile);
      return;
    }
    const fakePointer = {
      button: 0,
      getDistance: () => 0,
      worldX: tile.x,
      worldY: tile.y,
    };
    try {
      // private 方法经 any 调用（bind 保证 this 指向 BattleScene）
      void handle.call(bs, fakePointer, tile, tile.sprite, tile.text);
    } catch (err) {
      console.warn('[Battle3DOverlay] tile click relay failed:', err);
      this.opts.onTileClick?.(tile);
    }
  }

  // ---------- 主循环 ----------
  private tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // 首帧同步地形（等 BattleScene create() 完成）
    if (!this.hexInst && !this.spaceBuilt) {
      const bs = this.battleScene;
      if (bs && bs.tilesList && bs.tilesList.length > 0) {
        if (this.spaceMode) this.buildSpaceWorld();
        else this.buildTerrain();
        if ((this.hexInst || this.spaceBuilt) && !this.ready) {
          this.ready = true;
          this.opts.onReady?.();
        }
      }
    } else {
      this.refreshTileOwners();
      this.syncShips(dt);
      this.updateBillboards();
      // 后勤可视化仅指挥制（spaceMode）：hex/crt 路径保持零改动
      if (this.spaceMode) this.updateSupplyViz();
      this.updateFlames(dt);
      drainFx3d().forEach(e => this.handleFx(e));
      this.updateFx(dt);
      this.updateBoats(dt);
      this.updateCaptures();
      if (this.selRing.visible) {
        const mat = this.selRing.material as THREE.LineBasicMaterial;
        mat.opacity = Math.max(0.45, mat.opacity - dt * 1.1);
      }
    }

    this.controls.update();
    // 空气透视：跟随相机距离的相对雾。
    // near = 相机到注视点距离 + 1.05×地图跨度，far 再往外推 1.2×跨度。
    // 地图本体（以 target 为中心、半径约 0.5×mapSpan）永远落在雾前，
    // 雾只作用于地图后方的远景背景，拉远视角也不会吃掉外圈地块
    // （旧版 0.32×mapSpan 的 near 会吞掉外圈约 36% 地块，实机截图发灰的根因）。
    if (this.scene.fog instanceof THREE.Fog && this.mapSpan > 0) {
      const camD = this.camera.position.distanceTo(this.controls.target);
      this.scene.fog.near = camD + this.mapSpan * 1.05;
      this.scene.fog.far = this.scene.fog.near + this.mapSpan * 1.2;
      // 远裁剪面与雾同源同步：拉远/缩放时地形始终留在视锥内
      this.syncClipPlanes(camD);
    }
    // CRT 合成：离屏渲染主场景 → 全屏后处理
    this.crtU.uTime.value = this.clock.elapsedTime;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  // ---------- 公开方法 ----------
  /**
   * 视角预设（UI 一键按钮调用）。
   * 'tilt' = 27° 低角侧视（polar = 90°-27° ≈ 1.10 rad）；
   * 'top'  = 正俯视（polar ≈ 0.02，OrbitControls 极角不能严格为 0）。
   * 相机半径保持当前距离不变，只改俯仰角。
   */
  setViewPreset(preset: 'tilt' | 'top') {
    if (this.disposed) return;
    const target = this.controls.target;
    const dist = Math.max(this.hexR * 8, this.camera.position.distanceTo(target));
    const polar = preset === 'top' ? 0.02 : Math.PI / 2 - (27 * Math.PI) / 180;
    // 保持当前方位角，只改俯仰
    const offset = this.camera.position.clone().sub(target);
    const azimuth = Math.atan2(offset.x, offset.z);
    this.camera.position.set(
      target.x + dist * Math.sin(polar) * Math.sin(azimuth),
      target.y + dist * Math.cos(polar),
      target.z + dist * Math.sin(polar) * Math.cos(azimuth)
    );
    this.camera.lookAt(target);
    this.controls.update();
  }

  /**
   * 视锥裁剪面跟随地图尺度。
   * far 固定 4000 是"开局近黑、只剩零散星点"的真因：hexRadius 由 BattleScene 按总舰数
   * 在 26/32/38/44/50 五档浮动（演习模式恒 ≥38），相机到地图远侧达 4,306（26）～
   * 8,277（50），拉到 maxDistance 的 50 档更是 ≈12,964，整片地形被切在远裁剪面之外。
   * 三角不等式保证：地图最远角点离相机 ≤ camD + 0.71×span，故 far = camD + 1.5×span 恒有余量。
   * near 用 span×0.01 而非 0.1：far 到万级时深度比收窄可显著改善 z-fighting。
   */
  private syncClipPlanes(camD: number, force = false) {
    if (this.mapSpan <= 0) return;
    const wantFar = camD + this.mapSpan * 1.5;
    const wantNear = Math.max(0.1, this.mapSpan * 0.01);
    // 变化不到 1% 就不重算投影矩阵（updateProjectionMatrix 每帧调用有成本）
    if (!force && Math.abs(this.camera.far - wantFar) / wantFar <= 0.01) return;
    this.camera.far = wantFar;
    this.camera.near = wantNear;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    // 离屏 RT 与 CRT 扫描线频率都要跟新尺寸走
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.rt.setSize(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
    this.crtU.uRes.value.set(w, h);
  }

  destroy() {
    this.disposed = true;
    this.boats.length = 0;
    this.captures.clear();
    this.boatInst.count = 0;
    this.ships.clear();
    // billboard DOM 全量回收（注入的样式表用 id 去重、无副作用，复用不删）
    this.billboards.forEach((bb) => this.destroyBillboard(bb));
    this.billboards.clear();
    this.bbAccum.clear();
    // 后勤可视化引用表清空（几何体/材质由下方 scene.traverse 统一释放）
    this.supCastle.clear();
    this.supPlanets.clear();
    this.supAux.clear();
    this.supFleetRings.clear();
    this.supplyGroup = null;
    if (this.bbLayer) {
      this.bbLayer.remove();
      this.bbLayer = null;
    }
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material;
        if (Array.isArray(m)) m.forEach(mm => mm.dispose()); else m.dispose();
      } else if (o instanceof THREE.Sprite) {
        // P2 修复：Sprite 不是 Mesh 子类，命中闪光残留时其贴图/材质必须单独释放
        const sm = o.material as THREE.SpriteMaterial;
        sm.map?.dispose();
        sm.dispose();
      } else if (o instanceof THREE.Line) {
        // THREE.Line 覆盖 LineLoop（补给圈）与 Line（运输舰连线）；LineSegments 是其子类，原行为不变
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      } else if (o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.postScene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.rt.dispose();
    this.renderer.dispose();
    // P0：WebGL context 必须显式释放。dispose() 只清 three 侧资源，不归还浏览器 context。
    // Phaser 本体已占 1 个，浏览器上限约 16，每次进出 3D 战斗泄漏 1 个 → 约 16 次后新 context
    // 申请失败、画面全黑。顺序固定：先 dispose 再 forceContextLoss（先丢 context 会让
    // dispose 内部的 GL 调用打到已失效的 context 上报错）。
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    // 清空特效桥残留，防止下次战斗串场
    drainFx3d();
  }
}
