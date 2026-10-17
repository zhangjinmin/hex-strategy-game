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
// [v23 特效真源] 尾焰/激光/护盾/爆闪的几何·材质·时序统一在本模块实现
//   ⇒ 战场与"模型巡览"共用同一套，杜绝"改一边忘一边"（用户实报两者观感不一致）。
import {
  makeShieldEntry, shieldFire, shieldStep,
  buildLaserEntry, laserStep, disposeLaserEntry,
  buildHitEntry, hitStep, disposeHitEntry,
  type LaserEntry, type HitEntry, type ShieldEntry,
} from './battleFx';
import { drainFx3d, type Fx3dEvent } from '../battle3dFx';
import { projectFleetRepresentation, projectFleetRepresentationBySlot } from '../combatRepresentation';
// ★ v8 运输舰 LOD：**自身 px** 是唯一输入（纯逻辑模块，可被台架真跑；见 auxLod.ts 头注）
import { auxLodPx, auxLodVerdict, auxGrowK } from './auxLod';
// [切片传送入场] 纯逻辑层（零 three 依赖，可被离线台架真跑）—— 见 docs/design/3d-tactical-battle/35-*
import {
  ENTRY_CFG_DEFAULT, ENTRY_REG_WINDOW_SEC,
  SLICE_ENTRY_ENABLED_DEFAULT,
  ENTRY_AUTO_FOCUS, ENTRY_FOCUS_CAMY_K, ENTRY_FOCUS_ELEV, ENTRY_GATE_VISIBLE,
  GATE_STYLE, GATE_STYLE_PARAMS, ENTRY_GATE_MIN_HALF, gateStyleForEntryFx, type GateStyleId,
  entryApplyClipping, entryGateAccumulate, entryGateCenterU, entryGateCenterV,
  entryGateEmptyBox, entryGateFront, entryGateMargin, entryGateSizeU, entryGateSizeV,
  entryGateValid, entryGateWritePlanes, entryGlowAmt, entryShipProgress,
  type EntryCfg, type EntryGateBox, type EntryShip, type SliceMatLike,
} from '../entrySlice';
// [v3.1 · S] 球体入场的**几何 / 运动学纯逻辑层**（零 three 依赖 ⇒ 离线台架可真跑）
import {
  buildSphereTiles, disposeTree, sphereBoundsFit, sphereCoreAmt, sphereGlowAmt,
  sphereRevealAmt, sphereRevealDelayByRadius, sphereTileMotion,
  SPHERE_CORE_OPACITY, SPHERE_CORE_R_K, SPHERE_DISP_SIL_FLOOR, SPHERE_GLOW_HALF_K, SPHERE_GLOW_OPACITY,
  SPHERE_GLOW_R_K, SPHERE_MAX_INSTANCES, SPHERE_TILE_CORE_WHITEN, SPHERE_TILE_EDGE_DIM,
  SPHERE_TILE_FACE_FLOOR, SPHERE_TILE_FACE_LIFT,
  SPHERE_MOTION_DEFAULT, SPHERE_RADIUS_MIN_K, SPHERE_RADIUS_PAD, SPHERE_REVEAL_DEFAULT,
  type DisposableNode, type SphereFit, type SphereFitItem, type SphereMotionCfg,
  type SphereTile, type SphereTileSet,
} from './entrySphere';
// [v5 · D] **传送门（连续光带门框 · 生长 / 收回）**入场的几何 / 运动学纯逻辑层
//   （零 three 依赖 ⇒ 离线台架可真跑）。v5 把门框从"离散能量块"重做为"连续发光带 + 微随机曲线 + 流动光"。
//   v6：噪声"电弧化"（高频 / 脉冲调制 / 尖峰化）；
//   v7：**门内位面 + 扫描前沿光带 `scan` 整块删除**（门内为空 ⇒ 没有任何横贯光条、不遮舰队），
//   陪衬包络由 `doorAuxFadeK`（v6 的 `doorPlaneFadeK` 更名）承担。
import {
  doorRibbonBandVertices, doorRibbonBandUvs, doorRibbonBandIndices, doorRibbonAspectK,
  doorRibbonGrowthK, doorRibbonFlowOffset, doorApertureK, doorBarrierAmt,
  doorAuxFadeK,
  DOOR_RIBBON_SAMPLES, DOOR_DISPERSION_K, DOOR_PULSE_COUNT, DOOR_MOTION_DEFAULT,
} from './entryDoor';
import {
  SHIP_CLASS_ALIAS, FLAGSHIP_MODEL_ALIAS,
  acquireShipModelByFiles, setShipModelDetail, type ShipModelReg,
  getShipScaleLength,
} from './shipModels';
// 设施模型（中继站/出生点基地/要塞 等）：assets/scene/，尺寸单点配置见 sceneProps.ts
import {
  acquireSceneProp, hasScenePropFor, buildScenePropFromModel, applyScenePropColor,
  advanceScenePropSpin, type ScenePropReg,
} from './sceneProps';
import { SUPPLY_SOURCE_RADIUS, SUPPLY_RELAY_RADIUS, SUPPLY_AUX_RADIUS } from '../SupplyChainSystem';
import { fleetIntentText } from '../TacticalCommandSystem';
// [W5.4] 舰队运动学剖面（vMax 单一真源）—— billboard「速度百分比」的分母，禁手抄常量
import { fleetProfile } from '../../config/shipKinematics';
import { useSettingsStore } from '../../store/settingsStore';
import { N_MAX } from '../../config/shipScaling';
import { TERRAIN_VISUAL, TERRAIN_EFFECT_TABLE } from '../../config/terrainEffects';
import { TERRAIN_ZONE, TERRAIN_SCAN, TERRAIN_CONTOUR, CAPTURE_RING } from '../../config/balance';
import { hexChordHalfWidth, mergeSpans, scanLineY, scanSegCount } from '../../config/terrainScanGeometry';
import { fbm2D, contourLevels, marchingSquares, chaikin } from '../../config/terrainField';
// 分舰队阵型标记层：阵位数据必须与 BattleScene 同源（formationOffsets/formationSpacing 单一真源）
import {
  formationOffsets, halfExtentOf, formationSpacing, formationLayerOffsets, formationFootprint, FORMATION_SPACING,
  type FormationCell, type FormationFootprint,
} from '../../config/formationLayout';
// 纵向两级叠层的单一真源（队内层距 + 队间档距）：与 formationLayout 正交，BattleScene 共用其真源语义
import {
  TEAM_LAYERS, TIER_MAX, layerGapFor, layerCountForFootprint, teamGapFor, tierCountFor, tierMultipliers,
  assignFleetTiers, DETACHED_TIER_OFFSET,
  type TierSticky,
  FORM_ANIM_TAU,
} from '../../config/fleetTierLayout';

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
/** 地形基准高的上限（TILE_3D 的 h 最大值）—— 巡航高度的下限推导要用（舰队最底层不得沉入地形） */
const TERRAIN_MAX_H_K = Math.max(...Object.values(TILE_3D).map((t) => t.h));

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
  // 专属电子舰 GLB 未交付前复用巡洋舰船体，尺寸必须同源以免视觉/碰撞足迹不一致。
  electronic:       { L: 0.556, W: 0.200, H: 0.120 },
  destroyer:       { L: 0.400, W: 0.133, H: 0.090 },
  fighter:         { L: 0.170, W: 0.060, H: 0.040 },
  // 补给运输舰（AUX）：比战舰长 2 倍的设定 → 取战列 2.2 倍长，细高箱形，视觉上与战舰明确区分
  supply:          { L: 1.612, W: 0.260, H: 0.170 },
};

/**
 * 【大军团】舰体视觉缩放（全局，唯一杠杆）。
 *
 * 为什么必须缩：`SHIP_RATIO` 的原始口径把战列舰长定在 `0.733×√3×hexR`（hexR=50 ⇒ **63.5px**），
 * 而阵型格距 `FORMATION_SPACING = 28px` ⇒ **一艘舰横跨 2.3 个格位**。后果有三条，全部指向
 * "读不出大军团"：
 *   ① 同排相邻舰互相压叠 → 一支舰队读起来是一条**连续的船带**，不是可数的舰阵；
 *   ② 层距被"几何下限 0.8×舰高"顶到 11.78，而战列舰高 = 12.99 ⇒ **层距 < 舰高**，
 *      5 层在深度上互相穿插、糊成一块厚板 —— 这正是用户实报的"只有单层 / 阶梯状"；
 *   ③ 单舰占屏幕像素大 → 稍有距离就进"近景实体档"、再远直接跳光点，中间那档
 *      "密密麻麻的小舰阵列"根本不存在。
 *
 * 取 0.40：战列舰长 63.5 → **25.4px**（≈ 阵型格距 26，见 formationLayout.FORMATION_SPACING），
 * 于是每个格位恰好容纳一艘舰 → 阵型从"叠压的船带"变成可数的**三维点阵**；
 * 舰高 12.99 → 5.20、最高舰（carrier）5.89，层距由比例项（0.3125×26 = 8.13）决定
 * ⇒ 层与层真正分开，16 层也只有 122 世界单位厚。
 *
 * ⚠ 这是**单一杠杆**：`dimsOf()` 是舰长/宽/高的唯一真源（舰体缩放、px 分级、标记底框下限、
 *   点团展开半径、护盾尺寸全都从它派生），改这一处即全场一致。不要再去消费侧各乘一遍。
 */
const SHIP_VISUAL_SCALE = 0.40;

/**
 * 【旗舰方案·第 1 层：尺寸】旗舰相对同级舰的视觉放大倍数。
 *
 * 为什么必须有：缩舰 0.40 之后旗舰与普通舰同尺度，扎进 200 艘的点阵里完全看不出是指挥舰
 * （用户实报"旗舰在大堆舰船中不显眼"）。
 * 与 `dimsOf` 的阵营/旗舰长度系数（k，0.35~1.6）**正交**：k 表达"这型船本来多长"，
 * 本值表达"它是旗舰所以要更醒目" —— 两者相乘，不互相污染。
 * 后果要接受：旗舰的 px 变大 → 它会比同伴更早进入实体档（这正是想要的：将军先被看见）。
 */
const FLAGSHIP_VISUAL_GAIN = 1.7;
/** 【旗舰方案·第 2 层：远景档】旗舰那颗光点相对同伴的放大倍数（1 舰 1 点，靠大小区分） */
const FLAGSHIP_DOT_GAIN = 2.4;
/** 【旗舰方案·第 3 层：中/近景】指挥光环半径 ÷ 舰长（仅水平细环；v12 已移除原竖直柱） */
const FLAGSHIP_RING_K = 1.35;
/** 指挥光环自转角速度（弧度/秒）——慢转，读作"指挥中"而不是特效刷屏 */
const FLAGSHIP_RING_SPIN = 0.55;
/** ==================== [任务3] 补给舰「舰首可读性」标记 ====================
 *  背景（实机取证，_probe_auxtop.mjs + _glb_shape_audit.py）：
 *    · 数学朝向**正确**（`mesh.rotation.y == yaw(visHeading)`、航迹与舰首同向，偏差 < 0.01°）；
 *    · 但 **帝国补给舰 `empire_supply.glb` 俯视下近乎方形盒**（原始包围盒 X=0.868 / Z=0.910
 *      ⇒ 长宽比 0.95，等效于没有可读长轴；Z 分桶截面全程 ~0.80，无收缩端）
 *      ⇒ 玩家在 3D 俯视里**看不出它朝哪**，把"看不出舰首"读成「横着飞」。
 *  方案（不引入任何新模型；纯几何/材质层标记，与本工程"线条化舰体"语言一致）：
 *    · 舰首甲板画一枚**双人字箭标**（两条细线折线，指向局部 -Z = 舰首）+ 一枚**舰首实心箭头带**
 *    · 全部是 ship group 的**子对象** ⇒ 位置/朝向/缩放/销毁随舰体自动同步（不存在"无主体特效"）；
 *      材质透明度再按 LOD `grow` 同步淡入淡出（见 syncShips 第三遍）。
 *  回退：把本常量改 false，或运行时 `window.__auxBowMarker = false`（一键回退，零其它改动）。
 *  ==================================================================== */
export const AUX_BOW_MARKER_ENABLED = true;
/** 箭标颜色（与补给圈/补给连线同色系 = 后勤橙；提亮后保证在深空底上可读） */
const AUX_BOW_MARK_0 = 0xffb066;
const AUX_BOW_MARK_1 = 0xff7a1a;
/** 复用的纯白（旗舰点/光环的提亮端），避免逐帧 new Color */
const WHITE = new THREE.Color(0xffffff);
const BOAT_OUT = 1.15;
const BOAT_BACK = 1.05;
/** 登陆艇实例池上限；超出部分本帧不绘制（宁可少画几条，也不越界写 instanceMatrix） */
const BOAT_MAX = 48;

/**
 * [v12 P3] 3D 战场画质档 → { 设备像素比上限 dprCap, 离屏 MSAA 采样数 msaa }。
 * `renderer.setPixelRatio` 与 `WebGLRenderTarget.samples` **必须同源**取自本表（否则分辨率与抗锯齿不一致）。
 * high = 与改动前**逐位相同**（dpr≤2 + MSAA 4×，即现状观感）；medium/low 逐级降分辨率与抗锯齿，缓解核显卡顿。
 */
const BATTLE3D_QUALITY: Record<'high' | 'medium' | 'low', { dprCap: number; msaa: number }> = {
  high: { dprCap: 2, msaa: 4 },
  medium: { dprCap: 1.5, msaa: 2 },
  low: { dprCap: 1, msaa: 0 },
};

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
  pendingModel?: ShipModelReg;
  modelVer?: number;
}

interface ShipEntry {
  key: string;
  group: THREE.Group;
  u: any;
  fleet: any;
  /** 上一帧位置（世界系，**与 g.position 同口径**）：仅用于"无朝向"兜底时取位移方向。
   *  v8 起 z 直接存世界 z（= −像素 y），不再混存像素 y —— 运输舰的世界位置来自 aux 自身坐标。 */
  lastX: number;
  lastZ: number;
  cruiseY: number;
  /** 舰体当前偏航角（rad）。[v14 ③2] 曾由 3D 侧按 SHIP_TURN_RATE 限速逼近；
   *  [R10-B1] 改由 2D 层 `fleet.facingSmooth`（按「帧 × dt」限速平滑）**直接给出** ⇒ 此处仅持有值，
   *  不再二次限速（避免速度倍率 ≠1 时 2D/3D 错位）。SHIP_TURN_RATE 仅用于不可达的"无朝向"兜底分支。 */
  yaw: number;
  /** 待换装模型（GLB 晚于舰船生成才就绪时，据此原地换装） */
  pendingModel?: ShipModelReg;
  /** 构建时的模型版本（0 = 程序化兜底） */
  modelVer?: number;
  /** 【旗舰方案】指挥光环（水平细环，随舰体移动/缩放；仅旗舰持有） */
  cmdRing?: THREE.Mesh;
  /** 旗舰标识与旗舰模型 key（由持久 isFlagship 身份决定，换装重建时需保持） */
  isFlagship?: boolean;
  flagshipKey?: string;
  /** 实体长出进度计时（秒）：0 → MESH_GROW_DUR 时 group.scale 达到基准值 */
  meshT: number;
  /** 构建时的基准缩放（部分造型自带 0.96 整体缩放，长出动画在此之上乘系数） */
  baseScale: number;
  /** [v12.1 C2] 构建时的模型档位：换档走**分帧迁移**时据此识别"旧档实体"逐个淘汰重建
   *  （取代原先的 `ships.forEach(dispose); ships.clear()` 全量重建尖峰）。 */
  tier: 'high' | 'medium' | 'low';
  /** [切片传送入场] 本舰被裁剪的材质引用（Phong 体 + 轮廓线 + 旗舰环）。入场结束/换装时置空。
   *  每舰材质独立（几何共享、材质 new）⇒ 可按舰施加裁剪而不串扰。 */
  sliceMats?: SliceMatLike[];
  /** [切片传送入场 v2] 本舰所属**舰队的门**的 5 个裁剪平面（**同队共享同一数组实例**：
   *  1 个推进面 + 上下左右 4 个侧面 = 无限长方柱）。入场结束置空。 */
  entryPlanes?: THREE.Plane[];
  /** [任务3] 补给舰舰首标记（双人字箭标 + 舰首箭头带；挂 ship group 下随舰体缩放/销毁）。
   *  透明度每帧按 LOD `grow` 同步（见 syncShips 第三遍）⇒ 与光点/实体淡化同源。 */
  bowMarker?: THREE.Group;
}

/**
 * [切片传送入场 v2 · N6/N7/N8] **一支舰队一个「传送门」**。
 *
 * 用户定案：「**就一个舰队用一个门**，然后从门里面舰队飞出来」。故门是**舰队级**对象：
 *   · 5 个裁剪平面（`planes`）由**同队所有舰共享**同一数组实例 ⇒ 一次 `entryGateWritePlanes`
 *     全队生效（性能 + 语义都只需一份）；
 *   · 截面尺寸 = 全队投影包围盒 **宽/高各自 × ENTRY_GATE_PAD**（`halfU`/`halfV` 为半值）——
 *     [v3 **改矩形**] v2 的正方形门"竖向空了一大半"，改为**矩形**以紧贴舰队轮廓；
 *   · 推进面沿**舰队朝向**（`fwd`）从舰首（`box.sHi`）扫到舰尾（`box.sLo`）；
 *   · `vis` 是**可见的门本体**（裁剪不可见 ⇒ 不画就看不出"从门里出来"，v1 的致命缺失）。
 */
interface FleetGate {
  /** 所属舰队（Map 的键；必须与 `unitVis[i].fleet` 同源）。 */
  fleet: any;
  /** 同队共享的 5 个裁剪平面：`[0]` 推进面 + `[1..4]` 左右上下侧面。 */
  planes: THREE.Plane[];
  /** 世界正交基：朝向 / 横向 / 竖直（一次算定，整场不变）。 */
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** 门截面中心在 right/up 基上的投影（= 投影包围盒中心）。 */
  cu: number;
  cv: number;
  /** [v3 矩形] 截面**横向半跨** = `entryGateSizeU(box, PAD) / 2`。 */
  halfU: number;
  /** [v3 矩形] 截面**竖向半跨** = `entryGateSizeV(box, PAD) / 2`。 */
  halfV: number;
  /** 扫描行程余量（保证 p=0 时推进面在舰首之外）。 */
  margin: number;
  /** 建门时算定的投影包围盒（暂停期舰队静止 ⇒ 一次算定即可）。 */
  box: EntryGateBox;
  /** 入场起点（秒，`performance.now()/1000` 基准）。 */
  t0: number;
  /** 本帧进度 0..1（驱动可见本体的脉冲）。 */
  p: number;
  /** 本帧推进面的沿朝向坐标。 */
  pos: number;
  /** 已完成（裁剪已卸载、可见本体已销毁）。 */
  done: boolean;
  /** 本门覆盖的舰 key（结束时要逐个卸载裁剪）。 */
  shipKeys: string[];
  /**
   * [v3] **可见门本体**的根组（门框 + 亮带 + 外辉光 + 位面）。
   * 姿态一次算定（`makeBasis(right, up, fwd)` ⇒ 局部 X/Y/Z 映射到 横向/竖直/朝向），
   * 逐帧只改 `position`（随推进面移动）+ 材质不透明度（脉冲）。**自身不挂裁剪**。
   */
  vis: THREE.Group | null;
  /** [v3] 位面纹路贴图（逐帧滚动 offset ⇒ "流动"）。 */
  barrierTex: THREE.CanvasTexture | null;
  /**
   * [v3.1 · S] **球体方案**的可视对象（`this.gateStyle !== 'S'` ⇒ null）。
   * 与 `planes` 的分工：`planes` 仍是"入场状态的载体"（`entryPlanes` 字段/CSS 契约沿用），
   * 但 **S 方案不把 `planes` 挂到舰体材质上** ⇒ 舰体不被切；舰队"在球里出现"改由
   * `sphereRevealAmt`（缩放淡入，逐舰径向错开）驱动 ⇒ 结束**没有裁剪需要拆除**（红线仍满足）。
   */
  sphere: SphereVis | null;
  /**
   * [v5 · D] **传送门·连续光带门框**方案的可视对象（`gateStyle !== 'D'` ⇒ null）。
   * ⚠ 与 A/B/C 不同：D 的根组**存这里**（`g.vis` 保持 null）⇒ `disposeGateVisual` 不会误碰它，
   *   D 走 `disposeDoorVisual`（`disposeTree` 去重释放 —— 光带 3 层**共享同一份带状几何**）。
   * D **保留裁剪**（门框 = 5 个裁剪面围成的方柱；舰队"从门里钻出来"）—— 与 A/B/C 同构。
   */
  door: DoorVis | null;
}

/** [v5 · D] 门框**连续光带**的可视句柄：3 层 Mesh（主色 / 色散红 / 色散青）共享 **1 份带状几何**。 */
interface DoorRibbonVis {
  /** 带状几何（3 层共享；逐帧就地更新 `position` + 用 `drawRange` 表现"生长 / 收回"）。 */
  geo: THREE.BufferGeometry;
  /** 主顶点属性（逐帧就地写入 ⇒ 零分配）。 */
  pos: THREE.BufferAttribute;
  /** 三层材质：[0] 主色 / [1] 色散 A（红端）/ [2] 色散 B（青端）。 */
  mats: THREE.MeshBasicMaterial[];
  /** 三层 Mesh（`drawRange` 在共享 geometry 上设 ⇒ 三层同步生长）。 */
  meshes: THREE.Mesh[];
  /** **流动光**贴图（沿 u = 周长方向滚动 ⇒ 亮波 + 亮点沿门框流动）。 */
  tex: THREE.CanvasTexture;
  /** 主层**基础**不透明度（逐帧 = 基础 × 生长包络）。 */
  base: number;
  /** 带宽的**轴向补偿系数**（`root.scale = (halfU, halfV, 1)` 会拉成横竖不等宽 ⇒ 用它让世界等宽）。 */
  kx: number;
  ky: number;
}

/** [v5 · D] **扇传送门**（门心 = 舰队投影包围盒中心；局部 X/Y/Z = 横向/竖向/朝向）。 */
interface DoorVis {
  /** 根组（门心为原点；`scale = (halfU, halfV, 1)` ⇒ 局部 [-1,1] 映射到门框）。 */
  root: THREE.Group;
  /** 门框**连续光带**（v5 重做：不再是离散块）。 */
  ribbon: DoorRibbonVis;
  /** 门框轮廓（LineLoop）：组装前半段竖向从 0 → 1 展开 ⇒ "开启"动作。 */
  aperture: THREE.LineLoop;
  /** 柔边**外辉光**（青/紫，中心透明 ⇒ 不遮舰队）。 */
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  /** 门框**锐利内缘**（加法混合的细环带，沿门框矩形）—— 保证任意视角下都读得出"门"的边框。 */
  rim: THREE.Mesh;
  rimMat: THREE.MeshBasicMaterial;
  /** 门局部尺寸（= 建门时 `g.halfU/halfV`）。 */
  halfU: number;
  halfV: number;
}

/** [v3.1 · S] 单块瓦片的可视句柄：3 层网格共享 **1 份几何**，挂在 **1 个 Group** 下（Group 承载位姿）。 */
interface SphereTileVis {
  tile: SphereTile;
  group: THREE.Group;
  /** 三层材质：[0] 主色（浅蓝白）/ [1] 色散 A（红端）/ [2] 色散 B（蓝端）。 */
  mats: THREE.MeshBasicMaterial[];
  /** 三层各自的**基础**不透明度（逐帧 = 基础 × 阶段包络）。 */
  baseOpacity: number[];
}

/** [v3.1 · S] **一支舰队一个球体**（球心 = 舰队包围球心；半径 = 包围球半径）。 */
interface SphereVis {
  /** 根组（球心为原点；位置 = 世界球心）。几何全部**相对球心** ⇒ 只改子对象位姿。 */
  root: THREE.Group;
  /** 球心（世界坐标）。 */
  center: THREE.Vector3;
  /** 球半径（世界单位）。 */
  radius: number;
  /** 剖分结果（诊断/断言用）。 */
  set: SphereTileSet;
  /** 逐瓦片可视句柄。 */
  tiles: SphereTileVis[];
  /** 亮白核心球（半径 = R × `SPHERE_CORE_R_K`）。 */
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  /** 外圈紫色辉光（半径 = R × `SPHERE_GLOW_R_K`）。 */
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  /** [v3.1] 瓦片主色：近侧（面向相机）/**远侧**（背向相机）—— 逐帧按视线方向插值 ⇒ 蓝白/紫层次。 */
  nearColor: THREE.Color;
  farColor: THREE.Color;
}

/**
 * 单个存活单位的可见性状态（[v12.2 R1] 由 syncShips 每帧**就地更新**，条目随单位存活而长期复用）。
 * 注意与 this.ships 的区别：ships 只含**拿到 3D 实体**的单位（受 MAX_MESHES 池上限约束），
 * 而 unitVis 含全部存活单位 —— 光点层与舰队 billboard 质心都要覆盖"只有光点没有实体"的舰，
 * 否则池溢出的舰既无实体也无光点（demo 踩过的"隐形洞"），远处舰队还会整队丢 billboard。
 */
interface UnitVis {
  key: string;
  u: any;
  fleet: any;
  /** 世界坐标。未获实体者为本帧目标位；已获实体者会被回写成实体实际位 */
  x: number; y: number; z: number;
  /** 与 `x/y/z` 同源的本帧**地形基准高度**（第一遍算出的 `heightAtPx` 结果）。
   *  [v12.2 R1] 第三遍原先对同一 sprite 坐标**重算一次** `heightAtPx`（同帧同参 ⇒ 同值），
   *  这里改为复用 ⇒ 每帧 `heightAtPx` 调用减半（720 单位：1440 → 720 次）。 */
  h: number;
  /** [v12.2 R1] 本帧是否被 syncShips 第一遍见到（就地复用对象的存活标记，取代每帧重建的 `alive` Set） */
  seen: boolean;
  /** 该舰的屏幕投影长度（像素） */
  px: number;
  /** 屏幕像素坐标（左/上为原点），远景点阵分桶用（与 `px` 同一处计算、同一渲染尺寸口径） */
  sx: number; sy: number;
  /** 舰长（世界单位，dimsOf().L；每 unit 只算一次） */
  shipLen: number;
  /** 舰宽（世界单位，dimsOf().W；与 shipLen 同一次 dimsOf、同一次缓存）——标记底板横向下限用 */
  shipW: number;
  /** 0 = 纯光点，1 = 完全实体（= meshOn）。三层淡化都由它驱动 */
  grow: number;
  /** 舰首朝向（绕 y 弧度）。点团微网格要跟着舰体一起转，否则过渡帧里点团是歪的 */
  yaw: number;
  /**
   * [v75] **所属舰队的代表 px**（全队成员 px 的均值）。
   * LOD 决策一律用它，而不是逐舰的 `px`。理由（用户实报「同一个舰队看到的点+模型」）：
   * 逐舰判定时，同一舰队内近处舰拿到实体、远处舰保持光点 ⇒ 视觉上"点模混合"。
   * 用舰队均值 ⇒ **整队一起切档**（要么全模型、要么全点），符合"舰队是一个整体"的感知。
   * ⚠ `px` 保留原语义（点径/分桶/尺寸用它），仅**决策**改用 `fleetPx`。
   */
  fleetPx: number;
}
/**
 * 单支分舰队的阵型标记（填充面 + 描边圈各 1 个对象）。
 * 顶点每帧按「横向轴 / 纵深轴」两条基轴直接写成**世界坐标**（不做四元数贴合），
 * 所以对象自身恒在原点、无旋转 —— 也就不需要维护朝向，天然不会出现 demo 那种镜像翻转。
 */
interface FleetMark {
  /** 键：fleet.id（缺失时退化为 factionId） */
  fid: number;
  /** 重建键：`阵型:开局格数:hexR:半跨` —— 任一变化都要重建顶点缓冲 */
  formKey: string;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  outline: THREE.LineLoop;
  outlineMat: THREE.LineBasicMaterial;
  /** 归一化三角剖分顶点（stride 3，xy ∈ [-0.5,0.5]，整盒 = 1.0） */
  fillNorm: Float32Array;
  /** 归一化多边形顶点（stride 3） */
  outlineNorm: Float32Array;
  /** 世界**整跨**：横向 spanX / 纵深 spanY（不是半跨 —— 见 markerSpan 的口径说明） */
  spanX: number;
  spanY: number;
  /** 足迹包围盒中心相对舰队锚点的偏移（标记局部坐标） */
  midU: number;
  midV: number;
}

/** 单支舰队的 billboard DOM 句柄（3D 模式下的 HP/补给/姿态呈现层） */
interface FleetBillboard {
  root: HTMLDivElement;
  nameEl: HTMLDivElement;
  hpFill: HTMLDivElement | null;
  supplyFill: HTMLDivElement | null;
  moraleFill: HTMLDivElement | null;
  controlsEl: HTMLDivElement | null;
  stanceBtns: HTMLButtonElement[];
  /** [W3] 三概念之「分舰」按钮（分遣计划入口；可用性逐帧按指挥权威派生） */
  splitBtn?: HTMLButtonElement | null;
  /** 意图/任务文本行（提督扮演 C：AI 意图可见） */
  missionEl: HTMLDivElement;
  /** [W5.4] 机动可读化行：速度百分比 + 机动相位（cruise/brake/turn/reform/disengage） */
  maneuverEl?: HTMLDivElement;
  /** 上次渲染的姿态，用于 active 态 diff（避免每帧写 DOM） */
  lastStance: string;
  /** 上次渲染的意图文本，用于 diff */
  lastIntent: string;
  /** [W5.4] 上次渲染的机动行文本，用于 diff */
  lastManeuver?: string;
  lastTeam: number;
  lastHpPct: number;
  lastSupply: number;
  lastMorale: number;
}
/** 中文舰种 → 英文 key（BattleScene 两套命名并存：演习中文 classType / 战役英文）
 *  v2：'补给'独立映射到 supply（原映射 destroyer 导致运输舰在 3D 里长得像驱逐舰，无法辨识） */
const CLS_ALIAS: Record<string, string> = {
  '战列': 'battleship', '巡洋': 'cruiser', '驱逐': 'destroyer',
  '高战': 'fast_battleship',   // v61：gameData/SHIP_TYPE_CN 实际键名，缺键会退化成驱逐舰尺寸
  '突击': 'carrier', '空母': 'carrier', '舰载': 'fighter',
  '电子': 'electronic', '补给': 'supply', '无': 'destroyer',
};

// ============================================================
// 护盾定向半球涟漪 shader
// [v23] 已迁至 `./battleFx`（SHIELD_VS / SHIELD_FS 为模块内部常量）——
//   本文件不再自带副本；护盾的建/触发/步进统一走 makeShieldEntry / shieldFire / shieldStep。
// ============================================================

// ============================================================
// 工具
// ============================================================

/** 线框自适应增益：暗色多提、亮色少提（原型 wireGain） */
const wireGainCache = new Map<number, number>();
const gainTmp = new THREE.Color();
/** 光点/光晕层每帧复用（避免在场单位循环里反复 new Color） */
const dotTmpColor = new THREE.Color();
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
  /**
   * [WS7] 性能兜底开关，**默认关闭**（= 与改动前逐位同行为）。
   *
   * 开启后：实测帧时 EMA 持续超预算时**自适应收缩实体池预算** `meshBudget`
   * （`MAX_MESHES → MESH_BUDGET_MIN`），多出来的舰退回光点层——观感不塌、帧率保住。
   * 带滞回、无随机、只在预热帧数之后生效。
   *
   * ⚠ 之所以默认关：本轮用户的核心诉求是"**更多**战舰"，自动降档的方向与之相反，
   *   误触发会直接损害观感。故先交付能力 + 真机实测数据，是否在 App.vue 打开交产品/用户拍板。
   */
  perfGovernor?: boolean;
}

// [v23 特效真源] EnginePort / LaserEntry / HitEntry / ShieldEntry
//   五套条目结构已统一迁至 `./battleFx` 并在此 import type —— 战场与巡览共用同一结构定义。

/** v5: 3D 舰载机小队（母舰释放 → 突防 → 格斗 → 击落/返航） */
interface StrikeSquad {
  fighters: { group: THREE.Group; alive: boolean; shot: boolean }[];
  from: THREE.Vector3;   // 释放点（世界坐标）
  to: THREE.Vector3;     // 目标点
  t: number;
  dur: number;
  color: number;
  /** 目标舰队 2D 引用（命中判定跟随目标实际位置） */
  targetUnit: any;
  /** 伤害均摊到每架命中时机（由 BattleScene 传入 dmg/架） */
  dmgPerFighter: number;
  phase: 'out' | 'return';
  returnPt: THREE.Vector3;
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
.b3d-bb{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;box-sizing:border-box;width:154px;
  font-family:inherit;white-space:nowrap;will-change:transform,opacity;
  padding:4px 6px;border-radius:5px;background:rgba(10,16,28,.84);
  border:1px solid rgba(148,163,184,.35);backdrop-filter:blur(3px)}
.b3d-bb-name{font-size:10px;font-weight:800;line-height:1.25;margin-bottom:2px;text-shadow:0 1px 2px #000;overflow:hidden;text-overflow:ellipsis}
.b3d-bb-bars{display:flex;flex-direction:column;gap:2px}
.b3d-bb-bar{height:3px;border-radius:2px;background:rgba(30,41,59,.9);overflow:hidden}
.b3d-bb-bar>div{height:100%;transition:width .2s linear}
.b3d-bb-stances{display:flex;gap:3px;margin-top:4px}
.b3d-bb-btn{pointer-events:auto;cursor:pointer;font-family:inherit;font-size:9px;font-weight:700;flex:1 1 0;min-width:0;
  padding:2px 3px;line-height:1.3;border-radius:3px;color:#94a3b8;
  background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.4)}
.b3d-bb-btn:hover{color:#0a0f1c;background:#4a9eff;border-color:#4a9eff}
.b3d-bb-btn.active{color:#0a0f1c;background:#4a9eff;border-color:#4a9eff}
.b3d-bb-mission{font-size:9px;font-weight:700;line-height:1.2;margin-top:3px;color:#22d3ee;
  text-shadow:0 1px 2px #000;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b3d-bb-mission.idle{color:#94a3b8}
.b3d-bb-maneuver{font-size:8px;font-weight:700;line-height:1.2;margin-top:2px;color:#cbd5e1;
  text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b3d-cmd-notice{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;
  font-family:inherit;font-size:10px;font-weight:800;line-height:1.25;white-space:nowrap;
  padding:3px 8px;border-radius:4px;background:rgba(6,10,20,.88);border:1px solid;text-shadow:0 1px 2px #000}
.b3d-cmd-notice.ok{color:#7dd3fc;border-color:#66ccff}
.b3d-cmd-notice.fail{color:#fca5a5;border-color:#ff5544}
`;

// ── 尾焰粒子系统（原型移植）──
// [v13 ③] 用户实报"尾焰显得有点大…从喷气口射出一点就好，最好是金红色" ⇒ 粒子数减半、寿命缩短。
// [兵力折算] 尾焰粒子预算按全场实体上限 N_MAX 上调（14×400=5600 粒子，开销可忽略），
// 否则实体数超过 N_MAX 时后段舰无尾焰。

// ── 三级表示分级阈值（移植 battle-dot-demo 的 THRESH）──
// px = 该舰的屏幕投影长度（像素），见 pxOf()。所有分级都由 px 驱动，与距离无直接关系。
/** px：**标记层**远景强度与统计分档（near/mid/far）的分界。
 *  · 消费点：`writeFleetMarks` 的 fadeOut（远景标记强度）；`writeDotLayers` 的 near/mid/far 计数。
 *  ❗ **光点层已改为由 `DOT_PITCH_MIN_PX`（屏幕空间点距下限）驱动**，
 *    不再有"低于下限 ⇒ 光点 alpha = 0 ⇒ 彻底不可见"的远场截断 —— 本区间旧注释的该语义**已作废**。
 *  历史（仅备查）：这些值曾直接驱动光点 alpha（DOT_N=12 时 6.2；DOT_N=1 时降到 3.2），
 *  依"点径/点距 ≈ 该代历史比值 0.85 才看得清"推得；现该判据已迁入 `DOT_PITCH_MIN_PX`
 *  （现行点径/点距 = `DOT_DIAM_K = 0.90`）。 */
const DOT_IN_LO = 3.2;
const DOT_IN_HI = 5.0;
/** px：实体淡入区间。34px 是能看清舰体轮廓的下限，56px 后完全交给实体 */
/* 【v75】**恢复 v60-v66 的阈值**（用户实报「最早的版本这个没问题」）。
   v73 曾把本组收紧到 9/15/12/10，实测后果（用户截图）：
     · 「远景状态下也能看到模型」—— px 12~17 的单位原为纯点，降门槛后变成模型
     · 「近景同一舰队点+模型混合」—— 更多单位落进变宽的过渡带
   ⇒ 阈值是**感知校准**过的，不应为"更早出现模型"而单方面下调。
   回归 14/26/17/15，配下方"舰队级统一判定"解决同队混合。
   单调关系：MESH_IN_LO(14) < MESH_DROP(15) < MESH_KEEP(17) < MESH_IN_HI(26)。 */
/* [v84] **门槛整体抬高**（用户实报：「这个镜头距离下还是模型显示，没必要，
     这个距离什么都看不清。切换的距离可以再近点。远景状态下就像雷达形式，看全局」）。
   v82 为"消灭圆点"把门槛降到 10 ⇒ **过头**：远景看全局时也建模型，
   而该距离线框已不可辨 ⇒ 只剩一团糊影，反而失去"雷达看全局"的清晰度。
   ⇒ 采纳用户偏好：**模型只在更近时出现；远景纯点阵**。
   新值（保持 v82 确立的正确序 `DROP < KEEP < LO < HI`）：
     `DROP(18) < KEEP(22) < LO(24) < HI(40)`
   换算（战列 L=13.2@hexR26）：px = 15290/d
     · px ≥ 22 ⇔ d ≤ 695 ⇒ 需拉近到初始视距(806)的 **86%** 以内才出模型
     · 初始视角 px ≈ 19 < 22 ⇒ **开局即全点阵（雷达看全局）** ✓ */
const MESH_IN_LO = 24;
const MESH_IN_HI = 40;
/** 队内垂直层数：单一真源 = config/fleetTierLayout.ts 的 TEAM_LAYERS（5，demo 滑杆 1~5，用户定 5）。 */
// const TEAM_LAYERS 已迁至 config/fleetTierLayout.ts（与队间档距同文件，避免两处各写一份）
/** 默认相机俯角（弧度，35°）：0.96 rad（55°）是近俯视，垂直分层会被压成一摞读不出来。 */
const CAM_ELEV = 0.6109;
/** px：实体池滞回（创建阈 > 销毁阈）。缺滞回会在相机推拉时每帧 buildShip/dispose → 卡顿
 *  （随 SHIP_VISUAL_SCALE 等比下调，与 MESH_IN 同源换算） */
/* [v84] 随门槛抬高（详见 MESH_IN_LO 处依据）。序保持 `DROP < KEEP < LO`。 */
const MESH_KEEP = 22;
const MESH_DROP = 18;

/**
 * [v90] **远景档的实体门槛 = 999**（无舰队可达）⇒ 远景**全点阵**（雷达看全局）。
 *   用户实报「远景是粒子和模型同时存在」—— 旧值 22 使近处舰队仍是模型 ⇒ 同屏混合。
 *   与 `MESH_KEEP` 的分工：`MESH_KEEP` 是近景档内'实心/淡入'的参考，
 *   本值是'远景档直接全点'的开关（两者都经 `lodKeep`/`lodDrop` 暴露）。
 */
const FAR_TIER_KEEP = 999;

/**
 * [v92] **模型最小屏幕投影长度（px）** —— 低于此值时按比例放大模型。
 *   目的：远处舰队（px 仅 6~7）也能看见，不再是"空荡"的一片。
 *   ⚠ 调大 ⇒ 远处更醒目、透视层次更弱；调小 ⇒ 透视更真实。14 是"刚好看得清舰体"的下限。
 */
const MIN_MESH_PX = 14;
/** ⚠【已过时·仅存备查】实体硬上限的历史注释。当前语义见下方 `MAX_MESHES` 的正式注释；
 *  且光点层缓冲**已改用 `DOT_SLOTS` 分配**（不再是这里的 "光点层按 MAX_MESHES 分配"）。
 *  实体硬上限。= N_MAX（兵力折算层的全场实体预算），故正常情况下不触发；留作极端机位兜底。
 *  内存代价：光点层 + 光晕缓冲都按此分配（每实体 DOT_N×8 B —— dotPos/dotCol 各 DOT_N×3、
 *  dotAlpha/dotPx 各 DOT_N、haloPos/haloCol 各 3、haloAlpha/haloPx 各 1），
 *  DOT_N=20 时 ≈ 320 B/实体，池 480 → 约 154 KB，可忽略。 */
/**
 * 实体（3D 模型）池硬上限 —— **与 `N_MAX`（实体预算）解耦**。
 *
 * 为什么必须解耦：`N_MAX` 决定"画多少舰"（光点层 1 draw call，几乎免费），
 * 而"多少个舰同时挂 3D 模型"是 4 draw/舰 的重活。二者继续绑定的话，
 * 把 K_VISUAL 调到 1:100 / 1:50（实体数 ×2~×4）会连带把模型上限也放大，
 * 近景一次性建 1000+ 个模型 → 卡死。
 * 现在：预算可以很大（光点层扛住密度），模型池固定在这个量级（近景才可能触顶，
 * 且触顶的舰退回"幽灵态回补"的光点，不会变成隐形洞）。
 */
/* [v81] **400 → 900**。用户诊断面板实测（2026-10-15）：
   战场 5 支舰队共 **480 个单位**，而拿到实体数 = 150+150+80+0+20 = **恰好 400**
   ⇒ 后两支舰队（共 100 单位）被预算挤出 ⇒ 显示为光点
   ⇒ 用户实报「部分舰队、部分圆点」。
   ⚠ 400 是早期（单位数少）的取值；当前战场规模已到 480+（会战更大）。
   900 覆盖常见规模；**性能由 perfOn 自适应兜底**（帧时超预算时
   `meshBudget` 自动收缩，见 autoLodByLoad）⇒ 提高上限不会让低配机卡死。 */
const MAX_MESHES = 900;

// ⚠ `DOT_SLOTS`（光点层槽位总数）的**定义在下方 DOT_N 之后**（它依赖 DOT_N，而 DOT_N 声明在此之后，
//   提到这里会触发 TS2448 "used before its declaration"。见 `DOT_SLOTS` 定义处的完整理由。）

// ── [WS7] 性能兜底（自适应实体池预算）────────────────────────────────────────
// 三级分级本身已是第一层兜底（远景不画实体/不画点）。第二层在这里：实测帧时持续超预算时
// 收缩"允许同时存在的实体数" meshBudget，多出来的舰退回光点层（观感不塌、帧率保住）。
// 只在 opts.perfGovernor === true 时启用（默认关闭，见 OverlayOpts.perfGovernor 的理由）。
/** 帧时预算（ms）：EMA 超过它 = 需要降档。22 ms ≈ 45 fps 的余量点 */
const PERF_BUDGET_MS = 22;
/** 回档舒适线（ms）：EMA 低于它才允许把预算涨回去（滞回，防抖） */
const PERF_COMFORT_MS = 15;
/** 预算下界：再差也保留这么多实体（低于此数量观感会明显塌） */
const MESH_BUDGET_MIN = 120;
/** 预热帧数：地形/模型/着色器编译期本来就慢，先跳过不判 */
const PERF_WARMUP_FRAMES = 180;
/** 每次调整的幅度（1 帧内最多改 1 步）与调整间隔（秒） */
const PERF_STEP = 0.85;
const PERF_ADJUST_INTERVAL = 0.5;
/** [v56 性能] 动态分辨率系数下限：帧时持续超预算时把渲染分辨率逐步收到 60%（≈像素量 36%），
 *  流畅后自动回升到 1（= 画质档 dprCap 满分辨率）。0.6 是"明显降载但 UI 级文字仍可读"的经验下限。 */
const DPR_SCALE_MIN = 0.6;

// ── [v12.1 C1/C2] 帧时压力降档 + 实体池逐帧限流 / 换档分帧迁移 ────────────────
// 用户实机反馈"帧数很低 / 打着打着就卡 / 舰队整体移动明显卡顿"的方向性修复：
//  (1) 档位原来只看**实体数量**，不管帧时 —— 数量不大但核显帧时已爆时不会降档；
//  (2) addMesh/dropMesh 无逐帧预算 —— 相机推近时一帧内建几百个模型（单模型约 5 万面）造成长尖峰；
//  (3) 换档是 `dispose+clear` 全量重建 —— 一次换档把全部实体销毁再于下一帧重建，最重的一处尖峰。
/** 帧时压力降档的冷却（秒）：降/回升档各受它限流，防抖（沿用 governor 的 0.5s 口径） */
const LOD_COOLDOWN_S = 0.5;
/** 允许"帧时恢复→回升档"的实体负载上限（低于它才敢升档；取 medium 判据同值） */
const LOD_RECOVER_COUNT = 170;
/** 每帧新建实体上限（消"一帧内建大量模型"的帧内尖峰；未加的舰仍由光点层接住，不塌） */
/* [v81] **32 → 96**。480 单位 / 32 每帧 = 15 帧才补齐（≈0.25s 的"半边空"窗口）。
   96 ⇒ 5 帧补齐，肉眼几乎不可察。仍保留分帧（防单帧 build 尖峰）。 */
const MESH_ADD_PER_FRAME = 96;
/** 每帧回收实体上限（同理：相机拉远时避免一帧内 dispose 数百个） */
const MESH_DROP_PER_FRAME = 64;
/** 换档分帧迁移：每帧淘汰的**旧档**实体上限（≤24；下一帧由第二遍按新档经 addMesh 自然补回） */
const LOD_MIGRATE_PER_FRAME = 24;

/** 每舰点数。**现行语义（远景正式语义）：1 舰 1 个"看得见的圆点"（`DOT_N = 1`）** ——
 *  用户原话"用光点代表战舰、用光点组成阵型"。
 *  `DOT_N` 是唯一把"1 舰 1 点"切成"1 舰 N 点微网格"的旋钮，**当前关闭**；
 *  它与 `DOT_OFFSETS / DOT_SPREAD_K / DOT_SCALE`（多点团专属口径）联动，DOT_N=1 时后者形同空转。
 *  历史（20 → 12 → 1）：多点团时代可辨性 = 点径/点距 = `DOT_SCALE / (pitch × DOT_SPREAD_K)`，
 *  DOT_N=12（gc=4、pitch=0.667）时为 0.85（有 15% 间隙，读作"点阵"）；
 *  DOT_N=20（gc=5、pitch=0.5）+ DOT_SCALE=0.36 时曾到 2.03 ⇒ 点完全重叠 = 方块。
 *  ⚠ DOT_N=1 后**已无"点距"可言**，"点会不会糊成块"改由屏幕空间点距下限 `DOT_PITCH_MIN_PX` 决定；
 *    若要调回 >1，必须同时复核 DOT_SCALE 与 DOT_PITCH_MIN_PX 的关系。 */
const DOT_N = 1;
/**
 * 【多点模式专用】每舰点团半径 ÷ 舰长。
 * `DOT_N = 1` 时该值**无用**（单点落在舰心，R 不生效；保留只为让"调回多点"随时可用）。
 * demo 的 dotSpread=0.45 是相对 SHIP_LEN=1.27 的比值（点团直径 0.9 ≈ 0.71 × 舰长，刚好包住舰体，
 * 团块中心与舰体重合）。游戏侧舰长大得多（hexR=50 时战列舰 L ≈ 90 世界单位），照抄 0.45 绝对量会让
 * 点团缩成一个点，故必须按比值换算：R = DOT_SPREAD_K × 舰长 × (1 - grow)。
 * ⚠ 用户滑杆把 dotSpread 定在 0.45（= demo 默认值）⇒ 该比值**无需改动**（0.45/1.27）。
 */
const DOT_SPREAD_K = 0.45 / 1.27;
/** 单点屏径比例：点屏径 = max(`DOT_MIN_PX`, 该舰投影长度 px × DOT_SCALE) × (1−grow)。
 *
 * ⚠ **多点模式**（DOT_N>1）下，本值与"点距"的比值才是"看起来是不是点"的唯一判据：
 *   点距(px) = pitch × DOT_SPREAD_K × px，pitch = DOT_G/(gc−1)
 *   ⇒ **点径/点距 = DOT_SCALE / (pitch × DOT_SPREAD_K)**
 *   历史教训：曾把本值从 0.20 提到 0.36（理由是"缩舰后 px 变小"）→ 比值 2.03 → 20 个点完全重叠糊成
 *   **实心方块**；回到 0.20 并把 DOT_N 收到 12（gc=4、pitch=0.667）→ 该代比值 0.85 ⇒ 有间隙、读作"点"。
 *   （该 0.85 为 DOT_N=12 多点团时代的**历史**口径，与本轮现行 `DOT_DIAM_K = 0.90` 无关。）
 * 现行 `DOT_N = 1`：无"点距"可言，点径由本值 × px 决定、并被 `DOT_MIN_PX` 托底；
 *   "点与点会不会糊成块"改由屏幕空间点距下限 `DOT_PITCH_MIN_PX` 保证（见该常量）。
 *
 * 【v12 光点加大】0.30 → 0.32：远景圆点整体放大（用户实报"光点太小"）。
 *   1 舰 1 点语义不变；放大后仍被 `DOT_MIN_PX` 托底、被 `makeDotMaterial(24,…)` 封顶，安全。
 */
const DOT_SCALE = 0.32;
/**
 * 屏幕上光点阵的**最小点距**（px）。这是「远景看得见、又不糊成块」的唯一自由度。
 * 远景点阵在**屏幕空间**按边长 = 本值的方格分桶，每格至多出 1 个点（见 writeDotLayers）：
 *   · 近处：格边长 > 阵型格距的屏幕投影 ⇒ 每格至多 1 舰 ⇒ 自然退化为"1 舰 1 点"（用户要的语义）；
 *   · 远处：多舰落进同一格 ⇒ 合并成 1 点 ⇒ 屏幕上点距恒 ≥ 本值 ⇒ **永不重叠成块、也永不空白**。
 * 判据是屏幕空间的连续量 ⇒ 缩放时点阵平滑增减，无阈值跳变，故**不再用 alpha=0 表达"太远了"**。
 * ⚠ 必须与 `DOT_DIAM_K` 成对看：点径 = 点距 × DOT_DIAM_K < 点距，才有间隙。
 *
 * 【v12 光点加大】3.2 → 4.0（+25%）：放宽点距下限，配合 DOT_DIAM_K 0.85→0.90，
 *   使远景圆点整体变大仍是"离散圆点"而非糊成实心块。
 */
const DOT_PITCH_MIN_PX = 4.0;
/** 点径 ÷ 点距。必须 < 1 才有间隙 ⇒ 读作点阵；= 1 开始糊，> 1 就是实心块。
 *  【v12 光点加大】0.85 → 0.90：点径占点距的比例提高，点更大；仍 < 1，间隙 = 4.0 × (1−0.90) = 0.40 px，
 *  读作"离散圆点"不糊块（原间隙 3.2 × (1−0.85) = 0.48 px）。 */
const DOT_DIAM_K = 0.90;
/**
 * 点屏径的**视觉下限**（px）= 点距下限 × 点径比 = `DOT_PITCH_MIN_PX × DOT_DIAM_K`（= 4.0 × 0.90 = 3.60）。
 * **派生值、不要写字面量** —— 它与 `DOT_PITCH_MIN_PX` / `DOT_DIAM_K` 必须成对改：
 * 三者恒定满足 "点径/点距 = DOT_DIAM_K < 1"，才既有间隙（不糊成块）又足够大（远处看得见）。
 * 另需 ≤ `makeDotMaterial` 的上限 24px（buildShipDots 传 24），当前远小于，无虞。
 * 【v12 光点加大】旧值 3.2 × 0.85 = 2.72 → 新值 4.0 × 0.90 = **3.60 px（+32%）**。
 */
const DOT_MIN_PX = DOT_PITCH_MIN_PX * DOT_DIAM_K;
/**
 * 光点层槽位总数 = 实体预算上限 × 每舰点数。
 * ❗ 必须独立于 `MAX_MESHES`：DOT_N 从 12 收到 1 后，旧式 `MAX_MESHES * DOT_N` = 400×1 = **400**，
 *    而一场会战的实体预算 N_MAX = 1400 ⇒ 第 401 艘之后的舰**既无实体也无光点 = 彻底隐形**
 *    （用户实机反馈"从几个角度看过去舰船就是看不见了"的物理原因）。
 * 内存：1400 槽 × (3+3+1+1) float ≈ 45 KB，可忽略。
 * （定义放在此处而非 MAX_MESHES 旁：它依赖 DOT_N，而 DOT_N 声明于上方，提前引用会触发 TS2448）
 */
const DOT_SLOTS = N_MAX * DOT_N;
/** 光晕点径增益：比光点略大、包住舰体轮廓即可（1.6 会把舰体糊成光团） */
const HALO_GAIN = 1.15;
/** 实体长出时长（秒）：group.scale 从 0.25 长到 1.0，与光点淡出同步完成 */
const MESH_GROW_DUR = 0.25;
/**
 * [v14 ③2] 舰体最大转向角速度（rad/s）。
 * 用户实报"变阵很突然"——原实现 `g.rotation.y` **直接赋值**，朝向一帧内瞬转。
 * 太空舰的体量读作"缓慢转体"，故对朝向改为**受角速度上限的逼近**：
 * 30°/s ⇒ 掉头 180° 需 6s、90° 需 3s，与 3~5s 的阵型 morph（BattleScene）同量级。
 *
 * ⚠ [R10-B1] 本值现**仅用于"无朝向"兜底分支**（facingSmooth / facingAngle 均缺失，实际不可达）。
 *   权威朝向路径已改为直接消费 2D 层限速平滑值 `fleet.facingSmooth` —— 那次平滑在 BattleScene
 *   里按「帧 × dt（速度倍率）」积分，与位移同基准；若此处再用**真实秒** dt 二次限速，倍率 ≠1 时
 *   2D/3D 会再次错位（R1 复盘 §5 U4）。限速常量的单点定义见 BattleScene.HEADING_TURN_RATE。
 */
const SHIP_TURN_RATE = Math.PI / 6;

/**
 * 把当前角 `cur` 以不超过 `maxStep` 的步长逼近目标角 `target`（角度差先 wrap 到 [-π, π]）。
 * wrap 用 atan2(sin,cos) ⇒ 跨 ±π 环回正确（不会为 359°→1° 绕远路）。
 * 到达后返回 `cur + d`（而非 target）：保持在连续轨道上，避免 ±π 边界反复跳变。
 */
function approachAngle(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (Math.abs(d) <= maxStep) return cur + d;
  return cur + Math.sign(d) * maxStep;
}

// ── 分舰队阵型标记层（demo 三级里游戏缺的整层）──
/** 标记相对实际排布包围盒的留边系数（demo MARKER_PAD） */
const MARKER_PAD = 1.12;
/**
 * 标记底透明度下限（demo MARKER_FLOOR）：远景→中景时标记**不降到 0**，
 * 保留一块半透明的"队形底"。这是标记层的核心价值 —— 它不只是远景替代品，
 * 中景里它是"点阵下面那层队形轮廓"，与光点叠成两层。
 * 若没有它，中景只剩一团点，阵型形状完全读不出来。
 */
const MARKER_FLOOR = 0.05;
/**
 * 描边在**中景**的保留下限。填充中景降到 0.05 之后，若描边也一起消失，"队形轮廓"这条信息就断了；
 * 保留 0.35 的细轮廓既维持"这是一支有阵型的舰队"，又不会像上一版那样在屏幕上糊出一大块实心色板
 * （用户实机截图里那块刺眼的红三角就是 0.22 的填充面）。 */
const MARKER_FLOOR_OUTLINE = 0.35;
/**
 * 标记底板相对"队内最低舰"再下沉的量（× cruiseClearance）。
 * 底板必须压在整支编队之下：若停在队心高度，平面就从编队中间剖过去，读起来是"切面"而不是"底"。
 * 下沉量取巡航余量的一小部分，保证仍在地形之上（舰高 = 地形高 + cruiseClearance）。
 */
const MARKER_DROP_K = 0.4;

/**
 * DOT_N 个点的固定局部偏移（规则等距微网格，落在舰体水平面 x–z，含逐舰去均值）。
 * ❗ 现行 `DOT_N = 1` ⇒ 只有 1 个偏移 = (0,0,0)（点落在舰心），整段微网格逻辑**形同空转**，
 *   仅为"调回多点模式"保留（多点模式下才是"1 舰 N 点"的微网格）。
 * 与 demo 的 dotOffsets 同源：gc 列 × gr 行、列距 = 行距 = 2/(gc-1)，网格外缘恰好 ±1，
 * 乘上展开半径 R 即"点团半径 = R"。偏移只由 k 决定（确定性），故全舰共用一份即可，
 * 不需要每舰各存——去均值后 n=1 时质心本来就在原点。
 */
const DOT_OFFSETS: Float32Array = (() => {
  const n = DOT_N;
  const out = new Float32Array(n * 3);
  const gc = Math.ceil(Math.sqrt(n));
  const gr = Math.ceil(n / gc);
  const pitch = 2.0 / Math.max(1, gc - 1);   // 网格外缘 = ±(DOT_G/2)·1 = ±1（DOT_G = 2）
  for (let k = 0; k < n; k++) {
    const c = k % gc, r = (k / gc) | 0;
    out[k * 3] = (c - (gc - 1) / 2) * pitch;      // 横向
    out[k * 3 + 1] = 0;                            // 微网格先在水平面内
    out[k * 3 + 2] = (r - (gr - 1) / 2) * pitch;   // 沿舰长轴
  }
  // 逐舰去均值：n 非完全平方时末排不满，质心会偏离原点（R=0.45 时可偏 0.1+ 世界单位），
  // 过渡帧里读起来就是"点团与实体错开"。去均值后点团质心与舰心严格重合。
  let mx = 0, my = 0, mz = 0;
  for (let k = 0; k < n; k++) { mx += out[k * 3]; my += out[k * 3 + 1]; mz += out[k * 3 + 2]; }
  mx /= n; my /= n; mz /= n;
  for (let k = 0; k < n; k++) { out[k * 3] -= mx; out[k * 3 + 1] -= my; out[k * 3 + 2] -= mz; }
  return out;
})();

/** smoothstep（与 GLSL 同式）：三级分级的淡入淡出都走它，保证位置/点径/透明度锁相 */
function sstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 按「排」聚合阵位：`offs` 里 gx 相同的一批格位就是同一排（formationLayout 的排 = gx = 前进轴）。
 * 返回按纵深从**队首到队尾**排序的每排占用宽度（格数），两支水平半跨，以及足迹包围盒中心（格）。
 *
 * 用**格数**而不是 gy 跨度做宽度：单舰排的 gy 跨度是 0，直接按跨度算比例会把楔形尖顶压成退化点；
 * 格数口径 = "这一排横向占了几个舰位"，与 demo 的 `首排宽/末排宽 = 1/13`（7 排、每排 2r+1 艘）
 * 完全同源 —— demo 用的也是计数，不是几何跨度。
 */
function markerRowWidths(offs: FormationCell[]): {
  widths: number[]; gxSpan: number; gySpan: number; gxMid: number; gyMid: number;
} {
  const rows = new Map<number, { min: number; max: number }>();
  let minGx = 0, maxGx = 0, minGy = 0, maxGy = 0, first = true;
  for (const [gx, gy] of offs) {
    let r = rows.get(gx);
    if (!r) { r = { min: gy, max: gy }; rows.set(gx, r); }
    else { if (gy < r.min) r.min = gy; if (gy > r.max) r.max = gy; }
    if (first) { minGx = maxGx = gx; minGy = maxGy = gy; first = false; }
    else {
      if (gx < minGx) minGx = gx; if (gx > maxGx) maxGx = gx;
      if (gy < minGy) minGy = gy; if (gy > maxGy) maxGy = gy;
    }
  }
  // gx 降序 = 队首（gx 最大，wedge 的尖顶在这儿）→ 队尾
  const keys = [...rows.keys()].sort((a, b) => b - a);
  const widths = keys.map((k) => { const r = rows.get(k)!; return r.max - r.min + 1; });
  return {
    widths,
    gxSpan: maxGx - minGx,
    gySpan: maxGy - minGy,
    // 足迹包围盒中心（格）：**不等于锚点**。wedge / spindle / line 的格位全在 gx ≤ 0 一侧
    // （队首 = gx 0，向后方展开），中心因此在锚点后方约半个纵深 —— 标记必须按它居中。
    gxMid: (minGx + maxGx) / 2,
    gyMid: (minGy + maxGy) / 2,
  };
}

/**
 * 标记归一化形状，落在 [-0.5, 0.5]²（**整盒 = 1.0**；实际世界尺寸 = norm × 整跨 spanX/spanY，见 markerSpan）。
 * 比例**全部从游戏自己的 `offs` 反推**，不抄 demo 的常数（demo 是 7 排三角阵列，游戏按 n 伸缩，
 * 抄 1/13 会让 n=200 时的楔形标记比点阵窄一倍）。
 *
 * 轴约定（与 writeFleetMarks 的落位一致）：
 *   归一化 x = **横向**（formationLayout 的 gy），归一化 y = **纵深**（gx），
 *   y = -0.5 是**队首**（gx 最大侧），y = +0.5 是队尾 —— 故楔形的窄端落在 y < 0 一侧。
 */
function markerNormShape(formation: string, offs: FormationCell[]): [number, number][] {
  const RECT: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  if (!offs.length) return RECT;
  const { widths } = markerRowWidths(offs);
  if (!widths.length) return RECT;

  if (formation === 'wedge') {
    // 窄端排宽 / 宽端排宽：n≥2 时 widths 单调不降（wedgeCells 的削/补都维持单调）
    const wNarrow = widths[0];
    const wWide = widths[widths.length - 1];
    const t = Math.max(0.02, Math.min(1, wWide > 0 ? wNarrow / wWide : 1));
    return [[-t / 2, -0.5], [t / 2, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  }

  if (formation === 'spindle') {
    const n = widths.length;
    const wMax = Math.max(...widths);
    // 透镜：逐排横向半宽 = 该排格数占比（+1 的补白让单格排也有一个舰位的宽度，不退化）
    const xOf = (i: number) => 0.5 * ((widths[i] + 1) / (wMax + 1));
    if (n === 1) return RECT;
    if (n === 2) {
      const x0 = xOf(0), x1 = xOf(1);
      return [[-x0, -0.5], [x0, -0.5], [x1, 0.5], [-x1, 0.5]];
    }
    // 右半由队首到队尾（两端锥尖各出现一次），再左半折返 → 无重复点的简单多边形
    const P: [number, number][] = [];
    for (let i = 0; i < n; i++) P.push([xOf(i), -0.5 + i / (n - 1)]);
    for (let i = n - 2; i >= 1; i--) P.push([-xOf(i), -0.5 + i / (n - 1)]);
    return P;
  }

  if (formation === 'circle') {
    const P: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      P.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
    }
    return P;
  }

  // square / line：矩形（长宽比由 offs 的真实包围盒决定，line 自然变成细长条）
  return RECT;
}

/**
 * 射线（原点出发、方向 q）与简单多边形 P 的**首次穿出参数** λ：λ·q 落在 P 的边界上（λ > 0）。
 * 原点在 P 内部（本文件全部标记形状都满足：矩形 / 梯形 / 透镜 / 24 边形）时，
 *   λ ≥ 1 ⟺ q 落在 P 内；λ < 1 ⟺ q 在 P 外，且所需放大倍率恰好是 1/λ。
 * 无交点（q = 0，或射线与所有边平行）→ Infinity（该点视为「无需放大」）。
 * 取**最小**正值：spindle 逐排取整会让透镜轻微非凸，此时最小正值 = 第一次穿出 → 放大倍率偏大，
 * 方向是安全侧（宁大勿漏）。
 */
function rayExitLambda(qx: number, qy: number, P: [number, number][]): number {
  let lam = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[j][0], yi = P[j][1];
    const ex = P[i][0] - xi, ey = P[i][1] - yi;
    const den = qx * ey - qy * ex;          // cross(q, B−A)
    if (Math.abs(den) < 1e-12) continue;     // 平行
    const l = (xi * ey - yi * ex) / den;     // cross(A, B−A) / cross(q, B−A)
    if (!(l > 1e-9)) continue;
    const t = Math.abs(ex) >= Math.abs(ey) ? (l * qx - xi) / (ex || 1e-12) : (l * qy - yi) / (ey || 1e-12);
    if (t < -1e-9 || t > 1 + 1e-9) continue;  // 交点不在该边上
    if (l < lam) lam = l;
  }
  return lam;
}

/**
 * 标记的世界**整跨**（spanX = 横向、spanY = 纵深）＋ 足迹中心在标记局部坐标下的位置（midU 横向 / midV 纵深，世界单位）。
 *
 * ⚠ 返回的是整跨，不是半跨 —— 这是本层最容易写错的一处，也是「标记比编队小一半」的根因：
 *   `markerNormShape` 归一化到 **[-0.5, 0.5]**（整盒 = 1.0），于是 `norm × span` 才等于整跨 span
 *   （与 demo 同构：`spec.sx = bounds.w * MARKER_PAD`，`bounds.w = max−min` 就是整跨）。
 *   本层早先把返回值定义成半跨，等价于把 MARKER_PAD 悄悄折半（1.12 → 0.56）：
 *   底板横向只有编队的 56%，实测 350/400 例有舰越出底板（最坏 wedge n=200 越界 184/200）。
 *
 * 跨度分两步：① 闭合式基准 = **包围盒 × MARKER_PAD**；② 覆盖校正（见 `rayExitLambda` 的使用段）。
 * ② 是必需的：形状是"设计语言"（干净的三角 / 透镜 / 圆），而格位由 `formationLayout` 逐个取整生成，
 * 两者在小 n 时对不上 —— wedge 的线性插值低于实际排宽、spindle 的锥尖被 `+1` 补白抬离轴线、
 * circle 的内接 24 边形盖不住 √2 处的角格。纯几何后果：舰心落到标记之外（实测 8/225 例、最坏 0.29 格 ≈ 8px）。
 * 逐阵型去修形状公式是打补丁；② 把「标记必须包住编队」做成硬不变量，换形状 / 改阵型自动跟随。
 *
 * 跨度的唯一来源仍是 `offs` × **调用方给的实际格距**（BattleScene 同源 spacingEff）——
 * 旧实现用固定"跨度"比真实包围盒大一圈，中景里光点只占底块中间一小块。
 * 圆形等比：否则会被 w≠d 的包围盒拉成椭圆。
 *
 * 下限（floor）不是几何量而是**物理量**：至少要能容纳该队最长舰。小 n 时 `offs` 的包围盒趋于 0，
 * 没有这条下限会退化成"点标记"。**且必须分轴**：
 *   · 纵深轴（spanY）∥ 舰体长轴（舰首沿 gx）⇒ 下限取 `maxShipLen`；
 *   · 横向轴（spanX）只承载舰宽 ⇒ 下限取 `maxShipW`。
 * 把 `maxShipLen` 同时施加到 X 是**过度施加**：n=1 补给舰会撑出 156×156 的方块，
 * 罩住一艘 139.6×22.5 的舰体（面积 124.7×，且与覆盖率无关，纯属浪费）。
 * 两者同源 `dimsOf()`（调用方从 unitVis 聚合 L/W），不新造常量、不引入第二真源。
 *
 * ⚠ 签名契约（别动顺序）：`P` 必须留在**第 4 位**，舰体尺寸用**可选尾参**（默认 0）。
 *   多个独立台子（`_verify_marks_regression.cjs`、`_marker_harness.cjs`、`_verify_ship_vs_mark.cjs`、
 *   `_verify_marker_floor.cjs`）都按 `markerSpan(form, offs, spacing, P)` **四参**调用；把尺寸插到
 *   `P` 之前会让它们把 P 当成尺寸、真正的 P 收到 undefined ⇒ `rayExitLambda` 读 undefined.length 崩。
 *   默认 0 ⇒ 两轴 floor 退化为 `spacingEff × 0.5`，即 #75 之前的行为，既有例零扰动。
 */
function markerSpan(
  formation: string, offs: FormationCell[], spacingEff: number, P: [number, number][],
  maxShipLen = 0, maxShipW = 0,
): { spanX: number; spanY: number; midU: number; midV: number } {
  const { gxSpan, gySpan, gxMid, gyMid } = markerRowWidths(offs);
  let cellX = Math.max(0, gySpan);   // 横向包围盒（单位 = 格）
  let cellY = Math.max(0, gxSpan);   // 纵深包围盒（单位 = 格）
  if (formation === 'circle') cellX = cellY = Math.max(cellX, cellY);
  // 下限：单舰舰队（包围盒 0×0）也要有一块可见的队形底；但它必须有**物理意义的下限** ——
  // 容纳该队最长舰：舰长（hexR=50 战列舰 63.5、补给舰 139.6）比格距 28 大一个数量级，
  // 只铺"半个格距"的 14×14 底板会让舰体整片露在标记外（实测 n=1 覆盖率 10%~22%，且与 MARKER_PAD 无关）。
  // 复用同一个 MARKER_PAD 保持"留边系数"语义单一，不新造常量。
  // ⚠ 两轴口径不同（见函数头）：Y 用舰长、X 用舰宽。旧版把舰长同时用在两轴 ⇒ n=1 出方块。
  const minFloor = spacingEff * 0.5;
  const floorX = Math.max(minFloor, maxShipW * MARKER_PAD);
  const floorY = Math.max(minFloor, maxShipLen * MARKER_PAD);
  let spanX = Math.max(cellX * spacingEff * MARKER_PAD, floorX);
  let spanY = Math.max(cellY * spacingEff * MARKER_PAD, floorY);

  // ② 覆盖校正：逐舰心把世界偏移折成归一化坐标 q（q ∈ [-0.5,0.5] ⟺ 落在形状内），
  //    取所需放大倍率的最大值，整块**等比**放大 —— 长宽比不变，形状读起来一模一样。
  //    全部舰心本来就在内时 a = 1，结果与 ① 逐位相同（既有通过例零扰动）。
  let a = 1;
  for (const [gx, gy] of offs) {
    // 与 writeMarkVerts 同一套局部坐标：x = 横向（u）、y = 纵深（v，+ = 队尾 = −gx）
    const qx = ((gy - gyMid) * spacingEff) / spanX;
    const qy = ((gxMid - gx) * spacingEff) / spanY;
    const lam = rayExitLambda(qx, qy, P);
    if (lam < Infinity) a = Math.max(a, 1 / lam);
  }
  spanX *= a;
  spanY *= a;

  return {
    spanX, spanY,
    // 标记局部坐标：x = 横向（+ = +gy）、y = 纵深（+ = 队尾 = −gx），见 markerNormShape / markerAxes
    midU: gyMid * spacingEff,
    midV: -gxMid * spacingEff,
  };
}

/**
 * 用 ShapeGeometry 只借一次**三角剖分**（形状可能因取整而轻微非凸，earcut 比扇形剖分稳），
 * 随后把顶点摊平成归一化 stride=3 缓冲 —— 真正的世界坐标每帧按两条基轴重写。
 */
function markerFillNorm(P: [number, number][]): Float32Array {
  const sh = new THREE.Shape();
  sh.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) sh.lineTo(P[i][0], P[i][1]);
  sh.closePath();
  const tri = new THREE.ShapeGeometry(sh);
  const tp = tri.attributes.position.array as ArrayLike<number>;
  const out = new Float32Array(tp.length);
  for (let i = 0; i < tp.length; i += 3) {
    out[i] = tp[i]; out[i + 1] = tp[i + 1]; out[i + 2] = 0;
  }
  tri.dispose();
  return out;
}

/**
 * 标记的两条基轴（世界水平面内），返回 [latX, latZ, depX, depZ]。
 *
 * 来源：BattleScene 的落位公式 `rx = ox·cos f − oy·sin f`、`ry = ox·sin f + oy·cos f`，
 * 世界侧 `x = fleet.x + rx`、`z = −(fleet.y + ry)` → 单位 gx 产生 (cos f, −sin f)、
 * 单位 gy 产生 (−sin f, −cos f)（这就是 formationLayout 的「gx = 前进轴 / gy = 横向」）。
 *   · gx 轴 = 舰队前进轴 = 舰首朝向（syncShips 的 yaw 段同样得出 (cos f, −sin f)）
 *   · 横向轴（归一化 x，+gy）= (−sin f, −cos f)
 *   · 纵深轴（归一化 y，+ = 队尾）= −gx 轴 = (−cos f, +sin f)
 * ⚠ 纵深轴必须取 **−gx**：formationLayout 里 gx = 0 是**队首**（楔形尖顶），
 *   而归一化 y 的 −0.5 也是队首 —— 取反才会"标记尖顶朝敌"，否则整块标记镜像到队尾侧
 *   （demo index.html:610-613 / 635-636 记录的正是这个符号坑）。
 */
function markerAxes(f: number): [number, number, number, number] {
  const cf = Math.cos(f), sf = Math.sin(f);
  return [-sf, -cf, -cf, sf];
}

/**
 * 逐顶点把归一化形状摆到世界：
 *   world = (cx, baseY, cz) + (nx·spanX)·latAxis + (ny·spanY)·depAxis
 * 其中 latAxis = (latX, 0, latZ)、depAxis = (depX, 0, depZ) 是**世界水平面内的两条基轴**：
 *   latAxis = 归一化 x（横向，formationLayout 的 gy）方向
 *   depAxis = 归一化 y（纵深）方向，ny = −0.5 落在队首
 * ⚠ spanX/spanY 是**整跨**：norm ∈ [-0.5, 0.5] 乘整跨正好得到 ±半跨。
 * 直接写空间坐标（对象不旋转），故调用方必须 frustumCulled = false。
 */
function writeMarkVerts(
  geo: THREE.BufferGeometry, norm: Float32Array,
  spanX: number, spanY: number,
  cx: number, cy: number, cz: number,
  latX: number, latZ: number, depX: number, depZ: number,
): void {
  const arr = geo.attributes.position.array as Float32Array;
  for (let i = 0, n = norm.length / 3; i < n; i++) {
    const ox = norm[i * 3] * spanX;
    const oy = norm[i * 3 + 1] * spanY;
    arr[i * 3] = cx + ox * latX + oy * depX;
    arr[i * 3 + 1] = cy;
    arr[i * 3 + 2] = cz + ox * latZ + oy * depZ;
  }
  geo.attributes.position.needsUpdate = true;
}

/**
 * 光点/光晕共用的 Points 材质。
 * 注意：这是裸 ShaderMaterial，不含 fog 段 —— 场景雾不会二次衰减光点（雾本来就在做远景衰减，
 * 叠加会双重衰减）。远景的可见性改由**屏幕空间点距下限 `DOT_PITCH_MIN_PX`** 负责
 * （远景点阵每格至多 1 点，永不糊成块），**不再用 alpha=0 抹掉远场**。
 */
function makeDotMaterial(maxPx: number, depthTest: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMaxPx: { value: maxPx } },
    vertexShader: [
      'attribute vec3 aColor; attribute float aAlpha; attribute float aPx;',
      'uniform float uMaxPx;',
      'varying vec3 vColor; varying float vAlpha; varying float vIdealPx;',
      'void main(){',
      '  vColor = aColor; vAlpha = aAlpha;',
      '  // 下限 2.0 是硬性的：1px 软精灵在屏幕上是硬方块，必须给足采样面积。',
      '  // 代价是这个下限会**放大**小点 —— 是否该"放大"由片元按理想点径决定（见 vIdealPx）。',
      '  gl_PointSize = clamp(aPx, 2.0, uMaxPx);',
      '  vIdealPx = aPx;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vColor; varying float vAlpha; varying float vIdealPx;',
      'void main(){',
      '  float d = length(gl_PointCoord - 0.5) * 2.0;',
      '  float a = smoothstep(1.0, 0.35, d);   // 圆形软边',
      '  // 【防方块】理想点径过小时，gl_PointSize 的 2.0 下限会把点撑得比点距还大 → 相邻点完全重叠成实心块。',
      '  // 这里按理想点径**淡出**（而非放大）作为最后的兜底。',
      '  // ⚠ 现行 DOT_MIN_PX = DOT_PITCH_MIN_PX × DOT_DIAM_K = 4.0 × 0.90 = 3.60 > 2.4，',
      '  //   故本淡出对"战舰光点"永不触发（点径恒 ≥ 3.60）；它只在多点模式下极小点径时兜底。',
      '  a *= smoothstep(1.3, 2.4, vIdealPx);',
      '  gl_FragColor = vec4(vColor, a * vAlpha);',
      '}'
    ].join('\n'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest,
  });
}

// [v23] SHIELD_DUR / easeOutBack 随护盾三段动画一并迁至 `./battleFx`（shieldStep 内部使用）。

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
  // （原 `hexInst` / `wireGeo` / `tileMeta`：六棱柱地形实例与其线框，已随「3D 战场」模式删除）
  private hexR = 26;
  /** 地图跨度（`buildSpaceWorld` 时计算：max(宽,高)），固定雾参数与相机预设用 */
  private mapSpan = 0;
  /** [v76] 初始相机高度（相机取景时的 y）。缩放档判据的基准 —— 见 updateLodTier。 */
  private initCamY = 0;
  /**
   * [v77] 调试隐藏开关（URL 参数 `?hide=flame,stars,dots,halo`）。
   * 用途：用户报「贴脸还有圆点」但无法确认来源 ⇒ 提供二分定位手段，
   *   逐个隐藏候选点云，一次就能确定是哪个图层。
   * 候选：flame=尾焰粒子 / stars=星空 / dots=舰船光点 / halo=光晕层。
   * ⚠ 生产环境不带参数时为空集 ⇒ 零行为变更。
   */
  private debugHide: ReadonlySet<string> = new Set();
  /** [v77] 星空对象引用缓存（供调试开关用；星空创建时未存字段） */
  private _starsRef: THREE.Points | null = null;
  /**
   * [v79] 诊断面板（URL `?debug=1` 开启）。
   * 用户实报「同一条线上前半是点、后半是模型，为什么？」—— 需要**实测数据**定位：
   *   · 若两支**不同 fleet** 各有不同 fleetPx ⇒ 是"多支舰队视觉相邻"（不是 bug）
   *   · 若**同一 fleet** 内 px 分裂 ⇒ 是 fleetPx 聚合失效（真 bug）
   * 面板显示每支舰队的：单位数 / fleetPx(均值) / 已获实体数 / 当前档位。
   */
  private debugPanel: HTMLDivElement | null = null;
  private _dbgFlags: { checked: boolean; on: boolean } = { checked: false, on: false };
  /** [v80] 调试热键是否已绑定（只绑一次） */
  private _dbgHotkeyBound = false;
  /** [v80] 控制台输出节流时间戳（面板与 console 双通道，便于用户复制数据） */
  private _dbgLastLog = 0;
  /**
   * [v76] 当前 LOD 档位。用户明确要求「近景要全模型」（两次实报近景点模共存）。
   * ⚠ 判据必须用**相机高度**（camera.position.y），不能用
   *   `camera.position.distanceTo(controls.target)` —— 后者被"跟随舰队"逻辑污染
   *   （只移 target 不移 position ⇒ 测的是舰队距相机多远，不是缩放级别）。
   */
  private lodNear = false;
  // （原 `tileByKey` + `tileKey(q,r)` 整数编码：只服务六棱柱 `heightAtPx` 查询，已随之删除）

  /**
   * [v12.2 R1] `formationOffsets(formation, n)` 的按 `(formation, n)` memo —— **本单最大的性能项**。
   * 该函数对 `spindle` 阵型近似 O(n²·log n)：逐 L（3→n）试算剖面、对每个候选 `Array.from(L).filter().sort()`，
   * 单次 n≈120 约 60 万次操作 + 近千次小数组分配。而 `writeFleetMarks`（第五遍）**每帧每队**都要它
   * ⇒ 实测 `writeFleetMarks` = 156 ms/帧（A 段 syncShips 208 ms 的最大项，占 75%）。
   * `formationOffsets` 是纯函数（只依赖 (formation, n) 且确定性），全部调用方只读其返回值
   * （已核：无 `offs[i]=` / `push·splice·sort·reverse` 等原地修改）⇒ 结果可安全长期缓存。
   * 换阵 / 减员改 n 时自然 miss 重算，语义与逐帧现算逐位相同。
   */
  private formOffsetsMemo = new Map<string, FormationCell[]>();
  private formOffsets(formation: string, n: number): FormationCell[] {
    const k = `${formation}:${n}`;
    let v = this.formOffsetsMemo.get(k);
    if (v === undefined) { v = formationOffsets(formation, n); this.formOffsetsMemo.set(k, v); }
    return v;
  }
  /** 战舰巡航余量（世界单位，= √3 × hexR 的比例）；由 computeCruiseClearance() 按纵向包络推导 */
  private cruiseClearance = 12;
  /** 硬性最小离地（地形平滑滞后时兜底防穿模） */
  private minClearance = 6;

  /**
   * 巡航高度（舰体基准 Y）—— 必须容纳**整支舰队的纵向包络**。
   *
   * 为什么不能再写死 `hexR × 3.6`：队内 `TEAM_LAYERS` 层（厚度 = (L−1)×层距）与队间 `TIER_MAX` 档
   * （±TEAM_GAP）叠加后，纵向包络可达数百世界单位；若基准高度还停在 180（hexR=50），
   * 最下面那一档会**沉到地形以下**（地形最高 `TERRAIN_MAX_H_K × hexR` = 2.2×hexR）。
   *
   * 取 `max(3.6×hexR, 地形最高 + 包络半高 + 0.6×hexR 余量)`：
   *   · 纵向包络不大时结果与旧值**逐位相同**（不改变既有观感）；
   *   · 包络变大时自动抬升，舰队整体"悬"在战场上方 —— 正是太空舰队战斗应有的样子
   *     （参考 demo：地面圆盘在 −36，舰队浮在其上）。
   *
   * 舰高按 `SHIP_RATIO.H` 最大值 × `SHIP_VISUAL_SCALE` 再留 `dimsOf` 的阵营/旗舰长度系数上限 1.6，
   * 与真正上场的舰体一致（宁可略高，也不要让底层舰沉进地形）。
   *
   * ⚠ `TEAM_LAYERS` 是层数**上限**，实际层数 = `layerCountForFootprint(...) ≤ TEAM_LAYERS`
   *   ⇒ 本式给出的包络是**保守上界**（宁可略高，也不让底层舰沉进地形）。公式保持不动。
   */
  private computeCruiseClearance(): number {
    const maxRatioH = Math.max(...Object.values(SHIP_RATIO).map((r) => r.H));
    const maxShipH = maxRatioH * 1.25 * SQ3 * this.hexR * SHIP_VISUAL_SCALE;
    const layerGap = layerGapFor(FORMATION_SPACING, maxShipH);
    const tierGap = teamGapFor(FORMATION_SPACING, layerGap, maxShipH, TEAM_LAYERS);
    const thickness = Math.max(0, TEAM_LAYERS - 1) * layerGap;
    const envelopeHalf = thickness / 2 + tierGap * ((TIER_MAX - 1) / 2);
    const terrainMax = this.hexR * TERRAIN_MAX_H_K;
    return Math.max(this.hexR * 3.6, terrainMax + envelopeHalf + this.hexR * 0.6);
  }
  /** 星球/要塞中心与半径（3D 径向避让用） */
  private planetCenters: { x: number; y: number; z: number; r: number }[] = [];
  /** 上一帧每支舰队的档位高度偏移（真源在 syncShips 内构建；此处留引用给 __b3dFocus 取景用） */
  private lastTierY = new Map<any, number>();
  /** [v65] 档位粘滞状态（跨帧持有；真源见 config/fleetTierLayout.TierSticky）——
   *  防名单抖动（侦察分队放飞/回收、真根覆灭、编制收缩）让整方跳档（用户实报 Z 轴突跳）。 */
  private tierSticky: TierSticky = new Map();
  /** 【性能】当前生效的舰船模型档位（由 autoLodByLoad 按实体负载自动切换） */
  private detailTier: 'high' | 'medium' | 'low' = 'high';
  /** 【性能】设置面板给的档位**上限**（自动降档只在其之下，不会超过用户设定） */
  private detailCeil: 'high' | 'medium' | 'low' = 'high';
  /** 【旗舰方案】本帧的旗舰单位集合（每帧在 syncShips 第一遍重建，避免逐舰 indexOf 扫描） */
  private flagshipSet = new Set<any>();

  // ---------- 指挥制后勤战 3D 可视化 ----------
  /**
   * 2D 补给链可视化（BattleScene.drawSupplyChain）画在 Phaser 层，3D 模式画布被 CSS 隐藏
   * → 指挥制 3D 战场完全看不到后勤元素（用户实报）。这里在 Three.js 层补画：
   * 后勤站八面体+补给圈 / 星球中继圈 / 运输舰橙锥+补给圈+母队连线。
   * （v12.1 起舰队补给状态环已移除。）
   * 数据源（BattleScene 公开/私有字段，any 读取）：auxShips、tilesList、store.factions.castlePos。
   * 开关沿用设置项 showSupplyChain（注意：该字段在 settingsStore，gameStore 上没有——
   * 2D 版读 gameStore 恒 undefined 导致从未真正绘制；这里读 settingsStore，无 pinia 环境默认开）。
   */
  private supplyGroup: THREE.Group | null = null;
  /** 后勤站标记：factionId → 司令部（模型或线框兜底） + SUPPLY_SOURCE_RADIUS 补给圈 */
  private supCastle = new Map<number, {
    grp: THREE.Group;          // 司令部整体（v6.10 起：有 base.glb 时为模型 holder，否则为线框三件套）
    ring: THREE.LineLoop;      // SUPPLY_SOURCE_RADIUS 补给圈（保留原语义）
    isModel?: boolean;         // 模型路径标记（颜色同步改走 sceneProps 口径，模型无自旋注册）
  }>();
  /** 星球中继圈：tile 对象 → 小圈（中立灰 / 占领后转阵营色） */
  private supPlanets = new Map<any, THREE.LineLoop>();
  /** 运输舰标记：unit 对象（稳定，aux 包装对象每帧重建不能当 key）→ 橙锥 + 补给圈 + 母队连线 */
  private supAux = new Map<any, { ring: THREE.LineLoop; link: THREE.Line; homeLink: THREE.Line }>();
  // [v12.1] supFleetRings（舰队补给状态环）已随该层整体移除，字段删除。
  /** 提督扮演 C：意图线组与句柄（我方任务=青 / 敌方接敌=红），fleet → Line */
  private intentGroup: THREE.Group | null = null;
  private intentLines = new Map<any, THREE.Line>();

  // 舰船
  private shipGroup = new THREE.Group();
  private ships = new Map<string, ShipEntry>();

  // ---------- [切片传送入场] 家园2 式 hyperspace entry（纯视觉）----------
  /**
   * 逐舰入场状态（key = UnitVis.key，**与 `ships` 解耦**）。
   *
   * ⚠ 进度绑在"**入场事件**"（首次见到该单位）上，**绝不绑 `addMesh`**：
   *   `ships` 随相机推拉建/销（`MESH_ADD_PER_FRAME`/`MESH_DROP_PER_FRAME`），
   *   若把动画挂在 `addMesh` 上，推拉镜头就会**反复重播**切片。本表按单位存活长期持有
   *   ⇒ 实体中途被销毁再重建时，从**当前进度续切**（不重播）。
   */
  private entryStates = new Map<string, EntryShip>();
  /** 入场登记窗口的起点（秒）—— **只由 `startEntryFx()` 显式写入**（= 开战时刻）。
   *  ⚠ 不再用 `entryEpoch === 0` 表达"未开始"（那会让"未开始"与"恰在 0 秒开始"混淆）。 */
  private entryEpoch = 0;
  /** [入场时机修复] 是否已"开战"（由 `startEntryFx()` 显式置真）。为假 ⇒ `registerEntryState`
   *  一律不登记。根因：3D 层是**独立 rAF 循环**（不受 `store.isPaused` / Phaser `update()` 影响），
   *  部署期照样在跑 ⇒ 舰队在部署期就已被"首次见到"；若不拦住，切片动画会在被
   *  `BattleIntroOverlay`（z-index:60 全屏）盖住的部署期播完 ⇒ 玩家回车开战时看不到入场。 */
  private entryStarted = false;
  /** 本帧"入场特效是否开启"（一键关闭开关；每帧只在 syncShips 里读一次 window）。 */
  private entryFxActive = SLICE_ENTRY_ENABLED_DEFAULT;
  /** 切片参数（集中常量，便于按真机截图迭代）。 */
  private entryCfg: EntryCfg = ENTRY_CFG_DEFAULT;
  /**
   * [v2] **一队一门**：fleet → 传送门（5 个共享裁剪面 + 可见门框/位面 + 扫描行程）。
   * 与 `entryStates` 的分工：本表是**几何/时序真源**（每门算一次即可），
   * `entryStates` 只回答"这艘舰还在不在入场中"（供 `entryActiveOf` 强制建实体 + grow=1）。
   */
  private fleetGates = new Map<any, FleetGate>();
  /** 写门框/位面姿态用的复用矩阵（不每帧 new）。 */
  private gateBasis = new THREE.Matrix4();
  /** [v3.1 · S] 球体逐帧摆位的复用临时量（瓦片数 × 每帧 ⇒ 必须零分配）。 */
  private sphereTmpQ = new THREE.Quaternion();
  private sphereTmpP = new THREE.Vector3();
  private sphereTmpAxis = new THREE.Vector3();
  private sphereTmpView = new THREE.Vector3();
  private sphereTmpColor = new THREE.Color();
  /** [v3.2] 球心亮核用的**纯白**目标色（正对相机的瓦片向它提亮 ⇒ 中心过曝）。 */
  private sphereTmpWhite = new THREE.Color(1, 1, 1);
  /** [v3.1 · S] "最近 N 支舰队"的按帧缓存（键 = `now`；见 `spherePrimaryFleets`）。 */
  private spherePrimaryAt = -1;
  private spherePrimaryCache: any[] = [];
  /** [v3.1 · S] 球体**创建 / 销毁台账**（真机取证与红队用它独立核对"入场结束后零残留"）。 */
  private sphereBuiltCount = 0;
  private sphereDisposedCount = 0;
  /** 门推进面前一帧的沿轴坐标（算"扫掠速度"给位面做亮度脉冲）。 */
  private gatePrevPos = 0;

  // ---------- 三级表示：光点层 + 光晕层（各 1 个 Points = 各 1 个 draw call）----------
  /** 光点层：全场景 1 个 Points，容量 `DOT_SLOTS`（= N_MAX × DOT_N = 1400 × 1，覆盖全场实体预算），
   *  超出不重建、用 alpha 屏蔽（drawRange 截断即不绘制）。⚠ 不再是 `MAX_MESHES * DOT_N`（那会塌到 400）。 */
  private dotPoints: THREE.Points | null = null;
  private dotGeo: THREE.BufferGeometry | null = null;
  private dotPos = new Float32Array(DOT_SLOTS * 3);
  private dotCol = new Float32Array(DOT_SLOTS * 3);
  private dotAlpha = new Float32Array(DOT_SLOTS);
  private dotPx = new Float32Array(DOT_SLOTS);
  /** 光晕层：接住"实体已存在但还没长实"的亮度缺口（depthTest=false 压在舰体之上） */
  private haloPoints: THREE.Points | null = null;
  private haloGeo: THREE.BufferGeometry | null = null;
  private haloPos = new Float32Array(MAX_MESHES * 3);
  private haloCol = new Float32Array(MAX_MESHES * 3);
  private haloAlpha = new Float32Array(MAX_MESHES);
  private haloPx = new Float32Array(MAX_MESHES);
  /** 全部存活单位的可见性状态（含未获实体者）；[v12.2 R1] 由 syncShips **每帧就地更新**（不再 clear+重建） */
  private unitVis = new Map<string, UnitVis>();
  /** ★ v8 运输舰的**独立渲染宿主**（unit → host）：运输舰不隶属任何舰队，`unitVis[].fleet`
   *  需要一个承载对象来跑既有的 LOD/光点/实体管线。该宿主**只服务于这一艘运输舰**：
   *    · 只有 `{ id: 'aux:*', factionId, units: [u], _isAux: true, aux, x, y, facingSmooth }`；
   *    · 因此 LOD 的 `fleetPx`（成员 px 均值）**恒等于它自己的 px**（成员只有它自己）；
   *    · 托盘/名牌/高度档/门/拾取一律按 `_isAux` 显式跳过（它不是舰队，不该有舰队表示）。
   *  host 引用跨帧稳定（Map 键 = unit）⇒ 门/缓存/拾取不会每帧换对象。 */
  private auxHosts = new Map<any, any>();
  /** px 计算用临时向量（避免每帧 200 次分配；同一次计算里复用为 sx/sy 的投影载体） */
  private visTmpV = new THREE.Vector3();
  /** 远景点阵分桶（屏幕空间 cell key → 该格代表点 UnitVis）。每帧 clear() 复用同一实例，不 new。 */
  private dotGrid = new Map<string, UnitVis>();
  /** 【旗舰方案】本帧每格胜出者 key（第二遍写入时登记；第三遍据此判断"旗舰是否已被本格覆盖"）。
   *  每帧 clear() 复用同一实例，不 new。 */
  private dotWinnerKeys = new Set<string>();
  /** 【旗舰方案】本帧旗舰的 UnitVis 缓存（第一遍顺手收集，长度 = 舰队数 ≪ 单位数）。
   *  第三遍据此补写"被同格邻舰挤掉的旗舰"——用 UnitVis 直取，避免从 `u` 反查 key 的规则耦合。
   *  每帧 `length = 0` 后 push 复用，不 new。 */
  private flagVisBuf: UnitVis[] = [];

  // ---------- 分舰队阵型标记层（demo 三级里游戏缺的整层）----------
  /** 标记容器（子对象顶点即世界坐标，容器恒在原点；destroy 靠 scene.traverse 统一释放） */
  private markGroup: THREE.Group | null = null;
  /** 每支分舰队一条记录（fid → 标记）。舰队增删 / 换阵 / 开局格数变化时重建 */
  private fleetMarks = new Map<number, FleetMark>();
  /** 每帧复用的"舰队 → 队内最低舰高 / 最长舰长"聚合（避免每帧分配） */
  private markAgg = new Map<number, { fleet: any; minY: number; maxShipLen: number; maxShipW: number }>();
  /** 上帧分层统计（__b3dStats 调试口 / 验收用） */
  private lastStats = {
    units: 0, meshes: 0, points: 0, halos: 0,
    /** 实体池候选数（px ≥ MESH_KEEP 或已持实体且 px ≥ MESH_DROP）与实际保留数 */
    elig: 0, kept: 0,
    /** 光晕范围内（实体已存在但 meshOn < 1）的舰数 */
    haloElig: 0,
    /** 按 px 三档分组：px ≥ MESH_IN_HI 近景实体 / DOT_IN_LO~MESH_IN_HI 中景光点 / < DOT_IN_LO 远景点阵。
     *  （三档都仍有光点表示 —— 远景点阵由屏幕空间点距下限 DOT_PITCH_MIN_PX 驱动，不是"无表示"。） */
    near: 0, mid: 0, far: 0,
    /** 被池上限挤出、因此退回光点层接住的舰数（demo 的"幽灵态回补"等价物） */
    pooled: 0,
    /** 本帧可见的阵型标记数（markerAlpha > 0.01 且已落位） */
    marks: 0,
    /** 本帧全队统一的标记透明度 = max(1−sstep(refPx), MARKER_FLOOR) × (1−sstep(meshIn, refPx)) */
    markerAlpha: 0,
    /** [WS7] 本帧实际生效的实体池预算（未开 governor 时恒 = MAX_MESHES） */
    meshBudget: MAX_MESHES,
    /** [WS7] 帧时 EMA（ms），未开 governor 时不做统计保持 0 */
    frameMs: 0,
  };

  // ── [WS7] 主场景渲染统计快照 ──
  // three 的 renderer.info 在每次 render() 前 autoReset，而 tick() 最后还有一次 CRT 全屏合成
  // （postScene/postCam 的 1 个 quad）会把它冲掉 —— 直接用 renderer.info.render 读到的永远是
  // "1 次 draw call"。必须在主场景 render 之后、后处理之前抓一份快照。
  private lastRender = { calls: 0, points: 0, triangles: 0 };

  // ── [WS7] 性能兜底状态（只在 opts.perfGovernor 打开时更新）──
  private perfOn = false;
  private perfFrame = 0;
  private frameEmaMs = 0;
  private perfCooldown = 0;
  /** [v12.1 C1] 自动 LOD 的帧时压力判据冷却（秒）：降档/回升档共用，防抖 */
  private lodCooldown = 0;
  /** [v12.1 C1] 帧时压力下界（0=high / 1=medium / 2=low）：**棘轮**式只受帧时驱动。
   *  finalIdx = max(数量判据Idx, lodPressure) —— 数量判据（负载低时想回 high）无法抵消帧时压力，
   *  避免两者每 0.5s 互相拉锯造成档位抖动（首版实测 120s 内抖动 23 次）。只有帧时真正恢复
   *  （EMA < PERF_COMFORT_MS 且负载不高）才逐级回落。 */
  private lodPressure = 0;

  // ── [v12 P3] 3D 战场画质档 → 分辨率上限 + 离屏 MSAA 采样数（renderer 与 RT 同源）──
  private battle3dQuality: 'high' | 'medium' | 'low' = 'high';
  // ── [v4] 开场动画形式（设置项 entryFxStyle → 内部门风格）：3D 层创建时**读取一次** ⇒ 下一场战斗生效 ──
  /** 运行时门风格（`'D'` 传送门 / `'S'` 能量球 / `'A'|'B'|'C'` 旧门）。设置不可得 ⇒ 编译期默认 `GATE_STYLE`。 */
  private gateStyle: GateStyleId = GATE_STYLE;
  /** 设置项是否**关闭**了入场特效（`entryFxStyle === 'off'`）⇒ 不建任何对象、不聚焦（暂停由 BattleScene 同判）。 */
  private entryFxOff = false;
  private dprCap = 2;
  private msaaSamples = 4;
  /** [v56 性能] 动态分辨率系数（1 = 满分辨率）。帧时持续超预算时由 updatePerfGovernor
   *  逐步收到 DPR_SCALE_MIN，流畅后自动回升 —— 填充率瓶颈（近景透明舰体 + 齐射加色特效
   *  铺满屏）下这是最直接的帧率杠杆，且远景恢复流畅即回到满清晰度。 */
  private dprScale = 1;
  // ── [v12 P3] 显示帧率：极简 FPS DOM 读数（默认关；开启时才建元素）──
  private fpsOn = false;
  private fpsEl: HTMLDivElement | null = null;
  private fpsAccum = 0;
  private fpsFrames = 0;

  // 3D 舰队 billboard 状态条（App.vue 的 2D 跟随层在 3D 模式被整层隐藏，此处补回）
  private bbLayer: HTMLDivElement | null = null;
  private billboards = new Map<string, FleetBillboard>();
  /** 每帧复用，避免 updateBillboards 内反复 new */
  private bbProjV = new THREE.Vector3();
  private bbAccum = new Map<string, { fleet: any; n: number; sx: number; sy: number; sz: number }>();
  /**
   * [W5.3] 指挥点即时回执的**就近 DOM 浮动提示**（锚在点击世界点，复用 billboard 同投影）。
   * 数据源 = `battle3dFx` 的 `pointer_notice` 事件（右键成功/失败在**按下同帧**推送）。
   */
  private pointerNotices: { el: HTMLDivElement; at: { x: number; y: number }; until: number }[] = [];

  // 特效池
  private lasers: LaserEntry[] = [];
  private hits: HitEntry[] = [];
  private shields: ShieldEntry[] = [];
  /** v5: 3D 舰载机小队（母舰释放→突防→格斗→击落/返航，emperor：撞击判定走事件） */
  private strikes: StrikeSquad[] = [];

  // 占领作战视觉
  private boatInst!: THREE.InstancedMesh;
  private boatDummy = new THREE.Object3D();
  private boats: BoatAnim[] = [];
  private captures = new Map<string, CaptureState>();
  /** v6.3：中继补给站陀螺仪双环（buildTerrainMarkers 创建，每帧微转） */
  private relayRings: { a: THREE.Mesh; b: THREE.Mesh }[] = [];
  /** v6.7：司令部信标的核心 mesh（线框八面体，每帧自旋"活的指挥节点"） */
  private fortressRings: THREE.Mesh[] = [];
  /** 迷雾情报：castle tile 标记（信标柱/模型）按 ownerId 登记，敌方未发现前隐藏 */
  private castleMarkers = new Map<number, THREE.Object3D[]>();
  /** v6.9：伊谢尔伦雷神之锤 3D 特效——充能光球（每帧推进）与光束（复用 lasers 池寿命延长） */
  private fortressCharges: { group: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; t: number; dur: number }[] = [];
  /** v6.10：设施模型槽位（assets/scene/ 的 GLB 替代程序化标记）。
   *  有模型文件时立即建 holder（空壳）并登记；模型就绪后在 updateSceneProps 原地挂载。
   *  holder 局部原点 = 地面（y=0），模型贴地/悬浮由 buildScenePropFromModel 处理。 */
  private scenePropSlots: Array<{ key: string; holder: THREE.Group; reg: ScenePropReg; modelVer: number; color: number }> = [];

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
  private spaceBuilt = false;
  private spaceGroup: THREE.Group | null = null;
  /**
   * [v36c] 空域地形分区层。指挥制下**唯一可见**的地形呈现（Phaser 画布被
   * `body.battle3d-mode` 的 CSS 整体隐藏，见 `buildTerrainZones` 注释）。
   */
  /** [v38 · G3] 占领进度环（只在 0 < captureProgress < 100 的目标上出现） */
  private captureGroup: THREE.Group | null = null;
  private captureRings: Map<any, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = new Map();
  private capturePulseT = 0;
  /** 探针读数（L2 用）：当前在画的占领环数量 + 脉冲值 */
  captureStats: { active: number; pulse: number } | null = null;
  private terrainZoneGroup: THREE.Group | null = null;
  /** [QA 只读] 分区层构建筑计：供 L2 探针断言"确实建了、且数量对得上"。 */
  terrainZoneStats: { cells: number; types: number; mode: 'contour' | 'scanline' | 'fill'; fills: number; edges: number; lines: number; tris: number } | null = null;
  /** 构造时间戳：onReady 迟迟不触发时供外部判断降级 */
  readonly createdAt = Date.now();

  constructor(container: HTMLElement, scene: Phaser.Scene, store: any, opts: OverlayOpts = {}) {
    this.container = container;
    this.battleScene = scene;
    this.store = store;
    this.opts = opts;
    this.perfOn = opts.perfGovernor === true;

    // 舰船模型档位：在 3D 层创建时从设置注入（新建的舰船按该档位取模型）。
    // 注意：注册表按 URL 缓存且已建好的舰船持有旧几何，故档位改动对**本场已生成的舰船**不生效
    // —— 重新进入 3D 战场生效（设置面板只挂在标题页/存档页，战场内改不了档位，故实际等于立即生效）。
    // 热切换需要重建整层，不在本次范围内。
    try {
      this.detailCeil = useSettingsStore().getShipModelDetailValue();
    } catch { /* headless / 无 store 时保持 high */ }
    this.detailTier = this.detailCeil;
    try { setShipModelDetail(this.detailTier); } catch { /* headless 时忽略 */ }

    // [v12 P3] 3D 战场性能设置（画质档 / 帧率保护 / 显示帧率）——与 shipModelDetail 同规则：
    // 本层创建时读取一次，**下一场战斗生效**（热切换需重建整层）。全部 try/catch 兜底（headless 安全）。
    try { this.battle3dQuality = useSettingsStore().getBattle3dQualityValue(); } catch { /* 无 store 默认 high */ }
    try { this.perfOn = this.perfOn || useSettingsStore().getBattle3dPerfGuardValue() === true; } catch { /* 保持 opt 值 */ }
    try { this.fpsOn = useSettingsStore().getBattle3dShowFpsValue() === true; } catch { /* 默认关 */ }
    // [v4] 开场动画形式（door / sphere / off）——3D 层创建时读取一次；`off` ⇒ 完全跳过入场特效。
    try {
      const mapped = gateStyleForEntryFx(useSettingsStore().getEntryFxStyleValue());
      this.entryFxOff = mapped === null;
      if (mapped) this.gateStyle = mapped;
    } catch { /* headless / 无 store ⇒ 用编译期默认 GATE_STYLE */ }
    // 画质档 → 分辨率上限 + 离屏 MSAA（renderer 与 RT 必须同源，故统一由此推导）
    const q = BATTLE3D_QUALITY[this.battle3dQuality] ?? BATTLE3D_QUALITY.high;
    this.dprCap = q.dprCap;
    this.msaaSamples = q.msaa;

    // ⚠ 2026-09-20：原「六棱柱沙盘 / 纯宇宙」双模式已删除 —— 战斗只有纯宇宙（指挥制）。

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040810);
    this.scene.fog = new THREE.Fog(0x040810, 600, 1600);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 4000);

    // [v12 P1] 画布级 MSAA 关掉 + 请求独显：
    //   · antialias:false —— 本层只有两次 render：主场景进离屏 RT（RT 自带 samples MSAA），
    //     再把覆盖全屏的 quad 合成到默认帧缓冲。默认帧缓冲上**没有几何边缘**，画布级 MSAA 无效，
    //     只是白白分配一个多重采样后备缓冲（核显上按 2×dpr 是实打实的显存/带宽）。
    //   · powerPreference:'high-performance' —— 双显卡机器优先请求独显；单核显无副作用。
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    // [切片传送入场] **必须开"局部裁剪"**（材质级 clippingPlanes 生效的前提）：
    //   ⚠ 绝不能用 `renderer.clippingPlanes`（全局裁剪）—— 那会连带切掉星空 / 地形 / CRT 后处理 quad。
    //   局部裁剪本身对既有渲染零影响（无材质声明 clippingPlanes ⇒ `numPlanes = 0` ⇒ 与未开启逐位相同）。
    this.renderer.localClippingEnabled = true;
    this.renderer.setSize(w, h);
    // [v12 P3] dpr 上限取自画质档（high=2 = 现状）；[v56] 统一走 effDpr()（×动态分辨率系数）
    this.renderer.setPixelRatio(this.effDpr());
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
    // [v12 P3] 可选：极简帧率读数（默认关，设置开启时才建 DOM）
    this.initFpsReadout();

    // ── CRT 后处理：离屏 MSAA 渲染 + 全屏合成（对齐原型观感）──
    // [v12 P3] dpr 上限与 MSAA 采样数取自画质档（high: dpr≤2 + 4× = 现状逐位不变）；[v56] 同源 effDpr()
    const dpr = this.effDpr();
    this.rt = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)), { samples: this.msaaSamples });
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
    // [VIS-1] 滚轮缩放朝**光标**推进（three r152+ 官方选项），不再朝 controls.target：
    //   旧实现朝陈旧 target（战场中心）推进 ⇒ 敌群偏轴时拉近即滑出画框
    //   （用户实报"近景逐渐看不见→最近完全看不见"；probe4 d400→d200 截图复现滑出过程）。
    //   光标对准敌群拉近 ⇒ 敌群锁定在光标附近，px 随距离单调放大。
    this.controls.zoomToCursor = true;
    // 纯宇宙：无"地平线穿帮"问题，放开为全向自由旋转（对齐战略地图手感）
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    // 距离上下限在 buildSpaceWorld 按地图跨度定（此处先给安全占位）
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
    // 三级表示的中景光点层 + 光晕层（各 1 个 Points；renderOrder 1 / 6）
    this.buildShipDots();
    // 三级表示的标记层（远景唯一表示；中景降为 MARKER_FLOOR 的"队形底"与光点叠两层）
    this.buildFleetMarks();

    // [切片传送入场 v2] 门本体（门框 + 位面）是**按舰队懒建**的（见 `buildGateVisual`），
    //   此处不预建 —— 开场没有门，只有 `startEntryFx` 之后登记到舰队时才建。

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

    // [验收] 三级表示调试口：控制台 / 自动化脚本读取上一帧分层统计。
    //   近景 near（px ≥ MESH_IN_HI，实体）/ 中景 mid（DOT_IN_LO ~ MESH_IN_HI，光点）/ 远景 far（< DOT_IN_LO，光点阵）
    //   meshes = 实际持实体的舰数（受 MAX_MESHES 池上限约束），points/halos = 有效点数。
    //   纯读取，不改变渲染状态；跨帧有效（需要先跑过一帧 tick 才有非零值）。
    (window as any).__b3dStats = () => ({
      units: this.lastStats.units,
      meshes: this.ships.size,
      points: this.lastStats.points,
      halos: this.lastStats.halos,
      maxMeshes: MAX_MESHES,
      elig: this.lastStats.elig,
      kept: this.lastStats.kept,
      haloElig: this.lastStats.haloElig,
      near: this.lastStats.near,
      mid: this.lastStats.mid,
      far: this.lastStats.far,
      pooled: this.lastStats.pooled,
      // 阵型标记层：marks = 本帧可见标记数，markerAlpha = 全队统一透明度
      // （远景 ≈ 1，中景降到 MARKER_FLOOR 支路，近景随 meshOff 归零；见 writeFleetMarks 的分支）
      marks: this.lastStats.marks,
      markerAlpha: this.lastStats.markerAlpha,
      // 主场景 GPU 提交量（[WS7] 修：取主场景 render 后的快照，不是 CRT 后处理的 1 个 quad）
      renderCalls: this.lastRender.calls,
      renderPoints: this.lastRender.points,
      renderTris: this.lastRender.triangles,
      // [WS7] 实体池预算与帧时 EMA（未开 perfGovernor 时 = MAX_MESHES / 0）
      meshBudget: this.lastStats.meshBudget,
      frameMs: +this.lastStats.frameMs.toFixed(2),
      // [v56 性能] 动态分辨率系数（1 = 满分辨率；<1 = governor 收缩中）
      dprScale: +this.dprScale.toFixed(3),
    });

    // [验收·WS7] 性能兜底调试口：开/关 + 即时读数。纯读取/单点开关，不改渲染路径。
    (window as any).__b3dPerf = {
      enabled: () => this.perfOn,
      set: (on: boolean) => { this.perfOn = on === true; if (!this.perfOn) this.lastStats.meshBudget = MAX_MESHES; },
      frameMs: () => +this.lastStats.frameMs.toFixed(2),
      meshBudget: () => this.lastStats.meshBudget,
      bounds: { max: MAX_MESHES, min: MESH_BUDGET_MIN, budgetMs: PERF_BUDGET_MS, comfortMs: PERF_COMFORT_MS, warmupFrames: PERF_WARMUP_FRAMES },
    };

    /**
     * [验收] 标记底框 ↔ 舰位 一致性探针。
     * 存在理由：用户实机在若干角度看到"整块标记底板在屏幕上、单舰却看不见"，
     * 需要区分是**标记错位**还是**光点阈值把舰吃掉**。这里同时给出：
     *   unitCentroid（舰位均值，px 坐标）、anchor（fleet.x/y，标记中心的基准）、
     *   markerCenter（标记实际世界中心反算回 px）、offsN（标记按 n0 枚举的格数）、units（实际舰数）、
     *   pxStat（该队 px 的 min/中位/max）、tier（near/mid/far 各几艘）。
     * 纯读取，不改任何渲染状态。
     */
    (window as any).__b3dMarkProbe = () => {
      const byFleet = new Map<any, any[]>();
      this.unitVis.forEach((v) => {
        const fl = v.fleet; if (!fl) return;
        const a = byFleet.get(fl); if (a) a.push(v); else byFleet.set(fl, [v]);
      });
      const out: any[] = [];
      byFleet.forEach((list, fl) => {
        const fid = fl.id !== undefined ? fl.id : fl.factionId;
        const m = this.fleetMarks.get(fid);
        let sx = 0, sy = 0, n = 0, pmin = Infinity, pmax = 0, near = 0, mid = 0, far = 0;
        for (const v of list) {
          sx += v.u.sprite.x; sy += v.u.sprite.y; n++;
          pmin = Math.min(pmin, v.px); pmax = Math.max(pmax, v.px);
          if (v.px >= this.lodHi) near++; else if (v.px >= DOT_IN_LO) mid++; else far++;
        }
        const px = list.map((v) => v.px).sort((a, b) => a - b);
        const centX = n ? sx / n : 0, centY = n ? sy / n : 0;
        // 标记中心：把 fill 的顶点均值当中心（顶点已在世界系，直接取均值即包围盒中心）
        let mx = 0, my = 0, mz = 0;
        if (m?.fill?.geometry) {
          const arr = m.fill.geometry.attributes.position.array as Float32Array;
          const cnt = arr.length / 3;
          for (let i = 0; i < cnt; i++) { mx += arr[i * 3]; my += arr[i * 3 + 1]; mz += arr[i * 3 + 2]; }
          mx /= cnt; my /= cnt; mz /= cnt;
        }
        out.push({
          fid, formation: fl.formation,
          units: n, offsN: (fl as any).formationCount0 ?? null,
          anchor: [+fl.x.toFixed(1), +fl.y.toFixed(1)],
          unitCentroid: [+centX.toFixed(1), +centY.toFixed(1)],
          anchorToCentroid: [+(centX - fl.x).toFixed(1), +(centY - fl.y).toFixed(1)],
          markerCenter: [+mx.toFixed(1), +my.toFixed(1), +mz.toFixed(1)],
          markerVsCentroidXZ: [+(mx - centX).toFixed(1), +(mz + centY).toFixed(1)],
          span: m ? [+m.spanX.toFixed(1), +m.spanY.toFixed(1)] : null,
          px: { min: +pmin.toFixed(1), med: +(px[px.length >> 1] ?? 0).toFixed(1), max: +pmax.toFixed(1) },
          tier: { near, mid, far },
          markerAlpha: m ? +m.fillMat.opacity.toFixed(3) : null,
          outlineAlpha: m ? +m.outlineMat.opacity.toFixed(3) : null,
        });
      });
      return out;
    };

    // [验收·大军团] 取景调试口：把轨道相机对准某支舰队的几何中心（可选按"队列序号"选，
    //   默认取场上实体最多的那支）。存在的理由：缩舰后"密密麻麻的很多层"只能在**贴近舰队**的
    //   机位上看出来，而 OrbitControls 没有对外接口，自动化截图无法只靠滚轮对准目标。
    //   纯读取 + 设相机，不改任何渲染状态。
    (window as any).__b3dFocus = (opts?: { fleetIndex?: number; dist?: number; elev?: number; azim?: number }) => {
      const o = opts || {};
      const fleets: any[] = ((this.battleScene as any).globalFleets || []).filter((f: any) => (f.units || []).length > 0);
      if (!fleets.length) return null;
      let target = fleets[0];
      if (typeof o.fleetIndex === 'number') target = fleets[Math.max(0, Math.min(fleets.length - 1, o.fleetIndex))];
      else {
        for (const f of fleets) if ((f.units || []).length > (target.units || []).length) target = f;
      }
      // 质心（世界坐标）：x/z 取 2D sprite 均值，y 取地形高 + 巡航余量 + 该队档位偏移
      let cx = 0, cy = 0, n = 0;
      for (const u of (target.units || [])) { if (!u.sprite) continue; cx += u.sprite.x; cy += u.sprite.y; n++; }
      if (!n) return null;
      cx /= n; cy /= n;
      const tierY = this.lastTierY.get(target) ?? 0;
      const wy = this.heightAtPx(cx, cy) + this.cruiseClearance + tierY;
      const t = new THREE.Vector3(cx, wy, -cy);
      const dist = o.dist ?? this.hexR * 7;
      const elev = o.elev ?? 0.55;      // 俯角（弧度）；近俯视会把多层压平
      const azim = o.azim ?? 0.6;
      this.controls.target.copy(t);
      this.camera.position.set(
        t.x + Math.sin(elev) * Math.sin(azim) * dist,
        t.y + Math.cos(elev) * dist,
        t.z + Math.sin(elev) * Math.cos(azim) * dist,
      );
      this.camera.lookAt(t);
      this.controls.update();
      return { fleetIndex: fleets.indexOf(target), units: (target.units || []).length, target: [t.x, t.y, t.z].map((v) => +v.toFixed(2)), dist, elev, tierY: +tierY.toFixed(2) };
    };

    //   队内层统计 + 所属高度档，供自动化脚本做定量断言（不与渲染帧耦合，纯读取）。
    //   层号真源 = fleetVLayout().layerK（与渲染逐位同源）；档位真源 = tierCountFor/tierIndexOf/tierOffsetOf。
    (window as any).__b3dVLayout = () => {
      const fleets: any[] = (this.battleScene as any).globalFleets || [];
      const bySide = new Map<any, any[]>();
      for (const f of fleets) {
        const us: any[] = f.units || [];
        if (!us.length) continue;
        const a = bySide.get(f.factionId);
        if (a) a.push(f); else bySide.set(f.factionId, [f]);
      }
      const tierY = new Map<any, number>();
      const sides: any[] = [];
      // 档距/档位与 syncShips 第零遍**共用同一个真源函数**（此前两处各抄一份逻辑，
      //   改一处漏一处会让"探针读数"与"实际渲染"静默分叉 —— 本项目已经踩过一次）。
      const gapOf = (f: any) => {
        const v = this.fleetVLayout(f);
        return teamGapFor(v.spacing, v.layerGap, v.maxH, v.layers);
      };
      bySide.forEach((list, sid) => {
        let gap = 0;
        for (const f of list) { const g = gapOf(f); if (g > gap) gap = g; }
        const roots = list.filter((f: any) => f._detachedFrom == null);
        const tiers = tierCountFor(roots.length || list.length);
        const mults = tierMultipliers(tiers);
        const tierOf = assignFleetTiers(list, gapOf, DETACHED_TIER_OFFSET, this.tierSticky);
        tierOf.forEach((y, f) => tierY.set(f, y));
        sides.push({
          factionId: sid, fleets: list.length, roots: roots.length, tiers, teamGap: gap,
          mults, ys: mults.map((m) => m * gap), detachedTierOffset: DETACHED_TIER_OFFSET,
          fleetYs: list.map((f: any) => +(tierOf.get(f) ?? 0).toFixed(2)),
        });
      });

      const stat = (ks: number[], gap: number) => {
        const uniq = [...new Set(ks.map((k) => Math.round(k * 1e6)))].sort((a, b) => a - b).map((v) => v / 1e6);
        const ys = uniq.map((k) => k * gap);
        const gaps: number[] = [];
        for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
        const gm = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
        const gsd = gaps.length ? Math.sqrt(gaps.reduce((a, b) => a + (b - gm) ** 2, 0) / gaps.length) : 0;
        return { uniq: ys, levels: ys.length, gaps, gapMean: gm, gapCV: gm === 0 ? 0 : gsd / gm, minY: ys[0] ?? 0, maxY: ys[ys.length - 1] ?? 0 };
      };

      const outFleets = fleets.map((f) => {
        const us: any[] = f.units || [];
        const alive = us.filter((u: any) => u.sprite && u.hp > 0);
        const v = this.fleetVLayout(f);
        const n0: number = (f as any).formationCount0 ?? us.length;
        const offs = this.formOffsets(String(f.formation || 'wedge'), n0);
        const order = offs.map((_, i) => i).sort((a, b) => (offs[a][0] - offs[b][0]) || (offs[a][1] - offs[b][1]));
        const rankOf = new Map<number, number>();
        order.forEach((slot, rank) => rankOf.set(slot, rank));
        // 逐舰层号（含已死的，用战前编制口径，与渲染的层号同源）
        const ks: number[] = []; const ranks: number[] = []; const rowMap = new Map<number, Set<number>>();
        // 排内序列（按 gy 升序）—— monoRows 判定的输入，与 layerK 同源（战前编制口径）
        const rowSeq = new Map<number, { gy: number; k: number }[]>();
        for (let i = 0; i < offs.length; i++) {
          const k = v.layerK[i] ?? 0;
          ks.push(k); ranks.push(rankOf.get(i) ?? i);
          const gx = offs[i][0];
          let s = rowMap.get(gx); if (!s) { s = new Set(); rowMap.set(gx, s); } s.add(Math.round(k * 1e6));
          let q = rowSeq.get(gx); if (!q) { q = []; rowSeq.set(gx, q); } q.push({ gy: offs[i][1], k });
        }
        const S = stat(ks, v.layerGap);
        // 层计数 / 平衡：balanceIndex = max(layerN) − min(layerN)（demo 口径，理想 ≤1）
        const cnt = new Map<number, number>();
        for (const k of ks) { const key = Math.round(k * 1e6); cnt.set(key, (cnt.get(key) || 0) + 1); }
        const vals = [...cnt.values()];
        const balanceIndex = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
        // staircaseIndex = 相邻名次之间"层号未变"的比例（按几何名次 (gx,gy) 排序）：
        //   0 = 完全交错（每步换层）｜→1 = 每排是同一层整块抬升（已废弃的 'ramp'）。
        // ⚠ 【遗留判据，不要当 PASS 条件】旧实现 `rank % L` 下相邻名次必然换层 ⇒ 该值恒为 0，
        //   它对"排内层号单调"这一真缺陷维度**结构性失明**（历史 QA 因此一直 PASS）。
        //   改为 R2 后相邻名次可能同层，该值不再期望 ≈ 0。三维阵型的主判据是 monoRows/multiRows == 0。
        const ordIdx = [...ranks.keys()].sort((a, b) => ranks[a] - ranks[b]);
        let sameAdj = 0;
        for (let i = 1; i < ordIdx.length; i++) {
          if (Math.round(ks[ordIdx[i]] * 1e6) === Math.round(ks[ordIdx[i - 1]] * 1e6)) sameAdj += 1;
        }
        const staircaseIndex = ordIdx.length > 1 ? sameAdj / (ordIdx.length - 1) : 0;
        // ── 三维阵型判据（WS11）：「排内层号单调」是"从正面看是一条斜线"的直接成因，逐排统计 ──
        // monoRows = 宽度 ≥ 3 的排里、层号序列"单调不减"或"单调不增"的排数（1e-9 容差）；
        // multiRows = 宽度 ≥ 3 的排总数。旧实现该比值实测 96/131 ≈ 0.733；R2 + 单调修复后应为 0。
        let monoRows = 0; let multiRows = 0;
        rowSeq.forEach((cells) => {
          if (cells.length < 3) return;
          multiRows += 1;
          cells.sort((a, b) => a.gy - b.gy);
          let inc = true; let dec = true;
          for (let i = 1; i < cells.length; i++) {
            if (cells[i].k < cells[i - 1].k - 1e-9) inc = false;
            if (cells[i].k > cells[i - 1].k + 1e-9) dec = false;
          }
          if (inc || dec) monoRows += 1;
        });
        // 纵向实际跨度（层号极差 × 层距）与"是不是针"的比值
        let kMin = Infinity; let kMax = -Infinity;
        for (const k of ks) { if (k < kMin) kMin = k; if (k > kMax) kMax = k; }
        const vert = (ks.length ? (kMax - kMin) : 0) * v.layerGap;
        const minSpan = Math.min(v.footprint.widCells, v.footprint.depCells) * v.spacing;
        // ⚠ 分母必须带 1e-6 下限：不允许出现 Infinity/NaN（formationFootprint 两方向都下限为 1）
        const thinRatio = vert / Math.max(1e-6, minSpan);
        let rowsSpanAllLayers = 0;
        rowMap.forEach((s) => { if (s.size >= v.layers) rowsSpanAllLayers += 1; });
        return {
          fid: f.id ?? f.factionId, factionId: f.factionId, formation: String(f.formation || 'wedge'),
          n: alive.length, n0, layers: v.layers, layerGap: v.layerGap, maxH: v.maxH, spacing: v.spacing,
          layerCap: TEAM_LAYERS,
          widCells: v.footprint.widCells, depCells: v.footprint.depCells, minSpan, vert, thinRatio,
          monoRows, multiRows,
          tierY: tierY.get(f) ?? 0, ...S, staircaseIndex, balanceIndex,
          rowsTotal: rowMap.size, rowsSpanAllLayers,
        };
      });
      return { fleets: outFleets, sides };
    };
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
    pts.name = 'sceneStars';   // [v77] 供调试隐藏开关 getObjectByName 定位
    this.scene.add(pts);
  }

  // ---------- 像素 → 世界 ----------
  /** BattleScene 像素坐标 → 3D 世界坐标（y 取反成 z，heights 单位=像素） */
  private pxToWorld(x: number, y: number, extraY = 0): THREE.Vector3 {
    return new THREE.Vector3(x, extraY, -y);
  }



  // ---------- 地形 ----------
  /**
   * 像素点地面高度。
   *
   * 纯宇宙战场的地面就是 y=0 的网格基准面（舰船在固定巡航高度飞行）⇒ **恒 0**。
   * 原实现查六棱柱地形高度，属已删除的「3D 战场」模式；保留同名常量桩是为了
   * 让 4 处调用点（单位放置 / 舰体基准高 / 补给圈 / 巡航高度）零改动。
   */
  private heightAtPx(_px: number, _py: number): number {
    return 0;
  }

  /**
   * [v36c] **空域地形分区层** —— 指挥制下唯一真正看得见的地形呈现。
   *
   * ── 为什么必须画在 3D 层，而不是 Phaser ──────────────────────────────
   * `App.vue` 在 overlay 就绪后给 body 加 `battle3d-mode`，其 CSS 为
   *   `body.battle3d-mode #phaser-canvas-container canvas { visibility: hidden }`。
   * 2026-09-20 起 `is3dBattle = (gameState === 'game')`（原按 `mapStyle` 分流的判断已随
   * 三模式一起删除）⇒ **只要 overlay 起来，整个 Phaser 画布就被隐藏**。
   * 于是 `BattleScene.renderTerrainMarkers()` 的 Phaser 版本只能在这条路径上被看到：
   * **overlay 建不起来时的降级**（`App.vue` 的 8 秒超时 fallback）。
   * 2026-09-20 实测：overlay 正常时把 801 个地形斑填成不透明品红，截图里品红像素 = 0
   * （用户当时实报"界面上什么都没有"即此）⇒ 地形**必须**画在本函数里。
   *
   * ── 画法（对齐既有 Tron 语言；纯呈现，不参与任何判定）──────────────
   * · fill：每个地形格一个六边形扇形三角化，**按地形类型合并**成 6 个 BufferGeometry
   *   ⇒ 6 个 draw call（而不是 800 个 Object3D）。
   * · edge：只画"邻居地形不同"的边（同类相邻 = 内部边，跳过）⇒ 相邻同类格自然连成
   *   一整片**区域**，边界只在区域外缘出现 —— 这正是"空域"该有的读法，
   *   也避免了"每格一个六边形轮廓"退化成 hex 网格（指挥制刻意隐藏 hex）。
   *   边界做成**带状网格**而非 LineSegments：WebGL 下 `linewidth` 恒为 1 物理像素，
   *   远视角会细到看不见。
   * · 全部 `AdditiveBlending` + `depthWrite:false`，叠在网格/星域上呈"发光空域"。
   *
   * ⚠ 本层是纯宇宙战场唯一的地形呈现（原 hex 六棱柱地形已删除，见 `buildTerrain` 处的说明）。
   */
    /**
     * [v38] 空域地形呈现。两种画法**共享同一份数据与颜色真源**，切换只影响画法：
     * · `'scanline'`（默认）= CRT 扫描线 → `buildTerrainZonesScan`
     * · `'fill'` = v36c 六边形面填充（回退用）→ `buildTerrainZoneFills`
     *
     * ⚠ 这是**唯一**在指挥制下能看见的地形呈现：`buildTerrainMarkers` 只认 `t.type`
     * （中继/要塞/星球等设施），**完全不认 `t.terrain`**。
     */
    private buildTerrainZones(tiles: any[]) {
        if (this.terrainZoneGroup) return;
        const withT = (tiles || []).filter((t: any) => t && t.terrain);
        if (withT.length === 0) return;

        const grp = new THREE.Group();
        grp.name = 'terrainZones';

        if (TERRAIN_ZONE.MODE === 'contour') this.buildTerrainZonesContour(withT, grp);
        else if (TERRAIN_ZONE.MODE === 'scanline') this.buildTerrainZonesScan(withT, grp);
        else this.buildTerrainZoneFills(withT, grp);

        this.scene.add(grp);
        this.terrainZoneGroup = grp;
    }

    /**
     * [v39] 地形 **等高线** 呈现（`TERRAIN_ZONE.MODE === 'contour'`，当前默认）。
     *
     * ── 为什么否掉 v38 的扫描线（用户实拍：「太整齐了…就好像是单元格填充纹理…
     *    就是太密集，还不如一开始的六边形格子好看」）────────────────────────
     * 扫描线是**规则等距平行线**：平行线只能编码"方向"，**不编码"高度"**。
     * 我把"起伏"交给它承载是**符号错配** —— 无论如何调参，近景下它必然读作
     * "单元格填充纹理"（每格 17 条密排直线 = hatch）。
     * 等高线（iso-line）天生是高度的可视化：**每条线 = 一个高度层**，
     * 线疏＝坡缓、线密＝坡陡、线弯曲＝地形起伏 —— 拓扑图 / 雷达回波就是这个语言。
     *
     * ── 三层结构（缺一层都会出问题）────────────────────────────────────
     * ① **区域外轮廓**（`chaikin` 平滑）—— 六边形格拼出来的边界天然是"六边形锯齿"，
     *    近景读作像素化块；切角平滑后读作有机空域轮廓。
     * ② **内部等高线**（3~6 条，`contourLevels`）—— 只在**本类型格内**取线
     *    （`marchingSquares` 的 `mask` 参数：四角掩码全同才画）
     *    ⇒ 轮廓会自动内缩约一格，所以 ① 是必需的，否则区域边界不可读。
     * ③ **高度分层**：每条等高线的 y = `level × amp`（等高线的定义就是"等高"）
     *    ⇒ 不必额外造三维形状，分层本身就读作起伏。
     *
     * ⚠ 与 `scanline` / `fill` 共享同一份数据、颜色、危险判定（三条画法只差画法）。
     */
    private buildTerrainZonesContour(withT: any[], grp: THREE.Group) {
        const R = this.hexR;
        const C = TERRAIN_CONTOUR;
        const tiles: any[] = this.battleScene?.tilesList || [];
        if (tiles.length === 0) {
            this.terrainZoneStats = { cells: withT.length, types: 0, mode: 'contour', fills: 0, edges: 0, lines: 0, tris: 0 };
            return;
        }

        // ── 世界 bbox（z = −2D 的 y，全 3D 层统一口径）──
        let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
        for (const t of tiles) { const z = -t.y; if (t.x < bx0) bx0 = t.x; if (t.x > bx1) bx1 = t.x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; }

        // ── 采样网格 ──
        const step = Math.max(1, R * C.GRID_K);
        const cols = Math.max(4, Math.ceil((bx1 - bx0) / step));
        const rows = Math.max(4, Math.ceil((bz1 - bz0) / step));
        const W = cols + 1, H = rows + 1;

        // ── 空间哈希：世界点 → 最近格中心（用于判定该点属于哪种地形）──
        //   ⚠ 刻意**不做**"世界坐标 → 轴坐标"的解析反变换：那要押注 pointy-top 的
        //     间距/角度约定，一旦押错就会静默错位。最近格中心对正六边形铺砌恒正确。
        const cell = R * 2;
        const hw = Math.ceil((bx1 - bx0) / cell) + 2, hh = Math.ceil((bz1 - bz0) / cell) + 2;
        const buckets: (number[] | undefined)[] = new Array(hw * hh);
        tiles.forEach((t: any, i: number) => {
            const ix = Math.floor((t.x - bx0) / cell), iz = Math.floor((-t.y - bz0) / cell);
            if (ix < 0 || iz < 0 || ix >= hw || iz >= hh) return;
            const b = iz * hw + ix;
            if (!buckets[b]) buckets[b] = [];
            buckets[b]!.push(i);
        });
        const nearestType = (wx: number, wz: number): string | null => {
            const ix = Math.floor((wx - bx0) / cell), iz = Math.floor((wz - bz0) / cell);
            let best = -1, bd = Infinity;
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const cx = ix + dx, cz = iz + dz;
                    if (cx < 0 || cz < 0 || cx >= hw || cz >= hh) continue;
                    const arr = buckets[cz * hw + cx];
                    if (!arr) continue;
                    for (const i of arr) {
                        const t = tiles[i];
                        const d = (t.x - wx) * (t.x - wx) + (-t.y - wz) * (-t.y - wz);
                        if (d < bd) { bd = d; best = i; }
                    }
                }
            }
            return best >= 0 ? (tiles[best].terrain ?? null) : null;
        };

        // ── 噪声高度场 + 类型掩码（一次算好，所有类型共用同一个场）──
        const types: string[] = [];
        const typeIndex = new Map<string, number>();
        for (const t of withT) {
            const k = t.terrain as string;
            if (!typeIndex.has(k)) { typeIndex.set(k, types.length + 1); types.push(k); }
        }
        const field = new Float64Array(W * H);
        const mask = new Uint8Array(W * H);
        for (let r = 0; r < H; r++) {
            for (let c = 0; c < W; c++) {
                const wx = bx0 + c * step, wz = bz0 + r * step;
                field[r * W + c] = fbm2D(wx, wz, R * C.NOISE_CELL_K, C.SEED, C.OCTAVES);
                const ty = nearestType(wx, wz);
                mask[r * W + c] = ty ? (typeIndex.get(ty) ?? 0) : 0;
            }
        }

        const baseY = R * TERRAIN_ZONE.Y_K;
        const amp = R * C.HEIGHT_AMP_K;
        const halfW = R * C.WIDTH_K;
        const levels = contourLevels(C.LINES, C.HEIGHT_SPAN);
        let lineTotal = 0, triTotal = 0;

        /** 加一条带状线（在 xz 平面内垂直于线段方向给宽度）→ 顶点 + 顶点色 */
        const ribbon = (ax: number, az: number, bx2: number, bz2: number, y: number, w: number,
                        pos: number[], col: number[], cr: number, cg: number, cb: number) => {
            const dx = bx2 - ax, dz2 = bz2 - az;
            const len = Math.hypot(dx, dz2) || 1;
            const nx = (-dz2 / len) * w, nz = (dx / len) * w;
            pos.push(ax + nx, y, az + nz, bx2 + nx, y, bz2 + nz, bx2 - nx, y, bz2 - nz);
            pos.push(ax + nx, y, az + nz, bx2 - nx, y, bz2 - nz, ax - nx, y, az - nz);
            for (let v = 0; v < 6; v++) col.push(cr, cg, cb);
            triTotal += 2;
        };

        // 六边形顶点（与 buildTerrainZoneFills 同一约定：θ_k = (π/3)k − π/6）
        const COS: number[] = [], SIN: number[] = [];
        for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k - Math.PI / 6; COS.push(Math.cos(a)); SIN.push(Math.sin(a)); }
        const NB: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        const terrAt = new Map<string, string | null>();
        for (const t of tiles) terrAt.set(`${t.q},${t.r}`, t.terrain ?? null);

        types.forEach((type: string, ti: number) => {
            const base = TERRAIN_VISUAL[type]?.color ?? 0x7dd3fc;
            const hazardous = (TERRAIN_EFFECT_TABLE[type]?.dotPct ?? 0) > 0;
            const rC = ((base >> 16) & 255) / 255, gC = ((base >> 8) & 255) / 255, bC = (base & 255) / 255;
            const pos: number[] = [], col: number[] = [];

            // ── ② 内部等高线 ──
            levels.forEach((lv: number, li: number) => {
                const segs = marchingSquares(field, cols, rows, lv, mask, ti + 1);
                // 高处的线更亮 ⇒ 峰顶发光，读作高程
                const t01 = (lv / C.HEIGHT_SPAN + 1) / 2;                 // 0..1
                const bright = C.LEVEL_BASE_MUL + (C.LEVEL_TOP_MUL - C.LEVEL_BASE_MUL) * t01;
                const y = baseY + lv * amp;
                const cr = Math.min(1, rC * bright), cg = Math.min(1, gC * bright), cb = Math.min(1, bC * bright);
                for (const s of segs) {
                    ribbon(bx0 + s.c0 * step, bz0 + s.r0 * step, bx0 + s.c1 * step, bz0 + s.r1 * step, y, halfW, pos, col, cr, cg, cb);
                    lineTotal++;
                }
                void li;
            });

            // ── ① 区域外轮廓（边界边 → 有序环 → Chaikin 平滑）──
            const myTiles = withT.filter((t: any) => t.terrain === type);
            const eKey = (x: number, z: number) => Math.round(x * 50) + ',' + Math.round(z * 50);
            const edges: Array<{ a: string; b: string; ax: number; az: number; bx: number; bz: number }> = [];
            const adj = new Map<string, number[]>();
            for (const t of myTiles) {
                const cx = t.x, cz = -t.y;
                const vx: number[] = [], vz: number[] = [];
                for (let k = 0; k < 6; k++) { vx.push(cx + COS[k] * R); vz.push(cz + SIN[k] * R); }
                for (let k = 0; k < 6; k++) {
                    const [dq, dr] = NB[k];
                    if ((terrAt.get(`${t.q + dq},${t.r + dr}`) ?? null) === type) continue;
                    const k2 = (k + 1) % 6;
                    const a = eKey(vx[k], vz[k]), b = eKey(vx[k2], vz[k2]);
                    const idx = edges.length;
                    edges.push({ a, b, ax: vx[k], az: vz[k], bx: vx[k2], bz: vz[k2] });
                    if (!adj.has(a)) adj.set(a, []); adj.get(a)!.push(idx);
                    if (!adj.has(b)) adj.set(b, []); adj.get(b)!.push(idx);
                }
            }
            const used = new Uint8Array(edges.length);
            for (let i = 0; i < edges.length; i++) {
                if (used[i]) continue;
                // 沿边界边串成闭合环
                const loop: Array<[number, number]> = [];
                let cur = i, curKey = edges[i].a;
                const startKey = curKey;
                let guard = 0;
                while (cur >= 0 && !used[cur] && guard++ < edges.length + 4) {
                    used[cur] = 1;
                    const e = edges[cur];
                    const fwd = e.a === curKey;
                    loop.push(fwd ? [e.ax, e.az] : [e.bx, e.bz]);
                    curKey = fwd ? e.b : e.a;
                    if (curKey === startKey) break;
                    cur = -1;
                    for (const j of (adj.get(curKey) || [])) { if (!used[j]) { cur = j; break; } }
                }
                if (loop.length < 3) continue;
                // Chaikin 平滑（补偿其向心收缩）
                let sm = chaikin(loop, C.CHAIKIN_ITERS, true);
                if ((C.OUTLINE_GROW as number) !== 1) {
                    let mx = 0, mz = 0;
                    for (const p of sm) { mx += p[0]; mz += p[1]; }
                    mx /= sm.length; mz /= sm.length;
                    sm = sm.map((p) => [mx + (p[0] - mx) * C.OUTLINE_GROW, mz + (p[1] - mz) * C.OUTLINE_GROW] as [number, number]);
                }
                const oBright = hazardous ? C.OUTLINE_BRIGHT_HAZARD : C.OUTLINE_BRIGHT_ENV;
                for (let k = 0; k < sm.length; k++) {
                    const a = sm[k], b = sm[(k + 1) % sm.length];
                    ribbon(a[0], a[1], b[0], b[1], baseY, halfW, pos, col,
                        Math.min(1, rC * oBright), Math.min(1, gC * oBright), Math.min(1, bC * oBright));
                }
                lineTotal += sm.length;
            }

            if (pos.length === 0) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
                vertexColors: true, transparent: true,
                opacity: hazardous ? C.ALPHA_HAZARD : C.ALPHA_ENV,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            }));
            mesh.frustumCulled = false;
            mesh.name = `terrainContour:${type}`;
            grp.add(mesh);
        });

        this.terrainZoneStats = {
            cells: withT.length, types: types.length, mode: 'contour',
            fills: 0, edges: 0, lines: lineTotal, tris: triTotal,
        };
    }
    /**
     * [v38] 地形 **CRT 扫描线**。
     *
     * ── 为什么不是"逐格画线"（关键设计决定）────────────────────────────
     * 若逐格在自己的六边形内裁剪扫描线，相邻同类格各自裁剪 ⇒ 在共享边处各自画一条
     * 独立线段，而在**上下顶点附近弦长趋于 0** ⇒ 每个格中心线长、上下极短
     * ⇒ 整片读作"一格格小透镜" —— 换汤不换药，仍是网格语言。
     *
     * 故本实现**先按扫描行聚合、再合并区间**：
     *   ① 把每个地形格在每个扫描行 z 上的**水平弦** `[cx−hw, cx+hw]` 算出来（闭式解，见下）；
     *   ② 同一 z 行内所有弦**按 x 排序并合并重叠/近邻区间**（`MERGE_GAP_K`）；
     *   ③ 对每个合并后的区间画**一条贯通线**。
     * ⇒ 线在同一片空域内部**连续贯通**，只在**区域并集的外缘**停止，
     *   形状由区域本身给出、**没有任何六边形痕迹**。这是扫描线方案成立的前提。
     *
     * 弦半宽闭式解（pointy-top 六边形，顶点角 = (π/3)k − π/6，R = 外接半径）：
     *   `|dz| ≤ R/2` ⇒ `√3/2·R`（两条竖边之间的整宽，与 dz 无关）
     *   `R/2 < |dz| ≤ R` ⇒ `√3·(R − |dz|)`（向上下顶点线性收敛）
     * 自检：dz=R ⇒ 0 ✓；dz=R/2 ⇒ 0.866R ✓（两段在边界处连续）
     */
    private buildTerrainZonesScan(withT: any[], grp: THREE.Group) {
        const R = this.hexR;
        const S = TERRAIN_SCAN;
        const Y = R * TERRAIN_ZONE.Y_K;

        const byType = new Map<string, any[]>();
        for (const t of withT) {
            const arr = byType.get(t.terrain);
            if (arr) arr.push(t); else byType.set(t.terrain, [t]);
        }

        let lineTotal = 0, triTotal = 0;

        byType.forEach((list: any[], type: string) => {
            const base = TERRAIN_VISUAL[type]?.color ?? 0x7dd3fc;
            // 危险地形（会持续掉血）线更密 + 更亮。单一真源 = dotPct > 0。
            const hazardous = (TERRAIN_EFFECT_TABLE[type]?.dotPct ?? 0) > 0;
            const step = R * S.STEP_K * (hazardous ? S.HAZARD_STEP_MUL : 1);
            const halfW = R * S.WIDTH_K;
            const amp = R * S.AMP_K;
            const lam = R * S.WAVE_LEN_K;
            const lamZ = R * S.PHASE_Z_K;
            const segMax = R * S.SEG_LEN_K;
            const mergeGap = R * S.MERGE_GAP_K;
            const minChord = R * S.MIN_CHORD_K;

            let zMin = Infinity, zMax = -Infinity;
            for (const t of list) {
                const cz = -t.y;
                if (cz - R < zMin) zMin = cz - R;
                if (cz + R > zMax) zMax = cz + R;
            }
            const nA = Math.ceil((zMax - zMin) / step) + 1;

            // ① 逐格算弦 → 入扫描行桶（弦半宽走纯函数 hexChordHalfWidth，可被台架断言）
            const buckets: { x0: number; x1: number }[][] = [];
            for (let i = 0; i < nA; i++) buckets.push([]);
            for (const t of list) {
                const cx = t.x, cz = -t.y;
                const i0 = Math.max(0, Math.floor((cz - R - zMin) / step));
                const i1 = Math.min(nA - 1, Math.ceil((cz + R - zMin) / step));
                for (let i = i0; i <= i1; i++) {
                    const hw = hexChordHalfWidth(R, zMin + i * step - cz);
                    if (hw < minChord) continue;
                    buckets[i].push({ x0: cx - hw, x1: cx + hw });
                }
            }

            const pos: number[] = [], col: number[] = [];
            const rC = ((base >> 16) & 255) / 255;
            const gC = ((base >> 8) & 255) / 255;
            const bC = (base & 255) / 255;

            for (let i = 0; i < nA; i++) {
                // ② 同行区间合并（mergeSpans，纯函数）—— 这一步决定"有没有区域感"
                const merged = mergeSpans(buckets[i], mergeGap);
                if (merged.length === 0) continue;

                const z = zMin + i * step;
                // 沿 z 的相位推进 ⇒ 相邻扫描线不同相 ⇒ 读作"一道波在区域里传播"
                const phase = (z / lamZ) * Math.PI * 2;
                // 扫描场刷新：每 REFRESH_PERIOD 条一条亮线（用**顶点色**实现 ——
                //   alpha 是材质级、无法逐线变化，故材质走 vertexColors）。
                const bright = (i % S.REFRESH_PERIOD === 0) ? S.REFRESH_MUL : 1;
                const cr = Math.min(1, rC * bright), cg = Math.min(1, gC * bright), cb = Math.min(1, bC * bright);
                const z0 = z - halfW, z1 = z + halfW;

                // ③ 每个区间画一条贯通线（分段以采样正弦起伏）
                for (const m of merged) {
                    const len = m.x1 - m.x0;
                    if (len < minChord) continue;
                    const segs = scanSegCount(len, segMax, S.SEG_MAX);
                    for (let s = 0; s < segs; s++) {
                        const xa = m.x0 + (len * s) / segs;
                        const xb = m.x0 + (len * (s + 1)) / segs;
                        const ya = scanLineY(xa, lam, amp, phase, Y);
                        const yb = scanLineY(xb, lam, amp, phase, Y);
                        // 带宽沿 z ⇒ 线细而亮，不"变粗成块"；y 随 x 变 ⇒ 线本身在起伏
                        pos.push(xa, ya, z0, xb, yb, z0, xb, yb, z1);
                        pos.push(xa, ya, z0, xb, yb, z1, xa, ya, z1);
                        for (let v = 0; v < 6; v++) col.push(cr, cg, cb);
                        triTotal += 2;
                    }
                    lineTotal++;
                }
            }

            if (pos.length === 0) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
                vertexColors: true, transparent: true,
                opacity: hazardous ? S.ALPHA_HAZARD : S.ALPHA_ENV,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            }));
            mesh.frustumCulled = false;
            mesh.name = `terrainScan:${type}`;
            grp.add(mesh);
        });

        this.terrainZoneStats = {
            cells: withT.length, types: byType.size, mode: 'scanline',
            fills: 0, edges: 0, lines: lineTotal, tris: triTotal,
        };
    }

    /**
     * v36c 的六边形面填充（`TERRAIN_ZONE.MODE === 'fill'` 时走这里）。
     *
     * 保留原因：用户已判其观感为"彩色拼贴"，但它是**唯一经过 L2 定量验收**的版本
     * （边映射自检、像素级可见度），作为一键回退基线比"删掉重写"更安全。
     * 与扫描线的差别仅在**画法**：数据/颜色/危险判定三者同源。
     */
    private buildTerrainZoneFills(withT: any[], grp: THREE.Group) {
        const R = this.hexR;

        // 邻居地形查询表（含"无地形" = null）：边界判定只看**地形 id 是否相同**
        const terrAt = new Map<string, string | null>();
        for (const t of (this.battleScene?.tilesList || [])) terrAt.set(`${t.q},${t.r}`, t.terrain ?? null);

        const NB: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        const COS: number[] = [], SIN: number[] = [];
        for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k - Math.PI / 6;
            COS.push(Math.cos(a)); SIN.push(Math.sin(a));
        }

        const Y = R * TERRAIN_ZONE.Y_K;
        const HW = R * TERRAIN_ZONE.EDGE_HALF_WIDTH_K;

        const byType = new Map<string, any[]>();
        for (const t of withT) {
            const arr = byType.get(t.terrain);
            if (arr) arr.push(t); else byType.set(t.terrain, [t]);
        }

        let fills = 0, edges = 0;
        byType.forEach((list: any[], type: string) => {
            const color = TERRAIN_VISUAL[type]?.color ?? 0x7dd3fc;
            const hazardous = (TERRAIN_EFFECT_TABLE[type]?.dotPct ?? 0) > 0;
            const fp: number[] = [];
            const ep: number[] = [];
            for (const t of list) {
                const cx = t.x, cz = -t.y;
                const vx: number[] = [], vz: number[] = [];
                for (let k = 0; k < 6; k++) { vx.push(cx + COS[k] * R); vz.push(cz + SIN[k] * R); }
                for (let k = 1; k < 5; k++) {
                    fp.push(vx[0], Y, vz[0], vx[k], Y, vz[k], vx[k + 1], Y, vz[k + 1]);
                }
                if (!hazardous) continue;
                for (let k = 0; k < 6; k++) {
                    const [dq, dr] = NB[k];
                    if ((terrAt.get(`${t.q + dq},${t.r + dr}`) ?? null) === type) continue;
                    const k2 = (k + 1) % 6;
                    const ax = vx[k], az = vz[k], bx = vx[k2], bz = vz[k2];
                    const dx = bx - ax, dz = bz - az;
                    const len = Math.hypot(dx, dz) || 1;
                    const nx = (-dz / len) * HW, nz = (dx / len) * HW;
                    ep.push(ax + nx, Y, az + nz, bx + nx, Y, bz + nz, bx - nx, Y, bz - nz);
                    ep.push(ax + nx, Y, az + nz, bx - nx, Y, bz - nz, ax - nx, Y, az - nz);
                }
            }
            const mkMesh = (arr: number[], opacity: number, nm: string) => {
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
                const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity,
                    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
                }));
                m.frustumCulled = false;
                m.name = `${nm}:${type}`;
                grp.add(m);
            };
            if (fp.length) { mkMesh(fp, TERRAIN_ZONE.FILL_ALPHA, 'terrainZoneFill'); fills++; }
            if (ep.length) { mkMesh(ep, TERRAIN_ZONE.EDGE_ALPHA, 'terrainZoneEdge'); edges++; }
        });

        this.terrainZoneStats = {
            cells: withT.length, types: byType.size, mode: 'fill',
            fills, edges, lines: 0, tris: 0,
        };
    }

  /**
   * 指挥制（command）：纯 3D 宇宙空间 —— 对标参考图的 Tron 扫描画面。
   * - 绿色网格平面（细格 + 主线双层）= 空间坐标扫描基准面
   * - （原「橙色线框圆柱 + 顶环」装饰天体已于 2026-09-20 删除，见 buildSpaceWorld 第 2 段注释）
   * - 星域由 buildStars 提供；舰船在 y=0 基准面上方固定巡航高度飞行
   * - 相机全向自由旋转（构造器已放宽 polar 限制）
   */
  private buildSpaceWorld() {
    const bs = this.battleScene;
    const tiles: any[] = bs.tilesList || [];
    this.hexR = bs.hexRadius || 26;
    this.cruiseClearance = this.computeCruiseClearance();
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
    // v6.8：×2.6 → ×1.15——此前网格半宽是地图半跨的 1.3 倍，出生点即使推到
    //   地图边缘（v6.6 的 0.9 半跨）也只占网格 35%，视觉上"双方挤在中间、
    //   四边大量空地"（用户多次实报）。收敛到 1.15：地图本体占网格 ≈87%，
    //   空地只剩一圈窄边。
    const planeSize = span * 1.15;
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

    // ── 2. [已删除] 橙色线框"引力异常"装饰体 ──
    // 2026-09-20 删除（用户：「把这个红色的东西去掉，这个装饰物到底有什么含义，没有作用的就去掉」）。
    //   它原是 5 个 `CylinderGeometry` wireframe（0xff5a1f，35° 俯角下读作"橙色辐条盘"），
    //   由 `Math.random()` 独立撒点，**与 `tiles` 无任何关联、不参与任何判定**（原注释自述
    //   "不参与战斗逻辑"）。删除的三条依据：
    //     ① **语义冲突且会误导** —— 地形表里有会真正改变移速/索敌的 `gravity`（引力点），
    //        玩家看到橙色线框盘会以为那是引力点，而真正的引力点现在有自己的扫描线地形呈现；
    //     ② **位置不可控** —— `dist = span*(0.12~0.42)` 会压在舰队/中继点上，遮挡判读；
    //     ③ 纯装饰、无信息量，与"指挥制 = 读数界面"的定位相反。
    //   ⚠ 若将来要恢复"引力异常天体"，正确做法是把它**绑定到 `gravity` 地形格**
    //     （有数值效果者才配天体），而不是随机撒点。

    // ── 3. 相机取景：35° 俯角对准战场中心，距离上下限按跨度 ──
    // v6.8：网格已贴合地图本体（×1.15），相机距离同步收敛（原 1.05 是给 2.6×
    //   大平面配的取景距离，网格缩小后不变会把地图拍得过小、四周露黑边）
    // 【v75】**恢复 v60-v66 的取景距离**（用户实报「最早的版本这个没问题」）。
    //   v73 曾下调到 0.50/×20 以"让初始视角就是纯模型"，但那会改变
    //   用户已适应的工作距离（且配合已撤销的阈值收紧，把混合带挪到了常用视角）。
    //   取景距离与 LOD 阈值是**一对**校准值，只改一个必然破坏既有观感。
    const dist = Math.max(span * 0.62, this.hexR * 24);
    this.controls.target.set(cx, 0, -cy);
    this.camera.position.set(cx, dist * Math.sin(CAM_ELEV), -cy + dist * Math.cos(CAM_ELEV));
    this.controls.minDistance = this.hexR * 4;
    this.controls.maxDistance = dist * 2.2;
    this.controls.update();
    this.initCamY = Math.abs(this.camera.position.y);   // [v76] 缩放档判据基准
    this.syncClipPlanes(this.camera.position.distanceTo(this.controls.target), true);

    // 选中环按空间尺度
    this.selRing.scale.setScalar(this.hexR * 2.2);

    this.spaceGroup = grp;
    this.scene.add(grp);
    this.spaceBuilt = true;

    // v6.1：指挥制也要立地形标记——此前只有 hex 模式调 buildTerrainMarkers，
    //   纯宇宙模式下中继补给站/星球没有任何模型，只剩补给圈灰圈（用户实报：
    //   "灰色的中继应该也有个模型表示出来，而不是就是个灰色圈"）。
    this.buildTerrainMarkers(tiles);
    // [v36c] 空域地形分区（星云/小行星带/引力点/残骸区/机雷区/杰夫粒子云）。
    //   ⚠ 这是**唯一**在指挥制下能看见的地形呈现：`buildTerrainMarkers` 只认
    //   `t.type`（中继/要塞/星球等设施），**完全不认 `t.terrain`**。
    this.buildTerrainZones(tiles);
  }

  /**
   * 特殊地形 3D 标记物（问题2：只有颜色+高度看不懂什么是什么）。
   * 每种地形一个标志性形状，语义一眼可辨；共享几何体，特殊格数量少（<40）。
   * sea/ruined（不可通行）不立标记，而是把柱体压暗+顶部加警示斜纹色，
   * 与可通行格形成"凹地/禁区"的视觉差。
   */
  /**
   * v6.10：尝试用 GLB 设施模型替代程序化标记。
   *  命中（assets/scene/ 有对应文件）→ 建 holder（局部原点=地面，先空壳）并登记槽位，
   *  模型就绪后由 updateSceneProps 原地挂载；返回 holder。
   *  未命中（无模型文件）→ 返回 null，调用方走原有程序化兜底（零行为变化）。
   */
  private tryAttachSceneProp(
    key: string, x: number, groundY: number, z: number, color: number,
    parent?: THREE.Group, factionKey?: 'empire' | 'alliance',
  ): THREE.Group | null {
    const reg = acquireSceneProp(key, factionKey);   // 含 SCENE_PROP_BINDING 绑定回退
    if (!reg) return null;
    const holder = new THREE.Group();
    holder.position.set(x, groundY, z);
    (parent ?? this.scene).add(holder);
    const slot = { key, holder, reg, modelVer: -1, color };
    this.scenePropSlots.push(slot);
    this.attachScenePropModel(slot);   // 已就绪 → 立即挂载；加载中 → 空壳等待
    return holder;
  }

  /** 槽位挂载/换装：模型就绪且版本变化时清空 holder 并挂入模型 */
  private attachScenePropModel(slot: { key: string; holder: THREE.Group; reg: ScenePropReg; modelVer: number; color: number }) {
    const reg = slot.reg;
    if (reg.status !== 'ready' || reg.version === slot.modelVer) return;
    for (const o of [...slot.holder.children]) {
      slot.holder.remove(o);
      this.dropGroupChild(o);
    }
    const g = buildScenePropFromModel(reg, slot.key, this.hexR, slot.color);
    if (g) slot.holder.add(g);
    else slot.holder.visible = false;   // 解析失败 → 不留空壳
    slot.modelVer = reg.version;
  }

    /**
     * [v38 · G3] **占领进度环** —— 把"我正在占领这个中继/星球"变成看得见的读数。
     *
     * ── 为什么必须有（用户原话）────────────────────────────────────────
     * 「这个中继点我该怎么占领？飞过去吗？我有看到别人占领的时候有动画效果，
     *   但是我自己的部队右键点击没什么提示」
     *
     * ── 现状（诊断结论，带行号）────────────────────────────────────────
     * · 占领机制**本来就有**：`BattleScene` 的 `processSupplyAndCapture` 里，舰队进入
     *   目标 2 格内即按帧累加 `tile.captureProgress`，满 100 即易主（含语录 + 横幅 + toast）。
     * · **右键与占领无关** —— 右键设的是"战术信标"（`targetFlare`），所以玩家右键中继点时
     *   当然没有任何专属反馈。这是**引导缺失**，不是机制缺失。
     * · 唯一的进度反馈是"hex 透明度反映剩余 HP"（`BattleScene:1689`）—— 而**指挥制下整个
     *   Phaser 画布被 `body.battle3d-mode` 隐藏** ⇒ 该反馈**一个像素都看不到**。
     *   ⇒ 玩家体感就是"点了没反应、飞过去也不知道在不在占"。
     *
     * ── 实现要点 ──────────────────────────────────────────────────────
     * · 只给 `0 < captureProgress < 100` 的目标画环 ⇒ 天然只在"正在被争夺"时出现，无噪音。
     * · 用 `RingGeometry(..., thetaStart, thetaLength)` 直接表达**进度**（顺时针从 12 点起，
     *   与"读表"直觉一致）；中继/星球数量级为个位数 ⇒ 每帧重建几何代价可忽略。
     * · 低进度时**脉冲**，读作"正在写入"，与静态的补给圈（`SUPPLY_RELAY_RADIUS`）区分开。
     * · 颜色走**争夺色（琥珀）**而非阵营色：本函数不判定"谁在占"，避免与结算逻辑分叉；
     *   真正的归属变化由 `captureProgress` 归零 + 补给圈换色表达。
     */
    private updateCaptureRings(dt: number) {
        const bs = this.battleScene;
        if (!bs) return;
        this.capturePulseT += dt;

        if (!this.captureGroup) {
            this.captureGroup = new THREE.Group();
            this.captureGroup.name = 'captureViz';
            this.scene.add(this.captureGroup);
        }

        const R = this.hexR;
        const inner = R * CAPTURE_RING.INNER_K;
        const outer = R * CAPTURE_RING.OUTER_K;
        const y = R * CAPTURE_RING.Y_K;
        const pulse = CAPTURE_RING.PULSE_BASE
            + CAPTURE_RING.PULSE_AMP * Math.sin(this.capturePulseT * CAPTURE_RING.PULSE_HZ * Math.PI * 2);

        const live = new Set<any>();
        for (const t of (bs.tilesList || [])) {
            if (!t || (t.type !== 'planet' && t.type !== 'relay')) continue;
            const p = Math.max(0, Math.min(100, Number(t.captureProgress) || 0));
            // 只在"正在被占领"的窗口内显示：0（未开始/已归零）与 100（已易主）都不画
            if (p <= 0.5 || p >= 100) continue;
            live.add(t);

            let rec = this.captureRings.get(t);
            if (!rec) {
                const mat = new THREE.MeshBasicMaterial({
                    color: CAPTURE_RING.COLOR, transparent: true, opacity: CAPTURE_RING.ALPHA,
                    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
                });
                const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
                mesh.position.set(t.x, y, -t.y);
                mesh.rotation.x = -Math.PI / 2;
                mesh.name = 'captureRing';
                this.captureGroup.add(mesh);
                rec = { mesh, mat };
                this.captureRings.set(t, rec);
            }
            // 进度弧：从 12 点起顺时针（世界坐标下 rotation.x=-90°，故用 -π/2 作起点）
            rec.mesh.geometry.dispose();
            rec.mesh.geometry = new THREE.RingGeometry(inner, outer, 48, 1, -Math.PI / 2, (Math.PI * 2 * p) / 100);
            rec.mat.opacity = CAPTURE_RING.ALPHA * pulse;
            rec.mesh.visible = true;
        }

        // 清理：进度归零 / 已易主 / 目标消失
        for (const [t, rec] of Array.from(this.captureRings.entries())) {
            if (live.has(t)) continue;
            this.captureGroup.remove(rec.mesh);
            rec.mesh.geometry.dispose();
            rec.mat.dispose();
            this.captureRings.delete(t);
        }
        this.captureStats = { active: this.captureRings.size, pulse: +pulse.toFixed(3) };
    }
  /** 每帧：① 设施模型加载状态检查（就地换装）② 已挂载模型的自旋动画推进。
   *  槽位数量 = 特殊地块数（<40）+ 占领点，逐帧线性遍历可忽略；
   *  未配自旋的模型在 advanceScenePropSpin 首行即返回（零开销）。
   *  ⚠ 自旋用**真实秒** dt，与下方 relayRings / fortressRings 程序化自旋同口径（不随战斗倍速缩放）。 */
  private updateSceneProps(dt: number) {
    if (this.scenePropSlots.length === 0) return;
    for (const slot of this.scenePropSlots) {
      this.attachScenePropModel(slot);
      const g = slot.holder.children[0];      // buildScenePropFromModel 返回的模型组（可能尚未挂载）
      if (g) advanceScenePropSpin(g, dt);
    }
  }

  /** 摘除并释放子对象：先从自旋动画表撤注册（relayRings/fortressRings 持有引用），再释放几何/材质 */
  private dropGroupChild(o: THREE.Object3D) {
    const rIdx = this.relayRings.findIndex((r) => (r.a as any) === o || (r.b as any) === o);
    if (rIdx >= 0) this.relayRings.splice(rIdx, 1);
    const fIdx = this.fortressRings.indexOf(o as THREE.Mesh);
    if (fIdx >= 0) this.fortressRings.splice(fIdx, 1);
    o.traverse((c) => { if (c !== o) this.disposeObject(c); });
    this.disposeObject(o);
  }

  private buildTerrainMarkers(tiles: any[]) {
    const R = this.hexR;
    // v6.10：地块类型 → 设施模型键 / 设施色（assets/scene/ 模型命名规范.md）
    const PROP_KEY: Record<string, string> = {
      relay: 'relay', planet: 'planet', fortress: 'fortress',
      gold_mine: 'mine', mine: 'mine', tower: 'tower', pier: 'pier', castle: 'castle',
    };
    const PROP_COLOR: Record<string, number> = {
      relay: 0x38bdf8, planet: 0x22c55e, fortress: 0xef4444,
      mine: 0xfbbf24, tower: 0xa78bfa, pier: 0x38bdf8, castle: 0x00ffff,
    };
    // v6.2：指挥制纯宇宙只立 relay/castle 标记——塔（紫锥）/金矿（黄八面体）是行星地表
    //   建筑，在 Tron 宇宙里悬浮成"紫色圆锥、黄色方块"完全不合逻辑（用户实报）；
    //   星球模型同理（星空宇宙不该散落大量星球），中继补给需求由 relay 承担。
    const mkMat = (hex: number, opts: Partial<THREE.MeshPhongMaterialParameters> = {}) =>
      new THREE.MeshPhongMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.35, shininess: 60, transparent: true, opacity: 0.95, ...opts });

    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);      // 行星
    const octaGeo = new THREE.OctahedronGeometry(1);            // 要塞/矿
    const coneGeo = new THREE.ConeGeometry(1, 2, 8);            // 塔
    const ringGeo = new THREE.TorusGeometry(1, 0.18, 8, 24);    // 码头 / 中继补给站
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); // 司令部信标细柱

    const mats = {
      planet: mkMat(0x22c55e),
      relay: mkMat(0x38bdf8),      // v5: 中继补给站（空间站蓝）
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

    // v6.10：指挥制下的 fortress——有要塞模型时才渲染（伊谢尔伦要塞用 GLB 是合理宇宙设施；
    //   无模型仍不立标记：纯宇宙散落红色八面体不合逻辑，v6.2 定案保留）。
    //   hasScenePropFor 含 SCENE_PROP_BINDING 绑定回退（不规范命名的模型也能顶上）。
    const fortressModel = hasScenePropFor('fortress');
    // v6.10：要塞模型只摆"要塞群中心格"——要塞是 7 连格，逐格摆模型会变成 7 座并排；
    //   中心格判定 = 六邻格中同为 fortress 的数量最多者（战役图 q=15 / 演习图 q=18 均自适应）。
    let fortressCenterKey = '';
    if (fortressModel) {
      const keyOf = (t: any) => `${t.q},${t.r}`;
      const fTiles = tiles.filter((t: any) => t.type === 'fortress');
      const fSet = new Set(fTiles.map(keyOf));
      const NBR: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
      let best = -1;
      for (const t of fTiles) {
        let n = 0;
        for (const [dq, dr] of NBR) if (fSet.has(`${t.q + dq},${t.r + dr}`)) n++;
        if (n > best) { best = n; fortressCenterKey = keyOf(t); }
      }
    }

    tiles.forEach((t) => {
      // v6.2：指挥制过滤——只保留 relay（中继补给站）与 castle（司令部信标柱）
      if (t.type !== 'relay' && t.type !== 'castle' && !(t.type === 'fortress' && fortressModel)) return;
      // v6.10：要塞群非中心格不摆模型（避免重复堆叠）
      if (t.type === 'fortress' && fortressModel && `${t.q},${t.r}` !== fortressCenterKey) return;
      const h = t._h3d ?? 0.35 * R;
      const x = t.x, z = -t.y;
      // v6.10：设施模型优先——assets/scene/ 有对应 GLB 时由模型接管该类型全部实例；
      //   无文件则走下方程序化兜底（行为与本轮之前完全一致）。
      const propKey = PROP_KEY[t.type];
      if (propKey) {
        const holder = this.tryAttachSceneProp(propKey, x, h, z, PROP_COLOR[propKey]);
        if (holder) {
          // 迷雾情报：castle 模型同样受敌基地发现门控（登记后按帧开关可见性）
          if (t.type === 'castle') {
            const arr = this.castleMarkers.get(t.ownerId) || [];
            arr.push(holder);
            this.castleMarkers.set(t.ownerId, arr);
          }
          return;
        }
      }
      switch (t.type) {
        case 'planet':
          add(sphereGeo, mats.planet, x, h + R * 0.55, z, R * 0.55);
          break;
        case 'relay': {
          // v6.3：中继补给站重做——陀螺仪双环 + 核心光球。v6.2 的"球+斜环+双天线"
          //   在远视角糊成一团橙色笼子（用户实报"越设计越丑"）。陀螺仪造型：
          //   两只正交细环缓慢正交，中央一颗发光球——结构极简、远看也读得出"人造设施"。
          const stMat = mats.relay;
          const core = add(sphereGeo, stMat, x, h + R * 0.75, z, R * 0.30);
          (core.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.85;
          const ringA = add(ringGeo, stMat, x, h + R * 0.75, z, R * 0.55);
          ringA.rotation.x = Math.PI / 2;          // 水平环（赤道）
          const ringB = add(ringGeo, stMat, x, h + R * 0.75, z, R * 0.55);
          ringB.rotation.x = 0;                    // 垂直环（子午），与水平环正交
          // 陀螺仪缓慢自旋（注册到每帧动画列表；ringB 绕 y、ringA 绕 z 微转）
          this.relayRings.push({ a: ringA, b: ringB });
          break;
        }
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
          // v6.6：初始基地视觉全部移交 updateSupplyViz 的 supCastle 太空要塞（castlePos 处）。
          //   此处只留一个细定位信标（竖直细柱+顶光点）标记 castle tile 的数据位置——
          //   v6.5 及之前这里立 R×0.3 半径 × R×3 高的青色半透明细柱，与 castlePos 处的
          //   八面体形成"两套占位符互相打架"（用户实报丑到爆炸）。指挥制下 castle tile
          //   数据位置 ≠ castlePos 出生点，细信标不喧宾夺主。
          const beam = add(cylGeo, mats.castle, x, h + R * 0.8, z, R * 0.06);
          beam.scale.y = R * 1.6;
          // 迷雾情报：敌方 castle 信标确认前隐藏（按帧开关）
          {
            const arr = this.castleMarkers.get(t.ownerId) || [];
            arr.push(beam);
            this.castleMarkers.set(t.ownerId, arr);
          }
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

  // （原 `refreshTileOwners()` 只服务六棱柱实例的 owner 着色，已随「3D 战场」模式删除）

  // ---------- 舰船 ----------
  /**
   * 该舰的屏幕投影长度（像素）—— 三级表示唯一的判据来源。
   * H 必须取 `renderer.domElement.height`（drawingBuffer 高度，已含 DPR），
   * 不是 CSS 高度也不是 innerHeight：用 CSS 高度会让 DPR≠1 的机器上所有阈值整体错一倍。
   * 公式与 demo 的 shipPx 完全一致：L / (2·tan(fov/2)·d) · H。
   */
  private pxOf(worldPos: THREE.Vector3, shipLen: number): number {
    const H = this.renderer.domElement.height;
    const d = this.camera.position.distanceTo(worldPos);
    const halfFov = (this.camera.fov * Math.PI / 180) / 2;
    return shipLen / (2 * Math.tan(halfFov) * Math.max(1e-3, d)) * H;
  }

  /** 帝国侧判定（战役 factionId=2；模拟模式阵营 id 为提督 id，看 trait/faction 字段） */
  private isEmpireSideOf(u: any): boolean {
    const fac = this.getFac(u.factionId) || {};
    return u.factionId === 2 || (fac as any).trait === 'empire' || (fac as any).faction === 'empire';
  }

  /** 该舰所属舰队的专属旗舰模型 key（旗舰名 → FLAGSHIP_MODEL_ALIAS），非旗舰返回 null */
  private flagshipKeyOf(u: any, fleet: any): string | null {
    // 侦察分队是一艘真实的非旗舰巡洋舰，绝不可因为单舰编制而被回退识别为旗舰。
    if ((fleet as any)?._scout || (fleet as any)?._scoutFlight) return null;
    const units = (fleet.units as any[]) || [];
    const flagship = units.find((candidate: any) => candidate.isFlagship === true) || units[0];
    if (u !== flagship) return null;
    const adm = (this.store.allAdmirals as any[]).find((a: any) => a.id === (fleet.commanderId ?? u.factionId));
    return adm?.flagshipName ? (FLAGSHIP_MODEL_ALIAS[adm.flagshipName] || null) : null;
  }

  /**
   * 该 unit 的舰长（世界单位）。
   * 缓存到 unit 上：dimsOf 内部要线性扫旗舰长度表（~100 项），逐帧对全场实体算一遍太贵。
   * 旗舰身份取首次计算时的结果 —— 旗舰阵亡后 promotes 的继任者不改变已缓存长度（视觉上不可辨）。
   */
  private shipLenOf(u: any, fleet: any): number {
    // ⚠ 命中条件要求 **L/W/H 三者同时已缓存**：只判 __b3dLen 会让"旧版本只写过 L"的 unit
    //   永久拿不到 __b3dW/__b3dH ⇒ 分轴 floor 与层距下限静默退回旧口径（换舰种不生效）。
    if (typeof u.__b3dLen === 'number' && typeof u.__b3dW === 'number' && typeof u.__b3dH === 'number') return u.__b3dLen;
    const cls = String(u.classType || 'destroyer');
    const d = this.dimsOf(cls, this.isEmpireSideOf(u) ? 'empire' : 'alliance',
      this.flagshipKeyOf(u, fleet) ?? undefined);
    u.__b3dLen = d.L;
    u.__b3dW = d.W;   // 与 L 同一次 dimsOf ⇒ 单一真源，不重复扫旗舰表
    u.__b3dH = d.H;   // 同上：层距几何下限 layerGapFor(·, maxShipH) 的输入
    return d.L;
  }

  /** 该 unit 的舰宽（世界单位）。与 shipLenOf 共享同一次 dimsOf 结果（缓存 __b3dW），不额外扫表。 */
  private shipWOf(u: any, fleet: any): number {
    if (typeof u.__b3dW !== 'number') this.shipLenOf(u, fleet);
    return typeof u.__b3dW === 'number' ? u.__b3dW : 0;
  }

  /** 该 unit 的舰体高度（世界单位）。同上，共享 dimsOf（缓存 __b3dH）。 */
  private shipHOf(u: any, fleet: any): number {
    if (typeof u.__b3dH !== 'number') this.shipLenOf(u, fleet);
    return typeof u.__b3dH === 'number' ? u.__b3dH : 0;
  }

  /**
   * 单支舰队的**纵向排布参数**（队内层偏移 + 层数 + 层距 + 最高舰体 + 格距 + 平面足迹），按
   * `(阵型, 开局舰数 formationCount0, 层数上限, 格距源)` 缓存 —— 缓存键里**不含当前存活数**，
   * 故战斗减员不会让幸存舰跳层、也不会让层距突变（视觉稳定优先于"随战损变密"）。
   * 层距真源 = layerGapFor(spacingEff, maxShipH)；层数真源 = layerCountForFootprint(足迹, …)
   * （**不是**常量 TEAM_LAYERS，那是上限），见 config/fleetTierLayout.ts 的推导。
   */
  private fleetVLayout(fleet: any): { layers: number; layerK: number[]; layerGap: number; maxH: number; spacing: number; footprint: FormationFootprint } {
    const units: any[] = fleet.units || [];
    const form = String(fleet.formation || 'wedge');
    const n0: number = (fleet as any).formationCount0 ?? units.length;
    const gapSrc: number | string = (fleet as any)._formSpacing ?? `auto@${this.hexR}`;
    // 键里放 formationSpacing 的**全部自变量**而非数值：formationSpacing 是 O(n) 且分配数组，
    // 不能逐帧重算；自变量 = 外部覆盖值 _formSpacing（有则原样入键）否则 hexR。
    // ⚠ `layers` 现由足迹推导，但它是 (offs, spacing, layerGap) 的确定性函数，三者都已被本键冻结
    //   ⇒ 键不需要加新维度（改键会让既有缓存失效一次，且不带来正确性收益）。
    const key = `${form}:${n0}:${TEAM_LAYERS}:${gapSrc}`;
    const cached = (fleet as any)._b3dV;
    if ((fleet as any)._b3dVKey === key && cached) return cached;

    const offs = this.formOffsets(form, n0);
    const spacing: number = (fleet as any)._formSpacing ?? formationSpacing(offs, this.hexR);
    // 该队最高舰体（世界）：层距几何下限的输入。只统计有兵单位；空队退化为 0（层距只用 ratio 支路）。
    let maxH = 0;
    for (const u of units) {
      if (!u || u.hp <= 0) continue;
      const H = this.shipHOf(u, fleet);
      if (H > maxH) maxH = H;
    }
    const layerGap = layerGapFor(spacing, maxH);
    // 层数随平面足迹推导（不再恒定 TEAM_LAYERS —— 恒定会让小舰队成"竖直的针"，见 fleetTierLayout）
    const footprint = formationFootprint(offs);
    const layers = layerCountForFootprint(footprint, spacing, layerGap);
    const layerK = formationLayerOffsets(offs, layers);
    const v = { layers, layerK, layerGap, maxH, spacing, footprint };
    (fleet as any)._b3dVKey = key;
    (fleet as any)._b3dV = v;
    return v;
  }

  /**
   * 光点层 + 光晕层（各 1 个 Points）。
   * 光点层：renderOrder 1、AdditiveBlending、depthWrite=false、depthTest=true、frustumCulled=false。
   * 光晕层：renderOrder 6（晚于实体）、depthTest=false（辉光要压在舰体之上才叫"接住亮度"）。
   * 两层容量一次分配到位，每帧只改数据 + setDrawRange，不重建 buffer。
   * ⚠ 光点层缓冲长度 = `DOT_SLOTS`（= N_MAX × DOT_N），必须与上面 4 个 Float32Array 长度一致。
   * ⚠ `makeDotMaterial(24, …)` 的 24px 是点径硬上限，须 ≥ DOT_MIN_PX（= 3.60，远小于 24）——
   *   若将来把 DOT_PITCH_MIN_PX × DOT_DIAM_K 抬过 24，务必同步放大这里的上限，否则近景点被截平。
   */
  private buildShipDots() {
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3).setUsage(THREE.DynamicDrawUsage));
    dotGeo.setAttribute('aColor', new THREE.BufferAttribute(this.dotCol, 3));
    dotGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.dotAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    dotGeo.setAttribute('aPx', new THREE.BufferAttribute(this.dotPx, 1).setUsage(THREE.DynamicDrawUsage));
    dotGeo.setDrawRange(0, 0);
    const dots = new THREE.Points(dotGeo, makeDotMaterial(24, true));
    dots.frustumCulled = false;
    dots.renderOrder = 1;
    dots.name = 'shipDots';
    this.scene.add(dots);
    this.dotGeo = dotGeo;
    this.dotPoints = dots;

    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(this.haloPos, 3).setUsage(THREE.DynamicDrawUsage));
    haloGeo.setAttribute('aColor', new THREE.BufferAttribute(this.haloCol, 3));
    haloGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.haloAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    haloGeo.setAttribute('aPx', new THREE.BufferAttribute(this.haloPx, 1).setUsage(THREE.DynamicDrawUsage));
    haloGeo.setDrawRange(0, 0);
    const halos = new THREE.Points(haloGeo, makeDotMaterial(48, false));
    halos.frustumCulled = false;
    halos.renderOrder = 6;
    halos.name = 'shipHalos';
    this.scene.add(halos);
    this.haloGeo = haloGeo;
    this.haloPoints = halos;
  }

  // ---------- 分舰队阵型标记层 ----------
  /**
   * 标记层容器。只建一个空 Group —— 真正的「填充面 + 描边圈」按舰队惰性创建（writeFleetMarks）。
   * 顶点每帧直接写成**世界坐标**，故对象自身恒在原点、无旋转：
   * 不需要维护朝向，也就不会出现 demo 那种"贴地四元数符号写反 → 整块标记镜像"的隐患。
   */
  private buildFleetMarks() {
    const g = new THREE.Group();
    g.name = 'fleetMarks';
    this.scene.add(g);
    this.markGroup = g;
  }

  /** 释放一条标记记录：几何/材质逐条释放，对象从容器摘下（不依赖 scene.traverse 兜底） */
  private disposeFleetMark(m: FleetMark) {
    if (this.markGroup) {
      this.markGroup.remove(m.fill);
      this.markGroup.remove(m.outline);
    }
    m.fill.geometry.dispose();
    m.fillMat.dispose();
    m.outline.geometry.dispose();
    m.outlineMat.dispose();
  }

  /**
   * 建 / 重建某舰队的标记顶点缓冲。
   * 重建键含 `formationCount0` 对应的格数、hexR、半跨**与实际格距 `spacingEff`** ——
   * 换阵（AI 中途改阵）、舰队合并/拆分、地形分档变化都会触发重建；常规帧只改写顶点，不碰 GPU 资源。
   * ⚠ `spacingEff` 必须进键：紧邻的 markerSpan() 吃它，而 `he` 是**格位单位**半跨、与格距无关，
   * 故外部设定的格距（无头台 `entry_battle.ts` 的 formationSpacing(...)×SP 写进 `_formSpacing`）
   * 只改格距不改 he，不含格距的键会被 memo 吞掉 → 标记尺寸不跟随。这正是 `sp=` 实验当初失效的原因。
   */
  private ensureFleetMark(
    fid: number, formation: string, offs: FormationCell[],
    spacingEff: number, he: number, maxShipLen: number, maxShipW: number, color: number,
  ): FleetMark {
    // 键必须含**最长舰长与最宽舰宽**：底板下限 = 舰长×PAD（Y）/ 舰宽×PAD（X），
    // 漏任一个都会出现"换旗舰 / 最长的舰种被歼后底板还是旧尺寸"的静默漂移。
    const formKey = `${formation}:${offs.length}:${this.hexR}:${he}:${spacingEff.toFixed(4)}:${Math.round(maxShipLen)}:${Math.round(maxShipW)}`;
    const old = this.fleetMarks.get(fid);
    if (old && old.formKey === formKey) return old;
    if (old) this.disposeFleetMark(old);

    const P = markerNormShape(formation, offs);
    const { spanX, spanY, midU, midV } = markerSpan(formation, offs, spacingEff, P, maxShipLen, maxShipW);
    const fillNorm = markerFillNorm(P);
    const outlineNorm = new Float32Array(P.length * 3);
    for (let i = 0; i < P.length; i++) {
      outlineNorm[i * 3] = P[i][0];
      outlineNorm[i * 3 + 1] = P[i][1];
      outlineNorm[i * 3 + 2] = 0;
    }

    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(fillNorm.length), 3).setUsage(THREE.DynamicDrawUsage));
    const fillMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      // DoubleSide 必需：顶点逐帧写成世界坐标，面法线朝向不保证，单面会被背面剔除、整块标记消失
      depthWrite: false, side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.frustumCulled = false;   // 顶点逐帧改写，包围球无意义
    fill.renderOrder = -2;        // 早于地形/实体 → 读作"队形底"
    fill.name = `fleetMark_${fid}`;
    (this.markGroup ?? this.scene).add(fill);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(outlineNorm.length), 3).setUsage(THREE.DynamicDrawUsage));
    const outlineMat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const outline = new THREE.LineLoop(outGeo, outlineMat);
    outline.frustumCulled = false;
    // 不沿世界 +Y 抬高：填充面 depthWrite:false，描边靠 renderOrder 天然压在其上，同高不 z-fighting
    outline.renderOrder = -1;
    outline.name = `fleetOutline_${fid}`;
    (this.markGroup ?? this.scene).add(outline);

    const rec: FleetMark = {
      fid, formKey, fill, fillMat, outline, outlineMat, fillNorm, outlineNorm, spanX, spanY, midU, midV,
    };
    this.fleetMarks.set(fid, rec);
    return rec;
  }

  /**
   * 每帧写标记层（demo tick 的标记段）。
   *
   * 1) 透明度用**全场统一**参考 px（相机到 controls.target），不是各队自己的 px：
   *    各队用自己的 px 会让近处的队先淡出、远处的队还全亮，同一档位下亮度参差（demo 踩过）。
   *    `MARKER_FLOOR` 保证降到 0 之前留住"队形底" —— 中景靠它与光点叠成两层。
   * 2) 底板沉到**队内最低舰之下**（不是队心）：停在队心会把编队从中剖开，读起来是切面不是底。
   * 3) 顶点按「横向轴 / 纵深轴」两条基轴直接摆（不用四元数，见 ensureFleetMark 注释）。
   * 4) 底板中心取**足迹包围盒中心**，不是舰队锚点；跨度取**整跨** = 包围盒 × MARKER_PAD。
   *    这两条合起来才是「标记包住编队」——早先少算一个 2×（半跨当整跨用，PAD 实际 0.56）
   *    且居中在锚点（主体全在 gx ≤ 0 一侧 → 整块前偏），实测 350/400 例有舰越出底板。
   */
  private writeFleetMarks() {
    // 参考舰长取战列舰：与 demo 的 SHIP_LEN 同为"单位长度"语义
    const refPx = this.pxOf(this.controls.target, this.dimsOf('battleship').L);
    const fadeOut = 1 - sstep(DOT_IN_LO, DOT_IN_HI, refPx);
    const meshOff = 1 - sstep(this.lodLo, this.lodHi, refPx);
    // 【标记层可见性策略】远景：填充 = 1（此时它是唯一的舰队表示）
    //   中景：填充 → MARKER_FLOOR(0.05)、描边 → MARKER_FLOOR_OUTLINE(0.35)（退成"队形轮廓"）
    //   近景：随 meshOff 归零（实体已能表达阵型）
    const markerAlpha = Math.max(fadeOut, MARKER_FLOOR) * meshOff;
    const outlineAlpha = Math.max(fadeOut, MARKER_FLOOR_OUTLINE) * meshOff;
    this.lastStats.markerAlpha = markerAlpha;

    // 存活舰队 → 队内最低舰高 + 最长舰长 + **最宽舰宽**（数据源 unitVis：含"只有光点没有实体"的舰）
    // 舰长/舰宽都要：底板下限分轴（Y 用舰长、X 用舰宽，见 markerSpan）
    const agg = this.markAgg;
    agg.clear();
    for (const v of this.unitVis.values()) {
      const fl = v.fleet;
      if (!fl) continue;
      // v8：运输舰的渲染宿主（`_isAux`）**不是舰队** ⇒ 不画舰队托盘（它没有阵位、没有编队足迹）
      if ((fl as any)._isAux) continue;
      const fid: number = fl.id !== undefined ? fl.id : fl.factionId;
      const a = agg.get(fid);
      if (a) {
        if (v.y < a.minY) a.minY = v.y;
        if (v.shipLen > a.maxShipLen) a.maxShipLen = v.shipLen;
        if (v.shipW > a.maxShipW) a.maxShipW = v.shipW;
      } else agg.set(fid, { fleet: fl, minY: v.y, maxShipLen: v.shipLen, maxShipW: v.shipW });
    }

    // 本帧无存活单位的舰队（被歼灭/撤场）→ 回收记录
    this.fleetMarks.forEach((m, fid) => {
      if (!agg.has(fid)) { this.disposeFleetMark(m); this.fleetMarks.delete(fid); }
    });

    const visible = markerAlpha > 0.01;
    let shown = 0;
    // [2a] 选目标态候选集（BattleScene 每帧写入；退出即 cpCommandMode=false/targetCandidates=null
    //   ⇒ 本帧不做脉动覆盖 ⇒ 轮廓透明度回到下方原值，无残留高亮）。
    const cands: Set<number> | null = (this.battleScene as any).cpCommandMode
      ? ((this.battleScene as any).targetCandidates ?? null)
      : null;
    agg.forEach((a, fid) => {
      const fleet = a.fleet;
      const formation = String(fleet.formation || 'wedge');
      // 与 BattleScene L3798 同源：开局格数定阵型形状，战斗中的战损不改形状
      const n0: number = (fleet as any).formationCount0 ?? ((fleet.units as any[])?.length ?? 0);
      const offs = this.formOffsets(formation, n0);
      if (!offs.length) return;
      // 与 BattleScene L3808 同源：优先用 BattleScene 写下的实际格距（足迹超预算时会压缩），
      // 缺失时用同一个 formationSpacing 现算 —— 绝不另起一套间距公式
      const spacingEff: number = (fleet as any)._formSpacing ?? formationSpacing(offs, this.hexR);
      const he = halfExtentOf(offs);
      const color = factionColor(this.getFac(fleet.factionId) || {});

      const m = this.ensureFleetMark(fid, formation, offs, spacingEff, he, a.maxShipLen, a.maxShipW, color);

      // 两条基轴（世界）见 markerAxes；顶点直接用世界坐标摆，不做四元数贴合
      // [R10-B1→v41] 底框朝向与**阵位旋转真源**同源：优先 formFacing（v31-D 铁律），再回退 facingSmooth / facingAngle —— 托盘此前在急转中滞后于阵位（用户实报「舰队在后、托盘在前」）
      const [latX, latZ, depX, depZ] = markerAxes((fleet as any).formFacing ?? fleet.facingSmooth ?? fleet.facingAngle ?? 0);
      // 底板中心 = **足迹包围盒中心**，不是舰队锚点（= index 0 = 旗舰位）：
      // wedge / spindle / line 的主体全在 gx ≤ 0 一侧，居中在锚点上会让底板整体前偏近半个纵深，
      // 舰体从底板后方整片露出去。midU/midV 由 markerSpan 从 offs 反推，单位 = 世界。
      // [v41] 底板中心改随**实际单位质心**（平滑跟随），不再锚定指令锚点 fleet.x/y：
      //   转向/重排中舰模有 chase 限速在追新格位，锚点先到 ⇒ 托盘在前、舰在后（用户实报）。
      //   质心只算战斗舰（运输/补给舰不参与阵位定位，2 艘即可把中心拉偏 20~40px，v34d 实测）。
      //   平滑系数 0.25/帧（60fps 约 4 帧收敛），抹掉单帧跳变又不至于明显滞后。
      let _sx = 0, _sz = 0, _sn = 0;
      for (const u of (fleet.units || [])) {
        if (!u || !(u.hp > 0) || !u.sprite) continue;
        if (u.classType === '补给' || u.classType === '运输') continue;
        _sx += u.sprite.x; _sz += -u.sprite.y; _sn++;
      }
      if (_sn > 0) {
        _sx /= _sn; _sz /= _sn;
        const prev = m as any;
        const k = 0.25;
        (prev as any)._scx = prev._scx === undefined ? _sx : prev._scx + (_sx - prev._scx) * k;
        (prev as any)._scz = prev._scz === undefined ? _sz : prev._scz + (_sz - prev._scz) * k;
      }
      const hasC = (m as any)._scx !== undefined;
      // 质心已是实际编队中心 ⇒ 不再叠加 midU/midV（那是「锚点≠包围盒中心」时代的补偿）
      const cx = hasC ? (m as any)._scx : fleet.x + latX * m.midU + depX * m.midV;
      const cz = hasC ? (m as any)._scz : -fleet.y + latZ * m.midU + depZ * m.midV;
      const baseY = a.minY - this.cruiseClearance * MARKER_DROP_K;
      writeMarkVerts(m.fill.geometry, m.fillNorm, m.spanX, m.spanY, cx, baseY, cz,
        latX, latZ, depX, depZ);
      writeMarkVerts(m.outline.geometry, m.outlineNorm, m.spanX, m.spanY, cx, baseY, cz,
        latX, latZ, depX, depZ);

      m.fillMat.opacity = markerAlpha;
      // 描边比填充实一点（参考图里的队形轮廓是有边的）；中景由 outlineAlpha 保底
      m.outlineMat.opacity = Math.min(1, Math.max(outlineAlpha, markerAlpha * 1.6));
      // [2a] 候选目标脉动：轮廓亮度 0.45↔1.0 正弦，周期 1.2s（0.83Hz，07 §3.1）；
      //   与 HP<30% 警告(2Hz) 频率相差 2.4 倍，肉眼可区分。每帧重写 ⇒ 退出即恢复原值。
      // [2a-1] 直接覆盖 base，不再 max()：远景档 base(=1) 时 max() 把脉动整个吃掉（候选与背景零差异）；
      //   脉动是"候选态"的唯一表达，必须无条件覆盖 base。cands=null（非选目标态）不进此分支，行为逐位不变。
      if (cands && cands.has(fid)) {
        const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((this.clock.elapsedTime * 2 * Math.PI) / 1.2));
        m.outlineMat.opacity = pulse;
      } else {
        // [R10-B2] 选中舰队高亮：稳定满亮轮廓（不脉动），作为"当前选中"的视觉锚点
        //   （QA 报告 16:166「3D 没有舰队选中态」的补齐）。与候选脉动互斥：选目标态优先
        //   （cands 分支），非选目标态才表达选中态。选中 id 为 null 时不改动 ⇒ 原值兜底。
        const selId: number | null = (this.battleScene as any).battleSelectedFleetId ?? null;
        if (selId !== null && fid === selId) m.outlineMat.opacity = 1;
      }
      if (m.fillMat.color.getHex() !== color) {
        m.fillMat.color.setHex(color);
        m.outlineMat.color.setHex(color);
      }
      m.fill.visible = visible && markerAlpha > 0.02;
      // [2a-1] 候选：近景档 meshOff=0 ⇒ visible=false，会把脉动连"可见性"一起吃掉（近景候选零表达）；
      //   候选强制可见（透明度已由上面的脉动给的 base 决定）。cands=null 时退化为原 `visible`，逐位不变。
      m.outline.visible = visible || (cands !== null && cands.has(fid));
      if (visible) shown += 1;
    });
    this.lastStats.marks = shown;
  }

  /**
   * 释放一艘舰的私有 GPU 资源。
   * 共享几何（注册表 GLB 的 reg.geo / reg.wire，全体同型舰共用）必须跳过 —— 池化后本方法
   * 会被频繁调用，误释放会让同型其他舰的模型一起消失。共享几何在 buildShipFromModel 里
   * 打过 `__b3dShared` 标，这里按标记跳过；材质是每舰新建的，可以安全释放。
   */
  private disposeShipGroup(group: THREE.Group) {
    this.shipGroup.remove(group);
    group.traverse((o) => {
      const anyO = o as any;
      if (!anyO.isMesh && !anyO.isLineSegments) return;
      const g = anyO.geometry as THREE.BufferGeometry | undefined;
      if (g && !(g as any).__b3dShared) g.dispose();
      const m = anyO.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach(mm => mm.dispose()); else m?.dispose();
    });
  }

  /**
   * v6.5：dimsOf 接入阵营差异化长度——此前只查 SHIP_RATIO（supply 统一 1.612 ≈ 战列 2.2 倍），
   *  FACTION_SHIP_LENGTH（帝国 supply=700）只接进了巡览没接进战场，用户实报"帝国运输舰还是 1800"。
   *  修法：按 getShipScaleLength(舰种, 旗舰, 阵营) 的米制长度 / 通用表同舰种长度 得比例 k，
   *  长度全乘 k；截面 W/H 乘 sqrt(k)（体积感连续，避免短粗失真）。 */
  private dimsOf(classType: string, faction?: 'empire' | 'alliance', flagshipName?: string): { L: number; W: number; H: number } {
    const key = SHIP_RATIO[classType] ? classType : (CLS_ALIAS[classType] || 'destroyer');
    const ratio = SHIP_RATIO[key] || SHIP_RATIO.destroyer;
    let k = 1;
    if (ratio.L > 0.0001) {
      const lenMeters = getShipScaleLength(key, flagshipName, faction);
      const baseMeters = getShipScaleLength(key);   // 通用表基准（无阵营/旗舰覆盖）
      if (baseMeters > 0) k = Math.max(0.35, Math.min(1.6, lenMeters / baseMeters));
    }
    const sk = Math.sqrt(k);
    // 【大军团】全局视觉缩放：舰长/宽/高**同乘**，保持舰体比例（详见 SHIP_VISUAL_SCALE 的推导）。
    // 所有派生量（px 分级、标记底框下限、点团半径、护盾尺寸）都从本函数取值 ⇒ 改这一处即全场一致。
    const V = SHIP_VISUAL_SCALE;
    // 【旗舰方案】旗舰额外放大 FLAGSHIP_VISUAL_GAIN（L/W/H 同乘，保持舰体比例）
    const FG = flagshipName ? FLAGSHIP_VISUAL_GAIN : 1;
    return {
      L: ratio.L * k * SQ3 * this.hexR * V * FG,
      W: ratio.W * sk * SQ3 * this.hexR * V * FG,
      H: ratio.H * sk * SQ3 * this.hexR * V * FG,
    };
  }

  /** 程序化/模型建船总入口（舰首局部 -z）。
   *  1) assets/ship/ 下有匹配 GLB → 真实模型线条化渲染。候选顺序：
   *     flagship_{旗舰key}.glb（专属旗舰）→ {faction}_{class}.glb → {class}.glb；
   *  2) 模型加载中 → 程序化兜底 + pendingModel（就绪后场上原地换装）；
   *  3) 无模型文件 → 纯程序化造型（帝国战列舰走精细描形，其余通用造型）。 */
  private buildShip(classType: string, facColor: number, isEmpire?: boolean, flagshipKey?: string): BuiltShip {
    // v6.5：尺寸接入阵营差异化（帝国 supply=700 等）；旗舰名查 FLAGSHIP_LENGTH 专属长度
    const d = this.dimsOf(classType, isEmpire ? 'empire' : 'alliance', flagshipKey);
    const cls = SHIP_CLASS_ALIAS[classType] || null;
    const factionKey: 'empire' | 'alliance' = isEmpire ? 'empire' : 'alliance';

    const candidates: string[] = [];
      if (cls) {
      if (flagshipKey) candidates.push(`flagship_${flagshipKey}.glb`);
      candidates.push(`${factionKey}_${cls}.glb`, `${cls}.glb`);
      // 电子舰已有独立兵种和行为，但专属 GLB 尚未交付；明确回落巡洋舰，
      // 保持阵营外观一致，也避免模型缺失时退化成程序化小船。
      if (cls === 'electronic') candidates.push(`${factionKey}_cruiser.glb`, 'cruiser.glb');
      // v61：同盟侧无 alliance_fast_battleship.glb（同盟本不该列装高速战列舰，但旧存档/编制
      // 可能残留）；回落阵营战列舰模型，杜绝候选全空 → 程序化兜底。帝国命中 empire_fast_battleship.glb 不受影响。
      if (cls === 'fast_battleship') candidates.push(`${factionKey}_battleship.glb`, 'battleship.glb');
    }

    let reg: ShipModelReg | null = candidates.length ? acquireShipModelByFiles(candidates) : null;
    if (reg && reg.status === 'ready' && reg.geo) {
      const built = this.buildShipFromModel(reg, d, facColor);
      built.modelVer = reg.version;
      this.maybeAttachAuxBowMarker(built.group, cls, d);
      return built;
    }

    // 程序化兜底：帝国战列舰走精细描形；补给运输舰走箱形货舱造型（无 supply.glb 时可辨识）；
    // 其余通用造型。
    // v2 修复：supply 分支原来直接 return，绕过了 pendingModel 挂载 → GLB 就绪后永不换装，
    //   同盟运输舰一直显示程序化方框。现统一走 BuiltShip 出口，兜底造型 + pendingModel 原地换装。
    const built: BuiltShip = cls === 'supply'
      ? this.buildSupplyShip(d, facColor)
      : (cls === 'battleship' && isEmpire)
        ? this.buildEmpireBattleship(d, facColor)
        : this.buildGenericShip(d, facColor, classType);
    if (reg) built.pendingModel = reg;
    // [任务3] GLB 未就绪时的程序化兜底同样挂舰首标记（换装时随重建再挂一次）
    this.maybeAttachAuxBowMarker(built.group, cls, d);
    return built;
  }

  /** [任务3] 补给舰舰首标记挂载（见 `AUX_BOW_MARKER_ENABLED` 的推导注释）。
   *  ⚠ 只作用于补给舰（`supply`）：其余舰型的朝向语义由舰队姿态统一表达，不在本次改动范围内。
   *  ⚠ 挂成 ship group 的**子对象**：位置/朝向/缩放/销毁全部随舰体自动同步
   *     —— 满足本工程"面片类特效必须随 LOD 淡入淡出、不得出现无主体特效"的约定。 */
  private maybeAttachAuxBowMarker(group: THREE.Group, cls: string | null, d: { L: number; W: number; H: number }): void {
    if (!AUX_BOW_MARKER_ENABLED) return;
    const w: any = (typeof window !== 'undefined') ? window : undefined;
    if (w && w.__auxBowMarker === false) return;
    if (cls !== 'supply') return;
    const marker = this.buildAuxBowMarker(group, d);
    if (!marker) return;
    group.add(marker);
    (group.userData as any).bowMarker = marker;
  }

  /**
   * [任务3] 补给舰舰首标记几何：**双人字箭标**（LineSegments，指向局部 -Z = 舰首）
   *  + **舰首实心箭头带**（三角形面片，AdditiveBlending，与补给圈/链路同色系）。
   *
   * 为什么用"甲板上的方向箭标"而不是改模型：
   *   · 帝国补给舰俯视轮廓近方形（原始 X=0.868 / Z=0.910，长宽比 0.95）且沿线截面无收缩端，
   *     模型本身**没有可读的舰首长轴**；再加大模型也不解决"从上方看不出朝哪"。
   *   · 箭标是**渲染层叠加**：不动 GLB、不动缩放入口、不动任何战斗数值，且可一键回退。
   *
   * ⚠ **位置必须按真实几何包围盒算，不能用 `dimsOf` 的 d**：
   *   GLB 模型按"最长边 = L×0.96"归一化，**横截面跟随模型自身比例**——
   *   帝国补给舰真实高 ≈ 0.50×长，而 `d.H` 只有 0.105×长 ⇒ 拿 d.H 摆标记会埋进舰体内部，
   *   被舰体（不透明深度写入的 Phong 体）挡住 ⇒ 完全看不见（首版实测即此）。
   */
  private buildAuxBowMarker(group: THREE.Group, d: { L: number; W: number; H: number }): THREE.Group | null {
    // 以**已建好的舰体子对象**求包围盒（此时标记尚未加入 ⇒ 不会被自身污染）
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const size = new THREE.Vector3();
    box.getSize(size);
    const L = Math.max(size.z, d.L * 0.5);
    const W = Math.max(size.x, d.W * 0.4);
    const halfW = Math.max(W * 0.36, L * 0.055);
    // 摆在舰体最高面之上（略抬）⇒ 正俯视清晰可见，且不与舰体线框 z-fighting
    const y = box.max.y + Math.max(L * 0.012, W * 0.05);
    const zBow = box.min.z;   // 局部 -Z 端 = 舰首
    const g = new THREE.Group();
    // ① 双人字箭标（指向 -Z；两枚错开 ⇒ 读作"方向箭头"而不是"一条折线"）
    const pts: number[] = [];
    const chev = (zBack: number, zTip: number, hw: number) => {
      pts.push(-hw, y, zBack, 0, y, zTip);
      pts.push(hw, y, zBack, 0, y, zTip);
    };
    chev(zBow + L * 0.240, zBow + L * 0.120, halfW);
    chev(zBow + L * 0.335, zBow + L * 0.215, halfW * 0.80);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: AUX_BOW_MARK_0, transparent: true, opacity: 0.95, depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.renderOrder = 6;
    g.add(lines);
    // ② 舰首实心箭头带（面片；AdditiveBlending 与既有特效语言一致）
    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -halfW * 0.92, y, zBow + L * 0.225,
      halfW * 0.92, y, zBow + L * 0.225,
      0, y, zBow + L * 0.035,
    ], 3));
    const triMat = new THREE.MeshBasicMaterial({
      color: AUX_BOW_MARK_1, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const tri = new THREE.Mesh(triGeo, triMat);
    tri.renderOrder = 6;
    g.add(tri);
    // 供逐帧按 LOD grow 调透明度（材质每舰独立 ⇒ 可按舰调，不串扰）
    g.userData.markLineMat = lineMat;
    g.userData.markTriMat = triMat;
    // 取证用（真机探针读它核对标记是否落在舰体之上）
    g.name = 'auxBowMarker';
    g.userData.markDebug = { y, L, W, halfW, zBow, hullTopY: box.max.y };
    return g;
  }

  /** 通用程序化造型（无模型的舰种兜底）：三层材质 + 分件线框 */
// [v23 FX] detectEnginePorts / getEnginePorts / buildEnginePortGeo / buildEngineFx
//   四个方法已迁至 `./battleFx`（导出名 detectEnginePorts / getEnginePortsFor /
//   buildEnginePortGeo / buildEngineFx），本文件只调用共享实现 ——
//   目的：战场与"模型巡览"的尾焰不再各存一份副本（用户实报两者观感不一致）。

  /** [v22 尾焰] 旧的「舷侧小喷口锥」已删除 —— 全部舰型统一走 buildEngineFx（喷口光斑 + 柔晕）。
   *  保留此注释是为了让后续排查"为什么找不到 buildGlowJet"时能直接看到去向。 */

  private buildGenericShip(d: { L: number; W: number; H: number }, facColor: number, classType: string): { group: THREE.Group } {
    const group = new THREE.Group();
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc, flatShading: true });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });

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
    // [v22 尾焰] 双舷引擎 + 中央副喷口 ⇒ **三处微白光斑**
    //   （旧实现：两舷各一颗静态小球 + 舰尾中央一柱尖锥，读作"中间冒尖"）
    group.userData.dims = d;
    return { group };
  }

  /**
   * 补给运输舰（AUX）程序化兜底：细长箱形货舱 + 龙骨桁架轮廓，橙环标识后勤属性。
   * 与战舰造型明确区分（货舱方箱 vs 舰首锥），玩家一眼可辨"这是可击沉的运输舰"。
   */
  private buildSupplyShip(d: { L: number; W: number; H: number }, facColor: number): { group: THREE.Group } {
    const group = new THREE.Group();
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 30, specular: 0x88aacc, flatShading: true });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });
    // 后勤橙标识环（与补给圈/补给连线同色系 → 视觉语言统一）
    const auxMat = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.85, depthWrite: false });

    // 货舱主体：长方箱 + 舰桥短舱
    const hull = new THREE.Mesh(new THREE.BoxGeometry(d.W, d.H, d.L * 0.62), bodyMat);
    group.add(hull);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(hull.geometry as THREE.BufferGeometry), wireMat));
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(d.W * 0.6, d.H * 0.9, d.L * 0.14), bodyMat);
    bridge.position.set(0, d.H * 0.55, d.L * 0.36);
    group.add(bridge);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(bridge.geometry as THREE.BufferGeometry).translate(0, d.H * 0.55, d.L * 0.36), wireMat));
    // 舰首过渡锥（-z 前进方向，钝锥模拟货船球鼻艏）
    const nose = new THREE.Mesh(new THREE.ConeGeometry(d.W * 0.5, d.L * 0.18, 4), bodyMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0, -d.L * 0.4);
    group.add(nose);

    // AUX 橙色标识环 ×2（横套货舱）
    for (const zOff of [-d.L * 0.12, d.L * 0.1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.W * 0.72, d.W * 0.05, 6, 20), auxMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0, 0, zOff);
      group.add(ring);
    }

    // [v22 尾焰] 补给舰：两舷货舱尾喷口 ⇒ 两处微白光斑（旧：中央一柱尖锥）
    group.userData.dims = d;
    return { group };
  }

  /**
   * GLB 模型 → 线条化渲染（阵营色 Phong 体 + 单条轮廓线框，几何全体舰共享）。
   * 任意舰种通用：模型由注册表提供，缩放归一到该舰种占位长度。
   */
  private buildShipFromModel(reg: ShipModelReg, d: { L: number; W: number; H: number }, facColor: number): BuiltShip {
    const L = d.L;
    const group = new THREE.Group();
    const geo = reg.geo!;
    // 注册表几何全体同型舰共享：打标，池化/阵亡销毁时不得释放（见 disposeShipGroup）
    (geo as any).__b3dShared = true;
    if (reg.wire) (reg.wire as any).__b3dShared = true;
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const modelLen = Math.max(size.x, size.y, size.z) || 1;
    const s = (L * 0.96) / modelLen;

    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });

    const body = new THREE.Mesh(geo, bodyMat);
    body.scale.setScalar(s);
    group.add(body);
    if (reg.wire) {
      const wire = new THREE.LineSegments(reg.wire, wireMat);
      wire.scale.setScalar(s);
      group.add(wire);
    }

    // [v22 尾焰] 喷口从**模型几何**自动探测（同型舰缓存）⇒ 位置不再钉在舰尾中心单点；
    //   造型由"锥形喷流"改为"几处微白光斑"（见 buildEnginePortGeo / buildEngineFx）。
    // ⚠ 第 4 参 pScale = **显示长度**（不是 s）：喷口坐标按模型原始长度归一化，
    //   舰体被缩放到显示尺寸，换算必须用显示长度（详见 battleFx.buildEnginePortGeo 注释）。
    // 尾焰粒子对齐 + 调试断言用：喷口（归一化坐标）与模型缩放
    // [v26b] 粒子发射点用的**换算系数**：喷口坐标是按模型原始长度归一化 ⇒ 必须乘**显示长度**
    //   （不是 s）。旧代码粒子也用 s ⇒ 与光斑同样差 modelLen 倍（粒子会飞出舰体）。

    group.userData.dims = d;
    return { group };
  }

  /**
   * 帝国标准战舰程序化兜底（多视角参考图描形，舰首 -z）：
   * 有 GLB 模型时本函数不会被调用（buildShip 分流）。
   * 所有静态件 merge 成单 Mesh（1 draw call）+ 单条 EdgesGeometry 轮廓线框，
   * 几十艘同屏不增加对象数；引擎光核/尾焰挂点兼容原管线。
   */
  private buildEmpireBattleship(d: { L: number; W: number; H: number }, facColor: number): { group: THREE.Group } {
    // ── 程序化描形兜底 ──
    const L = d.L;
    const group = new THREE.Group();
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const bodyMat = new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc, flatShading: true });
    const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const wireMat = new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 });

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

    // ── [v22 尾焰] 三喷口光斑（原为 3 颗独立小球 + 尾部中央一柱尖锥 ⇒ 现合并为两层各 1 Mesh）──

    // 全长 -0.50 ~ +0.535 ≈ 1.035L → 基本贴合占位
    group.scale.setScalar(0.96);
    group.userData.dims = d;
    return { group };
  }

  /**
   * 每帧同步舰队 —— 三级表示的中枢。
   *   近景（px ≥ MESH_IN_HI）= 3D 实体
   *   中景（px ≥ DOT_IN_LO）= 光点（远景正式语义：**1 舰 1 个圆点**，DOT_N = 1）
   *   远景（px < DOT_IN_LO）= **仍是光点** —— 光点层由屏幕空间点距下限 `DOT_PITCH_MIN_PX` 驱动，
   *                             每格至多 1 点，永不重叠成块、也永不因"太远"被 alpha=0 抹掉。
   * 三层由同一个 grow（= 实体的 meshOn）驱动，保证"点的位置 / 点屏径 / 点透明度"锁相。
   *
   * 实体池：MESH_IN_LO(14)/DROP(15)/KEEP(17)/HI(26) px 滞回 + 按 px 降序取前 MAX_MESHES。
   * 落选的舰**不建模型但不许消失** —— 未获实体者的点照写（demo 的"幽灵态回补"等价物），
   * 否则池溢出的舰会变成隐形空洞（用户实机反馈的"从几个角度看过去舰船看不见了"）。
   */
  /**
   * 【性能】按**实体负载**自动切换舰船模型档位（high → medium(lod1≈20% 面) → low(lod2≈5% 面)）。
   *
   * 为什么必须做：档位原本是**全局设置且只在 overlay 创建时注入一次**，即永远 'high'
   * （单模型 ≈5 万三角面）。K_VISUAL 默认改到 1:100 后实体数可到 400 ⇒ 实测
   *   400 实体 / 876~990 draw call / **8.8~9.9M 提交三角面**（软渲染下 0.2~1.1 fps，连截图都超时）。
   * 而缩舰 0.40 之后大多数实体在屏幕上本身很小，高档模型的细节**根本看不见** —— 纯浪费。
   *
   * 判据用"本帧持实体的舰数"（= 真实负载驱动量），带滞回避免推拉时反复换档：
   *   ≥300 → low；≥170 → 至少 medium；<120 → 允许回 high。结果再被 `detailCeil` 夹住，
   *   即**永远不会超过用户在设置里选的档位**（设置选 low 就恒为 low）。
   *
   * 切换代价与迁移：档位只对**新建**的舰船生效（模型注册表按 URL 缓存）。原先"把已有实体全部
   * 交还池子 + 清空"会在一次换档里 dispose 数百个实体、下一帧再全部重建 —— 这是实机
   * "打着打着就挺卡 / 舰队整体移动卡顿"最重的尖峰之一。[v12.1 C2] 改为**分帧迁移**：每帧最多
   * 淘汰 `LOD_MIGRATE_PER_FRAME` 个**旧档**实体，下一帧由实体池第二遍按新档经 addMesh 自然补回
   * （同时受 `MESH_ADD_PER_FRAME` 限流），任何一帧的建/销都被限流约束，不再有整档尖峰。
   *
   * [v12.1 C1] 判据除"实体数量"外，新增**帧时压力**：帧时 EMA 超预算 `PERF_BUDGET_MS` 时**强制再降
   * 一档**（`LOD_COOLDOWN_S` 冷却防抖）；帧时回落到舒适线以下且负载不高（< `LOD_RECOVER_COUNT`）
   * 时允许回升一档。数据驱动修正了原实现"实体数量不大、但核显帧时已爆却不降档"的盲区。
   */
  private autoLodByLoad(meshCount: number, dt: number): void {
    const order: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
    const ceilIdx = order.indexOf(this.detailCeil);

    // ── (1) 数量判据（原逻辑，滞回避免推拉时反复换档）──
    let countIdx = order.indexOf(this.detailTier);
    if (meshCount >= 300) countIdx = 2;
    else if (meshCount >= 170 && countIdx < 1) countIdx = 1;
    else if (meshCount < 120 && countIdx > 0) countIdx = 0;

    // ── (2) [v12.1 C1] 帧时压力判据（0.5s 冷却）：EMA 超预算 → 压力棘轮 +1；恢复且负载不高 → -1 ──
    //     棘轮独立于数量判据 ⇒ 两者取 max 时不会互相抵消（首版把两者写在同一 wantIdx 上，
    //     数量判据每帧把档位拉回 high、帧时判据每 0.5s 再压低 → 档位抖动 23 次，已修）。
    //     ⚠ 帧时判据同样要跳过 PERF_WARMUP_FRAMES：地形/模型/着色器编译期本来就慢，
    //       用编译期的 EMA 触发降档会把"暂时慢"误判成"持续超载"（冷启动即降到 low 且迟迟不回）。
    this.lodCooldown -= dt;
    const perfWarm = this.perfFrame >= PERF_WARMUP_FRAMES;
    if (this.lodCooldown <= 0 && perfWarm) {
      if (this.frameEmaMs > PERF_BUDGET_MS && this.lodPressure < 2) {
        this.lodPressure += 1;
        this.lodCooldown = LOD_COOLDOWN_S;
      } else if (this.frameEmaMs < PERF_COMFORT_MS && this.lodPressure > 0 && meshCount < LOD_RECOVER_COUNT) {
        this.lodPressure -= 1;
        this.lodCooldown = LOD_COOLDOWN_S;
      }
    }
    let wantIdx = Math.max(countIdx, this.lodPressure);   // 帧时压力是**下界**，数量判据不得抵消

    wantIdx = Math.max(wantIdx, ceilIdx);      // 不高于用户上限
    const want = order[wantIdx];
    if (want !== this.detailTier) {
      this.detailTier = want;
      try { setShipModelDetail(want); } catch { /* headless 时忽略 */ }
      // [v12.1 C2] 此处**不再**全量 dispose+clear（换档瞬时尖峰）；改由下方 (3) 逐帧迁移。
    }

    // ── (3) [v12.1 C2] 分帧迁移：淘汰非当前档的旧实体（≤ LOD_MIGRATE_PER_FRAME / 帧）。
    //     被淘汰者下一帧由第二遍按新档经 addMesh 补回 ⇒ 单帧建/销都受限流约束，无整档尖峰。──
    if (this.ships.size > 0) {
      let migrated = 0;
      for (const [key, e] of this.ships) {
        if (e.tier === this.detailTier) continue;
        this.disposeShipGroup(e.group);
        this.ships.delete(key);
        if (++migrated >= LOD_MIGRATE_PER_FRAME) break;
      }
    }
  }

  /**
   * [v76] 按**相机高度**更新 LOD 档位（用户明确要求「近景要全模型」）。
   *
   * 判据：ratio = |camera.position.y| / initCamY
   *   · ratio < 0.55（拉近）⇒ 近景档：门槛压到 5/9/6/5 ⇒ **几乎全模型**
   *   · ratio > 0.70（拉远）⇒ 远景档：原值 14/26/17/15 ⇒ 保留点阵（雷达观感）
   *   中间为滞回带（防相机在阈值附近抖动导致全场 grow 突变闪烁）。
   *
   * ⚠ 为什么用 camera.position.y 而非 distanceTo(controls.target)：
   *   "跟随舰队"逻辑**只移动 target 不移动 position**（见 updateCamera-follow 段），
   *   故 camD 实际是"舰队距相机多远"，与用户缩放无关 ⇒ 判档必然失效（v74 的教训）。
   *   相机高度只受 OrbitControls dolly 影响 ⇒ 是缩放级别的可靠代理量。
   */
  private updateLodTier(): void {
    const baseY = this.initCamY > 0 ? this.initCamY : 1;
    const ratio = Math.abs(this.camera.position.y) / baseY;
    // 滞回：已在近景时用更松的退出线（0.92），否则用进入线（0.78）。
    //   ⚠ 阈值标定（实测）：初始 ratio = 1.00；拉近到初始的 78% 以内即为近景。
    //     dist=400 ⇒ 0.50 近景 / 600 ⇒ 0.74 近景 / 806（初始）⇒ 1.00 远景。
    //   初版用 0.55/0.70 过严 —— 只拉近 25%（dist 600）就退回远景档，
    //   而用户的"近景"未必拉到极限。
    // [v82] 滞回带加宽（0.78/0.92 → 0.75/0.95）：本开关现**仅控粒子/星空退场**，
    //   但同样会在边界抖动 ⇒ 粒子忽隐忽现。加宽到 20% 减少切换频次。
    const enter = this.lodNear ? 0.95 : 0.75;
    const next = ratio < enter;
    if (next !== this.lodNear) this.lodNear = next;
  }

  /**
   * [v77] **近景档：点云类图层退场**（用户实报「拉到贴脸了还有圆点，这是绝对的问题」）。
   *
   * 贴脸时视锥内单位极少 ⇒ 不可能是"没拿到实体的舰船"（预算/阈值问题），
   * 只能是**非舰船的点云图层**。逐项分析：
   *   · 尾焰粒子（7/舰）：`gl_PointSize = aSize·uPix·(260/距离)`
   *     ⇒ **距离越小点越大**（贴脸 d≈104 时约 7.5px，比远景更显眼）⇒ 头号嫌疑
   *   · 星空：r=2500~4000、size=hexR×1.2 ⇒ 投影恒约 12px，与缩放无关（背景星）
   * 处置：
   *   · 尾焰粒子在近景**整体退场** —— 它本是"远景批量渲染 1 draw call"的优化产物；
   *     近景有舰船模型 + 喷口辉光（buildEngineFx 的 flame/glow）承担尾焰语义，不必用粒子。
   *   · 星空在近景**降透明度**（0.7→0.22）—— 保留太空感但不与"舰船圆点"混淆。
   * ⚠ 两者都只在 `lodNear` 生效；远景档完全恢复原行为（雷达点阵观感不变）。
   */
  private applyNearTierLayerPolicy(): void {

    // 星空：近景降透明度（缓存引用 —— 星空创建时未持字段）
    if (!this._starsRef) {
      this._starsRef = (this.scene.getObjectByName('sceneStars') as THREE.Points | null) ?? null;
    }
    if (this._starsRef && !this.debugHide.has('stars')) {
      const m = this._starsRef.material as THREE.PointsMaterial;
      if (m) m.opacity = this.lodNear ? 0.22 : 0.7;
    }
  }

  /**
   * [v79] 诊断面板更新（`?debug=1`）。只在开启时创建 DOM，关闭时零开销。
   */
  /**
   * [v80] 调试面板热键绑定：**Ctrl+Shift+D** 切换。
   * ⚠ 本工程是 **Wails 桌面应用**（无地址栏）⇒ `?debug=1` 用不上，
   *   热键是主入口。同时挂 `window.__b3dDebug()` 供 DevTools console 调用
   *   （`wails dev` 可按 F12 开 DevTools，输入 `__b3dDebug()` 亦可）。
   */
  private bindDebugHotkey(): void {
    if (this._dbgHotkeyBound) return;
    this._dbgHotkeyBound = true;
    const toggle = () => {
      this._dbgFlags.checked = true;
      this._dbgFlags.on = !this._dbgFlags.on;
      if (!this._dbgFlags.on && this.debugPanel) {
        this.debugPanel.remove();
        this.debugPanel = null;
      }
      // 反馈：让用户知道按到了（面板出现/消失本身即反馈，此处只在控制台留痕）
      // eslint-disable-next-line no-console
      console.log('[b3d] debug panel', this._dbgFlags.on ? 'ON' : 'OFF');
    };
    try {
      // ⚠ 用 **capture 阶段**注册：Phaser 的键盘插件在冒泡阶段处理，
      //   若绑冒泡可能被其拦截/吞掉（届时热键"按了没反应"）。
      //   capture 先于冒泡执行 ⇒ 稳定拿到事件。
      window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      }, true);
      (window as any).__b3dDebug = toggle;
    } catch { /* 非浏览器环境 */ }
  }

  private updateDebugPanel(rows: { id: string; n: number; px: number; mesh: number }[]): void {
    this.bindDebugHotkey();
    if (!this._dbgFlags.checked) {
      this._dbgFlags.checked = true;
      try {
        this._dbgFlags.on = new URLSearchParams(window.location.search).get('debug') === '1';
      } catch { this._dbgFlags.on = false; }
    }
    if (!this._dbgFlags.on) return;
    if (!this.debugPanel) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed', left: '8px', bottom: '8px', zIndex: '9999',
        font: '11px/1.4 ui-monospace,Consolas,monospace', color: '#9fe8ff',
        background: 'rgba(2,10,20,.85)', padding: '6px 9px', borderRadius: '4px',
        whiteSpace: 'pre', pointerEvents: 'none', border: '1px solid rgba(120,200,255,.25)',
      } as CSSStyleDeclaration);
      document.body.appendChild(el);
      this.debugPanel = el;
    }
    const head = `tier=${this.lodNear ? 'NEAR' : 'FAR'} lo=${this.lodLo} hi=${this.lodHi} keep=${this.lodKeep}`;
    const body = rows
      .map((r) => `${r.id}  n=${String(r.n).padStart(3)}  px=${r.px.toFixed(1).padStart(6)}  mesh=${String(r.mesh).padStart(3)}  ${r.px >= this.lodKeep ? 'MODEL' : r.px >= this.lodLo ? 'FADE' : 'DOT'}`)
      .join('\n');
    this.debugPanel.textContent = head + '\n' + body;
    // [v80] 同步输出到控制台（节流 1s）—— 便于用户直接复制文本反馈，
    //   不依赖截图辨认面板数字。
    const nowMs = performance.now();
    if (nowMs - this._dbgLastLog > 1000) {
      this._dbgLastLog = nowMs;
      // eslint-disable-next-line no-console
      console.log('[b3d-debug]\n' + head + '\n' + body);
    }
  }

  /**
   * [v77] 应用调试隐藏开关。URL 形如 `?hide=flame,stars`。
   * ⚠ 只影响 `visible`，不改任何 LOD/分配逻辑 ⇒ 移除参数即完全恢复。
   */
  private applyDebugHide(): void {
    // 惰性读一次 URL（构造期可能早于 location 可用；且参数不会中途变）
    if (!(this as any)._debugHideParsed) {
      (this as any)._debugHideParsed = true;
      try {
        const raw = new URLSearchParams(window.location.search).get('hide') || '';
        this.debugHide = new Set(raw.split(',').map((x) => x.trim()).filter(Boolean));
      } catch { /* 非浏览器环境：保持空集 */ }
    }
    if (this.debugHide.size === 0) return;
    if (this.dotPoints) this.dotPoints.visible = this.dotPoints.visible && !this.debugHide.has('dots');
    if (this.haloPoints) this.haloPoints.visible = this.haloPoints.visible && !this.debugHide.has('halo');
    if (this.debugHide.has('stars')) {
      // 星空在 init 时创建并 add 到 scene，未持字段 ⇒ 按名字取一次并缓存
      if (!this._starsRef) {
        this._starsRef = (this.scene.getObjectByName('sceneStars') as THREE.Points | null) ?? null;
      }
      if (this._starsRef) this._starsRef.visible = false;
    }
  }

  /**
   * [v82] **取消"近景/远景两档"**（用户实报「拉近的某个瞬间前排舰队出现模型，
   *   又一瞬间切回圆点」= 档位在 `ratio 0.78` 边界反复切换 ⇒ 阈值在
   *   `keep 6` 与 `keep 15` 之间跳 ⇒ 实体批量建/销 ⇒ 闪烁）。
   *
   * 取消后统一用单套阈值：`DROP(8) < KEEP(10) < LO(12) < HI(24)`。
   *   · 近景（相机近 ⇒ px 大）⇒ px ≥ 24 ⇒ 全实心模型（**用户的诉求自然满足**）
   *   · 远景（相机远 ⇒ px 小）⇒ 小舰队为点（保留雷达观感）
   * ⇒ 无需两档即可同时满足"近景全模型"与"远景雷达点阵"，且**无切换抖动**。
   */
  private get lodLo(): number { return this.lodNear ? 0 : MESH_IN_LO; }
  private get lodHi(): number { return this.lodNear ? 8 : MESH_IN_HI; }
  private get lodKeep(): number { return this.lodNear ? 0 : FAR_TIER_KEEP; }
  private get lodDrop(): number { return this.lodNear ? 0 : FAR_TIER_KEEP; }

  /**
   * ★ v8 取（懒建）运输舰的**独立渲染宿主**。
   *
   * 为什么需要宿主：`unitVis` 管线的每条下游（LOD/光点/实体/受创外观）都以 `v.fleet` 读
   *   `factionId` / `units` / `facingSmooth`。运输舰**不隶属任何舰队**（`AuxShip` 连 `fleet` 字段都没有），
   * 因此这里给它一个**只代表它自己**的宿主对象，而不是借用某支真实舰队。
 *
   * 宿主的三条不变量（改这里前先读）：
   *   1. **成员恒为该运输舰一艘** ⇒ 第二遍算出的 `fleetPx`（成员均值）就是它自己的 px，
   *      所以"相机贴脸 ⇒ 一定越过 lodKeep ⇒ 一定建实体"是结构性的，不依赖任何编队位置。
   *   2. **不带 `formation` / `formationCount0` / `id`（number）** ⇒ 不会被当成编队参与托盘/名牌/高度档/拾取。
   *   3. 引用按 unit 缓存（跨帧稳定）：门/缓存/拾取若按对象键索引也不会每帧换键。
   */
  private auxHostOf(u: any, aux: any): any {
    let h = this.auxHosts.get(u);
    if (!h) {
      h = {
        id: `aux:${Math.random().toString(36).slice(2)}`,
        factionId: u.factionId,
        units: [u],
        _isAux: true,
        aux: null,
      };
      this.auxHosts.set(u, h);
    }
    h.factionId = u.factionId;
    h.units[0] = u;
    h.aux = aux;
    // 供 addMesh 的初始朝向 / 任何读 `facingSmooth` 的下游使用 —— 恒等于运输舰自身航向。
    h.facingSmooth = typeof aux?.heading === 'number' ? aux.heading : 0;
    h.facingAngle = h.facingSmooth;
    h.x = aux?.x ?? 0;
    h.y = aux?.y ?? 0;
    return h;
  }

  private syncShips(dt: number) {
    // [切片传送入场] 本帧开关（一键关闭：window.__entryFxEnabled = false）—— 每帧只读一次
    this.entryFxActive = this.entryFxOn();
    this.updateLodTier();   // [v76] 先定档，同帧内所有消费点读一致值
    this.applyDebugHide();  // [v77] 调试隐藏开关（生产环境为空集 ⇒ 无行为变更）
    this.applyNearTierLayerPolicy();   // [v77] 近景档：粒子/星空退场
    const bs = this.battleScene;
    const fleets: any[] = typeof (bs as any).getRenderableFleets === 'function'
      ? (bs as any).getRenderableFleets()
      : ((bs as any).globalFleets || []);
    const now = performance.now() / 1000;

    // ── 第零遍：队间高度档（WS3）。每方（= factionId，1v1 会战里攻守各一方）的各支分舰队
    //    按**编制血缘**分档：档数只由**根舰队数**决定（根 = 无 `_detachedFrom`），分舰队继承其根的
    //    档位 ⇒ 同源同层。档距取该方各队 teamGapFor(...) 的**最大值**
    //    （同方统一档距 ⇒ 各档等距、包络整齐；若各队各用各的档距会读到不等距的乱层）。
    //    ⚠ [v34c] 此前档数按**舰队对象总数**算、档位按**数组序号** round-robin ⇒ 一次分兵会让
    //      母队从 0 掉到 −64.8（T=2 的对称档）而分舰队出现在 +64.8，即用户实报的
    //      "分出来的舰队漂浮在最上面一层"。真源与推导见 config/fleetTierLayout.assignFleetTiers。
    //    ⚠ 只施加在 3D 视觉层：BattleScene 的 2D 逻辑/命中/寻路保持平面，高度不参与命中判定。
    const aliveFleets: any[] = [];
    for (const fleet of fleets) {
      if ((fleet.units || []).length > 0) aliveFleets.push(fleet);
    }
    const fleetTierY = assignFleetTiers(aliveFleets, (f: any) => {
      const v = this.fleetVLayout(f);
      return teamGapFor(v.spacing, v.layerGap, v.maxH, v.layers);
    }, DETACHED_TIER_OFFSET, this.tierSticky);
    // 供 __b3dFocus（取景调试口）读同一份档位真源，避免它自己再算一遍
    this.lastTierY = fleetTierY;

    // ── 第一遍：枚举存活单位，算屏幕投影长度 px，登记可见性状态 ──
    // [v12.2 R1] 就地更新（不再每帧 clear()+重建）—— 消除 ~720 个 UnitVis 对象/帧 + 720 次 Map 插入的分配与 GC 压力。
    // 存活标记 `seen`：进入时全部置 false，本遍见到的置 true，第一遍结束后删除仍为 false 的陈旧条目（阵亡 / 离场）。
    // 安全性：全部消费点均在**本帧内**消费、不跨帧持有 UnitVis 引用（消费点审计见 v12.2 报告 Phase 3d）——
    //   syncShips 二/三遍、writeDotLayers、writeFleetMarks、updateBillboards、fxYAtPx、__b3dMarkProbe；
    //   `dotGrid` / `flagVisBuf` 虽持引用，但都在 writeDotLayers 开头 clear、同帧内用完即弃。
    const vis = this.unitVis;
    for (const v of vis.values()) v.seen = false;
    // 【旗舰方案】重建旗舰集合（持久 isFlagship 身份，而非会随战损前移的数组下标）。
    this.flagshipSet.clear();
    for (const fleet of fleets) {
      const units = (fleet.units as any[]) || [];
      const flagship = ((fleet as any)._scout || (fleet as any)._scoutFlight)
        ? null : (units.find((u: any) => u.isFlagship === true) || units[0]);
      if (flagship) this.flagshipSet.add(flagship);
    }
    for (const fleet of fleets) {
      const units: any[] = fleet.units || [];
      // A model is a representative of aggregate combat strength, not an
      // independent truth source.  Build this projection once per fleet so
      // 30% fleet HP visibly means roughly 30% of the deployed formation.
      const visualCapacity = (fleet as any)._visualCapacity ?? units.length;
      (fleet as any)._visualCapacity = visualCapacity;
      // ── [v78] 折算必须按**阵位空间序**，不能按数组序 ──────────────────────
      //   用户实报：「整个阵型的后半部分是模型，前半部分是圆点」「拉更近后前半的
      //   圆点不见了，模型也没有」—— 用户的判断正确：**这是折算的问题，不是 LOD 阈值**。
      //
      //   根因：`visibleIndexes` 装的是**数组下标**，而 `fleet.units` 的顺序在战损时
      //   会被 `filter` 重赋值、下标整体前移（见 BattleScene 的 units 维护），
      //   ⇒ 下标序 ≠ 阵位空间序。等间隔抽样作用在"错乱的序"上，
      //   ⇒ 被抽中的下标在空间上**聚集**（表现为"某一段有模型、另一段只有点/没有"）。
      //
      //   修复：先按 `formationSlot`（部署期固定、与阵位一一对应）排出**空间序**，
      //   在空间序上做折算，再把结果映射回原下标。
      //   ⇒ 抽样在阵型上均匀分布（战损时是"整队等比稀疏"，而不是"砍掉一半"）。
      const representation = projectFleetRepresentationBySlot(units, visualCapacity);
      const visibleIndexes = new Set(representation.visibleIndexes);
      // [R10-B1] 哨兵朝向与舰体同源：优先 2D 限速平滑值 facingSmooth（缺省回退权威 facingAngle），
      //   使"点团微网格跟随舰体"在转向期也随舰首缓转（而非瞬时跳）
      const fa = fleet.facingSmooth ?? fleet.facingAngle ?? 0;
      // 队内垂直分层 + 层距：单一真源 = fleetVLayout（缓存）；与 marker/BattleScene 共用其真源语义。
      // 层号在同一场会战内稳定的依据：缓存键里的 n 取 `formationCount0`（**战前编制**，非当前存活数）
      // ⇒ 战斗中途减员不会让任何舰跳层。层距取 max(0.3125×spacingEff, 0.8×maxShipH)（见 fleetTierLayout）。
      // （不解释"某舰在哪层"：层序按 (gx, gy) 排名分配，各阵型的 index 0 名次不同，
      //   无恒定闭式——旗舰也不恒在最低层。此处只需"层号不抖"这一条。）
      const v = this.fleetVLayout(fleet);
      const layK = v.layerK;
      const layGap = v.layerGap;
      const tierY = fleetTierY.get(fleet) ?? 0;
      for (let ui = 0; ui < units.length; ui++) {
        const u = units[ui];
        // Phaser 层的 visible 是战争迷雾的权威输出；3D 层只能消费它，
        // 不得因独立遍历 globalFleets 而泄漏未知/未识别敌舰模型。
        if (!u.sprite || u.sprite.visible === false || u.hp <= 0 || !visibleIndexes.has(ui)) continue;
        // unit 无稳定 id：用 fleetId + sprite 容器引用做 key（sprite 生命周期=unit 生命周期）
        const key = `${fleet.factionId}:${u.sprite._b3dKey || (u.sprite._b3dKey = Math.random().toString(36).slice(2))}`;
        const shipLen = this.shipLenOf(u, fleet);
        const shipW = this.shipWOf(u, fleet);
        // 位置与实体同步段同一基准（地形高度 + 巡航余量）；未获实体者就停在这个目标位。
        // 平滑量（cruiseY 指数收敛 / 星球避让 / 占领外推）只有已获实体的舰才有历史，
        // 对 px 分级判定影响可忽略，故此处不做。
        const h = this.heightAtPx(u.sprite.x, u.sprite.y);
        const laySlot = (typeof u.formationSlot === 'number' && u.formationSlot >= 0)
          ? u.formationSlot : ui;
        // layK 是"1 个层距"的乘数（已按 Leff = min(L, n) 居中）—— 消费侧只乘层距，不再做居中。
        // tierY = 该舰队所属高度档的偏移（世界，已含档距）—— 队间叠层，整队统一抬升。
        const layY = (layK[laySlot] ?? 0) * layGap;
        const y = h + this.cruiseClearance + layY + tierY;
        const px = this.pxOf(this.visTmpV.set(u.sprite.x, y, -u.sprite.y), shipLen);
        // 屏幕像素坐标（左/上为原点）：远景点阵分桶用。复用同一个临时向量（pxOf 只读它，未被改写）。
        // 尺寸口径必须与 pxOf 一致（domElement.width/height = drawingBuffer，已含 DPR）。
        this.visTmpV.project(this.camera);
        const sx = (this.visTmpV.x * 0.5 + 0.5) * this.renderer.domElement.width;
        const sy = (0.5 - this.visTmpV.y * 0.5) * this.renderer.domElement.height;
        // 未获实体者没有移动史，用舰队朝向兜底（点团微网格跟随舰体，朝向差几度不可辨）
        // [v12.2 R1] 就地更新：命中已有条目则改写字段（零分配），首次出现才建条目。
        // 一并写入本帧地形基准高度 `h`（第三遍直接复用，省一次 heightAtPx 调用）与存活标记 `seen`。
        let vv = vis.get(key);
        if (!vv) {
          // 字段占位，随即被下方逐项覆盖；字段集合与顺序固定 = hidden class 稳定
          vv = { key, u, fleet, x: 0, y: 0, z: 0, h: 0, seen: true, px: 0, sx: 0, sy: 0, shipLen: 0, shipW: 0, grow: 0, yaw: 0, fleetPx: 0 };
          vis.set(key, vv);
        }
        // [切片传送入场 · 时机修复] 逐帧对**可见单位**尝试登记（幂等）。
        //   此前只在"首次见到"（`if (!vv)`）登记 ⇒ 部署期首见被守卫拦下后**再无登记机会**，
        //   开战即永不触发切片。改为逐帧尝试：未开战 / 部署期 / 已登记 / 窗口外都立即返回，
        //   仍由 `entryStates.has(key)` 保证"推拉镜头不重播"（进度绑入场事件，不绑 addMesh）。
        this.registerEntryState(key, u, fleet, now);
        vv.u = u; vv.fleet = fleet; vv.seen = true;
        vv.x = u.sprite.x; vv.y = y; vv.z = -u.sprite.y;
        vv.h = h; vv.px = px; vv.sx = sx; vv.sy = sy;
        vv.shipLen = shipLen; vv.shipW = shipW;
        // grow 每帧显式归零：第三遍只对"拿到实体"的舰重设 grow；未获实体者须保持纯光点（0），
        // 否则会残留上一帧实体期的暗化值 → 光点被 (1−grow) 压暗甚至不可见。
        vv.grow = 0;
        // [v47] 逐舰显示航向 visHeading 为真源（2D 层每舰物理朝向）；缺失回退舰队朝向（旧帧）
        // ⚠ 光点层仅 1~2px，"朝向"不可辨 ⇒ 补给舰的定向兜底只做在第三遍（实体层，见下方 v96）。
        const _faU = (typeof u.visHeading === 'number' ? u.visHeading : fa);
        vv.yaw = Math.atan2(-Math.cos(_faU), Math.sin(_faU));
      }
    }

    // ── 第一遍 · 运输舰（v8 **独立通道**：不隶属任何舰队）───────────────────────
    //   数据源 = BattleScene 的 `auxShips`（每艘只有 `unit / factionId / x / y / heading`）；
    //   位置/朝向**直接取 aux 自身**，不经过「舰队阵位」「u.sprite 借位」「舰队朝向兜底」任何一路：
    //     · px 由**相机到它自己**的距离算 ⇒ `fleetPx`（宿主只有它一个成员）= 自身 px；
    //       相机贴脸时 px 必然越过 lodKeep ⇒ **必定建实体**（旧实现用母队 px 均值 ⇒ 独航时被误判为远）。
    //     · 宿主对象只承担 unitVis 管线的"承载"，托盘/名牌/高度档/门/拾取都按 `_isAux` 跳过。
    //   迷雾权威仍是 `u.sprite.visible`（BattleScene 按运输舰自身坐标写）——此处只消费，不自行判断。
    const auxList: any[] = (bs as any).auxShips || [];
    for (const aux of auxList) {
      const au = aux?.unit;
      if (!au || !au.sprite || au.sprite.visible === false || au.hp <= 0) continue;
      if (typeof aux.x !== 'number' || typeof aux.y !== 'number') continue;
      const host = this.auxHostOf(au, aux);
      const akey = `${host.factionId}:${au.sprite._b3dKey || (au.sprite._b3dKey = Math.random().toString(36).slice(2))}`;
      const ashipLen = this.shipLenOf(au, host);
      const ashipW = this.shipWOf(au, host);
      const ah = this.heightAtPx(aux.x, aux.y);
      // 运输舰不吃"队内分层 / 队间高度档"（它没有阵位、没有编队层）—— 只吃地形高 + 巡航余量。
      const ay = ah + this.cruiseClearance;
      const apx = this.pxOf(this.visTmpV.set(aux.x, ay, -aux.y), ashipLen);
      this.visTmpV.project(this.camera);
      const asx = (this.visTmpV.x * 0.5 + 0.5) * this.renderer.domElement.width;
      const asy = (0.5 - this.visTmpV.y * 0.5) * this.renderer.domElement.height;
      let avv = vis.get(akey);
      if (!avv) {
        avv = { key: akey, u: au, fleet: host, x: 0, y: 0, z: 0, h: 0, seen: true, px: 0, sx: 0, sy: 0, shipLen: 0, shipW: 0, grow: 0, yaw: 0, fleetPx: 0 };
        vis.set(akey, avv);
      }
      // ⚠ **不登记入场状态**：入场裁剪/门是「舰队级」特效（一队一门），运输舰没有舰队，
      //   硬塞进某支舰队的门会重新把它绑回编队。它按自身 px 直接出现在 LOD 档上。
      avv.u = au; avv.fleet = host; avv.seen = true;
      avv.x = aux.x; avv.y = ay; avv.z = -aux.y;
      avv.h = ah; avv.px = apx; avv.sx = asx; avv.sy = asy;
      avv.shipLen = ashipLen; avv.shipW = ashipW;
      avv.grow = 0;
      // ★ **自身 px**（不是舰队均值）：LOD 的唯一判据（见 auxLod.ts 的三条契约）
      avv.fleetPx = auxLodPx(apx);
      const ahd = (typeof aux.heading === 'number' && Number.isFinite(aux.heading)) ? aux.heading : 0;
      avv.yaw = Math.atan2(-Math.cos(ahd), Math.sin(ahd));
    }

    // [v12.2 R1] 清掉本帧未再出现的陈旧条目（阵亡 / 撤场）—— 就地更新的"垃圾回收"。
    // 放在第一遍之后、第二遍之前：二/三遍与后续各消费者见到的都只剩本帧存活单位，语义与旧 clear()+重建一致。
    for (const [k, vv2] of vis) { if (!vv2.seen) vis.delete(k); }

    // ── [v75] 舰队级 LOD：算每舰队的代表 px（成员均值）并回填 ──────────────
    //   用户实报「近景的状态下同一个舰队看到的点+模型」—— 逐舰判定时，
    //   同队内近处舰拿到实体、远处舰保持光点 ⇒ 视觉上"点模混合"。
    //   改为**整队统一**：用舰队成员 px 均值做一次判定 ⇒ 要么全模型、要么全点。
    //   ⚠ 用均值而非 max：max 会让"有一艘特别近"就整队变模型（远处舰模型过小）;
    //     均值代表"这支舰队的典型视觉尺寸"，与"舰队是一个整体"的感知一致。
    //   ⚠ 同一舰队的所有成员在空间上聚集（阵型间距 ≪ 相机距离），
    //     故成员 px 本就接近，均值不会掩盖真实差异。
    {
      const acc = new Map<any, { sum: number; n: number }>();
      for (const v of vis.values()) {
        // 运输舰不参与舰队均值：它的 `fleetPx` 已在第一遍写成**自身 px**（相机到它自己的距离）
        if ((v.fleet as any)?._isAux) continue;
        let a = acc.get(v.fleet);
        if (!a) { a = { sum: 0, n: 0 }; acc.set(v.fleet, a); }
        a.sum += v.px; a.n += 1;
      }
      for (const v of vis.values()) {
        const a = acc.get(v.fleet);
        v.fleetPx = a && a.n > 0 ? a.sum / a.n : v.px;
      }
    }

    // ── 第二遍：实体池（MESH_KEEP/MESH_DROP 滞回，按 px 降序取前 MAX_MESHES）──
    const cand: UnitVis[] = [];
    // [v12.1 C2] 本帧**回收预算共享**：滞回回收（下阈值）与超预算回收（上阈值以上被挤出）
    // 合计 ≤ MESH_DROP_PER_FRAME/帧，避免快速拉远时一帧 dispose 数百实体造成尖峰。
    // 本帧未回收者下帧继续判定（px 阈值仍成立），只是延后回收，观感无差。
    let dropped = 0;
    for (const v of vis.values()) {
      // [切片传送入场] P1：远景档 `lodKeep = 999` ⇒ 无实体可切。入场期**临时强制建实体**
      //   （否则"切片传送"在雷达视角下完全看不见）；入场结束自然落回原 LOD（`lodDrop` 999 ⇒ 逐帧回收）。
      const entryActive = this.entryActiveOf(v.key);
      // ★ v8 运输舰走**自身 px** 的独立判定（共享实现见 three/auxLod.ts，台架真跑同一函数）
      if ((v.fleet as any)?._isAux) {
        const verdict = auxLodVerdict({
          selfPx: v.fleetPx, hasMesh: this.ships.has(v.key),
          lodKeep: this.lodKeep, lodDrop: this.lodDrop, entryActive,
        });
        if (verdict === 'mesh') cand.push(v);
        else if (verdict === 'drop' && dropped < MESH_DROP_PER_FRAME) { this.dropMesh(v.key); dropped++; }
        continue;
      }
      if (this.ships.has(v.key)) {
        // 已持实体：低于滞回下阈才归还（滞回避免相机推拉时每帧 buildShip/dispose 造成卡顿）
        if (v.fleetPx >= this.lodDrop || entryActive) cand.push(v);
        else if (dropped < MESH_DROP_PER_FRAME) { this.dropMesh(v.key); dropped++; }
      } else if (v.fleetPx >= this.lodKeep || entryActive) {
        cand.push(v);
      }
    }
    // 入场中的舰排在最前 ⇒ 实体预算被挤时**优先保住入场波次**（否则切片只演一半）
    cand.sort((a, b) => {
      const ea = this.entryActiveOf(a.key) ? 1 : 0;
      const eb = this.entryActiveOf(b.key) ? 1 : 0;
      return ea !== eb ? eb - ea : b.fleetPx - a.fleetPx;
    });
    // [WS7] 预算 = 开 governor 时随帧时自适应收缩，否则恒 = MAX_MESHES（与改动前逐位同行为）。
    // 被预算挤出的舰**不销毁光点**：writeDotLayers 对全部 unitVis 写点，故它们自然退回中景光点层。
    const budget = this.perfOn ? this.lastStats.meshBudget : MAX_MESHES;
    const keep = Math.min(cand.length, budget);
    // [v12.1 C2] 每帧建/销限流。未获实体者**仍由光点层接住**（writeDotLayers 覆盖全部 unitVis），
    // 故限流只是把"实体长出的时机"摊到后续帧，不会造成"隐形洞"；下一帧继续补直到达到 budget。
    let added = 0;
    for (let i = 0; i < keep; i++) {
      if (!this.ships.has(cand[i].key)) {
        if (added >= MESH_ADD_PER_FRAME) continue;
        this.addMesh(cand[i]);
        added++;
      }
    }
    for (let i = keep; i < cand.length; i++) {
      if (this.ships.has(cand[i].key)) {
        if (dropped >= MESH_DROP_PER_FRAME) continue;
        this.dropMesh(cand[i].key);
        dropped++;
      }
    }
    this.lastStats.elig = cand.length;
    // [v12.1 C2] 报**实际**持实体数：限流/分帧迁移下可与预算 keep 短暂不等（稳态时两者相等）
    this.lastStats.kept = this.ships.size;
    // ── [v79] 诊断收集（`?debug=1` 时显示；未开启零开销）──────────────────
    //   用户实报「同一条线上前半是点、后半是模型」⇒ 需数据判断是
    //   「多支 fleet 视觉相邻」（正常现象）还是「同一 fleet 内 px 分裂」（真 bug）。
    //   位置：第二遍实体分配**之后**，此时 ships 已定，mesh 计数才准确。
    {
      const byFleet = new Map<any, { n: number; mesh: number; px: number }>();
      for (const v of vis.values()) {
        let r = byFleet.get(v.fleet);
        if (!r) { r = { n: 0, mesh: 0, px: v.fleetPx }; byFleet.set(v.fleet, r); }
        r.n += 1; r.px = v.fleetPx;
        if (this.ships.has(v.key)) r.mesh += 1;
      }
      const rows: { id: string; n: number; px: number; mesh: number }[] = [];
      for (const [f, r] of byFleet) {
        const ff: any = f;
        rows.push({ id: String(ff?.id ?? ff?.factionId ?? '?'), n: r.n, px: r.px, mesh: r.mesh });
      }
      rows.sort((a, b) => b.n - a.n);
      this.updateDebugPanel(rows);
    }
    // 【性能】实体负载 + 帧时压力 → 模型档位（见 autoLodByLoad 的量化依据）
    this.autoLodByLoad(keep, dt);

    // ── 第三遍：实体位置/朝向/长大 + 受创外观 + 待换装模型 ──
    for (const v of vis.values()) {
      const entry = this.ships.get(v.key);
      if (!entry) continue;
      const u = v.u;
      const fleet = v.fleet;

      if (entry.pendingModel && entry.pendingModel.geo && entry.pendingModel.version !== entry.modelVer) {
        // GLB 模型晚于舰船生成才就绪 → 原地换装（任意舰种通用）
        const pending = entry.pendingModel;
        this.shipGroup.remove(entry.group);
        entry.group.traverse((o) => {
          const m = o as any;
          if (!m.isMesh && !m.isLineSegments) return;
          // 模型几何为同型舰共享（已打 __b3dShared 标），不可销毁；仅释放兜底造型的私有资源
          const mg = m.geometry as THREE.BufferGeometry | undefined;
          if (mg && !(mg as any).__b3dShared) mg.dispose();
          const mat = m.material as THREE.Material;
          if (Array.isArray(mat)) mat.forEach((mm: THREE.Material) => mm.dispose()); else mat.dispose();
        });
        const built = this.buildShip(String(u.classType || 'destroyer'),
          factionColor(this.getFac(u.factionId) || {}), this.isEmpireSideOf(u), entry.flagshipKey);
        entry.group = built.group;
        entry.pendingModel = built.pendingModel;
        entry.modelVer = built.modelVer ?? 0;
        entry.baseScale = built.group.scale.x || 1;
        entry.meshT = MESH_GROW_DUR;   // 换装是"已长成"的舰，不重播长出动画
        // 【旗舰方案】换装会连同旧 group 一起丢掉光环 → 这里补回
        entry.cmdRing = entry.isFlagship
          ? this.attachFlagshipFx(built.group, factionColor(this.getFac(u.factionId) || {}), this.shipLenOf(u, fleet))
          : undefined;
        this.shipGroup.add(built.group);
        // [切片传送入场] 换装丢掉了旧 group 的材质 ⇒ 裁剪引用必须重建（否则指向已 dispose 的材质），
        //   仍处入场期就补挂到新材质上（从当前进度续切，不重播）。
        entry.sliceMats = undefined;
        entry.entryPlanes = undefined;
        const swapSt = this.entryFxActive ? this.entryStates.get(v.key) : undefined;
        const swapGate = swapSt && !swapSt.done ? this.fleetGates.get(entry.fleet) : undefined;
        // [v3.1 · S] 球体方案不挂裁剪 ⇒ 换装时同样不补挂（缩放淡入与材质无关）。
        if (swapGate && !swapGate.done && this.gateStyle !== 'S') {
          // [v2] 复用**本队门的同一组 5 个平面实例**（不新建 ⇒ 同队共享、一次更新全队生效）
          entry.entryPlanes = swapGate.planes;
          entry.sliceMats = this.collectSliceMats(built.group);
          entryApplyClipping(entry.sliceMats, entry.entryPlanes, true);
          entry.meshT = MESH_GROW_DUR;   // P3：入场期不叠加"长出"
        }
        void pending;
      }

      const g = entry.group;
      // [v12.2 R1] 复用第一遍算出的地形基准高度（同帧同一 sprite 坐标 ⇒ 同值，语义等价），
      // 原先此处对同一坐标重算一次 heightAtPx ⇒ 每帧调用数减半（720 单位：1440 → 720 次）。
      const h = v.h;
      // 位置：地形高度 + 巡航余量，指数平滑；再用硬性最小离地兜底防穿模。
      // 旧实现 clearance 太小（0.28√3R ≈ 0.49R），地形起伏 2.2R，战舰明显贴地爬坡。
      // 层高由第一遍写进 v.y（= h + cruiseClearance + layY）—— 直接继承，不重算层偏移，
      // 保证点层/实体层单一真源；下面的 entry.cruiseY 指数平滑负责换阵时的插值过渡。
      const targetY = v.y;
      if (entry.cruiseY === 0) entry.cruiseY = targetY;
      // [WS6] 纵向过渡时间常数 = FORM_ANIM_TAU（= FORM_ANIM_SEC/3 = 0.133s ⇒ 0.4s 收敛 ~95%），
      // 与平面换阵迁移（BattleScene 的阻尼 lerp，约 0.4s）同步 —— 换阵/换档时"重新分层"是插值而非瞬跳。
      entry.cruiseY += (targetY - entry.cruiseY) * (1 - Math.exp(-dt / FORM_ANIM_TAU));
      let y = Math.max(entry.cruiseY, h + this.minClearance);
      // ★ v8 运输舰：位置**直接取 aux 自身坐标**（不经 sprite 中转，更不经过任何舰队）；
      //   战斗舰维持原通道（sprite 是 2D 物理真源）。
      const _isAux = !!(fleet as any)?._isAux;
      const _aux = _isAux ? (fleet as any).aux : null;
      let x = _aux ? _aux.x : u.sprite.x;
      let z = _aux ? -_aux.y : -u.sprite.y;

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
        if (!cap.shipKeys.includes(v.key)) continue;
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

      // 朝向（v14 ③2 + ④，[R10-B1] 改）：
      //  · **权威 = 舰队朝向**。2D 层已按战术语义定死（进攻 = 朝目标、撤退 = 朝敌边打边退、
      //    接战时锁定敌军），并由 BattleScene 的 `facingSmooth` 按「帧 × dt」限速平滑。
      //    旧实现"位移向量优先" ⇒ 撤退时舰首朝后移动方向 = **把船尾给敌人**（用户实报）；
      //    位移向量自此**仅作兜底**（facingSmooth / facingAngle 均缺失时）。
      //  · [R10-B1] **不再在 3D 侧二次限速**：`facingSmooth` 已由 2D 层限速 ⇒ 此处直接采用，
      //    与速度倍率天然同步（倍率 ≠1 时不会再次错位 —— 闭环 R1 §5 U4）。原 `approachAngle(…,
      //    SHIP_TURN_RATE * dt)` 用的是**真实秒** dt，与 2D 的「帧 × dt(倍率)」不同基准 ⇒ 两次限速叠加。
      //  · 仅"无朝向"兜底分支保留角速度限速（防御性：该分支实际不可达，面向噪声移动向量）。
      //  舰首局部 -z，rotation.y=θ 后鼻向 = (-sinθ, -cosθ)；像素 forward=(cos fa, sin fa) → 世界 (cos fa, -sin fa)
      let targetYaw: number;
      // [v47] 真源 = 逐舰 visHeading（2D 层限速后的物理航迹朝向）；缺失回退舰队朝向
      const _vh = (u as any).visHeading;
      // ★ v8 运输舰：舰首真源 = `aux.heading`（moveAuxShips 里"位移由舰首消费" ⇒ 航迹与舰首同源）。
      //   它**没有舰队可回退**（host.facingSmooth 也只是 aux.heading 的镜像），故此处直接取 aux。
      const fa = _isAux
        ? (Number.isFinite((_aux as any)?.heading) ? (_aux as any).heading : 0)
        : (typeof _vh === 'number' ? _vh : (fleet.facingSmooth ?? fleet.facingAngle));
      const hasFacing = (typeof fa === 'number' && Number.isFinite(fa));
      // 本帧位移（世界 XZ）：像素 (dx,dy) → 世界 (dx,-dy)。仅作"无朝向"兜底。
      const mvX = x - entry.lastX;
      const mvZ = z - entry.lastZ;
      const moving = mvX * mvX + mvZ * mvZ > 0.01;
      if (hasFacing) {
        targetYaw = Math.atan2(-Math.cos(fa), Math.sin(fa));
      } else {
        // 兜底：无朝向时退回"移动向量优先"（保持旧语义，静止则维持当前朝向）
        targetYaw = moving ? Math.atan2(-mvX, -mvZ) : entry.yaw;
      }
      entry.yaw = hasFacing ? targetYaw : approachAngle(entry.yaw, targetYaw, SHIP_TURN_RATE * dt);
      g.rotation.y = entry.yaw;
      entry.lastX = x;
      entry.lastZ = z;

      // HP < 50%：受创色 + 火焰点变红放大
      const hpPct = u.maxHp > 0 ? u.hp / u.maxHp : 1;
      const damaged = hpPct < 0.5;
      // [v14 ①] 尾焰改为**顶点色渐变锥**（底白黄→尖深红）⇒ 未受创时 color 必须为 0xffffff
      //（vertexColors 与 material.color 相乘，白=不改色相，保留金红渐变）；受创时染红。

      // 实体长出：MESH_GROW_DUR 秒内从 0.25 长到基准缩放（与光点/光晕淡出同步）。
      // 销毁保持瞬时、不加淡出——交班给光点/光晕两层接力，两级反向淡出即可无缝。
      entry.meshT = Math.min(MESH_GROW_DUR, entry.meshT + dt);
      const gt = entry.meshT / MESH_GROW_DUR;
      const ge = gt * gt * (3 - 2 * gt);
      // ── [v92] **模型最小屏幕尺寸下限** ────────────────────────────────────
      //   用户实报：「莱茵哈特的模型齐整，席特尼就是空空荡荡，但舰队数都是 20000」
      //   诊断面板显示**所有舰队 mesh≈n（模型都建了）**，但 px 差异巨大：
      //     席特尼 px=6.5 / 7.5 ⇒ 模型投影仅 6~7px ⇒ **肉眼几乎不可见** ⇒ 读作"空荡"
      //     莱茵哈特 px=21.9 / 27.5 ⇒ 模型明显
      //   ⇒ 根因是**透视**（`px ∝ 1/距离`），不是漏渲染。
      //   修复：px 低于 `MIN_MESH_PX` 时按比例放大模型，使远处舰队"看得见"。
      //   ⚠ 这会部分削弱"远小近大"的透视层次（用户明确要"看得见"优先）；
      //     下限值可调：调大 ⇒ 远处更醒目但透视更弱。
      const _minK = (v.px > 0.1 && v.px < MIN_MESH_PX) ? (MIN_MESH_PX / v.px) : 1;
      // ── [v3.1 · S] **舰队"在球里出现"**：逐舰**径向错开的缩放淡入**（0 → 1）──────────
      //   复用既有 `entryStates`（进度绑"入场事件"）⇒ 推拉镜头不重播；A/B/C 与常规期恒为 1。
      //   开战瞬间先"吸进球里"（1 → 0，`SPHERE_ABSORB_SEC`），球体完整期再"由内向外浮现"。
      let revealK = 1;
      if (this.gateStyle === 'S') {
        revealK = this.entryRevealScale(v.key, now);
        // 缩放淡入到几乎不可见时直接不画（省掉一次退化矩阵；`visible` 在别处无人写 ⇒ 无冲突）
        g.visible = revealK > 0.004;
      }
      g.scale.setScalar(entry.baseScale * (0.25 + 0.75 * ge) * _minK * revealK);

      // 【旗舰方案】指挥光环慢转（只在实体档可见；不额外建对象，纯改 rotation）
      if (entry.cmdRing) entry.cmdRing.rotation.z += dt * FLAGSHIP_RING_SPIN;

      // 回写可见性：billboard 质心用实体实际位；grow 由 meshOn 决定（三层淡化同源）
      v.x = x; v.y = y; v.z = z;
      v.yaw = g.rotation.y;
      // [v75] 用 fleetPx（舰队代表）⇒ 整队同步长出/淡出，同队不会一半模型一半点
      // [切片传送入场] 入场期强制 grow = 1：实体"已在场"，**光点让位**（否则远景强制建实体时
      //   会同时画出"点 + 半切舰"，正是 v79~v81 反复修掉的"点模共存"观感）。
      // ★ v8 运输舰：`fleetPx` 已是**自身 px**（宿主只有它自己），grow 走同一口径的共享实现。
      v.grow = this.entryActiveOf(v.key)
        ? 1
        : (_isAux ? auxGrowK(v.fleetPx, this.lodLo, this.lodHi) : sstep(this.lodLo, this.lodHi, v.fleetPx));
      // [任务3] 舰首标记随 LOD `grow` 同步淡入淡出（与光点/光晕/实体淡化同源）——
      //   否则中景下"舰体线框已淡出、箭标还亮着"就是本工程反复修过的"无主体特效"。
      if (entry.bowMarker) {
        const ud = entry.bowMarker.userData as any;
        if (ud.markLineMat) ud.markLineMat.opacity = 0.95 * v.grow;
        if (ud.markTriMat) ud.markTriMat.opacity = 0.55 * v.grow;
      }
      // [v83] **引擎特效随 LOD `grow` 同步淡入**（用户实报「金色尾焰，只有尾焰没有舰船」）。
      //   根因：舰体是**线条化渲染**（Line），缩小时线宽变细直至不可见；
      //     而 `glow`（引擎暖晕，`color=0xffcc66` 琥珀金）是**面片 + AdditiveBlending**
      //     ⇒ 不随实体缩小而消失 ⇒ 中等距离下"线框已看不见、glow 还亮着"
      //     ⇒ 用户看到的就是那些**孤立金色竖条**。

    }

    // 销毁已死 unit 的实体（生命结束才销毁；低于滞回下阈的已在第二遍归还）
    this.ships.forEach((entry, key) => {
      // [v12.2 R1] 存活判据改用 unitVis（第一遍已删净 !seen 的陈旧条目 ⇒ 表内即本帧存活集），
      // 取代旧的一帧一建 `alive` Set（少一处每帧分配）。
      if (vis.has(key)) return;
      this.disposeShipGroup(entry.group);
      this.ships.delete(key);
    });

    // ── 第四遍：写光点层与光晕层缓冲 ──
    this.writeDotLayers();

    // ── 第五遍：写阵型标记层（数据源 unitVis，与光点层同帧、同源）──
    this.writeFleetMarks();

    // 尾焰预热：新授予实体的舰在 updateFlames 里有条目，此处无需额外处理
  }

  /**
   * 【旗舰方案】给一艘已建好的舰挂"指挥标识"：**仅水平细环**（v12 移除原竖直柱——用户实报"旗舰上
   * 那道竖柱太丑了"，且圆环已足够标示旗舰身份；删除创建即无残留，`disposeShipGroup` 照常遍历释放子对象）。
   *
   * 为什么挂在 ship group 下：group 每帧被同步位置/朝向/缩放，子对象自动跟随，
   * 不需要为旗舰单开一条每帧通道（少一处状态、少一处不同步的可能）。
   * ⚠ 尺寸必须换算成**局部单位**：世界尺寸 ÷ group.scale。
   * ⚠ 几何/材质**每旗舰一份**（非共享单例）：`disposeShipGroup` 会遍历释放子对象，
   *   共享单例会被第一艘旗舰的销毁连带释放，其余旗舰的光环就消失了。每场至多 8~16 艘，代价可忽略。
   */
  private attachFlagshipFx(group: THREE.Group, color: number, shipLen: number): THREE.Mesh {
    const bs = group.scale.x || 1;
    const r = (shipLen * FLAGSHIP_RING_K) / bs;
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex(),
      transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.90, r, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    group.add(ring);
    return ring;
  }

  // ════════════════════════════════════════════════════════════════════════
  // [切片传送入场] 家园2 式 hyperspace entry（纯视觉；不参与任何战斗数值）
  // ════════════════════════════════════════════════════════════════════════

  /** 是否启用了切片入场：编译期常量 + 运行时一键关闭 `window.__entryFxEnabled = false`
   *  + [v4] 设置项关闭（`entryFxStyle === 'off'` ⇒ 完全跳过入场特效，不建对象/不聚焦）。 */
  private entryFxOn(): boolean {
    if (!SLICE_ENTRY_ENABLED_DEFAULT) return false;
    const w: any = (typeof window !== 'undefined') ? window : undefined;
    return !(w && w.__entryFxEnabled === false) && !this.entryFxOff;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // [v3] 门**外观**：三方案共用几何/裁剪/时序，只换"框 / 位面 / 辉光"的画法。
  //   观感目标（用户 2026-10-16 二次反馈：v2「太丑、像纸板」）：
  //     · 亮心（近白细线）→ 边缘（青/蓝紫）→ 外辉光（低饱和、**柔边**）三层亮度；
  //     · 门内位面**高度透明**（透过它要能看清后面的舰船）；
  //     · 尺寸贴合（矩形门紧贴舰队轮廓，不再"竖向空一大半"）。
  //   ⚠ 本组对象**自己不挂 `clippingPlanes`** ⇒ 不会被自己的门切（与舰体材质完全解耦）。
  // ──────────────────────────────────────────────────────────────────────────

  /** [v3] 门框**切角矩形**轮廓（局部 [-1,1]，逆时针 CCW）。`ch` = 切角比例 0..0.5。 */
  private gateFramePoints(ch: number): [number, number][] {
    const c = Math.min(0.48, Math.max(0, ch));
    if (c <= 1e-6) return [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return [
      [-1 + c, -1], [1 - c, -1], [1, -1 + c], [1, 1 - c],
      [1 - c, 1], [-1 + c, 1], [-1, 1 - c], [-1, -1 + c],
    ];
  }

  /**
   * [v3] 由闭合轮廓生成**环带**面片（局部 XY 平面）：沿轮廓法线偏移 `a`→`b` 之间的四边形带。
   * 每条边各出一个四边形 ⇒ 均匀宽度（顶点级斜接不必做，边缘处轻微重叠由加法混合自然融合）。
   * `outward = true` ⇒ 向**外**扩（做粗边/外辉光）；否则向**内**缩（做内侧羽化/厚度）。
   */
  private gateBandGeometry(pts: [number, number][], a: number, b: number, outward = false): THREE.BufferGeometry {
    const n = pts.length;
    const s = outward ? -1 : 1;
    const pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % n];
      const ex = bx - ax, ey = by - ay;
      const len = Math.hypot(ex, ey) || 1;
      // CCW 轮廓的内法线 = 边方向左旋 90° = (−ey, ex)/len
      const nx = (-ey / len) * s, ny = (ex / len) * s;
      const ax2 = ax + nx * a, ay2 = ay + ny * a;
      const bx2 = bx + nx * a, by2 = by + ny * a;
      const cx2 = bx + nx * b, cy2 = by + ny * b;
      const dx2 = ax + nx * b, dy2 = ay + ny * b;
      pos.push(ax, ay, 0, bx, by, 0, cx2, cy2, 0);
      pos.push(ax, ay, 0, cx2, cy2, 0, dx2, dy2, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  }

  /** [v3] 轮廓点 → LineLoop 几何（锐利细亮线；WebGL 线宽不可调 ⇒ "粗"一律走环带面片）。 */
  private gateLoopGeometry(pts: [number, number][], z = 0): THREE.BufferGeometry {
    const pos: number[] = [];
    for (const [x, y] of pts) pos.push(x, y, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  }

  /** [v3] 柔边矩形**外辉光**贴图：边框处最亮、向外柔和衰减、**中心透明** ⇒ 不会冲淡舰船。 */
  private makeGateHaloTexture(color: number): THREE.CanvasTexture {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, S, S);
      ctx.strokeStyle = '#' + (color >>> 0).toString(16).padStart(6, '0');
      ctx.lineJoin = 'round';
      // 由内向外多层叠加：近框处亮而细，越外越粗越淡 ⇒ 无硬直边。
      // ⚠ 必须**紧贴门框**（太宽会糊成一条灰带 —— 实测取证修正）。
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        ctx.globalAlpha = 0.20 * (1 - t) + 0.015;
        ctx.lineWidth = 2 + 11 * t;
        const inset = 17 - 11 * t;
        ctx.beginPath();
        ctx.rect(inset, inset, S - inset * 2, S - inset * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  /** [v3] 门**位面**纹路贴图（极淡）：A 竖向细纹 / B 水平扫描线 / C 噪点星尘（均可纵向滚动）。 */
  private makeGateBarrierTexture(style: GateStyleId, density: number): THREE.CanvasTexture {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      const den = Math.max(1, density);
      if (style === 'B') {
        const step = Math.max(2, Math.round(S / den));
        for (let y = 0; y < S; y += step) {
          ctx.globalAlpha = 0.45 + 0.5 * Math.random();
          ctx.fillRect(0, y, S, 1);
        }
      } else if (style === 'C') {
        const count = Math.round(den * 6);
        for (let i = 0; i < count; i++) {
          ctx.globalAlpha = 0.2 + 0.8 * Math.random();
          const r = Math.random() < 0.88 ? 1 : 2;
          ctx.fillRect(Math.random() * S, Math.random() * S, r, r);
        }
      } else {
        const step = Math.max(2, Math.round(S / den));
        ctx.lineWidth = 1;
        ctx.setLineDash([9, 17]);   // 竖向虚线 ⇒ 纵向滚动才看得出"流动"
        for (let x = 0; x < S; x += step) {
          ctx.globalAlpha = 0.3 + 0.55 * Math.random();
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * [v3 · N8] 建**可见的门本体** —— 三方案（`GATE_STYLE`）共用一套骨架：
   *   门框（sharp 线 / 环带）+ 柔边外辉光 + 极淡流动位面。
   * ★ 这是 v1 最大的缺失（裁剪完全不可见 ⇒ "加载效果白做了"）；v2 又做成了挡视线的实心板。
   * 姿态一次算定（`makeBasis(right, up, fwd)` ⇒ 局部 X/Y/Z 映射到 横向/竖直/朝向）；
   * 逐帧只改 `position`（随推进面移动）+ 材质不透明度（辉光包络 / 呼吸脉冲）。
   * 门框是**矩形**（`halfU/halfV` 分轴缩放）⇒ 紧贴舰队投影轮廓。
   */
  private buildGateVisual(g: FleetGate): void {
    if (!ENTRY_GATE_VISIBLE) return;
    const P = GATE_STYLE_PARAMS[this.gateStyle];
    const root = new THREE.Group();
    // 右手正交基：right = (−sin, 0, −cos) 与 up / fwd 构成 det = +1（若取 (sin,0,cos) 会带反射 ⇒ 门框镜像）
    this.gateBasis.makeBasis(g.right, g.up, g.fwd);
    root.quaternion.setFromRotationMatrix(this.gateBasis);
    // 局部 X/Y → 横向/竖向（**分轴** ⇒ 矩形门）；Z 保持 1（门是薄位面，不再做"纸板盒"）
    root.scale.set(g.halfU, g.halfV, 1);
    root.frustumCulled = false;
    root.renderOrder = 8;

    const pts = this.gateFramePoints(P.chamfer);
    const addBand = (a: number, b: number, color: number, opacity: number, outward: boolean, z: number) => {
      const m = new THREE.Mesh(this.gateBandGeometry(pts, a, b, outward), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.position.z = z; m.renderOrder = 9;
      root.add(m);
    };
    const addLoop = (loopPts: [number, number][], color: number, opacity: number, z: number) => {
      const o = new THREE.LineLoop(this.gateLoopGeometry(loopPts, 0), new THREE.LineBasicMaterial({
        color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      o.position.z = z; o.renderOrder = 12;
      root.add(o);
    };

    if (P.shard) {
      // ── C · 量子碎门：轮廓被切成**不等长、带间隙**的短线段 ⇒ 碎片 / 不稳定感 ──
      let seed = 0x2f6e2b1;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const seg: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        let t = rnd() * 0.10;
        while (t < 1 - 1e-3) {
          const t1 = Math.min(1, t + 0.07 + 0.30 * rnd());
          seg.push(ax + (bx - ax) * t, ay + (by - ay) * t, 0,
            ax + (bx - ax) * t1, ay + (by - ay) * t1, 0);
          t = t1 + 0.10 + 0.42 * rnd();   // 间隙加大 ⇒ 碎片感（实测原间隙太小、看着还是连续线）
        }
      }
      const gs = new THREE.BufferGeometry();
      gs.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const shardLine = new THREE.LineSegments(gs, new THREE.LineBasicMaterial({
        color: P.core, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      shardLine.renderOrder = 12;
      root.add(shardLine);
      // 碎门外侧的极淡边缘色（把碎片"框"起来，读作门而不是散点）—— 必须**很淡**，否则又会连成一条实线
      addBand(0, P.edgeWidth * 1.6, P.edge, 0.09, true, -0.001);
    } else if (P.feather > 0) {
      // ── B · 光栅门：单条亮线 + 内侧**由亮到透**的羽化环带（光栅/渐隐） ──
      addLoop(pts, P.core, 0.9, 0.002);
      const n = 6;
      for (let k = 0; k < n; k++) {
        const a = (P.feather * k) / n;
        const b = (P.feather * (k + 1)) / n;
        addBand(a, b, P.edge, 0.14 * (1 - k / n), false, 0.001);
      }
    } else {
      // ── A · 能量环门：**双层细线**（外线稍暗稍粗 + 内线亮白细线）+ 八角切角 ──
      addBand(0, P.edgeWidth, P.edge, 0.5, true, 0);                     // 外线（稍暗、有厚度）
      addLoop(this.gateFramePoints(P.chamfer * 0.86), P.core, 0.95, 0.003); // 内线（亮白细线）
      // 四角（斜切边）短促装饰线：沿外法线向外挑一小段 ⇒ 科幻感细节
      const deco: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        const ex = bx - ax, ey = by - ay;
        if (Math.abs(ex) < 0.02 || Math.abs(ey) < 0.02) continue;   // 仅挑斜切边
        const len = Math.hypot(ex, ey) || 1;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const ox = ey / len, oy = -ex / len;                        // 外法线
        const mx2 = mx + ox * 0.13, my2 = my + oy * 0.13;
        deco.push(mx - ox * 0.02, my - oy * 0.02, 0, mx2, my2, 0);
      }
      const gd = new THREE.BufferGeometry();
      gd.setAttribute('position', new THREE.Float32BufferAttribute(deco, 3));
      const decoLine = new THREE.LineSegments(gd, new THREE.LineBasicMaterial({
        color: P.core, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      decoLine.renderOrder = 12;
      root.add(decoLine);
    }

    // 柔边**外辉光**（中心透明的环状贴图 ⇒ 亮框但不遮舰队；加法混合 ⇒ 无硬直边）
    // 面片 2.3 与贴图 inset 17/256 对齐 ⇒ 辉光带紧贴门框（≈0.10 半个门宽外），不糊成灰带。
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({
      map: this.makeGateHaloTexture(P.halo), color: 0xffffff, transparent: true,
      opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    halo.position.z = -0.002;
    halo.renderOrder = 7;
    root.add(halo);

    // 门内**位面**：极淡 + 纹路缓慢流动。**刻意很淡**（盖在舰队上 ⇒ 太亮会把舰体冲白）。
    const barrierTex = this.makeGateBarrierTexture(this.gateStyle, P.density);
    barrierTex.repeat.set(2.2, 1.5);
    const barrier = new THREE.Mesh(new THREE.PlaneGeometry(1.98, 1.98), new THREE.MeshBasicMaterial({
      map: barrierTex, color: P.halo, transparent: true, opacity: P.barrierOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    barrier.position.z = -0.004;
    barrier.renderOrder = 6;
    root.add(barrier);
    g.barrierTex = barrierTex;

    // 统一登记**基础不透明度**：placeGateVisual 逐帧在此之上叠加"辉光包络 × 呼吸脉冲"。
    root.traverse((o) => {
      const mm = (o as any).material as THREE.Material | THREE.Material[] | undefined;
      if (!mm) return;
      const arr = Array.isArray(mm) ? mm : [mm];
      for (const one of arr) {
        if (typeof (one as any).opacity === 'number') (one as any).userData.baseOpacity = (one as any).opacity;
      }
    });

    this.scene.add(root);
    g.vis = root;
  }

  /** 门本体的世界中心 = `fwd·pos + right·cu + up·cv`（与 5 个裁剪面的可见域**严格同源**）。 */
  private gateWorldCenter(g: FleetGate, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      g.fwd.x * g.pos + g.right.x * g.cu + g.up.x * g.cv,
      g.fwd.y * g.pos + g.right.y * g.cu + g.up.y * g.cv,
      g.fwd.z * g.pos + g.right.z * g.cu + g.up.z * g.cv,
    );
  }

  /** [v3] 逐帧把门本体摆到推进面处 + **辉光包络 / 呼吸脉冲** + 位面纹路**滚动**。 */
  private placeGateVisual(g: FleetGate): void {
    if (!g.vis) return;
    g.vis.position.copy(this.gateWorldCenter(g, this.visTmpV));
    const P = GATE_STYLE_PARAMS[this.gateStyle];
    const glow = entryGlowAmt(g.p);
    // 呼吸脉冲：p 走完一圈做 4 次轻微起伏（`pulse = 0` ⇒ 恒定）
    const breathe = 1 - P.pulse * 0.5 + P.pulse * 0.5 * Math.sin(g.p * Math.PI * 8);
    const k = (0.4 + 0.6 * glow) * breathe;
    g.vis.traverse((o) => {
      const mm = (o as any).material as THREE.Material | THREE.Material[] | undefined;
      if (!mm) return;
      const arr = Array.isArray(mm) ? mm : [mm];
      for (const one of arr) {
        const base = (one as any).userData ? (one as any).userData.baseOpacity : undefined;
        if (typeof base === 'number') (one as any).opacity = base * k;
      }
    });
    if (g.barrierTex) {
      // 位面纹路"流动"：offset 随进度滚动（wrapping ⇒ 无缝循环）
      g.barrierTex.offset.set((g.p * P.flow * 0.35) % 1, (g.p * P.flow) % 1);
    }
  }

  /** [v3] 销毁门本体（遍历根组：几何/材质都显式 dispose，防泄漏）。 */
  private disposeGateVisual(g: FleetGate): void {
    const root = g.vis;
    if (root) {
      this.scene.remove(root);
      root.traverse((o) => {
        const geo = (o as any).geometry as THREE.BufferGeometry | undefined;
        if (geo) geo.dispose();
        const mm = (o as any).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((one) => one.dispose()); else if (mm) mm.dispose();
      });
    }
    g.vis = null;
    g.barrierTex = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // [v3.1 · S] **六边形球体组装 / 消散**入场（`GATE_STYLE = 'S'`）
  //
  //   用户需求：「一个圆球，用**六边形拼接**……从零开始随机组装拼接，组成一个圆球，然后**随机消散**……
  //   就是**一个圆包裹，显示组成，然后消散，舰队就在里面出现**」。
  //
  //   几何/运动学真源在 `./entrySphere`（纯函数、零 three 依赖 ⇒ 台架真跑）；本区块只负责
  //   "把纯函数的输出写进 three 对象"：
  //     · 视觉三层（**优先级**）：色散镶边（红/蓝双层沿法线微偏移 + 加法混合）> 亮白核心 > 紫辉光
  //     · 每块瓦片 = 1 个 `Group`（承载位姿）+ **3 个 Mesh**（主色 / 色散 A / 色散 B，共享 1 份几何）
  //     · 几何**只在入场开始时生成一次**；动画期间只改 `position / quaternion / opacity`
  //     · 结束**必须完整 dispose**（`disposeTree`：几何 + 材质 + 贴图）—— 红队重点检查项
  //   ⚠ S 方案**不把裁剪平面挂到舰体**（见 `attachEntryClippingTo`）⇒ "舰队在球里出现"由
  //     `entryRevealScale`（逐舰径向错开的缩放淡入）驱动 ⇒ 结束**没有裁剪需要拆除**。
  // ══════════════════════════════════════════════════════════════════════════

  /** [S] 亮白**核心球**的柔边贴图：中心最亮 → 向外柔和衰减（加法混合 ⇒ 无硬边）。 */
  private makeSphereCoreTexture(): THREE.CanvasTexture {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, S, S);
      const c = S / 2;
      // [v3.2] 中心**更大的过曝亮核**（充满球体的柔光），向外再渐变到**冷蓝紫**
      //   （复刻参考图 2 的"大块白核 → 蓝紫边缘"；亮核体积足够大 ⇒ 整球读作"发光能量球"）
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0.00, 'rgba(255,255,255,1)');
      g.addColorStop(0.20, 'rgba(250,253,255,0.92)');
      g.addColorStop(0.42, 'rgba(206,226,255,0.76)');
      g.addColorStop(0.62, 'rgba(172,178,255,0.62)');
      g.addColorStop(0.82, 'rgba(150,122,255,0.38)');
      g.addColorStop(1.00, 'rgba(120,95,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  /** [S] 外圈**紫色辉光**贴图：中心透明 → 在 `SPHERE_GLOW_R_K / SPHERE_GLOW_HALF_K` 处最亮 → 外侧柔和收掉。 */
  private makeSphereGlowTexture(color: number): THREE.CanvasTexture {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, S, S);
      const c = S / 2;
      const r = (color >> 16) & 255, gg = (color >> 8) & 255, b = color & 255;
      const rgba = (a: number): string => `rgba(${r},${gg},${b},${a})`;
      // 亮环在**面片内部**（≈0.68 半边长 = 1.15R）⇒ 环外还有柔边 ⇒ 读作"外圈辉光"而不是一条硬环
      const peak = SPHERE_GLOW_R_K / SPHERE_GLOW_HALF_K;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, rgba(0));
      g.addColorStop(Math.max(0, peak - 0.30), rgba(0.02));
      g.addColorStop(Math.max(0, peak - 0.09), rgba(0.20));
      g.addColorStop(peak, rgba(0.70));
      g.addColorStop(Math.min(1, peak + 0.09), rgba(0.22));
      g.addColorStop(Math.min(1, peak + 0.20), rgba(0.05));
      g.addColorStop(1, rgba(0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * [S] 由纯函数的 `SphereTile` 生成**一份** `BufferGeometry`（3 层网格共享它 ⇒ 见 `disposeTree` 的去重）。
   * 顶点 0 = 瓦片质心（局部原点），1..nv = 周长顶点（`verts − center`）⇒ 三角扇以质心为扇心。
   *
   * [v3.2] 额外写入**顶点色**：质心 = 1.0、周长顶点 = `SPHERE_TILE_EDGE_DIM`（配 `vertexColors` 材质）
   * ⇒ 每块瓦片**自己的中心最亮、边缘压暗**（"内部亮度"），读作自发光能量片而不是被均匀照亮的平板。
   */
  private sphereTileGeometry(tile: SphereTile): THREE.BufferGeometry {
    const nv = tile.nv;
    const cx = tile.center[0], cy = tile.center[1], cz = tile.center[2];
    const pos = new Float32Array((nv + 1) * 3);
    const col = new Float32Array((nv + 1) * 3);
    // 顶点 0 = 质心（局部原点）：最亮
    col[0] = 1; col[1] = 1; col[2] = 1;
    const dim = Math.max(0, Math.min(1, SPHERE_TILE_EDGE_DIM));
    for (let i = 0; i < nv; i++) {
      pos[(i + 1) * 3] = tile.verts[i * 3] - cx;
      pos[(i + 1) * 3 + 1] = tile.verts[i * 3 + 1] - cy;
      pos[(i + 1) * 3 + 2] = tile.verts[i * 3 + 2] - cz;
      // 周长顶点：压暗（瓦片内径向亮度衰减 ⇒ 内部亮度）
      col[(i + 1) * 3] = dim; col[(i + 1) * 3 + 1] = dim; col[(i + 1) * 3 + 2] = dim;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(tile.fan, 1));
    return geo;
  }

  /**
   * [S] **球体尺寸真源**：本舰队的包围球（球心 = 成员质心；半径 = `max(minR, (max距离+半长)×PAD)`）。
   * 读 `unitVis`（**全部存活单位**）而非 `ships`（只有实体的）⇒ 不受 `MESH_ADD_PER_FRAME` 分帧建实体影响。
   */
  private fleetSphereFit(fleet: any): SphereFit | null {
    const items: SphereFitItem[] = [];
    for (const v of this.unitVis.values()) {
      if (v.fleet !== fleet) continue;
      const L = v.shipLen > 0 ? v.shipLen : 4;
      items.push({ x: v.x, y: v.y, z: v.z, r: L * 0.5 });
    }
    return sphereBoundsFit(items, SPHERE_RADIUS_PAD, this.hexR * SPHERE_RADIUS_MIN_K);
  }

  /**
   * [v3.1 · S] 本帧"离相机最近的 N 支舰队"—— 只有它们建可见球体（性能上限）。
   *
   * 两条硬约束（都是真机实测踩出来的）：
   *   ① **按相机距离**（不是 `fleetPx`）：`fleetPx` 在入场首帧还是**聚焦前**的旧值 ⇒ 逐帧会漂移，
   *      "主力"中途易主 ⇒ 建出**第二个球**（实测出现过两个球叠在一起）。
   *   ② **一旦已有球体就锁定**：入场期相机静止 ⇒ 距离稳定；再加锁定是为了彻底杜绝中途漂移。
   * 按帧缓存（键 = `now` 秒时间戳）⇒ 同帧内所有单位共用一份，不出现 `单位数 × 舰队数` 的重复排序。
   */
  private spherePrimaryFleets(now: number): any[] {
    if (this.spherePrimaryAt === now) return this.spherePrimaryCache;
    const existing = Array.from(this.fleetGates.keys());
    if (existing.length > 0) {
      this.spherePrimaryAt = now;
      this.spherePrimaryCache = existing;
      return existing;
    }
    const best = new Map<any, number>();   // fleet → 该队**最近成员**到相机的距离平方
    const cam = this.camera.position;
    for (const v of this.unitVis.values()) {
      const f = v.fleet;
      if (!f) continue;
      const dx = v.x - cam.x, dy = v.y - cam.y, dz = v.z - cam.z;
      const d = dx * dx + dy * dy + dz * dz;
      const prev = best.get(f);
      if (prev === undefined || d < prev) best.set(f, d);
    }
    const arr = Array.from(best.entries());
    arr.sort((a, b) => a[1] - b[1]);
    const list = arr.slice(0, Math.max(0, SPHERE_MAX_INSTANCES)).map(([f]) => f);
    this.spherePrimaryAt = now;
    this.spherePrimaryCache = list;
    return list;
  }

  /** [S] 建**可见球体**：瓦片（3 层/块）+ 亮白核心 + 紫辉光。几何只在此刻生成一次。 */
  private buildSphereVisual(g: FleetGate): void {
    const fit = this.fleetSphereFit(g.fleet);
    if (!fit || !(fit.r > 0)) return;
    const P = GATE_STYLE_PARAMS.S;
    const R = fit.r;
    const set = buildSphereTiles({
      radius: R,
      count: P.tileCount,
      gapRatio: P.gapRatio,
    });
    const center = new THREE.Vector3(fit.cx, fit.cy, fit.cz);
    const root = new THREE.Group();
    root.position.copy(center);
    root.frustumCulled = false;
    root.renderOrder = 7;
    // [v3.1 · S] 打标记 + 台账：真机取证/红队可**独立**核对"入场结束后球体是否零残留"
    //   （即使不看 fleetGates 也能数出场景里还剩几个球体根）。
    root.userData.entrySphere = true;
    this.sphereBuiltCount += 1;

    const tileColor = P.tileColor ?? 0xbfe0ff;
    const tileFarColor = P.tileFarColor ?? 0x6a4fd0;
    const dispA = P.dispA ?? 0xff4d6a;
    const dispB = P.dispB ?? 0x3fd0ff;
    const dispOff = Math.max(0, P.dispersion ?? 0.005) * R;
    // 三层基础不透明度（**主色为主，色散层很弱**；加法混合下 3 层叠满会过曝 ⇒ 实测收窄）
    //   [v3.2] 主色 0.38 → 0.55（更"自己在发光"、瓦片自身颜色更足）；色散层显著收弱（红/青只在轮廓边缘微微出现）
    const baseOpacity = [0.50, 0.05, 0.10];
    const tiles: SphereTileVis[] = [];
    for (const tile of set.tiles) {
      const geo = this.sphereTileGeometry(tile);   // 3 层共享
      const grp = new THREE.Group();
      const addLayer = (color: number, opacity: number, off: number): THREE.MeshBasicMaterial => {
        const m = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity,
          // [v3.2] 顶点色：瓦片内"中心亮、边缘暗"（内部亮度 ⇒ 自发光能量片观感）
          vertexColors: true,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, m);
        // 色散层沿瓦片法线（径向）微偏移 ⇒ 球体**轮廓处**分离出红/蓝镶边（参考图 1 左缘）
        mesh.position.set(tile.dispersion[0] * off, tile.dispersion[1] * off, tile.dispersion[2] * off);
        mesh.frustumCulled = false;
        mesh.renderOrder = 8;
        // 标记：真机取证可**独立**数出"场景里还剩几个球体网格"（零残留核对）
        mesh.userData.entrySphere = true;
        m.userData.entrySphere = true;
        grp.add(mesh);
        return m;
      };
      const mats = [
        addLayer(tileColor, baseOpacity[0], 0),
        addLayer(dispA, baseOpacity[1], +dispOff),
        addLayer(dispB, baseOpacity[2], -dispOff),
      ];
      root.add(grp);
      tiles.push({ tile, group: grp, mats, baseOpacity });
    }

    // ── 亮白核心（参考图 2 球心那团亮白）：billboard 柔边面片，加法混合 ⇒ 无硬边 ──
    const coreMat = new THREE.MeshBasicMaterial({
      map: this.makeSphereCoreTexture(), color: P.coreColor ?? 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, depthTest: true,
    });
    const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), coreMat);
    core.scale.setScalar(R * 2 * SPHERE_CORE_R_K);
    core.frustumCulled = false;
    core.renderOrder = 9;
    core.userData.entrySphere = true;
    coreMat.userData.entrySphere = true;
    root.add(core);

    // ── 外圈紫辉光（参考图 2 外圈紫光）：billboard 环状渐变，加法混合 ⇒ 柔边 ──
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.makeSphereGlowTexture(P.glowColor ?? 0x9b5cff), color: 0xffffff, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    // 面片半边长 = R × SPHERE_GLOW_HALF_K > 亮环半径 R × SPHERE_GLOW_R_K ⇒ 亮环外侧仍有柔边
    glow.scale.setScalar(R * 2 * SPHERE_GLOW_HALF_K);
    glow.frustumCulled = false;
    glow.renderOrder = 6;
    glow.userData.entrySphere = true;
    glowMat.userData.entrySphere = true;
    root.add(glow);

    this.scene.add(root);
    g.sphere = {
      root, center, radius: R, set, tiles, core, coreMat, glow, glowMat,
      nearColor: new THREE.Color(tileColor), farColor: new THREE.Color(tileFarColor),
    };
  }

  /**
   * [S] 逐帧把**全部瓦片**摆到 `elapsed`（秒，相对入场起点）对应的位姿 —— 只改
   * `position / quaternion / opacity / visible`（几何与材质对象都不重建）。
   */
  private placeSphereVisual(g: FleetGate, elapsed: number): void {
    const s = g.sphere;
    if (!s) return;
    const cfg: SphereMotionCfg = SPHERE_MOTION_DEFAULT;
    const R = s.radius;
    s.coreMat.opacity = SPHERE_CORE_OPACITY * sphereCoreAmt(elapsed, cfg);
    s.glowMat.opacity = SPHERE_GLOW_OPACITY * sphereGlowAmt(elapsed, cfg);
    // 核心/辉光是 billboard（面向相机）⇒ 每帧对齐相机四元数
    s.core.quaternion.copy(this.camera.quaternion);
    s.glow.quaternion.copy(this.camera.quaternion);
    // 视线方向（球心 → 相机）：用于逐瓦片"近侧蓝白 / 远侧蓝紫"插值（参考图 1/2 的紫蓝层次）
    const view = this.sphereTmpView.subVectors(this.camera.position, s.center);
    if (view.lengthSq() > 1e-9) view.normalize();
    const q = this.sphereTmpQ;
    const p = this.sphereTmpP;
    const ax = this.sphereTmpAxis;
    const col = this.sphereTmpColor;
    const white = this.sphereTmpWhite;
    for (let i = 0; i < s.tiles.length; i++) {
      const tv = s.tiles[i];
      const m = sphereTileMotion(tv.tile, elapsed, cfg);
      const d = tv.tile.dir;
      p.set(d[0] * R * m.k, d[1] * R * m.k, d[2] * R * m.k);
      tv.group.position.copy(p);
      q.setFromAxisAngle(ax.set(tv.tile.axis[0], tv.tile.axis[1], tv.tile.axis[2]), m.spin);
      tv.group.quaternion.copy(q);
      if (m.phase === 4) { tv.group.visible = false; continue; }
      tv.group.visible = true;
      const o = m.opacity;
      // `dot`：瓦片法线与视线夹角余弦 —— 1 = 正对相机（投影在**球心**）、0 = 轮廓、-1 = 背面。
      const dot = d[0] * view.x + d[1] * view.y + d[2] * view.z;
      const face = Math.max(0, Math.min(1, dot));        // 正对程度 ⇒ 亮核
      const sil = 1 - Math.abs(dot);                     // 轮廓程度 ⇒ 色散镶边只在轮廓出现
      // 近侧（正对）→ `nearColor`（亮青白）；远侧（背向）→ `farColor`（深蓝紫）
      col.copy(s.nearColor).lerp(s.farColor, Math.max(0, Math.min(1, 0.5 - 0.5 * dot)));
      // 正对瓦片再向**纯白**提亮 ⇒ 球心"过曝亮白"（径向渐变的内端）
      col.lerp(white, face * SPHERE_TILE_CORE_WHITEN);
      // 亮度增益：正对最亮、轮廓/背面压暗 ⇒ 球心亮、边缘暗（径向衰减，复刻参考图 2 的亮核）
      const gain = SPHERE_TILE_FACE_FLOOR + SPHERE_TILE_FACE_LIFT * face;
      tv.mats[0].color.copy(col);
      tv.mats[0].opacity = tv.baseOpacity[0] * o * gain;
      // 色散层（红/青）只在**轮廓边缘**加权 ⇒ 局部微色散，而不是整圈均匀红边
      const dg = SPHERE_DISP_SIL_FLOOR + (1 - SPHERE_DISP_SIL_FLOOR) * sil;
      tv.mats[1].opacity = tv.baseOpacity[1] * o * dg;
      tv.mats[2].opacity = tv.baseOpacity[2] * o * dg;
    }
  }

  /**
   * [S] 销毁球体（**必须完整 dispose**：几何 + 材质 + 贴图；走纯函数 `disposeTree` ⇒ 台架可真跑同一份去重逻辑）。
   * ⚠ 3 层瓦片网格共享同一份几何 ⇒ `disposeTree` 内部按对象**去重**，不会重复 dispose。
   */
  private disposeSphereVisual(g: FleetGate): void {
    const s = g.sphere;
    if (!s) return;
    this.scene.remove(s.root);
    disposeTree(s.root as unknown as DisposableNode);
    this.sphereDisposedCount += 1;
    g.sphere = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // [v5 · D] **传送门·连续光带门框**入场（`gateStyle === 'D'`）
  //
  //   用户需求（五次反馈，语气强烈）：「**这个边框是什么鬼，一根虚线吗！！这个也太丑了**，
  //     可以再长方形的边框上下功夫，比如有**流动的光线**，或者把**边框变成微微的随机曲线**，
  //     让边框流动起来；但**边框中间的部分效果还是可以的**」。
  //
  //   诊断：v4 的"72 个离散能量块"读作**虚线 / 珠子串**（块是"小段"，而球体瓦片是"面片"）。
  //   做法（**只换门框**；v7 起门内**没有任何光条**）：
  //     ① 门框 = 一条**连续发光带**（ribbon）：沿**圆角矩形**周长连续采样 200 点，逐点沿法线
  //        两侧各偏 `DOOR_RIBBON_HALF_W` ⇒ 闭合带状网格（细带，不是粗棒）；圆角 ⇒ 法线处处连续；
  //     ② ＋**微微的随机曲线**：中心线 = 轮廓 + 法线 × 平滑噪声（多整数频率 `sin` 叠加）× 微小幅度
  //        —— v6 起为**高频 + 电弧脉冲调制 + 尖峰化**（"电流通过"般的抖动 / 呼吸感）；
  //     ③ ＋**流动的光线**：贴图沿 `u`（周长）滚动（多频亮纹 + 移动亮点）⇒ 亮波沿门框流动；
  //     ④ 组装 = 光带沿周长**生长**（`drawRange`），消散 = 沿周长**反向收回** + 淡出。
  //     ⚠ v7：**门内位面**（v6 的 `DOOR_SCAN_LINES` 扫描线层）与**扫描前沿光带 `scan`**（那条横贯
  //       门中的亮条）**都已删除** ⇒ 门内只剩"空门 + 舰队"。
  //   几何 / 运动学真源在 `./entryDoor`（纯函数、零 three 依赖 ⇒ 台架真跑）。
  //   局部系：X = 横向（`halfU` 缩放）/ Y = 竖向（`halfV` 缩放）/ Z = 门法线（= 舰队朝向）。
  //   ⚠ 保留既有正确机制：几何（矩形门 = 投影包围盒 × `ENTRY_GATE_PAD`）/ **5 个裁剪平面**
  //     （同队共享同一数组引用）/ 门沿舰队朝向推进 / 结束 dispose 干净 + 裁剪清空（零残留）。
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * [v5 · D] 门框**流动光**贴图（沿 `u` = 周长方向滚动）：
   *   ① **基础亮带**（多处不同频率 / 相位的 `sin` 叠加 ⇒ 不是等距"刻度尺"）；
   *   ② `DOOR_PULSE_COUNT` 个**移动亮点**（缠绕高斯；沿 u 滚动时读作"能量脉冲沿门框跑"）；
   *   ③ 横向（v）**柔边** —— 带宽两侧渐隐 ⇒ 光带边缘不硬。
   * `wrapS = RepeatWrapping` ⇒ `offset.x` 滚动无缝（多频项用整数频率 + 亮点用缠绕距离 ⇒ 首尾接缝连续）。
   */
  private makeDoorRibbonTexture(): THREE.CanvasTexture {
    const W = 512, H = 16;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, W, H);
      const TWO_PI = Math.PI * 2;
      // 逐列求亮度（含移动亮点）；再逐行按 v 柔边落一像素
      const bright: number[] = new Array(W).fill(0);
      for (let x = 0; x < W; x++) {
        const u = x / W;
        let b = 0.34;
        b += 0.20 * Math.sin(TWO_PI * 3 * u + 0.0);
        b += 0.15 * Math.sin(TWO_PI * 5 * u + 1.7);
        b += 0.10 * Math.sin(TWO_PI * 8 * u + 4.1);
        b += 0.06 * Math.sin(TWO_PI * 13 * u + 2.3);
        for (let p = 0; p < DOOR_PULSE_COUNT; p++) {
          const c = (p + 0.5) / DOOR_PULSE_COUNT;
          let d = Math.abs(u - c);
          if (d > 0.5) d = 1 - d;                       // 缠绕距离 ⇒ 亮点跨接缝连续
          b += 0.95 * Math.exp(-(d * d) / (2 * 0.045 * 0.045));
        }
        bright[x] = Math.max(0, Math.min(1, b));
      }
      for (let y = 0; y < H; y++) {
        const v = H > 1 ? y / (H - 1) : 0.5;
        const across = 1 - Math.pow(Math.abs(2 * v - 1), 1.6);   // 中心最亮、两侧渐隐（软边）
        for (let x = 0; x < W; x++) {
          const a = bright[x] * across;
          if (a <= 0.003) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * [v5 · D] 建**可见传送门**：门框**连续光带**（3 层共享 1 份带状几何）+ 门框轮廓（展开）+ 外辉光。
   * ⚠ v5 相对 v4 的唯一结构改动：**离散能量块 ⇒ 连续发光带**（带微随机曲线 + 沿周长流动的光）。
   * ⚠ v7：**门内位面与扫描前沿光带都已删除** ⇒ 门内为空（天然不遮挡舰队）。
   */
  private buildDoorVisual(g: FleetGate): void {
    if (!ENTRY_GATE_VISIBLE) return;
    const P = GATE_STYLE_PARAMS.D;
    const root = new THREE.Group();
    // 右手正交基（与 A/B/C 同源）：right = (−sin, 0, −cos) 与 up / fwd 构成 det=+1 ⇒ 门框不镜像
    this.gateBasis.makeBasis(g.right, g.up, g.fwd);
    root.quaternion.setFromRotationMatrix(this.gateBasis);
    // 局部 [-1,1] → 门框（分轴 ⇒ 矩形门紧贴舰队投影轮廓）
    root.scale.set(g.halfU, g.halfV, 1);
    root.frustumCulled = false;
    root.renderOrder = 8;

    const bandColor = P.bandColor ?? 0x8fe9ff;
    const dispA = P.dispA ?? 0xff5a78;
    const dispB = P.dispB ?? 0x5ad6ff;
    const dispOff = Math.max(0, P.dispersion ?? DOOR_DISPERSION_K);

    // ── 门框光带几何（**一份**，3 层 Mesh 共享）──
    const N = DOOR_RIBBON_SAMPLES;
    const ribbonGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(doorRibbonBandVertices(0, N), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    ribbonGeo.setAttribute('position', posAttr);
    ribbonGeo.setAttribute('uv', new THREE.BufferAttribute(doorRibbonBandUvs(N), 2));
    ribbonGeo.setIndex(new THREE.BufferAttribute(doorRibbonBandIndices(N), 1));   // 1200 索引（Uint16 够）
    ribbonGeo.setDrawRange(0, 0);   // 初始不画（逐帧由 doorRibbonGrowthK 生长）
    const ribbonTex = this.makeDoorRibbonTexture();
    const ribbonBase = 0.74;
    // 三层基础不透明度（主色为主，色散层**很弱**；加法混合下 3 层叠满会过曝 ⇒ 光带发白）
    const ribbonLayerOpacity = [ribbonBase, ribbonBase * 0.10, ribbonBase * 0.15];
    const ribbonMats: THREE.MeshBasicMaterial[] = [];
    const ribbonMeshes: THREE.Mesh[] = [];
    const ribbonColors = [bandColor, dispA, dispB];
    // v5 色散：红层**外扩**、青层**内缩**（绕门心的均匀缩放 ⇒ 轮廓处红/青微镶边，不加在"块"上）。
    //   ⚠ 系数刻意小（0.6×）—— 光带很细，取满会读成"整圈红箍"（旧教训）。
    const dispScale = dispOff * 0.6;
    const ribbonScales = [1, 1 + dispScale, 1 - dispScale];
    // 带宽的**世界等宽**补偿（矩形门 ⇒ 否则左右两条会比上下两条粗）
    const [aspectKx, aspectKy] = doorRibbonAspectK(g.halfU, g.halfV);
    for (let li = 0; li < 3; li++) {
      const mat = new THREE.MeshBasicMaterial({
        map: li === 0 ? ribbonTex : null, color: ribbonColors[li], transparent: true,
        opacity: ribbonLayerOpacity[li], blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ribbonGeo, mat);
      mesh.position.z = li === 0 ? 0 : (li === 1 ? +dispOff * 2 : -dispOff * 2);
      mesh.scale.set(ribbonScales[li], ribbonScales[li], 1);
      mesh.frustumCulled = false;
      mesh.renderOrder = li === 0 ? 10 : 9;
      root.add(mesh);
      ribbonMats.push(mat);
      ribbonMeshes.push(mesh);
    }

    // 门框**轮廓**（组装前半段竖向从 0 → 1 展开 ⇒ "开启"动作）
    const aperture = new THREE.LineLoop(this.gateLoopGeometry(this.gateFramePoints(0), 0), new THREE.LineBasicMaterial({
      color: P.core, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    aperture.renderOrder = 12;
    aperture.userData.baseOpacity = 0.55;
    root.add(aperture);

    // 门框**锐利内缘**（加法混合细环带，沿矩形）—— 任意视角都读得出"门"的边框（复刻老门的可读性）
    const rimMat = new THREE.MeshBasicMaterial({
      color: P.core, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const rim = new THREE.Mesh(this.gateBandGeometry(this.gateFramePoints(0), 0, 0.016, true), rimMat);
    rim.position.z = -0.001;
    rim.renderOrder = 11;
    root.add(rim);

    // 柔边**外辉光**（青/紫；中心透明 ⇒ 不遮舰队；加法混合 ⇒ 无硬直边）
    const haloMat = new THREE.MeshBasicMaterial({
      map: this.makeGateHaloTexture(P.halo), color: 0xffffff, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), haloMat);
    halo.position.z = -0.002;
    halo.renderOrder = 7;
    root.add(halo);

    this.scene.add(root);
    g.door = {
      root,
      ribbon: {
        geo: ribbonGeo, pos: posAttr, mats: ribbonMats, meshes: ribbonMeshes, tex: ribbonTex,
        base: ribbonBase, kx: aspectKx, ky: aspectKy,
      },
      aperture, halo, haloMat, rim, rimMat,
      halfU: g.halfU, halfV: g.halfV,
    };
  }

  /**
   * [v5 · D] 逐帧把门框**连续光带**推进到 `elapsed`（秒，相对入场起点）—— 只改
   * `position`（就地写）/ `drawRange`（生长/收回）/ `offset`（流动）/ `opacity`（包络）。
   * 几何与材质对象都**不重建**（同一份 ribbon Geo 被 3 层共享）。
   * ★v7：陪衬元素（`rim` / 外辉光 / 轮廓线 `aperture`）的 opacity **一律乘 `doorAuxFadeK`**
   *   ⇒ **门框归零的同一帧，陪衬必然已归零**（沿用 v6「生长优先 + 同刻归零」的包络）。
   * ⚠ v7 **门内位面 + 扫描前沿光带已删除** ⇒ 本函数不再有任何门内光条相关更新。
   */
  private placeDoorVisual(g: FleetGate, elapsed: number): void {
    const d = g.door;
    if (!d) return;
    d.root.position.copy(this.gateWorldCenter(g, this.visTmpV));
    const cfg = DOOR_MOTION_DEFAULT;
    const barrierAmt = doorBarrierAmt(elapsed, cfg);
    // 呼吸脉冲（轻微起伏 ⇒ 门"活"起来）
    const breathe = 0.85 + 0.15 * Math.sin(elapsed * Math.PI * 1.6);
    // 「生长优先」+「与门框同步归零」：`doorAuxFadeK = 生长优先(组装侧) / 生长K(消散侧)`
    //   ⇒ 生长 < 50% 恒 0（组装期只有光带）；生长 K → 0 时恒 0（陪衬不会晚于门框消失）。
    const gk = doorRibbonGrowthK(elapsed, cfg);
    const fadeK = doorAuxFadeK(elapsed, cfg);
    // 外辉光**克制**（v5 的"边框"由光带承担；辉光过强会把门框冲成粉紫）
    d.haloMat.opacity = 0.28 * barrierAmt * breathe * fadeK;

    // ── 门框光带：① 曲线（就地写顶点：轮廓 + 法线×平滑噪声×时间）② 生长 / 收回 ③ 流动 ④ 强度包络 ──
    const rb = d.ribbon;
    doorRibbonBandVertices(
      elapsed, DOOR_RIBBON_SAMPLES, undefined, rb.pos.array as Float32Array, rb.kx, rb.ky);
    rb.pos.needsUpdate = true;
    // ② 生长：drawRange 沿周长单调铺开（组装）/ 反向收回（消散）。索引按"每段 6 个"对齐。
    const idxTotal = DOOR_RIBBON_SAMPLES * 6;
    const idxCount = Math.max(0, Math.min(idxTotal, Math.round((idxTotal * gk) / 6) * 6));
    rb.geo.setDrawRange(0, idxCount);
    const show = idxCount > 0;
    for (const m of rb.meshes) m.visible = show;
    // ③ 流动：UV 沿周长（u）滚动 ⇒ 亮波 + 亮点在门框里跑（单调不回摆）
    rb.tex.offset.x = doorRibbonFlowOffset(elapsed) % 1;
    // ④ 强度包络：随生长系数渐入（组装）/ 渐出（消散）—— 收回末段整条淡掉
    const bandAmt = Math.min(1, gk * 1.8);
    rb.mats[0].opacity = rb.base * bandAmt;
    rb.mats[1].opacity = rb.base * 0.10 * bandAmt;
    rb.mats[2].opacity = rb.base * 0.15 * bandAmt;

    // 门框**锐利内缘**：**克制且跟在光带之后**（v5 里主观感由光带承担；rim 只做"内缘"的锐利提示）
    //   ★v7：乘 `fadeK`（`doorAuxFadeK`）⇒ 与门框同步归零（不会晚于门框）。
    d.rimMat.opacity = (0.10 + 0.22 * barrierAmt) * breathe * fadeK;
    // 门"开启"：轮廓竖向展开 0 → 1（组装前半段）—— **让位给"生长"**：亮度压低并跟生长一起出现
    const ap = doorApertureK(elapsed, cfg);
    d.aperture.scale.set(1, ap, 1);
    (d.aperture.material as THREE.LineBasicMaterial).opacity = 0.18 * Math.min(1, ap * 3) * fadeK;
  }

  /** [v5 · D] 销毁传送门（**必须完整 dispose**：几何 + 材质 + 贴图；`disposeTree` 内部按对象去重共享几何）。 */
  private disposeDoorVisual(g: FleetGate): void {
    const d = g.door;
    if (!d) return;
    this.scene.remove(d.root);
    disposeTree(d.root as unknown as DisposableNode);
    g.door = null;
  }

  /**
   * [S] 单舰**显现系数** 0..1（缩放淡入；纯函数 `sphereRevealAmt` 驱动）。
   * `this.gateStyle !== 'S'` / 未登记 / 已结束 / 一键关闭 ⇒ 恒 1（不改变 A/B/C 与常规行为）。
   */
  private entryRevealScale(key: string, now: number): number {
    if (this.gateStyle !== 'S') return 1;
    if (!this.entryFxActive) return 1;
    const st = this.entryStates.get(key);
    if (!st || st.done) return 1;
    return sphereRevealAmt(now - st.t0, st.delay, SPHERE_REVEAL_DEFAULT);
  }

  /** 收集一个舰体 Group 内全部材质引用（Phong 体 + 轮廓线 + 旗舰光环）—— 裁剪按材质施加。 */
  private collectSliceMats(group: THREE.Object3D): SliceMatLike[] {
    const out: SliceMatLike[] = [];
    group.traverse((o) => {
      const m = (o as any).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) { for (const mm of m) out.push(mm); }
      else out.push(m);
    });
    return out;
  }

  /**
   * [切片传送入场 · 时机修复] **开战即显式启动入场**（唯一正式入口）。
   *
   * 为什么必须显式：部署期 `registerEntryState` 被守卫拦下（部署期一律不登记），故开战那一刻
   * 必须重置入场纪元，否则舰队在 4s 窗口内的"首见"会落在部署期（3D 独立 rAF 早已见过它们）。
   *   ① 清空 `entryStates`：清掉部署期理论上不该有、但防御性必须清的残留登记；
   *   ② **显式**写入 `entryEpoch`（不再依赖 `entryEpoch === 0` 的惰性初值 ⇒ 语义唯一）；
   *   ③ `entryStarted = true` ⇒ 之后的"首次见到"才允许登记 ⇒ 切片开始播放。
   * 由 `BattleScene` 经 `pushFx3d({kind:'entry_start'})` 触发（Enter / 军议"开战"按钮 /
   * `deployAutoStart` 三条路径都汇入 `startBattleAfterDeploy`）。
   */
  startEntryFx(): void {
    this.entryStates.clear();
    this.finishAllEntryGates();   // 防御性：重开战/重进战斗时清掉可能残留的门（否则舰体被永久切）
    this.entryEpoch = performance.now() / 1000;
    this.entryStarted = true;
    // [v2 · N1] 开战即把镜头对准**我方主力舰队**（近景 ⇒ 有模型；远景只有光点 ⇒ v1 的失败根因）
    // [v4] 设置项关闭（`off`）⇒ 不聚焦（舰队照常显示、不暂停，见 entryFxOn / beginEntryPhase）
    if (ENTRY_AUTO_FOCUS && !this.entryFxOff) this.focusOnPlayerMainFleetForEntry();
  }

  /** [v2 · N1/N2] 聚焦我方主力舰队到 **LOD 近景档**（保证 `fleetPx` 越过阈值 ⇒ 有实体模型）。 */
  private focusOnPlayerMainFleetForEntry(): boolean {
    const baseY = this.initCamY > 0 ? this.initCamY : 0;
    if (baseY <= 0) return false;   // 世界尚未建成/无取景基准 ⇒ 保持当前机位
    const dist = Math.max(this.hexR * 4, baseY * ENTRY_FOCUS_CAMY_K / Math.max(0.2, Math.cos(ENTRY_FOCUS_ELEV)));
    const ok = this.focusOnPlayerMainFleet({ dist });
    if (!ok) return false;          // 无玩家阵营 / 无玩家舰队 ⇒ 保持当前机位（不抛错）
    // 目标点本身很高（地形 / 队间叠层）时首次可能仍落在远景档 ⇒ 再压一档并复核。
    this.updateLodTier();
    if (!this.lodNear) {
      this.focusOnPlayerMainFleet({ dist: Math.max(this.hexR * 4, dist * 0.55) });
      this.updateLodTier();
    }
    return true;
  }

  /**
   * [v2 · N6] 算一支舰队在**垂直于其朝向**的平面上的投影包围盒（门尺寸 + 扫描行程的真源）。
   * ⚠ 取 `this.unitVis`（**全部存活单位**）而非 `this.ships`（只有实体的）——
   *   否则实体还在一帧一帧建（`MESH_ADD_PER_FRAME`）时门会**边建边变尺寸**。
   * ⚠ 用**半长/半宽/半高**累加 ⇒ 舰首（`s + L/2`）与舰尾都被覆盖。
   */
  private computeFleetGateBox(fleet: any, fwd: THREE.Vector3, right: THREE.Vector3): EntryGateBox {
    const box = entryGateEmptyBox();
    for (const v of this.unitVis.values()) {
      if (v.fleet !== fleet) continue;
      const s = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
      const u = v.x * right.x + v.y * right.y + v.z * right.z;
      const L = v.shipLen > 0 ? v.shipLen : 4;
      const W = v.shipW > 0 ? v.shipW : L * 0.35;
      const H = this.shipHOf(v.u, v.fleet) || L * 0.3;
      entryGateAccumulate(box, s, u, v.y, L * 0.5, W * 0.5, H * 0.5);
    }
    return box;
  }

  /**
   * [v2 · N6/N7] 保证该舰队有一扇门（懒建）。
   * 世界正交基：`fwd` = 像素朝向 `(cos a, sin a)` → 世界 `(cos a, 0, −sin a)`；
   * `right = (−sin a, 0, −cos a)`（**必须**取这个符号：`(sin,0,cos)` 与 up/fwd 构成左手基，
   * `makeBasis` 会产出带反射的矩阵 ⇒ 门框镜像翻转）。
   */
  private ensureFleetGate(fleet: any, now: number): FleetGate | undefined {
    const found = this.fleetGates.get(fleet);
    if (found && !found.done) return found;
    if (found) {
      this.disposeGateVisual(found);
      this.disposeSphereVisual(found);
      this.fleetGates.delete(fleet);
    }
    // [v3.1 · S] 球体只给**离相机最近的 N 支舰队**建（每球 ≈ 3×瓦片数 个 Mesh ⇒ draw call 上限）。
    //   上限外的舰队**不建门** ⇒ 不登记入场 ⇒ 照常显示（相机已聚焦我方主力 ⇒ 主力必然入选）。
    if (this.gateStyle === 'S' && !this.spherePrimaryFleets(now).includes(fleet)) return undefined;
    const fa = (typeof fleet?.facingSmooth === 'number' ? fleet.facingSmooth : fleet?.facingAngle);
    const a = Number.isFinite(fa) ? fa : 0;
    const fwd = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const right = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
    const up = new THREE.Vector3(0, 1, 0);
    const box = this.computeFleetGateBox(fleet, fwd, right);
    if (!entryGateValid(box)) return undefined;   // 空队 ⇒ 不开门（也就不会强制建实体）
    // [v3 矩形截面] 横向/竖向**各自** = 投影宽/高 × PAD ⇒ 门紧贴舰队轮廓（不再"竖向空一大半"）
    const halfU = Math.max(ENTRY_GATE_MIN_HALF, entryGateSizeU(box, this.entryCfg.pad) / 2);
    const halfV = Math.max(ENTRY_GATE_MIN_HALF, entryGateSizeV(box, this.entryCfg.pad) / 2);
    const margin = entryGateMargin(box);
    const planes = [0, 1, 2, 3, 4].map(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    const g: FleetGate = {
      fleet, planes, fwd, right, up,
      cu: entryGateCenterU(box), cv: entryGateCenterV(box), halfU, halfV, margin, box,
      t0: now, p: 0, pos: entryGateFront(0, box.sLo, box.sHi, margin), done: false,
      shipKeys: [], vis: null, barrierTex: null, sphere: null, door: null,
    };
    entryGateWritePlanes(g.planes, fwd, right, up, g.cu, g.cv, halfU, halfV, g.pos);
    // ── [v3.1] 外观分派：`S` ⇒ 六边形球体（组装/消散）；`D` ⇒ [v4] 传送门能量块；
    //    其余 ⇒ 原 A/B/C 门框（代码零改动）。三者共用几何 / 5 个裁剪面 / 入场时序。──
    if (this.gateStyle === 'S') {
      this.buildSphereVisual(g);
      // 包围球拟合失败（理论不可达：`entryGateValid` 已保证有单位）⇒ 不建门，
      // **绝不留"无球的门"**（否则 `attachEntryClippingTo` 会误挂裁剪 ⇒ 舰体被切）。
      if (!g.sphere) return undefined;
      this.placeSphereVisual(g, 0);
    } else if (this.gateStyle === 'D') {
      // [v4] 传送门·能量块组装/消散 —— **保留裁剪**（门框 = 5 个裁剪面围成的方柱 ⇒ 舰队从门里钻出来）。
      this.buildDoorVisual(g);
      // 建门失败（理论不可达）⇒ 绝不留"无门的裁剪"（否则舰体被永久切）。
      if (!g.door) return undefined;
      this.placeDoorVisual(g, 0);
    } else {
      this.buildGateVisual(g);
      this.placeGateVisual(g);
    }
    this.fleetGates.set(fleet, g);
    return g;
  }

  /**
   * [v2] 给**已建实体**补挂本队门的裁剪平面（同队共享同一数组实例）。
   * 为什么需要：部署期建好的实体在登记时并不在入场中（那时 `registerEntryState` 被守卫拦下）
   *   ⇒ `addMesh` 没挂裁剪；开战后这些舰被登记，若不在此时补挂，它们会**整舰可见**、看不到门切。
   */
  private attachEntryClippingTo(key: string): void {
    const entry = this.ships.get(key);
    if (!entry || entry.entryPlanes) return;   // 无实体 ⇒ 留给后续 addMesh 挂；已挂 ⇒ 不重复
    const g = this.fleetGates.get(entry.fleet);
    if (!g || g.done) return;
    // [v3.1 · S] 球体方案**不切舰体**（舰队"在球里出现"由缩放淡入驱动）⇒ 不挂任何裁剪平面。
    if (this.gateStyle === 'S') return;
    entry.entryPlanes = g.planes;
    entry.sliceMats = this.collectSliceMats(entry.group);
    entryApplyClipping(entry.sliceMats, entry.entryPlanes, true);
  }

  /**
   * 登记入场状态（**只登记一次**；对每个可见单位逐帧尝试，幂等）。
   * ⚠ 进度绑"入场事件"，不绑 `addMesh` ⇒ 推拉镜头不重播（设计文档 P2）。
   * 入场窗口外的首见（如迷雾发现、战后增援）**不登记** ⇒ 不触发切片，避免与既有 LOD 打架。
   * ⚠ 部署期一律不登记、开战（`startEntryFx`）前一律不登记 —— 见 `entryStarted` 的根因说明。
   * [v2] 一队一门：登记该舰时**顺带懒建它所属舰队的门**（无门 ⇒ 不登记 ⇒ 不强制建实体）。
   */
  private registerEntryState(key: string, u: any, fleet: any, now: number): void {
    if (!this.entryFxActive) return;
    if (this.entryStates.has(key)) return;
    // [时机修复 ①] 部署期不登记（读部署态走既有通道，与 BattleScene 的 deployPhase 同一真源）。
    if ((this.battleScene as any)?.deployPhase) return;
    // [时机修复 ②] 仅在开战之后登记；`entryEpoch` 已由 `startEntryFx` 显式置初值，故不再惰性赋 now。
    if (!this.entryStarted) return;
    if (now - this.entryEpoch > ENTRY_REG_WINDOW_SEC) return;
    const g = this.ensureFleetGate(fleet, now);
    if (!g) return;
    const d = Number((u as any)?._entryDelay);
    // [v2] 一队一门 ⇒ 逐舰相位由**门的几何扫掠**天然给出（靠舰首一侧的舰先显形）。
    //   `_entryDelay` 仍由 2D 建舰期写入（v1 沿用），此处仅保留为诊断值，**不参与门的时序**。
    let delay = Number.isFinite(d) && d > 0 ? d : 0;
    // [v3.1 · S] 球体方案改为**径向错开**：离球心越近的舰越早显现
    //   （`delay` 字段自此承载"显现延迟"，由 `entryRevealScale` 消费 ⇒ "舰队由内向外浮现"）。
    if (g.sphere) {
      const s = g.sphere;
      // 用 XZ 平面距离（2D 精灵所在平面）：与真实球面距离单调同序 ⇒ 排序语义等价且省一次开方域换算。
      delay = sphereRevealDelayByRadius(
        Math.hypot(u.sprite.x - s.center.x, -u.sprite.y - s.center.z),
        s.radius, SPHERE_REVEAL_DEFAULT.spread,
      );
    }
    this.entryStates.set(key, {
      t0: g.t0,
      delay,
      done: false,
    });
    g.shipKeys.push(key);
    this.attachEntryClippingTo(key);
  }

  /** 该舰是否仍处入场中（决定"临时强制建实体"与 `grow` 门控）。 */
  private entryActiveOf(key: string): boolean {
    if (!this.entryFxActive) return false;
    const st = this.entryStates.get(key);
    return !!st && !st.done;
  }

  /**
   * [v2 · N4/N5/N7] **单个门**一帧的推进 —— 纯逻辑 + 对 three 对象的结构化写入。
   *
   * 刻意只依赖 `this.entryCfg` / `entrySlice` 的纯函数 ⇒ 离线台架可用
   * "唯一锚点切片 + `stripTypeScriptTypes` + `new Function`" **真跑本方法原文**。
   * @returns true = 本帧结束（调用方据此 `finishEntryGate`，**必须**卸载全队裁剪）
   */
  private stepEntryGate(g: FleetGate, now: number, on: boolean): boolean {
    if (g.done) return true;
    const p = entryShipProgress(now, g.t0, 0, this.entryCfg.total);
    if (!on || p >= 1) { g.done = true; return true; }
    g.p = p;
    // p=0 ⇒ 舰首之外（全隐）；p=1 ⇒ 舰尾之外（全显）；随 p **单调递减** = 从舰首扫向舰尾
    g.pos = entryGateFront(p, g.box.sLo, g.box.sHi, g.margin);
    entryGateWritePlanes(g.planes, g.fwd, g.right, g.up, g.cu, g.cv, g.halfU, g.halfV, g.pos);
    return false;
  }

  /** 结束一个门：**卸载全队裁剪**（否则舰体被永久切）+ 销毁门本体（含球体）+ 逐舰标 done。 */
  private finishEntryGate(g: FleetGate): void {
    for (const key of g.shipKeys) {
      const st = this.entryStates.get(key);
      if (st) st.done = true;
      const entry = this.ships.get(key);
      if (!entry) continue;
      // ⚠ [v3.1 · S] 红线：**无论走哪条外观分支，都必须把裁剪清掉**（S 本就没挂，此处为防御性兜底）。
      entryApplyClipping(entry.sliceMats, null, false);
      entry.sliceMats = undefined;
      entry.entryPlanes = undefined;
    }
    this.disposeGateVisual(g);
    // [v3.1 · S] 球体**必须完整 dispose**（几何 + 材质 + 贴图）—— 入场结束后**零残留**（红队检查项）。
    this.disposeSphereVisual(g);
    // [v4 · D] 传送门能量块**必须完整 dispose**（`disposeTree` 去重共享几何）—— 入场结束后**零残留**。
    this.disposeDoorVisual(g);
    g.done = true;
  }

  /** 一键关闭 / `entry_end` / `startEntryFx` 重置：**立刻收掉所有门**（绝不残留裁剪）。 */
  private finishAllEntryGates(): void {
    for (const g of this.fleetGates.values()) if (!g.done) this.finishEntryGate(g);
    this.fleetGates.clear();
  }

  /**
   * 逐帧推进**所有门**。**入场结束必须清空 `clippingPlanes`**（否则舰体被永久切）。
   *
   * ⚠ v1 的"尚无实体 ⇒ 保持等待"陷阱在 v2 已由结构消除：门是**舰队级**的，
   *   由 `computeFleetGateBox` 直接读 `unitVis`（全部存活单位）建门 ⇒ 不依赖实体是否已建。
   */
  private updateEntryFx(): void {
    if (this.fleetGates.size === 0) return;
    const on = this.entryFxOn();
    const now = performance.now() / 1000;
    for (const g of this.fleetGates.values()) {
      if (g.done) continue;
      if (this.stepEntryGate(g, now, on)) { this.finishEntryGate(g); continue; }
      if (g.sphere) {
        // [v3.1 · S] 球体按**真实经过时间**推进（与 `entryCfg.total` 同源 ⇒ 动画必然在暂停窗口内跑完）
        const el = Math.min(this.entryCfg.total, Math.max(0, now - g.t0));
        this.placeSphereVisual(g, el);
      } else if (g.door) {
        // [v4 · D] 传送门按**真实经过时间**推进（同源 ⇒ 动画必然在暂停窗口内跑完）
        const el = Math.min(this.entryCfg.total, Math.max(0, now - g.t0));
        this.placeDoorVisual(g, el);
      } else {
        this.placeGateVisual(g);
      }
    }
    for (const [fleet, g] of this.fleetGates) if (g.done) this.fleetGates.delete(fleet);
  }

  /** 授予实体：建模型并登记 ShipEntry（长出动画从 meshT = 0 开始） */
  private addMesh(v: UnitVis) {
    const u = v.u, fleet = v.fleet;
    const color = factionColor(this.getFac(u.factionId) || {});
    const units = (fleet.units as any[]) || [];
    const isFlagshipUnit = !(fleet as any)._scout && !(fleet as any)._scoutFlight
      // v8：运输舰的渲染宿主只有它自己一个成员 ⇒ 绝不能因此被当成旗舰（否则孤舰戴指挥光环）
      && !(fleet as any)._isAux
      && u === (units.find((candidate: any) => candidate.isFlagship === true) || units[0]);
    const flagshipKey = isFlagshipUnit ? this.flagshipKeyOf(u, fleet) : null;
    const built = this.buildShip(String(u.classType || 'destroyer'), color, this.isEmpireSideOf(u), flagshipKey ?? undefined);
    // 【旗舰方案】指挥光环（仅水平细环）：挂在 ship group 下（随位置/缩放自动跟随，无需每帧同步）。
    // 尺寸要给**局部单位**：世界尺寸 ÷ group 的基准缩放（= baseScale）才是局部尺寸。
    // 【旗舰方案】指挥光环（挂 group 下 ⇒ 位置/朝向/缩放自动跟随）
    const cmdRing = isFlagshipUnit ? this.attachFlagshipFx(built.group, color, v.shipLen) : undefined;
    this.shipGroup.add(built.group);

    // [v14 ③2] 初始朝向 = 舰队朝向（避免首帧从 0 猛转）；无则 0
    // ★ v8 运输舰：初始朝向 = `aux.heading`（host.facingSmooth 即其镜像，此处统一走 host 也正确）
    const fa0 = (fleet as any)?._isAux ? (fleet as any).aux?.heading : (fleet.facingSmooth ?? fleet.facingAngle);
    const yaw0 = (typeof fa0 === 'number' && Number.isFinite(fa0))
      ? Math.atan2(-Math.cos(fa0), Math.sin(fa0)) : 0;

    // [切片传送入场] 该舰仍在入场中？⇒ 立即挂上裁剪平面，并**跳过"长出"动画**（P3：只留平面推进）。
    //   ⚠ 这是"补挂"而非"重播"：进度真源是 entryStates（按单位存活持有），实体中途被
    //     池化销毁再重建时，从**当前时间**续切（`updateEntryFx` 用绝对时钟算 p）。
    const entrySt = this.entryFxActive ? this.entryStates.get(v.key) : undefined;
    const gate = entrySt && !entrySt.done ? this.fleetGates.get(fleet) : undefined;
    const entryActive = !!gate && !gate.done;
    let entryPlanes: THREE.Plane[] | undefined;
    let sliceMats: SliceMatLike[] | undefined;
    // [v3.1 · S] 球体方案**不切舰体**（显现由第三遍的 `entryRevealScale` 缩放淡入驱动）⇒ 不挂裁剪。
    if (entryActive && this.gateStyle !== 'S') {
      // [v2] 直接用**本队门的 5 个平面实例**（同队所有舰共享 ⇒ 一次 `entryGateWritePlanes` 全队生效）
      entryPlanes = gate!.planes;
      sliceMats = this.collectSliceMats(built.group);
      entryApplyClipping(sliceMats, entryPlanes, true);
    }

    this.ships.set(v.key, {
      key: v.key, group: built.group, u, fleet,
      lastX: (fleet as any)?._isAux ? (fleet as any).aux?.x ?? 0 : u.sprite.x,
      lastZ: (fleet as any)?._isAux ? -((fleet as any).aux?.y ?? 0) : -u.sprite.y,
      cruiseY: 0, yaw: yaw0,
      pendingModel: built.pendingModel, modelVer: built.modelVer ?? 0,
      isFlagship: isFlagshipUnit, flagshipKey: flagshipKey ?? undefined,
      cmdRing,
      // [任务3] 补给舰舰首标记（挂在 group 下；透明度每帧按 grow 同步）
      bowMarker: (built.group.userData as any).bowMarker,
      meshT: entryActive ? MESH_GROW_DUR : 0, baseScale: built.group.scale.x || 1,
      sliceMats, entryPlanes,
      // [v12.1 C2] 记录本次构建所用档位（分帧迁移据此淘汰旧档实体）
      tier: this.detailTier,
    });
  }

  /** 归还实体（瞬时销毁，不做淡出；亮度由光点/光晕两层接力） */
  private dropMesh(key: string) {
    const entry = this.ships.get(key);
    if (!entry) return;
    this.disposeShipGroup(entry.group);
    this.ships.delete(key);
  }

  /**
   * 写**一个**光点（供 writeDotLayers 第二遍"格胜出者"与第三遍"旗舰补写"共用）。
   * 抽成单一方法是为了两条路径的写入算式**永远一致** —— 若内联两份，日后改一处必漏一处。
   * 返回写入的槽位数：`DOT_N`（已写）或 `0`（未写：alpha ≤ 0.02 或容量已满）。
   * ⚠ 调用方负责"该不该写"的判定（flagshipSet / dotWinnerKeys），此处只负责"怎么算、怎么写"。
   */
  private writeOneDot(v: UnitVis, dp: number): number {
    const hasMesh = this.ships.has(v.key);
    // grow 只对"确实拿到实体"的舰生效：落选 / 未长成实体的舰 grow = 0 → 点满亮，绝不留洞
    const grow = hasMesh ? v.grow : 0;
    // [v79] **模型长出一半以上 ⇒ 点完全让位**（恢复 v73 的硬截断，v75 曾删除）。
    //   用户实报（v78 之后仍存在）：「同一条线上前半是点、后半是模型」「一半一半」。
    //   若整队 fleetPx 落在过渡带（lodLo~lodHi），则 **grow≈0.5 ∀成员**
    //   ⇒ 整队同时呈现「半透明模型 + 未消失的点」⇒ 用户读作"点+模型共存"。
    //   连续 alpha 衰减（旧行为）**不解决**这个重叠：grow=0.5 时点仍有 0.39 alpha。
    //   硬截断 ⇒ 过渡带内只显示（半透明）模型、点已退场 ⇒ 视觉上是
    //   「点 → 半透明模型 → 实心模型」的单向流动，不再重叠。
    // [v81] **只要有实体就完全不画点**（阈值 0.5 → 0.15 → 0.02）。
    //   诊断面板实测：某队 px=16.7 ⇒ grow = sstep(14,26,16.7) ≈ **0.13**
    //   ⇒ 旧阈值 0.15 判不出 ⇒ 该队仍是"淡模型 + 点" ⇒ 用户读作"点"。
    //   改为"有实体即去点"后语义清晰：
    //     · 有实体（fleetPx ≥ keep）⇒ **纯模型**（浓淡由 grow 控尺寸，不再是点）
    //     · 无实体（px 太小）        ⇒ 纯点
    //   ⇒ 二值化，不再有"模型与点并存"的中间态（那正是用户反复反馈的观感）。
    if (hasMesh && grow > 0.02) return 0;
    // alpha 下限 0.78：远景清楚可见。**不得再出现 alpha 被距离打到 0 的分支** ——
    // "太远"由屏幕空间点距下限 DOT_PITCH_MIN_PX 表达，不再由亮度表达。
    const a = (1 - grow) * (0.78 + 0.22 * sstep(DOT_IN_LO, DOT_IN_HI, v.px));
    if (!(a > 0.02) || dp + DOT_N > DOT_SLOTS) return 0;

    dotTmpColor.setHex(factionColor(this.getFac(v.u.factionId) || {}));
    const isFlag = this.flagshipSet.has(v.u);
    if (isFlag) dotTmpColor.lerp(WHITE, 0.45);
    const cr = Math.min(1, dotTmpColor.r * 1.15);
    const cg = Math.min(1, dotTmpColor.g * 1.15);
    const cb = Math.min(1, dotTmpColor.b * 1.15);

    // 点径 = px 比例，但不低于 DOT_MIN_PX（= DOT_PITCH_MIN_PX × DOT_DIAM_K，保证远处点仍可见且不糊成块）。
    // 上限由 dotMat 的 uMaxPx(24) 把关。
    // 【旗舰方案】远景档：点径放大 FLAGSHIP_DOT_GAIN 倍并偏白
    //（1 舰 1 点体系里，大小 + 色偏是唯一可用的区分手段；不改点着色器、不加 draw call）
    const R = DOT_SPREAD_K * v.shipLen * (1 - grow);
    const dotPxSize = Math.max(DOT_MIN_PX, v.px * DOT_SCALE) * (1 - grow) * (isFlag ? FLAGSHIP_DOT_GAIN : 1);
    // ⚠ 局部变量名用 `siny` 而非 `sy`：避免与 UnitVis.sy（该舰屏幕 y 像素）命名重叠而误读。
    const cy = Math.cos(v.yaw), siny = Math.sin(v.yaw);
    const { dotPos, dotCol, dotAlpha, dotPx } = this;
    for (let k = 0; k < DOT_N; k++) {
      const ox = DOT_OFFSETS[k * 3] * R;
      const oz = DOT_OFFSETS[k * 3 + 2] * R;
      // Ry(yaw)：(x, z) → (x·cos + z·sin, −x·sin + z·cos)
      const wx = ox * cy + oz * siny;
      const wz = -ox * siny + oz * cy;
      const j = dp + k;
      dotPos[j * 3] = v.x + wx;
      dotPos[j * 3 + 1] = v.y;
      dotPos[j * 3 + 2] = v.z + wz;
      dotCol[j * 3] = cr; dotCol[j * 3 + 1] = cg; dotCol[j * 3 + 2] = cb;
      dotAlpha[j] = a;
      dotPx[j] = dotPxSize;
    }
    return DOT_N;
  }

  /**
   * 写光点层与光晕层缓冲（容量一次分配到位，每帧只改数据 + setDrawRange，不重建）。
   *
   * 光点（现行 1 舰 1 点）：先按**屏幕空间点阵**（cell 边长 `DOT_PITCH_MIN_PX`）分桶，每格只出 1 个点：
   *   · 近处：格边长 > 阵型格距的屏幕投影 ⇒ 每格至多 1 舰 ⇒ 自然退化为"1 舰 1 点"（用户要的语义）；
   *   · 远处：多舰落进同一格 ⇒ 合并成 1 点 ⇒ 屏幕上点距恒 ≥ DOT_PITCH_MIN_PX ⇒ **永不重叠成块、也永不空白**。
   *   点屏径 = max(DOT_MIN_PX, px × DOT_SCALE) × (1−grow) × (旗舰放大系数)；alpha 有下限（见下），
   *   **不再有"太远 ⇒ alpha=0 ⇒ 不可见"的分支**（那正是"整队可见、单舰却看不见"的成因）。
   *
   * 【旗舰方案·第三遍】"被同格邻舰挤掉的旗舰"要**补写**自己的光点（否则用户看到代表旗舰的点消失）：
   *   · 为什么会被挤掉：格胜出优先级是「① 已持实体者 → ② px 大者 → ③ key 最小者」，而旗舰的 px 优势
   *     仅 `FLAGSHIP_VISUAL_GAIN`(1.7×)，打不过同格邻舰 2~4× 的**距离**优势（越近投影越大）——
   *     故"px 大者胜"这条对旗舰**不构成保护**。`FLAGSHIP_DOT_GAIN`(2.4×) 只放大点径，**不参与**胜出优先级。
   *   · 为什么是"补写"而不是"让旗舰赢下该格"：后者会驱逐同格的一个普通舰 → 该舰变成新的"隐形洞"
   *     （与 (a)/(b)/(c)/(d) 已验收的"每格恒有代表点、永不空白"判定冲突）；补写是**纯增量**：
   *     至多多写「旗舰数」个点（每帧 ≤ 6），绝不驱逐任何普通舰。
   *
   * 光晕：只给"已获实体但还没长实"的舰（meshOn < 1），随 meshOn 反向淡出，
   *       接住光点淡出后留下的亮度缺口（depthTest=false 才压得住舰体）。
   */
  private writeDotLayers() {
    const { dotPos, dotCol, dotAlpha, dotPx, haloPos, haloCol, haloAlpha, haloPx } = this;
    const DOT_CAP = DOT_SLOTS;
    let dp = 0;         // 已写光点槽位
    let hp = 0;         // 已写光晕槽位
    let dotCount = 0;   // 有效光点数（alpha > 0.02 的**胜出**舰 + 第三遍补写的旗舰，各 × DOT_N）
    let haloElig = 0;   // 处于"已获实体但未长实"区间的舰数
    let pooled = 0;     // 过实体门槛却被池上限挤出、靠光点接住的舰数
    let near = 0, mid = 0, far = 0;

    // ── 第一遍：统计分档 + 光晕写入 + 屏幕空间点阵分桶（每格选 1 个代表点）──
    const grid = this.dotGrid;
    grid.clear();
    this.flagVisBuf.length = 0;   // 【旗舰方案】第三遍用的旗舰 UnitVis 缓存（复用，不 new）
    for (const v of this.unitVis.values()) {
      const px = v.px;
      if (px >= this.lodHi) near += 1;
      else if (px >= DOT_IN_LO) mid += 1;
      else far += 1;

      const hasMesh = this.ships.has(v.key);
      if (!hasMesh && v.fleetPx >= this.lodKeep) pooled += 1;
      // 【旗舰方案】旗舰 UnitVis 直接在此登记（flagshipSet 装的是 u，UnitVis.u 才是同一个 u）：
      // 第三遍据此补写"自身没长实体却被同格邻舰挤掉的旗舰"，无需从 u 反查 key（避免 key 规则耦合）。
      if (this.flagshipSet.has(v.u)) this.flagVisBuf.push(v);

      // 屏幕空间均匀点阵：按边长 DOT_PITCH_MIN_PX 的方格分桶，每格至多留 1 个代表点。
      // cell 坐标是连续量的 floor ⇒ 缩放时点阵平滑增减、没有阈值跳变（这是能彻底弃用 alpha=0 的原因）。
      // 字符串 key 每帧 ≤ 1400 条，分配开销可接受，换取"零碰撞"（数值 key 打包会因取整碰撞）。
      const cellKey = Math.floor(v.sx / DOT_PITCH_MIN_PX) + ',' + Math.floor(v.sy / DOT_PITCH_MIN_PX);
      const cur = grid.get(cellKey);
      if (cur === undefined) {
        grid.set(cellKey, v);
      } else {
        // 胜出者优先级（跨帧确定性，防闪烁）：
        //   ① 已持 3D 实体者优先 —— 它已有舰体表达，不该再在其上叠一个点（点会被 1−grow 压暗）；
        //   ② 否则 px 大者（更近/更大者更该被看见）；
        //   ③ 再相同则 key 字典序最小者（同源稳定）。
        const candWins = (hasMesh !== this.ships.has(cur.key))
          ? hasMesh
          : (px !== cur.px ? px > cur.px : v.key < cur.key);
        if (candWins) grid.set(cellKey, v);
      }

      // 光晕：与点阵分桶无关，逐舰写（只给"已获实体但还没长实"的舰）
      if (hasMesh) {
        if (v.grow < 1) haloElig += 1;
        const ha = Math.pow(1 - v.grow, 1.5) * 0.5;
        if (ha > 0.01 && hp < MAX_MESHES) {
          dotTmpColor.setHex(factionColor(this.getFac(v.u.factionId) || {}));
          if (this.flagshipSet.has(v.u)) dotTmpColor.lerp(WHITE, 0.45);
          haloPos[hp * 3] = v.x; haloPos[hp * 3 + 1] = v.y; haloPos[hp * 3 + 2] = v.z;
          // 光晕比光点略亮一点（×1.2 而不是 ×1.15），读作"正在成形的舰"
          haloCol[hp * 3] = Math.min(1, dotTmpColor.r * 1.2);
          haloCol[hp * 3 + 1] = Math.min(1, dotTmpColor.g * 1.2);
          haloCol[hp * 3 + 2] = Math.min(1, dotTmpColor.b * 1.2);
          haloAlpha[hp] = ha;
          haloPx[hp] = px * DOT_SCALE * HALO_GAIN;
          hp += 1;
        }
      }
    }

    // ── 第二遍：只给每格的胜出者写点 ──
    this.dotWinnerKeys.clear();
    for (const v of grid.values()) {
      // 登记本格胜出者 key：**即使下面因 a ≤ 0.02 跳过写点也必须登记** ——
      // 该格已有实体表达，第三遍不该再给它补旗舰点（否则重复）。
      this.dotWinnerKeys.add(v.key);
      const wrote = this.writeOneDot(v, dp);
      dp += wrote;
      dotCount += wrote;
    }

    // ── 第三遍：补写"被同格邻舰挤掉、且自身还没长成实体"的旗舰光点（纯增量，绝不驱逐普通舰）──
    // 根因与"为什么是补写而非让旗舰赢下该格"详见本函数头注【旗舰方案·第三遍】。
    // flagVisBuf 由第一遍收集（UnitVis 直取，不从 u 反查 key，避免 key 规则耦合）。
    for (const v of this.flagVisBuf) {
      if (this.ships.has(v.key)) continue;         // 旗舰自己已有实体表达，不需要补点
      if (this.dotWinnerKeys.has(v.key)) continue; // 它已是本格胜出者，第二遍已写过
      if (dp + DOT_N > DOT_CAP) break;             // 容量守卫：写满即停（纯增量，先来先得）
      const wrote = this.writeOneDot(v, dp);
      if (wrote === 0) continue;                   // 理论不会发生（grow=0 ⇒ a ≥ 0.78 > 0.02，且容量已守卫）
      dp += wrote;
      dotCount += wrote;
    }

    // drawRange 截断即"未占用槽位不参与绘制"，无需清零残留数据
    if (this.dotGeo) {
      this.dotGeo.setDrawRange(0, dp);
      if (dp > 0) {
        this.dotGeo.attributes.position.needsUpdate = true;
        this.dotGeo.attributes.aColor.needsUpdate = true;
        this.dotGeo.attributes.aAlpha.needsUpdate = true;
        this.dotGeo.attributes.aPx.needsUpdate = true;
      }
    }
    if (this.dotPoints) this.dotPoints.visible = dp > 0;

    if (this.haloGeo) {
      this.haloGeo.setDrawRange(0, hp);
      if (hp > 0) {
        this.haloGeo.attributes.position.needsUpdate = true;
        this.haloGeo.attributes.aColor.needsUpdate = true;
        this.haloGeo.attributes.aAlpha.needsUpdate = true;
        this.haloGeo.attributes.aPx.needsUpdate = true;
      }
    }
    if (this.haloPoints) this.haloPoints.visible = hp > 0;

    const s = this.lastStats;
    s.units = this.unitVis.size;
    s.meshes = this.ships.size;
    s.points = dotCount;
    s.halos = hp;
    s.haloElig = haloElig;
    s.pooled = pooled;
    s.near = near; s.mid = mid; s.far = far;
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

  /**
   * [v12 P3] 极简帧率读数：3D 容器右下角一个 DOM（默认关，设置 battle3dShowFps 开启时才建）。
   * 复用 billboard 层的"建在 overlay / destroy 移除"思路，但不写进 BB_CSS —— 用内联样式保持自包含。
   * 纯展示、`pointer-events:none`（不吃点击），等宽字体，约 4Hz 刷新（见 updateFpsReadout）。
   */
  private initFpsReadout() {
    if (!this.fpsOn || this.fpsEl) return;
    const el = document.createElement('div');
    el.className = 'b3d-fps';
    el.style.cssText =
      'position:absolute;right:10px;bottom:8px;z-index:7;pointer-events:none;' +
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:700;' +
      'line-height:1;color:#22d3ee;text-shadow:0 1px 2px #000;background:rgba(10,16,28,.5);' +
      'padding:3px 6px;border-radius:4px';
    el.textContent = '-- FPS';
    this.container.appendChild(el);
    this.fpsEl = el;
  }

  /** [v12 P3] 累计帧数/时长，约 4Hz 把 FPS 写进 DOM。默认关时零开销（早返回）。 */
  private updateFpsReadout(dt: number) {
    if (!this.fpsOn || !this.fpsEl) return;
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.25) {
      const fps = this.fpsAccum > 0 ? Math.round(this.fpsFrames / this.fpsAccum) : 0;
      this.fpsEl.textContent = fps + ' FPS';
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  }

  private createBillboard(fleet: any, team: number): FleetBillboard {
    if (fleet?._scoutFlight) return this.createScoutBillboard(fleet, team);
    const root = document.createElement('div');
    root.className = 'b3d-bb';

    const nameEl = document.createElement('div');
    nameEl.className = 'b3d-bb-name';
    root.appendChild(nameEl);

    const hpBar = document.createElement('div');
    hpBar.className = 'b3d-bb-bar';
    const hpFill = document.createElement('div');
    hpBar.appendChild(hpFill);
    const bars = document.createElement('div');
    bars.className = 'b3d-bb-bars';
    hpBar.title = '舰体耐久';
    bars.appendChild(hpBar);

    const spBar = document.createElement('div');
    spBar.className = 'b3d-bb-bar';
    const supplyFill = document.createElement('div');
    spBar.appendChild(supplyFill);
    spBar.title = '补给';
    bars.appendChild(spBar);

    const moraleBar = document.createElement('div');
    moraleBar.className = 'b3d-bb-bar';
    const moraleFill = document.createElement('div');
    moraleBar.appendChild(moraleFill);
    moraleBar.title = '士气';
    bars.appendChild(moraleBar);
    root.appendChild(bars);

    // ── 三概念之「态势」：当前指令 / 战术角色 / 交战状态 / 损管 + 意图行（design §Fleet billboard）──
    const statusGroup = document.createElement('div');
    statusGroup.className = 'b3d-bb-group';
    const statusTag = document.createElement('span');
    statusTag.className = 'b3d-bb-grouptag';
    statusTag.textContent = '态势';
    statusGroup.appendChild(statusTag);
    const missionEl = document.createElement('div');
    missionEl.className = 'b3d-bb-mission idle';
    statusGroup.appendChild(missionEl);
    // [W5.4] 机动可读化行：速度百分比 + 机动相位（战列起步 8.3s 不再"看着没反应"）
    const maneuverEl = document.createElement('div');
    maneuverEl.className = 'b3d-bb-maneuver';
    statusGroup.appendChild(maneuverEl);
    root.appendChild(statusGroup);

    // ── 三概念之「行动」：侦察 / 电子战 / 保持等情境特令（移动与攻击由右键直接承担，不设常驻按钮）──
    // [W3] 按钮创建与权威解耦：我方恒建，可用性由 updateBillboards 逐帧按当前指挥权威派生
    //   （design：controls derived from current authority on every update, not frozen at creation）。
    const stanceBtns: HTMLButtonElement[] = [];
    let splitBtn: HTMLButtonElement | null = null;
    const playerTeam = ((this.store as any).factions || []).find((f: any) => f.type === 'player')?.team ?? 1;
    let controlsEl: HTMLDivElement | null = null;
    if (team === playerTeam) {
      const wrap = document.createElement('div');
      wrap.className = 'b3d-bb-stances';
      wrap.setAttribute('aria-label', '旗舰行动');
      controlsEl = wrap;
      for (const stance of ['search', 'electronic', 'siege', 'defend'] as const) {
        const btn = document.createElement('button');
        btn.className = 'b3d-bb-btn';
        btn.dataset.stance = stance;
        btn.textContent = stance === 'search' ? '索敌'
          : stance === 'electronic' ? '电子战'
          : stance === 'siege' ? '攻坚' : '驻守';
        btn.title = stance === 'search' ? '搜索并接敌；三向侦察由战队自动执行'
          : stance === 'electronic' ? '有电子战舰时启用干扰与欺骗'
          : stance === 'siege' ? '以攻坚阵型推进并争夺目标' : '保持阵地并保护控制区';
        // 阻止冒泡到 canvas：否则点按钮会连带触发地块拾取/框选
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fid = fleet?.id;
          if (fid === undefined) return;
          const fn = this.store?.dispatchFleetCommand;
          if (typeof fn === 'function') {
            const isElectronic = stance === 'electronic';
            fn(fid, isElectronic ? 'electronic' : 'stance', isElectronic ? undefined : stance);
          }
          else this.opts.onError?.(`[3D] 姿态切换失败：store.dispatchFleetCommand 不可用`);
        });
        wrap.appendChild(btn);
        stanceBtns.push(btn);
      }
      // ── 三概念之「分舰」：打开分遣计划（战法规划 + 合格性门 canSplit），不是即时拆分 ──
      //   与快捷键 `X` 共用 splitFleetById 同一入口（内含战法选择与分兵禁止条件）。
      splitBtn = document.createElement('button');
      splitBtn.className = 'b3d-bb-btn';
      splitBtn.textContent = '分舰';
      splitBtn.title = '分遣计划：按战法规划拆分多路（需合格计划，不合格会说明原因；快捷键 X）';
      splitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      splitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fid = fleet?.id;
        if (fid === undefined) return;
        const fn = (this.battleScene as any)?.splitFleetById;
        if (typeof fn === 'function') fn.call(this.battleScene, fid);
      });
      wrap.appendChild(splitBtn);
      root.appendChild(wrap);
    }

    this.bbLayer!.appendChild(root);
    return {
      root, nameEl, hpFill, supplyFill, moraleFill, controlsEl, stanceBtns, splitBtn, missionEl, maneuverEl,
      lastStance: '', lastIntent: '', lastTeam: team, lastHpPct: -1, lastSupply: -1, lastMorale: -1,
    };
  }

  /** 侦察航班不是舰队：只显示方向/状态/生命，不生成姿态、分兵或命令按钮。 */
  private createScoutBillboard(_fleet: any, team: number): FleetBillboard {
    const root = document.createElement('div');
    root.className = 'b3d-bb b3d-bb-scout';
    root.style.pointerEvents = 'none';
    const nameEl = document.createElement('div');
    nameEl.className = 'b3d-bb-name';
    root.appendChild(nameEl);
    const hpBar = document.createElement('div');
    hpBar.className = 'b3d-bb-bar';
    const hpFill = document.createElement('div');
    hpBar.appendChild(hpFill);
    root.appendChild(hpBar);
    const missionEl = document.createElement('div');
    missionEl.className = 'b3d-bb-mission';
    root.appendChild(missionEl);
    this.bbLayer!.appendChild(root);
    return {
      root, nameEl, hpFill, supplyFill: null as any, moraleFill: null, controlsEl: null,
      stanceBtns: [], missionEl,
      lastStance: '', lastIntent: '', lastTeam: team, lastHpPct: -1, lastSupply: -1, lastMorale: -1,
    };
  }

  private destroyBillboard(bb: FleetBillboard) {
    bb.root.remove();
  }

  /**
   * 3D 的所有敌情呈现都以 BattleScene 写出的情报档位为准。
   * 己方/友方可见；敌方只有 `_intelDisplayMode === 'live'`（实时确认/交战强制/档案+实时重捕获）
   * 才可显示完整舰队、意图或补给链——「末次位置」档案接触只画情报标记，不算实时可见。
   */
  private isFleetIntelVisible(fleet: any): boolean {
    if (!fleet) return false;
    const fac: any = this.getFac(fleet.factionId) || {};
    const player = ((this.store as any).factions || []).find((f: any) => f.type === 'player');
    const playerTeam = player?.team ?? 1;
    if (fac.team === playerTeam) return true;
    const mode = (fleet as any)._intelDisplayMode;
    if (mode != null) return mode === 'live';
    // 档位尚未写出（首帧前）时退回接触记忆判定，避免闪烁误显
    return (fleet as any)._intelContactState === 'identified';
  }

  /** Explicit alias keeps intent rendering from accidentally bypassing fog gates. */
  private isEnemyIntelVisible(fleet: any): boolean {
    return this.isFleetIntelVisible(fleet);
  }

  /** ★ v8 **运输舰**的迷雾可见性 —— 只用「它的归属阵营 + 它自己的坐标」，**不读任何舰队容器**。
   *    · 归属取 `aux.factionId`（唯一真源）；己方/友方恒可见；
   *    · 敌方：按**自身位置**判断"我方传感器是否覆盖到它"（舰队 250 / 索敌 450、建筑 300），
   *      与"它曾经承载在哪支舰队"完全无关（`AuxShip.fleet` 已删除，也没有容器可读）。
   *    ⚠ 与 2D 的 `sprite.visible` 同口径：2D 已在 BattleScene 按同一规则写可见性，
   *      这里再算一次是为了补给圈/链路（它们不是 sprite，需独立判定）。 */
  private isAuxIntelVisible(aux: any): boolean {
    const fac: any = this.getFac(aux?.factionId) || {};
    const player = ((this.store as any).factions || []).find((f: any) => f.type === 'player');
    const playerTeam = player?.team ?? 1;
    if (fac.team === playerTeam) return true;
    if (typeof aux?.x !== 'number' || typeof aux?.y !== 'number') return false;
    const bs: any = this.battleScene;
    const mine: any[] = (bs.globalFleets || []).filter((fl: any) => {
      const f = this.getFac(fl.factionId);
      return !!f && f.team === playerTeam;
    });
    for (const fl of mine) {
      const units: any[] = fl.units || [];
      if (units.length === 0 || !units[0].sprite) continue;
      const range = fl.stance === 'search' ? 450 : 250;
      if (Math.hypot(aux.x - units[0].sprite.x, aux.y - units[0].sprite.y) <= range) return true;
    }
    // 我方建筑（雷达 300）—— 与 BattleScene 的迷雾节点同口径
    const tiles: any[] = bs.tilesList || [];
    for (const t of tiles) {
      if (t.type !== 'castle' && t.type !== 'tower' && t.type !== 'planet' && t.type !== 'relay') continue;
      const tf = this.getFac(t.ownerId);
      if (!tf || tf.team !== playerTeam) continue;
      if (Math.hypot(aux.x - t.x, aux.y - t.y) <= 300) return true;
    }
    return false;
  }

  /** 迷雾情报：敌方 castle 标记（信标柱/模型）未发现前隐藏，正向确认后永久常驻 */
  private updateCastleIntelVisibility() {
    if (this.castleMarkers.size === 0) return;
    const bs: any = this.battleScene;
    const player = ((this.store as any).factions || []).find((f: any) => f.type === 'player');
    const playerTeam = player?.team ?? 1;
    this.castleMarkers.forEach((objs, ownerId) => {
      const fac: any = this.getFac(ownerId) || {};
      const visible = fac.team == null || fac.team === playerTeam
        ? true
        : !!(bs.isEnemyBaseKnownTo ? bs.isEnemyBaseKnownTo(playerTeam, fac) : true);
      for (const o of objs) o.visible = visible;
    });
  }

  /** 每帧投影更新：舰队 3D 锚点（所属舰船质心 + 抬高）→ 屏幕坐标 */
  private updateBillboards() {
    if (!this.bbLayer) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;

    // 1) 按舰队聚合质心（复用 Map，避免每帧分配）
    //    数据源必须是 unitVis（全部存活单位）而不是 this.ships（只含拿到实体的单位）：
    //    池化后远处舰队可能一艘实体都没有，若按 ships 聚合，整支舰队的 billboard 会消失。
    const acc = this.bbAccum;
    acc.clear();
    this.unitVis.forEach((v) => {
      const fleet = v.fleet;
      if (!fleet) return;
      // v8：运输舰不挂舰队名牌（它是独立资产，名牌会显示成"幽灵舰队"）
      if ((fleet as any)._isAux) return;
      const fid = fleet.id !== undefined ? fleet.id : fleet.factionId;
      const key = `f${fid}`;
      let a = acc.get(key);
      if (!a) { a = { fleet, n: 0, sx: 0, sy: 0, sz: 0 }; acc.set(key, a); }
      a.n++;
      a.sx += v.x;
      a.sy += v.y;
      a.sz += v.z;
    });

    const alive = new Set<string>();
    const camPos = this.camera.position;

    acc.forEach((a, key) => {
      alive.add(key);
      const fleet = a.fleet;
      const fac = this.getFac(fleet.factionId) || {};
      if (!this.isFleetIntelVisible(fleet)) return;
      const team = fac.team ?? (fleet.factionId === 1 ? 1 : 2);
      const units: any[] = fleet.units || [];

      // 数据：HP 取全舰求和，补给取旗舰（与 BattleScene 生成 fleetsUI 的口径一致）
      let hp = 0, maxHp = 0;
      units.forEach((u: any) => { hp += u.hp || 0; maxHp += u.maxHp || 0; });
      const flagship = units.find((u: any) => u.isFlagship) || units[0];
      const supply = flagship ? (flagship.supply ?? 100) : 100;
      const morale = Math.max(0, Math.min(100, Number(fleet.morale ?? 100)));
      const hpPct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;

      let bb = this.billboards.get(key);
      if (!bb) {
        bb = this.createBillboard(fleet, team);
        this.billboards.set(key, bb);
      }

      // 文本/数值 diff 后才写 DOM
      const bsS: any = this.battleScene;
      const supremeMark = !fleet._scoutFlight && bsS?.supremeCommanderId != null && fleet.commanderId === bsS.supremeCommanderId ? '◆' : '';
      const sectorName = fleet.scoutSector === 'left' ? '左' : fleet.scoutSector === 'right' ? '右' : '中';
      // [v63] 分舰队对象由 splitFleet `{...parent}` 派生、共用 factionId ⇒ fac.name 与母队同名，
      //   3D 标签成对出现且无法分辨（用户实报"标签重叠"）。分队（_detachedFrom 非空）加后缀。
      // [v64] 后缀取 `_maneuverIntent`（战法路数中文意图，同一战法内各路互不相同：左翼包夹/右翼包夹…），
      //   固定「·分队」在两翼包抄（pincer 一次拆 2 队）下会同名 ⇒ 又回到"无法分辨"；无 intent 才落回「·分队」。
      const baseName = fac.name || (team === 1 ? '我方舰队' : '敌方舰队');
      const name = fleet._scoutFlight ? `侦察·${sectorName}`
        : (fleet._detachedFrom != null ? `${baseName}·${fleet._maneuverIntent || '分队'}` : baseName);
      // [v12.1] 删除「显示 N 艘（1∶K）」后缀：早期测试用，用户判定不需要；标签只留舰队名。
      if (bb.lastTeam !== team) { bb.lastTeam = team; }
      const label = `${supremeMark}${name}`;
      if (bb.nameEl.textContent !== label) {
        bb.nameEl.textContent = label;
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
      if (bb.lastMorale !== morale) {
        bb.lastMorale = morale;
        if (bb.moraleFill) {
          bb.moraleFill.style.width = `${morale.toFixed(1)}%`;
          bb.moraleFill.style.background = morale > 40 ? '#a78bfa' : '#f59e0b';
        }
      }
      const stance = String(fleet.stance || '');
      if (bb.lastStance !== stance) {
        bb.lastStance = stance;
        bb.stanceBtns.forEach((b) => {
          b.classList.toggle('active', b.dataset.stance === stance);
        });
      }
      // [W3] 按钮可用性**逐帧**按当前指挥权威派生（design §Command succession 末条：
      //   not frozen when the billboard was first created —— 继任 / 指挥崩溃态即时反映到按钮）
      const canDirect = !!(bsS as any)?.canDirectlyControlFleet?.(fleet);
      bb.stanceBtns.forEach((b) => { b.disabled = !canDirect; });
      if (bb.splitBtn) bb.splitBtn.disabled = !canDirect;
      if (bb.controlsEl) {
        bb.controlsEl.style.display = canDirect && bsS?.battleSelectedFleetId === fleet.id ? 'flex' : 'none';
        const hasElectronicShip = units.some((u: any) => u.classType === '电子' || u.classType === 'electronic');
        bb.stanceBtns.forEach((b) => { if (b.dataset.stance === 'electronic') b.hidden = !hasElectronicShip; });
      }

      // 提督扮演 C：意图文本（[W3] 权威决策输出 _intentLabel —— 奉令/临机/交战/整补前缀优先；
      //   否则任务文本 / 状态机推导，敌方 AI 同口径）
      const intent = fleet._intentLabel
        ? String(fleet._intentLabel)
        : fleet._scoutFlight
        ? (fleet.state === 'returning' ? '回传返航' : fleet.state === 'sweeping' ? '前沿搜索' : '高速前出')
        : (fleet.directOrder
          // [W5.4] 玩家直接指令优先于一般意图文本（右键 ↓ 之后立刻可见"接令"）
          ? (fleet.directOrder.kind === 'attack' ? '▸ 接令 · 攻击目标' : '▸ 接令 · 机动至指定点')
          : fleetIntentText(fleet, (fid: any) => {
            const tf = bsS?.globalFleets?.find((x: any) => x.id === fid);
            return tf ? (this.getFac(tf.factionId)?.name || null) : null;
          }, { team }));
      if (bb.lastIntent !== intent) {
        bb.lastIntent = intent;
        bb.missionEl.textContent = intent;
        bb.missionEl.classList.toggle('idle', !fleet.mission && !fleet.directOrder);
      }

      // [W5.4] 机动可读化：速度% = |v| / vMax（vMax 走 fleetProfile 单一真源），
      //   相位 = `_combatControl.phase`（BattleScene:7394 写入的 advanceManeuver 输出）。
      //   ⇒ 把"起步 8.3s 像没反应"变成可读的"机动 巡航 · 速度 35%"。
      if (bb.maneuverEl) {
        const vmax = fleetProfile(units).vMax || 0;
        const spd = Math.hypot(Number(fleet.vx) || 0, Number(fleet.vy) || 0);
        const pct = vmax > 0 ? Math.max(0, Math.min(200, Math.round(spd / vmax * 100))) : 0;
        const phaseCn: Record<string, string> = { cruise: '巡航', brake: '制动', turn: '转向', reform: '重组', disengage: '脱离' };
        const phaseKey = String(fleet._combatControl?.phase || '');
        const phaseTxt = phaseCn[phaseKey] || (fleet.state === 'moving' ? '机动' : '待机');
        const mtxt = `机动 ${phaseTxt} · 速度 ${pct}%`;
        if (bb.lastManeuver !== mtxt) { bb.lastManeuver = mtxt; bb.maneuverEl.textContent = mtxt; }
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

  /** [v60] 浮动句 DOM 气泡锚定投影：与 updateBillboards 同一台相机、同一 CSS px 口径
   *（container.clientWidth/Height + 屏幕左上原点）。锚点两种：
   *  · unit —— 直接吃本帧 unitVis 的 3D 位置（含地形高/分层/档位，与渲染实体同位）；
   *  · 固定世界点（击毁语录）—— Phaser 世界 (x, y) 按 (x, 巡航高, −y) 映射。
   * 视锥外返回 on=false，调用方把气泡移出视口隐藏（不钳在边缘 —— 用户实报
   * "气泡飘在窗口外/别的地方"的根修：旧实现用 Phaser 相机投影，与真实渲染相机不同源）。
   * 2D 降级（无 overlay）时由调用方回退 Phaser 投影。 */
  public floatScreenPos(a: { u?: any; x?: number; y?: number }): { x: number; y: number; on: boolean } {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    let wx = 0; let wy = 0; let wz = 0;
    if (a.u) {
      let vv: UnitVis | null = null;
      for (const v of this.unitVis.values()) { if (v.u === a.u) { vv = v; break; } }
      if (!vv || !vv.seen) return { x: -999, y: -999, on: false };
      wx = vv.x; wy = vv.y; wz = vv.z;
    } else {
      wx = a.x ?? 0; wz = -(a.y ?? 0); wy = this.groundYAt(wx, -wz) + this.cruiseClearance;
    }
    const v = this.bbProjV.set(wx, wy, wz);
    v.project(this.camera);
    const on = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, on };
  }

  // ---------- 指挥制后勤战 3D 可视化 ----------
  /** 像素地面高度：纯宇宙无地形，恒 0（原「3D 沙盘走 heightAtPx」分支已删除） */
  private groundYAt(_xPix: number, _yPix: number): number {
    return 0;
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

  /** 每帧同步后勤可视化：后勤站 / 星球中继 / 运输舰（v12.1 起舰队补给状态环已移除） */
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
    const playerFac0 = ((this.store as any).factions || []).find((f: any) => f.type === 'player');
    const playerTeam0 = playerFac0?.team ?? 1;

    // ── 1) 司令部信标（castlePos 处）——v6.7 重做：CRT 线框向量语言 ──
    //    v6.6 的"实心装甲基座+舰桥塔+双 Torus 防御环"被用户判定为魔法阵风格
    //    （实心紫色几何体+交叉粗环=占星符号），且与全局 CRT 扫描线/线框向量
    //    语言断裂。v6.7 对齐 buildSpaceWorld 引力异常区的既有线框语言
    //    （MeshBasicMaterial wireframe）：两节线框六棱柱基座 + 一颗自旋线框
    //    八面体核心，共 3 个 mesh，无实心部件。六棱柱与地图六角格同构，
    //    "格子里的指挥节点"语义自洽。
    const facs: any[] = (this.store as any)?.factions || [];
    const seenFac = new Set<number>();
    facs.forEach((f: any) => {
      if (!f?.castlePos) return;
      const tf = this.getFac(f.id) || f;
      const team = tf.team ?? f.team;
      seenFac.add(f.id);
      let m = this.supCastle.get(f.id);
      const gy = this.groundYAt(f.castlePos.x, f.castlePos.y);
      if (!m) {
        const col = teamColor(team);
        // v6.10：出生点基地模型优先（assets/scene/base.glb，阵营差异 base_{trait}.glb 优先）。
        //   有模型 → 模型 holder（贴地，尺寸见 sceneProps.SCENE_PROP_CONFIG.base）；
        //   无模型 → 保持 v6.7 线框三件套（两节六棱柱基座 + 自旋八面体核心）。
        const facTrait: 'empire' | 'alliance' = (tf?.trait === 'empire') ? 'empire' : 'alliance';
        const modelHolder = this.tryAttachSceneProp('base', f.castlePos.x, gy, -f.castlePos.y, col, this.supplyGroup!, facTrait);
        if (modelHolder) {
          const ring = this.makeSupplyRing(SUPPLY_SOURCE_RADIUS, col, 0.26);
          this.supplyGroup!.add(ring);
          m = { grp: modelHolder, ring, isModel: true };
          this.supCastle.set(f.id, m);
        } else {
          const grp = new THREE.Group();
          const S = R * 2.4;   // 特征尺寸（≈2.4 hexR，保持体量大于中继站）
          const mkWire = (c: number, op = 0.55) =>
            new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: op });

          // ① 线框六棱柱基座 ×2（对齐地图六角格同构，暗→亮两层）
          const base = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.55, S * 0.68, S * 0.14, 6), mkWire(col, 0.35));
          base.position.y = S * 0.07;
          const deck = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.32, S * 0.42, S * 0.12, 6), mkWire(col, 0.55));
          deck.position.y = S * 0.24;
          grp.add(base, deck);

          // ② 线框八面体核心（悬停，每帧自旋——"活的指挥节点"）
          const core = new THREE.Mesh(new THREE.OctahedronGeometry(S * 0.28), mkWire(col, 0.85));
          core.position.y = S * 0.62;
          grp.add(core);
          this.fortressRings.push(core);

          // ③ 补给圈（保留原语义：SUPPLY_SOURCE_RADIUS 阵营色）
          const ring = this.makeSupplyRing(SUPPLY_SOURCE_RADIUS, col, 0.26);

          this.supplyGroup!.add(grp, ring);
          m = { grp, ring };
          this.supCastle.set(f.id, m);
        }
      }
      m.grp.position.set(f.castlePos.x, gy, -f.castlePos.y);
      // 阵营色同步：
      //   模型路径 → sceneProps 口径（体色×0.55 + 线框提亮，与舰船同源）；
      //   线框兜底路径 → 直接刷 color（MeshBasicMaterial wireframe 无 emissive）。
      if (!(m.isModel && applyScenePropColor(m.grp, teamColor(team)))) {
        m.grp.traverse((o: any) => {
          const mat = o?.material as THREE.MeshBasicMaterial | undefined;
          if (mat?.color) mat.color.setHex(teamColor(team));
        });
      }
      m.ring.position.set(f.castlePos.x, gy + R * 0.3, -f.castlePos.y);
      (m.ring.material as THREE.LineBasicMaterial).color.setHex(teamColor(team));
      // 敌方基地迷雾门（design §Fog and intelligence）：未发现不渲染，正向确认后**永久常驻**可见
      const baseVisible = team === playerTeam0
        ? true
        : !!(bs.isEnemyBaseKnownTo ? bs.isEnemyBaseKnownTo(playerTeam0, f) : true);
      m.grp.visible = baseVisible;
      m.ring.visible = baseVisible;
    });
    this.supCastle.forEach((m, id) => {
      if (seenFac.has(id)) return;
      // v6.6：同步摘除要塞防御环的自旋注册（避免悬挂引用每帧空转）
      m.grp.traverse((o: any) => {
        const idx = this.fortressRings.indexOf(o);
        if (idx >= 0) this.fortressRings.splice(idx, 1);
      });
      this.supplyGroup!.remove(m.grp, m.ring);
      // v6.10：模型路径同步摘除槽位（避免 updateSceneProps 继续访问已移除的 holder）
      this.scenePropSlots = this.scenePropSlots.filter(s => s.holder !== m.grp);
      m.grp.traverse((o: any) => { if (o !== m.grp) this.disposeObject(o); });
      this.disposeObject(m.ring);
      this.supCastle.delete(id);
    });

    // ── 2) 星球/中继补给站：补给圈（中立灰 0x9ca3af；占领后转阵营色）──
    // v6.3：中继圈半径 = SUPPLY_RELAY_RADIUS（500），中立圈透明度降档 0.35→0.22、
    //   线宽改细（半径 48 段 LineLoop 无线宽概念，靠透明度区分）——
    //   v6.2 的 1.5× 半径 + 全量中继导致满屏大灰圈（用户实报"越设计越丑"）。
    //   圈尺寸随占领状态变化 → 半径不再是创建时常量，改存 key 并按需重建。
    const tiles: any[] = bs.tilesList || [];
    const seenTiles = new Set<any>();
    tiles.forEach((t: any) => {
      if (t?.type !== 'planet' && t?.type !== 'relay') return;
      seenTiles.add(t);
      const tf = t.ownerId > 0 ? this.getFac(t.ownerId) : null;
      const col = tf ? teamColor(tf.team) : 0x9ca3af;
      const isRelay = t.type === 'relay';
      const radius = isRelay ? SUPPLY_RELAY_RADIUS : R * 1.6;
      const opacity = tf ? (isRelay ? 0.6 : 0.55) : 0.22;
      const key = `${isRelay ? 'relay' : 'planet'}_${tf ? 'owned' : 'neutral'}`;
      let ring = this.supPlanets.get(t);
      if (!ring) {
        ring = this.makeSupplyRing(radius, col, opacity, 48);
        (ring as any)._vizKey = key;
        this.supplyGroup!.add(ring);
        this.supPlanets.set(t, ring);
      } else if ((ring as any)._vizKey !== key) {
        // 占领状态切换（中立↔占领）→ 半径/透明度变了，重建圈
        this.supplyGroup!.remove(ring);
        this.disposeObject(ring);
        ring = this.makeSupplyRing(radius, col, opacity, 48);
        (ring as any)._vizKey = key;
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

    // ── 3) 运输舰：独立坐标 + 补给圈 + 链路（v3 独立往返制）──
    // 真模型由 syncShips() 走正常舰船管线（alliance_supply.glb / buildSupplyShip 兜底），
    // 其 2D sprite 已由 BattleScene 按 aux.x/y 同步 → 此处只画补给圈与链路，不再画锥体。
    const auxShips: any[] = bs.auxShips || [];
    const seenAux = new Set<any>();
    auxShips.forEach((aux: any) => {
      if (!aux?.unit || aux.unit.hp <= 0) return;
      // 敌方运输舰既是可攻击目标，也必须先被识别；补给圈和航线不能越过迷雾泄漏其位置。
      // v8：归属只取 `aux.factionId`，档位按**它自己的坐标**判定（见 isAuxIntelVisible）。
      if (!this.isAuxIntelVisible(aux)) return;
      const key = aux.unit;   // aux 包装对象每帧重建，unit 引用稳定
      seenAux.add(key);
      const ax = aux.x;       // 独立坐标（不再 fleet.x + 偏移）
      const ay = aux.y;
      const active = aux.state === 'outbound' || aux.state === 'supplying';
      let m = this.supAux.get(key);
      if (!m) {
        const ring = this.makeSupplyRing(SUPPLY_AUX_RADIUS, 0xfb923c, 0.30, 56);
        const linkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const link = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.5, depthWrite: false }));
        const homeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const homeLink = new THREE.Line(homeGeo, new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.3, depthWrite: false }));
        this.supplyGroup!.add(ring, link, homeLink);
        m = { ring, link, homeLink };
        this.supAux.set(key, m);
      }
      const gyA = this.groundYAt(ax, ay);
      // 补给圈：仅出航/补给时可见
      m.ring.visible = active;
      m.ring.position.set(ax, gyA + R * 0.3, -ay);
      // 补给连线：出航/补给时连目标舰队
      if (active && aux.targetFleet) {
        const tf = aux.targetFleet;
        m.link.visible = true;
        const pos = (m.link.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, ax, gyA + R * 0.5, -ay);
        pos.setXYZ(1, tf.x, this.groundYAt(tf.x, tf.y) + R * 0.5, -tf.y);
        pos.needsUpdate = true;
      } else {
        m.link.visible = false;
      }
      // 母港连线：装货/返航时表现"挂在补给线上"
      if (aux.state === 'loading' || aux.state === 'returning') {
        m.homeLink.visible = true;
        const pos = (m.homeLink.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, aux.homeX, this.groundYAt(aux.homeX, aux.homeY) + R * 0.5, -aux.homeY);
        pos.setXYZ(1, ax, gyA + R * 0.5, -ay);
        pos.needsUpdate = true;
      } else {
        m.homeLink.visible = false;
      }
    });
    this.supAux.forEach((m, key) => {
      if (seenAux.has(key)) return;
      this.supplyGroup!.remove(m.ring, m.link, m.homeLink);
      this.disposeObject(m.ring); this.disposeObject(m.link); this.disposeObject(m.homeLink);
      this.supAux.delete(key);
    });

    // [v12.1] 舰队补给状态环（断链红环/在链绿环）整体移除：用户判定无用；补给状态已由舰队标签的补给条表达。
  }

  // ---------- 提督扮演 C：3D 意图线 ----------
  /**
   * 舰队 → 当前目标的连线（解决"一窝蜂"：意图空间可见）。
   * 我方（team 1）：有任务且已解算目的地（fleet._missionDest，由 BattleScene 任务循环写入）→ 青色线；
   * 敌方：engaging 且有集火目标（_lastTargetFleetId）→ 红色线。
   * 坐标映射与后勤可视同款：(pixelX, groundY + R*0.5, -pixelY)。
   */
  private updateIntentLines() {
    const bs: any = this.battleScene;
    const fleets: any[] = bs.globalFleets || [];
    if (!this.intentGroup) {
      this.intentGroup = new THREE.Group();
      this.intentGroup.name = 'intentLines';
      this.scene.add(this.intentGroup);
    }
    const R = this.hexR;
    const seen = new Set<any>();
    fleets.forEach((fl: any) => {
      if (!fl?.units || fl.units.length === 0) return;
      if (!this.isFleetIntelVisible(fl)) return;
      const fac = this.getFac(fl.factionId);
      if (!fac) return;
      let dest: any = null;
      let col = 0x22d3ee;
      if (fac.team === 1) {
        if (fl.mission && fl._missionDest) { dest = fl._missionDest; col = 0x22d3ee; }
      } else if (fl.state === 'engaging' && fl._lastTargetFleetId != null) {
        const tgt = fleets.find((x: any) => x.id === fl._lastTargetFleetId);
        if (tgt && tgt.units && tgt.units.length > 0 && this.isEnemyIntelVisible(tgt)) {
          dest = { x: tgt.x, y: tgt.y }; col = 0xef4444;
        }
      }
      if (!dest) return;
      seen.add(fl);
      let line = this.intentLines.get(fl);
      if (!line) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false }));
        this.intentGroup!.add(line);
        this.intentLines.set(fl, line);
      }
      (line.material as THREE.LineBasicMaterial).color.setHex(col);
      const gyF = this.groundYAt(fl.x, fl.y);
      const gyD = this.groundYAt(dest.x, dest.y);
      const pos = (line.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, fl.x, gyF + R * 0.5, -fl.y);
      pos.setXYZ(1, dest.x, gyD + R * 0.5, -dest.y);
      pos.needsUpdate = true;
    });
    // 回收：任务完成/目标消失的舰队 → 意图线撤除
    this.intentLines.forEach((line, fl) => {
      if (seen.has(fl)) return;
      this.intentGroup!.remove(line);
      this.disposeObject(line);
      this.intentLines.delete(fl);
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

  /**
   * fx 事件的生成高度 —— **必须与舰体同源**。
   *
   * 舰体 Y = `h + cruiseClearance + layY(队内 5 层) + tierY(队间 3 档)`（见 syncShips 第一遍），
   * 而 handleFx 早期一律只取 `h + cruiseClearance` ⇒ 激光 / 护盾 / 命中爆闪 / 导弹 与它们所属的舰
   * **在纵向上脱开**。验收方静态量化的最大落差：`layY ±23.56 + tierY ±70.00 = ±93.56` 世界单位，
   * 在既有验收机位上是 **0.43~0.95 个舰长**的屏幕错位（26_grand_6v6_plan 0.95 / 25 0.65 / 04_close 0.65）。
   *
   * 口径：按事件带来的屏幕像素坐标**反查该单位本帧的实际 Y**（`unitVis` 由 syncShips 在本帧更早重建，
   * 见 update() 的调用顺序），查不到时回落巡航高度 —— 要塞主炮 / 星球 / 已阵亡单位本就与舰队分层无关。
   *
   * ⚠ 只对齐"生成点高度"这一处：**不动 fx3d 的事件结构、不动各类特效的配额与配色**
   *   （用户明确要求交战特效沿用游戏原版）。舰船本身不可点击（只有 hex tile 有 setInteractive），
   *   故不存在"点选错舰"风险，此处的真实缺陷只有画面错位。
   */
  private fxYAtPx(pxX: number, pxY: number): number {
    for (const v of this.unitVis.values()) {
      const sx = v.u?.sprite?.x;
      const sy = v.u?.sprite?.y;
      if (sx === undefined || sy === undefined) continue;
      // 事件里的坐标就是该帧 sprite.x/y 原值 → 精确匹配即可（不用容差扫描，避免误配到邻舰）
      if (Math.abs(sx - pxX) < 0.01 && Math.abs(sy - pxY) < 0.01) return v.y;
    }
    return this.heightAtPx(pxX, pxY) + this.cruiseClearance;
  }

  /** fx 事件坐标 → 世界坐标（Y 走 fxYAtPx，与舰体同源） */
  private fxPointAt(p: { x: number; y: number }): THREE.Vector3 {
    return this.pxToWorld(p.x, p.y, this.fxYAtPx(p.x, p.y));
  }

  // ═══ [W3] 指针反馈（design §Pointer feedback）══════════════════════════
  //   · 地面左键不落任何标记；成功右键移动 ⇒ 精确目的地短暂 chevron/ring；
  //   · 成功右键攻击 ⇒ 敌目标短暂 target-lock；无常驻大 hex 指示；
  //   · 战斗结算 clearPointerMarkers 统一清理（design §Failure handling 末条）。
  private pointerMarks: { obj: THREE.Object3D; until: number }[] = [];

  /** 成功移动指令：在精确目的地落一枚短暂 chevron/ring（≈1.4s 淡出销毁） */
  showPointerChevron(x: number, y: number) {
    const geo = new THREE.RingGeometry(this.hexR * 0.55, this.hexR * 0.75, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x66ccff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, this.hexR * 0.2, -y);
    this.scene.add(ring);
    this.pointerMarks.push({ obj: ring, until: performance.now() + 1400 });
  }

  /** 成功攻击指令：在敌目标落一枚短暂 target-lock 标记（≈1.4s 淡出销毁） */
  showTargetLock(x: number, y: number) {
    const geo = new THREE.OctahedronGeometry(this.hexR * 0.8);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.95 });
    const lock = new THREE.LineSegments(edges, mat);
    lock.position.set(x, this.hexR * 0.5, -y);
    this.scene.add(lock);
    this.pointerMarks.push({ obj: lock, until: performance.now() + 1400 });
    geo.dispose();
  }

  /** 战斗结算清理瞬态指针标记 */
  clearPointerMarkers() {
    for (const m of this.pointerMarks) {
      this.scene.remove(m.obj);
      const mm: any = m.obj;
      mm.geometry?.dispose?.();
      mm.material?.dispose?.();
    }
    this.pointerMarks.length = 0;
  }

  /** 瞬态指针标记寿命管理（每帧：淡出 → 到期销毁） */
  private updatePointerMarks() {
    for (let i = this.pointerMarks.length - 1; i >= 0; i--) {
      const m = this.pointerMarks[i];
      const left = m.until - performance.now();
      const mat: any = (m.obj as any).material;
      if (mat) mat.opacity = Math.max(0, 0.9 * Math.min(1, left / 500));
      if (left <= 0) {
        this.scene.remove(m.obj);
        const mm: any = m.obj;
        mm.geometry?.dispose?.();
        mm.material?.dispose?.();
        this.pointerMarks.splice(i, 1);
      }
    }
  }

  // ═══ [W5.3] 指挥点即时回执：就近 DOM 浮动提示（锚在点击世界点）═══════════════
  //   通道 = `battle3dFx` 的 `pointer_notice`（右键成功/失败在**按下同帧**推送）。
  //   与 billboard 同投影（floatScreenPos）；不进 `store` 的 toast 队列（后者的 2200ms/条
  //   + 上限 10 + 串行播放会把失败提示推迟数秒 —— 用户实报"点了没反应"）。
  /** 就地弹出回执（≈1.6s 自动淡出销毁）。同点连续回执会先清掉旧的（避免叠字）。 */
  showCommandNotice(x: number, y: number, text: string, ok: boolean) {
    if (!text || !this.bbLayer) return;
    // 同一点位（±1px）已有回执 ⇒ 先移除，避免快速连点叠字
    for (let i = this.pointerNotices.length - 1; i >= 0; i--) {
      const n = this.pointerNotices[i];
      if (Math.abs(n.at.x - x) < 1 && Math.abs(n.at.y - y) < 1) {
        n.el.remove();
        this.pointerNotices.splice(i, 1);
      }
    }
    const el = document.createElement('div');
    el.className = 'b3d-cmd-notice ' + (ok ? 'ok' : 'fail');
    el.textContent = text;
    this.bbLayer.appendChild(el);
    this.pointerNotices.push({ el, at: { x, y }, until: performance.now() + 1600 });
    // 立即定位一帧（不等下帧），尽量做到"按下即出"
    this.positionNotice(this.pointerNotices[this.pointerNotices.length - 1]);
  }

  /** 单个回执的 3D→屏幕定位（复用 floatScreenPos 的同一相机与 CSS px 口径） */
  private positionNotice(n: { el: HTMLDivElement; at: { x: number; y: number } }) {
    const p = this.floatScreenPos({ x: n.at.x, y: n.at.y });
    if (!p.on) { n.el.style.display = 'none'; return; }
    if (n.el.style.display === 'none') n.el.style.display = '';
    n.el.style.transform = `translate(-50%,-100%) translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
  }

  /** 回执寿命管理（每帧：重投影定位 → 到期淡出销毁） */
  private updateCommandNotices() {
    if (this.pointerNotices.length === 0) return;
    const now = performance.now();
    for (let i = this.pointerNotices.length - 1; i >= 0; i--) {
      const n = this.pointerNotices[i];
      const left = n.until - now;
      this.positionNotice(n);
      if (left <= 0) {
        n.el.remove();
        this.pointerNotices.splice(i, 1);
      } else if (left < 500) {
        n.el.style.opacity = (left / 500).toFixed(2);
      }
    }
  }

  private handleFx(e: Fx3dEvent) {
    // [切片传送入场 · 时机修复] 开战即启动切片入场（BattleScene.startBattleAfterDeploy 推送）
    if (e.kind === 'entry_start') { this.startEntryFx(); return; }
    // [v2] 入场结束（BattleScene 解除暂停时推送）：**立刻收掉所有门**（幂等；防"暂停已解、门还在切"）
    if (e.kind === 'entry_end') { this.finishAllEntryGates(); return; }
    // [W3] 指针反馈事件（battle3dFx 总线 → 三接口）
    if (e.kind === 'pointer_chevron' && e.at) { this.showPointerChevron(e.at.x, e.at.y); return; }
    if (e.kind === 'pointer_target_lock' && e.at) { this.showTargetLock(e.at.x, e.at.y); return; }
    // [W5.3] 指挥点即时回执（成功/失败就地文本）
    if (e.kind === 'pointer_notice' && e.at) { this.showCommandNotice(e.at.x, e.at.y, e.text || '', e.ok !== false); return; }
    if (e.kind === 'pointer_clear') { this.clearPointerMarkers(); return; }
    if (e.kind === 'laser' && e.from && e.to) {
      const from = this.fxPointAt(e.from);
      const to = this.fxPointAt(e.to);
      this.spawnLaser(from, to, e.color, e.power);
    } else if (e.kind === 'strike' && e.from && e.to) {
      // v5：舰载机小队（飞行→格斗→击落→返航）；v6 传阵营 id 供模型按敌我选择
      const from = this.fxPointAt(e.from);
      const to = this.fxPointAt(e.to);
      this.spawnStrikeSquad(from, to, e.color, e.count || 4, e.dmg || 0, e.to, e.factionId);
    } else if (e.kind === 'shield' && e.at) {
      // v6.2：盾心高度 = 舰船自身高度，此前 ×0.6 导致盾心比船低 40%，
      //   半球下半截沉向基准面（用户实报"从地面算 Z 轴护盾中心偏下"）。
      // v6.11：改为"该舰本帧实际高度"（fxYAtPx）——舰体加了队内 5 层 / 队间 3 档后，
      //   只取巡航高度会让护盾挂在舰体上方或下方一截（详见 fxYAtPx 的量化说明）。
      const at = this.fxPointAt(e.at);
      const dir = e.dir ? new THREE.Vector3(e.dir.x, 0, -e.dir.y).normalize() : new THREE.Vector3(0, 0, 1);
      // v6.1：护盾尺寸与舰艇严格同源——按受击舰舰种取 dimsOf().L（与场上该舰模型同一套比例），
      //   舰种缺失时回退 e.size，再兜底战列舰长。不再使用"舰队展开半径"口径。
      //   v6.5：dimsOf 同步带阵营（受击舰阵营色即 e.color 所属侧，按 factionId 判帝国）
      const cls = e.shipClass ? SHIP_CLASS_ALIAS[e.shipClass] : null;
      const isEmpireSide = e.factionId === 2;
      const shipLen = cls ? this.dimsOf(cls, isEmpireSide ? 'empire' : 'alliance').L
        : (e.size && e.size > 0 ? e.size : this.dimsOf('battleship').L);
      this.spawnShield(at, dir, shipLen, e.color);
    } else if (e.kind === 'hit' && e.at) {
      // v6.2：命中爆点同样抬到巡航高度（与被击舰同高，否则爆闪贴地）
      const at = this.fxPointAt(e.at);
      this.spawnHit(at, e.color);
    } else if (e.kind === 'capture' && e.at && e.factionId !== undefined) {
      this.startCapture(e.at.x, e.at.y, e.factionId, e.color);
    } else if (e.kind === 'fortress_charge' && e.at) {
      // v6.9：伊谢尔伦雷神之锤充能——核心聚能光球膨胀 + 外围能量环，5s 充能期推进
      const at = this.fxPointAt(e.at);
      this.spawnFortressCharge(at, e.duration || 5000);
    } else if (e.kind === 'fortress_beam' && e.from && e.to) {
      // v6.9：雷神之锤三层光束——复用 lasers 池（寿命按 duration 换算，粗细按 width/hexR 折算）
      const from = this.fxPointAt(e.from);
      const to = this.fxPointAt(e.to);
      this.spawnFortressBeam(from, to, e.color, e.width || 32, e.duration || 1800);
    }
  }

  /** v6.9：伊谢尔伦充能 VFX——核心聚能光球（SphereGeometry，充能期膨胀+脉动）+ 外围能量环（Torus 平躺）。
   *  对齐 2D startFortressCharge 三层观感：光球膨胀、外环扩大、汇入粒子由光球自转+环缩放承担。 */
  private spawnFortressCharge(at: THREE.Vector3, durMs: number) {
    const group = new THREE.Group();
    const dur = durMs / 1000;
    // 核心聚能光球
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(this.hexR * 0.12, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    group.add(core);
    // 外围能量环（水平 Torus，缓慢扩张）
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.hexR * 0.22, this.hexR * 0.008, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    group.position.copy(at);
    this.scene.add(group);
    this.fortressCharges.push({ group, core, ring, t: 0, dur });
  }

  /** v6.9：雷神之锤光束——CylinderGeometry 直光束，粗细按 2D 层宽 / hexR 折算，
   *  寿命按 duration 换算入 lasers 池（淡出逻辑复用 updateFx 既有实现）。 */
  private spawnFortressBeam(from: THREE.Vector3, to: THREE.Vector3, color: number, widthPx: number, durMs: number) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1) return;
    // 2D 层宽 70/32/14px 在 hexR=50 战场折算为 0.35/0.16/0.07 ×hexR 半径——保持层级比例
    const radius = Math.max(0.02, (widthPx / 200) * this.hexR);
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, len, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(m);
    const life = durMs / 1000;
    this.lasers.push({ mesh: m, life, max: life });
  }

  /** v6.9：充能 VFX 每帧推进——光球膨胀脉动（由蓝转金）、外环扩张、终段白热 */
  private updateFortressFx(dt: number) {
    for (let i = this.fortressCharges.length - 1; i >= 0; i--) {
      const F = this.fortressCharges[i];
      F.t += dt;
      const p = Math.min(1, F.t / F.dur);
      const pulse = 1 + Math.sin(p * 12) * 0.2;
      // 光球膨胀（5→40×hexR/1000 量级）+ 颜色蓝→金过渡
      const coreScale = (1 + p * 7) * pulse;
      F.core.scale.setScalar(coreScale);
      const coreMat = F.core.material as THREE.MeshBasicMaterial;
      coreMat.opacity = 0.3 + p * 0.55;
      coreMat.color.setHex(p > 0.7 ? 0xfbbf24 : 0x60a5fa);
      // 外环扩张 + 增亮
      F.ring.scale.setScalar(1 + p * 3.5);
      const ringMat = F.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.3 + p * 0.5;
      ringMat.color.setHex(p > 0.6 ? 0xfbbf24 : 0x3b82f6);
      // 环缓慢自旋（能量感）
      F.ring.rotation.z += dt * 1.2;
      // 充能完毕：白热闪光后移除
      if (F.t >= F.dur) {
        this.spawnHit(F.group.position, 0xffffff);
        this.scene.remove(F.group);
        F.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!(mesh as any).isMesh) return;
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
        this.fortressCharges.splice(i, 1);
      }
    }
  }

  /** [v23 FX] 激光的"断续段串"几何与「细核 + 柔晕」装配已迁至 `./battleFx`
   *  （buildDashedBeamGeo / buildLaserEntry）。本方法只负责把共享实现造好的束**入池**。 */
  private spawnLaser(from: THREE.Vector3, to: THREE.Vector3, color: number, power?: number) {
    const L = buildLaserEntry(from, to, color, this.hexR, power);
    if (!L) return;
    this.scene.add(L.mesh);
    this.lasers.push(L);
  }

  /** v5: 舰载机小队——从母舰释放，突防→近距离格斗（绕目标缠斗）→击落后返航消失。
   *  v6：按射手阵营取模型（empire_fighter.glb / alliance_fighter.glb / fighter.glb 三级回退，
   *  修复同盟舰载机误用帝国模型）；机体尺寸取 fast_battleship 比例的 0.28（v5 fighter 比例
   *  0.170 实测只有几个像素，看起来就是光点——用户实报），GLB 按包围盒归一不依赖 ratio。 */
  private spawnStrikeSquad(from: THREE.Vector3, to: THREE.Vector3, color: number, count: number, dmgPerFighter: number, targetPx?: { x: number; y: number }, factionId?: number) {
    const n = Math.min(count, 6);
    const candidates = factionId === 2
      ? ['empire_fighter.glb', 'fighter.glb']
      : ['alliance_fighter.glb', 'fighter.glb'];
    const fighterReg = acquireShipModelByFiles(candidates);
    // 机体显示长度：0.40×驱逐基准（v6.3: 0.34→0.40，用户实报"舰载机没看到"——
    //   光矢导弹改型后舰载机是唯一带翼实体，必须一眼可辨）
    const d = { L: 0.40 * SQ3 * this.hexR, W: 0.135 * SQ3 * this.hexR, H: 0.095 * SQ3 * this.hexR };
    const fighters: StrikeSquad['fighters'] = [];
    for (let i = 0; i < n; i++) {
      let group: THREE.Group;
      if (fighterReg && fighterReg.status === 'ready' && fighterReg.geo) {
        group = this.buildFighterFromModel(fighterReg, d, color);
      } else {
        group = this.buildFighterFallback(d, color);
      }
      // 引擎光尾：机尾拉出发光短柱（推进感 + 与导弹光矢的"白心色晕"区分——舰载机尾迹用阵营色弱光）
      const trailLen = d.L * 0.9;
      const trail = new THREE.Mesh(
        new THREE.CylinderGeometry(d.W * 0.10, d.W * 0.02, trailLen, 5, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      trail.rotation.x = -Math.PI / 2;             // 轴 z → 沿机体（+z 机尾方向延伸）
      trail.position.set(0, 0, d.L * 0.5 + trailLen / 2);
      group.add(trail);
      // 出发点：母舰附近散开
      group.position.copy(from).add(new THREE.Vector3(
        (i - n / 2 + 0.5) * this.hexR * 0.5,
        (Math.random() - 0.5) * this.hexR * 0.3,
        (Math.random() - 0.5) * this.hexR * 0.5));
      group.visible = false;
      this.scene.add(group);
      fighters.push({ group, alive: true, shot: false });
    }
    const targetUnit = targetPx ? this.findUnitAtPx(targetPx.x, targetPx.y) : null;
    this.strikes.push({
      fighters,
      from: from.clone(), to: to.clone(),
      t: 0, dur: Math.min(2.6, Math.max(1.2, from.distanceTo(to) / (this.hexR * 10))),
      color,
      targetUnit,
      dmgPerFighter,
      phase: 'out',
      returnPt: from.clone(),
    });
  }

  /** 舰载机 GLB 模型构建（线条化，与舰船管线一致）。v6.2：补尾部引擎光点——
   *  纯线条 GLB 在 0.34L 尺度下仍像碎片，加发光点后才读得出"有机动能力的飞机" */
  private buildFighterFromModel(reg: ShipModelReg, d: { L: number; W: number; H: number }, facColor: number): THREE.Group {
    const group = new THREE.Group();
    const geo = reg.geo!;
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const modelLen = Math.max(size.x, size.y, size.z) || 1;
    const s = (d.L * 0.96) / modelLen;
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.55).getHex();
    const body = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: shipCol, transparent: true, opacity: 0.75, shininess: 50, specular: 0x88aacc }));
    body.scale.setScalar(s);
    group.add(body);
    if (reg.wire) {
      const wireCol = new THREE.Color(facColor).lerp(new THREE.Color(0xffffff), 0.35).getHex();
      const wire = new THREE.LineSegments(reg.wire, new THREE.LineBasicMaterial({ color: wireCol, transparent: true, opacity: 0.9 }));
      wire.scale.setScalar(s);
      group.add(wire);
    }
    return group;
  }

  /** 舰载机程序化兜底：三角翼造型（飞机感，非导弹光点）。v6 加双垂尾+座舱罩，提升辨识度 */
  private buildFighterFallback(d: { L: number; W: number; H: number }, facColor: number): THREE.Group {
    const group = new THREE.Group();
    const shipCol = new THREE.Color(facColor).multiplyScalar(0.6).getHex();
    const mat = new THREE.MeshPhongMaterial({ color: shipCol, emissive: facColor, emissiveIntensity: 0.25, transparent: true, opacity: 0.9, flatShading: true });
    // 主翼：扁平三角（俯视飞机形）
    const wing = new THREE.Mesh(new THREE.ConeGeometry(d.W * 1.4, d.L * 0.85, 3), mat);
    wing.rotation.x = -Math.PI / 2;
    wing.scale.y = 0.32;   // 压扁成翼面
    group.add(wing);
    // 机身：细长体
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(d.W * 0.18, d.W * 0.24, d.L * 0.9, 5), mat);
    fus.rotation.x = Math.PI / 2;
    group.add(fus);
    // v6 双垂尾（V 型尾翼，机尾两侧）
    const tailGeo = new THREE.BoxGeometry(d.W * 0.06, d.H * 1.6, d.L * 0.22);
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(tailGeo, mat);
      tail.position.set(sx * d.W * 0.28, d.H * 0.5, d.L * 0.34);
      tail.rotation.z = sx * 0.5;   // 外倾 V 型
      group.add(tail);
    }
    // 座舱罩（前部深色玻璃感）
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(d.W * 0.16, 6, 5),
      new THREE.MeshPhongMaterial({ color: 0x112244, shininess: 90, specular: 0xaaccff, transparent: true, opacity: 0.85 }));
    cockpit.position.set(0, d.H * 0.18, -d.L * 0.18);
    cockpit.scale.set(1, 0.7, 1.8);
    group.add(cockpit);
    return group;
  }

  /** 找像素坐标附近的目标舰（供舰载机格斗跟随目标实际位置） */
  private findUnitAtPx(px: number, py: number): any {
    const fleets: any[] = (this.battleScene as any).globalFleets || [];
    let best: any = null, bestD = this.hexR * 6;
    for (const fl of fleets) {
      for (const u of (fl.units || [])) {
        if (!u.sprite || u.hp <= 0) continue;
        const d = Math.hypot(u.sprite.x - px, u.sprite.y - py);
        if (d < bestD) { bestD = d; best = u; }
      }
    }
    return best;
  }


  /** 定向半球护盾涟漪。护盾的建 / 触发（shader、半径系数、朝向）已迁至 `./battleFx`
   *  （makeShieldEntry / shieldFire）—— 本方法只负责池化复用。
   *  v6.1：回归纯单舰盾——shipLen 即受击舰舰长（dimsOf 同源），半球半径 = 舰长 × 固定小系数。
   *  v5 的"舰队级展开"与 v6 的"半径钳制"两套口径全部废弃（用户两次实报护盾过大：
   *  护盾是舰艇自身的偏导护盾，尺寸只应与舰艇相关）。capture 星球脉冲仍传星球半径。 */
  private spawnShield(hitPoint: THREE.Vector3, incomingDir: THREE.Vector3, shipLen: number, color: number) {
    let s = this.shields.find(x => !x.active);
    if (!s) {
      s = makeShieldEntry();
      this.scene.add(s.mesh);
      this.shields.push(s);
    }
    shieldFire(s, hitPoint, incomingDir, shipLen, color, this.hexR);
  }

  /** 命中小闪光（Sprite 加法混合，0.25s）—— 造型已迁至 `./battleFx`（buildHitEntry） */
  private spawnHit(at: THREE.Vector3, color: number) {
    const H = buildHitEntry(at, color, this.hexR);
    this.scene.add(H.sprite);
    this.hits.push(H);
  }

  private updateFx(dt: number) {
    // [v23 FX] laser / hit / shield 三段步进全部走 `./battleFx` 的共享实现
    //   （laserStep / hitStep / shieldStep）—— 战场与巡览同一套时序，不再各存一份。
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const L = this.lasers[i];
      if (!laserStep(L, dt)) continue;
      this.scene.remove(L.mesh);
      disposeLaserEntry(L);
      this.lasers.splice(i, 1);
    }
    // hit 淡出
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const H = this.hits[i];
      if (!hitStep(H, dt, this.hexR)) continue;
      disposeHitEntry(this.scene, H);
      this.hits.splice(i, 1);
    }
    // shield 三段动画（收缩到位 → 平台期 → 膨胀淡出）
    for (const s of this.shields) if (s.active) shieldStep(s, dt);
    // v5: 舰载机小队推进
    this.updateStrikes(dt);
    // v6.3：中继补给站陀螺仪双环缓慢自旋（对转，"活着的人造设施"感）
    for (const rr of this.relayRings) {
      rr.b.rotation.y += dt * 0.5;
      rr.a.rotation.z += dt * 0.3;
    }
    // v6.7：司令部信标核心（线框八面体）自旋——缓慢、匀速，"被数据激活的节点"
    for (const core of this.fortressRings) {
      core.rotation.y += dt * 0.5;
      core.rotation.x += dt * 0.18;
    }
    // v6.9：伊谢尔伦充能光球推进（膨胀脉动/终段白热闪光）
    this.updateFortressFx(dt);
  }

  /** v5: 舰载机每帧推进（突防 → 格斗 → 击落 → 返航） */
  private updateStrikes(dt: number) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const S = this.strikes[i];
      S.t += dt / S.dur;
      // 目标实际位置（2D sprite 实时同步，目标移动则追踪）
      // Y 走 fxYAtPx：与舰体的队内 5 层 / 队间 3 档同源，否则舰载机会追着"比舰低一截"的虚点打
      const tgtWorld = S.targetUnit && S.targetUnit.sprite && S.targetUnit.sprite.active && S.targetUnit.hp > 0
        ? this.pxToWorld(S.targetUnit.sprite.x, S.targetUnit.sprite.y, this.fxYAtPx(S.targetUnit.sprite.x, S.targetUnit.sprite.y))
        : S.to;
      const allDead = S.fighters.every(f => !f.alive);

      for (const f of S.fighters) {
        if (!f.alive) continue;
        const fp = Math.min(1, S.t * 1.15);          // 各机相位略超前
          if (S.phase === 'out') {
          // 突防段：向目标飞，带轻微散布
          if (fp >= 0.999) {
            // 抵达目标区 → 结算命中表现（伤害由 2D 三角机 tween 分支扣，3D 只做视觉，避免双扣）
            if (!f.shot) {
              f.shot = true;
              this.spawnHit(f.group.position, S.color);
              if (S.targetUnit && S.targetUnit.sprite && S.targetUnit.sprite.active) {
                S.targetUnit.sprite.setAlpha(0.45);
                setTimeout(() => { if (S.targetUnit.sprite && S.targetUnit.sprite.active) S.targetUnit.sprite.setAlpha(1.0); }, 60);
              }
            }
            // 被防空击落判定：30% 概率在首轮格斗中坠毁
            if (Math.random() < 0.3) {
              f.alive = false;
              this.spawnHit(f.group.position, 0xff5533);
              f.group.visible = false;
              continue;
            }
            S.phase = 'return';
          }
          const e = fp * fp * (3 - 2 * fp);
          const jitterX = Math.sin(S.t * 9 + f.group.id) * this.hexR * 0.35;
          const jitterY = Math.cos(S.t * 7 + f.group.id * 1.3) * this.hexR * 0.2;
          const px = new THREE.Vector3().lerpVectors(S.from, tgtWorld, e);
          px.x += jitterX; px.y += jitterY;
          f.group.position.copy(px);
          // 朝向目标
          const dirV = new THREE.Vector3().subVectors(tgtWorld, px);
          if (dirV.lengthSq() > 0.01) {
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dirV.normalize());
            f.group.quaternion.slerp(q, 0.25);
          }
        } else {
          // 返航段：飞离战场后消失
          const rp = Math.min(1, S.t - 1.15);
          if (rp >= 1) { f.alive = false; f.group.visible = false; continue; }
          const e = rp * rp * (3 - 2 * rp);
          const px = new THREE.Vector3().lerpVectors(tgtWorld, S.returnPt, e);
          px.y += this.hexR * 0.4;
          f.group.position.copy(px);
          const dirV = new THREE.Vector3().subVectors(S.returnPt, px);
          if (dirV.lengthSq() > 0.01) {
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dirV.normalize());
            f.group.quaternion.slerp(q, 0.25);
          }
        }
      }

      if (allDead || S.t > 3.0) {
        S.fighters.forEach(f => {
          if (f.alive) { this.scene.remove(f.group); }
          f.group.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!(m as any).isMesh) return;
            (m.material as THREE.Material).dispose();
          });
        });
        this.strikes.splice(i, 1);
      }
    }
  }

  // ---------- 点击拾取 ----------
  private handlePick(e: PointerEvent) {
    if (this.dragMoved) return;
    // [R10-A2] 按键分流：地块/舰队拾取只认左键(0) / 右键(2)，其余（中键 1、侧键 3/4/5）一律忽略。
    //   · 中键在 OrbitControls 默认映射为 DOLLY（缩放，three r160 OrbitControls.js:99 mouseButtons）。
    //     若把它归为左键透传，中键缩放过程中的松手会误触发"购买地块 / 建立野战修补站"。
    //   · 真实 button 必须一路透传到 syncTileClick → 假 Phaser pointer：修复前假 pointer 恒为
    //     `button: 0`，使 BattleScene.handleTileClick 的 `pointer.button === 2` 分支（右键 = 投放
    //     战术信标 deployFlare）在 3D 路径**永不可达** —— 这是"3D 下右键信标完全没用"的根因。
    //   · 右键拖拽（OrbitControls 默认 PAN）由上方 dragMoved 守卫拦截，不会误投信标（见 syncTileClick 注释）。
    const button: 0 | 2 | null = e.button === 0 ? 0 : (e.button === 2 ? 2 : null);
    if (button === null) return;
    // [2a] 选目标态优先：屏幕空间最近邻拾取合法候选舰队（忽略遮挡 —— 07 §8.1"远处/被遮挡可点中"）。
    //   命中 → 下达；点空（>40px）→ 静默保持选目标态（07 §5.2/§C3：点空不取消）。
    if ((this.battleScene as any).cpCommandMode) {
      const fid = this.pickFleetAtScreen(e.clientX, e.clientY);
      if (fid !== null) (this.battleScene as any).tryExecuteOnFleet(fid);
      return;
    }
    // [R10-B2] 选中态拾取（仅左键）：屏幕空间命中玩家/盟军舰队 → 选中并吞掉本次点击（不买地）；
    //   命中敌军/点空 → 清选中后落回既有地块逻辑（买地/建站）。cpCommandMode 已在上方分支 return；
    //   deployPhase（战前部署）跳过，优先既有交互。
    //   拾取原语复用 pickFleetAtScreen：非选目标态时 cpCommandMode=false ⇒ targetCandidates=null
    //   ⇒ 不按候选过滤，全舰队可点（阵营过滤在 BattleScene.applyFleetSelectByPick 内做）。
    if (button === 0 && !(this.battleScene as any).deployPhase) {
      const selFid = this.pickFleetAtScreen(e.clientX, e.clientY);
      if ((this.battleScene as any).applyFleetSelectByPick?.(selFid)) return;
    }
    // RTS semantics: right-clicking the rendered hostile issues an identity-
    // based attack order before falling back to a ground move. unitVis contains
    // only fog-approved sprites, so hidden fleets cannot be targeted here.
    if (button === 2 && !(this.battleScene as any).deployPhase) {
      const targetFid = this.pickFleetAtScreen(e.clientX, e.clientY);
      if (targetFid !== null && (this.battleScene as any).orderSelectedFleetAttackById?.(targetFid)) return;
    }
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
    // [W3] 地面点击不再落常驻大 hex 指示（design §Pointer feedback：persistent oversized hex 已移除）；
    //   移动/攻击成功后的短暂 chevron / target-lock 由 showPointerChevron / showTargetLock 承担。
    this.syncTileClick(best, button);
    return;
  }

  /**
   * [2a] 屏幕空间最近邻拾取候选舰队（供选目标态使用）。
   * 数据源 `unitVis`（含全部存活单位，不受 MAX_MESHES 池上限约束）：
   *   · `sx/sy` 口径 = drawingBuffer 像素（左/上原点，已含 DPR，见 syncShips 第一遍）；
   *     事件坐标是 CSS px → 用 domElement.width/rect.width 折算到同一口径再比较。
   *   · 只拾取 `targetCandidates` 内的合法候选（非法目标不进候选集，07 §3.3）。
   *   · 阈值 40 CSS px（07 §C3/§5.2 建议值）：最近距离超过即视为"点空"，返回 null。
   * 返回真实 `fleet.id`（unitVis 的 fleet 就是 globalFleets 条目，id 恒为 number，见 BattleScene 建队处）。
   */
  public pickFleetAtScreen(clientX: number, clientY: number): number | null {
    const dom = this.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = dom.width / rect.width;
    const scaleY = dom.height / rect.height;
    const pxDev = (clientX - rect.left) * scaleX;
    const pyDev = (clientY - rect.top) * scaleY;
    const cands: Set<number> | null = (this.battleScene as any).targetCandidates ?? null;
    let bestFid: number | null = null;
    let bestD2 = Infinity;
    for (const v of this.unitVis.values()) {
      const fl = v.fleet;
      // v8：运输舰的宿主不是舰队（id 是字符串）⇒ 不参与"选舰队"拾取
      if (!fl || fl._scoutFlight || (fl as any)._isAux) continue;
      const fid: number = fl.id !== undefined ? fl.id : fl.factionId;
      if (cands && !cands.has(fid)) continue;
      const dx = v.sx - pxDev, dy = v.sy - pyDev;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestFid = fid; }
    }
    const thDev = 40 * scaleX;   // 40 CSS px → drawingBuffer px
    if (bestFid === null || bestD2 > thDev * thDev) return null;
    return bestFid;
  }

  /**
   * 3D 点击 → 等价 2D 点击。
   * BattleScene.handleTileClick 签名为 (pointer: Phaser.Input.Pointer, tile, poly, txt)，
   * 且首行用 pointer.getDistance() > 30 区分拖拽、pointer.button 区分左右键。
   * 直接复用：构造最小 Phaser pointer 替身（getDistance=0，视角拖拽已由
   * overlay 自己的 dragMoved 判定过滤），poly/txt 传 tile 上挂的原生 sprite/text。
   * handleTileClick 内部通过 store 写 selectedTile/gold/ownerId 并调 updateSupplyNetwork，
   * 不依赖 Phaser 场景对象本身，替身方案可行。
   *
   * [R10-A2] `button` 由 handlePick 透传**真实值**（0=左键买地/建修补站，2=右键投放战术信标）。
   *   修复前此处硬编码 `button: 0` ⇒ 3D 路径下右键恒被当作左键：BattleScene.handleTileClick 的
   *   `pointer.button === 2` 分支（BS:3203）永假 ⇒ deployFlare 在 3D 下不可达。
   *   拖拽防护**不在本层重复实现**：OrbitControls 在 pointerdown 调 setPointerCapture
   *   （three r160 OrbitControls.js:1000）并在 pointerup 释放（:1045），拖拽期间 pointermove/pointerup
   *   必定回到本画布元素 ⇒ handlePick 顶部 `dragMoved`（累计位移 > 4px）判断对右键同样成立。
   */
  private syncTileClick(tile: any, button: 0 | 2) {
    const bs = this.battleScene;
    const handle = bs.handleTileClick;
    if (typeof handle !== 'function') {
      this.opts.onTileClick?.(tile);
      return;
    }
    const fakePointer = {
      button,
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
    // 首帧建世界（等 BattleScene create() 完成）
    if (!this.spaceBuilt) {
      const bs = this.battleScene;
      if (bs && bs.tilesList && bs.tilesList.length > 0) {
        this.buildSpaceWorld();
        if (this.spaceBuilt && !this.ready) {
          this.ready = true;
          this.opts.onReady?.();
        }
      }
    } else {
      // v6.10：设施模型就绪后就地换装（中继站/基地/要塞等）；v21：并推进其自旋动画
      this.updateSceneProps(dt);
      this.updateCaptureRings(dt);
      this.syncShips(dt);
      // [切片传送入场] 紧随实体同步之后推进（需要本帧的实体世界坐标 / 建好的材质引用）
      this.updateEntryFx();
      this.updateBillboards();
      this.updateSupplyViz();
      this.updateCastleIntelVisibility();
      this.updateIntentLines();
      // [v56 性能] 修复 v37 重构引入的**双重调用块**：updateFlames / drainFx3d / updateFx /
      // updateBoats / updateCaptures 曾被连续跑两遍（pre_refactor_backup 为单份）——
      // 既白烧一倍每帧 CPU，又让激光/导弹/护盾/尾焰按 2 倍速播放（寿命减半）。
      // 删除重复块后特效步进回到 battleFx 设计时长（激光 0.3s / 护盾 0.85s / 命中 0.25s）。
      drainFx3d().forEach(e => this.handleFx(e));
      this.updateFx(dt);
      this.updateBoats(dt);
      this.updateCaptures();
      // [W3] 瞬态指针标记寿命管理（chevron / target-lock 短暂显示后淡出销毁；
      //   原 selRing 常驻透明度钳位指示已随之移除）
      this.updatePointerMarks();
      // [W5.3] 指挥点即时回执的寿命/重投影（与 billboard 同帧）
      this.updateCommandNotices();
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
    // [WS7] 主场景统计快照：必须夹在两次 render 之间 —— info 每次 render 前 autoReset，
    // 放到最后读到的只是 CRT 全屏 quad 的 1 次 draw call（旧实现的读数 bug）。
    this.lastRender.calls = this.renderer.info.render.calls;
    this.lastRender.points = this.renderer.info.render.points;
    this.lastRender.triangles = this.renderer.info.render.triangles;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
    // [WS7] 帧时统计与自适应降档（opts.perfGovernor 打开时才生效）
    this.updatePerfGovernor(dt);
    // [v12 P3] 可选帧率读数（默认关时零开销）
    this.updateFpsReadout(dt);
  }

  /**
   * [WS7] 性能兜底：帧时 EMA → 实体池预算自适应。
   * - 先跳过 PERF_WARMUP_FRAMES 帧（地形/模型/着色器编译期本来就慢）。
   * - EMA 超 PERF_BUDGET_MS ⇒ 预算 ×PERF_STEP（下限 MESH_BUDGET_MIN）；
   *   EMA 低于 PERF_COMFORT_MS ⇒ 预算向 MAX_MESHES 回涨。两者之间不动（滞回）。
   * - 每 PERF_ADJUST_INTERVAL 秒最多调一步，避免抖动。纯确定性，无随机。
   */
  private updatePerfGovernor(dt: number) {
    // [v12.1 C1] 帧时 EMA **无条件**计算：autoLodByLoad 的"帧时压力降档"不再依赖 perfOn
    //（原先 EMA 只在 perfOn 时更新 ⇒ 默认关闭 governor 时帧时驱动的降档完全失效）。
    this.perfFrame += 1;
    const ms = dt * 1000;
    this.frameEmaMs = this.frameEmaMs === 0 ? ms : this.frameEmaMs * 0.9 + ms * 0.1;
    if (!this.perfOn) {
      // 保持既有 WS7 调试契约：未开 governor 时 frameMs 读数恒 0、meshBudget 不收缩。
      this.lastStats.meshBudget = MAX_MESHES;
      return;
    }
    this.lastStats.frameMs = this.frameEmaMs;
    if (this.perfFrame < PERF_WARMUP_FRAMES) return;

    this.perfCooldown -= dt;
    if (this.perfCooldown > 0) return;
    const cur = this.lastStats.meshBudget;
    let next = cur;
    let changed = false;
    if (this.frameEmaMs > PERF_BUDGET_MS) {
      next = Math.max(MESH_BUDGET_MIN, Math.round(cur * PERF_STEP));
      // [v56 性能] 超预算 ⇒ 分辨率系数同步收缩（像素量按平方降），补 meshBudget 收完仍不够的缺口
      if (this.dprScale > DPR_SCALE_MIN) {
        this.dprScale = Math.max(DPR_SCALE_MIN, this.dprScale * 0.85);
        this.resize();
        changed = true;
      }
    } else if (this.frameEmaMs < PERF_COMFORT_MS) {
      // [v56 性能] 流畅 ⇒ 分辨率先逐级回升（步长 1.12 比收缩 0.85 更缓，防振荡）
      if (this.dprScale < 1) {
        this.dprScale = Math.min(1, this.dprScale * 1.12);
        this.resize();
        changed = true;
      }
      if (cur < MAX_MESHES) next = Math.min(MAX_MESHES, Math.max(cur + 1, Math.round(cur / PERF_STEP)));
    }
    if (next !== cur) { this.lastStats.meshBudget = next; changed = true; }
    if (changed) this.perfCooldown = PERF_ADJUST_INTERVAL;
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
   * [W5.5] **视角辅助：回到指定编队**（正式对外方法，UI「回到主舰队」按钮调用）。
   *
   *   与调试口 `__b3dFocus` 同一取景算法（3D 质心 → 轨道相机 target），但：
   *   · 按**舰队 id** 定位（UI 拿得到的是 id，不是数组序号）；
   *   · 是**正式 API**（不改任何渲染状态、纯设相机），UI 不依赖调试口；
   *   · 保留当前俯仰观感（用默认 elev/azim，与 27°/俯视 预设正交）。
   *
   *   @returns 是否命中该舰队（true=已取景；false=舰队不存在/已无单位）
   */
  focusOnFleet(fleetId: number, opts?: { dist?: number }): boolean {
    if (this.disposed) return false;
    const fleets: any[] = (this.battleScene as any).globalFleets || [];
    const target = fleets.find((f: any) => f && f.id === fleetId && (f.units || []).length > 0);
    if (!target) return false;
    // 质心（世界坐标）：与 __b3dFocus / updateBillboards 同口径
    let cx = 0, cy = 0, n = 0;
    for (const u of (target.units || [])) { if (!u.sprite) continue; cx += u.sprite.x; cy += u.sprite.y; n++; }
    if (!n) { cx = target.x; cy = target.y; }
    else { cx /= n; cy /= n; }
    const tierY = this.lastTierY.get(target) ?? 0;
    const wy = this.heightAtPx(cx, cy) + this.cruiseClearance + tierY;
    const t = new THREE.Vector3(cx, wy, -cy);
    const dist = opts?.dist ?? this.hexR * 12;
    const elev = 0.55;   // 俯角（弧度）
    const azim = 0.6;
    this.controls.target.copy(t);
    this.camera.position.set(
      t.x + Math.sin(elev) * Math.sin(azim) * dist,
      t.y + Math.cos(elev) * dist,
      t.z + Math.sin(elev) * Math.cos(azim) * dist,
    );
    this.camera.lookAt(t);
    this.controls.update();
    return true;
  }

  /**
   * [W5.5] 回到**玩家主舰队**（「回到主舰队」按钮的默认目标）：
   *   取玩家阵营（`type==='player'`）名下第一支有单位的舰队 —— 与 `BattleScene` 的
   *   「玩家本队」口径一致（`globalFleets.find(f => f.factionId === pFac.id)`）。
   * @returns 是否命中
   */
  focusOnPlayerMainFleet(opts?: { dist?: number }): boolean {
    const player = ((this.store as any).factions || []).find((f: any) => f.type === 'player');
    if (!player) return false;
    const fleets: any[] = (this.battleScene as any).globalFleets || [];
    const main = fleets.find((f: any) => f && f.factionId === player.id && (f.units || []).length > 0);
    if (!main) return false;
    return this.focusOnFleet(main.id, opts);
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

  /** [v56 性能] 当前有效像素比 = min(devicePixelRatio, 画质档 dprCap) × 动态系数 dprScale。
   *  renderer.setPixelRatio 与离屏 RT 尺寸必须同源走这里，防止两处发散。 */
  private effDpr(): number {
    return Math.min(window.devicePixelRatio, this.dprCap) * this.dprScale;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    // 离屏 RT 与 CRT 扫描线频率都要跟新尺寸走
    // [v12 P3] dpr 上限与创建时同源（this.dprCap），保证 resize 后分辨率档位不发散
    // [v56 性能] 动态分辨率生效点：dprScale 变化后由 updatePerfGovernor 调本方法重建 RT 尺寸，
    //   renderer 像素比必须同帧同步，否则合成阶段出现拉伸/采样发散。
    const dpr = this.effDpr();
    this.renderer.setPixelRatio(dpr);
    this.rt.setSize(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
    this.crtU.uRes.value.set(w, h);
  }

  destroy() {
    this.disposed = true;
    this.boats.length = 0;
    this.captures.clear();
    this.boatInst.count = 0;
    this.ships.clear();
    // [切片传送入场 v2] 状态与**门**引用清空（门本体的几何/材质在此显式释放；舰体材质由下方 traverse 释放）
    this.entryStates.clear();
    this.finishAllEntryGates();
    // 阵型标记层：逐条释放几何/材质（不依赖下方 scene.traverse 兜底，且引用表必须清空防串场）
    this.fleetMarks.forEach((m) => this.disposeFleetMark(m));
    this.fleetMarks.clear();
    this.markAgg.clear();
    this.markGroup = null;
    // v5: 舰载机引用表清空（几何体/材质由下方 scene.traverse 统一释放）
    this.strikes.length = 0;
    this.shields.length = 0;   // [v12.2 R3-a] 对称清空护盾池引用表（几何/材质由下方 scene.traverse 释放；防实例复用串场）
    // billboard DOM 全量回收（注入的样式表用 id 去重、无副作用，复用不删）
    this.billboards.forEach((bb) => this.destroyBillboard(bb));
    this.billboards.clear();
    this.bbAccum.clear();
    // [W5.3] 指挥点回执 DOM 引用表清空（元素随下方 bbLayer.remove() 一并移除）
    this.pointerNotices.length = 0;
    // 后勤可视化引用表清空（几何体/材质由下方 scene.traverse 统一释放）
    this.supCastle.clear();
    this.supPlanets.clear();
    this.supAux.clear();
    // [v12.1] supFleetRings 已随舰队补给状态环层移除
    this.supplyGroup = null;
    // v6.10：设施模型槽位引用清空（holder 在场景树内，由下方 traverse 统一释放）
    this.scenePropSlots.length = 0;
    // 提督扮演：意图线引用表清空
    this.intentLines.clear();
    this.intentGroup = null;
    if (this.bbLayer) {
      this.bbLayer.remove();
      this.bbLayer = null;
    }
    // [v12 P3] 帧率读数 DOM 移除
    if (this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
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
    // 同类陈旧句柄问题，与 App.vue 的 window.__b3dOverlay 一并收口：
    // 这 5 个构造时挂到 window 的只读调试口，句柄闭包捕获了已销毁的本实例，
    // 留着会让验证台架/调试脚本误判 overlay 仍存活（读到旧闭包）。destroy 后一律置 null。
    // ⚠ 仅清句柄，不触碰上方既有清理顺序（dispose / forceContextLoss 等语义不变）。
    (window as any).__b3dStats = null;
    (window as any).__b3dPerf = null;
    (window as any).__b3dMarkProbe = null;
    (window as any).__b3dFocus = null;
    (window as any).__b3dVLayout = null;
  }
}
