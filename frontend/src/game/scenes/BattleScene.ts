import * as Phaser from 'phaser';
import { useGameStore } from '../../store/gameStore';
import { useNodeStore } from '../../store/nodeStore';
import { battleDialogues } from '../../config/dialoguesData';
// 纯宇宙扫描空间的 2D 渲染（指挥制专用；**仅降级路径可见**，正常战斗由 Battle3DOverlay 呈现）
import { drawCommandSpace, drawCommandFleets, drawCommandScanOverlay } from './crt/CommandSpaceRenderer';

// Vite 资源导入：返回运行时 URL，解决 Phaser 加载器找不到 src 下资源的问题
import hyperionUrl from '../../assets/ship/hyperion.png';
import brunhildUrl from '../../assets/ship/brunhild.png';
import allianceShipUrl from '../../assets/ship/alliance_ship.png';
import empireShipUrl from '../../assets/ship/empire_ship.png';
import flameUrl from '../../assets/ship/flame.png';
import isserlohnPlanetUrl from '../../assets/planet/1.png';

// ── 指挥点系统 ──
import { createCPState, updateCPState, getDamageMultiplier, getIncomingMultiplier, getReflectRatio, getSpeedMultiplier, getMoraleModifier, executeCommand, canExecute, getCooldownMs, type CPState, type ActiveEffect } from '../../services/CommandPointSystem';
import { getAbilityById, type CommandAbility } from '../../config/commandAbilities';
// ── 指挥带宽系统（指挥链延迟机制）──
import { createBandwidthState, updateBandwidthState, getLinkStatus, hasChannel, establishChannel, canOrderInstantly, isRelayOrder, relayDelayMs, queueDelayedOrder, releaseChannel, degradeForFlagshipLoss, LINK_COLORS, LINK_CN, type BandwidthState, type LinkStatus, type PendingOrder } from '../../services/CommandBandwidthSystem';
import { commandBridge } from '../../services/CommandBridge';
// 3D 战场覆盖层特效桥：只推送事件，2D 特效代码零改动（3D 模式下 2D 层被隐藏）
import { pushFx3d } from '../battle3dFx';
import { updateSupplyChain, collectAuxShips, moveAuxShips, isSupplyUnit, AUX_SPEED, SUPPLY_SOURCE_RADIUS, SUPPLY_RELAY_RADIUS, SUPPLY_AUX_RADIUS, type SupplyNode, type FleetSupplyInfo } from '../SupplyChainSystem';
import { advanceFormationFacing, headingDistance, moveTowardsAtSpeed } from '../fleetKinematics';
import { combatUnits, hasCombatUnits, targetableUnits } from '../combatRoster';
// 提督扮演：总指挥判定 / 直接命令拦截 / 任务指令（仅指挥制启用）
import { pickSupremeCommander, isDirectCommandAllowed, DIRECT_COMMAND_TYPES, buildMission, ROLE_LABEL, PLAN_ROLE_LABEL, type Mission } from '../TacticalCommandSystem';
// 兵力折算：舰种 HP 表（单一真源）与 500:1 比例尺，正反映射共用
import {
    SHIP_TYPE_HP, SHIP_SCALE, resolveShipType,
    // [大战场] 演习轨道必须走**与战役轨道同一个**兵力折算入口（见 shipScaling.ts 的注释）：
    // 历史上演习用硬编码 deck（simFullDeck = 8 艘）建舰，完全绕过折算 ⇒ 用户看到的恒是 8 艘。
    totalsOfComposition, buildTacticalUnits, fleetEntityCount, fleetVisualCount, totalShipsOf,
    allocateVisualCounts, SHIP_TYPE_CN,
    type ShipStatMods, type TroopLike,
} from '../../config/shipScaling';
// 阵型排布：可随实体数 n 缩放的格位枚举（原 8 坐标硬编码表的替代）
import { formationOffsets, formationSpacing, FORMATION_SPACING, type FormationCell } from '../../config/formationLayout';
import type { FormationType } from '../../config/formations';
// [v33] 旧案 44 图战术模块整合（docs/design/loch-web-plan/02_*）：
//   **全部走单一真源 import，禁止再在本文件内联 beats 表 / 地形分支 / 舰种装甲表。**
//   数值真源 = config/balance.ts 的 TACTICAL_V33 / COLUMN_MATRIX / DIRECTION_ARMOR / INTERCEPT /
//   FORMATION_COLLAPSE / SHIP_BAND，每一项都有独立开关可回退。
import { formationCounterMul } from '../../config/formations';
import {
    columnProfileCached, columnMatrixMul, nextRangeBand, shipBandMul, type RangeBand,
} from '../../config/formationColumns';
import {
    dirArmorMul, hitSideFromAngle, fleetInterceptRate, interceptDamageMul, DIRECTION_CRIT_MIN,
} from '../../config/shipTacticalProfile';
import { TACTICAL_COMBO_CLAMP, TERRAIN_RULES, FACING_TURN } from '../../config/balance';
import { terrainEffect, effectiveVisionMul, TERRAIN_VISUAL } from '../../config/terrainEffects';
import { updateFormationCollapse, collapseMuls, COLLAPSE_REASON_TEXT } from '../formationMorale';
import { computeCombatModifiers } from '../../utils/skillEffects';
// 提督作战风格 + 撤退档位（v29）：补给**不再触发撤退**，改由「动摇线(提督个性) + 士气 + 兵力态势」决定；
//   补给改为影响战斗力与士气衰减速率。见 docs/design/3d-tactical-battle/22-tactical-depth-closed-loop.md
import {
    NEUTRAL_DOCTRINE, resolveAdmiralDoctrine, resolveRetreatTier, retreatParams, retreatSpeedMulRamped,
    supplyFactor, moraleDrainPerTick, RALLY_MORALE,
    type AdmiralDoctrine, type RetreatTier,
} from '../retreatDoctrine';
import { aggression, supplyDecision, turnDiscipline, approachLateralOffset } from '../combatDoctrine';
import { advanceManeuver, maneuverOrder, updateContact, type ContactState, type ManeuverState } from '../combatControl';
import { escortDestination } from '../tacticalTasks';
import {
    visibilityOf, noteIncomingFire, activeAttacker, fireGate,
    pickTarget, idealEngageDistFrom, strikeRangeFrom, chooseFormation, stabilizeCombatFormation, shouldFlank,
    type TargetCandidate, type Clarity,
} from '../aiDirector';
// [v31-C] 分舰队编成 / 战法（纯计算）—— **迂回 · 包抄 · 诱饵 · 后勤战的共同抽象**：
//   四项玩法都是"多路协同"，而多路协同的前提是"力量可分解"（见 docs/.../24-tactical-architecture-rebuild.md §2）
import {
    MANEUVERS, selectManeuver, assignDetachments, splitUnitCounts, requiredFleets, maneuverLabel,
    maxRoutesFor, MIN_UNITS_PER_ROUTE,
    type DetachmentPlan, type DetachmentSpec, type ManeuverType,
} from '../taskForce';


// 贴图 key → Vite URL 映射表
const SHIP_TEXTURES: Record<string, string> = {
    hyperion: hyperionUrl,
    brunhild: brunhildUrl,
    alliance_ship: allianceShipUrl,
    empire_ship: empireShipUrl,
    flame: flameUrl,
};

const classToTypeCode: Record<string, string> = {
    '战列': 'BB', '巡洋': 'CA', '驱逐': 'DD', '突击': 'CV', '电子': 'EW', '补给': 'AUX', '运输': 'TR', '无': 'AUX'
};

const getShipTypeCode = (facTrait: string, cls: string) => {
    if (facTrait === 'rebels' && cls === '驱逐') return 'D';
    return classToTypeCode[cls] || 'AUX';
};

/** [v14 ③1] 阵型过渡 morph 时长（秒，派单建议 3~5s）。
 *  换阵时保留旧 offsets，按 smoothstep(缓入缓出) 把每 slotIdx 的 (cx,cy) 从旧阵位插到新阵位；
 *  过渡中不响应二次换阵（完成后自动吸附到最新 formKey）；morph 是**运行态叠加**，不污染
 *  `_formOffsets`/`_formSpacing` 缓存语义（缓存始终持有当前 formKey 的目标阵型）。 */
const FORMATION_MORPH_DUR = 3.5;

/** [R10-B1] 限速航向角速率（rad / 帧 @ dt=1）。FIX-3：把"每帧瞬时确定的方向"平滑为有限角速度，
 *  一次消灭两条现象——「舰身横过来往侧面移动（横移残骸感）」与「转向时舰队缩成一团再展开」。
 *  · 单位与位移同基准：位移 = speed * dt（每帧量）；本速率亦按帧 × dt 积分 ⇒ 速度倍率 ≠1 时
 *    转向与位移**同步**加速/减速，不产生新的相对错位（闭环 R1 §5 U4）。
 *  · 数值 π/120 rad/帧 = 1.5°/帧 @60fps = **90°/s**：≈ v14 舰首 30°/s 的 3 倍，180° 掉头 ≈2.0s、
 *    90° 转向 ≈1.0s，与"缓慢转体、但读作飞船转弯而非残骸"的手感匹配（R1 §4 FIX-3 建议值）。 */
// [v30] 90°/s → **45°/s**：用户实报「刷一声就转头了 / 不够厚重」⇒ 转身率减半（180° 掉头 ≈ 4s）。
//   太空战舰的转身是**姿态控制**（RCS 反作用推进器），与"飞机靠升力转弯"无关 —— 慢是应该的。
const HEADING_TURN_RATE = Math.PI / 240;

/** [v47 wheel-and-reform] 逐舰显示航向（u.visHeading）最大角速率（rad/帧@dt=1，≈9.2°/帧）。
 *  舰体跟随**自身位移航迹**：快到贴得住航迹（消灭「舰首朝前却侧滑平移」= 摇头晃脑的渲染根），
 *  慢到滤得掉 chase 逐帧噪声（阵位目标移动造成的瞬时方向摆动不再 1:1 进朝向）。 */
const UNIT_VIS_TURN_RATE = 0.16;

/* ══════════════════════════════════════════════════════════════════════════
 * [v29 → v30 → v34b] 舰队机动物理化参数（用户三次实报："阵型绕着一个点画圆圈 / 像点不像舰"）
 *
 * 根因（第一性原理）：转弯半径 **R = v / ω**。
 *   · v29 只走了"降低 ω"这一条路：注释写「尺度上无法把 R 提到数倍舰长（那要求 ω < 6°/s，
 *     180° 掉头需 35s，不可玩）」—— **漏掉了另一条路：提高 v**。
 *   · 实算（v34b 之前）：v = 0.30px/帧 × 60 = 18 px/s、ω = 45°/s ⇒ **R = 23px**，
 *     而阵型半跨可达 300px ⇒ 转向时**阵型的重排幅度（数十~上百 px）远大于舰队本身的位移**
 *     ⇒ 观感 = 「舰队没怎么动，而一堆舰船在自己挪位 / 原地转圈」（用户 2026-09-20 复报）。
 *   · v34b 取 v = 0.90px/帧（54 px/s）⇒ **R ≈ 69px ≈ 2.8 倍舰长**（舰长 25px）
 *     ⇒ 转向读作"边前进边划弧"，而不是"原地打转"。
 *
 * ⚠ 这是**节奏级**参数，一键回退 = 把本值改回 0.30（其余修复可独立生效）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 舰队基准航速（px/帧 @ dt=1）。**当前保留 v29 以来的 0.30（行为中性）。**
 *
 *  为什么要把它从内联表达式提成常量：它是**转向可读性的唯一杠杆**。
 *  转弯半径 **R = v / ω** —— v29 的注释只考虑了"降低 ω"这条路（判定不可玩），
 *  **漏掉了"提高 v"**：ω 固定 45°/s 时
 *      v = 0.30 ⇒ R ≈ 23px（**< 一个舰长 25px**）⇒ 转向读作"原地打转"；
 *      v = 0.90 ⇒ R ≈ 69px（≈2.8 倍舰长）⇒ 转向读作"划弧前进"。
 *  ⚠ 提高它同时会把"接近 800px 交战距"由 ~44s 压到 ~15s（**节奏变更**），
 *    故 v34b **不擅自改动**：方向/掉速的自洽修复已独立生效（见 `thrustDir`），
 *    转弯半径这一项由使用者按真机观感决定。
 *  推荐区间：**0.30（现状）~ 0.90**；改这一处即可，与其它修复无耦合。 */
const FLEET_BASE_SPEED = 0.30;

/** 转向角速度的**建立速率**（rad/帧²）：角速度不能瞬间达到上限，需约 0.35s（≈21 帧 @60fps）
 *  才建立满转率 ⇒ "压舵 / 起转"的厚重感。
 *  旧实现 `rateLimitAngle` 直接钳制角度步长 = **无限角加速度** ⇒ 起转与停转都是瞬间的"轻"。 */
const TURN_RATE_ACCEL = HEADING_TURN_RATE / 21;

/** **临界制动安全系数**：目标角速度上限取 `sqrt(2·a·|d|) × 本系数`。
 *  物理含义 = "从当前速率**恰好能停住**"的制动上限；0.85 留 15% 余量抵消离散化误差。
 *
 *  ⚠⚠ 这是 v29 首版的**回归修复**：首版用「比例控制（`d × 0.8`）+ 角加速度限制」，
 *    那是一个**欠阻尼二阶系统** —— 接近目标时速率降不下来 ⇒ 转过头 ⇒ 反向修正 ⇒ 往复。
 *    实测（`_v29_osc_diag.cjs`，目标 90°）：**过冲 −13.5° · 角速度符号翻转 7 次**；
 *    而旧 `rateLimitAngle` 是 0° / 0 次。后果：阵位按 `facingSmooth` 旋转 ⇒ 两侧单位交替来回
 *    ⇒ 用户实报「**长条阵型像两条肩膀在抖动、波浪舞**」。
 *    改为制动律 + 死区吸附后回到 **0° / 0 次**，同时保留惯量（建立 ~0.3s）。 */
const BRAKE_SAFETY = 0.85;

/** [v30 / v34b] **推力对齐下限**：主引擎只能沿舰首方向推进 ⇒ 舰首与目标方向的夹角越大，前进越慢。
 *  对齐度 = `cos(目标方向 − 舰首朝向)`，取 `max(0, ·)^0.5`（**平方根** ⇒ 小幅航向修正更快恢复全速）。
 *
 *  ⚠ **值从 0.05 提到 0.45（v34b）** —— 用户 2026-09-20 复报原话：
 *    「舰队会先通过一些诡异的移动，然后**暂停**，然后再慢慢地 … 要转弯了，**先暂停**，然后再缓缓地转圈」。
 *    L2 实测（`_probe_turn.mjs`，90° 转弯，3 队一致）：`speedMinRatio = 0.483`（**最低**速比；
 *    转弯全程平均更低），而舰首对齐度在转弯中段≈0 ⇒ 0.05 的下限把舰队压到"几乎停船"，
 *    舰队一停，单舰就只能在原地打转（"里面的一艘艘舰船在原地转圈，而不是前进"）。
 *  0.45 ⇒ 即使完全没对齐也保留近半推力，"边前进边转向"成为可能；
 *  对齐良好的直线巡航仍是 100%（对齐度≈1 时不变）。
 *  ⚠ v30 引入本项的本意是"给转向加质量感"，但代价是"停船 ⇒ 原地转"被用户判为更糟
 *    ⇒ 本轮按用户实报回调；若真机确认"转向太飘"，回到 0.2~0.3 之间。 */
const THRUST_IDLE = 0.45;

/** 线速度惯性：每帧向期望速度逼近的比例（越小越"厚重"）。
 *  0.18（τ≈0.08s，几乎瞬时）→ 0.055（τ≈0.27s）⇒ 起步 / 改向有"质量感"。
 *  ⚠ 过小会让 AI 接敌 / 规避变迟钝；建议区间 0.04 ~ 0.07。 */
const FLEET_ACCEL = 0.055;

/** [v31-C] 分舰队拆分时的**初始侧向间距**（px）：略大于阵型足迹，确保拆开瞬间不重叠。
 *  拆分后各路会由战法航路继续牵引（几何复用 `config/fleetSplitManeuver.ts`）。 */
const DETACH_SPACING = 200;

/* ── [v31-D] 阵型朝向与舰首朝向分离（用户第三次反馈："整个阵型绕着一个点整体画圆"）─────────
 * 病灶：阵位旋转用的是 `facingSmooth`（**舰首朝向**）⇒ 舰首一转，整队格位绕中心刚性旋转
 *   ⇒ 每艘舰都沿弧线走 ⇒ 观感"绕一个点画圆圈"，与"战舰各自缓慢转身"完全相反。
 * 正解：阵型对齐的是**舰队实际航向**，不是舰首。用**实际速度方向**（`vx/vy`）作阵型朝向：
 *   · 掉头瞬间 → ①线惯性（`FLEET_ACCEL`，τ≈0.27s）②推力对齐衰减（`THRUST_IDLE`，掉头几乎停船）
 *     ⇒ 实际速度方向**几乎不变** ⇒ **阵位不绕圈，各舰原地转身**；
 *   · 转完加速 → 速度方向真正转向新航向 ⇒ 阵位**自然**对齐（无需任何"旋转动画"）。
 *   低速（含停船对射）时**冻结**，避免 `atan2` 在速度≈0 时抖动。 */

/** 阵型朝向的跟随速率（rad/帧）= 90°/s。输入已是**平滑过的实际速度方向**，此处限速仅防抖。 */
const FORM_FACING_RATE = Math.PI / 120;
/** 阵型朝向的最小速度阈值（px/帧 的平方）：低于此冻结阵型朝向。 */
const FORM_FACING_MIN_SPD2 = 0.02 * 0.02;


/** [v21 JIT] 单位阵位跟随的**除零保护**（px）。旧值是 2px「死区」，与 `chase` 的
 *  1.0px/帧下限构成极限环：单位进入死区即完全停止，而目标随舰队每帧移动 ~0.5px，
 *  数帧后越过阈值 ⇒ 单帧猛追 ~1px ⇒ 又落入死区 ⇒ sprite 绝对位移在 **0 与 2×舰队步长
 *  之间逐帧交替**（取证 _jit_probe1_base：|Δsprite| med=0 / p90=2.05×|Δfleet|，
 *  Δrel 沿航向投影符号翻转率 0.98）。放大到实体档后即读作"一抖一抖"。
 *  `Math.min(uDist, …)` 本身已保证不越冲 ⇒ 阈值只需大于浮点噪声即可。 */
const UNIT_CHASE_EPS = 0.02;

/** 阵位移动的硬速度上限（px/帧 @ dt=1）：目标越远也不得加速。 */
const UNIT_FORMATION_SPEED = 0.9;

/** [v21 JIT] 阵型呼吸幅度的渐入/渐出时间常数（帧 × 倍率，与位移同基准）。 */
const JIT_BREATHE_TAU = 8;

/** 把当前角 cur 以不超过 maxStep 的步长逼近目标角 target（角差先 wrap 到 [-π, π]）。
 *  与 Battle3DOverlay.approachAngle **同式**（wrap 用 atan2(sin,cos) ⇒ 跨 ±π 环回正确）；
 *  此处独立实现（不跨文件 import）以免 2D/3D 模块循环依赖。 */
// ⚠ [v29] 已被"角速度带惯量"模型取代（见文件顶部 TURN_RATE_ACCEL 参数块），**当前无调用点**；
//   保留仅供对照 / 兜底。新模型不再直接钳制角度步长，而是让角速度以有限角加速度逼近目标。
function rateLimitAngle(cur: number, target: number, maxStep: number): number {
    let d = target - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) <= maxStep) return cur + d;
    return cur + Math.sign(d) * maxStep;
}

/** [FIX-stance-snap] 阵位数组越界时的确定性兜底格：黄金角螺旋环（单位=格位）。
 *  旧实现 `formOffsets[slotIdx] || [0,0]` 把越界槽位全塌到舰队中心 ⇒ 姿态/阵型切换时
 *  一眼可见"所有船极速吸到同一个固定点"。黄金角铺开保证脏数据下单位也互不叠架。 */
function ringCell(i: number): [number, number] {
    const r = Math.sqrt(i + 0.5);
    const a = i * 2.399963229728653; // 137.5°
    return [r * Math.cos(a), r * Math.sin(a)];
}

/** [#74 · A2] 演习专属战前部署倒计时（秒）。仅演习（!isCampaign）启用：静置满时自动开战。
 *  战役**不适用**（保持无限等待，且不显示倒计时行）。单一数据源 = store.deployCountdownSec。 */
const DEPLOY_COUNTDOWN_SEC = 20;

/** [v14 ⑤] 同方多舰队最小部署间距（像素，垂直于推进轴）：≥ 阵型足迹 + 安全沟。
 *  取 1.35×足迹（下限 160px）；足迹按各队 formationOffsets 的最大半跨 × 像素格距折算。 */
const DEPLOY_GAP_MIN = 160;
const DEPLOY_GAP_FOOTPRINT_K = 1.35;


export class BattleScene extends Phaser.Scene {
    private store: any;
    protected globalFleets: any[] = [];
    private phaserProjectiles: any[] = [];
    protected tilesList: any[] = [];
    protected tilesDict: Record<string, any> = {};
    private hpBarsGraphics!: Phaser.GameObjects.Graphics;
    private playerFlare: Phaser.GameObjects.Container | null = null;
    private carrierFighters: Map<number, Phaser.GameObjects.Arc[]> = new Map();
    private activeDialogues: Phaser.GameObjects.Container[] = [];
    private factionMap: Map<number, any> = new Map(); // O(1) faction lookup cache
    // P2 战役阶段目标：1破网 → 2斩链 → 3拔旗
    private battleStage: number = 1;
    private stageReported: boolean = false;
    // P3 战损账单（本场战斗累计）
    private battleLosses: { ships: number; pension: number } = { ships: 0, pension: 0 };
    private battleLossText: Phaser.GameObjects.Text | null = null;
    // P4 名场面
    private duelCooldown: number = 0;            // 一骑讨冷却（避免频繁触发）
    private lastDuelPair: string = '';           // 上次对决的舰队对
    // [v57] 战中提督闲聊调度：nextBanterAt=0 表示尚未排程（开战 25s 后第一句）；lastBanterText 防连续重复
    private nextBanterAt: number = 0;
    private lastBanterText: string = '';
    private adversityTriggered: Set<number> = new Set(); // 已触发逆境宣言的舰队
    // P3 战术部署阶段
    private deployPhase: boolean = false;        // 开局部署是否进行中
    private deployText: Phaser.GameObjects.Text | null = null;
    private deployFormation: string = 'wedge';   // 玩家选择的初始阵型
    private deployTactic: string = 'search';     // [#74 · R1] 旗舰开局姿态（值域=stance：search/siege/defend）
    private deployCountdownTimer: Phaser.Time.TimerEvent | null = null; // [#74 · A2] 演习部署倒计时器
    // P4 战术增援
    private reinforceTimer: number = 0;          // 增援计时（ms）
    private reinforceInterval: number = 90000;   // 90秒一波
    private reinforceUsed: Map<number, boolean> = new Map(); // factionId → 本波是否已用
    // P5 战役剧本阶段
    private scriptPhase: string = 'probe';       // probe试探 / clash缠斗 / turn转折 / final决战
    private scriptReported: boolean = false;
    /** 提督扮演：总指挥提督 id（仅指挥制判定；null=未启用，直接命令不拦截）。
     *  public：3D overlay billboard 据此决定姿态按钮只给总指挥旗舰。 */
    public supremeCommanderId: number | null = null;

    // === 纯宇宙战场的 2D 底层（Phaser 侧）===
    // ⚠ 正常战斗的视觉**全部由 `Battle3DOverlay`（Three.js）负责**：指挥制下
    //   `body.battle3d-mode` 的 CSS 会把整个 Phaser 画布隐藏，这里画的东西一个像素都看不到。
    //   本层只在「3D overlay 8 秒内建不起来」的降级路径里可见（见 App.vue）。
    //   历史上此处有 hex / crt / 3d 三种战场模式，2026-09-20 全部删除，只剩指挥制。
    /** 宇宙起伏地形种子（同一局形状稳定） */
    private commandSpaceSeed = 1;
    private spaceGraphics!: Phaser.GameObjects.Graphics;
    private spaceFleets!: Phaser.GameObjects.Graphics;
    private spaceScan: Phaser.GameObjects.Graphics | null = null;
    private spaceScanTimer = 0;
    private spaceGlowTime: { val: number } = { val: 0 };

    // ===== 伊谢尔伦要塞武器系统 =====
    private fortressWeapon: {
        chargeTimer: number;
        chargeInterval: number;
        firstFireDelay: number;
        maxRange: number;
        fireAngle: number;
        fortressX: number;
        fortressY: number;
        fortressHp: number;
        fortressMaxHp: number;
        ownerFactionId: number;
        laserGraphics: Phaser.GameObjects.Graphics;
        chargeGraphics: Phaser.GameObjects.Graphics;
        hpBarBg: Phaser.GameObjects.Rectangle;
        hpBarFill: Phaser.GameObjects.Rectangle;
        destroyed: boolean;
        isCharging: boolean;
    } | null = null;

    private hexRadius = 26;
    private baseHexRadius = 26; // 基础值，用于动态缩放计算

    // ── v6.6 指挥制出生点动态化 ──
    /** 指挥制地图矩阵横向半跨（世界单位）。buildMapData 末尾按矩阵实际范围填充，
     *  供 castlePos 三处赋值与中继避让共用——替换 v6.3 及之前的硬编码 ±3000，
     *  换任何形状地图（含未来伊谢尔伦长条图）自动贴合。 */
    private commandHalfX = 3000;
    /** 指挥制出生距离 = 半跨 × 1.05（v6.8：网格平面已收敛到地图半跨 ×1.15，
     *  出生点推到 1.05 半跨 ≈ 网格边缘 91% 处——贴边部署，四边不再留大片无用空地）。 */
    private commandSpawnDist = 3150;

    /** 按地图矩阵实际范围推导指挥制出生参数（buildMapData 末尾调用；hex/crt 不受影响）。
     *  取横向半跨（攻左守右沿 X 拉开），并兜底 ≥ hexRadius×40 防退化小图挤中间。 */
    private computeCommandSpawnExtent(matrix: any[]) {
        if (matrix.length === 0) return;
        const xs = matrix.map((t: any) => this.hexRadius * (Math.sqrt(3) * t.q + Math.sqrt(3) / 2 * t.r));
        const half = (Math.max(...xs) - Math.min(...xs)) / 2;
        this.commandHalfX = Math.max(half, this.hexRadius * 40);
        this.commandSpawnDist = this.commandHalfX * 1.05;
    }
    private directions = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

    // ── 指挥点系统 ──
    private cpState: CPState | null = null;
    private cpCommandMode = false;  // 是否在选目标模式
    private pendingAbilityId: string | null = null;
    /** [2a] 选目标态的合法候选舰队 id 集（3D overlay 拾取/高亮与 2D 拾取共用；退出即清） */
    public targetCandidates: Set<number> | null = null;
    /** [R10-B2] 战场「选中舰队」：点舰队（2D world / 3D 屏幕空间）选中，右键点地 = 移动该舰队。
     *  null = 无选中（此时右键仍 = 投放战术信标）。仅玩家(type='player')可选（[V18-B · C3] 移除恒假盟军分支，#63-a），
     *  敌军不可选。独立于战略层 store.selectedFleetId，勿混用。 */
    public battleSelectedFleetId: number | null = null;
    // ── 指挥带宽系统（指挥链延迟机制）──
    private bwState: BandwidthState | null = null;
    private commMarkers: Map<number, Phaser.GameObjects.Text> = new Map(); // 舰队ID → 链路指示标记
    private intentLines!: Phaser.GameObjects.Graphics;
    private damageNumbers: { sprite: Phaser.GameObjects.Text; timer: number }[] = [];
    private spaceKey!: Phaser.Input.Keyboard.Key;

    constructor(config?: string | Phaser.Types.Scenes.SettingsConfig) {
        super(config || { key: 'BattleScene' });
    }

    preload() {
        // 使用 Vite 解析后的 URL 加载贴图，确保能找到 src/assets 下的资源
        for (const [key, url] of Object.entries(SHIP_TEXTURES)) {
            this.load.image(key, url);
        }
        // 伊谢尔伦星球图片
        this.load.image('isserlohn_planet', isserlohnPlanetUrl);
    }

    create() {
        this.store = useGameStore();
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';
        console.log(`[BattleScene] create() isCampaign=${isCampaign}`);
        // [FIX-2D白渲染] create() 可多次触发（重进战斗），而 App.vue 的可见性同步可能
        //   落在两次 create 之间被静默吞掉 → 2D 场景（7000+ 对象）在画布已 CSS 隐藏时
        //   仍每帧全量渲染（实测 ~65ms/帧，20fps 主因）。此处按当前真值自愈一次：
        //   指挥制 3D 在位 → 只停渲染，不停逻辑（update 照常，3D 层每帧取数）。
        this.sys.setVisible(!document.body.classList.contains('battle3d-mode'));

        // 重置战斗状态
        this.store.gameOver = false;
        this.store.isWin = false;
        this.store.isPaused = false;

        // === 阶段A：动态地图扩容 ===
        // 根据参战舰队数动态缩放hexRadius，避免多舰队拥挤
        this.scaleMapForFleetCount(state);

        this.cameras.main.centerOn(0, 0);
        // 动态缩放：hexRadius越大（多舰队），初始zoom越小，确保能看到更多战场
        let initZoom = Math.max(0.3, 0.8 * (this.baseHexRadius / this.hexRadius));
        if (this.store.selectedMapId.startsWith('custom_')) initZoom = Math.min(initZoom, 0.7);
        else if (this.store.selectedMapId === 'random_large') initZoom = Math.min(initZoom, 0.45);
        else if (this.store.selectedMapId === 'random_rect') initZoom = Math.min(initZoom, 0.55);
        // v6.9：伊谢尔伦 61×29 长条图——初始视角拉远看全要塞走廊
        else if (this.store.selectedMapId === 'standard') initZoom = Math.min(initZoom, 0.4);
        // 无六边形格子，不按 hexRadius 缩放（否则 zoom 会被算到 0.3，舰队小到看不见）。
        initZoom = 0.85;
        this.cameras.main.setZoom(initZoom);

        // === 纯宇宙扫描空间（Phaser 侧底层；正常战斗的视觉在 Battle3DOverlay）===
        this.commandSpaceSeed = Math.floor(Math.random() * 100000) + 1;
        this.cameras.main.setBackgroundColor('#040810');
        this.spaceGraphics = this.add.graphics().setDepth(0);
        // 舰队光环需盖在单位 sprite(depth 5/6) 之上，否则被遮挡看不见
        this.spaceFleets = this.add.graphics().setDepth(10);
        // 全屏扫描线 overlay（独立层，每 ~60ms 随相机重绘）
        this.spaceScan = this.add.graphics().setDepth(101);
        drawCommandSpace(this.cameras.main, this.spaceGraphics, this.commandSpaceSeed);

        this.hpBarsGraphics = this.add.graphics().setDepth(30);
        // 补给链可视化：画补给源/运输舰的补给圈，以及到补给舰队的链路
        this.supplyGfx = this.add.graphics().setDepth(12);
        this.globalFleets = [];
        this.phaserProjectiles = [];
        this.tilesList = [];
        this.tilesDict = {};
        // 清理上一局的舰载机
        this.carrierFighters.forEach(fighters => fighters.forEach(f => f.destroy()));
        this.carrierFighters.clear();

        // 【核心隔离逻辑：双轨制分流】
        if (isCampaign) {
            // 轨道 A：大地图真实战役
            this.buildCampaignEnvironment(state);
            this.spawnStrategicFleets(state);
        } else {
            // 轨道 B：主界面演习 / 战术模拟
            this.initFactions();
            const mapDataMatrix = this.buildMapData();
            mapDataMatrix.forEach(data => {
                if (data.type === 'castle') {
                    const fac = this.factionMap.get(data.ownerId);
                    if (fac) {
                        fac.castlePos = {
                            x: this.hexRadius * (Math.sqrt(3) * data.q + Math.sqrt(3)/2 * data.r),
                            y: this.hexRadius * (3/2 * data.r)
                        };
                    }
                }
            });
            // 安全回退：未分配城堡的舰队 → 推到地图边缘（避免城堡在(0,0)中央）
            this.store.factions.forEach((f: any) => {
                if (!f.castlePos || (f.castlePos.x === 0 && f.castlePos.y === 0)) {
                    // 攻左守右拉到战场边缘（v6.6: 按地图实际半跨动态，见 commandSpawnDist）
                    f.castlePos = {
                        x: f.team === 1 ? -this.commandSpawnDist : this.commandSpawnDist,
                        y: (Math.random() - 0.5) * this.commandHalfX * 0.4
                    };
                }
            });
            // v6.9 伊谢尔伦要塞战（演习轨道）：初始化雷神之锤主炮——对齐战役轨道能力。
            // 此前 standard 落入 13×13 通用小图且无 fortressWeapon，2D 的要塞特性在
            // 演习/3D 轨道全部缺失（用户实报"3D下都没有了"）。
            // 位置：必须在 spawnInitialFleets() 之前——守方 castlePos 要改到要塞东侧，
            //   舰队生成读的就是 fac.castlePos（晚了只改数据不改已生成舰队位置）。
            if (this.store.selectedMapId === 'standard') {
                // 重建前释放上一局的 Phaser 对象（create() 可多次触发）
                if (this.fortressWeapon) {
                    this.fortressWeapon.laserGraphics.destroy();
                    this.fortressWeapon.chargeGraphics.destroy();
                    this.fortressWeapon.hpBarBg.destroy();
                    this.fortressWeapon.hpBarFill.destroy();
                    this.fortressWeapon = null;
                }
                // 要塞中心 q=18, r=0 → 像素坐标（与 buildTileGrid 同源换算）
                const fX = this.hexRadius * (Math.sqrt(3) * 18 + Math.sqrt(3) / 2 * 0);
                const fY = this.hexRadius * (3 / 2 * 0);
                // 守方 = team 2（演习轨道攻守由 team 决定，无 state.attackers/defenders）
                const defenderFac = this.store.factions.find((f: any) => f.team === 2);
                this.fortressWeapon = {
                    chargeTimer: 0,
                    chargeInterval: 90000,     // 90秒冷却，雷神之锤一锤定音
                    firstFireDelay: 50000,     // 首次发射需50秒
                    maxRange: Math.max(2400, this.commandSpawnDist * 0.55),  // 射程随地图尺寸缩放（61格长条图 ≈ 半跨 55%）
                    fireAngle: 0,              // 固定向东（q 增大方向）开火
                    fortressX: fX,
                    fortressY: fY,
                    fortressHp: 10000,
                    fortressMaxHp: 10000,
                    ownerFactionId: defenderFac?.id ?? 2,
                    laserGraphics: this.add.graphics().setDepth(50),
                    chargeGraphics: this.add.graphics().setDepth(49),
                    hpBarBg: this.add.rectangle(fX, fY - 50, 80, 6, 0x1e293b).setDepth(51).setVisible(false),
                    hpBarFill: this.add.rectangle(fX, fY - 50, 80, 6, 0xef4444).setDepth(52).setVisible(false),
                    destroyed: false,
                    isCharging: false,
                };
                // 攻守出生位调整：攻方（team 1）保持左缘贴边；守方（team 2）从远东缘移到
                //   要塞东侧驻防（紧贴主炮防线，符合"守要塞"语义）。
                const defQ = 22;
                const defX = this.hexRadius * (Math.sqrt(3) * defQ + Math.sqrt(3) / 2 * 0);
                if (defenderFac) defenderFac.castlePos = { x: defX, y: 0 };
            }
            // 先实例化舰队，再渲染地块（确保地块多边形在上层，优先接收点击事件）
            this.spawnInitialFleets();
            // 关键：buildTileGrid 内部才会填充 tilesList/tilesDict（BattleScene.ts:1126），
            // 而 AI 的探索/目标选择完全依赖 tilesList。此前指挥制直接跳过调用 → tilesList 为空
            // → AI 找不到任何地块目标 → 舰队原地不动（用户实报）。
            // 因此指挥制仍要建地块数据（只是不显示），保证 AI 逻辑完整。
            this.buildTileGrid(mapDataMatrix);
            // 地块 sprite / text 在本函数内**创建即隐藏**（见 `buildTileGrid` 顶部注释）：
            //   它们是占位对象，只为占领/补给逻辑提供 setFillStyle / setText 的落点。
            // 地形标记（淡色斑）—— 仅 2D 降级路径可见，真正的地形视觉在
            //   `Battle3DOverlay.buildTerrainZones()`。
            this.renderTerrainMarkers();
            // 纯宇宙起伏等高线
            if (this.spaceGraphics) {
                drawCommandSpace(this.cameras.main, this.spaceGraphics, this.commandSpaceSeed);
            }
        }

        // 指挥制后勤战：中线带布置 3 个中立星球中继（占领后扩大补给半径）
        // （中继布置只与"是否有格子"无关，直接执行）
        this.spawnSupplyRelayPlanets();

        // [V18-A · P1] 新战斗：清空上一场的总指挥覆盖（本场一次性，不进存档）
        (this.store as any).supremeCommanderOverrideId = null;
        // [#74 · A2/R5] 新战斗：复位演习部署倒计时镜像（双保险，避免上一场残留）
        (this.store as any).deployCountdownSec = -1;
        (this.store as any).deployCountdownPaused = false;
        // 提督扮演 A：总指挥判定（仅指挥制；内部自带守卫并镜像到 store 供军议面板）
        this.computeSupremeCommander();

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown) {
                this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
                this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
            }
        });
        this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number) => {
            this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.2, 2.5));
        });

        // ── [R10-B2/D5] 禁用 2D 战场右键原生菜单（先例 StrategicScene.ts:265）──
        //   3D 由 OrbitControls.onContextMenu 的 event.preventDefault() 抑制；2D 此前无任何抑制
        //   ⇒ 右键会「弹浏览器原生菜单 + 投信标/移动」双触发。1 行补齐（?. 守卫同先例）。
        this.input.mouse?.disableContextMenu();

        // ── [2a] 选目标态拾取（降级路径专用）──
        //   正常战斗的拾取由 `Battle3DOverlay` 做屏幕空间命中（此时 Phaser 画布被
        //   `battle3d-mode` 隐藏、收不到指针事件）；本处理器只在 3D 建不起来、
        //   画布重新可见时生效。
        //   用 pointerup + getDistance 过滤拖拽：2D 相机平移是 pointermove+isDown，
        //   若用 pointerdown 会把"从敌方舰上起手的平移"误判成选目标（报告已注明此偏离）。
        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (!this.cpCommandMode) return;
            if (pointer.getDistance() > 30) return;
            const fid = this.pickFleetAtWorld(pointer.worldX, pointer.worldY);
            if (fid !== null) this.tryExecuteOnFleet(fid);
        });

        // ── [2a] Esc：选目标态 → 退选回列表（主取消路径，07 §5.1；不执行、不扣 CP）──
        //   [R10-B2] 分层：有选目标态先走既有取消（return），本次 Esc 不波及选中；
        //   无选目标态时才用于清"选中舰队"。
        this.input.keyboard!.on('keydown-ESC', () => {
            if (this.cpCommandMode) {
                commandBridge.selectedAbilityId = null;
                this.exitTargetSelect('esc');
                return;
            }
            if (this.battleSelectedFleetId !== null) {
                this.battleSelectedFleetId = null;
                this.store.triggerToast?.('◎ 已取消选中');
            }
        });

        // ── 指挥点系统：空格键暂停/恢复（使用 addKey 而非 on('keydown-SPACE') 更可靠）──
        this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // ── P0 即时阵型切换：1-5 数字键（玩家舰队）+ P3 部署阶段指令卡选择 ──
        this.input.keyboard!.on('keydown', (event: any) => {
            const keyName = event?.key?.toUpperCase?.();
            const formName: Record<string, string> = { '1': 'wedge', '2': 'line', '3': 'spindle', '4': 'circle', '5': 'square' };
            const newForm = formName[keyName];

            // P3 部署阶段：数字键选阵型，T键选旗舰开局姿态（索敌/攻坚/驻守），回车开始
            if (this.deployPhase) {
                if (newForm) {
                    this.deployFormation = newForm;
                    (this.store as any).deployFormation = newForm;   // [G4] 同步全屏军议层高亮
                    this.updateDeployText();
                    return;
                }
                if (keyName === 'T') {
                    // [#74 · R1] 在 stance 取值域上轮转（去掉原「突袭/合围/稳守」中间映射层）
                    const seq = ['search', 'siege', 'defend'];
                    const i = seq.indexOf(this.deployTactic);
                    this.deployTactic = seq[(i + 1) % seq.length];
                    (this.store as any).deployTactic = this.deployTactic;   // [G4] 同步全屏军议层高亮
                    this.updateDeployText();
                    return;
                }
                if (keyName === 'ENTER') {
                    this.startBattleAfterDeploy();
                    return;
                }
                return; // 部署阶段屏蔽其他按键
            }

            // [v31-C] **玩家主动分舰队**：`X` 键把"当前选中的己方舰队"按战法拆成多路。
            //   选中 = 战场点击己方舰队拾取（`battleSelectedFleetId`）；与 1-5 阵型键正交。
            //   这是用户裁定"玩家可主动拆分自己的舰队"的入口。
            if (keyName === 'X') {
                if (this.store.isPaused || this.store.gameOver) return;
                this.splitSelectedFleet();
                return;
            }

            if (!newForm || this.store.isPaused || this.store.gameOver) return;
            const pFac = this.store.factions.find((f: any) => f.type === 'player');
            const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
            if (!pFleet || pFleet.units.length === 0) return;
            if (pFleet.formation === newForm) return;
            const oldForm = pFleet.formation;
            pFleet.formation = newForm;
            // 阵型切换士气/提示
            pFleet._formSwitchCooldown = this.time.now + 1000;
            this.store.triggerToast?.(`[${pFac?.name}] 变阵 → ${this.getFormationCnName(newForm)}`);
            // 变阵瞬间生成扩散光环特效
            pFleet.units.forEach((u: any) => {
                if (u.sprite?.active) {
                    const ring = this.add.circle(u.sprite.x, u.sprite.y, 20, 0x06b6d4, 0.25).setDepth(15);
                    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
                }
            });
        });
        // 意图线Graphics层
        this.intentLines = this.add.graphics().setDepth(25);

        // 初始化CP引擎（使用玩家提督的统帅值）
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const cmd = pFac?.admiralStats?.command || 50;
        this.cpState = createCPState(cmd);

        // 初始化指挥带宽引擎（直连半径随地图缩放：半径的26倍 ≈ 跨越全图1/3）
        this.bwState = createBandwidthState(cmd, this.hexRadius * 26);

        // 强行拦截小游戏的内政 Tick
        this.time.addEvent({
            delay: 1000, loop: true,
            callback: () => {
                // [V18-B · A1] 战役轨解冻（方向 1a · 最小放开）：原守卫在此整体早退（含 isCampaign），
                //   而下方「使命解算」（`if (fleet.mission) this.executeMissionTick`）是 mission→行为消费链的
                //   **唯一写入端**，被该早退罩住 ⇒ 战役轨任何阵营的 mission 恒不解算（#58 病灶）。
                //   拆法：本闸只保留「小游戏内政」硬条件（isPaused/gameOver）；使命解算段改由轨无关通道运行；
                //   段③「1Hz 战略姿态评估」与 expand/造兵铺地仍受战役守卫（1a 不放开段③，见下方两处 isCampaign 闸）。
                if (this.store.gameOver || this.store.isPaused) return;
                
                // [V18-B · B1] 阵营过滤扩含 player（D1=α：玩家舰队 mission 纳入解算，与 AI 同构）；
                //   并移除同一表达式中恒假的 `|| f.type === 'ally'`（#63-a 并账：Faction.type 联合仅 'player'|'ai'，
                //   真实盟军 = type==='ai' && team===1，该分支恒不命中、无行为影响）。
                this.store.factions.filter((f: any) => f.type === 'ai' || f.type === 'player').forEach((aiFac: any) => {
                    const fleets = this.globalFleets.filter(fl => fl.factionId === aiFac.id);
                    if (fleets.length === 0) return;
                    // [V18-A · F1] 原为 `const fleet = fleets[0];`（只评估首支）——改为覆盖该阵营全部舰队。
                    for (const fleet of fleets) {
                        // ── 提督扮演 B：任务指令优先于独立评估（mission 只能由指挥制军议面板写入）──
                        if (fleet.mission) {
                            this.executeMissionTick(fleet, aiFac);
                            if (fleet.mission) continue; // 任务仍在 → 跳过独立评估；任务完成被清空 → 落回常轨
                        }
                        // [V18-B · A1] 段③「1Hz 战略姿态评估」起于此处 —— 方向 1a **不放开**本段：
                        //   ① 战役轨 continue（战役轨 stance 仍只由 per-frame 反应式逻辑写，见提案 §2.1b「1a」）；
                        //   ② 玩家阵营 continue（D1=α 只把玩家舰队纳入「使命解算」；战略评估成员集仍仅 AI——
                        //      以守住设计 §5 的「玩家三方写者」模型：手动 L1 / mission L2 / per-frame L3，
                        //      战略评估若也写玩家 stance 会成为契约外的第四写者）。
                        if (isCampaign) continue;
                        if (aiFac.type === 'player') continue;
                        let totalHp = 0, totalMaxHp = 0;
                        fleet.units.forEach((u: any) => { totalHp += u.hp; totalMaxHp += u.maxHp; });
                        const hpPct = totalMaxHp > 0 ? totalHp / totalMaxHp : 0;
                        const myPower = this.calculateFleetPower(fleet);

                        // === 伤害检测：被打了但看不见敌人 → 一定是塔在射 ===
                        const prevHp = fleet._lastTickHp || totalMaxHp;
                        const hpDropped = prevHp - totalHp > totalMaxHp * 0.02;
                        fleet._lastTickHp = totalHp;
                        let underTowerFire = false;
                        if (hpDropped) {
                            // 检测附近是否有敌方塔
                            let nearestEnemyTower: any = null; let minTowerDist = 200;
                            this.tilesList.forEach(t => {
                                if (t.type === 'tower') {
                                    const tFac = this.factionMap.get(t.ownerId);
                                    if (tFac && tFac.team !== aiFac.team) {
                                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                                        if (d < minTowerDist) { minTowerDist = d; nearestEnemyTower = t; }
                                    }
                                }
                            });
                            // 在塔射程内且无可见敌人 → 被塔打
                            if (nearestEnemyTower && minTowerDist < 160) {
                                underTowerFire = true;
                                fleet._targetTower = nearestEnemyTower; // 标记目标塔
                            }
                        }

                        // === 战略态势评估 ===
                        const enemyFacs = this.store.factions.filter((f: any) => this.factionMap.get(f.id)?.team !== aiFac.team && f.active);
                        let totalEnemyPower = 0, nearestEnemyDist = Infinity;
                        enemyFacs.forEach((ef: any) => {
                            const efFleet = this.globalFleets.find(fl => fl.factionId === ef.id);
                            if (efFleet) {
                                totalEnemyPower += this.calculateFleetPower(efFleet);
                                const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, efFleet.x, efFleet.y);
                                if (d < nearestEnemyDist) nearestEnemyDist = d;
                            }
                        });
                        // P5 AI性格化：提督风格权重
                        const admStats = aiFac.admiralStats || {};
                        // v29【勘误 + 接入】：原注释写"基于能力值与标签"，但实现**只读 admiralStats**——
                        //   提督标签（MILITARY_STYLE_PARAMS）从未参与（全项目零引用）。现改为**标签优先、数值兜底**：
                        //   冒险/突击/机动类 → aggressive；谨慎/防守/后勤类 → cautious。
                        //   ⇒ 下游 :641（被塔打的死战阈值）、:644（进攻坚的战力比）、:669/:670（性格化阵型）
                        //     首次由"这个提督是谁"驱动。
                        const aiDoctrine: AdmiralDoctrine = (aiFac as any)._doctrine
                            ?? ((aiFac as any)._doctrine = resolveAdmiralDoctrine((aiFac as any).admiralTags));
                        const AGG_STYLES = ['aggressive', 'frontal_assault', 'mobile_raid'];
                        const CAUT_STYLES = ['cautious', 'counter_defense', 'logistics_focus'];
                        const aggScore = (admStats.attack || 50) + (admStats.command || 50);
                        const cautScore = (admStats.defense || 50) + (admStats.tactics || 50);
                        const personalityType = (aiDoctrine.styleTag && AGG_STYLES.includes(aiDoctrine.styleTag)) ? 'aggressive'
                            : (aiDoctrine.styleTag && CAUT_STYLES.includes(aiDoctrine.styleTag)) ? 'cautious'
                            : aggScore > cautScore + 20 ? 'aggressive' : (cautScore > aggScore + 20 ? 'cautious' : 'balanced');
                        // [v31-A] 进攻性：**教范 `attackMod` 参与推进阈值**（>1 更主动，<1 更保守）。
                        //   判据形如 `forceRatio > 2.0 * advMult * deployAdj` ⇒ advMult 越小越早压上。
                        //   取 `1/attackMod`：进攻型(1.3~1.4)更早进攻、谨慎型(0.7)更晚（范围 0.71~1.43）。
                        const doctrineAggro = aiDoctrine.attackMod > 0 ? 1 / aiDoctrine.attackMod : 1;
                        const advMult = (personalityType === 'aggressive' ? 0.8 : (personalityType === 'cautious' ? 1.2 : 1.0)) * doctrineAggro;
                        const forceRatio = totalEnemyPower > 0 ? myPower / totalEnemyPower : 999;

                        // [V18-B/#67 · (a) D3 契约补全] 段③「1Hz 战略姿态评估」是低于 L1 的 AI 写者，
                        //   须与 L2/L3 同口径服从 L1 锁门：锁期内（玩家点过姿态后 12s）不覆写 stance/formation/_avoidUntil。
                        //   零回归：team2（敌方）无锁 ⇒ isStanceLocked 恒 false ⇒ 敌军行为逐位不变；仅作用于被点过姿态的僚舰 12s 窗口。
                        if (!this.isStanceLocked(fleet)) { // [V18-B/#67 · (a)] 段③ 服从 L1 锁门
                            // === 战略角色分配（优先级从上到下，P5 性格化调整阈值）===
                            // P3 部署指令卡影响：突袭→AI更早猛攻；合围→AI偏好侧翼；稳守→AI更保守
                            const deployAdj = aiFac._deployTactic === 'aggressive' ? 0.85
                                : (aiFac._deployTactic === 'encircle' ? 1.0 : 1.15);
                            if (underTowerFire) {
                                // 被塔打：拆塔或者跑（激进派顶着拆塔）
                                fleet.stance = hpPct > (personalityType === 'aggressive' ? 0.3 : 0.5) ? 'siege' : 'fallback';
                            } else if (hpPct < 0.35) {
                                fleet.stance = 'fallback';
                            } else if (forceRatio > 2.0 * advMult * deployAdj) {
                                fleet.stance = 'siege';
                            } else if (forceRatio > 1.2 * advMult * deployAdj) {
                                fleet.stance = 'search';
                            } else if (forceRatio > 0.6 * advMult * deployAdj) {
                                fleet.stance = 'search';
                                fleet.formation = 'line';
                            } else {
                                // v6.5 修复（用户实报"敌舰在索敌/撤退间快速切换"）：
                                // 旧逻辑 forceRatio 劣势 + 敌在 400px 内 → stance='fallback'，
                                // 而 per-frame 状态机把 stance==='fallback' 当"手动撤退令"（isManualRetreat）
                                // 强制 state='retreating'；下一秒舰队跑远 → stance 又回 'search' → 再咬上，
                                // 形成"掉头跑→回头咬"的抖动循环。
                                // 修法：AI 战略层只表达"避战意图"，不再直接写 fallback 姿态——
                                //   记录 _avoidUntil（3 秒避战窗），交由 per-frame canEngage 的
                                //   距离保持逻辑自动拉开（劣势方 engaging+spindle 已有此行为）。
                                //   真正的撤退仍由 血量告急/断粮/玩家手动 三条硬条件触发。
                                if (nearestEnemyDist < 400) {
                                    fleet._avoidUntil = this.time.now + 3000;
                                }
                                fleet.stance = 'search';
                            }
                            // [v31-A] 性格化阵型：**教范（`MILITARY_STYLE_PARAMS.formation`）首次生效**。
                            //   优先级：合围指令(部署卡) > 撤退(圆阵) > **该提督教范阵型**。
                            //   ⚠ 旧实现只在 `siege+aggressive` / `fallback+cautious` **两个分支**赋值 ⇒
                            //     其余情况**根本不写 formation** ⇒ 舰队保持出厂值不回炉
                            //     （用户实报："毕典菲尔特特性是直冲，出来的阵型竟然是个长条"
                            //      —— 因为人格**从未参与**阵型决策，见 `24` §1 证据 3）。
                            if (aiFac._deployTactic === 'encircle' && fleet.stance === 'siege') fleet.formation = 'wedge';
                            else if (fleet.stance === 'fallback') fleet.formation = 'circle'; // 撤退：全向防御
                            else fleet.formation = aiDoctrine.formation;                       // 其余：**教范默认**
                        }
                }
                });

                // [V18-B · A1] 保留 expand/内政段战役守卫：战役轨仍不跑造兵/铺地/补给/阶段推进（1a 只放开段② 使命解算）。
                if (isCampaign) return;

                // ===== AI 智能扩张补给线逻辑（v2 公平化：不再白送金，铺地价格按难度微调） =====
                // [V18-B · C2] 移除恒假 `|| f.type === 'ally'`（#63-a：Faction.type 无 'ally'，真实盟军 = type==='ai'）—— 行为不变。
                this.store.factions.filter((f: any) => f.type === 'ai' && f.active).forEach((aiFac: any) => {
                    // v2 修复：删除 aiFac.gold += 15 印钞机。AI收入来自 goldRate（与玩家同规则，下方统一结算）
                    const aiPriceMul = this.store.selectedDiff === 'hard' ? 0.7 : (this.store.selectedDiff === 'easy' ? 1.3 : 1.0);
                    if (aiFac.gold >= 50) {
                        const candidates: any[] = [];
                        const aiFleet = this.globalFleets.find(fl => fl.factionId === aiFac.id);
                        const enemyTeam = this.store.factions.find((f: any) => f.team !== aiFac.team && f.active);
                        
                        this.tilesList.forEach(t => {
                            if (t.ownerId === 0 && t.type !== 'sea' && t.type !== 'ruined' && t.type !== 'planet') {
                                let isAdjToMe = false, isAdjToEnemy = false;
                                for (const dir of this.directions) {
                                    const n = this.tilesDict[`${t.q + dir.q},${t.r + dir.r}`];
                                    if (n && n.ownerId === aiFac.id) isAdjToMe = true;
                                    if (n && enemyTeam && this.factionMap.get(n.ownerId)?.team === enemyTeam.team) isAdjToEnemy = true;
                                }
                                if (isAdjToMe) candidates.push({ tile: t, isAdjToEnemy });
                            }
                        });
                        
                        if (candidates.length > 0 && aiFleet) {
                            candidates.sort((a, b) => {
                                // 优先：逼近敌方（切断补给）+ 靠近舰队
                                const scoreA = (a.isAdjToEnemy ? -300 : 0) + Phaser.Math.Distance.Between(a.tile.x, a.tile.y, aiFleet.x, aiFleet.y);
                                const scoreB = (b.isAdjToEnemy ? -300 : 0) + Phaser.Math.Distance.Between(b.tile.x, b.tile.y, aiFleet.x, aiFleet.y);
                                return scoreA - scoreB;
                            });
                            const targetTile = candidates[0].tile;
                            
                            // v2 公平化：AI 铺地成本按难度乘系数（hard 便宜=更快，但非白送）
                            const effectiveCost = Math.max(1, Math.round(targetTile.cost * aiPriceMul));
                            if (aiFac.gold >= effectiveCost) {
                                aiFac.gold -= effectiveCost;
                                targetTile.ownerId = aiFac.id;
                            }
                        }
                    }
                });

                this.updateSupplyNetwork();
                this.processSupplyAndCapture();
                this.drawSupplyChain();   // 补给链可视化（补给圈/运输舰/链路）

                // 结算战略节点收益
                this.tilesList.forEach(t => {
                    if (t.ownerId !== 0) {
                        const fac = this.factionMap.get(t.ownerId);
                        if (fac) {
                            if (t.type === 'mine' || t.type === 'gold_mine') fac.gold += t.type === 'gold_mine' ? 5 : 3;
                        }
                    }
                    
                    if (t.type === 'barracks') {
                        this.globalFleets.forEach(fl => {
                            if (fl.factionId === t.ownerId && Phaser.Math.Distance.Between(fl.x, fl.y, t.x, t.y) < 80) {
                                fl.units.forEach((u: any) => { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.03); });
                            }
                        });
                    }
                });

                this.store.factions.forEach((f: any) => {
                    if (f.active) {
                        f.gold += f.goldRate;
                        let currentHp = 0; let currentMaxHp = 0;
                        this.globalFleets.filter(fl => fl.factionId === f.id).forEach(fl => {
                            fl.units.forEach((u: any) => { currentHp += u.hp; currentMaxHp += u.maxHp; });
                        });
                        if (currentMaxHp > 0) { f.hp = currentHp; f.maxHp = currentMaxHp; }
                    }
                });

        // ===== P2 战役阶段目标：破网→斩链→拔旗 =====
        this.checkBattleStage();

        // ===== P5 战役剧本阶段推进（试探→缠斗→转折→决战） =====
        this.updateScriptPhase();

        // ===== P4 战术增援：90秒一波拉锯 =====
        this.updateReinforcement();

        // ===== P3 战损账单 HUD（左上角常驻） =====
        if (this.battleLosses.ships > 0 || this.battleLosses.pension > 0) {
            if (!this.battleLossText) {
                this.battleLossText = this.add.text(10, 10, '', {
                    fontSize: '12px', color: '#ef4444', fontStyle: 'bold',
                    backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 8, y: 4 }
                }).setDepth(60).setScrollFactor(0);
            }
            this.battleLossText.setText(`本场战损：${this.battleLosses.ships} 舰 · 抚恤 ₮${Math.round(this.battleLosses.pension / 10000)}万`);
        }

            }
        });

        // ===== 指令变阵监听 =====
        this.setupCommandDispatcher();

        // ===== P3 战术部署阶段：开局暂停，玩家选择阵型+指令卡 =====
        this.activateDeployPhase();
    }

    /** P3 开启部署阶段：暂停战斗，显示部署选单 */
    private activateDeployPhase() {
        // 战前部署暂停：战役/自定义战斗启用；演习模式不暂停战斗流程（保持原设计）。
        // v2 修复（用户反馈①"任务指令入口在哪看不见"）：演习不部署暂停导致 warRoomOpen
        //   从不自动置 true，军议面板只剩右上角小按钮，玩家找不到任务指令入口。
        //   改为：指挥制演习开局自动展开军议 25 秒（不暂停、battleDeployPhase 不置 true，
        //   面板显示战中 hint"在此下达任务指令"）；玩家可随时关闭，之后靠右上角按钮再开。
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';   // ← [#74 · B2] 从死变量转为真条件
        const hasPlayer = this.store.factions.some((f: any) => f.type === 'player' && f.active);
        // [#74 · B2] JM 2026-09-16 拍板：演习(skirmish)与战役**都**进入部署暂停（有玩家即部署）。
        const wantDeploy = hasPlayer;
        if (!wantDeploy) {
            // v3 修复（用户反馈"军议面板一闪而过"）：原 25s delayedCall 自动收起 →
            //   改为常驻：开局展开，玩家手动点 × 关闭，之后靠右上角按钮再开。
            (this.store as any).warRoomOpen = true;
            // [V18-A · B-0] 演习/无玩家轻量分支：也为 AI 生成战前计划（与战役同口径；用户要求两模式兼顾）
            this.planAiFactionsForDeploy();      // ← 本分支唯一调用点，勿上提
            // [V18-A · P1] 镜像「总指挥确认卡」候选（演习制下无真暂停 → 卡片只读展示）
            this.publishSupremeCommanderPanel(); // ← 本分支唯一调用点，勿上提
            return;
        }

        this.deployPhase = true;
        this.store.isPaused = true;
        // 提督扮演：镜像部署阶段 → 军议面板（指挥制下自动展开，战前分配初始任务）
        (this.store as any).battleDeployPhase = true;
        (this.store as any).warRoomOpen = true;
        // [G4] 镜像部署选项目 → 全屏军议层（单一真源仍是本类的 deployFormation / deployTactic）
        (this.store as any).deployFormation = this.deployFormation;
        (this.store as any).deployTactic = this.deployTactic;
        // 玩家舰队摆好初始阵型（默认楔形）
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (pFleet) pFleet.formation = this.deployFormation;
        this.updateDeployText();
        // [#74 · A2] 演习专属 20s 倒计时（战役保持无限等待、不显示倒计时行）
        if (!isCampaign) {
            (this.store as any).deployCountdownSec = DEPLOY_COUNTDOWN_SEC;
            (this.store as any).deployCountdownPaused = false;
            // Phaser 定时器在 store.isPaused 下**仍会触发**（证据：既有 1Hz 战略定时器自带
            //   `if (gameOver || isPaused) return;` 守卫，正因它照跑）⇒ 无需额外时钟源。
            this.deployCountdownTimer?.remove();
            this.deployCountdownTimer = this.time.addEvent({
                delay: 1000, loop: true,
                callback: () => {
                    const s = this.store as any;
                    if (s.deployCountdownPaused) return;      // 悬停军议面板：暂停计时（不减秒）
                    s.deployCountdownSec = (s.deployCountdownSec ?? 0) - 1;
                    this.updateDeployText();                  // 刷新中央菜单与秒数（单一数据源）
                    if (s.deployCountdownSec <= 0) {
                        this.deployCountdownTimer?.remove();
                        this.deployCountdownTimer = null;
                        this.startBattleAfterDeploy();
                    }
                },
            });
        }
        // [V18-A · B-0] 战役真暂停窗口：为 AI 生成战前计划（MVP：只写既有 Mission，不新增任务类型）
        this.planAiFactionsForDeploy();
        // [V18-A · P1] 部署阶段军议面板：镜像「总指挥确认卡」候选/依据到 store
        this.publishSupremeCommanderPanel();
    }

    /** P3 刷新部署选单文字 */
    private updateDeployText() {
        if (!this.deployText) {
            this.deployText = this.add.text(0, 0, '', {
                fontSize: '14px', color: '#00ff88', fontFamily: 'monospace',
                backgroundColor: 'rgba(0,8,16,0.85)', padding: { x: 16, y: 12 },
            }).setDepth(110).setScrollFactor(0).setOrigin(0.5);
        }
        // [#74 · R1] 旗舰开局姿态：值域=stance（search/siege/defend），三项标签由值反查（勿写死）
        const tacticLabel = this.deployTactic === 'siege' ? '攻坚' : (this.deployTactic === 'defend' ? '驻守' : '索敌');
        const formCn = this.getFormationCnName(this.deployFormation);
        // [#74 · A2/⑤] 倒计时行仅演习（!isCampaign）且已激活时拼接；战役只显示"[回车] 立即开战"
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';
        const cdSec = (this.store as any).deployCountdownSec;
        const cdPaused = !!(this.store as any).deployCountdownPaused;
        const cdLine = (!isCampaign && typeof cdSec === 'number' && cdSec >= 0)
            ? (cdPaused ? '（已暂停计时）' : `${cdSec} 秒后自动开战`)
            : '';
        const cam = this.cameras.main;
        this.deployText.setPosition(cam.width / 2, cam.height / 2 - 40);
        const lines = [
            `◤ 战前部署 ◢`,
            ``,
            `  初始阵型：${formCn}          [1-5 切换]`,
            `    1 楔形阵 · 2 横阵 · 3 纺锤阵 · 4 圆形阵 · 5 方阵`,
            `  旗舰开局姿态：${tacticLabel}        [T 切换]`,
            `    索敌：旗舰机动搜索（默认）`,
            `    攻坚：旗舰压上攻坚`,
            `    驻守：旗舰原地驻守（不主动移动）`,
            ``,
        ];
        // 「右侧『军议』…」仅指挥制拼接（非指挥制无该面板，显示会造成"找不到面板"的新困惑）
        lines.push(`  右侧「军议」为各舰队分配初始任务 · 确认总指挥`, ``);
        lines.push(cdLine ? `  [回车] 立即开战          ${cdLine}` : `  [回车] 立即开战`);
        this.deployText.setText(lines.join('\n'));
        // [V18-A · F2 去镜像] 指令卡不再镜像写入 AI 阵营的 _deployTactic：
        //   原实现让"玩家选的指令卡"直接影响 AI 开局行为（消费侧 deployAdj），与设计矛盾，已移除。
        //   消费侧 deployAdj 保留，但 AI 阵营 _deployTactic 永不被写 → 恒取默认值（语义 = 该机制不存在）。
    }

    /** P3 结束部署，开始战斗 */
    private startBattleAfterDeploy() {
        if (!this.deployPhase) return;
        this.deployPhase = false;
        this.store.isPaused = false;
        (this.store as any).battleDeployPhase = false;
        // [#74 · A2] 结束部署：清倒计时器并复位镜像（单一数据源，防残留）
        this.deployCountdownTimer?.remove();
        this.deployCountdownTimer = null;
        (this.store as any).deployCountdownSec = -1;
        (this.store as any).deployCountdownPaused = false;
        if (this.deployText) { this.deployText.destroy(); this.deployText = null; }
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (pFleet) pFleet.formation = this.deployFormation;
        // [#74 · R1] 旗舰开局姿态生效（不写 _userStanceLockUntil：开局初值无需 L1 锁；
        //   1Hz 战略层有 `if (aiFac.type === 'player') continue;` 显式跳过玩家 ⇒ 不会被覆写）
        if (pFleet) pFleet.stance = this.deployTactic;
        // [V18-A · F2 去镜像] 不再把玩家指令卡镜像到 AI 阵营的 _deployTactic（见 updateDeployText 注释）。
        // [V18-A · P1] 部署结束钩子：确认/应用总指挥覆盖（override > 自动）并落定本场总指挥
        this.computeSupremeCommander();
        this.showFleetDialogue(pFleet, 'spawn');
        // P5 战役剧本：开局简报
        this.showBattleBanner('战役开始', '第一阶段：试探接触', '#00ff88');
        this.scriptPhase = 'probe';
        this.scriptReported = false;
    }

    /** [V18-A · B-0] 为所有 AI 阵营生成战前计划（两模式共用入口，见 activateDeployPhase 两分支；[V18-B · C2] 去恒假 '盟友' 分支） */
    private planAiFactionsForDeploy() {
        this.store.factions
            .filter((f: any) => f.type === 'ai' && f.active !== false)   // [V18-B · C2] 移除恒假 `|| f.type === 'ally'`（#63-a，行为不变）
            .forEach((aiFac: any) => this.planFactionBattle(aiFac));
    }

    /**
     * [V18-A · B-0] AI 战前规划层（MVP）：为某 AI 阵营的每支舰队按 role 写入**既有 Mission**（不新增任务类型）。
     *   输入：己方舰队（位置/兵力/补给）、敌方可见舰队、地块（planet/relay/castle 由 executeMissionTick 解析）、
     *         faction.castlePos、难度（selectedDiff）、personalityType（faction.admiralStats）。
     *   输出：fleet.mission（交由既有 1Hz 任务循环 executeMissionTick 执行）+ fleet._planRole（供 fleetIntentText 显示）。
     *   边界：不改运动学、不改数值；复用既有任务执行通道。
     */
    private planFactionBattle(aiFac: any) {
        const fleets = this.globalFleets.filter((fl: any) =>
            fl.factionId === aiFac.id && fl.units && fl.units.length > 0);
        if (fleets.length === 0) return;
        const myTeam = this.factionMap.get(aiFac.id)?.team;
        const enemyFleets = this.globalFleets.filter((fl: any) => {
            const ef = this.factionMap.get(fl.factionId);
            return ef && ef.team !== myTeam && fl.units && fl.units.length > 0;
        });
        // [v31-A] 与战略层**统一口径**：性格判定**优先读提督标签**。
        //   旧实现只读 `admiralStats`，与 `:673`（v29 已改为标签优先）**口径不一致** ——
        //   同一文件里曾并存两套"性格"判定（`24` §1 证据 2）。
        const doctrine: AdmiralDoctrine = (aiFac as any)._doctrine
            ?? ((aiFac as any)._doctrine = resolveAdmiralDoctrine((aiFac as any).admiralTags));
        const AGG_SET = ['aggressive', 'frontal_assault', 'mobile_raid'];
        const CAUT_SET = ['cautious', 'counter_defense', 'logistics_focus'];
        const admStats = aiFac.admiralStats || {};
        const agg = (admStats.attack || 50) + (admStats.command || 50);
        const caut = (admStats.defense || 50) + (admStats.tactics || 50);
        const personality = (doctrine.styleTag && AGG_SET.includes(doctrine.styleTag)) ? 'aggressive'
            : (doctrine.styleTag && CAUT_SET.includes(doctrine.styleTag)) ? 'cautious'
            : agg > caut + 20 ? 'aggressive' : (caut > agg + 20 ? 'cautious' : 'balanced');
        const diff = this.store.selectedDiff || 'normal';
        // 按兵力降序：最强 → 突击；其余按序 → 夺取 / 协同 / 坚守 / 补给
        const scored = fleets
            .map((fl: any) => ({ fl, power: this.calculateFleetPower(fl) }))
            .sort((a: any, b: any) => b.power - a.power);
        scored.forEach((entry: any, idx: number) => {
            const fl = entry.fl;
            const supply = this.fleetSupplyPct(fl);
            const isLast = idx === scored.length - 1;
            let role: string;
            let mission: Mission;
            if (supply < 25) {
                // 断粮优先：撤回后勤站补货（既有任务类型）
                role = 'resupply';
                mission = buildMission('retreat_supply', {});
            } else if (idx === 0 && enemyFleets.length > 0) {
                // 头号主力 → 突击敌方可见舰队
                role = 'assault';
                const tgt = enemyFleets[0];
                mission = buildMission('attack_fleet', {
                    targetId: tgt.id,
                    targetName: this.factionMap.get(tgt.factionId)?.name || '敌舰队',
                });
            } else if (isLast && (personality === 'cautious' || diff === 'easy')) {
                // 末位且保守/低难度 → 原地坚守
                role = 'hold';
                mission = buildMission('hold_point', { x: Math.round(fl.x), y: Math.round(fl.y) });
            } else if (idx % 2 === 1 && enemyFleets.length > 1) {
                // 次主力 → 协同头号主力作战
                role = 'support';
                const leaderFacId = scored[0].fl.factionId;
                mission = buildMission('support_fleet', {
                    targetId: leaderFacId,
                    targetName: this.factionMap.get(leaderFacId)?.name || '友军',
                });
            } else {
                // 其余 → 夺取最近的中立星球/中继（targetId=0 由 executeMissionTick 解析最近目标）
                role = 'capture';
                mission = buildMission('capture_planet', { targetId: 0, targetName: '最近的中立星球' });
            }
            fl.mission = mission;
            fl._planRole = role;
            // [v31-A] **出场阵型 = 该提督的教范阵型**（用户核心诉求：毕典菲尔特出场就该是楔形，
            //   而不是"长条"）。此前本函数**全文无 formation 赋值** ⇒ 出场到战略层首个 Tick 之间
            //   的窗口里舰队没有阵型（出厂值未设）⇒ 观感上"提督特性完全没生效"。
            fl.formation = doctrine.formation;
        });

        // [v31-C] **分舰队编成**：按战法把本方舰队编成多路（够则直接分工、不足则拆最强的一支）。
        //   这是"迂回 / 包抄 / 诱饵 / 后勤战"从抽象变成战场的唯一入口。
        //   战法选择 = `taskForce.selectManeuver`（教范偏好 → 态势可行性 → 降级链）；
        //   机动几何复用 `config/fleetSplitManeuver.ts`（已具备三幕包抄的闭式不互穿保证）。
        this.applyManeuver(aiFac, fleets, enemyFleets);
    }

    /** [V18-A · P1] 把「总指挥确认卡」所需候选/判定依据镜像到 store（供 CouncilWarRoom 渲染） */
    private publishSupremeCommanderPanel() {
        const cands: any[] = [];
        this.globalFleets.forEach((fl: any) => {
            const fac = this.factionMap.get(fl.factionId);
            if (!fac || fac.team !== 1) return;
            const cid = (fl.commanderId ?? null) as number | null;
            const adm = cid != null ? (this.store.allAdmirals as any[]).find((a: any) => a.id === cid) : undefined;
            const roleKey = (adm?.role ?? 'none') as string;
            cands.push({
                id: cid != null ? cid : fac.id,
                factionId: fac.id,
                commanderId: cid,
                name: adm?.name || fac.name || '未知提督',
                rank: adm?.rank ?? 0,
                roleLabel: (ROLE_LABEL as any)[roleKey] ?? roleKey,
                tactics: adm?.stats?.tactics ?? 0,
                disabled: cid == null || !adm,
            });
        });
        (this.store as any).supremeCommanderCandidates = cands;
    }

    /** P6 重大事件横幅：全屏居中大字 + 扩散动画（替代小 toast 的仪式感） */
    private showBattleBanner(title: string, subtitle: string, color: string = '#fbbf24') {
        const cam = this.cameras.main;
        const cx = cam.width / 2;
        const cy = cam.height / 2;

        const titleTxt = this.add.text(cx, cy - 14, title, {
            fontSize: '30px', color, fontStyle: 'bold', fontFamily: 'monospace',
            backgroundColor: 'rgba(4,8,16,0.75)', padding: { x: 24, y: 10 },
        }).setOrigin(0.5).setDepth(120).setScrollFactor(0).setAlpha(0);

        const subTxt = this.add.text(cx, cy + 26, subtitle, {
            fontSize: '13px', color: '#94a3b8', fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(120).setScrollFactor(0).setAlpha(0);

        // 入场：淡入 + 轻微放大
        this.tweens.add({ targets: [titleTxt, subTxt], alpha: 1, duration: 250, ease: 'Sine.easeOut' });
        this.tweens.add({ targets: titleTxt, scale: 1.08, duration: 250, yoyo: true, ease: 'Sine.easeOut' });
        this.cameras.main.shake(200, 0.003);

        // 停留 1.8 秒后淡出
        this.time.delayedCall(1800, () => {
            this.tweens.add({ targets: [titleTxt, subTxt], alpha: 0, duration: 400, onComplete: () => { titleTxt.destroy(); subTxt.destroy(); } });
        });
    }

    // 解析大地图真实兵力（解除原有的 tile 强校验阻塞）
    private spawnStrategicFleets(state: any) {
        this.globalFleets = [];

        // 获取攻守双方的出生位置（从 faction.castlePos 读取，已在 buildCampaignEnvironment 中设置）
        const attackerFac = this.factionMap.get(state.attackers?.[0]?.factionId);
        const defenderFac = this.factionMap.get(state.defenders?.[0]?.factionId);
        // 指挥制下兜底同步按动态出生距离（正常路径 castlePos 已由 buildCampaignEnvironment 给足，
        // 这里是 castlePos 缺失时的兜底，hex/crt 保持 ±150 原样）
        const fallbackSpawnDist = this.commandSpawnDist;
        const attackerSpawn = attackerFac?.castlePos || { x: -fallbackSpawnDist, y: 0 };
        const defenderSpawn = defenderFac?.castlePos || { x: fallbackSpawnDist, y: 0 };

        const deploySide = (fleetsData: any[], isAttacker: boolean) => {
            const spawnX = isAttacker ? attackerSpawn.x : defenderSpawn.x;
            const spawnY = isAttacker ? attackerSpawn.y : defenderSpawn.y;
            // [v14 ⑤] 同方多舰队沿**垂直于推进轴**（y）错开：2 队居中对称、3+ 队均匀分布，
            // 间距 = 各队阵型足迹最大值（deployGapFor，下限 160px）；单队 dy=0（= 旧行为）。
            const nSide = fleetsData.length;
            fleetsData.forEach((fleetData: any, fi: number) => {
                const combatCount = (fleetData.slots || []).filter((s: any) => s.type !== 'supply' && s.type !== '补给').length;
                const gap = this.deployGapFor(fleetData.formation || 'wedge', combatCount);
                const dy = nSide > 1 ? (fi - (nSide - 1) / 2) * gap : 0;
                const fleetObj: any = {
                    id: fleetData.fleetId, displayId: this.globalFleets.length + 1,
                    factionId: fleetData.factionId, target: null, state: 'idle',
                    units: [], formation: fleetData.formation || 'wedge',
                    commanderId: (fleetData as any).commanderId ?? null,
                    flagshipName: (fleetData as any).flagshipName || '',
                    facingAngle: isAttacker ? 0 : Math.PI,
                    stance: 'search', lastState: 'idle', halfHpTriggered: false,
                    morale: (fleetData as any).morale ?? 100,
                    x: spawnX,
                    y: spawnY + dy
                };

                if (!fleetData.slots) return;

                // [阵型] 本舰队参与阵型定位的阵位计数器（运输舰不占位，见下方 formationSlot）
                let formationSlotCounter = 0;

                fleetData.slots.forEach((slot: any, slotIdx: number) => {
                    let texture = 'flame';
                    if (slot.type === 'battleship') texture = fleetData.factionId === 2 ? 'brunhild' : 'hyperion';
                    else if (slot.type === 'cruiser') texture = fleetData.factionId === 2 ? 'empire_ship' : 'alliance_ship';
                    else if (slot.type === 'destroyer') texture = fleetData.factionId === 2 ? 'empire_ship' : 'alliance_ship';

                    const unitContainer = this.add.container(fleetObj.x, fleetObj.y).setDepth(5);
                    const aura = this.add.ellipse(0, 0, 30, 10, isAttacker ? 0x3b82f6 : 0xef4444, 0.4).setName('aura');
                    const shipImg = this.add.image(0, 0, texture).setName('border').setDisplaySize(11, 33);
                    const flame = this.add.image(-15, 0, 'flame').setName('flame').setDisplaySize(20, 6).setVisible(false);
                    const typeText = this.add.text(0, -12, slot.type.substring(0, 2).toUpperCase(), { fontSize: '9px', color: '#ffffff' }).setOrigin(0.5).setName('text');

                    unitContainer.add([aura, flame, shipImg, typeText]);

                    if (!isAttacker) shipImg.setFlipX(true);

                    // [阵型] 稳定槽位：fleet.units 在单位被击毁时会被 filter 重赋值（索引整体前移），
                    // 用循环 index 取阵位会让幸存舰瞬移。这里在部署期就把阵位固定下来。
                    // 运输舰不参与阵型定位（见 moveAuxShips 独立往返），故不占用阵位号。
                    const isSupply = slot.type === 'supply' || slot.type === '补给';
                    const formationSlot = isSupply ? -1 : formationSlotCounter;

                    fleetObj.units.push({
                        sprite: unitContainer, factionId: fleetData.factionId,
                        hp: slot.hp, maxHp: slot.maxHp, atk: slot.atk || 50, def: 10,
                        // v5 超视距射程分层（与 gameData baseStats 同源口径）
                        range: slot.type === 'battleship' ? 880 : (slot.type === 'cruiser' ? 720 : 580),
                        classType: slot.type, atkInterval: 2000, speed: 1.0,
                        lastAtkTime: -((slotIdx * 400) % 2000), state: 'moving', supply: 100,
                        // v6.5 弹药：驱逐 12 / 巡洋 8 轮齐射（2s 攻击间隔 ≈ 前中期火力持续）
                        missileAmmo: slot.type === 'destroyer' ? 12 : (slot.type === 'cruiser' ? 8 : 999),
                        // [兵力折算] 该实体摊到的精确兵力，战后回写优先用它（不再从 HP 反推）
                        shipCount: (slot as any).shipCount,
                        // [阵型] 部署期固定的阵位号（-1 = 不参与阵型定位）
                        formationSlot,
                        gridX: slot.x,
                        gridY: slot.y
                    });
                    if (!isSupply) formationSlotCounter += 1;
                });
                // [阵型] 本舰队开局参与布阵的实体数（阵型按它枚举；与 units.length 不同，
                // 因为运输舰被排除在阵位之外）
                fleetObj.formationCount0 = formationSlotCounter;
                this.globalFleets.push(fleetObj);
            });
        };

        deploySide(state.attackers, true);
        deploySide(state.defenders, false);
        (this.store as any).triggerToast?.('战区折跃完成，已建立全周天战网。');
    }

    /**
     * 一支演习舰队要画出来的实体清单（**唯一建舰口径**）。
     *
     * 优先走兵力折算：`fac.composition`（该军衔的满编编制）+ `fac.entityBudget`（全场分摊后的实体预算）
     *   → `buildTacticalUnits`（与战役轨道**同一个入口**）→ 每实体 { cls, count, hp/atk/def/speed/range/interval }。
     * 编制缺失时回落旧的 `fac.deck` 行为（保底可用，且便于回归对照）。
     *
     * 补给舰：编制的 `supplies > 0` ⇒ `allocateUnitsPerType` 会给它 ≥1 个实体、`cls = '补给'`，
     * 于是 `collectAuxShips` 仍能收集到运输舰 —— 后勤战不会因这次改动消失。
     */
    private spawnUnitsForFaction(fac: any): {
        cls: string; count?: number; hp: number; maxHp: number; atk: number;
        def: number; speed: number; range: number; interval: number;
    }[] {
        const comp = fac.composition;
        const budget = Number(fac.entityBudget) || 0;
        if (comp && budget > 0) {
            const totals = totalsOfComposition(comp);
            // 倍率固定为 1：演习轨道历史上**没有**"提督属性乘到单舰数值"这一层（副官加成只进 admiralStats），
            // 难度差改由兵力（军衔）表达 ⇒ 不要在这里引入新的数值层，否则两条轨道又不同源。
            const mods: ShipStatMods = { hpMul: 1, atkMul: 1, defMul: 1, engineMul: 1 };
            const trait = String(fac.trait || 'empire');
            const units = buildTacticalUnits(
                totals, budget, mods,
                (type) => (this.store.getTroopById(`${trait}_${SHIP_TYPE_CN[type]}_1`) as TroopLike | undefined),
            );
            return units.map((u) => ({
                cls: u.classType,
                count: u.count,
                hp: u.hp, maxHp: u.maxHp, atk: u.atk, def: u.def,
                speed: u.speed, range: u.range, interval: u.interval,
            }));
        }
        // 回落：旧 deck 行为（逐条 = 1 艘，数值取 troop 表）
        const deck: string[] = (fac.deck || []).filter(Boolean);
        return deck.map((classId: string) => {
            const t: any = this.store.getTroopById(classId) || {};
            return {
                cls: String(t.cls || '驱逐'),
                hp: Number(t.hp) || 100, maxHp: Number(t.hp) || 100, atk: Number(t.atk) || 50,
                def: Number(t.def) || 10, speed: Number(t.speed) || 1,
                range: Number(t.range) || 150, interval: Number(t.interval) || 3000,
            };
        });
    }

    /**
     * [v14 ⑤] 同方多舰队最小部署间距（像素）：≥ 该队阵型足迹 + 安全沟。
     * 垂直方向半跨 = max|gy|（formationOffsets 的 y 分量 × 像素格距），
     * 间距 = max(160, (2·半跨+1)·格距 × 1.35) —— 1.35× 即"足迹 + ~35% 安全沟"。
     * 垂直轴 = 垂直于推进轴：推进恒沿 x（攻守沿 x 相向），故垂直落在 y。
     */
    private deployGapFor(formation: string, entityCount: number): number {
        const cnt = Math.max(1, entityCount);
        const offs = formationOffsets((formation || 'wedge') as FormationType, cnt);
        const spacing = formationSpacing(offs, this.hexRadius);
        const halfSpan = offs.reduce((m, c) => Math.max(m, Math.abs(c[1])), 0);
        return Math.max(DEPLOY_GAP_MIN, (halfSpan * 2 + 1) * spacing * DEPLOY_GAP_FOOTPRINT_K);
    }

    // 保留旧方法供可能的回退（不删除，只从 create 中去掉调用）
    private spawnInitialFleets() {
        this.store.factions.forEach((fac: any) => {
            if (!fac.active || !fac.castlePos) return;
            const spawnList = this.spawnUnitsForFaction(fac);
            if (spawnList.length === 0) return;

            const fleetId = Math.random();
            const fleet: any = {
                id: fleetId, displayId: this.globalFleets.length + 1, factionId: fac.id,
                commanderId: fac.id, flagshipName: (fac as any).flagshipName || (this.store.allAdmirals as any[]).find((a: any) => a.id === fac.id)?.flagshipName || '',
                x: fac.castlePos.x, y: fac.castlePos.y, target: null, state: 'assembling', units: [] as any[],
                formation: ['wedge', 'line', 'spindle', 'circle', 'square'][Math.floor(Math.random() * 5)] as any,
                facingAngle: 0, stance: 'search', targetFlare: null,
                lastState: 'assembling', halfHpTriggered: false, // 追加状态记忆
                morale: 100,  // 士气(0-100)：断粮时先掉士气，归零后才扣结构生命
            };
            this.time.delayedCall(800, () => this.showFleetDialogue(fleet, 'spawn')); // 延迟触发舰队出击语录

            this.globalFleets.push(fleet);

            // [阵型] 本舰队参与阵型定位的阵位计数器（运输舰不占位，见下方 formationSlot）
            let formationSlotCounter = 0;

            spawnList.forEach((u, idx: number) => {
                const cls = u.cls;                       // 中文 cls（'战列' / '巡洋' / '驱逐' / '补给' / …）
                const hp = u.hp, maxHp = u.maxHp, atk = u.atk, def = u.def;
                const range = u.range, interval = u.interval, speed = u.speed;
                const isFlagship = idx === 0;
                // [阵型] 稳定槽位：fleet.units 在单位被击毁时会被 filter 重赋值（索引整体前移），
                // 用循环 index 取阵位会让幸存舰瞬移。这里在建造期就把阵位固定下来。
                // 口径与战役路径一致：运输舰不参与阵型定位，故不占用阵位号。
                const isSupplyDeck = cls === '补给';
                const formationSlot = isSupplyDeck ? -1 : formationSlotCounter;
                
                const unitContainer = this.add.container(fac.castlePos.x, fac.castlePos.y).setDepth(isFlagship ? 6 : 5);
                unitContainer.setSize(16, 16);
                const shipTypeCode = getShipTypeCode(fac.trait, cls);
                
                // 1. 判断该用什么贴图
                let textureKey = '';
                if (isFlagship) {
                    if (fac.name.includes('杨威利')) textureKey = 'hyperion';
                    else if (fac.name.includes('莱茵哈特')) textureKey = 'brunhild';
                    else textureKey = fac.trait === 'empire' ? 'empire_ship' : 'alliance_ship'; // 普通提督的通用旗舰
                } else {
                    textureKey = fac.trait === 'empire' ? 'empire_ship' : 'alliance_ship';
                }

                // 2. 绘制阵营底盘光环（因为图片没法像方块那样描边，需要用底色光环区分敌我）
                const auraW = isFlagship ? 40 : (cls === '战列' || cls === '突击' ? 30 : 20);
                const auraH = isFlagship ? 15 : 10;
                // 添加阵营颜色的椭圆光环在飞船底部，并在脱离视野时变色
                const aura = this.add.ellipse(0, 0, auraW, auraH, fac.color, 0.4).setName('aura');

                // 2.5 战舰阴影已移除（俯视图场景中阴影会显示为黑块，影响美观）

                // 3. 生成真实的战舰贴图（原图为竖向俯视图，舰头朝上）
                // 不在此处设旋转角度，统一在 update() 中通过 rotation 补偿方向
                const shipImg = this.add.image(0, 0, textureKey).setName('border');
                // 原图为竖向（舰头朝上），宽高比约 1:3，setDisplaySize 保持竖向比例
                let shipLen = 42; // 战舰在容器坐标系下沿X轴的长度（旋转90度后）
                if (isFlagship) {
                    shipImg.setDisplaySize(14, 42);
                    shipLen = 42;
                }                 else {
                    if (cls === '战列' || cls === '突击') { shipImg.setDisplaySize(11, 33); shipLen = 33; }
                    else if (cls === '巡洋' || cls === '电子') { shipImg.setDisplaySize(9, 25); shipLen = 25; }
                    else if (cls === '补给') { shipImg.setDisplaySize(13, 40); shipLen = 40; } // 运输舰：加长醒目（后勤战核心目标）
                    else { shipImg.setDisplaySize(6, 18); shipLen = 18; } // 驱逐
                }

                // 3.5 尾焰：窄版明亮型PNG（48×16，宽高比3:1），NORMAL模式
                // 细长设计：辉光不会超出舰船宽度
                const flameLen = isFlagship ? 28 : (cls === '战列' || cls === '突击' ? 22 : (cls === '巡洋' || cls === '电子' ? 18 : (cls === '补给' ? 26 : 14)));
                const flame = this.add.image(-shipLen / 2, 0, 'flame').setName('flame');
                flame.setOrigin(0.5, 0.5);        // 居中原点
                flame.setDisplaySize(flameLen, flameLen / 3); // 宽高比3:1（很窄的长条）
                flame.setVisible(false);

                // 4. 将文字移到飞船尾部或侧边，避免挡住贴图
                const typeText = this.add.text(0, -12, isFlagship ? '★' : shipTypeCode, { fontSize: '9px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5).setName('text');

                // 添加顺序：光环 -> 尾焰 -> 战舰 -> 文字(顶)
                unitContainer.add([aura, flame, shipImg, typeText]);

                const initialAtkOffset = (idx * 300) % interval; 
                fleet.units.push({ 
                    sprite: unitContainer, factionId: fac.id, hp, maxHp, atk, def, range, 
                    classType: cls as any, atkInterval: interval, speed, tier: 'none', 
                    lastAtkTime: -initialAtkOffset, state: 'moving', supply: 100,
                    // [兵力折算] 该实体摊到的精确兵力 —— 战后回写优先用它（与战役轨道同口径；
                    // 回落 deck 路径时为 undefined，回写自动退回"从 HP 反推"）
                    shipCount: u.count,
                    // [阵型] 建造期固定的阵位号（-1 = 不参与阵型定位）
                    formationSlot,
                    // v6.5 弹药：巡洋 8 / 驱逐 12 轮齐射，其余舰种无导弹（999=不适用）
                    missileAmmo: cls === '巡洋' || cls === '电子' ? 8 : (cls === '驱逐' ? 12 : 999)
                });
                if (!isSupplyDeck) formationSlotCounter += 1;
            });
            // [阵型] 本舰队开局参与布阵的实体数（阵型按它枚举；与 units.length 不同，
            // 因为运输舰被排除在阵位之外）
            fleet.formationCount0 = formationSlotCounter;
        });

        // [v14 ⑤] 演习轨道（用户主用路径）同方多舰队初始部署错开——见 applyFleetDeploySpacing。
        this.applyFleetDeploySpacing();
    }

    /**
     * [v14 ⑤] 同方多舰队初始部署错开（演习轨道）：同一 team 的舰队按**垂直于推进轴**（y）
     * 均匀错开，间距 = 各队足迹最大值（deployGapFor，下限 160px）；2 队居中对称、3+ 队均匀分布。
     * 位移只改舰队与其实体 sprite 的初始 y（不改 castlePos 数据层，避免影响后勤/任务解算）。
     * 单队（n≤1）不动 ⇒ 与旧行为逐位一致。
     */
    private applyFleetDeploySpacing() {
        const byTeam = new Map<number, any[]>();
        for (const fl of this.globalFleets) {
            const tf = this.factionMap.get(fl.factionId);
            const team = tf ? tf.team : 1;
            if (!byTeam.has(team)) byTeam.set(team, []);
            byTeam.get(team)!.push(fl);
        }
        byTeam.forEach((fleets: any[]) => {
            const n = fleets.length;
            if (n <= 1) return;   // 单队无需错开（保持旧行为）
            let gap = DEPLOY_GAP_MIN;
            for (const fl of fleets) {
                gap = Math.max(gap, this.deployGapFor(fl.formation || 'wedge', fl.formationCount0 || fl.units.length));
            }
            fleets.forEach((fl, i) => {
                const dy = (i - (n - 1) / 2) * gap;   // 居中对称
                if (Math.abs(dy) < 1e-3) return;
                fl.y += dy;
                for (const u of fl.units) {
                    if (u.sprite) u.sprite.y += dy;
                }
            });
        });
    }

    private updateSupplyNetwork() {
        // 1. 初始化所有地块为断开状态
        this.tilesList.forEach(t => t.connected = false);

        // 2. 按 Team 分组进行全局连通性扫描（同盟共享后勤网）
        const teams = [...new Set(this.store.factions.map((f: any) => f.team))];
        
        teams.forEach(team => {
            // 获取该队伍下所有阵营的 ID 集合
            const teamFactionIds = this.store.factions.filter((f: any) => f.team === team).map((f: any) => f.id);
            if (teamFactionIds.length === 0) return;

            const queue: any[] = [];
            
            // 将该队伍所有阵营的司令部(castle)、已占领星球(planet)与中继补给站(relay)作为顶级供电源
            this.tilesList.forEach(t => {
                if (teamFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'planet' || t.type === 'relay')) {
                    t.connected = true;
                    queue.push(t);
                }
            });

            // BFS 扩散：只要是同 Team 的地块，全部视为导电体
            let head = 0;
            while (head < queue.length) {
                const curr = queue[head++];
                for (const dir of this.directions) {
                    const neighbor = this.tilesDict[`${curr.q + dir.q},${curr.r + dir.r}`];
                    // 如果邻居未通电，且属于我方团队的任何一个阵营，则为其通电并加入队列
                    if (neighbor && !neighbor.connected && teamFactionIds.includes(neighbor.ownerId)) {
                        neighbor.connected = true;
                        queue.push(neighbor);
                    }
                }
            }
        });

        // （原「CRT 模式重画全息棱柱」已随该模式删除）
    }

    /** 指挥制补给源作用半径（世界单位）：旗舰在此距离内即获得补给。
     *  初值由主理人设定，可按手感调整。 */
    private static readonly SUPPLY_BASE_RADIUS = 420;

    // ===== 补给链（后勤战）=====
    /** 运输舰列表（每帧从存活舰队收集） */
    private auxShips: any[] = [];
    /** v3 独立往返：unit → AuxShip 跨 Tick 持久化（坐标/货量/状态不因每 Tick 重建而丢失） */
    private auxPrevByUnit: Map<any, any> = new Map();
    /** 各舰队补给状态：fleet → FleetSupplyInfo */
    private supplyInfo: Map<any, any> = new Map();
    /** 补给链可视化图层（指挥制/2D 通用，画补给圈与链路） */
    private supplyGfx: Phaser.GameObjects.Graphics | null = null;

    /** 绘制补给链可视化：补给圈 + 链路 + 运输舰标记。
     *  让玩家一眼看出部队是否在补给范围内（此前完全不可见）。 */
    private drawSupplyChain() {
        const g = this.supplyGfx;
        if (!g) return;
        g.clear();
        if (!this.store.showSupplyChain) return;   // 可在设置里关闭

        // 补给源覆盖范围（基地/星球）
        this.store.factions.forEach((f: any) => {
            const tf = this.factionMap.get(f.id);
            if (!f.castlePos || !tf) return;
            g.lineStyle(1.5, tf.team === 1 ? 0x22c55e : 0xa855f7, 0.20);
            g.strokeCircle(f.castlePos.x, f.castlePos.y, SUPPLY_SOURCE_RADIUS);
        });
        this.tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'castle' && t.type !== 'relay') return;
            const tf = this.factionMap.get(t.ownerId);
            if (!tf) return;
            // v6.3：中继补给站补给圈 = SUPPLY_RELAY_RADIUS（500，1.19× 基准）——
            //   占领后圈变大，2D/3D 口径一致（v6.2 的 1.5× 配合全量中继满屏大圈，已收敛）
            const rr = t.type === 'relay' ? SUPPLY_RELAY_RADIUS : SUPPLY_SOURCE_RADIUS;
            g.lineStyle(1.2, tf.team === 1 ? 0x22c55e : 0xa855f7, 0.14);
            g.strokeCircle(t.x, t.y, rr);
        });

        // 运输舰：独立坐标 + 补给圈 + 状态表现（出航/补给/返航）
        this.auxShips.forEach((aux: any) => {
            if (!aux.unit || aux.unit.hp <= 0) return;
            const ax = aux.x;   // v3：独立坐标（不再 fleet.x + 偏移）
            const ay = aux.y;

            // 补给范围：仅补给/出航状态可见（返航/装货时不覆盖友军）
            if (aux.state === 'outbound' || aux.state === 'supplying') {
                g.lineStyle(1.5, 0xfb923c, 0.32);
                g.strokeCircle(ax, ay, SUPPLY_AUX_RADIUS);
            }

            // 运输舰本体标记（橙色方块，区别于作战舰）；装货时半透明闪烁
            const loading = aux.state === 'loading';
            g.fillStyle(0xfb923c, loading ? 0.35 : 0.9);
            g.fillRect(ax - 5, ay - 5, 10, 10);

            // 到母港的虚连线（装货/返航时表现"挂在补给线上"）
            if (loading || aux.state === 'returning') {
                g.lineStyle(1, 0xfb923c, 0.35);
                g.lineBetween(aux.homeX, aux.homeY, ax, ay);
            }
            // 到目标舰队的补给连线（出航/补给时）
            if ((aux.state === 'outbound' || aux.state === 'supplying') && aux.targetFleet) {
                g.lineStyle(1, 0xfb923c, 0.5);
                g.lineBetween(ax, ay, aux.targetFleet.x, aux.targetFleet.y);
            }
        });

        // 舰队补给状态指示：断链画红圈，链内画绿环
        this.supplyInfo.forEach((info: any, fl: any) => {
            if (!fl.units || fl.units.length === 0) return;
            if (info.inSupply) {
                g.lineStyle(2, 0x22c55e, 0.55);
                g.strokeCircle(fl.x, fl.y, 26);
            } else {
                g.lineStyle(2, 0xef4444, 0.60);
                g.strokeCircle(fl.x, fl.y, 26);
                // 断链警示：再画一个虚化红圈
                g.lineStyle(1, 0xef4444, 0.25);
                g.strokeCircle(fl.x, fl.y, 36);
            }
        });
    }

    /** 找最近的己方补给源（castle/planet/relay）的有效距离；无补给源返回 null。
     *  指挥制（无格子）下替代地块连通性判定，作为补给链的第一环。
     *  v6.3：中继补给站覆盖半径 = SUPPLY_RELAY_RADIUS——返回值是"超出补给圈边沿的量"
     *    （圈内 ≤0），与 SupplyChainSystem 的 eff 口径一致。 */
    private getNearestSupplySource(x: number, y: number, myTeam: number | undefined): number | null {
        let best: number | null = null;
        const consider = (d: number, isRelay: boolean) => {
            const eff = Math.max(0, d - (isRelay ? SUPPLY_RELAY_RADIUS : SUPPLY_SOURCE_RADIUS));
            if (best === null || eff < best) best = eff;
        };
        this.store.factions.forEach((f: any) => {
            const tf = this.factionMap.get(f.id);
            if (!tf || tf.team !== myTeam) return;
            // 己方司令部
            if (f.castlePos) {
                consider(Phaser.Math.Distance.Between(x, y, f.castlePos.x, f.castlePos.y), false);
            }
        });
        // 己方已占领星球/中继补给站
        this.tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'castle' && t.type !== 'relay') return;
            const tf = this.factionMap.get(t.ownerId);
            if (!tf || tf.team !== myTeam) return;
            consider(Phaser.Math.Distance.Between(x, y, t.x, t.y), t.type === 'relay');
        });
        return best;
    }

    private processSupplyAndCapture() {
        // ===== 补给链驱动（运输舰 AI + 补给状态计算）=====
        // v3 独立往返制：运输舰从补给源出发 → 前出补给 → 返航装货（不再跟随舰队）。
        // prevByUnit 跨 Tick 保留坐标/货量/状态（包装对象每 Tick 重建，unit 引用稳定）。
        const homeOf = (fl: any) => this.store.factions.find((f: any) => f.id === fl.factionId)?.castlePos ?? null;
        this.auxShips = collectAuxShips(
            this.globalFleets.filter(f => f.units && f.units.length > 0),
            homeOf, this.auxPrevByUnit);
        // 刷新跨 Tick 持久化映射（仅存活运输舰）
        this.auxPrevByUnit.clear();
        this.auxShips.forEach((aux: any) => { if (aux.unit) this.auxPrevByUnit.set(aux.unit, aux); });
        const srcNodes: SupplyNode[] = [];
        this.store.factions.forEach((f: any) => {
            const tf = this.factionMap.get(f.id);
            if (f.castlePos && tf) srcNodes.push({ x: f.castlePos.x, y: f.castlePos.y, team: tf.team, kind: 'castle' });
        });
        this.tilesList.forEach((t: any) => {
            if (t.type !== 'planet' && t.type !== 'castle' && t.type !== 'relay') return;
            const tf = this.factionMap.get(t.ownerId);
            if (tf) srcNodes.push({ x: t.x, y: t.y, team: tf.team, kind: t.type });
        });
        const teamOf = (fl: any) => this.factionMap.get(fl.factionId)?.team;
        this.supplyInfo = updateSupplyChain(
            this.globalFleets.filter(f => f.units && f.units.length > 0),
            srcNodes, this.auxShips, this.store.currentSpeedFactor || 1, teamOf);

        this.globalFleets.forEach(fl => {
            const fac = this.factionMap.get(fl.factionId);
            if (!fac || fl.units.length === 0) return;

            // 补给判定基准必须使用旗舰的物理坐标，而非舰队虚拟阵型锚点
            const flagship = fl.units[0];
            const realY = flagship.sprite.y;
            const fQ = Math.round((Math.sqrt(3)/3 * flagship.sprite.x - 1/3 * realY) / this.hexRadius);
            const fR = Math.round((2/3 * realY) / this.hexRadius);

            const currentTile = this.tilesDict[`${fQ},${fR}`];
            // 团队级补给：同team的任意阵营地块均可提供补给（非严格faction匹配）
            const myTeam = this.factionMap.get(fac.id)?.team;

            // ===== 补给判定：旗舰到最近己方补给源（castle / 占领的中继·星球）的空间距离 =====
            let inSupplyByDistance = false;
            // 补给链判定：优先用 SupplyChainSystem 的结果（含运输舰延伸范围）
            const chainInfo = this.supplyInfo.get(fl);
            if (chainInfo) {
                inSupplyByDistance = !!chainInfo.inSupply;
            } else {
                // v6.1：getNearestSupplySource 已改为"超圈余量"口径（圈内 ≤0）→ 直接判 ≤0
                const src = this.getNearestSupplySource(flagship.sprite.x, realY, myTeam);
                if (src !== null && src <= 0) inSupplyByDistance = true;
            }

            fl.units.forEach((u: any) => {
                if (inSupplyByDistance) {
                    u.supply = Math.min(100, (u.supply !== undefined ? u.supply : 100) + 5);
                } else {
                    // 动态后勤流失率：困难模式敌人自带补给压缩技术(流失极慢)，简单模式流失极快
                    let drainRate = 2;
                    if (fac.type === 'ai') {
                        drainRate = this.store.selectedDiff === 'hard' ? 1 : (this.store.selectedDiff === 'easy' ? 4 : 2);
                    }

                    u.supply = Math.max(0, (u.supply !== undefined ? u.supply : 100) - drainRate);
                }
            });

            // 后勤损耗属于舰队状态，不能随显示舰艇数量重复结算。先更新全舰补给，
            // 再按舰队平均补给只更新一次士气；士气归零后才允许断粮舰承受结构损失。
            const activeUnits = fl.units.filter((u: any) => u.hp > 0);
            const averageSupply = activeUnits.length > 0
                ? activeUnits.reduce((sum: number, u: any) => sum + (u.supply ?? 100), 0) / activeUnits.length
                : 100;
            if (fl.morale === undefined) fl.morale = 100;
            if (inSupplyByDistance) {
                fl.morale = Math.min(100, fl.morale + 1);
            } else {
                fl.morale = Math.max(0, fl.morale - moraleDrainPerTick(averageSupply));
                if (fl.morale <= 0) {
                    activeUnits.forEach((u: any) => {
                        if (u.supply <= 0) u.hp -= u.maxHp * 0.02;
                    });
                }
            }

            if (currentTile && currentTile.ownerId !== 0 && currentTile.ownerId !== fac.id 
                && currentTile.type !== 'planet' && currentTile.type !== 'castle'
                && fl.units.length > 0
                && Phaser.Math.Distance.Between(flagship.sprite.x, flagship.sprite.y, currentTile.x, currentTile.y) < 60) {
                // === 舰队攻占：站在敌方格子上持续削弱，HP归零即转手 ===
                if (currentTile.hp === undefined) currentTile.hp = 300;
                const totalAtk = fl.units.reduce((s: number, u: any) => s + (u.atk || 50), 0);
                currentTile.hp -= Math.max(25, totalAtk * 0.12);
                // 占领进度：hex透明度反映剩余HP（越低越接近占领）
                const hpPct = Math.max(0.05, currentTile.hp / 300);
                currentTile.sprite.setAlpha(0.4 + hpPct * 0.5);
                if (currentTile.hp <= 0) {
                    currentTile.ownerId = fac.id;
                    currentTile.hp = 0;
                    currentTile.sprite.setFillStyle(fac.color, 0.9);
                    currentTile.sprite.setStrokeStyle(2, fac.color, 1.0);
                    this.showFleetDialogue(fl, 'capture');
                    this.store.triggerToast(`前线据点已被 [${fac.name}] 攻占！`);
                    // v2 修复：占领后立即重新评估目标（推进/拆塔/回防），杜绝占领后发呆
                    fl.state = 'exploring';
                    fl.stance = 'search';
                    // R10-A1/B4：占领完成即清本舰队信标——否则若信标格 ≠ 占领格（玩家点在星球旁），
                    //   flaring 分支会因信标格仍解析为敌方而持续"停住等占领"，信标永不清除（A.2 卡死）。
                    this.clearFleetFlareIfCaptured(fl);
                    // P6 仪式感：玩家方占领 → 横幅
                    if (this.factionMap.get(fac.id)?.team === 1) this.showBattleBanner('前线据点攻占', '后勤线扩展', '#22c55e');
                    this.updateSupplyNetwork();
                }
            }

            // ===== 星球/中继站占领判定（v5 重构：占领动作链修复）=====
            // 旧根因：判定距离 50px < 舰队 siege 站位距离（getIdealEngageDist 90~260）
            //   → 舰队到位后永远够不到占领圈，停在星球旁"不知道在干什么"（用户实报）。
            //   且 currentTile 依赖旗舰 hex 反算定位，指挥制无格子语义。
            // v5：① hex 反算邻域 ±2 格扫描（多格拼图也不漏）；② 距离门槛放宽到 280
            //   （≥ 航母 siege 站位 260）；③ 舰队锚点直接用 fl.x/fl.y；④ 进度期即触发
            //   登陆艇视觉（startCapture 只在 capture 事件播一次，重复事件幂等）。
            if (fl.units.length > 0) {
                const capR = this.hexRadius * 2;
                const candTiles: any[] = [];
                    // 邻域扫描（±2 格）收集可占领目标。指挥制无格子语义，此路径恒定生效。
                    if (currentTile && (currentTile.type === 'planet' || currentTile.type === 'relay')) {
                        candTiles.push(currentTile);
                    }
                    const fQ0 = Math.round((Math.sqrt(3)/3 * flagship.sprite.x - 1/3 * realY) / this.hexRadius);
                    const fR0 = Math.round((2/3 * realY) / this.hexRadius);
                    for (let dq = -2; dq <= 2; dq++) {
                        for (let dr = -2; dr <= 2; dr++) {
                            const t = this.tilesDict[`${fQ0 + dq},${fR0 + dr}`];
                            if (t && t !== currentTile && (t.type === 'planet' || t.type === 'relay')) candTiles.push(t);
                        }
                    }
                    // 兜底：都不命中时按空间距离找最近的可占领目标
                    if (candTiles.length === 0) {
                        let bestT: any = null, bestD = capR;
                        this.tilesList.forEach((t: any) => {
                            if (t.type !== 'planet' && t.type !== 'relay') return;
                            const d = Phaser.Math.Distance.Between(fl.x, fl.y, t.x, t.y);
                            if (d < bestD) { bestD = d; bestT = t; }
                        });
                        if (bestT) candTiles.push(bestT);
                    }

                let capTarget: any = null;
                for (const ct of candTiles) {
                    if (ct.ownerId === fac.id) continue;
                    if (Phaser.Math.Distance.Between(fl.x, fl.y, ct.x, ct.y) < capR) { capTarget = ct; break; }
                }

                if (capTarget) {
                    // R10-A1/B9：记住本舰队的占领目标，供"离圈清零"使用（见下方 else 分支）
                    fl._capTarget = capTarget;
                    // 电子战与特种潜入判定
                    const hasSpecOps = fl.units.some((u: any) => u.classType === '电子' || u.classType === '突击');
                    const isHighIntel = (fac.admiralStats?.intelligence || 0) > 80;
                    const isInfiltration = fl.stance === 'siege' && (hasSpecOps || isHighIntel);

                    // 潜入状态下直接从内部瓦解结构，5倍速获取控制权
                    const captureSpeed = isInfiltration ? 100 : 20;
                    const wasZero = !(capTarget.captureProgress > 0);
                    capTarget.captureProgress = (capTarget.captureProgress || 0) + captureSpeed;
                    // 进度开始 → 登陆艇投放动画（幂等：startCapture 内部按坐标去重，进行中不重播）
                    if (wasZero) {
                        pushFx3d({ kind: 'capture', at: { x: capTarget.x, y: capTarget.y }, factionId: fac.id, color: fac.color });
                    }

                    if (capTarget.captureProgress >= 100) {
                        this.showFleetDialogue(fl, 'capture'); // 触发占领语录
                        capTarget.ownerId = fac.id;
                        capTarget.captureProgress = 0;
                        capTarget.sprite.setFillStyle(fac.color, 0.9); capTarget.sprite.setStrokeStyle(3, fac.color, 1.0);
                        fac.goldRate += 15;
                        this.store.triggerToast(`战略要地已被 [${fac.name}] 占领！后勤线扩展。`);
                        // v2 修复：占领星球后立即重新评估目标
                        fl.state = 'exploring';
                        fl.stance = 'search';
                        // R10-A1/B4：占领完成即清本舰队信标（见现象 A.2：信标残留导致原地等占领卡死）
                        this.clearFleetFlareIfCaptured(fl);

                        this.tilesList.forEach(t => {
                            const dist = Math.max(Math.abs(t.q - capTarget.q), Math.abs(t.r - capTarget.r), Math.abs(-t.q-t.r - (-capTarget.q-capTarget.r)));
                            if (dist <= 2 && t.type !== 'sea' && t.type !== 'ruined' && t.type !== 'planet' && t.type !== 'castle' && t.type !== 'relay') {
                                t.ownerId = fac.id; t.type = 'pending';
                                t.sprite.setFillStyle(fac.color, 0.9); t.text.setText('').setAlpha(0);
                            }
                        });
                    }
                } else {
                    // R10-A1/B9：离开占领圈 → 清除上一次占领目标的遗留进度。
                    //   原实现只清 currentTile（旗舰反算格）；若 capTarget 格 ≠ 旗舰所在格，
                    //   其 captureProgress 永不清零 → 幽灵进度（离圈后仍保留，回来接着算）。
                    const prevCap = fl._capTarget;
                    if (prevCap && prevCap.ownerId !== fac.id
                        && Phaser.Math.Distance.Between(fl.x, fl.y, prevCap.x, prevCap.y) >= capR) {
                        prevCap.captureProgress = 0;
                    }
                    fl._capTarget = null;
                    if (currentTile && (currentTile.type === 'planet' || currentTile.type === 'relay') && currentTile.ownerId !== fac.id) {
                        currentTile.captureProgress = 0;
                    }
                }
            }
        });
    }

    /** R10-A1/B4：占领完成后清除本舰队的战术信标。
     *  占领与信标是两条独立机制：`targetFlare` 原本只在 flaring 分支"信标格不再是敌占/未占领"时才清
     *  （即 flaring 分支内的 `else if (!isUncapturedPlanet)`）。若玩家把信标点在星球旁边、占领完成、
     *  但信标格本身仍是敌方/普通格，信标会残留 → flaring 分支持续把该舰队钉在原地"等一个够不到的占领"。
     *  "等一个够不到的占领"。此处在任何占领成功时主动清理，杜绝该卡死。
     *  仅当该信标就是玩家信标视觉（坐标吻合）时才销毁 playerFlare，避免误删他人信标。 */
    private clearFleetFlareIfCaptured(fl: any) {
        const flare = fl?.targetFlare;
        if (!flare) return;
        fl.targetFlare = null;
        if (this.playerFlare
            && Phaser.Math.Distance.Between(this.playerFlare.x, this.playerFlare.y, flare.x, flare.y) < 8) {
            this.playerFlare.destroy();
            this.playerFlare = null;
        }
    }

    /** R10-A3/BW-02：创建玩家信标视觉（自 deployFlare 前置段整体搬移，逐字等价）。
     *  门控前移后，仅"信标被接受"（delayed / 生效）时才调用本方法；被拒时不建视觉。 */
    private createPlayerFlareVisual(x: number, y: number) {
        if (this.playerFlare) this.playerFlare.destroy();
        this.playerFlare = this.add.container(x, y).setDepth(25);

        // 外层六边形环（匹配游戏hex主题）
        const hexGfx = this.add.graphics();
        const hexR = 24;
        const hexPtArr: number[] = [];
        for (let i = 0; i <= 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            hexPtArr.push(Math.cos(a) * hexR, Math.sin(a) * hexR);
        }
        hexGfx.lineStyle(1.5, 0x00ccff, 0.7);
        hexGfx.strokePath();
        hexGfx.beginPath();
        hexGfx.moveTo(hexPtArr[0], hexPtArr[1]);
        for (let i = 2; i < hexPtArr.length; i += 2) hexGfx.lineTo(hexPtArr[i], hexPtArr[i + 1]);
        hexGfx.strokePath();

        // 中层追踪环（带缺口，旋转）
        const ringGfx = this.add.graphics();
        ringGfx.lineStyle(1.5, 0x00ccff, 0.6);
        ringGfx.beginPath();
        ringGfx.arc(0, 0, 17, -Math.PI * 0.15, Math.PI * 2 - Math.PI * 0.15, false);
        ringGfx.strokePath();

        // 内层十字准星（HUD风格，中心镂空）
        const chGfx = this.add.graphics();
        chGfx.lineStyle(1, 0x00ff88, 0.5);
        const chL = 9, chGap = 5;
        chGfx.lineBetween(0, -chGap - chL, 0, -chGap);
        chGfx.lineBetween(0, chGap, 0, chGap + chL);
        chGfx.lineBetween(-chGap - chL, 0, -chGap, 0);
        chGfx.lineBetween(chGap, 0, chGap + chL, 0);

        // 中心光点
        const dot = this.add.circle(0, 0, 3, 0x00ff88, 0.9);

        this.playerFlare.add([hexGfx, ringGfx, chGfx, dot]);

        // 动画
        this.tweens.add({ targets: hexGfx, alpha: 0.25, duration: 900, repeat: -1, yoyo: true });
        this.tweens.add({ targets: ringGfx, rotation: Math.PI * 2, duration: 3500, repeat: -1 });
        this.tweens.add({ targets: dot, scaleX: 1.8, scaleY: 1.8, alpha: 0.25, duration: 700, repeat: -1, yoyo: true });
    }

    /** R10-A3/BW-02 幽灵信标修复：门控前移。
     *  原版「先建视觉（:1524-1566）→ 后判定门控（:1575-1596）」，silent / 频道满时 return 不回滚
     *  → 玩家看到信标动画却无舰队响应（= 幽灵信标），且旧信标已被无条件销毁。
     *  新顺序：选舰队 → 无舰队守卫 → 门控三分支 → 各分支动作；被拒时**不建视觉**（旧信标天然保留）。 */
    private deployFlare(x: number, y: number, factionId: number) {
        // ── 玩家专属命令：只允许发给已选中的己方舰队 ──
        const myFleets = this.globalFleets.filter(fl => fl.factionId === factionId && fl.units?.length > 0);
        const nearest: any = this.battleSelectedFleetId == null ? null
            : myFleets.find((fl: any) => fl.id === this.battleSelectedFleetId) ?? null;

        // 不允许按距离猜收件人：这会令一次给吉尔菲尔斯的命令改变莱因哈特的航向。
        if (!nearest) {
            this.store.triggerToast("⌁ 请先选中要接收信标的己方舰队，未投放信标。");
            return;
        }

        // ── 指挥带宽门控：新命令能否送达取决于链路状态（前移至视觉创建之前）──
        if (this.bwState && factionId === this.store.factions.find((f: any) => f.type === 'player')?.id) {
            const comm = this.getCommCenter();
            const dist = comm ? Phaser.Math.Distance.Between(nearest.x, nearest.y, comm.x, comm.y) : 0;
            const status = getLinkStatus(this.bwState, dist);

            if (status === 'silent') {
                this.store.triggerToast(`⌁ 通讯链路中断：目标舰队超出旗舰中继范围，拒收信标。它将继续执行既有命令。`);
                return;                                  // 被拒：不建视觉（旧信标保留）
            }
            if (status === 'delayed') {
                const delayMs = relayDelayMs(this.bwState, dist);
                this.createPlayerFlareVisual(x, y);      // delayed：保留视觉（同现状语义）
                queueDelayedOrder(this.bwState, 'flare', nearest.id, { x, y }, delayMs);
                this.store.triggerToast(`⇢ 信标数据包已发出，经中继节点转发中（预计 ${Math.round(delayMs / 1000)} 秒送达）。`);
                return;
            }
            // direct：频道锁定失败（容量满）→ 拒发
            if (!canOrderInstantly(this.bwState, status, nearest.id)) {
                this.store.triggerToast(`⌁ 通信频道已满（${this.bwState.channels.size}/${this.bwState.maxChannels}）：无法与更多舰队建立直连。`);
                return;                                  // 被拒：不建视觉（旧信标保留）
            }
        }

        // ── 生效：建视觉 + 写命令 + toast（同现状）──
        this.createPlayerFlareVisual(x, y);
        nearest.targetFlare = {x, y};
        nearest.stance = 'search';
        this.store.triggerToast("战术信标已部署，突击舰队正在改变航向。");
    }

    /** [R10-B2] 右键移动：把**选中**的己方舰队牵引到目标点。
     *  与 deployFlare **同通道**（`targetFlare` + `stance='search'`）、**同门控**（带宽三分支），
     *  唯一差别在"选哪支舰队"：信标取"距点击点**最近**的己方舰队"，move 取"玩家**选中**的那支"。
     *
     *  权限（β 口径，D1）：仅 `fac.type === 'player'` 可接收 move —— 此处是**第二道纵深校验**（第一道在右键分支 :3483）。
     *  不用 `DIRECT_COMMAND_TYPES`/`isDirectCommandAllowed`：战役模式下 `supremeCommanderId`
     *  可能被判给 team-1 的**盟军提督**，届时那条门控会误拒玩家自己的 move（违背诉求）。
     *
     *  门控语义与 deployFlare 逐字同构（team-lead 裁定②）：silent → 拒绝（不建视觉、旧标记保留）；
     *  delayed → 建视觉 + 复用 `'flare'` 订单类型入队；direct 且频道可 → 立即生效。 */
    private orderFleetMove(fleet: any, x: number, y: number) {
        const fac = fleet ? this.factionMap.get(fleet.factionId) : null;
        // ── 纵深校验（β 第二道）：非玩家阵营 / 无存活单位 → 拒绝 ──
        if (!fleet || !fac || fac.type !== 'player') {
            this.store.triggerToast("⛔ 该舰队不隶属于你可直接指挥的己方阵营。");
            return;
        }
        if (!fleet.units || fleet.units.length === 0) {
            this.store.triggerToast("⛔ 选中舰队已无可指挥单位。");
            return;
        }

        // ── 指挥带宽门控：与 deployFlare 逐字同构（接收方 = 选中舰队当前位置）──
        if (this.bwState) {
            const comm = this.getCommCenter();
            const dist = comm ? Phaser.Math.Distance.Between(fleet.x, fleet.y, comm.x, comm.y) : 0;
            const status = getLinkStatus(this.bwState, dist);

            if (status === 'silent') {
                this.store.triggerToast(`⌁ 通讯链路中断：目标舰队无法接收移动命令。它将继续执行既有命令。`);
                return;                                  // 被拒：不建视觉（旧标记保留）
            }
            if (status === 'delayed') {
                const delayMs = relayDelayMs(this.bwState, dist);
                this.createPlayerFlareVisual(x, y);      // delayed：保留视觉（与信标同语义）
                queueDelayedOrder(this.bwState, 'flare', fleet.id, { x, y }, delayMs);
                this.store.triggerToast(`⇢ 移动命令已发出，中继转发中（预计 ${Math.round(delayMs / 1000)} 秒送达）。`);
                return;
            }
            // direct：频道锁定失败（容量满）→ 拒发
            if (!canOrderInstantly(this.bwState, status, fleet.id)) {
                this.store.triggerToast(`⌁ 通信频道已满（${this.bwState.channels.size}/${this.bwState.maxChannels}）：无法与该舰队建立直连。`);
                return;                                  // 被拒：不建视觉（旧标记保留）
            }
        }

        // ── 生效：建视觉 + 写命令 + 清任务 + toast ──
        this.createPlayerFlareVisual(x, y);
        fleet.targetFlare = { x, y };
        fleet.stance = 'search';
        // D3：清任务（+ 军议面板镜像），否则 fleetIntentText 会显示旧任务名而舰队实际在 move。
        fleet.mission = null;
        (fac as any).mission = null;
        this.store.triggerToast(`▸ 【${fac.name || '己方舰队'}】已奉命前往目标空域。`);
    }

    /**
     * 构建地块**数据层**（`tilesList` / `tilesDict`）并为每格建一个**占位 sprite**。
     *
     * ⚠ 两个必须知道的前提（2026-09-20 三模式删除后）：
     *   ① **数据层是刚需** —— AI 的探索/目标选择、占领、补给判定全部读 `tilesList`/`tilesDict`，
     *      删掉它 AI 会"找不到任何地块目标 ⇒ 舰队原地不动"。
     *   ② **视觉层不是主路径** —— 指挥制下 `body.battle3d-mode` 会隐藏整个 Phaser 画布，
     *      这里建的 `poly`/`txt` 在正常战斗中**一个像素都看不到**；它们只是占位对象，
     *      供占领/买地等逻辑调用 `setFillStyle` / `setText` 时有落点（不存在的对象会抛错）。
     *      只有「3D overlay 8 秒内建不起来」的降级路径才会显示它们（见 App.vue）。
     */
    protected buildTileGrid(mapDataMatrix: any[]) {
        mapDataMatrix.forEach(data => {
            const x = this.hexRadius * (Math.sqrt(3) * data.q + Math.sqrt(3)/2 * data.r);
            const y = this.hexRadius * (3/2 * data.r);

            if (data.type === 'castle') {
               const fac = this.factionMap.get(data.ownerId);
               if(fac) fac.castlePos = { x, y };
            }

            const points: number[] = [];
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 180) * (60 * i - 30);
              points.push(x + this.hexRadius * Math.cos(angle)); points.push(y + this.hexRadius * Math.sin(angle));
            }

            let fillColor = 0x2d3446; let strokeColor = 0x475569; 
            const ownerFac = this.factionMap.get(data.ownerId);
            if (ownerFac) { fillColor = ownerFac.color; strokeColor = ownerFac.color; }
            else if (data.type === 'sea') { fillColor = 0x1e3a8a; strokeColor = 0x2563eb; }
            else if (data.type === 'ruined') { fillColor = 0x1c1917; strokeColor = 0x44403c; }
            else if (data.type === 'pier') { fillColor = 0x0284c7; strokeColor = 0x0ea5e9; }
            else if (data.type === 'planet') { fillColor = 0x92400e; strokeColor = 0xf59e0b; }
            else if (data.type === 'fortress') { fillColor = 0x2a2a3a; strokeColor = 0x6a6a7a; }
            else if (data.type === 'sea') { fillColor = 0x1e3a8a; strokeColor = 0x2563eb; }
            else if (data.type === 'ruined') { fillColor = 0x1c1917; strokeColor = 0x44403c; }
            else if (data.type === 'pier') { fillColor = 0x0284c7; strokeColor = 0x0ea5e9; }
            else if (data.type === 'planet') { fillColor = 0x92400e; strokeColor = 0xf59e0b; }
            else if (data.type === 'fortress') { fillColor = 0x2a2a3a; strokeColor = 0x6a6a7a; }
            
            const poly = this.add.polygon(0, 0, points, fillColor).setAlpha(0.9);
            const sWidth = (data.type === 'fortress') ? 2 : (ownerFac ? 3 : 1);
            poly.setStrokeStyle(sWidth, strokeColor, 1.0);
            poly.setOrigin(0).setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);

            // 要塞中心格：用星球图片代替 emoji（v6.9：战役轨道 q=15 / 演习轨道 q=18 两个中心）
            if (data.type === 'fortress' && ((data.q === 15 || data.q === 18) && data.r === 0)) {
                const planetImg = this.add.image(x, y, 'isserlohn_planet').setDisplaySize(this.hexRadius * 3, this.hexRadius * 3).setDepth(4);
                void planetImg;
            }

            let markTxt = "";
            let fontSize = "14px"; let txtColor = '#e2e8f0';
            if (data.type === 'castle') { 
                if (ownerFac && ownerFac.type === 'player') { markTxt = '★'; fontSize = '20px'; txtColor = '#00ffff'; }
                else if (ownerFac && ownerFac.team === 1) { markTxt = '◈'; fontSize = '20px'; txtColor = '#60a5fa'; }
                else { markTxt = '✇'; fontSize = '20px'; txtColor = '#f87171'; }
            }
            else if (data.type === 'sea' || data.type === 'ruined') markTxt = '';
            else if (data.type === 'pier') markTxt = '⚲';
            else if (data.type === 'planet') { markTxt = '🌍'; fontSize = '18px'; }
            else if (data.type === 'fortress') { markTxt = ''; fontSize = '10px'; } // 中心格用图片，其他要塞格不显示
            else if (data.type === 'gold_mine') markTxt = '✧';
            else if (data.type === 'tower') markTxt = '♜';
            else if (data.type === 'barracks') markTxt = '⚙';

            let txtAlpha = (data.type === 'sea' || data.type === 'ruined' || data.type === 'pending') ? 0.0 : 0.8;
            if (data.type === 'fortress') txtAlpha = 1.0;
            if (data.type === 'castle') txtAlpha = 1.0;

            const txt = this.add.text(x, y, markTxt, {
                fontSize: fontSize, color: txtColor, fontFamily: 'monospace', align: 'center'
            }).setOrigin(0.5).setAlpha(txtAlpha);

            if (data.type === 'castle') { txt.setStroke('#0f172a', 2); txt.setDepth(10); }

            const tileHp = (data.type === 'ruined' || data.type === 'sea' || data.type === 'fortress') ? 99999 : (data.hp || 150);
            if (data.type === 'planet') data.hp = 1000;
            
            const typeNames: Record<string, string> = {
                'sea': '深空暗流', 'ruined': '陨石废墟', 'pending': '未知空域', 
                'planet': '宜居行星', 'castle': '舰队司令部', 'pier': '星际码头', 
                'gold_mine': '富矿星团', 'tower': '防卫据点', 'barracks': '野战修补站'
            };

            const tile = {
              q: data.q, r: data.r, cost: data.cost, ownerId: data.ownerId, type: data.type,
              typeName: typeNames[data.type] || data.type,
              // [v35 G1] **必须把 `terrain` 搬进来** —— `buildMapData()` 在 `:4059-4066`
              //   往 `mapDataMatrix` 注入了 6 种空域地形（星云/小行星带/引力点/残骸区/机雷区/
              //   杰夫粒子云，共 27% 密度），但本函数**重建 tile 对象时漏了这个字段**
              //   ⇒ `getTerrainAt().terrain` 恒 `undefined` ⇒ `terrainEffect()` 恒中性
              //   ⇒ 移速/射程/闪避/索敌/持续损伤 **六处消费者全部空转**、地面标记也不画
              //   ⇒ 战场"零地形"（用户实报 2026-09-20："地图中是有各种空域地形的，我现在就一个中继点"）。
              //   ⚠ 这是**唯一断点**：`buildMapData` 的返回值直接作为本函数的 `mapDataMatrix` 参数
              //     （见 `:454 buildMapData()` → `:534 buildTileGrid(mapDataMatrix)`），同源同序。
              terrain: data.terrain,
              tileClass: 'none', tier: 'none', hp: tileHp, maxHp: tileHp, x, y, sprite: poly, text: txt, lastTowerShotTime: 0,
              connected: false, captureProgress: 0
            };

            // （原「陨石废墟碎石 / 深空暗流」装饰已随 hex 棋盘模式的视觉一并删除）

            // 左键/右键地块交互
            poly.on('pointerup', async (pointer: Phaser.Input.Pointer) => this.handleTileClick(pointer, tile, poly, txt));
            
            this.tilesList.push(tile);
            this.tilesDict[`${data.q},${data.r}`] = tile;
        });
    }

    /** 指挥制后勤战：战场中线带随机布置 3 个中立星球中继（ownerId=0），
     *  占领后纳入补给源（getNearestSupplySource/processSupplyAndCapture 已支持 planet，无需新写）。
     *  格网覆盖得到的位置就地改类型（复用已隐藏的 sprite）；覆盖不到的位置（战役小格网 + 大 hexRadius）
     *  合成隐藏地块——sprite/text 不可见但必须存在：占领逻辑会调用 setFillStyle/setText（:1070-1086）。
     *  hex/crt 直接 return，一行不动。 */
    /**
     * 提督扮演 A：总指挥判定（仅指挥制；hex/crt 直接返回，supremeCommanderId 保持 null = 不拦截）。
     *   演习/遭遇战：玩家选中的首位提督（dispatchAdmirals[0]，launchSimBattle 已写入 simSelectedAdmirals）
     *   战役：玩家方（team 1）出场舰队指挥官中按 职位 → 军衔 → 功绩 取最高（pickSupremeCommander）
     *   兜底：'player' 类型阵营 id（spawnInitialFleets 里 commanderId=fac.id，口径一致）
     */
    private computeSupremeCommander() {
        this.supremeCommanderId = null;
        (this.store as any).supremeCommanderId = null;
        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';
        let supremeId: number | null = null;
        // [V18-A · P1] 优先级：override（本场一次性玩家指定）> 自动选举。
        //   预留读取位：B（编成指定）落地后插队为 override > B > 自动。
        const override = (this.store as any).supremeCommanderOverrideId;
        if (typeof override === 'number' && override >= 0) {
            supremeId = override;
        } else if (!isCampaign) {
            const first = (this.store.dispatchAdmirals || [])[0];
            if (first !== undefined && first !== null) supremeId = first;
        } else {
            const cands: any[] = [];
            this.globalFleets.forEach((fl: any) => {
                const fac = this.factionMap.get(fl.factionId);
                if (!fac || fac.team !== 1 || fl.commanderId == null) return;
                const adm = (this.store.allAdmirals as any[]).find((a: any) => a.id === fl.commanderId);
                if (adm) cands.push(adm);
            });
            const supreme = pickSupremeCommander(cands);
            if (supreme) supremeId = supreme.id;
        }
        if (supremeId == null) {
            const pFac = this.store.factions.find((f: any) => f.type === 'player');
            if (pFac) supremeId = pFac.id;
        }
        this.supremeCommanderId = supremeId;
        (this.store as any).supremeCommanderId = supremeId;
        const sFac = this.store.factions.find((f: any) => f.id === supremeId);
        if (sFac) this.store.triggerToast?.(`◆ 总指挥：${sFac.name} — 你只能直接指挥其旗舰舰队，其余舰队请用军议面板下达任务`);
    }

    /**
     * 提督扮演 P0：总指挥舰队覆灭后的指挥继任（仅指挥制；hex/crt 直接返回）。
     * 在 update 的舰队清理后每帧调用（成本：几支舰队的一次 find，现任存活即返回）。
     *   1. 现任总指挥舰队仍存活（units.length > 0）→ 不动
     *   2. 已亡 → 从存活己方舰队指挥官按 职位→军衔→功绩 重算（pickSupremeCommander）+ toast + 镜像 store
     *   3. 无存活己方舰队 → supremeCommanderId = null（isDirectCommandAllowed 对 null 恒放行，
     *      兜底全控，避免玩家完全无法操作；通常此时已 gameOver）
     */
    private checkSupremeSuccession() {
        if (this.supremeCommanderId == null) return;
        const team1Alive = this.globalFleets.filter((fl: any) => {
            const fac = this.factionMap.get(fl.factionId);
            return fac && fac.team === 1 && fl.units && fl.units.length > 0;
        });
        // 1. 现任仍存活 → 无需继任
        if (team1Alive.some((fl: any) => fl.commanderId === this.supremeCommanderId)) return;
        // 3. 无存活己方舰队 → 兜底全控
        if (team1Alive.length === 0) {
            this.supremeCommanderId = null;
            (this.store as any).supremeCommanderId = null;
            return;
        }
        // 2. 从存活指挥官按 职位→军衔→功绩 取最高（数据缺失者兜底 none/R0/功绩0， fac.rank 可补军衔）
        const cands: any[] = [];
        team1Alive.forEach((fl: any) => {
            if (fl.commanderId == null) return;
            const adm = (this.store.allAdmirals as any[]).find((a: any) => a.id === fl.commanderId);
            const fac = this.factionMap.get(fl.factionId);
            cands.push(adm || { id: fl.commanderId, role: 'none', rank: fac?.rank ?? 0, stats: { tactics: 0 } });
        });
        const next = pickSupremeCommander(cands);
        if (!next) return;
        this.supremeCommanderId = next.id;
        (this.store as any).supremeCommanderId = next.id;
        const nFleet = this.globalFleets.find((fl: any) => fl.commanderId === next.id);
        const nName = nFleet ? (this.factionMap.get(nFleet.factionId)?.name || '舰队') : '舰队';
        this.store.triggerToast?.(`◆ ${nName} 接任总指挥 — 你现在直接指挥其旗舰舰队`);
        if ((this.store as any).addBattleLog) (this.store as any).addBattleLog({ text: `${nName} 接任总指挥`, type: 'battle' });
    }

    /** 中继补给源（v5 改为空间站 relay 类型，不再是星球）：占领后纳入补给网 */
    private spawnSupplyRelayPlanets() {
        // v6.3：星球→中继**限量**转换。v6.2 把 15~25 个随机星球全量转 relay，
        //   每个都带 630 半径灰圈 → 20 多个大圈叠满地图（用户实报"越设计越丑"）。
        //   中继是稀缺战略节点：只保留战线中线带至多 4 个（按距中线距离排序取最近），
        //   其余 planet 直接转 pending 普通格（消失，不再有模型与圈）。
        const planets = this.tilesList.filter((t: any) => t.type === 'planet');
        planets.sort((a: any, b: any) => Math.abs(a.y) - Math.abs(b.y));
        const KEEP = 4;
        planets.forEach((t: any, i: number) => {
            if (i < KEEP) {
                t.type = 'relay';
                t.typeName = '中继补给站';
                t.hp = 1000; t.maxHp = 1000;
            } else {
                t.type = 'pending';
                t.typeName = '未知空域';
                t.hp = 150; t.maxHp = 150;
            }
        });
        let placed = 0, guard = 0;
        // v6.6：中线带与避让缓冲随 commandSpawnDist 动态（v6.3 前硬编码 ±1100/±3000）
        const midBand = this.commandSpawnDist * (1100 / 3000);
        while (placed < 2 && guard++ < 200) {
            const px = (Math.random() * 2 - 1) * midBand;   // 战场中线带（随出生点比例同步）
            const py = (Math.random() * 2 - 1) * 700;
            // 避开攻守出生区（指挥制出生点已按地图半跨拉开，留 ≥500 缓冲）
            if (Math.abs(Math.abs(px) - this.commandSpawnDist) < 500) continue;
            const q = Math.round((Math.sqrt(3) / 3 * px - 1 / 3 * py) / this.hexRadius);
            const r = Math.round((2 / 3 * py) / this.hexRadius);
            const key = `${q},${r}`;
            const existing = this.tilesDict[key];
            if (existing && (existing.type === 'relay' || existing.type === 'castle'
                || existing.type === 'sea' || existing.type === 'ruined' || existing.type === 'fortress')) continue;
            if (existing) {
                existing.type = 'relay';
                existing.typeName = '中继补给站';
                existing.ownerId = 0;
                existing.hp = 1000; existing.maxHp = 1000;
            } else {
                const x = this.hexRadius * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
                const y = this.hexRadius * (3 / 2 * r);
                const points: number[] = [];
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 180) * (60 * i - 30);
                    points.push(x + this.hexRadius * Math.cos(angle), y + this.hexRadius * Math.sin(angle));
                }
                const poly = this.add.polygon(0, 0, points, 0x38bdf8).setAlpha(0).setVisible(false);
                const txt = this.add.text(x, y, '', { fontSize: '18px' }).setOrigin(0.5).setAlpha(0).setVisible(false);
                const tile: any = {
                    q, r, cost: 50, ownerId: 0, type: 'relay', typeName: '中继补给站',
                    tileClass: 'none', tier: 'none', hp: 1000, maxHp: 1000, x, y,
                    sprite: poly, text: txt, lastTowerShotTime: 0,
                    connected: false, captureProgress: 0,
                };
                this.tilesList.push(tile);
                this.tilesDict[key] = tile;
            }
            placed++;
        }
    }

    // ===== 为大地图会战生成纯净对峙宙域（无星系建筑、无经济节点）=====
    private buildCampaignMap() {
        const campaignMatrix: any[] = [];
        // 战役对峙宙域扩容：半径 6→10（127→331 格），3D 化后单帧 InstancedMesh 足以承载
        const radius = 10;
        for (let q = -radius; q <= radius; q++) {
            for (let r = -radius; r <= radius; r++) {
                if (Math.abs(q + r) > radius) continue;
                campaignMatrix.push({ q, r, cost: 50, type: 'pending', ownerId: 0 });
            }
        }
        this.buildTileGrid(campaignMatrix);
    }

    // 构建战役模式专属的无污染对峙空域
    private buildCampaignEnvironment(state: any) {
        this.store.factions = [];

        // 确定玩家所属阵营 ID（从 gameStore 的 playerAdmiral 查 faction）
        const pAdmId = (this.store as any).playerAdmiralId;
        const pAdm = pAdmId ? (this.store as any).allAdmirals?.find((a: any) => a.id === pAdmId) : null;
        const pFactionId = pAdm?.faction === 'alliance' ? 1 : (pAdm?.faction === 'empire' ? 2 : 0);

        // 阶段A：战役模式出生点按hexRadius动态缩放
        // 指挥制后勤战：v6.6 起不再硬编码——此时 buildMapData 尚未执行（战役轨道在
        //   buildCampaignEnvironment 内部才生成矩阵），先用 hexRadius×8 兜底（v6.6 前的
        //   演习/战术模拟走 computeCommandSpawnExtent 动态值），矩阵生成后由
        //   computeCommandSpawnExtent 的结果接管 castlePos 兜底逻辑。
        //   hex/crt: 26→208, 50→400（保持原样）
        const spawnDist = this.commandSpawnDist;

        if (state.attackers && state.attackers[0]) {
            const isPlayerFac = state.attackers[0].factionId === pFactionId;
            this.store.factions.push({
                id: state.attackers[0].factionId, type: isPlayerFac ? 'player' : 'ai', team: 1,
                name: state.attackers[0].commanderName,
                imageId: state.attackers[0].imageId,
                color: state.attackers[0].factionId === 1 ? 0x3b82f6 : 0xef4444, hp: 100, maxHp: 100, active: true,
                castlePos: { x: -spawnDist, y: 0 }
            });
        }
        if (state.defenders && state.defenders[0]) {
            const isPlayerFac = state.defenders[0].factionId === pFactionId;
            this.store.factions.push({
                id: state.defenders[0].factionId, type: isPlayerFac ? 'player' : 'ai', team: 2,
                name: state.defenders[0].commanderName,
                imageId: state.defenders[0].imageId,
                color: state.defenders[0].factionId === 2 ? 0xef4444 : 0x3b82f6, hp: 100, maxHp: 100, active: true,
                castlePos: { x: spawnDist, y: 0 }
            });
        }

        // 重建 faction 查找缓存：factions 已重新创建，旧缓存指向失效对象
        this.factionMap.clear();
        this.store.factions.forEach((f: any) => this.factionMap.set(f.id, f));

        // 判断是否为伊谢尔伦（nodeId=1 或名称匹配）
        const battleNodeId = state.battleNodeId;
        let isIserlohn = false;
        try {
            const nodeStore = useNodeStore();
            const battleNode = (nodeStore.nodes as unknown as any[]).find(n => n.id === battleNodeId);
            isIserlohn = battleNode && (battleNode.id === 1 || battleNode.name === '伊谢尔伦');
        } catch { /* ignore */ }

        const campaignMatrix: any[] = [];

        if (isIserlohn) {
            // 伊谢尔伦：长条形矩形地图，参考 random_rect 但更长更宽
            // q: -25 到 +25 (横向 51 格), r: -8 到 +8 (纵向 17 格)
            for (let q = -25; q <= 25; q++) {
                for (let r = -8; r <= 8; r++) {
                    let type = 'pending';
                    const rand = Math.random();
                    if (rand < 0.03) type = 'sea';
                    else if (rand < 0.05) type = 'ruined';
                    campaignMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
                }
            }
            // 要塞地块：q=15, r=0 中心 + 6 个相邻格
            const fortressOffsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
            fortressOffsets.forEach(([dq, dr]) => {
                const tile = campaignMatrix.find(t => t.q === 15 + dq && t.r === 0 + dr);
                if (tile) tile.type = 'fortress';
            });
            this.buildTileGrid(campaignMatrix);

            // 初始化要塞武器
            const fX = this.hexRadius * (Math.sqrt(3) * 15 + Math.sqrt(3) / 2 * 0);
            const fY = this.hexRadius * (3 / 2 * 0);
            const defenderFactionId = state.defenders?.[0]?.factionId ?? 2;
            this.fortressWeapon = {
                chargeTimer: 0,
                chargeInterval: 90000,     // 90秒冷却（原30s），雷神之锤一锤定音
                firstFireDelay: 50000,     // 首次发射需50秒（原15s）
                maxRange: 1200,            // 最大射程 [PLACEHOLDER]，轰不到地图最远端
                fireAngle: 0,              // 固定发射方向角（向右，q增大方向）
                fortressX: fX,
                fortressY: fY,
                fortressHp: 10000,
                fortressMaxHp: 10000,
                ownerFactionId: defenderFactionId,
                laserGraphics: this.add.graphics().setDepth(50),
                chargeGraphics: this.add.graphics().setDepth(49),
                hpBarBg: this.add.rectangle(fX, fY - 50, 80, 6, 0x1e293b).setDepth(51).setVisible(false),
                hpBarFill: this.add.rectangle(fX, fY - 50, 80, 6, 0xef4444).setDepth(52).setVisible(false),
                destroyed: false,
                isCharging: false,
            };
            // 调整初始视角：居中显示要塞区域，左右兼顾
            this.cameras.main.setZoom(0.3);
            this.cameras.main.centerOn(fX, 0);
            // 调整出生位置：攻方从左侧方远处进场，守方在要塞东侧驻防
            // 地图范围 q: -25 ~ +25，要塞在 q=15。攻方在 q≈-20，守方在 q≈22
            const atkQ = -20;
            const defQ = 22;
            const leftEdgeX = this.hexRadius * (Math.sqrt(3) * atkQ + Math.sqrt(3) / 2 * 0);
            const rightEdgeX = this.hexRadius * (Math.sqrt(3) * defQ + Math.sqrt(3) / 2 * 0);
            if (state.attackers?.[0]) {
                const fac = this.factionMap.get(state.attackers[0].factionId);
                if (fac) fac.castlePos = { x: leftEdgeX, y: 0 };
            }
            if (state.defenders?.[0]) {
                const fac = this.factionMap.get(state.defenders[0].factionId);
                if (fac) fac.castlePos = { x: rightEdgeX, y: 0 };
            }
        } else {
            // 通用圆形地图
            const radius = 6;
            for (let q = -radius; q <= radius; q++) {
                for (let r = -radius; r <= radius; r++) {
                    if (Math.abs(q + r) > radius) continue;
                    campaignMatrix.push({ q, r, cost: 50, type: 'pending', ownerId: 0 });
                }
            }
            this.buildTileGrid(campaignMatrix);
        }
    }



    /**
     * 提督扮演 B：任务指令 → 姿态/目的地解算（每秒 AI 决策循环调用）。
     * 输出：fleet.stance（复用既有状态机）+ fleet._missionDest（per-frame 探索分支的目的地牵引）。
     * 任务完成/目标失效 → 清空 fleet.mission 与 fac.mission 镜像，落回独立评估。
     */
    private executeMissionTick(fleet: any, fac: any) {
        const m = fleet.mission as Mission | null;
        if (!m) { fleet._missionDest = null; return; }
        const clearMission = () => { fleet.mission = null; fac.mission = null; fleet._missionDest = null; };
        const dist = (x: number, y: number) => Phaser.Math.Distance.Between(fleet.x, fleet.y, x, y);

        if (m.type === 'attack_fleet') {
            const tgt = this.globalFleets.find((fl: any) => fl.id === m.targetId);
            if (!tgt || !tgt.units || tgt.units.length === 0) { clearMission(); return; } // 目标已歼灭 → 任务完成
            if (!this.isStanceLocked(fleet)) fleet.stance = 'siege';   // [V18-B · B2] L2 写前检查 L1 锁
            fleet._missionDest = { x: tgt.x, y: tgt.y };
        } else if (m.type === 'capture_planet') {
            let dest: any = null;
            if (m.targetId) {
                // 夺取指定阵营根据地：目标阵营覆灭（根据地易主）→ 任务完成
                const tf = this.store.factions.find((f: any) => f.id === m.targetId);
                if (!tf || !tf.active) { clearMission(); return; }
                if (tf.castlePos) dest = { x: tf.castlePos.x, y: tf.castlePos.y };
            } else {
                // 夺取最近的非己方星球/中继补给站
                let best = Infinity;
                this.tilesList.forEach((t: any) => {
                    if ((t.type !== 'planet' && t.type !== 'relay') || t.ownerId === fac.id) return;
                    const d = dist(t.x, t.y);
                    if (d < best) { best = d; dest = { x: t.x, y: t.y }; }
                });
                if (!dest) { clearMission(); return; }
            }
            if (!this.isStanceLocked(fleet)) fleet.stance = 'siege';   // [V18-B · B2] L2 写前检查 L1 锁
            fleet._missionDest = dest;
        } else if (m.type === 'hold_point') {
            const hx = m.x ?? fleet.x, hy = m.y ?? fleet.y;
            fleet._missionDest = { x: hx, y: hy };
            if (!this.isStanceLocked(fleet)) fleet.stance = dist(hx, hy) < 120 ? 'defend' : 'search'; // [V18-B · B2] L2 写前检查 L1 锁；到位转驻守，未到先机动
        } else if (m.type === 'support_fleet') {
            const tgt = this.globalFleets.find((fl: any) => fl.id === m.targetId);
            if (!tgt || !tgt.units || tgt.units.length === 0) { clearMission(); return; }
            const escort = escortDestination(
                { x: tgt.x, y: tgt.y, facing: tgt.facingSmooth ?? tgt.facingAngle ?? 0 },
                fleet,
                Math.max(180, this.getIdealEngageDist(fleet) * 0.6),
            );
            fleet._missionDest = escort;
            // 协同舰队驻在友军后方，既能掩护撤离也不会与主队重叠。
            if (!this.isStanceLocked(fleet)) fleet.stance = dist(escort.x, escort.y) > 100 ? 'search' : 'defend'; // [V18-B · B2] L2 写前检查 L1 锁
        } else if (m.type === 'retreat_supply') {
            if (!this.isStanceLocked(fleet)) fleet.stance = 'fallback'; // [V18-B · B2] L2 写前检查 L1 锁；既有撤退状态机：自动找补给点、驻留重组
            const supply = this.fleetSupplyPct(fleet);
            if (fleet.state !== 'retreating' && supply > 80) clearMission(); // 补货完成 → 归队听调
        }
    }

    // ===== 指令调度器绑定 =====
    /** [G4] 战前军议全屏层下达的部署动作。取值域与键盘路径共用（阵型 5 种 / 姿态 3 种），
     *  非法值一律忽略 ⇒ 前端传错不会把 `deployFormation` 写成垃圾值。
     *  ⚠ 仅在 `deployPhase` 内生效：开战后到达的动作全部丢弃（防止界面残留点击把已开的战再开一次）。 */
    private onDeployAction(action: string, value?: any) {
        if (!this.deployPhase) return;
        if (action === 'formation') {
            const allowed = ['wedge', 'line', 'spindle', 'circle', 'square'];
            if (typeof value === 'string' && allowed.includes(value)) {
                this.deployFormation = value;
                (this.store as any).deployFormation = value;   // UI 回读
                this.updateDeployText();
            }
            return;
        }
        if (action === 'tactic') {
            const allowed = ['search', 'siege', 'defend'];
            if (typeof value === 'string' && allowed.includes(value)) {
                this.deployTactic = value;
                (this.store as any).deployTactic = value;
                this.updateDeployText();
            }
            return;
        }
        if (action === 'start') {
            this.startBattleAfterDeploy();
        }
    }

    private setupCommandDispatcher() {
        // [G4] 战前军议全屏层 → 「部署动作」通道（阵型 / 旗舰姿态 / 开战）。
        //   与键盘路径（1-5 / T / 回车）等价，两条路径都回写 store 镜像供 UI 回读。
        if (typeof (this.store as any).setPhaserDeployDispatcher === 'function') {
            (this.store as any).setPhaserDeployDispatcher((action: string, value?: any) => {
                this.onDeployAction(action, value);
            });
        }
        if (typeof this.store.setPhaserCommandDispatcher === 'function') {
            this.store.setPhaserCommandDispatcher((id: number, type: string, payload: any) => {
                // 提督扮演：id 兼容 fleet.id（billboard）与 factionId/commanderId（军议面板只知阵营 id）
                const fleet = this.globalFleets.find(f => f.id === id)
                    || this.globalFleets.find(f => f.factionId === id || f.commanderId === id);
                if (fleet && fleet.factionId) {
                    const fac = this.factionMap.get(fleet.factionId);
                    if (fac && fac.team === 1) {
                        // ── 提督扮演 B：任务指令通道（非直接操控，任何己方舰队均可接收）──
                        if (type === 'mission') {
                            const m: Mission = { ...(payload || {}) };
                            // hold_point 缺省坐标 → 舰队当前位置（"坚守当前位置"）
                            if (m.type === 'hold_point' && (m.x === undefined || m.y === undefined)) {
                                m.x = Math.round(fleet.x); m.y = Math.round(fleet.y);
                            }
                            fleet.mission = m;
                            (fac as any).mission = m; // 镜像到 store.factions → 军议面板/billboard 显示
                            this.store.triggerToast(`◈ 任务已下达：${fac.name} — ${m.text || m.type}`);
                            return;
                        }
                        // ── 提督扮演 A：指挥权限——指挥制下只有总指挥旗舰接受直接命令 ──
                        // （supremeCommanderId=null 表示非指挥制/未判定，isDirectCommandAllowed 恒 true，hex/crt 零影响）
                    // v6：指挥制 1v1/少舰队时直接命令若被拒，多为 dispatchAdmirals 首位判定与舰队 commanderId
                    //   口径偏差所致——补一次兜底：己方仅 1 支存活舰队时其 commanderId 视为总指挥。
                    if (DIRECT_COMMAND_TYPES.includes(type) && !isDirectCommandAllowed(fleet, this.supremeCommanderId)) {
                        const team1Alive = this.globalFleets.filter((fl: any) => {
                            const f2 = this.factionMap.get(fl.factionId);
                            return f2 && f2.team === 1 && fl.units && fl.units.length > 0;
                        });
                        if (team1Alive.length === 1 && team1Alive[0].id === fleet.id) {
                            // 唯一己方舰队：修正总指挥指向并放行（自愈，无需重开战斗）
                            this.supremeCommanderId = fleet.commanderId;
                            (this.store as any).supremeCommanderId = fleet.commanderId;
                        } else {
                            this.store.triggerToast(`⛔ 扮演提督：你只能直接指挥总指挥旗舰。${fac.name} 请通过军议面板发布任务指令。`);
                            return;
                        }
                    }
                        if (type === 'stance') {
                            // ── 指挥带宽门控：变阵命令同样受链路状态约束 ──
                            if (this.bwState) {
                                const comm = this.getCommCenter();
                                const dist = comm ? Phaser.Math.Distance.Between(fleet.x, fleet.y, comm.x, comm.y) : 0;
                                const status = getLinkStatus(this.bwState, dist);
                                if (status === 'silent') {
                                    this.store.triggerToast(`⌁ 通讯链路中断：该舰队无法接收变阵命令，将继续按既有阵型行动。`);
                                    return;
                                }
                                if (status === 'delayed') {
                                    const delayMs = relayDelayMs(this.bwState, dist);
                                    queueDelayedOrder(this.bwState, 'stance', fleet.id, payload, delayMs);
                                    this.store.triggerToast(`⇢ 变阵命令已发出，中继转发中（预计 ${Math.round(delayMs / 1000)} 秒送达）。`);
                                    return;
                                }
                            }
                            this.applyStanceToFleet(fleet, payload);
                        }
                    }
                }
            });
        }
    }

    /**
     * 阶段A：动态地图扩容
     * 根据参战舰队总数动态缩放hexRadius，解决多舰队拥挤问题
     *
     * 规则：
     *   ≤4艘(1v1):   hexRadius=26 (~1300×1300)
     *   ≤8艘(2v2):   hexRadius=32 (~1600×1600)
     *   ≤12艘(3v3):  hexRadius=38 (~1900×1900)
     *   ≤16艘(4v4):  hexRadius=44 (~2200×2200)
     *   >16艘(5v5+): hexRadius=50 (~2500×2500)
     */
    /**
     * 演习轨道的军衔：非战斗序列（rank < 8）会被 `getShipLimit` 判为 0 → 编制全 0 →
     * **造出 0 艘的空舰队**（舰队直接从战场上消失）。故一律抬到准将 8。
     */
    private skirmishMilRank(rank: any): number {
        const r = Number(rank) || 0;
        return r >= 8 ? r : 8;
    }

    /** 演习轨道敌方军衔：用**兵力**表达难度差（旧实现用 deck 条数 4/6/8 表达，已废） */
    private skirmishEnemyMilRank(): number {
        if (!!(this.store as any).simMode) return 13;   // 战术模拟 = 满编（元帅/集团军）
        const diff = this.store.selectedDiff || 'normal';
        return diff === 'easy' ? 8 : (diff === 'hard' ? 12 : 10);
    }

    /**
     * 演习轨道编制 = 该军衔的满编比例（`gameStore.generateSimFullComposition`，与战役轨道同一真源）。
     * 取不到时返回 null，调用方回落旧 deck 行为。
     */
    private skirmishCompositionFor(milRank: number): any {
        const fn = (this.store as any).generateSimFullComposition;
        return typeof fn === 'function' ? fn(milRank) : null;
    }

    /**
     * 演习轨道的实体预算计划（**两个调用点的唯一真源**）：
     *   · `scaleMapForFleetCount` 要 Σ实体（决定 hexRadius）；
     *   · `spawnInitialFleets` 要每支舰队的实体数。
     * 纯函数式地从 store 状态复算（**不读 initFactions 的产物**）⇒ 两处结果必然一致。
     * 玩家第 i 支取 `dispatchAdmirals[i]` 的军衔；所有敌军共用 `skirmishEnemyMilRank()`。
     * 走全场分摊（`allocateVisualCounts`），与战役轨道同口径：Σ ≤ N_MAX、单队 ≤ N_MAX_PER_FLEET。
     */
    private skirmishEntityPlan(): { player: number[]; enemy: number } {
        const myAdmirals = this.store.dispatchAdmirals || [];
        const playerStrengths = myAdmirals.map((admId: number) => {
            const admInfo = this.store.allAdmirals.find((a: any) => a.id === admId);
            if (!admInfo) return 0;
            const comp = this.skirmishCompositionFor(this.skirmishMilRank(admInfo.rank));
            return comp ? totalShipsOf(totalsOfComposition(comp)) : 0;
        });
        const enemyCount = Math.max(1, parseInt(String(this.store.activeFactionCount), 10) || 2);
        const enemyComp = this.skirmishCompositionFor(this.skirmishEnemyMilRank());
        const enemyStrength = enemyComp ? totalShipsOf(totalsOfComposition(enemyComp)) : 0;
        const strengths = [...playerStrengths, ...Array.from({ length: enemyCount }, () => enemyStrength)];
        if (!strengths.some(s => s > 0)) return { player: playerStrengths.map(() => 0), enemy: 0 };
        const counts = allocateVisualCounts(strengths);
        return {
            player: counts.slice(0, playerStrengths.length).map((n, i) => (playerStrengths[i] > 0 ? n : 0)),
            enemy: enemyStrength > 0 ? (counts[playerStrengths.length] ?? 0) : 0,
        };
    }

    private scaleMapForFleetCount(state: any) {
        const isCampaign = state && state.mode === 'campaign';
        let totalShips = 0;

        if (isCampaign) {
            // 战役模式：从战术状态读取舰队编制
            const attackers = state?.attackers || [];
            const defenders = state?.defenders || [];
            attackers.forEach((f: any) => { totalShips += (f.slots || []).length; });
            defenders.forEach((f: any) => { totalShips += (f.slots || []).length; });
        } else {
            /* [大战场] 演习模式：必须按**折算后实体数**算地图尺度。
               旧实现数的是 `admInfo.deck.filter(Boolean).length`（卡组 8 槽）+ `enemyCount * 8`
               —— 那是"卡组条数"，不是实体数。后果：演习里 hexRadius 恒按 8 艘口径算（≤8 → 32），
               于是 spacingEff（= min(28, 6×hexR/halfExtent)）与舰体屏幕 px 一起被压小：
               就算把实体数改对，演习也不是会战尺度。
               ⚠ 本方法在 `create()` 里早于 `initFactions()` 执行，所以这里必须**独立复算**编制
                 （输入只有 dispatchAdmirals / activeFactionCount / 难度 / simMode），
                 不能读 initFactions 写下的 factions。复算口径与 initFactions 共用 `skirmishEntityPlan()`。 */
            const plan = this.skirmishEntityPlan();
            const enemyCount = Math.max(1, parseInt(String(this.store.activeFactionCount), 10) || 2);
            totalShips = plan.player.reduce((a, b) => a + b, 0) + plan.enemy * enemyCount;
        }

        // 根据总舰数缩放hexRadius
        if (totalShips <= 4) this.hexRadius = this.baseHexRadius;      // 26
        else if (totalShips <= 8) this.hexRadius = 32;
        else if (totalShips <= 12) this.hexRadius = 38;
        else if (totalShips <= 16) this.hexRadius = 44;
        else this.hexRadius = 50;

        console.log(`[BattleScene] 动态扩容: ${totalShips}艘 → hexRadius=${this.hexRadius}`);
    }

    /**
     * 阶段C：计算舰队理想交战距离
     * 根据舰队中舰种组成确定最佳交战距离
     * 战列/巡洋 → 中距对射(140-200)；驱逐/高速 → 近距缠斗(<100)；航母 → 远距释放(>250)
     */
    private getFormationCnName(form: string): string {
        const names: Record<string, string> = { wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵' };
        return names[form] || form;
    }

    /** 获取坐标所在的格子（含地形） */
    private getTerrainAt(x: number, y: number): any {
        const realY = y;
        const q = Math.round((Math.sqrt(3) / 3 * x - 1 / 3 * realY) / this.hexRadius);
        const r = Math.round((2 / 3 * realY) / this.hexRadius);
        return this.tilesDict[`${q},${r}`] || null;
    }

    /**
     * 地形影响（v33 收口）
     *
     * 原实现是三个并列 switch（各自维护 `terrain` 分支）⇒ 新增地形要改三处、易漏，
     * 且旧案地形表的「索敌」「损伤」两列**从未被实现**。
     * 现统一委托 `config/terrainEffects.ts` 的单一真源表（**既有 4 种地形的乘数原样保留**，
     * 只新增索敌列与机雷/杰夫粒子云的损伤列 ⇒ 本项对既有手感的改变仅来自视野）。
     */
    private getTerrainEffect(x: number, y: number) {
        return terrainEffect(this.getTerrainAt(x, y)?.terrain);
    }

    /** 地形 → 移速倍率 */
    private getTerrainSpeedMul(x: number, y: number): number {
        return this.getTerrainEffect(x, y).speedMul;
    }

    /** 地形 → 射程修正（%），小行星带射程-30% */
    private getTerrainRangeMul(x: number, y: number): number {
        return this.getTerrainEffect(x, y).rangeMul;
    }

    /** 地形 → 闪避修正（星云+20%） */
    private getTerrainDodgeMul(x: number, y: number): number {
        return this.getTerrainEffect(x, y).dodgeMul;
    }

    /**
     * 地形 → 视野修正（v33 新增，补旧案地形表的「索敌」列）。
     * 既有插槽：`getVisionRange()` 返回视野半径、`clarity` 已按 `d/visionRange` 分
     * full/partial/fuzzy —— 只是从没被地形影响过。
     */
    private getTerrainVisionMul(x: number, y: number): number {
        return effectiveVisionMul(this.getTerrainEffect(x, y));
    }

    /** [v33 P1-4.1] 地形持续损伤的累计时钟（ms，真实时间） */
    private terrainDotAccumMs = 0;

    /**
     * [v33 P1-4.1] 机雷 / 杰夫粒子云的**持续损伤**（补旧案地形表的「损伤」列）。
     *
     * 实现口径：
     *   · 每 `TERRAIN_RULES.DOT_TICK_MS`(3000ms) 结算一次，对**格内所有单位**扣
     *     `maxHp × dotPct`（机雷 1.5% / 粒子云 0.8% ⇒ 约 30% / 16% 每分钟）。
     *   · 只改 `u.hp`，**不在这里处理死亡**：既有的每帧清理（`globalFleets` 过滤
     *     `u.hp <= 0`）会统一走旗舰沉没叙事 / 战损账单 / 指挥带宽降级那条完整链路，
     *     另写一份死亡处理必然漏项。
     *   · 累加器夹 100ms（与全文件 `Math.min(delta, 100)` 约定同源），防单帧卡顿后连爆。
     */
    private applyTerrainDot(delta: number) {
        if (!TERRAIN_RULES.DOT_ENABLED_DEFAULT) return;
        this.terrainDotAccumMs += Math.min(delta, 100);
        if (this.terrainDotAccumMs < TERRAIN_RULES.DOT_TICK_MS) return;
        this.terrainDotAccumMs = 0;
        for (const fleet of this.globalFleets) {
            const units = fleet?.units;
            if (!units || units.length === 0) continue;
            for (const u of units) {
                const eff = this.getTerrainEffect(u.sprite.x, u.sprite.y);
                if (!(eff.dotPct > 0)) continue;
                const dmg = Math.max(1, Math.floor((u.maxHp || 0) * eff.dotPct));
                u.hp -= dmg;
                this.spawnDamageNumber(u.sprite.x, u.sprite.y, dmg, false);
            }
        }
    }

    /** 渲染地形标记到 hex（nebula/asteroid/gravity/debris） */
    private renderTerrainMarkers() {
        if (!this.tilesList || !this.tilesDict) return;
        // 颜色/图标取自 `config/terrainEffects.TERRAIN_VISUAL`（与 3D 分区层、战场图例同源）。
        // ⚠ 此前这里是**本地第二份** styleMap ⇒ 与 3D 层各写一套颜色，改一处不会同步另一处。
        const styleMap = TERRAIN_VISUAL;
        this.tilesList.forEach((t: any) => {
            if (!t.terrain) return;
            const st = styleMap[t.terrain];
            if (!st) return;
            // 降级路径专用：见上方注释。0.30 是"叠在近黑底上仍读得出"的实测下限。
            const r = this.hexRadius * 0.92;
            // name 是验收用的：L2 探针按 `name === "terrainBlob"` 计数。
            this.add.circle(t.x, t.y, r, st.color, 0.30).setDepth(1).setName('terrainBlob');
            if (t.terrain === 'mine' || t.terrain === 'jeff') {
                this.add.circle(t.x, t.y, r, st.color, 0).setDepth(1)
                    .setStrokeStyle(2, st.color, 0.7).setName('terrainBlobRing');
            }
        });
    }

    /**
     * P2 战役阶段目标检查：
     * 阶段1 破网：己方占领 ≥2 个星球 → 战报
     * 阶段2 斩链：切断敌方补给（敌方连通格子数下降>40%）或占领敌方前沿节点 → 战报
     * 阶段3 拔旗：占领敌方基地（自动触发于胜利判定）
     */
    private checkBattleStage() {
        if (this.store.gameOver || this.store.isPaused) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFac || !pFleet || pFleet.units.length === 0) return;

        const myTeam = pFac.team;
        const myTiles = this.tilesList.filter(t => t.ownerId !== 0 && this.factionMap.get(t.ownerId)?.team === myTeam);
        const enemyTiles = this.tilesList.filter(t => t.ownerId !== 0 && this.factionMap.get(t.ownerId)?.team !== myTeam);
        const myPlanets = myTiles.filter(t => t.type === 'planet' || t.type === 'relay').length;
        const myCastles = myTiles.filter(t => t.type === 'castle').length;
        const enemyConnected = enemyTiles.filter(t => t.connected).length;
        // ===== 斩链判定（P3）：补给链驱动，兼容无格子的指挥制 =====
        // 原判定只看"敌方连通地块数下降"，指挥制没有格子 → 永远不成立。
        // 改为：统计敌方舰队中断补给的比例；断链过半 或 全部运输舰被击沉 = 斩链成功。
        let enemyFleetsInSupply = 0, enemyFleetsTotal = 0;
        let enemyAuxAlive = 0, enemyAuxTotal = 0;
        this.supplyInfo.forEach((info: any, fl: any) => {
            if (!fl.units || fl.units.length === 0) return;
            const tf = this.factionMap.get(fl.factionId);
            const playerTeam = this.factionMap.get(this.store.factions.find((f: any) => f.isPlayer)?.id ?? -1)?.team;
            if (!tf || tf.team === playerTeam) return;   // 只看敌方
            enemyFleetsTotal++;
            if (info.inSupply) enemyFleetsInSupply++;
        });
        this.auxShips.forEach((aux: any) => {
            const tf = this.factionMap.get(aux.fleet?.factionId);
            const playerTeam = this.factionMap.get(this.store.factions.find((f: any) => f.isPlayer)?.id ?? -1)?.team;
            if (!tf || tf.team === playerTeam) return;
            enemyAuxTotal++;
            if (aux.unit && aux.unit.hp > 0) enemyAuxAlive++;
        });
        // 斩链条件：敌方过半舰队断补给，或敌方运输舰全灭（且曾经有过）
        const enemyCutRatio = enemyFleetsTotal > 0 ? (1 - enemyFleetsInSupply / enemyFleetsTotal) : 0;
        const supplyChainCut = enemyCutRatio >= 0.5 || (enemyAuxTotal > 0 && enemyAuxAlive === 0);
        const enemyCastles = enemyTiles.filter(t => t.type === 'castle').length;

        const reportStage = (stage: number, title: string, desc: string) => {
            if (this.battleStage !== stage || this.stageReported) return;
            this.stageReported = true;
            this.store.triggerToast?.(`[阶段${stage}] ${title}：${desc}`);
        };

        if (this.battleStage === 1 && (myPlanets >= 2 || myCastles >= 2)) {
            this.battleStage = 2; this.stageReported = false;
            reportStage(2, '斩链', '我方已建立前沿跳板，接下来切断敌方补给线！');
        } else if (this.battleStage === 2 && (supplyChainCut || enemyConnected <= 8 || enemyCastles === 0)) {
            this.battleStage = 3; this.stageReported = false;
            reportStage(3, '拔旗', '敌方补给断裂，向敌方基地发起总攻！');
        }
    }

    /**
     * P5 战役剧本阶段推进：probe试探 → clash缠斗 → turn转折 → final决战
     * 基于双方战损比例与接触强度推进，配合名场面营造情绪曲线
     */
    private updateScriptPhase() {
        if (this.store.gameOver || this.store.isPaused || this.deployPhase) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFac || !pFleet || pFleet.units.length === 0) return;

        // 统计双方总HP
        let allyHp = 0, allyMax = 0, enemyHp = 0, enemyMax = 0;
        this.globalFleets.forEach((fl: any) => {
            const fac = this.factionMap.get(fl.factionId);
            if (!fac) return;
            fl.units.forEach((u: any) => {
                if (fac.team === pFac.team) { allyHp += u.hp; allyMax += u.maxHp; }
                else { enemyHp += u.hp; enemyMax += u.maxHp; }
            });
        });
        const allyPct = allyMax > 0 ? allyHp / allyMax : 0;
        const enemyPct = enemyMax > 0 ? enemyHp / enemyMax : 0;
        const engaged = this.globalFleets.some((fl: any) => fl.state === 'engaging');

        // 阶段推进条件
        if (this.scriptPhase === 'probe' && (engaged || allyPct < 0.9 || enemyPct < 0.9)) {
            this.scriptPhase = 'clash'; this.scriptReported = false;
            this.store.triggerToast?.('主力接触——全面会战开始！');
            this.showBattleBanner('全面会战', '主力舰队接触', '#f59e0b');
            this.cameras.main.shake(400, 0.004);
        } else if (this.scriptPhase === 'clash' && (allyPct < 0.55 || enemyPct < 0.55)) {
            this.scriptPhase = 'turn'; this.scriptReported = false;
            this.store.triggerToast?.('战局进入转折点——胜负在此一举！');
            this.showBattleBanner('战局转折', '胜负在此一举', '#ef4444');
        } else if (this.scriptPhase === 'turn' && (allyPct < 0.3 || enemyPct < 0.3)) {
            this.scriptPhase = 'final'; this.scriptReported = false;
            this.store.triggerToast?.('决战时刻——全军突击！');
            this.showBattleBanner('决战时刻', '全军突击！', '#fbbf24');
            // 决战buff：双方伤害+20%
            this.globalFleets.forEach((fl: any) => { fl._finalBattle = true; });
        }
    }

    /**
     * P4 战术增援：每90秒双方各获得一次增援呼叫
     * 增援兵力 = 当前损失比例×50%（最多补到满编的60%）
     */
    private updateReinforcement() {
        if (this.store.gameOver || this.store.isPaused || this.deployPhase) return;
        const hasPlayer = this.store.factions.some((f: any) => f.type === 'player' && f.active);
        if (!hasPlayer) return; // 只在玩家参与的战术战启用

        this.reinforceTimer += 16;
        if (this.reinforceTimer < this.reinforceInterval) return;
        this.reinforceTimer = 0;
        this.reinforceUsed.clear();

        this.store.factions.filter((f: any) => f.active).forEach((fac: any) => {
            const fleets = this.globalFleets.filter((fl: any) => fl.factionId === fac.id);
            if (fleets.length === 0) return;
            fleets.forEach((fl: any) => {
                let hp = 0, max = 0;
                fl.units.forEach((u: any) => { hp += u.hp; max += u.maxHp; });
                const pct = max > 0 ? hp / max : 0;
                if (pct < 0.85) {
                    // 修复受损单位（模拟增援整编）
                    fl.units.forEach((u: any) => {
                        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
                    });
                }
            });
        });
        this.store.triggerToast?.('增援舰队抵达战场——各舰整编补给！');
        this.showBattleBanner('增援抵达', '各舰队完成整编补给', '#06b6d4');
    }

    private getIdealEngageDist(fleet: any): number {
        // [v55] 委托 aiDirector.idealEngageDistFrom（数据驱动）。旧实现手抄舰种名
        //   （'航母'/'carrier'）而 config 真键是 '空母' ⇒ 计数恒 0、全落默认 720；
        //   纯 '舰载' 舰队 720 > 其射程 640 = "站得比打得远"永不接战。
        //   现按 u.range/u.atk 聚合（排除补给舰），真源 = config/gameData.ts，零手抄舰种名。
        const ships = (fleet.units || [])
            .filter((u: any) => (u.classType || '') !== '补给')
            .map((u: any) => ({ range: u.range || 0, atk: u.atk || 0 }));
        return idealEngageDistFrom(ships);
    }

    /**
     * 阶段B：计算舰队视野范围
     * 视野 = 基础(200×缩放) + 情报值×2 + 电子科技×30
     * search姿态额外+50（索敌模式视野更广）
     */
    private getVisionRange(fleet: any, myFac: any): number {
        const scaleFactor = this.hexRadius / this.baseHexRadius; // 地图缩放比
        const baseVision = 200 * scaleFactor;
        const intel = myFac.admiralStats?.intelligence || 50;
        const ecmLevel = myFac.admiralStats?.electronicLevel || 0;
        let vision = baseVision + intel * 2 + ecmLevel * 30;
        if (fleet.stance === 'search') vision += 50;
        // [v33] 地形「索敌」列（旧案地形表唯一从未被实现的一列）。
        //   ⚠ 已按 TERRAIN_RULES.VISION_STRENGTH 削弱：本返回值是**索敌硬门**
        //     （d < visionRange 才进 visibleEnemies，closestEnemyFleet 又只取非 fuzzy 者），
        //     原始等级乘数（最大 −45%）会把视野压到 266px ⇒ 舰队永久丢目标、AI 空转。
        //     现最坏 −20%，保住体感且不越悬崖（详见 balance.TERRAIN_RULES 注释）。
        vision *= this.getTerrainVisionMul(fleet.x, fleet.y);
        return vision;
    }

    /**
     * [v33 P1-4.4] 舰队提督特技 → 战术修正（**按舰队对象缓存**，每帧只算一次）。
     *
     * 为什么需要缓存：`computeCombatModifiers` 要遍历特技 × 效果两层，而伤害是**逐舰逐发**
     * 结算的（单帧可达数百次）⇒ 直接内联调用会把热路径拖垮。
     * 特技在战场内不会变，故缓存到舰队对象上安全（`_skillMods` 由本方法唯一写入）。
     *
     * ⚠ 战场侧此前完全拿不到提督特技（skills 只在战略层 gameStore 用），
     *   故 `initFactions` 新增把 `admiralSkills` 带进 faction 配置（玩家/敌方对称）。
     */
    private skillModsOf(fleet: any): ReturnType<typeof computeCombatModifiers> {
        if (!(fleet as any)._skillMods) {
            const sk = this.factionMap.get(fleet.factionId)?.admiralSkills;
            (fleet as any)._skillMods = computeCombatModifiers(sk || []);
        }
        return (fleet as any)._skillMods;
    }

    /**
     * [v33 P1-4.2] 舰队拦截率（**带 250ms TTL 缓存**）。
     *
     * 为什么必须缓存：`fleetInterceptRate` 要遍历该舰队**全部存活单位**求防空加权均值，
     * 而伤害是逐舰逐发结算的 ⇒ 不缓存就是 **O(N²)/帧**（N 可达 120）。
     * 拦截率只在单位被击毁时变化，250ms 的陈旧度在观感上不可察（且不影响任何确定性口径）。
     * 与 `skillModsOf` 同属"热路径只读一次"的既有约定（参见 v12.2 syncShips 优化）。
     */
    private interceptRateOf(fleet: any): number {
        const now = this.time.now;
        if ((fleet as any)._interceptAt === undefined || now - (fleet as any)._interceptAt > 250) {
            (fleet as any)._interceptRate = fleetInterceptRate(
                fleet.units || [], this.skillModsOf(fleet).intercept);
            (fleet as any)._interceptAt = now;
        }
        return (fleet as any)._interceptRate ?? 0;
    }

    // ── 指挥点系统方法 ──

    /** 打开命令面板（暂停游戏） */
    private openCommandPanel() {
        if (this.deployPhase) return;   // [#74 · H1] 部署期不开放指挥点面板（否则叠在中央部署菜单之上）
        if (!this.cpState) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFleet || !pFac) return;

        commandBridge.cpState = this.cpState;
        commandBridge.fleetAdmiralId = pFac.id;
        commandBridge.battleAdmiralIds = this.store.factions
            .filter((f: any) => f.active)
            .map((f: any) => f.id);
        commandBridge.selectedAbilityId = null;
        commandBridge.staffBriefing = this.buildStaffBriefing(pFleet, pFac);
        // [2a] 面板打开时算一次"是否有可见敌方舰队"（复用 computeValidTargets 合法目标口径）
        //   → 4 个 requiresTarget 命令卡片据此置灰并标注原因（07 §6）。500ms 动态重算归 2a-2。
        commandBridge.hasVisibleTargets = this.computeValidTargets(pFleet, pFac).length > 0;
        commandBridge.visible = true;
        commandBridge.pendingCallback = (targetId: number | null) => {
            if (commandBridge.selectedAbilityId) {
                this.executeCommandFromPanel(commandBridge.selectedAbilityId, targetId);
            }
            commandBridge.visible = false;
            commandBridge.pendingCallback = null;
        };
        this.store.isPaused = true;
    }

    /** 参谋敌情摘要：可见敌舰队数、最近敌距离、我方阵型克制判断（走 formations.formationCounterMul 单一真源） */
    private buildStaffBriefing(pFleet: any, pFac: any): string {
        // 敌情收集：只统计迷雾可见的敌方舰队（复用渲染迷雾同款口径：友军建筑300px / 舰队250·450px）
        let visibleEnemyCount = 0;
        let nearestDist = Infinity;
        let nearestEnemy: any = null;
        const allyFactionIds = this.store.factions.filter((f: any) => f.team === pFac.team).map((f: any) => f.id);
        const allyFleets = this.globalFleets.filter(fl => allyFactionIds.includes(fl.factionId));
        const allyVisionNodes = this.tilesList.filter(t => allyFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'tower' || t.type === 'planet' || t.type === 'relay'));
        this.globalFleets.forEach(ef => {
            if (ef.units.length === 0) return;
            const efFac = this.factionMap.get(ef.factionId);
            if (!efFac || efFac.team === pFac.team || !efFac.active) return;
            const fx = ef.units[0].sprite?.x ?? ef.x;
            const fy = ef.units[0].sprite?.y ?? ef.y;
            let inVision = allyVisionNodes.some(node => Phaser.Math.Distance.Between(fx, fy, node.x, node.y) < 300);
            if (!inVision) {
                inVision = allyFleets.some(pFl => {
                    if (pFl.units.length === 0) return false;
                    const vr = pFl.stance === 'search' ? 450 : 250;
                    return Phaser.Math.Distance.Between(fx, fy, pFl.units[0].sprite.x, pFl.units[0].sprite.y) < vr;
                });
            }
            if (!inVision) return;
            visibleEnemyCount++;
            const d = Phaser.Math.Distance.Between(pFleet.x, pFleet.y, ef.x, ef.y);
            if (d < nearestDist) { nearestDist = d; nearestEnemy = ef; }
        });

        if (visibleEnemyCount === 0) return '参谋：当前视野内无敌舰队。';
        const formCn: Record<string, string> = { wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵' };
        // [v33 P0-1] 阵型克制判断改为 formations.formationCounterMul（单一真源）。
        //   原实现是本文件内的**第二张** beats 表，且与 config/formations.ts 的环**关系相反**：
        //     本文件（旧）：楔→纺→圆→方→横→楔
        //     formations.ts：楔→横→纺→圆→方→楔
        //   ⇒ "楔 vs 横" 战略层判楔克横、战术层判互不克制；"楔 vs 纺" 只在战术层成立。
        //   现统一为 formations.ts 口径（战略层早已引用它），战术层的
        //   wedge↔spindle / line↔wedge 两组关系随之翻转（行为变更，见 docs/qa/v33_*）。
        let formAdvice = '';
        if (nearestEnemy) {
            const eForm = nearestEnemy.formation;
            const mul = formationCounterMul(pFleet.formation, eForm);
            if (mul > 1.0) {
                formAdvice = `我方${formCn[pFleet.formation] || pFleet.formation}克制其${formCn[eForm] || eForm}，保持阵型！`;
            } else if (mul < 1.0) {
                formAdvice = `警告：敌${formCn[eForm] || eForm}克制我方${formCn[pFleet.formation] || pFleet.formation}，建议变阵！`;
            } else {
                formAdvice = `敌${formCn[eForm] || eForm}与我方${formCn[pFleet.formation] || pFleet.formation}互不克制。`;
            }
        }
        return `参谋：敌 ${visibleEnemyCount} 队接近，最近 ${Math.round(nearestDist)}px。${formAdvice}`;
    }

    // ── [2a] 目标选择链路（命令面板 → BattleScene）──────────────────────────────

    /**
     * [2a] 合法目标集（公用口径）。三层过滤，全部复用既有真源，不新增规则：
     *   · 可见性 = buildStaffBriefing 同款：友军建筑 300px / 友军舰队 250·450px（宽口径"能在战场上看到"）
     *   · L1 阵营为敌 + L2 存活（units>0 且 faction.active）
     *   · L4 清晰度收紧：dist ≤ getVisionRange(旗舰)×0.8（07 §2.1，与迷雾 clarity!=='fuzzy' 同口径）
     * 返回按「距旗舰升序，同距按 fleetId 升序」排序（07 §4.1 快照排序键，确定性）。
     */
    private computeValidTargets(casterFleet: any, pFac: any): { fleet: any; dist: number }[] {
        const out: { fleet: any; dist: number }[] = [];
        if (!casterFleet || !pFac) return out;
        const allyFactionIds = this.store.factions.filter((f: any) => f.team === pFac.team).map((f: any) => f.id);
        const allyFleets = this.globalFleets.filter(fl => allyFactionIds.includes(fl.factionId));
        const allyVisionNodes = this.tilesList.filter(t => allyFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'tower' || t.type === 'planet' || t.type === 'relay'));
        const casterVision = this.getVisionRange(casterFleet, pFac);
        for (const ef of this.globalFleets) {
            if (ef.units.length === 0) continue;                         // L2 存活
            const efFac = this.factionMap.get(ef.factionId);
            if (!efFac || efFac.team === pFac.team || !efFac.active) continue; // L1 敌方 + L2 阵营存活
            const fx = ef.units[0].sprite?.x ?? ef.x;
            const fy = ef.units[0].sprite?.y ?? ef.y;
            let inVision = allyVisionNodes.some(n => Phaser.Math.Distance.Between(fx, fy, n.x, n.y) < 300);
            if (!inVision) {
                inVision = allyFleets.some(pFl => {
                    if (pFl.units.length === 0) return false;
                    const vr = pFl.stance === 'search' ? 450 : 250;
                    return Phaser.Math.Distance.Between(fx, fy, pFl.units[0].sprite.x, pFl.units[0].sprite.y) < vr;
                });
            }
            if (!inVision) continue;                                     // L3 在视野内
            const d = Phaser.Math.Distance.Between(casterFleet.x, casterFleet.y, ef.x, ef.y);
            if (d > casterVision * 0.8) continue;                        // L4 清晰度（非 fuzzy）
            out.push({ fleet: ef, dist: d });
        }
        out.sort((a, b) => (a.dist - b.dist) || (a.fleet.id - b.fleet.id));
        return out;
    }

    /** [2a] 给定舰队 id 为何不是合法目标 —— 返回拒绝原因文本（07 §2.1 反馈）。 */
    private explainInvalidTarget(fleetId: number, pFleet: any, pFac: any): string {
        const ef = this.globalFleets.find((f: any) => f.id === fleetId);
        if (!ef || ef.units.length === 0) return '该舰队已溃散';
        const efFac = this.factionMap.get(ef.factionId);
        if (!efFac) return '目标已消失，命令未执行';
        if (efFac.team === pFac.team) return '目标必须为敌方舰队';
        if (!efFac.active) return '该舰队已溃散';
        const d = Phaser.Math.Distance.Between(pFleet.x, pFleet.y, ef.x, ef.y);
        const vr = this.getVisionRange(pFleet, pFac);
        if (d >= vr) return '目标不在我方视野内';
        if (d > vr * 0.8) return '情报不足：该目标仅模糊侦测';
        return '该目标当前不可选';
    }

    /**
     * [2a] 进入选目标态（Vue 通过 App.handleCommandSelectTarget → 本方法）。
     * 面板保持打开、暂停不解除；不扣 CP（07 §5.3，CP 只在 executeCommand 内扣）。
     */
    public enterTargetSelect(abilityId: string): void {
        const ability = getAbilityById(abilityId);
        if (!ability || !ability.requiresTarget) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFleet || !pFac) return;
        this.cpCommandMode = true;
        this.pendingAbilityId = abilityId;
        const cands = this.computeValidTargets(pFleet, pFac);
        this.targetCandidates = new Set(cands.map(c => c.fleet.id));
        this.store.triggerToast?.(`选择目标：${ability.name}｜Esc 取消`);
    }

    /**
     * [2a] 对舰队下达当前待选命令（3D overlay 拾取 / 2D 拾取 → 本方法）。
     * 非法 → toast 原因 + **保持选目标态**（07 §5.2 不取消）；合法 → 执行并退出选目标态。
     */
    public tryExecuteOnFleet(fleetId: number): boolean {
        if (!this.cpCommandMode || !this.pendingAbilityId) return false;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFleet || !pFac) return false;
        const hit = this.computeValidTargets(pFleet, pFac).some(c => c.fleet.id === fleetId);
        if (!hit) {
            this.store.triggerToast?.(this.explainInvalidTarget(fleetId, pFleet, pFac));
            return false;   // 保持选目标态
        }
        const abilityId = this.pendingAbilityId;
        this.exitTargetSelect('done');
        // 执行：CP 在执行成功的这一刻才扣（07 §5.3）；executeCommandFromPanel 末尾恢复实时
        this.executeCommandFromPanel(abilityId, fleetId);
        // 执行成功 → 关闭面板并清桥
        commandBridge.visible = false;
        commandBridge.selectedAbilityId = null;
        commandBridge.pendingCallback = null;
        return true;
    }

    /**
     * [2a] 退出选目标态：清状态 + 关候选高亮（overlay 每帧读 cpCommandMode/targetCandidates，清零即恢复原值）。
     * **不在此处动 isPaused** —— 面板仍开（退选回列表）时须保持暂停，仅关闭路径才恢复实时。
     */
    public exitTargetSelect(_reason?: string): void {
        this.cpCommandMode = false;
        this.pendingAbilityId = null;
        this.targetCandidates = null;
    }

    /**
     * [2a] 关闭命令面板（✕ / 列表态 Esc / Space / 取消）：退选目标态 + 清桥 + 恢复实时。
     * 丢弃 pendingCallback（不调用）⇒ 取消路径必然零执行、零扣费。
     */
    public closeCommandPanel(): void {
        this.exitTargetSelect('close');
        commandBridge.visible = false;
        commandBridge.selectedAbilityId = null;
        commandBridge.pendingCallback = null;
        if (!this.deployPhase) this.store.isPaused = false;
    }

    /** [2a] 2D 拾取（hex/crt）：世界坐标最近邻到候选舰队的任一舰 sprite。阈值 40px。 */
    private pickFleetAtWorld(x: number, y: number): number | null {
        const cands = this.targetCandidates;
        let bestFid: number | null = null;
        let bestD2 = Infinity;
        for (const fl of this.globalFleets) {
            if (cands && !cands.has(fl.id)) continue;
            for (const u of (fl.units as any[])) {
                const sp = u.sprite;
                if (!sp) continue;
                const d2 = (sp.x - x) * (sp.x - x) + (sp.y - y) * (sp.y - y);
                if (d2 < bestD2) { bestD2 = d2; bestFid = fl.id; }
            }
        }
        const TH = 40;
        if (bestFid === null || bestD2 > TH * TH) return null;
        return bestFid;
    }

    /** [R10-B2] 应用"选中舰队"拾取结果（2D 由 handleTileClick 调用；3D 由 overlay 屏幕空间拾取调用）。
     *  [V18-B · C3] 仅玩家(type='player')可选 —— 敌军不可选（设计 02 §1.3「选择舰队」仅对己方语义，
     *  敌军目标由 [2a] 选目标态负责）。原 `|| type==='ally'` 恒假分支已移除（#63-a：Faction.type 无 'ally'）。
     *  @returns true = 已选中某支舰队（调用方应吞掉本次点击）；false = 未选中（已清选中，调用方继续原逻辑）。 */
    public applyFleetSelectByPick(fleetId: number | null): boolean {
        const fl = fleetId !== null ? this.globalFleets.find((f: any) => f.id === fleetId) : null;
        const flFac = fl ? this.factionMap.get(fl.factionId) : null;
        if (fl && flFac && flFac.type === 'player') {   // [V18-B · C3] 移除恒假 `|| flFac.type === 'ally'`（#63-a，行为不变）
            this.battleSelectedFleetId = fl.id;
            this.store.triggerToast?.(`◎ 已选中：${flFac.name || '舰队'} — 右键点地令其前往 · 浮标「分兵」或按 X 拆分`);
            return true;
        }
        // 点空域 / 敌军 / 选中项已失效 → 清选中（幂等；已无选中时不重复 toast）
        if (this.battleSelectedFleetId !== null) {
            this.battleSelectedFleetId = null;
            this.store.triggerToast?.('◎ 已取消选中');
        }
        return false;
    }

    /** 执行命令 */
    private executeCommandFromPanel(abilityId: string, targetFleetId: number | null) {
        // [2a-2] BUG-1 修复：执行即退选目标态。此前本方法只清 bridge，不清
        //   cpCommandMode/pendingAbilityId/targetCandidates ⇒ 选目标态切非目标卡执行后残留 ⇒
        //   战场点击被 2D/3D 拾取当作合法目标 ⇒ 无面板、无用户意图的"幽灵执行"二次扣 CP。
        //   exitTargetSelect 幂等（tryExecuteOnFleet 已先调 'done'，此处再调无副作用）；
        //   本方法不依赖上述三字段（abilityId 由参数传入），故可安全前置。
        this.exitTargetSelect('execute-other');
        if (!this.cpState) return;
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        const pFleet = this.globalFleets.find((f: any) => f.factionId === pFac?.id);
        if (!pFleet) return;

        const result = executeCommand(this.cpState, abilityId, pFleet.id, targetFleetId, pFleet.factionId);
        if (result) {
            // 可视化反馈
            this.showCommandEffect(result);
        }
        // [2a] 契约⑦：执行后 selectedAbilityId 一律归 null（成功或失败都清，防残留复用）
        commandBridge.selectedAbilityId = null;
        if (!this.deployPhase) this.store.isPaused = false;
    }

    /** 命令效果可视化 */
    private showCommandEffect(effect: ActiveEffect) {
        const pFleet = this.globalFleets.find((f: any) => f.id === effect.casterFleetId);
        if (!pFleet) return;
        // ── 瞬时效果：紧急抢修的旗舰 HP 回复（effect.value 即 shield 0.5 前的 heal 定义）──
        if (effect.commandId === 'emergency_repair') {
            const flagship = pFleet.units[0];
            if (flagship) {
                const heal = flagship.maxHp * 0.2;
                flagship.hp = Math.min(flagship.maxHp, flagship.hp + heal);
                this.spawnDamageNumber(flagship.sprite.x, flagship.sprite.y - 18, heal, false);
                // 绿色维修光环
                const ring = this.add.circle(flagship.sprite.x, flagship.sprite.y, 22, 0x10b981, 0.4).setDepth(50);
                this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
            }
        }
        const col = effect.effect.type === 'shield' || effect.effect.type === 'reflect' ? 0x10b981 :
                    effect.effect.type === 'damage_boost' ? 0xef4444 :
                    effect.effect.type === 'debuff' ? 0xa855f7 : 0x06b6d4;
        const flash = this.add.circle(pFleet.x, pFleet.y, 40, col, 0.4).setDepth(50);
        this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 600, onComplete: () => flash.destroy() });
        // 录战斗日志
        const efName = this.factionMap.get(pFleet.factionId)?.name || '舰队';
        const cmdName = effect.commandId.replace(/_/g, ' ');
        if ((this.store as any).addBattleLog) {
            (this.store as any).addBattleLog({ text: `${efName} 执行了「${cmdName}」`, type: 'ability' });
        }
    }

    /** 每帧应用命令效果 */
    private applyCommandEffects(dtMs: number) {
        if (!this.cpState) return;
        updateCPState(this.cpState, dtMs);
        // CP恢复指示（接近满时更新桥接状态）
        if (commandBridge.visible && commandBridge.cpState) {
            commandBridge.cpState = this.cpState;
        }
    }

    // ==================== 指挥带宽系统（指挥链延迟机制） ====================

    /** 玩家通信中枢：玩家主舰队（第一支玩家舰队）的旗舰坐标 */
    private getCommCenter(): { x: number, y: number, fleet: any } | null {
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        if (!pFac) return null;
        const mainFleet = this.globalFleets.find(fl => fl.factionId === pFac.id);
        if (!mainFleet) return null;
        return { x: mainFleet.x, y: mainFleet.y, fleet: mainFleet };
    }

    /**
     * 每帧推进指挥带宽系统：
     * 1. 直连半径随地图缩放动态刷新（旗舰损毁时收缩60%）
     * 2. direct 区舰队自动建立频道；被歼灭舰队释放频道
     * 3. 处理送达的中继订单（信标/变阵延迟执行）
     * 4. 更新各玩家舰队的链路指示标记
     */
    private applyBandwidthEffects(dtMs: number) {
        if (!this.bwState) return;
        const bw = this.bwState;
        const comm = this.getCommCenter();

        // 1. 直连半径动态刷新（地图缩放 / 旗舰降级）
        bw.relayRange = this.hexRadius * 26 * (bw.flagshipDown ? 0.6 : 1);

        // 2. 链路维护 + 指示标记
        this.globalFleets.forEach(fleet => {
            const pFac = this.store.factions.find((f: any) => f.type === 'player');
            if (!pFac || fleet.factionId !== pFac.id) return;

            // 舰队被歼灭：释放频道与标记
            if (!hasCombatUnits(fleet)) {
                releaseChannel(bw, fleet.id);
                const marker = this.commMarkers.get(fleet.id);
                if (marker) { marker.destroy(); this.commMarkers.delete(fleet.id); }
                return;
            }

            const dist = comm ? Phaser.Math.Distance.Between(fleet.x, fleet.y, comm.x, comm.y) : 0;
            const status: LinkStatus = getLinkStatus(bw, dist);
            fleet._linkStatus = status;
            fleet._linkDist = dist;

            // direct 区自动锁定频道（容量不足则排队语义：先到先得）
            if (status === 'direct') establishChannel(bw, fleet.id);

            // 指示标记：跟随舰队上方的链路状态角标
            let marker = this.commMarkers.get(fleet.id);
            if (!marker) {
                marker = this.add.text(fleet.x, fleet.y - 34, '', {
                    fontSize: '10px', fontFamily: 'monospace', fontStyle: 'bold',
                    stroke: '#000000', strokeThickness: 2,
                }).setOrigin(0.5).setDepth(30);
                this.commMarkers.set(fleet.id, marker);
            }
            const color = `#${LINK_COLORS[status].toString(16).padStart(6, '0')}`;
            const pending = bw.delayedOrders.filter(o => o.fleetId === fleet.id).length;
            const hasCh = hasChannel(bw, fleet.id);
            const chMark = hasCh ? ' ◉' : '';
            const pendMark = pending > 0 ? ` ⇢${pending}` : '';
            const degraded = bw.flagshipDown ? '⌁' : '';
            marker.setText(`${LINK_CN[status]}${chMark}${pendMark}${degraded}`);
            marker.setColor(color);
            marker.setPosition(fleet.x, fleet.y - 34);
            marker.setVisible(status !== 'direct' || pending > 0 || !hasCh || bw.flagshipDown);
        });

        // 孤儿标记清理（舰队列表里已不存在的）
        const pFac2 = this.store.factions.find((f: any) => f.type === 'player');
        const playerFleetIds = new Set(this.globalFleets.filter(fl => pFac2 && fl.factionId === pFac2.id).map(fl => fl.id));
        this.commMarkers.forEach((marker, fid) => {
            if (!playerFleetIds.has(fid)) { marker.destroy(); this.commMarkers.delete(fid); }
        });

        // 3. 中继订单送达执行
        const arrived = updateBandwidthState(bw, dtMs);
        arrived.forEach(order => this.executeRelayedOrder(order));

        // 4. 同步桥接（面板显示）
        if (commandBridge.visible) {
            commandBridge.bwState = bw;
        }
    }

    /** 执行送达的中继订单（延迟信标 / 延迟变阵） */
    private executeRelayedOrder(order: PendingOrder) {
        const fleet = this.globalFleets.find(fl => fl.id === order.fleetId);
        if (!fleet || fleet.units.length === 0) return; // 收件人已失联，订单作废
        const fac = this.factionMap.get(fleet.factionId);
        if (!fac || fac.team !== 1) return;

        if (order.kind === 'flare') {
            // 抵达信标：仅当无交战时接收（交战中的舰队不会被中继命令强行拉走，保持战斗连贯）
            if (fleet.state === 'engaging') return;
            fleet.targetFlare = order.payload;
            fleet.stance = 'search';
            this.store.triggerToast(`⇢ 中继命令送达：[${fac.name || '舰队'}] 收到信标坐标，转向突进。`);
            // 中继波纹特效：数据包到达
            const ring = this.add.circle(fleet.x, fleet.y, 18, 0x00ccff, 0.35).setDepth(28);
            this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
        } else if (order.kind === 'stance') {
            this.applyStanceToFleet(fleet, order.payload);
            this.store.triggerToast(`⇢ 中继命令送达：[${fac.name || '舰队'}] 变阵「${order.payload}」生效。`);
        }
    }

    /** [v31-A] 舰队所属提督的作战教范（按 `faction.admiralTags` 解析，结果缓存在 faction 上）。
     *  **仅在提督确实带标签时返回教范**；无标签 ⇒ 返回 null，调用方回退旧行为（零回归）。 */
    private fleetDoctrine(fleet: any): AdmiralDoctrine | null {
        const fac: any = this.factionMap.get(fleet.factionId);
        if (!fac) return null;
        if (!fac._doctrine) fac._doctrine = resolveAdmiralDoctrine(fac.admiralTags);
        return (fac.admiralTags && fac.admiralTags.length > 0) ? fac._doctrine : null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // [v31-C] 分舰队（TaskForce）—— 让"迂回 / 包抄 / 诱饵 / 后勤战"在结构上可表达
    //
    // 结构性缺口：`globalFleets` 里一支舰队原本是**不可分的原子** ⇒ 所有"多路协同"战法
    //   在结构上无法表达（这正是 `fleetSplitManeuver.ts` 声明"不接任何玩法触发"的原因）。
    // 本段补上"力量可分解"，战法表（`taskForce.ts` 的 `MANEUVERS`）即可落地。
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * 把一支舰队按战法规格**拆成多个分舰队**（子编队 = 独立 `fleet` 对象，共享同一提督）。
     *
     * 规则：
     *   · 第 0 路（通常是 `main`）**留在母队**（不新建对象）—— 旗舰与指挥链不动；
     *   · 其余各路各建一个子编队（新 `id` / 新 `displayId` / 继承 `commanderId`）；
     *   · 实体按 `splitUnitCounts` 切分；**运输舰留在母队**（走既有补给链，不参与拆分）；
     *   · 子编队的 `formationSlot` **必须重编号**（否则阵位枚举错位 ⇒ 单位瞬移）；
     *   · 初始位置 = 母队位置 + `lateral × DETACH_SPACING`，随后由战法航路牵引。
     *
     *   · **划出去的单位会从 `parent.units` 移除**（`parent.formationCount0` 随之重算）——
     *     同一 unit 不得同时属于两支舰队（否则位置被拉扯、层号被覆盖、托盘与部队脱节）。
     * @returns 新建的子编队（不含母队）；兵力不足或规格不足 2 路时返回空数组。
     */
    private splitFleet(parent: any, specs: DetachmentSpec[]): any[] {
        if (!parent || !parent.units || !specs || specs.length < 2) return [];
        const isSup = (u: any) => u.classType === '补给' || u.classType === 'supply';
        const combat = parent.units.filter((u: any) => !isSup(u));
        if (combat.length < specs.length) return [];   // 兵力不足以拆分

        const counts = splitUnitCounts(combat.length, specs);
        const created: any[] = [];
        // [v34d] **已划出的单位登记** —— `parent.units` 必须把分给子编队的单位**移除**。
        //   不移除的后果（L2 实测）：
        //   ① 同一 unit 被两支舰队同时引用（实测 **158 个共享 sprite**）⇒ 母/子两队每帧
        //      各给该 sprite 算一次目标位 ⇒ 位置被来回拉扯；
        //   ② 末尾的母队重编号循环遍历**全量 units**，会把子队的 `formationSlot` 覆盖成母队
        //      口径（实测子队 slot = 119..197，而其 `formationCount0 = 79`）⇒
        //      `formOffsets[slotIdx] || ringCell(slotIdx)` 全部落到兜底环位（形状与托盘无关）、
        //      `layK[slot] ?? 0` 全部取 0 ⇒ **整队塌成一层**（用户实报"第二次分兵只有一层"）。
        //   ⇒ 托盘（按 `offs` 算足迹中心）与部队（被 `ringCell` 摆到环上）各走各的（同一批实测：
        //      分舰队托盘 vs 舰船质心偏移 119.5px，而母队仅 1.8px）。
        const moved = new Set<any>();
        let cursor = 0;
        specs.forEach((spec, i) => {
            const take = counts[i] || 0;
            const slice = combat.slice(cursor, cursor + take);
            cursor += take;
            if (i === 0 || slice.length === 0) return;  // 第 0 路（main）留在母队
            for (const u of slice) moved.add(u);        // 划出登记（裁剪在 forEach 之后统一做）

            const child: any = {
                ...parent,
                id: Math.random(),                       // 与既有 fleetId 同口径（见 :1274）
                displayId: this.globalFleets.length + 1,
                units: slice,
                x: parent.x + spec.lateral * DETACH_SPACING,
                y: parent.y,
                vx: 0, vy: 0,
                // 独立战术单位 ⇒ 清掉母队的任务 / 信标 / 重组标记，避免共用可变状态
                mission: null, targetFlare: null, _regrouping: false,
                _detachedFrom: parent.id,
                _maneuverRole: spec.role,
                _maneuverLateral: spec.lateral,
                _maneuverIntent: spec.intent,
                _maneuverTargetKind: spec.targetKind,
            };
            let fs = 0;
            for (const u of slice) { u.formationSlot = fs++; u.gridX = 0; u.gridY = 0; }
            child.formationCount0 = fs;
            this.globalFleets.push(child);
            created.push(child);
        });

        // ⚠ **必须先裁剪、再重编号**（顺序不可交换）：若先重编号，子队的 `formationSlot`
        //    会被母队口径覆盖 —— 这正是本缺陷的成因，见上方 `moved` 的注释。
        if (moved.size > 0) parent.units = parent.units.filter((u: any) => !moved.has(u));
        // 母队（第 0 路）重建阵位编号
        let fs0 = 0;
        for (const u of parent.units) { if (isSup(u)) continue; u.formationSlot = fs0++; u.gridX = 0; u.gridY = 0; }
        parent.formationCount0 = fs0;
        return created;
    }

    /**
     * [v32] **后勤猎杀目标**：为 `targetKind === 'enemy_supply'` 的分队找最近的敌方补给节点。
     * 优先级：① 敌方运输舰（机动的补给链——打掉 = 断前线补给）>
     *        ② 敌方已占补给点（中继 / 星球 / 司令部）。
     * 都找不到 → `null`（调用方落回常规接战）。
     *
     * 这是"后勤战"从**数据**变成**行为**的落点：`_maneuverTargetKind` 在此之前**全项目零消费**，
     * 所以"猎杀运输舰"只存在于头顶标签文本里，AI 实际还是去打最近的敌军舰队。
     */
    private findEnemySupplyTarget(fleet: any, myFac: any): { x: number; y: number } | null {
        const myTeam = myFac?.team;
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;

        // ① 敌方运输舰（正在往返补给的补给链）
        for (const a of this.auxShips) {
            if (!a.unit || a.unit.hp <= 0) continue;
            const af = this.factionMap.get(a.fleet?.factionId);
            if (!af || af.team === myTeam) continue;
            const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, a.x, a.y);
            if (d < bestD) { bestD = d; best = { x: a.x, y: a.y }; }
        }
        if (best) return best;

        // ② 敌方已占的补给点
        for (const t of this.tilesList) {
            if (!t.ownerId || t.ownerId === myFac?.id) continue;
            if (t.type !== 'relay' && t.type !== 'planet' && t.type !== 'castle') continue;
            const tf = this.factionMap.get(t.ownerId);
            if (!tf || tf.team === myTeam) continue;
            const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
            if (d < bestD) { bestD = d; best = { x: t.x, y: t.y }; }
        }
        return best;
    }

    /**
     * 为一个阵营按战法**编成并执行**：
     *   ① 舰队数 ≥ 战法路数 ⇒ **直接分工**（不拆分，最省）；
     *   ② 舰队数不足 ⇒ **拆最强的一支**补足路数（体现"分舰队"）；
     *   ③ 单路战法（`frontal` / `hold`）⇒ 只打标记，不拆分。
     * @returns 实际采用的战法
     */
    private applyManeuver(fac: any, myFleets: any[], enemyFleets: any[]): ManeuverType {
        if (myFleets.length === 0) return 'frontal';
        const doc: AdmiralDoctrine = (fac as any)._doctrine
            ?? ((fac as any)._doctrine = resolveAdmiralDoctrine((fac as any).admiralTags));
        const myTeam = this.factionMap.get(fac.id)?.team;
        const myPower = myFleets.reduce((s: number, f: any) => s + this.calculateFleetPower(f), 0);
        const ePower = enemyFleets.reduce((s: number, f: any) => s + this.calculateFleetPower(f), 0);
        const maneuver = selectManeuver(doc.styleTag ? [doc.styleTag] : [], {
            fleetCount: myFleets.length,
            // [v32] **可编成路数**（≠ 现有舰队数）——分兵的前提正是"现有舰队不够"，
            //   用现有数去判 `minFleets` 会让 AI 在 1 支舰队时永远退化成正面突击。
            //   口径 = 各队按兵力能编出的路数之和（每路至少 2 艘，上限 3），见 `taskForce.maxRoutesFor`。
            maxRoutes: maxRoutesFor(myFleets.map((f: any) => f.units?.length ?? 0)),
            forceRatio: ePower > 0 ? myPower / ePower : 999,
            enemySupplyPresent: this.auxShips.some((a: any) => {
                const af = this.factionMap.get(a.fleet?.factionId);
                return !!af && af.team !== myTeam;
            }),
            ownSupplyPresent: this.auxShips.some((a: any) => a.fleet?.factionId === fac.id),
        });

        const need = requiredFleets(maneuver);
        if (need <= 1) { myFleets.forEach((f: any) => { f._maneuver = maneuver; }); return maneuver; }

        // ① 舰队够 ⇒ 直接分工（不拆分）
        if (myFleets.length >= need) {
            const plans = assignDetachments(
                myFleets.map((f: any) => ({ id: f.id, power: this.calculateFleetPower(f) })), maneuver);
            for (const p of plans) {
                for (const fid of p.fleetIds) {
                    const fl = myFleets.find((f: any) => f.id === fid);
                    if (!fl) continue;
                    fl._maneuver = maneuver; fl._maneuverRole = p.role;
                    fl._maneuverLateral = p.lateral; fl._maneuverIntent = p.intent;
                    fl._maneuverTargetKind = p.targetKind;
                }
            }
            return maneuver;
        }

        // ② 不足 ⇒ 拆最强的一支补足路数
        const parent = [...myFleets].sort((a: any, b: any) => this.calculateFleetPower(b) - this.calculateFleetPower(a))[0];
        const specs = MANEUVERS[maneuver]?.detachments ?? [];
        const kids = this.splitFleet(parent, specs);
        parent._maneuver = maneuver;
        parent._maneuverRole = specs[0]?.role ?? 'main';
        parent._maneuverLateral = specs[0]?.lateral ?? 0;
        parent._maneuverIntent = specs[0]?.intent ?? '';
        if (kids.length > 0) {
            this.store.triggerToast?.(`${fac.name || '友军'}：${maneuverLabel(maneuver)} —— 已分出 ${kids.length} 支分队`);
        }
        return maneuver;
    }

    /**
     * [v31-C] **玩家主动拆分**：把当前选中的己方舰队按战法拆成多路。
     *
     * 入口：战场**点选一支己方舰队**（→ `battleSelectedFleetId`）后按 `X`。
     * 战法选择：优先沿用该舰队既有战法；否则按「提督教范 + 真实兵力态势」选一个
     *   —— 与 AI 的 `applyManeuver` **同源规则**，保证玩家与友军 AI 用同一套战法体系。
     */
    public splitSelectedFleet(): boolean {
        const fid = this.battleSelectedFleetId;
        if (fid === null || fid === undefined) {
            this.store.triggerToast?.('◎ 请先点选一支己方舰队（或直接点舰队浮标上的「分兵」）');
            return false;
        }
        return this.splitFleetById(fid);
    }

    /** [v31-C] 按舰队 id 拆分 —— **3D 浮标「分兵」按钮 / 快捷键 `X` / 未来 UI 共用同一入口**。 */
    public splitFleetById(fleetId: number): boolean {
        const fleet: any = this.globalFleets.find((f: any) => f.id === fleetId);
        if (!fleet || !fleet.units || fleet.units.length === 0) return false;
        const fac: any = this.factionMap.get(fleet.factionId);
        if (!fac || fac.team !== 1) { this.store.triggerToast?.('◎ 只能拆分己方舰队'); return false; }

        const doc: AdmiralDoctrine = (fac._doctrine
            ?? (fac._doctrine = resolveAdmiralDoctrine(fac.admiralTags))) as AdmiralDoctrine;

        let maneuver: ManeuverType = fleet._maneuver;
        // [v32] 可编成路数 = **被点的这一支**能拆出几路（分兵是对这一支的操作，不看该阵营其它舰队）
        const routes = maxRoutesFor([fleet.units?.length ?? 0]);
        if (!maneuver || requiredFleets(maneuver) <= 1) {
            const myFleets = this.globalFleets.filter((f: any) => f.factionId === fac.id && f.units?.length > 0);
            const enemyFleets = this.globalFleets.filter((f: any) => {
                const ef = this.factionMap.get(f.factionId);
                return !!ef && ef.team !== fac.team && f.units?.length > 0;
            });
            const myPower = myFleets.reduce((s: number, f: any) => s + this.calculateFleetPower(f), 0);
            const ePower = enemyFleets.reduce((s: number, f: any) => s + this.calculateFleetPower(f), 0);
            maneuver = selectManeuver(doc.styleTag ? [doc.styleTag] : [], {
                fleetCount: myFleets.length,
                maxRoutes: routes,
                forceRatio: ePower > 0 ? myPower / ePower : 999,
                // [v32 修] 原先恒为 false ⇒ 「后勤猎杀」「补给护航」在玩家侧**永远不可行**
                //   （`feasible('raid')` 要求敌方有补给在场）⇒ 重后勤提督点分兵也只会退化到正面突击。
                enemySupplyPresent: this.auxShips.some((a: any) => {
                    const af = this.factionMap.get(a.fleet?.factionId);
                    return !!af && af.team !== fac.team;
                }),
                ownSupplyPresent: this.auxShips.some((a: any) => a.fleet?.factionId === fac.id),
            });
            // [v32] 玩家**主动**分兵时，教范若给单路战法而兵力足够多路 ⇒ 升到通用多路战法（一翼迂回）。
            //   理由：玩家点"分兵"这个动作本身就是在要求多路 ⇒ 玩家意图优先于教范（否则按钮被性格挡死）。
            if (requiredFleets(maneuver) <= 1 && routes >= 2) maneuver = 'flank';
        }

        const specs = MANEUVERS[maneuver]?.detachments ?? [];
        if (specs.length < 2) {
            // 区分两种失败原因，避免把"兵力不够"误报成"战法单路"（用户实报的困惑点）
            if (routes < 2) {
                this.store.triggerToast?.(
                    `◎ 兵力不足：拆分需至少 ${MIN_UNITS_PER_ROUTE * 2} 艘战斗舰（当前 ${fleet.units?.length ?? 0} 艘）`);
            } else {
                this.store.triggerToast?.(`◎ ${maneuverLabel(maneuver)} 为单路战法，无需拆分`);
            }
            return false;
        }
        const kids = this.splitFleet(fleet, specs);
        if (kids.length === 0) {
            this.store.triggerToast?.('◎ 兵力不足，无法拆分（需至少 2 艘战斗舰）');
            return false;
        }

        fleet._maneuver = maneuver;
        fleet._maneuverRole = specs[0]?.role ?? 'main';
        fleet._maneuverLateral = specs[0]?.lateral ?? 0;
        fleet._maneuverIntent = specs[0]?.intent ?? '';
        for (const k of kids) k._maneuver = maneuver;
        this.store.triggerToast?.(
            `分舰队 · ${maneuverLabel(maneuver)}：${specs.slice(1).map((s: any) => s.intent).join(' / ') || '已分兵'}`);
        return true;
    }

    /** 姿态命令的公共执行体（即时/延迟两路共用） */
    private applyStanceToFleet(fleet: any, payload: string) {
        fleet.stance = payload;
        fleet.assignedRole = payload;
        // v6：用户手动姿态锁 12 秒——AI 状态机的姿态覆盖（残血自动撤退/断粮重组等）
        // 在锁定期内不得改写玩家刚下达的姿态，杜绝"点索敌→下一秒被还原驻守"（用户实报）。
        // 自动保命类强制转换（isCriticalLowHp → fallback）在血量真正告急时仍走 fleet.state 直改，不受此锁约束。
        fleet._userStanceLockUntil = this.time.now + 12000;
        // [v31-A] 姿态 → 阵型：**优先用该舰队提督的教范阵型**（人格首次影响"姿态指令的落地形态"）。
        //   撤退(fallback)恒用圆阵（全向防御，与战略层口径一致）；其余姿态用教范偏好；
        //   **提督无标签时回退原硬编码表**（零回归）。
        const doc = this.fleetDoctrine(fleet);
        if (doc) fleet.formation = payload === 'fallback' ? 'circle' : doc.formation;
        else if (payload === 'search') fleet.formation = 'spindle';
        else if (payload === 'siege') fleet.formation = 'wedge';
        else if (payload === 'defend') fleet.formation = 'circle';
        else if (payload === 'fallback') fleet.formation = 'line';
        else if (payload === 'stealth') fleet.formation = 'spindle';

        const stanceNames: Record<string, string> = {
            search: '索敌-纺锤阵', siege: '攻坚-雁行阵', fallback: '撤退-线型阵',
            defend: '驻守-圆阵', stealth: '隐身潜行',
        };
        this.store.triggerToast(`舰队变阵：[${stanceNames[payload] || payload}]`);
    }

    /** [V18-B · D3/B2] 玩家手动姿态锁（L1）查询 —— 四层契约「L0 保命 > L1 玩家手动(12s锁) > L2 mission > L3 per-frame」。
     *  L2（executeMissionTick）与 L3（per-frame 常规）在**写 stance 前**须过此门；锁期内不覆盖 L1。
     *  **L0 保命例外**：per-frame 的「残血 fallback」「压倒性劣势 fallback」（保命硬条件）**不经此门**，
     *  与 applyStanceToFleet 注释「自动保命类强制转换…不受此锁约束」自述一致；`_missionDest`（目的地粘滞通道）亦不受此门约束。 */
    private isStanceLocked(fleet: any): boolean {
        return ((fleet?._userStanceLockUntil as number | undefined) ?? 0) > this.time.now;
    }

    /** 渲染伤害数字 */
    private spawnDamageNumber(x: number, y: number, value: number, isCrit: boolean) {
        const txt = this.add.text(x, y, Math.floor(value).toString(), {
            fontSize: isCrit ? '14px' : '11px',
            color: isCrit ? '#f59e0b' : '#ffffff',
            fontFamily: 'monospace', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 2,
        }).setDepth(45).setAlpha(0.8);
        this.tweens.add({
            targets: txt, y: y - 40, alpha: 0,
            duration: 900, ease: 'Sine.easeOut',
            onComplete: () => txt.destroy()
        });
    }

    /** 渲染敌人攻击意图线（暂停时） */
    private renderIntentLines() {
        this.intentLines.clear();
        if (!commandBridge.visible) return;
        this.globalFleets.forEach(fleet => {
            const myFac = this.factionMap.get(fleet.factionId);
            if (!myFac || myFac.type === 'player') return; // 不画玩家的意图
            fleet.units?.forEach((u: any) => {
                if (u._target && u.hp > 0) {
                    const tgt = u._target;
                    this.intentLines.lineStyle(1.5, 0xff4444, 0.5);
                    this.intentLines.beginPath();
                    this.intentLines.moveTo(u.sprite.x, u.sprite.y);
                    this.intentLines.lineTo(tgt.sprite.x, tgt.sprite.y);
                    this.intentLines.strokePath();
                    // 红色小三角
                    this.intentLines.fillStyle(0xff4444, 0.7);
                    const ang = Math.atan2(tgt.sprite.y - u.sprite.y, tgt.sprite.x - u.sprite.x);
                    this.intentLines.fillTriangle(
                        tgt.sprite.x - 8 * Math.cos(ang), tgt.sprite.y - 8 * Math.sin(ang),
                        tgt.sprite.x - 4 * Math.cos(ang + 0.3), tgt.sprite.y - 4 * Math.sin(ang + 0.3),
                        tgt.sprite.x - 4 * Math.cos(ang - 0.3), tgt.sprite.y - 4 * Math.sin(ang - 0.3)
                    );
                }
            });
        });
    }

    private initFactions() {
        const team1Colors = [0x00ffff, 0x3b82f6, 0x10b981, 0x6366f1, 0x0ea5e9];
        const team2Colors = [0xff0000, 0xf59e0b, 0xd946ef, 0xf43f5e, 0xb91c1c];
        const allFactionsConf: any[] = [];
        /* [大战场] 演习轨道建舰改为"按兵力折算"，这里把每支舰队的编制/军衔/实体预算挂到 faction 上，
           供 spawnInitialFleets 走 `buildTacticalUnits`（与战役轨道同一入口）。
           ⚠ 计算必须一次到位：spawnInitialFleets 逐队读 fac.composition / fac.entityBudget，
             不一致就会出现"地图尺度按 A 算、建舰按 B 算"。 */
        const spawnPlan = this.skirmishEntityPlan();

        const myAdmirals = this.store.dispatchAdmirals || [];
        const isSimMode = !!(this.store as any).simMode; // 战术模拟模式检测
        // 战术模拟模式下的满编 deck（战列×2 巡洋×3 驱逐×2 补给×1 = 8 艘）。
        // v2 修复：原版无补给舰 → collectAuxShips 收集 0 艘 → 运输舰永远不出现、后勤战无法演示。
        const simFullDeck = (faction: string) => [
          `${faction}_战列_1`, `${faction}_战列_1`,
          `${faction}_巡洋_1`, `${faction}_巡洋_1`, `${faction}_巡洋_1`,
          `${faction}_驱逐_1`, `${faction}_驱逐_1`, `${faction}_补给_1`
        ];
        myAdmirals.forEach((admId: number, index: number) => {
            const admInfo = this.store.allAdmirals.find((a: any) => a.id === admId);
            if (!admInfo) return;
            const effStats = this.store.getEffectiveStats(admId) || admInfo.stats;
            
            allFactionsConf.push({ 
                id: admInfo.id, imageId: admInfo.imageId, type: index === 0 ? 'player' : 'ai', team: 1, 
                name: `${admInfo.name}舰队`, color: team1Colors[index % team1Colors.length], 
                cssColor: '#' + team1Colors[index % team1Colors.length].toString(16).padStart(6, '0'), 
                trait: admInfo.faction, 
                deck: isSimMode ? simFullDeck(admInfo.faction) : admInfo.deck, 
                // [大战场] 折算口径：军衔 → 编制 → 实体预算（= spawnInitialFleets 的建舰依据）
                milRank: this.skirmishMilRank(admInfo.rank),
                composition: this.skirmishCompositionFor(this.skirmishMilRank(admInfo.rank)),
                entityBudget: spawnPlan.player[index] ?? 0,
                admiralStats: effStats, rank: admInfo.rank,
                // v29：把提督标签带进战场 faction → 战术层据此解析作战风格（动摇线 / 阵型偏好）
                admiralTags: admInfo.tags,
                // [v33 P1-4.4] 提督特技带进战场：新增的三维（阵型崩溃抵抗 / 拦截 / 射击武器专精）
                //   需要战术层能读到特技；此前战场侧完全拿不到 skills（只在战略层 gameStore 用）。
                admiralSkills: admInfo.skills || [],
            });
        });

        if (allFactionsConf.length === 0) {
            allFactionsConf.push({ id: 999, imageId: '', type: 'player', team: 1, name: '独立舰队', color: team1Colors[0], cssColor: '#00ffff', trait: 'empire', deck: [], admiralStats: { operations: 50, command: 70 }, rank: 3 });
        }

        const enemyCount = parseInt(String(this.store.activeFactionCount), 10) || 2;
        const diff = this.store.selectedDiff || 'normal';
        
        // 1. 按照能力总值排序提督池
        let enemyPool = this.store.allAdmirals.filter((a: any) => a.faction !== this.store.selectedFactionId);
        enemyPool.sort((a: any, b: any) => {
            const totalA = Object.values(a.stats).reduce((acc: any, val: any) => acc + val, 0) as number;
            const totalB = Object.values(b.stats).reduce((acc: any, val: any) => acc + val, 0) as number;
            return totalA - totalB;
        });

        // 根据难度筛选提督池区间
        if (diff === 'easy') {
            enemyPool = enemyPool.slice(0, Math.max(2, Math.floor(enemyPool.length / 2))); // 简单：只选能力最弱的一半
        } else if (diff === 'hard') {
            enemyPool = enemyPool.slice(-Math.max(2, Math.floor(enemyPool.length / 2))); // 困难：只选能力最强的一半
        }
        enemyPool.sort(() => Math.random() - 0.5); // 打乱后抽取

        for (let i = 0; i < enemyCount; i++) {
           const eAdm = enemyPool[i];
           if (!eAdm) continue;
           const cColor = team2Colors[i % team2Colors.length];
           
           // 2. 动态配置建制与副官加成
           let enemyDeck: string[] = [];
           let buffedStats = { ...eAdm.stats };

           if (isSimMode) {
               // 战术模拟：敌军满编 8 艘 (+10 全属性)
               enemyDeck = simFullDeck(eAdm.faction);
               Object.keys(buffedStats).forEach(k => buffedStats[k] += 10);
           } else if (diff === 'easy') {
               // 简单：4艘基础舰，无副官
               enemyDeck = [`${eAdm.faction}_战列_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_驱逐_1`];
           } else if (diff === 'hard') {
               // 困难：满编8艘，模拟极品副官配置 (+30全属性)
               enemyDeck = [`${eAdm.faction}_战列_1`, `${eAdm.faction}_战列_1`, `${eAdm.faction}_突击_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_电子_1`];
               Object.keys(buffedStats).forEach(k => buffedStats[k] += 30);
           } else {
               // 普通：6艘标准舰，模拟普通副官 (+10全属性)
               enemyDeck = [`${eAdm.faction}_战列_1`, `${eAdm.faction}_战列_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_巡洋_1`, `${eAdm.faction}_驱逐_1`, `${eAdm.faction}_驱逐_1`];
               Object.keys(buffedStats).forEach(k => buffedStats[k] += 10);
           }

           allFactionsConf.push({ 
               id: eAdm.id + 10000, imageId: eAdm.imageId, type: 'ai', team: 2, 
               name: `${eAdm.name}舰队`, color: cColor, cssColor: '#' + cColor.toString(16).padStart(6, '0'), 
               trait: eAdm.faction, deck: enemyDeck, admiralStats: buffedStats, rank: diff === 'hard' ? 4 : (diff === 'easy' ? 2 : 3),
               // v29：敌方提督标签同样进入战场 → AI 舰队也按"这个提督是谁"行事（个性不再只属于玩家）
               admiralTags: eAdm.tags,
               // [v33 P1-4.4] 敌方特技同样生效（避免"机制只加给玩家"的不对称）
               admiralSkills: eAdm.skills || [],
               // [大战场] 敌方难度改用**兵力（军衔）**表达：旧实现用 deck 条数 4/6/8 表达，已废。
               // 注意 `rank` 字段不能动 —— 它是另一套口径（副官/卡牌规模），与军衔无关。
               milRank: this.skirmishEnemyMilRank(),
               composition: this.skirmishCompositionFor(this.skirmishEnemyMilRank()),
               entityBudget: spawnPlan.enemy
           });
        }

        this.store.factions = allFactionsConf.map(fc => {
          const ops = fc.admiralStats?.operations || 0;
          return {
            ...fc, hp: 100, maxHp: 100, 
            gold: (this.store.selectedDiff === 'easy' && fc.team === 1 ? 500 : 200) + ops * 2, 
            goldRate: (this.store.selectedDiff === 'easy' && fc.team === 1 ? 5 : 2) + Math.floor(ops / 20), 
            active: true, castlePos: {x:0, y:0}, unitCount: 0,
            buildCounts: { barracks: 0, mines: 0, towers: 0 } 
          };
        });
        
        this.store.factions.filter((f: any) => f.team === 2).forEach((ai: any) => {
          // v2 公平化：不再白送金。hard 差异改为决策更激进（铺地价格已在扩张逻辑中×0.7）
        });

        // 重建 faction 查找缓存：factions 已重新创建，旧缓存指向失效对象
        this.factionMap.clear();
        this.store.factions.forEach((f: any) => this.factionMap.set(f.id, f));
    }

    private buildMapData(): any[] {
        let mapDataMatrix: any[] = [];
        if (this.store.selectedMapId === 'random') {
          // 战场扩容（对齐 demo 大地图观感）：半径 25→32（1951→3169 格）
          for (let q = -32; q <= 32; q++) {
            for (let r = -32; r <= 32; r++) {
              if (Math.abs(q + r) > 32) continue;
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.04) type = 'sea';
              else if (rand < 0.07) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          const numPlanets = 15 + Math.floor(Math.random() * 10);
          const landHexes = mapDataMatrix.filter(t => t.type === 'pending');
          for(let i=0; i<numPlanets && landHexes.length > 0; i++) {
             const idx = Math.floor(Math.random() * landHexes.length);
             landHexes[idx].type = 'planet'; landHexes.splice(idx, 1);
          }
        } else if (this.store.selectedMapId === 'random_rect') {
          // 长条地图扩容：41×21 → 53×27
          for (let q = -26; q <= 26; q++) {
            for (let r = -13; r <= 13; r++) {
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.04) type = 'sea'; else if (rand < 0.07) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          const numPlanets = 6 + Math.floor(Math.random() * 4);
          const landHexes = mapDataMatrix.filter(t => t.type === 'pending');
          for(let i=0; i<numPlanets && landHexes.length > 0; i++) {
             const idx = Math.floor(Math.random() * landHexes.length);
             landHexes[idx].type = 'planet'; landHexes.splice(idx, 1);
          }
        } else if (this.store.selectedMapId === 'random_large') {
          for (let q = -16; q <= 16; q++) {
            for (let r = -16; r <= 16; r++) {
              if (Math.abs(q + r) > 20) continue;
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.04) type = 'sea'; else if (rand < 0.07) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          const numPlanets = 8 + Math.floor(Math.random() * 5);
          const landHexes = mapDataMatrix.filter(t => t.type === 'pending');
          for(let i=0; i<numPlanets && landHexes.length > 0; i++) {
             const idx = Math.floor(Math.random() * landHexes.length);
             landHexes[idx].type = 'planet'; landHexes.splice(idx, 1);
          }
        } else if (this.store.selectedMapId === 'standard') {
          // v6.9 伊谢尔伦要塞战（演习轨道）：此前落入 else 13×13 小图 → "3D 下很窄、
          //   2D 要塞特性全没了"（用户实报）。现对齐战役轨道的伊谢尔伦长条图并扩大：
          //   q: -30~+30（横向 61 格）、r: -14~+14（纵向 29 格）。
          for (let q = -30; q <= 30; q++) {
            for (let r = -14; r <= 14; r++) {
              let type = 'pending'; const rand = Math.random();
              if (rand < 0.03) type = 'sea';
              else if (rand < 0.05) type = 'ruined';
              mapDataMatrix.push({ q, r, cost: 50, type, ownerId: 0 });
            }
          }
          // 要塞地块：q=18, r=0 中心 + 6 邻格（居中偏东，守方部署在要塞东侧）
          const fortressOffsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
          fortressOffsets.forEach(([dq, dr]) => {
            const tile = mapDataMatrix.find(t => t.q === 18 + dq && t.r === 0 + dr);
            if (tile) tile.type = 'fortress';
          });
          // 少量宜居行星（战略争夺点，避开要塞区与西缘出生区）
          const planetCandidates = mapDataMatrix.filter(t =>
            t.type === 'pending' && Math.abs(t.r) < 10 && (t.q < 12 || t.q > 24) && t.q > -26);
          for (let i = 0; i < 6 && planetCandidates.length > 0; i++) {
            const idx = Math.floor(Math.random() * planetCandidates.length);
            planetCandidates[idx].type = 'planet'; planetCandidates.splice(idx, 1);
          }
        } else if (this.store.selectedMapId.startsWith('custom_')) {
          const rawCustom = JSON.parse(JSON.stringify(this.store.customMapsData[this.store.selectedMapId]));
          mapDataMatrix = rawCustom.map((c: any) => ({ ...c, ownerId: 0 }));
        } else {
          for (let q = -6; q <= 6; q++) { for (let r = -6; r <= 6; r++) {
            if (Math.abs(q + r) > 7) continue;
            let tType = 'pending'; if (q === 0 || r === 0 || q + r === 0) tType = 'sea';
            mapDataMatrix.push({ q, r, cost: 50, type: tType, ownerId: 0 });
          } }
        }

        let validStartNodes = mapDataMatrix.filter(t => t.type === 'pending' || t.type === 'pier' || t.type === 'planet');
        validStartNodes.sort((a, b) => a.q - b.q); 
        
        if (validStartNodes.length > 0) {
            const fCount = this.store.factions.length / 2;
            const poolSize = Math.max(fCount * 2, Math.floor(validStartNodes.length * 0.15));
            let team1Nodes = validStartNodes.slice(0, poolSize);
            let team2Nodes = validStartNodes.slice(-poolSize);
            team1Nodes.sort(() => Math.random() - 0.5); team2Nodes.sort(() => Math.random() - 0.5);
            const customCastles = mapDataMatrix.filter(t => t.type === 'castle');
            customCastles.forEach(c => { c.type = 'pending'; c.ownerId = 0; c.cost = 50; });
            const useRandomSpawn = this.store.selectedMapId === 'random' || this.store.selectedMapId === 'random_rect' || this.store.selectedMapId === 'random_large' || this.store.selectedMapId === 'standard' || customCastles.length < this.store.factions.length;
            
            let usedNodes = new Set();
            this.store.factions.forEach((f: any, idx: number) => {
               let node: any = null;
               if (useRandomSpawn) {
                   let targetPool = f.team === 1 ? team1Nodes : team2Nodes;
                   node = targetPool.find((n: any) => !usedNodes.has(n));
                   if (!node) node = validStartNodes.find((n: any) => !usedNodes.has(n));
               } else { node = customCastles[idx]; }

               if (!node) {
                const validTiles = mapDataMatrix.filter(t => t.type !== 'sea' && t.type !== 'ruined' && !usedNodes.has(t));
                if (validTiles.length > 0) {
                    node = validTiles[Math.floor(Math.random() * validTiles.length)];
                }
            }

                if (node) {
                    usedNodes.add(node);
                    node.type = 'castle';
                    node.ownerId = f.id;
                    node.cost = 0;
                    // v2 修复（舰队中间出生）：指挥制地图不限于此矩阵——3D 纯宇宙战场
                    //   由 buildSpaceWorld/castlePos 兜底撑开。若 castle tile 落在
                    //   小矩阵中部（如 standard/narrow 半径 6~7 图），按 hex 算出的 castlePos
                    //   只有 ±300px → 双方挤在战场中央（用户实报）。
                    //   指挥制下忽略矩阵位置，直接按 team 分配左右边缘出生点。
                    // v6.6：不再硬编码 ±3000——按地图矩阵实际半跨动态推导（commandSpawnDist）。
                    //   大图（hexR=50 半径32）≈ ±7600，小图（hexR=26 半径6）≈ ±1180，
                    //   未来伊谢尔伦长条图（51×17）自动按横向半跨贴边。见 commandSpawnDist 注释。
                    // 忽略矩阵位置，直接按 team 分配左右边缘出生点（v6.6：按地图实际半跨动态推导）
                    f.castlePos = {
                        x: f.team === 1 ? -this.commandSpawnDist : this.commandSpawnDist,
                        y: (Math.random() - 0.5) * this.commandHalfX * 0.4
                    };
                    mapDataMatrix.forEach(t => {
                       const dist = Math.max(Math.abs(t.q - node.q), Math.abs(t.r - node.r), Math.abs(-t.q-t.r - (-node.q-node.r)));
                       if (dist <= 2) {
                           if (t.type === 'sea' || t.type === 'ruined') { 
                               t.type = 'pending'; 
                               t.cost = 50; 
                           }
                           t.ownerId = f.id;
                       }
                   });
               }
            });
        }

        mapDataMatrix.forEach(t => {
          if (t.type === 'pending' || t.type === 'mystery') {
            let roll = Math.random();
            if (roll < 0.05) { t.type = 'gold_mine'; t.cost = 100; }
            else if (roll < 0.10) { t.type = 'tower'; t.cost = 50; }
            else { t.type = 'pending'; t.cost = 50; }
          }
        });

        // ── P1 地形系统：为可通行格子注入地形效果 ──
        // 对称公平：地形只加在非出生区（距所有 castle ≥3 格）
        const castleTiles = mapDataMatrix.filter(t => t.type === 'castle');
        const isNearCastle = (t: any) => castleTiles.some(c => Math.max(
          Math.abs(t.q - c.q), Math.abs(t.r - c.r), Math.abs(-t.q - t.r - (-c.q - c.r))) <= 3);
        const EXCLUDED = new Set(['sea', 'ruined', 'planet', 'castle']);
        /**
         * 地形抽签表（**唯一真源**）：`[id, 权重]`。
         * 权重沿用 v33 的累计阈值（0.06/0.06/0.04/0.04/0.04/0.03）⇒ 各类型相对比例不变，
         * 只是不再写死在 if 链里，好让"区域化生成"按配额分配类型。
         */
        const TERRAIN_DRAW: [string, number][] = [
          ['nebula', 0.06],    // 星云：减速 + 闪避+（v33）索敌-5%
          ['asteroid', 0.06],  // 小行星带：射程-30% +（v33）索敌-20%
          ['gravity', 0.04],   // 引力点：移速+30% +（v33）索敌-20%
          ['debris', 0.04],    // 残骸区：可藏匿 +（v33）索敌-20%
          ['mine', 0.04],      // 机雷区：移动-45% / 每 3s 扣 1.5% maxHp
          ['jeff', 0.03],      // 杰夫粒子云：移动-10% / 每 3s 扣 0.8% maxHp
        ];
        const DRAW_SUM = TERRAIN_DRAW.reduce((a, [, w]) => a + w, 0);
        const rollType = (): string => {
          let r = Math.random() * DRAW_SUM;
          for (const [id, w] of TERRAIN_DRAW) { if ((r -= w) < 0) return id; }
          return TERRAIN_DRAW[TERRAIN_DRAW.length - 1][0];
        };

        if (TERRAIN_RULES.REGION_GEN) {
          // ── [v36d] 区域化生成：播种子 + 泛洪生长 ──
          // 旧实现逐格独立掷骰 ⇒ 6 种均分下 P(相邻同类) ≈ 17% ⇒ 83% 的相邻边都是分界
          // ⇒ 画面必然是"六边形彩色马赛克"。改成少量种子长成大片区域后，
          //   地形才读作"空域"（一片星云 / 一条小行星带）而不是撒盐粒。
          //
          // ⚠ **类型必须按配额分配**：首版给每个区域**随机**取类型，实测 97 片区域里
          //   一片 111 格的杰夫吃掉了大半地图（jeff 419 / nebula 5）——单类型垄断 + 
          //   另一些类型几乎不出现（图例就成了空头支票）。现改为"每种类型按权重拿配额"。
          const byKey = new Map<string, any>();
          for (const t of mapDataMatrix) byKey.set(`${t.q},${t.r}`, t);
          const canPlace = (t: any) => !!t && !t.terrain && !EXCLUDED.has(t.type) && !isNearCastle(t);
          const NB6: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

          const usable = mapDataMatrix.filter(canPlace);
          const target = Math.round(usable.length * TERRAIN_RULES.COVERAGE);
          const [szMin, szMax] = TERRAIN_RULES.REGION_SIZE;
          const seeds = [...usable];
          for (let i = seeds.length - 1; i > 0; i--) {          // Fisher–Yates
            const j = Math.floor(Math.random() * (i + 1));
            [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
          }
          let seedPtr = 0;
          const nextSeed = (): any => {
            while (seedPtr < seeds.length) { const s = seeds[seedPtr++]; if (canPlace(s)) return s; }
            return null;
          };
          /** 从 seed 泛洪生长至多 want 格；返回实际长出的格数。 */
          const growRegion = (seed: any, type: string, want: number): number => {
            const frontier: any[] = [seed];
            let grown = 0;
            while (frontier.length > 0 && grown < want) {
              // 随机取前沿（而非 FIFO）⇒ 生长轮廓不规则，不是规整圆斑
              const k = Math.floor(Math.random() * frontier.length);
              const cur = frontier.splice(k, 1)[0];
              if (!canPlace(cur)) continue;
              cur.terrain = type;
              grown++;
              for (const [dq, dr] of NB6) {
                const n = byKey.get(`${cur.q + dq},${cur.r + dr}`);
                if (canPlace(n)) frontier.push(n);
              }
            }
            return grown;
          };

          for (const [type, w] of TERRAIN_DRAW) {
            let want = Math.round((target * w) / DRAW_SUM);
            let guard = 0;
            while (want > 0 && guard++ < 200) {
              const seed = nextSeed();
              if (!seed) break;
              const size = Math.min(want, szMin + Math.floor(Math.random() * (szMax - szMin + 1)));
              const grown = growRegion(seed, type, size);
              if (grown === 0) continue;
              want -= grown;
            }
          }

          // 区域之外撒一点零散格：避免"区域边缘过于干净"显得像人工分区
          if (TERRAIN_RULES.SCATTER > 0) {
            for (const t of mapDataMatrix) {
              if (!canPlace(t)) continue;
              if (Math.random() < TERRAIN_RULES.SCATTER) t.terrain = rollType();
            }
          }
        } else {
          // ── 旧实现（逐格独立掷骰）：`TERRAIN_RULES.REGION_GEN = false` 时走这里 ──
          mapDataMatrix.forEach(t => {
            if (EXCLUDED.has(t.type) || isNearCastle(t)) return;
            if (Math.random() < 0.27) t.terrain = rollType();   // 27% 覆盖（与 v33 一致）
          });
        }

        mapDataMatrix.forEach(t => { if (t.terrain) t.cost += 25; }); // 有地形的格子铺路更贵


        // v6.6：按矩阵实际范围推导指挥制出生参数（castlePos 三处赋值 + 中继避让共用）
        this.computeCommandSpawnExtent(mapDataMatrix);
        return mapDataMatrix;
    }

    /** 计算舰队战斗力（HP × DPS 估值） */
    private calculateFleetPower(fleet: any): number {
        if (!fleet || !fleet.units) return 0;
        let total = 0;
        fleet.units.forEach((u: any) => {
            const effectiveHp = Math.max(0, u.hp);
            const dpsEstimate = (u.atk || 50) / Math.max(1, (u.atkInterval || 2000) / 1000);
            total += effectiveHp * (1 + dpsEstimate * 0.1);
        });
        return total;
    }

    private isAdjacentToTeam(targetTile: any, teamId: number) {
        for (const dir of this.directions) {
          const neighbor = this.tilesDict[`${targetTile.q + dir.q},${targetTile.r + dir.r}`];
          if (neighbor && neighbor.ownerId !== 0) {
             const ownerFac = this.factionMap.get(neighbor.ownerId);
             if (ownerFac && ownerFac.team === teamId) return true;
          }
        } return false;
    }

    private async handleTileClick(pointer: Phaser.Input.Pointer, tile: any, poly: Phaser.GameObjects.Polygon, txt: Phaser.GameObjects.Text) {
        if (pointer.getDistance() > 30 || this.store.gameOver || this.store.isPaused) return;
        const { sprite, text, ...pureTile } = tile;
        
        // 动态判定地块名称
        if (pureTile.type === 'pending') {
            const pFacInfo = this.store.factions.find((f: any) => f.type === 'player');
            if (tile.ownerId === 0) pureTile.type = '未知空域';
            else if (pFacInfo && tile.ownerId === pFacInfo.id) pureTile.type = '我方控制区';
            else pureTile.type = '敌占区';
        } else {
            pureTile.type = tile.typeName || pureTile.type;
        }
        
        this.store.selectedTile = pureTile;
        
        const pFac = this.store.factions.find((f: any) => f.type === 'player');
        if (!pFac || !pFac.active) return;
        
        if (this.store.isCastingBomb) { 
            this.castBomb(tile.x, tile.y, tile, pFac); 
            return;
        }
        if (tile.type === 'sea' || tile.type === 'ruined') return;

        // 右鍵點擊 (button === 2)：有选中的己方舰队 → 移动该舰队；否则 → 投放戰術信標
        //   [V18-B · C4] 原「选中盟军 → 提示」分支已移除（恒假，见选定项清理处说明）。
        if (pointer.button === 2) {
            const sel = this.battleSelectedFleetId;
            if (sel !== null) {
                const selFleet = this.globalFleets.find((f: any) => f.id === sel);
                const selFac = selFleet ? this.factionMap.get(selFleet.factionId) : null;
                if (selFleet && selFac && selFac.type === 'player') {
                    // [R10-B2] 第一道权限守卫（第二道纵深校验在 orderFleetMove 内）
                    this.orderFleetMove(selFleet, tile.x, tile.y);
                    return;
                }
                // [V18-B · C4] 已移除恒假的「盟军右键 → 军议 toast」分支（#63-a：Faction.type 无 'ally'，该分支恒不可达，行为不变）。
                // 选中项已失效（被歼灭/离场）→ 清选中后落回信标（安全降级）
                this.battleSelectedFleetId = null;
            }
            this.deployFlare(tile.x, tile.y, pFac.id);
            return;
        }

        // 【2D 拾取已删除】选目标/选舰队在指挥制下由 `Battle3DOverlay` 做屏幕空间命中

        // 左鍵點擊 (button === 0)：擴張補給線或建立野戰修補站
        if (tile.ownerId !== pFac.id) {
            // 【核心重构】补给线防御装甲化：凡是被占领的格子（非中立），一律不准直接购买！
            if (tile.ownerId !== 0) {
                this.store.triggerToast("无法直接购买敌方控制区，必须派遣舰队用炮火摧毁其补给节点！");
                return;
            }
            if (tile.type === 'planet' || tile.type === 'relay') {
                this.store.triggerToast(tile.type === 'relay' ? "中继补给站无法直接购买，请指派舰队靠近占领！" : "星球无法直接购买，请指派舰队靠近压制！");
                return;
            }

            // 點擊中立格子，若相鄰且資金足夠則佔領（擴張補給線）
            if (this.isAdjacentToTeam(tile, pFac.team)) {
                if (pFac.gold >= tile.cost) {
                    pFac.gold -= tile.cost;
                    tile.ownerId = pFac.id;
                    poly.setFillStyle(pFac.color, 0.9);
                    poly.setStrokeStyle(3, pFac.color, 1.0);
                    // 觸發連通性更新
                    this.updateSupplyNetwork(); 
                } else {
                    this.store.triggerToast(`資金不足，擴張該空域需要 ${tile.cost} 經費`);
                }
            }
            return;
        }

        // 點擊已佔領的普通格子：建立野戰修補站
        if (tile.ownerId === pFac.id && tile.connected && tile.type === 'pending') {
            if (pFac.gold >= 300) {
                pFac.gold -= 300;
                tile.type = 'barracks';
                poly.setFillStyle(pFac.color, 0.9); 
                poly.setStrokeStyle(3, pFac.color, 1.0);
                txt.setText('⚙').setAlpha(0.8);
                this.store.triggerToast("野戰修補站部署完畢，提供範圍補給。");
            } else {
                this.store.triggerToast("經費不足，建立野戰修補站需 300 經費。");
            }
            return;
        }
    }

    private castBomb(x: number, y: number, tile: any, pFac: any) {
        if (pFac.gold < 200) {
            this.store.isCastingBomb = false;
            this.store.triggerToast("资金不足，无法执行主炮打击(需200)");
            return;
        }
        pFac.gold -= 200; this.store.isCastingBomb = false;
        
        const shockwave = this.add.circle(x, y, 10, 0xef4444).setAlpha(0.8).setDepth(40);
        this.tweens.add({ targets: shockwave, radius: 150, alpha: 0, duration: 500, onComplete: () => shockwave.destroy() });
        
        if (tile.ownerId !== pFac.id && this.factionMap.get(tile.ownerId)?.team !== pFac.team) tile.hp -= 300;
        
        this.globalFleets.forEach(fl => {
           if (this.factionMap.get(fl.factionId)?.team !== pFac.team) {
              fl.units.forEach((u: any) => {
                                    if (Phaser.Math.Distance.Between(x, y, u.sprite.x, u.sprite.y) < 150) {
                      const minDmg = Math.max(1, Math.floor(u.maxHp * 0.005));
                      u.hp -= Math.max(200, minDmg);
                  }
              });
           }
        });
    }

    update(time: number, delta: number) {
        if (this.store.gameOver) return;

        // ── 指挥点：空格键检测（每帧检查，暂停时也能工作）──
        if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
            if (commandBridge.visible) {
                // [2a] 全局取消：关闭面板 + 退选目标态 + 恢复实时（统一走 closeCommandPanel）
                this.closeCommandPanel();
            } else {
                this.openCommandPanel();
            }
        }

        if (this.store.isPaused) {
            this.renderIntentLines();
            return;
        }
        const dt = this.store.currentSpeedFactor;
        this.hpBarsGraphics.clear();

        // ── 指挥点系统：应用效果（CP恢复+效果倒计时+伤害/速度修正）──
        this.applyCommandEffects(delta);
        this.applyBandwidthEffects(delta);

        // 构建 faction 查找缓存（O(1) Map 替代 O(N) find，每帧节省 ~16000 次线性扫描）
        this.factionMap.clear();
        this.store.factions.forEach((f: any) => this.factionMap.set(f.id, f));

        // === 纯宇宙扫描空间：舰队光环每帧重绘，扫描线 overlay 随相机节流重绘 ===
        if (this.spaceFleets) {
            drawCommandFleets(this.spaceFleets, this.globalFleets, this.spaceGlowTime.val, this.factionMap);
        }
        this.spaceScanTimer += delta;
        if (this.spaceScan && this.spaceScanTimer > 60) {
            this.spaceScanTimer = 0;
            drawCommandScanOverlay(this.cameras.main, this.spaceScan, this.time.now);
        }

        const pFac = this.store.factions.find((f: any) => f.type === 'player');
                
        this.tilesList.forEach(t => {
            if (t.type === 'tower' && t.ownerId !== 0) {
                const myTowerFac = this.factionMap.get(t.ownerId);
                if (!myTowerFac) return;
                const towerRate = Math.max(800, 1500 - (myTowerFac.admiralStats?.intelligence || 0) * 5);
                if (time - t.lastTowerShotTime > (towerRate / dt)) { 
                    let targets: any[] = [];
                    this.globalFleets.forEach(fl => {
                        const uFac = this.factionMap.get(fl.factionId);
                        if (uFac && uFac.team !== myTowerFac.team) targets.push(...fl.units);
                    });
                    let closestTarget: any = null; let minDist = 140; 
                    targets.forEach(u => {
                        const d = Phaser.Math.Distance.Between(t.x, t.y, u.sprite.x, u.sprite.y);
                        if (d < minDist) { minDist = d; closestTarget = u; }
                    });
                    if (closestTarget) {
                        t.lastTowerShotTime = time;
                        const rect = this.add.circle(t.x, t.y, 4, myTowerFac.color);
                        this.phaserProjectiles.push({ sprite: rect, target: closestTarget, damage: 15 + Math.floor((myTowerFac.admiralStats?.attack || 0)/10) });
                    }
                }
            }
        });

        for (let i = this.phaserProjectiles.length - 1; i >= 0; i--) {
            const p = this.phaserProjectiles[i];
            if (!p.target.sprite || !p.target.sprite.active) { p.sprite.destroy(); this.phaserProjectiles.splice(i, 1); continue; }
            
            const angle = Math.atan2(p.target.sprite.y - p.sprite.y, p.target.sprite.x - p.sprite.x);
            p.sprite.rotation = angle;
            // 【放慢相位炮弹】12.0 → 6.0，飞行速度减半，营造炮弹缓缓逼近的压迫感
            p.sprite.x += Math.cos(angle) * 6.0 * dt;
            p.sprite.y += Math.sin(angle) * 6.0 * dt;

            if (Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, p.target.sprite.x, p.target.sprite.y) < 15) {
                                const minTowerDmg = Math.max(1, Math.floor(p.target.maxHp * 0.005));
                p.target.hp -= Math.max(p.damage, minTowerDmg);
                // 伤害数字
                this.spawnDamageNumber(p.target.sprite.x, p.target.sprite.y, Math.max(p.damage, minTowerDmg), false);
                if (p.target.sprite.active) {
                    p.target.sprite.setAlpha(0.3);
                    this.time.delayedCall(100, () => { if (p.target.sprite && p.target.sprite.active) p.target.sprite.setAlpha(1.0); });
                }
                
                const tFac = this.factionMap.get(p.target.factionId);
                const shieldColor = tFac ? tFac.color : 0x06b6d4;
                const impactAngleRad = Math.atan2(p.sprite.y - p.target.sprite.y, p.sprite.x - p.target.sprite.x);
                const impactAngleDeg = Phaser.Math.RadToDeg(impactAngleRad);
                // 3D 覆盖层：塔弹命中护盾涟漪事件（dir=激光传播方向=弹丸行进方向，见 battle3dFx 契约）
                pushFx3d({ kind: 'shield', at: { x: p.target.sprite.x, y: p.target.sprite.y }, dir: { x: -Math.cos(impactAngleRad), y: -Math.sin(impactAngleRad) }, color: shieldColor });

                const impactX = p.target.sprite.x + Math.cos(impactAngleRad) * 10;
                const impactY = p.target.sprite.y + Math.sin(impactAngleRad) * 10;
                const impactFlash = this.add.circle(impactX, impactY, 4, 0xffffff, 1).setDepth(21).setBlendMode(Phaser.BlendModes.ADD);

                // 【球形护盾涟漪】3D球面护盾的2D投影=椭圆弧线，仅弧边无填充无弦线，从受击点向两侧扩散消散
                const gfx = this.add.graphics().setDepth(20);
                const rippleState: any = { rx: 14, ry: 8, span: 0.45, alpha: 1 };
                const drawShieldArc = () => {
                    gfx.clear();
                    if (rippleState.alpha <= 0) return;
                    const a1 = impactAngleRad - rippleState.span;
                    const a2 = impactAngleRad + rippleState.span;
                    gfx.lineStyle(Math.max(0.4, 3 * rippleState.alpha), shieldColor, rippleState.alpha);
                    gfx.beginPath();
                    for (let s = 0; s <= 24; s++) {
                        const t = a1 + (a2 - a1) * (s / 24);
                        const px = p.target.sprite.x + rippleState.rx * Math.cos(t);
                        const py = p.target.sprite.y + rippleState.ry * Math.sin(t);
                        s === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py);
                    }
                    gfx.strokePath();
                };
                drawShieldArc();

                this.tweens.add({ targets: impactFlash, scale: 0.1, alpha: 0, duration: 200 / dt, ease: 'Cubic.easeOut', onComplete: () => impactFlash.destroy() });
                this.tweens.add({
                    targets: rippleState, rx: 32, ry: 18, span: Math.PI * 0.6, alpha: 0,
                    duration: 1100 / dt, ease: 'Sine.easeOut',
                    onUpdate: drawShieldArc,
                    onComplete: () => gfx.destroy()
                });

                p.sprite.destroy(); 
                this.phaserProjectiles.splice(i, 1);
            }
        }

        this.globalFleets = this.globalFleets.filter(fleet => {
            // P3 战损账单：累计玩家舰队战损（非AI）
            const pFac3 = this.store.factions.find((f: any) => f.type === 'player');
            const isPlayerFleet = pFac3 && fleet.factionId === pFac3.id;
            fleet.units = fleet.units.filter((u: any) => {
                if (u.hp <= 0) {
                    if (isPlayerFleet) {
                        this.battleLosses.ships += 1;
                        // P3 抚恤金：按舰种船员×PENSION_RATE 估算（v3 经济体系）
                        const cls = u.classType || '';
                        const crew = cls === '战列' ? 3000 : cls === '巡洋' ? 1000 : cls === '驱逐' ? 500 : cls === '突击' ? 5000 : 500;
                        this.battleLosses.pension += crew * 50;
                    }
                    // ── 旗舰沉没叙事：特写 + 提督诀别台词 + 接任播报 ──
                    // filter 顺序遍历，units[0] 被评估时仍是旗舰；units.length > 1 保证还有接任者（否则走下方全灭分支）
                    if (fleet.units[0] === u && fleet.units.length > 1) {
                        // [v33 P1-4.3] 旗舰沉没 → 阵型崩溃触发源（旧案阵型表的「旗舰」列
                        //   = 风险与增益的交换；纺锤/球型旗舰置前换取士气，代价就是这里）。
                        //   标记一旦写入即持久，直到士气回稳（RECOVER_MORALE）才解除崩溃。
                        (fleet as any)._flagshipSunkAt = this.time.now;
                        const sinkFac = this.factionMap.get(fleet.factionId);
                        const sinkName = sinkFac?.name || '舰队';
                        (this.store as any).triggerToast?.(`★ ${sinkName}旗舰被击沉！副舰长接任指挥权。`);
                        // ── 指挥带宽降级：玩家旗舰沉没 → 通信阵列受损，全军频道重置 ──
                        const pFacForBw = this.store.factions.find((f: any) => f.type === 'player');
                        if (this.bwState && pFacForBw && fleet.factionId === pFacForBw.id && this.getCommCenter()?.fleet === fleet) {
                            degradeForFlagshipLoss(this.bwState);
                            this.showBattleBanner('⌁ 通信阵列受损', '旗舰中继天线损毁：指挥半径收缩，全军频道重置', '#ef4444');
                        }
                        if ((this.store as any).addBattleLog) {
                            (this.store as any).addBattleLog({ text: `${sinkName}旗舰被击沉，指挥权移交`, type: 'battle' });
                        }
                        this.showFleetDialogue(fleet, 'defeat', true);
                        // 特写：镜头短暂推近沉没点再拉回
                        try {
                            const preZoom = this.cameras.main.zoom;
                            this.cameras.main.pan(fleet.x, fleet.y, 300, 'Sine.easeInOut');
                            this.cameras.main.setZoom(Math.min(2.0, preZoom * 1.5));
                            this.cameras.main.shake(400, 0.006);
                            this.time.delayedCall(2000, () => {
                                this.cameras.main.setZoom(preZoom);
                            });
                        } catch (e) { /* 镜头动画非关键路径 */ }
                    }
                    u.sprite.destroy(); return false;
                }
                return true;
            });
            
        // 实时同步对话气泡坐标：固定在前端头像框右侧，且抵消镜头缩放保持 UI 级大小
        this.activeDialogues.forEach(b => {
            const target = b.getData('targetShip');
            if (target && target.sprite && target.sprite.active) {
                const cam = this.cameras.main;
                // 设定屏幕空间的固定偏移量：右侧 90px，偏上 40px (对齐浮动头像框)
                const offsetX = 90 / cam.zoom;
                const offsetY = -40 / cam.zoom;
                
                b.x = target.sprite.x + offsetX; 
                b.y = target.sprite.y + offsetY;
                b.setScale(1 / cam.zoom); // 逆向缩放，确保气泡和外部 HTML 的头像框比例一致
            }
        });

            // 后勤舰不构成战斗编制；最后一艘战斗舰沉没即视为该舰队失能，
            // 不要求玩家继续击沉补给运输舰才能结束战斗。
            if (!hasCombatUnits(fleet)) {
                const fac = this.factionMap.get(fleet.factionId);
                if (fac) {
                    // ── 舰队全灭：提督诀别台词（isDefeat=true 固定坐标气泡）──
                    this.showFleetDialogue({ ...fleet, factionId: fleet.factionId, x: fleet.x, y: fleet.y }, 'defeat', true);
                    fac.active = false;
                    // 【待改6】此处不再判定 gameOver——胜负统一由 checkGameEnd 按 team 计算，
                    // 消除"filter 按 team 置 gameOver → checkGameEnd 提前 return → 演习战损率奖励被跳过"的双轨矛盾。
                }
                return false;
            }
            return true;
        });

        // 提督扮演 P0：总指挥舰队覆灭 → 指挥继任（仅指挥制；函数内部自带守卫，hex/crt 零影响）
        this.checkSupremeSuccession();

        // [v33 P1-4.1] 地形持续损伤（机雷 / 杰夫粒子云）——内部自带 3s 节流
        this.applyTerrainDot(delta);

        this.globalFleets.forEach(fleet => {
            const myFac = this.factionMap.get(fleet.factionId);
            if (!myFac || !myFac.active) {
                fleet.units.forEach((u: any) => { u.hp = 0; u.sprite.destroy(); });
                fleet.units = []; return;
            }

            let minFleetDist = 99999; let closestEnemyFleet: any = null;
            // === 阶段B：视野迷雾系统 ===
            // 视野 = 基础200 + 情报值×2 + 电子科技×30（随hexRadius缩放）
            const visionRange = this.getVisionRange(fleet, myFac);
            // 视野内敌人按距离分级：近(<50%视野)=完全可见，中(50-80%)=识别类型，远(80-100%)=模糊
            let visibleEnemies: { ef: any; dist: number; clarity: 'full' | 'partial' | 'fuzzy' }[] = [];
            this.globalFleets.forEach(ef => {
                if (hasCombatUnits(ef)) {
                    const efFac = this.factionMap.get(ef.factionId);
                    if (efFac && efFac.team !== myFac.team && efFac.active) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, ef.x, ef.y);
                        // [v55] 分级收口 aiDirector.visibilityOf（原内联三元判断的单一真源）
                        const clarity = visibilityOf(d, visionRange);
                        if (clarity) {
                            visibleEnemies.push({ ef, dist: d, clarity });
                        }
                    }
                }
            });
            // 只有清晰目标才可锁定为交战对象
            const clearEnemies = visibleEnemies.filter(v => v.clarity !== 'fuzzy');
            clearEnemies.sort((a, b) => a.dist - b.dist);
            if (clearEnemies.length > 0) {
                closestEnemyFleet = clearEnemies[0].ef;
                minFleetDist = clearEnemies[0].dist;
            }

            // [v55 受击必还击] 8s 内攻击过我方的敌舰 = "已暴露攻击者"。即使视野 fuzzy /
            //   正撤退 / 信标任务在身，攻击者位置已暴露 ⇒ 可锁定还击（aiDirector 不变量）。
            //   台账在伤害结算处写入（noteIncomingFire），此处只读。
            const atkId = activeAttacker(fleet, this.time.now);
            let attackerFleet: any = null;
            if (atkId != null) {
                const cand: any = this.globalFleets.find((ef: any) => ef.id === atkId && hasCombatUnits(ef));
                if (cand) {
                    const cf = this.factionMap.get(cand.factionId);
                    if (cf && cf.active && cf.team !== myFac.team) attackerFleet = cand;
                }
            }
            const underFire = attackerFleet !== null;
            const attackerDist = attackerFleet
                ? Phaser.Math.Distance.Between(fleet.x, fleet.y, attackerFleet.x, attackerFleet.y)
                : null;
            // 无清晰目标时攻击者直接顶上为交战对象（被超视距/fuzzy 打击 ⇒ 连目标都锁不上 的修复）
            if (attackerFleet && !closestEnemyFleet) {
                closestEnemyFleet = attackerFleet;
                minFleetDist = attackerDist ?? minFleetDist;
            }

            // 本舰队战斗舰射程画像（排除补给舰——射程 300 不该拉低/抬高还击半径口径）。
            //   数据真源 = u.range（config/gameData.ts），aiDirector 只做聚合，**不手抄舰种名**。
            const shipProfiles = combatUnits(fleet)
                .map((u: any) => ({ range: u.range || 0, atk: u.atk || 0 }));
            // 自卫/拖刀还击半径 = 本舰队最远武器射程（替换 250px 硬编码 ⇒ 敌在 300~880px 不再白嫖）
            const strikeRange = Math.max(250, strikeRangeFrom(shipProfiles));

            // P4a 一骑讨：双方舰队极近距离接触（<95px）→ 名场面镜头+对决台词（冷却30秒/同一对只触发一次）
            if (closestEnemyFleet && minFleetDist < 95 && this.time.now > this.duelCooldown) {
                const pairKey = [Math.min(fleet.id, closestEnemyFleet.id), Math.max(fleet.id, closestEnemyFleet.id)].join('-');
                if (pairKey !== this.lastDuelPair) {
                    this.lastDuelPair = pairKey;
                    this.duelCooldown = this.time.now + 30000;
                    this.cameras.main.shake(300, 0.004);
                    this.showFleetDialogue(fleet, 'engage');
                    this.showFleetDialogue(closestEnemyFleet, 'engage');
                    // 镜头拉近到对决点
                    this.tweens.add({
                        targets: this.cameras.main, zoom: Math.min(2.2, (this.cameras.main.zoom || 1) * 1.4), duration: 400, ease: 'Sine.easeOut',
                        onComplete: () => {
                            this.tweens.add({ targets: this.cameras.main, zoom: 1, duration: 1200, ease: 'Sine.easeInOut' });
                        }
                    });
                }
            }

            // P4b 逆境宣言：舰队血量首次低于25% → 触发逆转宣言（士气爆发特效）
            if (fleet.units.length > 0) {
                let hpSum = 0, hpMax = 0;
                fleet.units.forEach((u: any) => { hpSum += u.hp; hpMax += u.maxHp; });
                const hpPctFleet = hpMax > 0 ? hpSum / hpMax : 0;
                if (hpPctFleet < 0.25 && !this.adversityTriggered.has(fleet.id)) {
                    this.adversityTriggered.add(fleet.id);
                    const advNames: Record<number, string> = { 1: '战局未定，胜负难料！', 2: '牺牲换来的，岂能就此罢休！' };
                    const advText = advNames[fleet.factionId] || '绝境反攻，绝不后退！';
                    this.showFleetDialogue(fleet, 'engage');
                    // 逆转buff：伤害+15% 10秒
                    fleet._adversityBuffUntil = this.time.now + 10000;
                    // 金色爆发光环
                    fleet.units.forEach((u: any) => {
                        if (u.sprite?.active) {
                            const ring = this.add.circle(u.sprite.x, u.sprite.y, 18, 0xfbbf24, 0.3).setDepth(16);
                            this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
                        }
                    });
                    this.cameras.main.shake(250, 0.003);
                }
            }
            // 模糊目标仅作为"可疑目标"记录，不触发交战
            const fuzzyTargets = visibleEnemies.filter(v => v.clarity === 'fuzzy');
            // v6 修复（1v1 僵死）：旧逻辑"索敌中发现可疑目标 → 强制转驻守"与索敌推进互相打架——
            //   接战清晰判定要求距离 < 视野×80%，而双方在视野 80%~100% 区间互判 fuzzy →
            //   双双被摁成驻守 → 原地对峙，玩家每次点"索敌"下一秒又被 AI 打回驻守（用户实报）。
            //   改为：保持索敌姿态，由 exploring 分支的"模糊目标查证"主动接近确认。
             
            let closestEnemyTile: any = null; let minTileDist = 99999;
            this.tilesList.forEach(t => {
                const isValuable = ['castle', 'planet', 'barracks', 'gold_mine', 'tower', 'pier'].includes(t.type);
                if (isValuable && t.ownerId !== 0 && t.type !== 'sea' && t.type !== 'ruined') {
                    const oFac = this.factionMap.get(t.ownerId);
                    if (oFac && oFac.team !== myFac.team && oFac.active) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        let score = d - (t.type === 'castle' ? 800 : 0);
                        if (score < minTileDist) { minTileDist = score; closestEnemyTile = t; }
                     }
                }
            });

            // 塔目标化：查询可攻击的敌方塔（优先于探索目标）
            let closestEnemyTower: any = null; let minTowerDist = 250;
            this.tilesList.forEach(t => {
                if (t.type === 'tower') {
                    const tFac = this.factionMap.get(t.ownerId);
                    if (tFac && tFac.team !== myFac.team) {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        if (d < minTowerDist) { minTowerDist = d; closestEnemyTower = t; }
                    }
                }
            });

            let fleetTargetX = fleet.x; let fleetTargetY = fleet.y;
            let isEngaging = false;
            let isRetreating = false;
            // [FIX-2.1 · #73] 非接战帧清「接战」标记；engaging 分支内再置真 ⇒
            //   仅"脱战→重新接战"会重掷侧翼选边（连同首次 / 目标 id 变化两种情形）。
            if (fleet.state !== 'engaging') (fleet as any)._flankEngaged = false;

            if (fleet.state !== fleet.lastState) {
                if (fleet.state === 'engaging') this.showFleetDialogue(fleet, 'engage');
                else if (fleet.state === 'retreating') this.showFleetDialogue(fleet, 'retreat');
                fleet.lastState = fleet.state;
            }

            // 1. 状态评估：血量与补给度
            let totalHp = 0, totalMaxHp = 0;
            fleet.units.forEach((u: any) => { totalHp += u.hp; totalMaxHp += u.maxHp; });
            const hpPct = totalMaxHp > 0 ? totalHp / totalMaxHp : 0;
            
            if (hpPct < 0.5 && !fleet.halfHpTriggered) {
                fleet.halfHpTriggered = true;
                this.showFleetDialogue(fleet, 'halfHp');
            }

            const currentSupply = this.fleetSupplyPct(fleet);

            // ── v29 撤退判定重构：补给**不再是触发条件** ──
            //   原实现 `currentSupply < 30` 是**与战局无关的硬阈值** ⇒ 交战中补给到点即抛下敌人
            //   以 3 倍速掉头（用户实报"离谱"）；且退出线 80 过高，与"占领完站桩 10–14 秒"同源。
            //   现改为「提督动摇线（个性）+ 士气 + 兵力态势」，分三档（见 game/retreatDoctrine.ts）。
            //   补给的作用移交给战斗力衰减（fleetSupplyFactor）与士气衰减速率（moraleDrainPerTick）。
            const myFacDoc: any = this.factionMap.get(fleet.factionId);
            if (myFacDoc && !myFacDoc._doctrine) {
                myFacDoc._doctrine = resolveAdmiralDoctrine(myFacDoc.admiralTags);
            }
            const doctrine: AdmiralDoctrine = myFacDoc?._doctrine ?? NEUTRAL_DOCTRINE;
            // [v40] 进取度 ∈ [0,1]：从动摇线派生（越低越大胆）。挂在这里 = 全状态都有值。
            const _aggr = aggression(doctrine.retreatThreshold, (NEUTRAL_DOCTRINE as any).retreatThreshold);
            (myFacDoc as any)._aggression = _aggr;
            const moraleNow = fleet.morale === undefined ? 100 : fleet.morale;
            const isManualRetreat = fleet.stance === 'fallback';
            const wantTier = resolveRetreatTier({
                morale: moraleNow, hpPct, threshold: doctrine.retreatThreshold, manual: isManualRetreat,
            });
            if (fleet.state !== 'retreating' && wantTier !== 'none') {
                fleet.state = 'retreating';
                // 脱离时间起点：速度从常规值**平滑升到**该档（溃散除外）——"缓慢撤退"由此而来，
                //   交战中不再允许一帧掉头。
                if ((fleet as any)._retreatEnteredAt === undefined) (fleet as any)._retreatEnteredAt = this.time.now;
            } else if (fleet.state === 'retreating' && !isManualRetreat
                       && moraleNow >= RALLY_MORALE && hpPct >= doctrine.retreatThreshold) {
                // 退出条件：**士气回稳 + 兵力回到动摇线以上**（原为纯补给 > 80 —— 停船过久、归队过晚的主因）
                fleet.state = 'exploring';
                // R10-A1/B5：早退通道必须一并清重组标记——否则 `_regrouping` 残留为 true，
                //   该舰队下次进入撤退时撤退分支的 `!_regrouping`（曾用）会永久关闭还击（状态泄漏）。
                fleet._regrouping = false;
                (fleet as any)._retreatEnteredAt = undefined;
            }
            // 当前撤退档位（供速度 / 火力乘区读取）。非撤退态恒为 'none'。
            //   兼容：撤退态但本帧 wantTier 为 none（例如刚被手动置入）→ 取 'withdraw' 兜底。
            (fleet as any)._retreatTier = fleet.state === 'retreating'
                ? (wantTier === 'none' ? 'withdraw' : wantTier) as RetreatTier
                : 'none' as RetreatTier;

            // ── [v33 P0-2] 距离带（**舰队级**，含滞回）────────────────────────
            //   为什么是舰队级而不是单位级：列位由几何决定（前列 ⟺ gx 最大 ⟺ 离敌最近），
            //   若 band 也由单位自身距离决定，两维被构造性地绑死（前列必 near、后列必 far）
            //   ⇒ 矩阵两端全部命中最高值 ⇒ 退化成常数。舰队级 band 与之正交，矩阵语义变为
            //   「当前接敌距离下哪一列在吃红利」，玩家的选择是"用什么阵型去接这个距离的仗"。
            //   滞回在 nextRangeBand 内（单阈值会让伤害数字逐帧跳变）。
            const bandNow: RangeBand = nextRangeBand(
                minFleetDist, this.getIdealEngageDist(fleet),
                (fleet as any)._rangeBand as RangeBand | undefined,
            );
            (fleet as any)._rangeBand = bandNow;

            // ── [v33 P1-4.3] 阵型崩溃状态（旧案阵型表的「崩溃」行 = 火力/回避/机动 −50%）──
            //   概念澄清：旧案把「崩溃」列在**阵型表**里是"当前状态"视角（同表「无阵」亦然），
            //   故实现为**状态**而非可选阵型。定位 = 士气链的中间档：
            //     士气<40 且 兵力<60% → 崩溃（还能打但打不动）→ 士气<25 撤离 → 士气<1 溃散。
            //   恢复门槛（70）远高于进入门槛（40）是**故意的强滞回**：否则士气在 40 附近抖动
            //   会让乘区逐帧翻转（"忽强忽弱"）。
            const colResist = this.skillModsOf(fleet).collapseResist;
            const colResult = updateFormationCollapse(
                (fleet as any)._formationCollapsed === true,
                {
                    morale: moraleNow,
                    hpPct,
                    flagshipSunkAt: (fleet as any)._flagshipSunkAt,
                    retreatTier: (fleet as any)._retreatTier as RetreatTier,
                    resist: colResist,
                },
            );
            // 状态跃迁时给一次战报（避免每帧刷屏）
            if (colResult.collapsed !== ((fleet as any)._formationCollapsed === true)) {
                if (colResult.collapsed) {
                    (this.store as any).addBattleLog?.({
                        text: `${myFacDoc?.name || '舰队'}阵型崩溃（${COLLAPSE_REASON_TEXT[colResult.reason || 'morale']}）：火力与机动大幅下降`,
                        type: 'battle',
                    });
                } else {
                    (this.store as any).addBattleLog?.({ text: `${myFacDoc?.name || '舰队'}重整阵型，恢复战力`, type: 'battle' });
                }
            }
            (fleet as any)._formationCollapsed = colResult.collapsed;
            (fleet as any)._collapseReason = colResult.reason;
            const colMul = collapseMuls(colResult.collapsed);

            // 确定当前优先级状态 — 带威胁评估 + 塔攻击
            // v2 修复：engaging 但目标消失（守军被灭/基地易主）→ 强制转 exploring 重新评估，杜绝死锁
            if (fleet.state === 'engaging' && !closestEnemyFleet && !closestEnemyTower && !fleet.targetFlare) {
                fleet.state = 'exploring';
                if (!this.isStanceLocked(fleet)) fleet.stance = 'search'; // [V18-B · B2] L3 常规写前检查 L1 锁
            }
            // R10-A1/D1(b)②：信标不得覆盖撤退——断粮自动撤退（supply<30）/ 手动撤退的优先级
            //   高于信标。`state==='retreating'` 已涵盖这两种进入（见 :3670）；补给恢复到 >80
            //   退出撤退后，若信标仍有效，则下一帧自动恢复执行该信标。
            if (fleet.targetFlare && !isManualRetreat && fleet.state !== 'retreating') {
                fleet.state = 'flaring';
            } else if (fleet.state !== 'retreating') {
                // v5 超视距化：接战门槛 250/300 → 900/1000（银英设定，交战在视距外展开）
                const engageDist = fleet.stance === 'siege' ? 1000 : 900;
                // v2 修复：塔攻击不再限制 hpPct>0.4（残血也必须拆塔/反击，否则原地被点死）
                const shouldAttackTower = closestEnemyTower && minTowerDist < 400
                    && (!closestEnemyFleet || minFleetDist > 500);
                // v2 新增：残血(<30%)且无近敌 → 优先撤退保命，不硬拼
                const isCriticalLowHp = hpPct < 0.3 && !closestEnemyFleet && !shouldAttackTower;
                if (isCriticalLowHp && fleet.state !== 'retreating') {
                    fleet.state = 'retreating';
                    fleet.stance = 'fallback';
                }
                if (closestEnemyFleet && minFleetDist < engageDist) {
                    // === 阶段C：聚焦火力 — 多目标时优先补刀残血/威胁最大 ---
                    // 从visibleEnemies中选择最优目标（不只看最近的）
                    // [v55] 目标选择统一走 aiDirector.pickTarget（评分 + 滞回 + 复仇加权）。
                    //   候选 = 清晰目标（fuzzy 识别不了不能锁定）**+ 攻击者**（被它打了=位置已暴露，
                    //   即使 fuzzy 也可还击——「受击必还击」目标侧）。评分公式与整合前逐项一致，
                    //   仅新增 attacker 加权（30000）：谁打我我打谁，但低于任务指定目标（100000）。
                    const prevTargetId = (fleet as any)._lastTargetFleetId;
                    const candById = new Map<string | number, any>();
                    const cands: TargetCandidate[] = [];
                    const pushCand = (ef: any, dist: number, isAttacker: boolean) => {
                        if (candById.has(ef.id)) return;
                        candById.set(ef.id, ef);
                        const ePower = this.calculateFleetPower(ef);
                        const eHpPct = ef.units.reduce((s: number, u: any) => s + u.hp, 0) / Math.max(1, ef.units.reduce((s: number, u: any) => s + u.maxHp, 0));
                        cands.push({
                            id: ef.id, hpPct: eHpPct, dist, power: ePower,
                            missionPriority: !!(fleet.mission?.type === 'attack_fleet'
                                && (ef.id === fleet.mission.targetId || ef.factionId === fleet.mission.targetId)),
                            attacker: isAttacker,
                        });
                    };
                    clearEnemies.forEach(ve => pushCand(ve.ef, ve.dist, ve.ef.id === atkId));
                    if (attackerFleet && !candById.has(attackerFleet.id)) {
                        pushCand(attackerFleet, attackerDist ?? minFleetDist, true);
                    }
                    const pick = pickTarget(cands, prevTargetId);
                    const pickedEf = pick.target ? candById.get(pick.target.id) : null;
                    if (pickedEf) {
                        closestEnemyFleet = pickedEf;
                        minFleetDist = Phaser.Math.Distance.Between(fleet.x, fleet.y, closestEnemyFleet.x, closestEnemyFleet.y);
                        if (!pick.keptPrev) (fleet as any)._lastTargetFleetId = closestEnemyFleet.id;
                    }

                    // 威胁评估：战斗力和血量的比较加权
                    const myPower = this.calculateFleetPower(fleet);
                    const enemyPower = this.calculateFleetPower(closestEnemyFleet);
                    const powerRatio = enemyPower > 0 ? myPower / enemyPower : 999;

                    // 协调：统计已有几支友军盯上了这个敌人
                    let alliesOnTarget = 0;
                    this.globalFleets.forEach(af => {
                        if (af.factionId !== fleet.factionId) {
                            const afFac = this.factionMap.get(af.factionId);
                            if (afFac && afFac.team === myFac.team && af._lastTargetFleetId === closestEnemyFleet.id) {
                                alliesOnTarget++;
                            }
                        }
                    });

                    // === 阶段C：避免过饱和 — 最多2支舰队打同一目标 ===
                    // v2 修复（不接战）：原门槛 powerRatio>0.8 过严，均势对进时双方同时判"打不过"
                    //   → 双双转 exploring 拉开 → 永远打不起来（用户实报：都这么近了就是不打）。
                    //   补给低于 30 会掉士气，士气低又进一步压 canEngage → 死循环。
                    //   现在只要不是压倒性劣势（ratio>0.4）或极度残血就交战；会战就是要打起来。
                    const supplyStarved = currentSupply < 15;   // 只有真正断粮才拒战
                    // v6.5：战略层避战窗（AI 战略评估判劣势时写 _avoidUntil）——窗内拒战但不改姿态，
                    //   由 engaging 距离保持逻辑自动拉开，杜绝 stance fallback↔search 高频互切
                    const avoiding = ((fleet._avoidUntil as number | undefined) ?? 0) > this.time.now;
                    const canEngage = !supplyStarved && !avoiding && (
                        powerRatio > 0.4 ||
                        (alliesOnTarget === 0 && hpPct > 0.4) ||
                        hpPct > 0.7
                    );

                    if (canEngage) {
                        fleet.state = 'engaging';
                        fleet._lastTargetFleetId = closestEnemyFleet.id;
                        // [v55] 阵型统一走 aiDirector.chooseFormation（原两张互相矛盾的表已收口；
                        //   此处与交战机动处调用同一函数 ⇒ 不再互相覆盖）。最终口径 = 原 :5072 生效表。
                        const formationCommit = stabilizeCombatFormation({
                            active: true,
                            targetId: closestEnemyFleet.id,
                            existingFormation: (fleet.formation || 'wedge') as any,
                            candidate: chooseFormation({
                            alliesOnTarget,
                            powerRatio,
                            // 高统帅只改变执行质量；绕侧必须由战法明确授权，不能擅自偏离正面战线。
                            aggressive: shouldFlank({ commanderAggressive: (myFac.admiralStats?.command || 50) > 80, maneuverRole: (fleet as any)._maneuverRole }),
                            avoiding,
                            }),
                            previous: (fleet as any)._combatFormation,
                            emergency: avoiding,
                        });
                        (fleet as any)._combatFormation = formationCommit.state;
                        fleet.formation = formationCommit.formation;
                    } else {
                        // 打不过或目标已饱和，保持距离或撤退
                        // v2：劣势方也保持 engaging（距离保持逻辑会自动拉开到理想交战距），
                        //   只有压倒性劣势才退避 —— 原来直接转 exploring 会导致双方对峙不开火
                        // v6.5：避战窗内同样保持 engaging+spindle（拉开距离对峙），不再写 fallback
                        fleet.state = 'engaging';
                        const formationCommit = stabilizeCombatFormation({
                            active: true, targetId: closestEnemyFleet.id,
                            existingFormation: (fleet.formation || 'wedge') as any,
                            candidate: 'spindle', previous: (fleet as any)._combatFormation,
                            emergency: avoiding,
                        });
                        (fleet as any)._combatFormation = formationCommit.state;
                        fleet.formation = formationCommit.formation;
                        if (!avoiding && myPower < enemyPower * 0.3) {
                            // 仅压倒性劣势（非战略层犹豫）才真撤——这是硬条件，与手动/断粮同级
                            fleet.stance = 'fallback';
                            fleet.state = 'exploring';
                        }
                    }
                } else if (shouldAttackTower) {
                    // === 塔攻击模式 ===
                    fleet.state = 'engaging';
                    fleet._lastTargetFleetId = null;
                    fleetTargetX = closestEnemyTower.x;
                    fleetTargetY = closestEnemyTower.y;
                    fleet.formation = 'wedge'; // 突击阵型
                } else {
                    fleet.state = 'exploring';
                }
            }

            // 2. 根据状态设定战术目标坐标
            if (fleet.state === 'flaring' && fleet.targetFlare) {
                fleetTargetX = fleet.targetFlare.x; fleetTargetY = fleet.targetFlare.y;
                // R10-A1/D1(b)①：信标转进**允许途中自卫**——途中有敌进入接战距离即置 isEngaging，
                //   由开火门（:4310）还击；但位移目标仍是信标（不做追击，仅保持航向）。
                //   速度模式已在 :4165 对 flaring 豁免，故"边打边走"不会被缠斗减速卡住。
                if (closestEnemyFleet && minFleetDist < strikeRange) isEngaging = true; // [v55] 250→真射程：受击/近敌在武器射程内即还击
                if (Phaser.Math.Distance.Between(fleet.x, fleet.y, fleetTargetX, fleetTargetY) < 40) {
                    const flareRealY = fleetTargetY;
                    const fQ = Math.round((Math.sqrt(3)/3 * fleetTargetX - 1/3 * flareRealY) / this.hexRadius);
                    const fR = Math.round((2/3 * flareRealY) / this.hexRadius);
                    const tileAtFlare = this.tilesDict[`${fQ},${fR}`];
                    const isUncapturedPlanet = tileAtFlare && (tileAtFlare.type === 'planet' || tileAtFlare.type === 'relay') && tileAtFlare.ownerId !== fleet.factionId;
                    const isEnemyTile = tileAtFlare && tileAtFlare.ownerId !== 0 && tileAtFlare.ownerId !== fleet.factionId
                        && this.factionMap.get(tileAtFlare.ownerId)?.team !== this.factionMap.get(fleet.factionId)?.team;

                    // 敌方地块上：信标保持，舰队停留等待占领
                    if (isEnemyTile) {
                        fleetTargetX = fleet.x;
                        fleetTargetY = fleet.y;
                    } else if (!isUncapturedPlanet) {
                        fleet.targetFlare = null;
                        fleet.state = 'exploring';
                        if (this.playerFlare) { this.playerFlare.destroy(); this.playerFlare = null; }
                    }
                }
            } else if (fleet.state === 'retreating') {
                isRetreating = true;
                // === 阶段C：撤退重组 — 到达补给点后等待恢复 ===
                // v2 修复（指挥制卡死）：原逻辑在 tilesList 里找 barracks/己方连通 tile，
                //   但指挥制无铺地、tile.connected 恒 false、castle tile 坐标≠castlePos(±1500)
                //   → nearestSupply=null 走 castlePos 兜底或干脆停在错误坐标，
                //   且圈外补给只掉不涨 → currentSupply>60 永不满足 → 永久停驻。
                // 改为：指挥制下用空间补给源（castlePos + 己方星球，与 SupplyChainSystem 同源）；
                //   重组完成条件放宽为"进入补给圈（chainInfo.inSupply）"——补给恢复交给运输舰。
                let nearestSupply: any = null;
                let minDistToSupply = Infinity;
                // 空间补给源：己方司令部 + 己方占领星球（与 getNearestSupplySource 同源）
                this.store.factions.forEach((f: any) => {
                    const tf = this.factionMap.get(f.id);
                    if (!tf || tf.team !== myFac.team || !f.castlePos) return;
                    const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, f.castlePos.x, f.castlePos.y);
                    if (d < minDistToSupply) { minDistToSupply = d; nearestSupply = { x: f.castlePos.x, y: f.castlePos.y }; }
                });
                this.tilesList.forEach((t: any) => {
                    if ((t.type !== 'planet' && t.type !== 'relay') || t.ownerId !== myFac.id) return;
                    const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                    if (d < minDistToSupply) { minDistToSupply = d; nearestSupply = { x: t.x, y: t.y }; }
                });
                // v4 修复（越过运输舰）：撤退目标优先级改为——
                //   ① 若补给链已接通（inSupply，含运输舰覆盖）→ 原地停船接受补给，不再奔向补给源；
                //   ② 否则找最近补给点；若无 → castlePos 兜底。
                //   原逻辑：目标恒为补给源坐标 → 撤退舰队（速度 0.9）与运输舰（速度 0.34）相向而行
                //   直接互相穿过；即使被运输舰追上补满，重组判定也只在"距补给点<60"时触发。
                // v6.1 修复（用户实报：杨威利补给尚可仍飞回家）：① 的判定过严——
                //   `via==='aux' || dist<=SUPPLY_BASE_RADIUS` 在"星球补给圈内但超 BASE 半径"的
                //   环带区不成立，舰队坚持飞母港，运输船白追。改为：只要 chainInfo.inSupply
                //   （补给源圈 420 内，或运输舰正在补给）就原地停船等补给，补给恢复后自动重返战场。
                const ci4 = this.supplyInfo.get(fleet);
                const supplyChainLive = !!(ci4 && ci4.inSupply);
                // R10-A1/B1（落地 章程_20260905 §4.1「运输舰 > 中继 > 基地」优先级）：
                //   若已有运输舰被指派前来补给本舰队（正在赶来/覆盖），则**向运输舰会合**，
                //   而不是直线飞向远基地。原实现撤退目标只在"原地/最近补给源/司令部"间选，
                //   从不参考运输舰 → 已拍板的后勤优先级在实现中缺失。
                const inboundAux: any = this.auxShips.find((a: any) =>
                    a.targetFleet === fleet && (a.state === 'outbound' || a.state === 'supplying')
                    && a.unit && a.unit.hp > 0);
                // [v41] 近处有船 ⇒ **原地停船等**（不掉头去会合）；远时才保留双向会合。
                //   用户实报：船就在后面不远处，舰队却掉头迎接，补给满后又掉回来 = 两次丑陋机动。
                const nearAux: any = inboundAux
                    && Math.hypot(inboundAux.x - fleet.x, inboundAux.y - fleet.y) < 8 * this.hexRadius ? inboundAux : null;
                // [v55] 挨打不停船：受击且攻击者在射程内 ⇒ 停船等补给改为"边补给边滑开"，
                //   否则 _regrouping 原地驻留 = 固定靶（"被动挨打"根因③）。滑开目标逐帧重算，
                //   只做位移、不改撤退态、不追击（与 R10-A1/B8「自卫开火但不追击」同口径）。
                const kiteVec = (underFire && attackerFleet && attackerDist != null && attackerDist <= strikeRange)
                    ? (() => { const a = Math.atan2(fleet.y - attackerFleet.y, fleet.x - attackerFleet.x); return { x: fleet.x + Math.cos(a) * 140, y: fleet.y + Math.sin(a) * 140 }; })()
                    : null;
                if (supplyChainLive && currentSupply < 90) {
                    // v6.1：补给圈内（含运输舰覆盖）→ 停船就地补给（补给速度 AUX_SUPPLY_RATE 远大于流失率）
                    if (kiteVec) {
                        fleet._regrouping = false;
                        fleetTargetX = kiteVec.x; fleetTargetY = kiteVec.y;
                    } else {
                        fleet._regrouping = true;
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                    }
                    const regroupDone = currentSupply > 80;
                    if (regroupDone) {
                        fleet._regrouping = false;
                        fleet.state = 'exploring';
                        if (!this.isStanceLocked(fleet)) fleet.stance = 'search'; // [V18-B · B2] L3 常规写前检查 L1 锁
                    }
                } else if (nearAux) {
                    // [v41] 双向会合（**仅当船还远**）：舰队转向运输舰，缩短断粮暴露时间。
                    //   船已在附近时走 S0-船近停等（决策层），寻路侧配合 = 不进本分支，原地停船。
                    if (kiteVec) {
                        fleet._regrouping = false;
                        fleetTargetX = kiteVec.x; fleetTargetY = kiteVec.y;
                    } else {
                        fleet._regrouping = true;
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                    }
                } else if (nearestSupply && !supplyChainLive) {
                    fleetTargetX = nearestSupply.x; fleetTargetY = nearestSupply.y;
                    // 已到达补给点 → 标记重组状态，等待恢复
                    if (Phaser.Math.Distance.Between(fleet.x, fleet.y, fleetTargetX, fleetTargetY) < 60) {
                        fleet._regrouping = true;
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y; // 停留恢复
                        // 重组完成 = 补给链已接通（inSupply：靠运输舰/星球回补）
                        const regroupDone = (() => { const ci = this.supplyInfo.get(fleet); return !!(ci && ci.inSupply); })();
                        if (regroupDone) {
                            fleet._regrouping = false;
                            fleet.state = 'exploring';
                            if (!this.isStanceLocked(fleet)) fleet.stance = 'search'; // [V18-B · B2] L3 常规写前检查 L1 锁
                        }
                    }
                } else {
                    fleetTargetX = myFac.castlePos.x; fleetTargetY = myFac.castlePos.y;
                }
                // 撤退中若敌军在射程内，标记接敌以触发拖刀开火。
                // R10-A1/B8：去掉 `!_regrouping` —— 重组驻留期不得"站着挨打"。isEngaging 只影响
                //   开火门/朝向，不改位移目标（重组时目标=自身，不会追击），故重组中"自卫开火但不追击"。
                // [v55] 250px 硬编码是"被动挨打"主病灶（武器射程 560~880 ⇒ 300~880px 内被白嫖）：
                //   现还击半径 = 本舰队最远武器射程；攻击者即使 fuzzy 也已在上方注入 closestEnemyFleet。
                isEngaging = !!(closestEnemyFleet && minFleetDist < strikeRange);
            } else if (fleet.state === 'engaging' && closestEnemyFleet) {
                isEngaging = true;
                // ===== [v32] **战法优先于姿态**：分舰队的角色决定机动方式 =====
                //   修的是用户实报"AI 都是直线突击、没有迂回/包抄/后勤战"的**最终执行层原因**：
                //   旧实现里 ① `stance === 'siege'` 一律"直奔敌军坐标"、② 非 siege 时只有
                //   `cmdStat > 80` 才走包抄分支 ⇒ 无论 L2 算出什么战法，执行层都是**直线冲**。
                //   根因 = `_maneuverRole` / `_maneuverTargetKind` **全项目零消费**
                //   （此前只有 `_maneuverLateral` 被当作选边符号，见下方 `flankAngle`）。
                const mRole = (fleet as any)._maneuverRole as string | undefined;
                const mKind = (fleet as any)._maneuverTargetKind as string | undefined;
                /** 迂回授权：被战法指定为左右翼 ⇒ 强制走弧线绕向敌军侧后（不再取决于提督属性） */
                const wantsFlank = shouldFlank({
                    commanderAggressive: (myFac.admiralStats?.command || 50) > 80,
                    maneuverRole: mRole,
                });
                /** 后勤猎杀：本路目标 = 敌方补给节点（运输舰 > 敌方补给点） */
                const raidTarget = mKind === 'enemy_supply' ? this.findEnemySupplyTarget(fleet, myFac) : null;

                if (raidTarget) {
                    // 断敌后路优先于咬主力（银英式后勤战）：直奔敌方补给节点，不纠缠敌方主力
                    fleetTargetX = raidTarget.x; fleetTargetY = raidTarget.y;
                    fleet.formation = 'spindle';
                } else if (fleet.stance === 'defend') {
                    fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                } else if (fleet.stance === 'siege' && !wantsFlank) {
                    fleetTargetX = closestEnemyFleet.x; fleetTargetY = closestEnemyFleet.y;
                } else {
                    // === 阶段C：战术AI重构 ===
                    const myPower = this.calculateFleetPower(fleet);
                    const enemyPower = this.calculateFleetPower(closestEnemyFleet);
                    const powerRatio = enemyPower > 0 ? myPower / enemyPower : 999;

                    // --- 1. 距离保持：按舰种确定理想交战距离 ---
                    const idealDist = this.getIdealEngageDist(fleet);

                    // --- 2. 包抄行为：计算敌方朝向，尝试侧后接近 ---
                    // [v46-G 已回退] 曾试过对敌方朝向做一阶低通（τ≈10 帧）以压掉它的帧间跳变，
                    //   但实测**反而使 `facingAngle` 方向翻转从 0 次升到 4 次**（`_probe_v45` 同一受控输入）：
                    //   低通让 `angleDiff` 滞后于「翼侧角锁定」所依据的原始朝向，二者时序错配 ⇒ 相位在
                    //   错误时刻切换 ⇒ 制造出方向相反的两次重定向（来回摆）。**耦合不能靠"改变相位"来断，
                    //   只能靠"锁死不跟随"来断**（见 v46-A）。故此处保持直接取值。
                    const enemyAngle = closestEnemyFleet.facingAngle || 0;
                    const enemyAngleRaw = enemyAngle;   // 翼侧角锁定与 angleDiff 同一真源
                    // 从敌人背后45°方向接近 = 侧翼包抄
                    // [FIX-2.1 · #73] 锁侧翼选边：原每帧 Math.random() 选 ±45° ⇒ 目标方向逐帧在 ±66° 间
                    //   翻相，而限速航向只有 1.5°/帧 追不上 ⇒ 左右摆（取证 §2.1-(i)）。评分/算式不变，
                    //   仅把选边持久化：三种情形重掷 —— ①首次(undefined) ②目标舰队 id 变化 ③脱战→重新接战。
                    if ((fleet as any)._flankSign === undefined
                        || (fleet as any)._flankTargetId !== closestEnemyFleet.id
                        || (fleet as any)._flankEngaged !== true) {
                        // [v31-C] **战法优先于随机**：分舰队若已被战法指定侧翼（left=-1 / right=+1），
                        //   就用它取代 `Math.random()` 选边 —— 这样"两翼包抄"才是真的左右夹击，
                        //   而不是两队各自随机绕圈（同时修掉 `v17_01` 登记的「包抄左右随机、看不出意图」）。
                        const _forcedSide = (fleet as any)._maneuverLateral;
                        (fleet as any)._flankSign = (_forcedSide === -1 || _forcedSide === 1)
                            ? _forcedSide
                            : (Math.random() > 0.5 ? 1 : -1);
                        (fleet as any)._flankTargetId = closestEnemyFleet.id;
                        // [v46] 与 `_flankSign` **同生命周期**初始化「翼侧角锁定」与两个相位状态
                        //   （换目标 / 脱战重接战才重置 —— 与选边语义完全一致，不需要额外标记位）
                        (fleet as any)._flankAngleLock = enemyAngleRaw + Math.PI + (fleet as any)._flankSign * Math.PI / 4;
                        (fleet as any)._flankPhase = 0;
                        (fleet as any)._mPhase = 0;
                        // [v47·P1] _mPhase 与 flank 组**同生命周期**清零：它只在通用 search 分支更新，
                        //   换目标/脱战重接战若不清 → 陈旧 2 会误武装 _backing（攻坚直冲变 55% 倒退速）。
                    }
                    (fleet as any)._flankEngaged = true;
                    // [v46-A] **翼侧角锁定** —— 打断「我方意图 ← 敌方舰首」这条正反馈：
                    //   原式 `flankAngle = enemyAngle + π ± π/4` **每帧**吃敌方舰首朝向 ⇒ 敌方一转身，
                    //   我方的包抄目标点就绕敌旋转；而敌方同样吃我方朝向 ⇒ 双方互为输入。
                    //   `_probe_v45` 受控输入（敌绕圈）实测：目标点单帧跳 1377~1525px、`facingAngle`
                    //   反向 147~165° ⇒ 舰队现场掉头 = 用户实报的「摇头晃脑、边晃边前进」。
                    const flankAngle = (fleet as any)._flankAngleLock as number;
                    const approachAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                    // 夹角越小越接近正面，夹角越大越接近侧后
                    const angleDiff = Math.abs(Math.atan2(Math.sin(approachAngle - enemyAngle), Math.cos(approachAngle - enemyAngle)));
                    // [v46-B] **侧后相位滞回**（双阈值）：原单阈值 `angleDiff > 0.6π` 在阈值附近逐帧
                    //   翻面，而 `isBehind` 一变目标点就跳到敌人另一侧 ⇒ 与 v46-A 同源的另一半振荡。
                    //   相位 0=正面 / 1=侧翼 / 2=侧后；**进入用严阈值、退出用松阈值** ⇒ 阈值处不再抖动。
                    {
                        const _php = ((fleet as any)._flankPhase as number) ?? 0;
                        let _phn = _php;
                        if (_php === 0) { if (angleDiff > Math.PI * 0.30) _phn = 1; }
                        else if (_php === 1) {
                            if (angleDiff > Math.PI * 0.62) _phn = 2;
                            else if (angleDiff < Math.PI * 0.25) _phn = 0;
                        } else { if (angleDiff < Math.PI * 0.55) _phn = 1; }
                        (fleet as any)._flankPhase = _phn;
                    }
                    const _ph = (fleet as any)._flankPhase as number;
                    const isBehind = _ph === 2;      // 在敌人侧后方
                    const isFlanking = _ph === 1;    // 侧翼
                    // [v46-C] **接敌机动相位**（双阈值滞回）—— 修「mfd 在阈值附近穿越 ⇒ 意图反复翻面」：
                    //   `_probe_v45` 实测 `mfd/idealDist ∈ [0.33, 0.37]` **恰好横跨 0.35 阈值** ⇒ 目标点在
                    //   「拉开点（自身后方 0.5×idealDist）」与「包抄点（敌后方 idealDist）」之间反复跳
                    //   （相距 1400+px），`facingAngle` 因此反向 147~165° ⇒ 舰队现场掉头。
                    //   相位 2=拉开 / 1=缠斗保持 / 0=接近；进入严、退出松 ⇒ 只在**质变**时才切换。
                    {
                        let _mp = ((fleet as any)._mPhase as number) ?? 0;
                        const dIn = idealDist * 0.35, dOut = idealDist * 0.50;   // 拉开 ↔ 缠斗
                        const eIn = idealDist * 0.70, eOut = idealDist * 0.85;   // 缠斗 ↔ 接近
                        // [v48] **追击豁免**：拉开距离只对「对射」有意义。`adiff ≤ 0.3π` = 我在敌后半球
                        //   （敌背对我；撤退中的敌军必然如此），加上敌公开的撤退态 ⇒ 敌正在脱离。
                        //   此时若仍执行"拉开"：mfd<0.35d 进拉开（掉头后退）→ 后退+敌在跑 ⇒ mfd>0.5d
                        //   退出 ⇒ 前进追 ⇒ 又 <0.35d ⇒ 又掉头 —— 「回头-前进-回头」循环
                        //   （`_probe_v47` 钉敌实测：mfd=278 ⇒ 进拉开 ⇒ 目标点跳 1470px ⇒ 掉头，
                        //   拉开态持续 254 帧；用户视频同一现象）。
                        //   且战术上等于把逃跑窗口送给敌人（doctrine S6「敌露背后 ⇒ 追击」打架）。
                        const _foeFleeing = angleDiff <= Math.PI * 0.3 || closestEnemyFleet.state === 'retreating';
                        if (_mp === 2) { if (minFleetDist > dOut || _foeFleeing) _mp = 1; }
                        else if (_mp === 1) { if (minFleetDist < dIn && !_foeFleeing) _mp = 2; else if (minFleetDist > eOut) _mp = 0; }
                        else { if (minFleetDist < dIn && !_foeFleeing) _mp = 2; else if (minFleetDist < eIn) _mp = 1; }
                        (fleet as any)._mPhase = _mp;
                    }
                    const _mPhase = (fleet as any)._mPhase as number;

                    // --- 3. 聚焦火力：优先补刀残血，避免3+打1 ---
                    let alliesOnTarget = 0;
                    this.globalFleets.forEach(af => {
                        if (af.factionId !== fleet.factionId) {
                            const afFac = this.factionMap.get(af.factionId);
                            if (afFac && afFac.team === myFac.team && af._lastTargetFleetId === closestEnemyFleet.id) {
                                alliesOnTarget++;
                            }
                        }
                    });

                    // --- 4. 指挥官影响：统帅决定战术风格 ---
                    const cmdStat = myFac.admiralStats?.command || 50;
                    // 统帅值提升决断与执行，但不再把每名高统帅自动改成侧翼包抄。
                    // 侧翼路线只能由 taskForce 的 left/right 编组明确授予。
                    const isAggressive = wantsFlank;
                    const isCautious = cmdStat < 40;     // 低能指挥官：只会正面冲

                    // 决策：选择攻击位置和方式
                    // v6.8 宇宙战距离口径：脱离缠斗/缠斗保持阈值从 2D 遗留的固定
                    //   60/42px 改为按理想交战距比例推导（0.35/0.5 倍）——
                    //   战列 800 → 脱离 280 / 缠斗下限 400；驱逐 560 → 196/280。
                    //   固定 60px 是"接舷战"距离（用户实报：敌我舰队都贴上了）。
                    if (isCautious && !wantsFlank) {
                        // 低统帅：正面直冲，无战术
                        // [v32] 例外：被战法指定侧翼时不适用——**战法优先于提督属性**
                        fleetTargetX = closestEnemyFleet.x; fleetTargetY = closestEnemyFleet.y;
                        fleet.formation = 'wedge';
                    } else if (_mPhase === 2) {
                        // 极近距离：脱离缠斗，拉开到理想距离
                        //   [v46-C] 判据由瞬时 `minFleetDist < idealDist*0.35` 改为**相位**（双阈值滞回）：
                        //   原式在 mfd 于阈值附近穿越时逐帧改判（实测 mfd/idealDist 在 0.33~0.37 摆动），
                        //   目标点在「自身后方 0.5×idealDist」与「敌后方 idealDist」之间反复跳 = 摇头晃脑。
                        //   ⚠ 远离阈值时相位与瞬时判定**同值** ⇒ 行为逐位不变，只在缺陷区生效。
                        const escapeAngle = Math.atan2(fleet.y - closestEnemyFleet.y, fleet.x - closestEnemyFleet.x);
                        fleetTargetX = fleet.x + Math.cos(escapeAngle) * idealDist * 0.5;
                        fleetTargetY = fleet.y + Math.sin(escapeAngle) * idealDist * 0.5;
                    } else if (_mPhase === 1) {
                        // 已进入缠斗距离：保持当前位置对射，或侧翼机动
                        if ((isAggressive || wantsFlank) && !isBehind) {
                            // 尝试绕到侧后
                            fleetTargetX = closestEnemyFleet.x + Math.cos(flankAngle) * idealDist;
                            fleetTargetY = closestEnemyFleet.y + Math.sin(flankAngle) * idealDist;
                        } else {
                            // 保持当前位置
                            fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                        }
                    } else if ((isAggressive || wantsFlank) && !isBehind && !isFlanking) {
                        // 高统帅+不在侧后 → 尝试包抄
                        // [v32] `wantsFlank` 让**战法指定的左右翼**即使统帅不高也走包抄 ——
                        //   这是"迂回/包抄"真正落到执行层的那一刀。
                        fleetTargetX = closestEnemyFleet.x + Math.cos(flankAngle) * idealDist;
                        fleetTargetY = closestEnemyFleet.y + Math.sin(flankAngle) * idealDist;
                    } else {
                        // 标准接近：从当前角度接近到理想距离
                        fleetTargetX = closestEnemyFleet.x - Math.cos(approachAngle) * idealDist;
                        fleetTargetY = closestEnemyFleet.y - Math.sin(approachAngle) * idealDist;
                    }

                    // [v55] 阵型统一走 aiDirector.chooseFormation（本表口径 = 整合前的最终生效表；
                    //   与状态评估处调用同一函数 ⇒ 两张互相矛盾的表收口为一张判定表，不再互相覆盖）
                    const formationCommit = stabilizeCombatFormation({
                        active: true,
                        targetId: closestEnemyFleet.id,
                        existingFormation: (fleet.formation || 'wedge') as any,
                        candidate: chooseFormation({
                        alliesOnTarget,
                        powerRatio,
                        aggressive: isAggressive || wantsFlank,
                        avoiding: ((fleet._avoidUntil as number | undefined) ?? 0) > this.time.now,
                        }),
                        previous: (fleet as any)._combatFormation,
                        emergency: ((fleet._avoidUntil as number | undefined) ?? 0) > this.time.now,
                    });
                    (fleet as any)._combatFormation = formationCommit.state;
                    fleet.formation = formationCommit.formation;
                }
            }
            
            if (fleet.state === 'exploring') {
                let exploreTarget: any = null;
                let minScore = Infinity;
                
                // 【高阶智能】判断舰队当前的后勤健康度。若补给低于 75%，极度抗拒脱离后勤网深入敌后
                const currentSupply = this.fleetSupplyPct(fleet);
                // [v40] 补给/追击改为**性格×态势的决策表**（原：硬阈值 <75 ⇒ 无个性集体回头）。
                //   规则表见 game/combatDoctrine.ts 的 supplyDecision（S1~S11，台架逐条断言）。
                const _facD: any = this.factionMap.get(fleet.factionId);
                const _docD: any = _facD?._doctrine ?? NEUTRAL_DOCTRINE;
                const _auxOf = (a: any) => a.targetFleet === fleet && (a.state === 'outbound' || a.state === 'supplying') && a.unit && a.unit.hp > 0;
                const _inbound = this.auxShips.some(_auxOf);
                // [v41] 「在附近」与「在途」分开：船已在一两帧路程内（8×hexR）时，
                //   掉头去会合纯属浪费 —— 停下它自己就到了（用户：哪怕停下来都比掉头好）。
                //   距离用 hexR 倍数（hexR 随地图缩放 26~50，不可写绝对像素）。
                const _nearAux = this.auxShips.find((a: any) => _auxOf(a)
                    && Math.hypot(a.x - fleet.x, a.y - fleet.y) < 8 * this.hexRadius);
                let _enemyFlee = false;
                if (closestEnemyFleet) {
                    const _d = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x) - (closestEnemyFleet.facingAngle || 0);
                    _enemyFlee = Math.abs(((_d + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < Math.PI * 0.45;   // 敌舰首与"我来向"夹角 < 81° ⇒ 背对我
                }
                const _myP = this.calculateFleetPower(fleet);
                const _enP = closestEnemyFleet ? this.calculateFleetPower(closestEnemyFleet) : 0;
                const _sup = supplyDecision({
                    supplyPct: currentSupply,
                    inSupplyChain: !!(this.supplyInfo.get(fleet)?.inSupply),
                    supplyShipInbound: _inbound,
                    supplyShipNear: !!_nearAux,
                    enemyTurningAway: _enemyFlee,
                    ourAdvantage: _enP > 0 && _myP / _enP >= 1.15,
                    prevAction: (fleet as any)._supplyAction,
                    aggression: (_facD as any)._aggression ?? 0.5,
                    holdingGround: fleet.stance === 'defend' || fleet.stance === 'siege',
                    engaged: !!(closestEnemyFleet && minFleetDist < strikeRange), // [v55] 250→真射程，与开火门同口径
                });
                (fleet as any)._supplyAction = _sup.action;
                (fleet as any)._supplyRule = _sup.rule;
                // 语义映射：return ⇒ 需要"锚回补给网"；pursue ⇒ 明确解除锚定惩罚；hold ⇒ 维持现状
                const needsTethering = _sup.action === 'return';

                // 【核心重构】战术姿态决定寻路权重
                // 方向性探索：计算敌方阵地方向，偏好朝敌方推进
                const enemyCastles = this.tilesList.filter(t => t.type === 'castle' 
                    && this.factionMap.get(t.ownerId)?.team !== myFac.team);
                const enemyDirX = enemyCastles.length > 0 
                    ? enemyCastles.reduce((s: number, c: any) => s + c.x, 0) / enemyCastles.length 
                    : myFac.castlePos?.x + 500;
                const enemyDirY = enemyCastles.length > 0
                    ? enemyCastles.reduce((s: number, c: any) => s + c.y, 0) / enemyCastles.length
                    : 0;

                // 【v2 目标去重】收集友军已分配的目标（星球/塔/基地），避免多舰队扑同一目标
                const claimedTargets = new Set<string>();
                this.globalFleets.forEach(af => {
                    if (af.factionId !== fleet.factionId) return;
                    const afFac2 = this.factionMap.get(af.factionId);
                    if (!afFac2 || afFac2.team !== myFac.team || af.id === fleet.id) return;
                    if (af._targetTileKey) claimedTargets.add(af._targetTileKey);
                });

                this.tilesList.forEach(t => {
                    const tOwnerFac = t.ownerId !== 0 ? this.factionMap.get(t.ownerId) : undefined;
                    const isAlly = tOwnerFac && tOwnerFac.team === myFac.team;

                    if (!isAlly && t.type !== 'sea' && t.type !== 'ruined') {
                        const d = Phaser.Math.Distance.Between(fleet.x, fleet.y, t.x, t.y);
                        let score = d;

                        // v2 目标去重：已有友军盯上的目标大幅降权（除非是当前唯一的）
                        const tileKey = `${t.q},${t.r}`;
                        if (claimedTargets.has(tileKey)) score += 2500;

                        // 【待改2】探索目标滞回：对上一帧已选目标给承诺加成，只有明显更优才换，
                        //   消除两个近等分目标帧间互换导致的来回摆动（engaging 已有 _lastTargetFleetId 滞回，exploring 此前没有）。
                        if (fleet._lastExploreKey === tileKey) score -= 1500;

                        // 探索奖励：未探索的格子获得大幅分数奖励，驱动AI主动探图
                        if (!t.explored) score -= 3000;

                        // 方向性探索：朝敌方阵地走加分（远离减分）
                        const distToEnemy = Phaser.Math.Distance.Between(t.x, t.y, enemyDirX, enemyDirY);
                        const distFromMe = Phaser.Math.Distance.Between(fleet.x, fleet.y, enemyDirX, enemyDirY);
                        score += (distToEnemy - distFromMe) * 2; // 接近敌人→负分=偏好

                        if (fleet.stance === 'siege') {
                            // 攻坚：星球/中继站和司令部拥有致命吸引力（v5: relay 并入）
                            if (t.type === 'planet' || t.type === 'castle' || t.type === 'relay') score -= 8000;
                            else if (t.type === 'barracks' || t.type === 'tower') score -= 3000;
                            if (t.ownerId !== 0) score -= 1000;
                        } else if (fleet.stance === 'search') {
                            // 索敌：对敌占区更感兴趣，渴望扫荡边缘
                            if (t.ownerId !== 0) score -= 2000; 
                        } else if (fleet.stance === 'defend') {
                            // 驻守：极大惩罚，禁止乱跑
                            score += 10000; 
                        }

                        // 【补给牵引算法】如果粮草下降，严厉惩罚远离己方连通节点的格子
                        if (needsTethering) {
                            let distToOwnSupply = Infinity;
                            for (const dir of this.directions) {
                                const neighbor = this.tilesDict[`${t.q + dir.q},${t.r + dir.r}`];
                                if (neighbor && neighbor.ownerId === myFac.id && neighbor.connected) {
                                    distToOwnSupply = 0; break; 
                                }
                            }
                            // 如果该目标点不与己方补给网接壤，增加巨额惩罚分数，迫使舰队在补给线尽头驻足等待玩家“喂饭”
                            if (distToOwnSupply > 0) score += 5000; 
                        }
                        
                        if (score < minScore) { minScore = score; exploreTarget = t; }
                // [v40] 接近阶段横向分离：让被战法指定了侧翼的队**在接敌前**就走自己的路
                //   （`_maneuverLateral` 原本只在接敌后生效 ⇒ 远距离三路并成一路 = "为分而分"）。
                //   偏移量随距离² 收敛 ⇒ 接敌时已归位，不干扰既有包抄逻辑（`combatDoctrine.approachLateralOffset`）。
                if (exploreTarget && (fleet as any)._maneuverLateral && closestEnemyFleet) {
                    const _dE = Phaser.Math.Distance.Between(fleet.x, fleet.y, closestEnemyFleet.x, closestEnemyFleet.y);
                    const _off = approachLateralOffset((fleet as any)._maneuverLateral, _dE, 900, this.hexRadius * 4.4);
                    if (_off !== 0) {
                        const _ang = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x) + Math.PI / 2;
                        exploreTarget = { x: exploreTarget.x + Math.cos(_ang) * _off, y: exploreTarget.y + Math.sin(_ang) * _off };
                    }
                }
                    }
                });
                // 记录本帧探索目标 key，供下帧滞回判定（待改2）
                fleet._lastExploreKey = exploreTarget ? `${exploreTarget.q},${exploreTarget.r}` : fleet._lastExploreKey;

                if (fleet._missionDest) {
                    // 提督扮演：任务目的地牵引（_missionDest 仅指挥制任务循环写入，hex/crt 恒 null 走原分支）
                    const mdD = Phaser.Math.Distance.Between(fleet.x, fleet.y, fleet._missionDest.x, fleet._missionDest.y);
                    if (mdD > 60) {
                        fleetTargetX = fleet._missionDest.x; fleetTargetY = fleet._missionDest.y;
                    } else {
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y; // 已到位：驻留（hold_point 转 defend 后本就不动）
                    }
                } else if (fleet.stance === 'search' && closestEnemyFleet) {
                    // 索敌模式专属：只要视野里有敌人舰队，立刻放弃铺地，像疯狗一样咬上去
                    fleetTargetX = closestEnemyFleet.x; fleetTargetY = closestEnemyFleet.y;
                } else if (fleet.stance === 'search' && fuzzyTargets.length > 0) {
                    // v6 新增：索敌中只有模糊可疑目标 → 主动接近查证（替代旧版"强制转驻守"，
                    //   旧逻辑导致双方在视野边缘互判模糊 → 双双驻守 → 永远打不起来）
                    const fz = fuzzyTargets[0];
                    fleetTargetX = fz.ef.x; fleetTargetY = fz.ef.y;
                } else if (fleet.stance === 'defend') {
                    // 驻守模式：坚守当前阵地
                    fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                } else if (exploreTarget) {
                    // v2 记录目标归属，供其他友军去重
                    fleet._targetTileKey = `${exploreTarget.q},${exploreTarget.r}`;
                    if (Phaser.Math.Distance.Between(fleet.x, fleet.y, exploreTarget.x, exploreTarget.y) < 25) {
                        fleetTargetX = fleet.x; fleetTargetY = fleet.y;
                    } else {
                        fleetTargetX = exploreTarget.x; fleetTargetY = exploreTarget.y;
                    }
                } else {
                    fleet._targetTileKey = null;
                    fleetTargetX = myFac.castlePos.x; fleetTargetY = myFac.castlePos.y;
                }
            }

            // === 恐慌响应：被看不见的敌人打→必须动 ===
            const hpSinceLastTick = fleet._lastTickHp || totalMaxHp;
            const tookSignificantDmg = hpSinceLastTick - totalHp > totalMaxHp * 0.03;
            if (tookSignificantDmg && !closestEnemyFleet && fleet.state !== 'retreating') {
                const dodgeAngle = Math.atan2(myFac.castlePos.y - fleet.y, myFac.castlePos.x - fleet.x);
                fleetTargetX = fleet.x + Math.cos(dodgeAngle + (Math.random() - 0.5) * 1.5) * 120;
                fleetTargetY = fleet.y + Math.sin(dodgeAngle + (Math.random() - 0.5) * 1.5) * 120;
            }
            fleet._lastTickHp = totalHp;

            const distToTarget = Phaser.Math.Distance.Between(fleet.x, fleet.y, fleetTargetX, fleetTargetY);
            // [v43 取证] **只读调试快照**（零分配：复用同一对象，每帧覆盖字段）。
            //   为什么必须回写：`fleetTargetX/Y` / `minFleetDist` / `isEngaging` / `closestEnemyFleet`
            //   全是 update 内的**局部变量**，L2 探针（`_probe_v43/v44.mjs`）从外部读不到
            //   ⇒ 只能观测到"朝向在抖"，观测不到"为什么抖"（目标点帧间跳？接敌判据翻转？）。
            //   ⚠ 只写不读、不参与任何判定 ⇒ 对行为零影响（可随时删）。
            {
                const d = (fleet as any)._dbg || ((fleet as any)._dbg = {});
                d.tx = fleetTargetX; d.ty = fleetTargetY;
                d.mfd = minFleetDist; d.eng = isEngaging ? 1 : 0;
                d.ef = closestEnemyFleet ? String(closestEnemyFleet.id).slice(0, 8) : null;
                d.nvis = visibleEnemies.length;
                d.st = fleet.state;
                // [v45 取证] 目标选择分支的**输入量**（在写入处直接重算，避免侵入 4868 的分支代码）：
                //   分支条件只由 `idealDist` / `angleDiff` / `isBehind` 三者决定 ⇒ 有了它们 + `tx/ty`
                //   就能**反推**本帧走了哪一支（含"哪一支在阈值上翻面"）。同时记录敌方坐标与敌朝向 ——
                //   `flankAngle = enemyAngle + π ± π/4` 是**吃敌方朝向**的，故必须一并取证。
                d.idl = this.getIdealEngageDist(fleet);
                if (closestEnemyFleet) {
                    const efa = closestEnemyFleet.facingAngle || 0;
                    const ap2 = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                    const ad = Math.abs(Math.atan2(Math.sin(ap2 - efa), Math.cos(ap2 - efa)));
                    d.ex = closestEnemyFleet.x; d.ey = closestEnemyFleet.y; d.efa = efa;
                    d.adiff = ad;
                    d.behind = ad > Math.PI * 0.6 ? 1 : 0;
                    d.flank = (ad > Math.PI * 0.3 && ad <= Math.PI * 0.6) ? 1 : 0;
                } else { d.ex = null; d.ey = null; d.efa = null; d.adiff = null; d.behind = null; d.flank = null; }
            }
            // [v47 BACKING-EXIT] 近距脱离 = **舰首仍朝敌、倒退拉开**（拖刀同款语义），不再"掉头逃跑"：
            //   旧实现 _mPhase=2 把 fAngle 指向身后脱离点 ⇒ 舰队在炮战中现场掉头（用户：还在战斗中
            //   怎么能转？被追击就不该能转向）；现在位移朝脱离点、舰首钉在敌人方向（下方 rawVX 走倒退通道）。
            // [v47·P1 双保险] 附加"真实贴脸"闸：phase 陈旧时一旦敌拉开距离，倒退自动解除，
            //   倒退只存在于"被贴住需要脱开"的真实缠斗距离内（phase2 定义域 <0.5×ideal）。
            const _backing = fleet.state === 'engaging' && (fleet as any)._mPhase === 2
                && !!closestEnemyFleet && !isRetreating && fleet.stance !== 'fallback'
                && minFleetDist < this.getIdealEngageDist(fleet) * 0.6;
            let fAngle = fleet.facingAngle || 0;
            // 移动方向（默认与朝向一致；撤退时分离：移动朝补给点，火炮朝敌军）
            let moveAngle = fAngle;
            
            if (distToTarget > 5) { 
                fAngle = Math.atan2(fleetTargetY - fleet.y, fleetTargetX - fleet.x);
                moveAngle = fAngle;
                // 拖刀战术：撤退时若被追击，火炮朝向敌军但移动方向仍是补给点
                if (isRetreating && isEngaging && closestEnemyFleet) {
                    fAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                    // moveAngle 保持朝向 fleetTarget (已经在 distToTarget>5 分支设置好)
                } else if (_backing && closestEnemyFleet) {
                    // [v47] 脱离相同理：moveAngle 保持朝脱离点（= 背离敌），舰首改回朝敌
                    fAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                }
                fleet.facingAngle = fAngle;
            } else if (isEngaging && closestEnemyFleet) {
                // 已抵达射击位置停船：火炮锁定敌军，移动方向不变
                fAngle = Math.atan2(closestEnemyFleet.y - fleet.y, closestEnemyFleet.x - fleet.x);
                fleet.facingAngle = fAngle;
            }

            // 战术控制器是大机动唯一入口：接战锁定时只能倒退脱离；脱战后才会
            // 依次制动、原地转舰首、重编队、恢复巡航。旧逻辑仍负责小范围索敌和火控。
            const prevContact: ContactState = (fleet as any)._combatContact ?? {
                engaged: false, releaseAfter: 2, secondsSinceContact: 2,
            };
            const contact = updateContact(prevContact, isEngaging, Math.min(delta, 100) / 1000 * dt);
            (fleet as any)._combatContact = contact;
            const prevControl: ManeuverState = (fleet as any)._combatControl ?? { phase: 'cruise', phaseSeconds: 0 };
            const headingError = Math.abs(Math.atan2(
                Math.sin(fAngle - (fleet.facingSmooth ?? fAngle)),
                Math.cos(fAngle - (fleet.facingSmooth ?? fAngle)),
            ));
            // 重编完成必须由实际阵面追到新朝向确认，不能靠固定时间提前放行。
            const previousFormFacing = (fleet as any).formFacing ?? fleet.facingSmooth ?? fAngle;
            const reformed = prevControl.phase === 'reform'
                && headingDistance(previousFormFacing, fleet.facingSmooth ?? fAngle) <= 0.015;
            const control = advanceManeuver(prevControl, {
                engaged: contact.engaged,
                retreatRequested: isRetreating || fleet.stance === 'fallback',
                headingError,
                stopped: Math.hypot(fleet.vx ?? 0, fleet.vy ?? 0) < 0.02,
                reformed,
            }, Math.min(delta, 100) / 1000 * dt);
            const controlOrder = maneuverOrder(control.phase);
            (fleet as any)._combatControl = control;
            (fleet as any)._uturn = controlOrder.rotateInPlace;
            (fleet as any)._uturnJustEnded = prevControl.phase === 'turn' && control.phase === 'reform';

            // [R10-B1] FIX-3 限速航向角：把"本帧瞬时确定的方向"平滑为有限角速度。两个同速率平滑器：
            //   · `fleet.heading`      = 平滑后的**位移航向**（moveAngle）⇒ 驱动位移方向 ⇒ 舰队走弧线，
            //     不再是"位移瞬变 + 舰首慢追"的错位（R1 复盘的"横移"主因）；
            //   · `fleet.facingSmooth` = 平滑后的**舰首朝向**（fAngle，权威语义不变）⇒ 驱动阵位旋转 /
            //     2D 精灵旋转 / 3D 舰首 ⇒ 转向时阵位不再瞬时旋转、单位不再"穿心"（R1 的"缩团"主因）。
            //   常态下 moveAngle === fAngle（:4126-4127）⇒ 两平滑器收敛到同一值（等效单值，舰首必然
            //   对齐位移方向，"横移"归零）；仅「撤退+接敌」拖刀分支二者分离（舰首朝敌 / 位移朝补给）——
            //   该分离是此前"船尾给敌人"实报的修复，硬点 3 要求保留 ⇒ 单值方案无法同时满足，故用双平滑器。
            //   时间基准：与位移同源（位移 = speed * dt 每帧）⇒ 步长 = HEADING_TURN_RATE * dt。
            // [R10-B1-BEGIN]
            const headingStep = HEADING_TURN_RATE * dt;   // 满转率（rad/帧）
            const rateAccel = TURN_RATE_ACCEL * dt;       // 角加速度上限（rad/帧²）
            // [v30] **姿态控制转向**：太空战舰的转身 = 原地姿态调整（RCS），**不是飞机式弧线**。
            //   ⇒ 取消 v29 的"位移航向平滑器 `fleet.heading`"（它必然让舰队中心走弧线 ⇒ 圆阵像"风暴"、
            //     掉头像"沿弧线切换"）；位移方向改回**直接取目标方向**（`moveAngle`）；
            //     转向的"重量"改由**推力对齐衰减**承担（见下方 `thrustFactor`：掉头时速度降到 12%
            //     ⇒ 舰队几乎停在原地缓慢转身，转完再加速）。
            //   `fleet.facingSmooth` 保留（驱动阵位旋转 / 2D 精灵 / 3D 舰首），仍是"缓慢转身"的载体。
            if (typeof fleet.facingSmooth !== 'number') { fleet.facingSmooth = fAngle; fleet.facingRate = 0; }
            if (typeof fleet.facingRate !== 'number') fleet.facingRate = 0;
            // [v29b] 角速度带**惯量**（"压舵 / 收舵"）+ **临界制动律**（防欠阻尼振荡）。
            //   ⚠ 首版（v29）用「比例控制 + 角加速度限制」 = **欠阻尼二阶系统**：接近目标时速率
            //     降不下来 ⇒ 过冲 −13.5° / 角速度符号翻转 7 次 ⇒ 阵位按 facingSmooth 旋转 ⇒
            //     两侧单位交替来回，即用户实报的「两条肩膀在抖动 / 波浪舞」。
            //   现改为：
            //     ① 目标速率 ≤ **制动上限** `sqrt(2·a·|d|)·BRAKE_SAFETY` —— 运动学上"恰好能停住"
            //        的速率 ⇒ 不过冲（取代比例项）；
            //     ② `|d| ≤ 满转率` 时**吸附**到目标并清零速率 —— 杜绝目标附近的极限环
            //        （旧 rateLimitAngle 天然含此步，首版把它弄丢了）。
            //   仿真（`_v29_osc_diag.cjs`）：过冲 0.000° / 翻转 0 次 / 稳态残差 0，且保留惯量。
            {
                // （v30）原 `dH` / `fleet.heading` 平滑块已**移除**：位移方向不再平滑
                //   （平滑位移航向 = 舰队中心走弧线，是"圆阵风暴 / 掉头沿弧线切换"的直接来源）。

                // [v41b] **掉头协议**（原地转身）—— 修「整个阵型绕一个小原点画圈」：
                //   卡点 = 位移方向消费 facingSmooth，而 facingSmooth 以 0.75°/帧 慢转 ⇒
                //   中心航迹是 R=v/ω≈23px 的小圆（v41 的吸附判据用 moveDir（速度方向），
                //   弧线转弯时它与 formFacing 一起慢转、差恒 ≈0 ⇒ 结构性永不触发）。
                //   判据必须用**目标航向差 dGoal = |wrap(fAngle − facingSmooth)|**（不是 moveDir）。
                //   协议：差 > ENTER ⇒ 快档转身 + formFacing 同步 + 推力压死（原地转）。
                // [v47 wheel-and-reform] 掉头协议**触发器**（滞回进/出）。
                //   ⚠ v41b 的「进入帧把 formFacing 吸附到新航向」已**删除** —— 那是"画圆"的真凶：
                //   进入协议的一帧全体格位目标按新朝向**瞬移**，每舰 uDist 跳到数百 px 冲向跳变点，
                //   同时 thrustDir=facingSmooth 还在从旧朝向慢转 ⇒ 合成「整阵绕一个小原点旋转漂移」（用户实报）。
                //   也删除 line/circle/square 豁免（双标：被豁免的阵型继续走弧线画圆）。
                //   阵面重排改由下方 formFacing 三态管理器统一执行：协议期冻结、**退出帧一步阶跃**、
                //   每舰限速直线落位 = "掉头 → 列队重组成新阵型"。
                // `_uturn` 由上方 combatControl 的 turn 阶段写入。不可在这里按单帧
                // 航向差重新判定，否则脱离接触中的舰队会绕过接战锁而重新获得掉头许可。
                const dF = Math.atan2(Math.sin(fAngle - fleet.facingSmooth), Math.cos(fAngle - fleet.facingSmooth));
                if ((fleet as any)._uturn === true) {
                    // 协议期：快档、无惯量、formFacing 同步（阵位/托盘/位移一个真源 ⇒ 整阵绕锚点刚性转）
                    // [v42b] 交战中的转向纪律（恢复 v40 语义，但作用于**舰体速率**而非格位）：
                    //   denied(交战中大角度) ⇒ rateMul 0.06~0.16 ⇒ 不狂转（用户：「还在对战就不能转向」）。
                    //   ⚠ v42 曾把本消费整段删掉 ⇒ 交战中也全速转身 = 用户实报「摇头晃脑/神经病」。
                    const _td = turnDiscipline({
                        // [v46-D] 「交战」改用**真实接敌距离**（与 4844 的 `minFleetDist < 250` 同一口径），
                        //   不再用 `state === 'engaging'`——该状态在 900px 外就已置位 ⇒ 整段接近航路
                        //   （900→250px）都被判成"交战中禁止转向"，转向被压成 0.61°/帧 的蠕动。
                        engaged: minFleetDist < 250,
                        disengaging: fleet.state === 'retreating' || (fleet as any)._mPhase === 2,
                        angleToTurn: Math.abs(dF),
                        aggression: ((this.factionMap.get(fleet.factionId) as any)?._aggression) ?? 0.5,
                    });
                    (fleet as any)._turnDisc = _td;
                    if (_td.mode === 'denied') {
                        // [v46-E] 「还在对战就不能转向」⇒ **保持航向**（清速率、不写朝向）。
                        //   原实现按 `rateMul = 0.06~0.16` 极慢蠕动：转 180° 要 ~5 秒，既没做到"不转"
                        //   （航向仍在持续变），也没做到"转过去"⇒ 最坏的中间态，观感即「摇头晃脑」。
                        //   配合 v46-D 的距离口径，denied 只在真正接舷（<250px）时出现。
                        fleet.facingRate = 0;
                    } else {
                        const uStep = HEADING_TURN_RATE * FACING_TURN.RATE_MUL * _td.rateMul * dt;
                        if (Math.abs(dF) <= uStep) {
                            fleet.facingSmooth = fAngle; fleet.facingRate = 0;
                        } else {
                            fleet.facingSmooth += Math.sign(dF) * uStep;
                            fleet.facingRate = Math.sign(dF) * uStep;
                        }
                    }
                    // [v47] 协议期只快转舰体（facingSmooth）；格位冻结（formFacing 管理器），退出帧一步重排
                } else if (Math.abs(dF) <= headingStep) {
                    fleet.facingSmooth = fAngle; fleet.facingRate = 0;
                } else {
                    const brakeF = Math.sqrt(2 * rateAccel * BRAKE_SAFETY * Math.abs(dF));
                    const wantF = Math.sign(dF) * Math.min(headingStep, brakeF);
                    fleet.facingRate += Math.max(-rateAccel, Math.min(rateAccel, wantF - fleet.facingRate));
                    fleet.facingSmooth += fleet.facingRate;
                }
            }
            // [R10-B1-END]
             
            let repulseX = 0; let repulseY = 0;
            this.globalFleets.forEach(otherFleet => {
                if (fleet.id !== otherFleet.id) {
                    const oFac = this.factionMap.get(otherFleet.factionId);
                    const fDist = Phaser.Math.Distance.Between(fleet.x, fleet.y, otherFleet.x, otherFleet.y);
                    if (oFac && oFac.team === myFac.team) {
                        // 友军间排斥（原 80px 阵型防挤压，保留）
                        if (fDist > 0 && fDist < 80) {
                            const repulseAngle = Math.atan2(fleet.y - otherFleet.y, fleet.x - otherFleet.x);
                            const force = (80 - fDist) * 0.02;
                            repulseX += Math.cos(repulseAngle) * force; repulseY += Math.sin(repulseAngle) * force;
                        }
                    } else if (oFac && fDist > 0 && fDist < 200) {
                        // v6.8 敌我安全距离排斥：舰队≠撞击艇，200px 内互相排斥
                        // （力随距离衰减），杜绝"贴脸接舷"。排斥力略低于追击速度，
                        // 包围合围仍可实现，但不可能叠到同一坐标上。
                        const repulseAngle = Math.atan2(fleet.y - otherFleet.y, fleet.x - otherFleet.x);
                        const force = (200 - fDist) * 0.015;
                        repulseX += Math.cos(repulseAngle) * force; repulseY += Math.sin(repulseAngle) * force;
                    }
                }
            });

            // v29：补给从"二值开关(>30→1.0 / 否则 0.5)"改为**连续衰减**——补给是资源，越少越弱
            //   （40% 以下开始衰减，归零时 0.55），不再是"过线就砍半"的断崖。
            const fleetSupplyFactor = supplyFactor(this.fleetSupplyPct(fleet));
            // 士气衰减 → 机动下降（100→1.0，0→0.7）
            const flMoraleSpd = (fleet.morale === undefined ? 100 : fleet.morale);
            const moraleSpeedMult = 0.7 + 0.3 * (flMoraleSpd / 100);
            const isMeleeStance = isRetreating || fleet.stance === 'siege';
            // 渐变减速：v6.8 阈值随理想交战距缩放（120px 是 2D 接舷口径——
            //  战斗发生在数百 px 射程上，减速圈必须 ≥ 理想交战距的 60% 才合理）
            let congestionSlowdown = 1.0;
            const approachSlowR = Math.max(120, this.getIdealEngageDist(fleet) * 0.6);
            if (closestEnemyFleet && !isMeleeStance && minFleetDist < approachSlowR) {
                congestionSlowdown = 0.3 + 0.7 * Math.min(1, Math.max(0, (minFleetDist - approachSlowR * 0.33) / (approachSlowR * 0.67)));
            }
            // v29：撤退速度按**档位**给（disengage 1.3 / withdraw 2.0 / rout 3.0），并带"脱离时间"
            //   过渡（从 1.0 平滑升到该档）——旧实现的固定 ×3.0 已降级为溃散（rout）专用。
            const retreatTierNow: RetreatTier = (fleet as any)._retreatTier ?? 'none';
            const retreatSpeedBonus = isRetreating
                ? retreatSpeedMulRamped(retreatTierNow,
                    (this.time.now - ((fleet as any)._retreatEnteredAt ?? this.time.now)) / 1000)
                : 1.0;
            // ── 指挥点修正：速度倍率（speed_boost / 黄金狮子咆哮的移速+30%）──
            const cpSpeedMult = this.cpState ? getSpeedMultiplier(this.cpState, fleet.id, fleet.factionId) : 1.0;
            // [v30] **推力对齐衰减**（取代 v29 的 `turnLoad`）：主引擎只能沿舰首方向推进 ⇒
            //   舰首与目标方向的夹角越大，前进越慢（对齐度 = cos(夹角)）。
            //   掉头时对齐度 ≈ −1 ⇒ 航速 = `THRUST_IDLE`(12%) ⇒ **舰队几乎停在原地缓慢转身**。
            //   撤退时**不施加**：拖刀/撤离本就要求保持航速（且拖刀分支舰首朝敌、位移朝补给，天然"不对齐"）。
            const thrustAlign = Math.max(0, Math.cos(moveAngle - (fleet.facingSmooth ?? moveAngle)));
            // [v41b] 掉头协议期：推力压死 ⇒ 航迹弧半径 < 1px = **原地转身**（画圈的位移根源被掐断）
                // [v42b] **交战时不压推力**：协议压推力是为「脱离/巡航掉头时原地转身」；
                //   交战中若压死 ⇒ 全队突然静止 = 用户实报「先缩成一团」（战斗中的舰队不该停）。
            const thrustFactor = (isRetreating || _backing)
                ? 1
                : ((fleet as any)._uturn === true && isEngaging !== true
                    ? FACING_TURN.THRUST
                    : THRUST_IDLE + (1 - THRUST_IDLE) * Math.sqrt(thrustAlign));
            // [v33 P1-4.3] 阵型崩溃 → 机动乘区（旧案「机动 −50%」）。
            //   与撤退速度乘区**叠乘**是期望行为：一支崩溃且正在撤离的舰队应当几乎挪不动。
            const collapseSpeedMul = collapseMuls((fleet as any)._formationCollapsed === true).speed;
            const fleetBaseSpeed = ((FLEET_BASE_SPEED + (myFac.admiralStats?.mobility || 0) * 0.003) * fleetSupplyFactor * moraleSpeedMult) * retreatSpeedBonus * cpSpeedMult * thrustFactor * collapseSpeedMul;

            // 【C3 修复】排斥力限幅：原敌我排斥力可达 ~3.0/帧，远超自身速度(0.05~0.3)，
            // 会把舰队以数倍极速向后/侧向推开 → 倒车、横移、贴脸低频振荡。
            // 限制为不超过自身速度的 60%，仅作"轻微防重叠"，不再主导运动方向。
            const repulseMag = Math.hypot(repulseX, repulseY);
            const repulseCap = Math.max(0.05, fleetBaseSpeed * 0.6);
            if (repulseMag > repulseCap) {
                repulseX = repulseX / repulseMag * repulseCap;
                repulseY = repulseY / repulseMag * repulseCap;
            }

            // ── P1 地形效果：当前所在格子的移动修正 ──
            const terrainSpeedMul = this.getTerrainSpeedMul(fleet.x, fleet.y);

            // [v34b] **位移方向 = 推力方向 = 舰首朝向**（物理：主引擎只能沿舰首推进）。
            //   病灶：原实现位移方向用 `moveAngle`（瞬时目标方向），而速度大小由 `thrustFactor`
            //   （**舰首 vs 目标**的对齐度）决定 ⇒ **方向与大小不自洽**：
            //     目标方向一变，舰队立刻朝新方向平移，舰首却还在慢慢转
            //     ⇒ L2 实测 misalign 峰值 57.9°（"横着走"）、位移比舰首**早 78 帧**到位
            //       （"舰队先快速移动，然后才看到船在慢慢转"，用户 2026-09-20 复报）。
            //   改为沿舰首推进后：舰首未转过来 ⇒ 舰队沿**旧方向**继续走（有惯性、不横移、不停船）；
            //   舰首渐转 ⇒ 推力方向渐转 ⇒ 速度矢量划出弧线 ⇒ 转弯 = **位移**而不是原地重排。
            //
            //   ⚠ 唯一保留例外：**拖刀**（撤退 + 接敌）—— 舰首朝敌、位移朝补给点，
            //     这是刻意的分离（"船尾给敌人"实报的修复），不可回归。
            //
            //   ⚠ 原方案曾给**中心对称阵型（圆/方）**也保留 `moveAngle`（怕复活 v30 的"圆阵风暴"），
            //     但 L2 实测（`_probe_turn.mjs`，同一场战斗内对照）证明这会造成**两套行为并存**：
            //       wedge  ：misalign 12.2° / speedMinRatio 1.018 / 位移与转身帧差 −3（修好）
            //       square ：misalign 62.0° / speedMinRatio 0.720 / 帧差 +80（**旧病仍在**）
            //     同一编队里一半舰队利落转弯、另一半横着走，比单一缺陷更难读 ⇒ **统一为沿舰首推进**。
            //     "风暴"担忧的根因是半径过小（v=0.30 时 R=23px）；现 v=0.90 ⇒ R≈69px（≈2.8 倍舰长），
            //     且不再掉速刹车，圆阵是"划弧前进"而不是"原地打漩涡"。
            const thrustDir = ((isRetreating && isEngaging) || _backing) ? moveAngle : (fleet.facingSmooth ?? moveAngle);

            // 计算本帧原始速度向量
            let rawVX = 0, rawVY = 0;
            if (fleet.state === 'assembling' && distToTarget < 15) {
                rawVX = repulseX * dt; rawVY = repulseY * dt;
            } else if (distToTarget < 5) {
                rawVX = repulseX * dt; rawVY = repulseY * dt;
            } else if (_backing) {
                // [v47 BACKING-EXIT] 朝敌倒退脱离：位移沿脱离点方向（舰首保持朝敌），
                //   速度 = 常规机动的 55% ⇒「缓缓后退」；敌持续贴上来（phase 留在 2）就持续倒退。
                const backSpeed = fleetBaseSpeed * 0.55;
                rawVX = (Math.cos(thrustDir) * backSpeed * terrainSpeedMul + repulseX) * dt;
                rawVY = (Math.sin(thrustDir) * backSpeed * terrainSpeedMul + repulseY) * dt;
            } else if (isEngaging && fleet.state !== 'flaring' && distToTarget < 120 && !isRetreating) {
                const engageSpeed = 0.05 * retreatSpeedBonus;
                rawVX = (Math.cos(thrustDir) * engageSpeed + repulseX) * dt * congestionSlowdown;
                rawVY = (Math.sin(thrustDir) * engageSpeed + repulseY) * dt * congestionSlowdown;
            } else if (fleet.stance !== 'defend') {
                rawVX = (Math.cos(thrustDir) * fleetBaseSpeed * terrainSpeedMul + repulseX) * dt * congestionSlowdown;
                rawVY = (Math.sin(thrustDir) * fleetBaseSpeed * terrainSpeedMul + repulseY) * dt * congestionSlowdown;
            }

            if (controlOrder.motion === 'hold') {
                rawVX = 0;
                rawVY = 0;
            }

            // 【待改1】惯性/限速模型：不再直接位移，而是让当前速度平滑逼近"期望位移"，
            // 吸收补给/撤退/地形倍率的逐帧硬切（否则目标一变速度瞬变 → 发飘/瞬移感）。
            const desiredVX = rawVX, desiredVY = rawVY;   // 本帧期望位移（已含 dt 与各倍率）
            if (typeof fleet.vx !== 'number') { fleet.vx = 0; fleet.vy = 0; }
            // [v29] 惯性增强：0.18（τ≈0.08s，几乎瞬时）→ FLEET_ACCEL（τ≈0.27s）⇒ 起步 / 改向有"质量感"。
            //   这是"像点不像舰"的第二条根因（第一条是角速度无惯量，见本文件顶部 v29 参数块）。
            const accel = Math.min(1, FLEET_ACCEL * dt);
            fleet.vx += (desiredVX - fleet.vx) * accel;
            fleet.vy += (desiredVY - fleet.vy) * accel;
            fleet.x += fleet.vx;
            fleet.y += fleet.vy;

            // [v47 wheel-and-reform] 阵面朝向（formFacing）唯一真源 —— "原地转向 → 列队重排"的实现体：
            //   · 未初始化 → 建（= 部署朝向）；
            //   · wheel 协议期（_uturn）→ **冻结**（舰体原地快转，格位不平移 ⇒ 无公转）；
            //   · 协议**退出帧** → 一步阶跃到新舰首朝向 ⇒ 全体格位目标此刻才重排；
            //   · 其余任何时刻（巡航/交战/微调）→ 冻结。
            //   v42 的"永久冻结"被替换：那会让多次掉头后阵面与航向永久性斜错位（阵型歪的）。
            //   v31-D 的"低通跟随机首"被替换：格位绕中心连续旋转 = 单位公转 = 画圆（几何恒等式，
            //   四代方案 v34/v41b/v41c/v41e 全部败在这里）。现在阵面**只经 wheel 改变**，画圆不可构造。
            {
                const ff0 = (fleet as any).formFacing;
                if (typeof ff0 !== 'number') {
                    (fleet as any).formFacing = fleet.facingSmooth ?? fleet.facingAngle ?? 0;
                } else if (control.phase === 'reform') {
                    (fleet as any).formFacing = advanceFormationFacing(
                        ff0,
                        fleet.facingSmooth ?? ff0,
                        FORM_FACING_RATE * dt,
                    );
                }
            }

            // [v33 P0-1] 阵型互克：改为 formations.formationCounterMul（单一真源）。
            //   原实现是本文件内的**第二张** beats 表（楔→纺→圆→方→横），与
            //   config/formations.ts（楔→横→纺→圆→方）关系相反 ⇒ 战略层与战术层结论不一致。
            //   收口后：克制方 ×FORMATION_COUNTER_BONUS(1.30)、被克方 ×FORMATION_COUNTERED_PENALTY(0.70)。
            //   ⚠ 值取 0.70（= 原内联值）而非该常量原来的 0.90 —— 那是从未被消费的死代码，
            //     这样收口只改"关系"不改"幅度"，把行为变更面压到最小。
            let damageMultiplier = 1.0;
            if (isEngaging && closestEnemyFleet) {
                damageMultiplier = formationCounterMul(fleet.formation, closestEnemyFleet.formation);
            }

            // [阵型] 格位枚举（单一真源 config/formationLayout.ts）。
            // 原实现是「每阵型 8 个硬编码坐标 + 按循环下标取值」：下标 ≥ 8 时全部塌到
            // [0,0]（一堆单位叠在旗舰上），square/line 分支还会把单位送出地图。
            // 现在按开局实体数 n 枚举，长度恰为 n。n 与阵型在战斗中都可能变（AI 换阵），
            // 故按 (formation, n) 缓存——每帧重算是 O(n) 且会持续分配数组。
            const n0 = (fleet as any).formationCount0 ?? fleet.units.length;
            // 格距的**全部自变量**都进键（= formationSpacing(offs, hexRadius) 的输入）：
            // formation / n0 / hexRadius 已含在上式里，这里把 hexRadius 抽成命名项，
            // 作为 P1 前置 —— 一旦格距开始依赖舰长，只把舰长维度追加到 spacingSrc，
            // 键即自动失效重建，不必再改键的结构。
            // ⚠ 不能把 `_formSpacing` **本身**放进键：它是下面这个分支即将写入的产物，
            //    首帧 undefined → 值会让键自失效、多跑一次 O(n) 重建（自指键）。
            // 今天 (formation, n0, hexRadius) 已是全部自变量，故本项不改变任何行为。
            const spacingSrc = String(this.hexRadius);
            const formKey = `${fleet.formation || 'wedge'}:${n0}:${spacingSrc}`;

            // [v14 ③1] 阵型过渡 morph：
            //   · formKey 变化（换阵 / 兵力变化）时**保留旧 offsets**，记录旧/新像素偏移，
            //     本帧起按 smoothstep 在 FORMATION_MORPH_DUR **秒**内逐 slotIdx 插值 ⇒ 单位平滑滑入新阵位；
            //     （时长 = 真实时间 × 速度倍率，见下方 `_formMorphT` 推进处；v14.1 修复单位错误）
            //   · **过渡中不响应二次换阵**：morph 进行时不接受新 formKey（键留在旧值），
            //     完成后同一帧自动吸附到最新 formKey 并起新 morph ⇒ 天然排队，不会互相打架；
            //   · morph 是**运行态叠加**：`_formOffsets`/`_formSpacing` 始终持有当前 formKey 的目标阵型，
            //     缓存语义不被污染（键→产物 仍是纯函数）。
            {
                const dur = (fleet as any)._formMorphDur ?? 0;
                const t = (fleet as any)._formMorphT ?? dur;
                const morphingPrev = t < dur;
                if ((fleet as any)._formLayoutKey !== formKey && !morphingPrev) {
                    const offs = formationOffsets((fleet.formation || 'wedge') as FormationType, n0);
                    const newSpacing = formationSpacing(offs, this.hexRadius);
                    const prevOffsets: FormationCell[] | undefined = (fleet as any)._formOffsets;
                    const prevSpacing: number = (fleet as any)._formSpacing ?? FORMATION_SPACING;
                    if (prevOffsets) {
                        // 各自用**自己的格距**折成像素偏移，插值后不再乘格距 ⇒ 格距变化也连续
                        (fleet as any)._formMorphA = prevOffsets.map((c) => [c[0] * prevSpacing, c[1] * prevSpacing] as [number, number]);
                        (fleet as any)._formMorphB = offs.map((c) => [c[0] * newSpacing, c[1] * newSpacing] as [number, number]);
                        (fleet as any)._formMorphT = 0;
                        (fleet as any)._formMorphDur = FORMATION_MORPH_DUR;
                    }
                    (fleet as any)._formLayoutKey = formKey;
                    (fleet as any)._formOffsets = offs;
                    // 格距：默认 28px；仅当 (半跨 × 28) 超出 hexRadius×4 的足迹预算时才压缩
                    (fleet as any)._formSpacing = newSpacing;
                }
            }
            const formOffsets: FormationCell[] = (fleet as any)._formOffsets || [[0, 0]];
            const formSpacing: number = (fleet as any)._formSpacing ?? FORMATION_SPACING;
            // [v33 P0-2] 列位侧写（列位数组 + 归一基准）。按 offsets 引用记忆化 ⇒ 每舰队每阵型只算一次。
            //   基准 = 该阵型在近/中/远三档的**等权平均** ⇒ 整场期望乘区恒 1.0，零净增益
            //   （旧案矩阵三行均值不等 112.5/102.5/100，直接用等于给全部单位隐性 +5%）。
            const colProfile = columnProfileCached(fleet.formation || 'wedge', formOffsets);

            // [v14 ③1] 本帧 morph 权重（缓入缓出 smoothstep）；非过渡期为 1（直接用目标阵位）
            const morphDurNow: number = (fleet as any)._formMorphDur ?? 0;
            const morphTNow: number = (fleet as any)._formMorphT ?? morphDurNow;
            const morphingNow = morphTNow < morphDurNow;
            const morphA: [number, number][] | null = (fleet as any)._formMorphA ?? null;
            const morphB: [number, number][] | null = (fleet as any)._formMorphB ?? null;
            let morphE = 1;
            if (morphingNow) {
                const tt = Math.min(1, Math.max(0, morphTNow / morphDurNow));
                morphE = tt * tt * (3 - 2 * tt);
                // [v14.1 修复] `_formMorphT` 是**真实时间（秒）**，故必须用 update 的真实时间增量推进：
                //   delta 是 update(time, delta) 第二参（毫秒）；夹 100ms 防单帧卡顿跳变；
                //   × `dt`（= store.currentSpeedFactor 速度倍率）与全文件 `duration: xxx / dt` 约定同源。
                //   ⇒ 1x 全长 FORMATION_MORPH_DUR=3.5 秒；3x ≈1.17 秒。
                //   ⚠ 旧代码 `morphTNow + dt` 误把速度倍率当单位 ⇒ 实为 3.5 **帧**（60fps≈58ms），不成立。
                (fleet as any)._formMorphT = Math.min(morphDurNow, morphTNow + (Math.min(delta, 100) / 1000) * dt);
            }

            // [兵力折算·N 不变性] 本舰队按 classType 的实体数统计（每帧每舰队算一次，O(N)）。
            // 提督攻击加成 / 目标防御这类「原设计每个舰种只贡献一次」的平摊项，
            // 在舰种被拆成 n_sameType 个实体后必须各自除以 n_sameType，
            // 才能让 Σ 伤害与实体数 N（即 K_VISUAL）无关。
            // 否则 Σ = Σu.atk + N*(bonus - def)：调 K_VISUAL 会改战斗结果，性能档位变成难度档位。
            const classTypeCount = new Map<string, number>();
            for (const cu of (fleet.units as any[])) {
                const ct: string = cu.classType || '';
                classTypeCount.set(ct, (classTypeCount.get(ct) || 0) + 1);
            }
            const typeShareOf = (ct: string): number => Math.max(1, classTypeCount.get(ct || '') || 1);

            // [FIX-volley] 开火相位推进（替代旧「每发都 lastAtkTime = 当前帧时间」）：
            //   旧实现打完就把冷却起点统一钉回本帧 ⇒ 全体单位相位逐轮向同一时刻收敛，
            //   几轮后变成**全队完美齐射**——伤害同帧叠加在同一批随机目标上，
            //   「提督属性碾压却被一轮激光齐射全灭」（用户实报）即此。
            //   新实现：按一个冷却周期**推进**（保留部署期错相 lastAtkTime 负偏移与黄金比例散相）；
            //   仅落后 >2 个周期（索敌空窗/倍率切换/刚接敌）才重新同步，且同步点带黄金比例
            //   确定性偏置 ⇒ 既不会追帧机枪，也不会重新同相。
            const advanceAtkPhase = (u: any, slotHint: number) => {
                const ivl = u.atkInterval / dt;
                if (time - u.lastAtkTime > ivl * 2) {
                    u.lastAtkTime = time - ((slotHint * 0.6180339887) % 1) * ivl;
                } else {
                    u.lastAtkTime += ivl;
                }
            };

            // [v42b] **呼吸位移已删除**：原实现每舰相位不同（slotIdx×1.7）且**交战中**也激活
            //   （isStopped 含 isEngaging）⇒ 舰队每帧各自微幅抖动 = 用户实报「摇头晃脑、左晃右晃、
            //   神经病一样」。整齐队列才是舰队该有的观感。

            fleet.units.forEach((u: any, index: number) => {
                // v3 独立往返：运输舰不参与阵型定位（sprite 由 aux.x/y 独立驱动，见下方 moveAuxShips 同步段）
                if (isSupplyUnit(u)) return;
                // [阵型] 用部署期固定的 formationSlot，不用循环 index——
                // fleet.units 在单位被击毁时会被 filter 重赋值，index 会整体前移导致幸存舰瞬移。
                // 兜底 index：未写入 formationSlot 的路径退回循环下标 —— formOffsets 的长度本身就按 fleet.units.length 枚举，形态仍正确，不会塌到同一格。
                const slotIdx = (typeof u.formationSlot === 'number' && u.formationSlot >= 0)
                    ? u.formationSlot
                    : index;
                // [v14 ③1] 阵位像素偏移：过渡中 = 旧/新像素偏移按 morphE 插值；否则 = 目标阵位 × 格距
                // [FIX-stance-snap] 越界槽位兜底 [0,0] → ringCell()：旧实现把越界单位全塌到舰队中心，
                //   姿态/阵型切换瞬间一眼就是"全体极速吸向一个固定点"。
                let ox: number; let oy: number;
                if (morphingNow && morphA && morphB) {
                    // morphA/B 是**像素**偏移（建表时已乘格距）⇒ 越界兜底 ringCell 也要折算成像素，
                    // 否则槽位越界单位会在过渡期塌回距中心 1~3px（"吸中心"回潮，审查 P2①）。
                    const ringPx = ringCell(slotIdx);
                    const rp: [number, number] = [ringPx[0] * formSpacing, ringPx[1] * formSpacing];
                    const a = morphA[slotIdx] || morphB[slotIdx] || rp;
                    const b = morphB[slotIdx] || rp;
                    ox = a[0] + (b[0] - a[0]) * morphE;
                    oy = a[1] + (b[1] - a[1]) * morphE;
                } else {
                    // 非过渡分支的 cell 为**格位**单位，下方统一乘 formSpacing ⇒ ringCell 直接可用
                    const cell: FormationCell = formOffsets[slotIdx] || ringCell(slotIdx);
                    ox = cell[0] * formSpacing; oy = cell[1] * formSpacing;
                }
                // [R10-B1] 阵位旋转改用限速平滑后的舰首朝向（原为瞬时 fAngle ⇒ 大角度转向时
                //   单位目标位瞬时绕中心旋转、直线 lerp 追过去"穿心" ⇒ 视觉"缩成一团再展开"）
                // [v31-D] 阵位旋转改用 **formFacing（阵型朝向 = 实际航向的低通）**，
                //   不再用 `facingSmooth`（舰首朝向）—— 后者会让阵型随舰首转身**绕中心画圆**，
                //   与"战舰各自缓慢转身"正相反（这正是用户第三次反馈的精确来源）。
                const _ff = (fleet as any).formFacing ?? fleet.facingSmooth;
                const rx = ox * Math.cos(_ff) - oy * Math.sin(_ff);
                const ry = ox * Math.sin(_ff) + oy * Math.cos(_ff);


                const targetUnitX = fleet.x + rx;
                const targetUnitY = fleet.y + ry;
                const uDist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, targetUnitX, targetUnitY);

                // [FIX-stance-snap] 限速追踪（替代旧「每帧补剩余距离 8%」比例 lerp）：
                //   旧式在阵型切换/编队位移时把数百 px 的差一步补 8%（≈24px/帧，读作"极速吸向固定点"），
                //   之后按指数尾巴爬行（读作"再缓慢组成阵型"），且不随战斗倍率缩放。
                //   新式：每帧位移 = min(剩余距离, (1.0 + 距离×0.02) × dt)，上限速度随倍率同步，
                //   300px 追赶 ≈ 7px/帧匀滑落位、近距离柔和收敛，观感 = 舰船"飞"进阵位。
                // [v21 JIT-1] 死区 2px → UNIT_CHASE_EPS（仅除零保护）。原 2px 死区 + 下方 chase 的
                //   1.0px/帧下限构成极限环（取证见 UNIT_CHASE_EPS 注释）：单位在死区内完全静止，
                //   目标却随舰队逐帧移动 ⇒ 周期性"停 N 帧 + 猛追 1 帧"，sprite 位移在 0 与 2×
                //   舰队步长之间交替。`Math.min(uDist, …)` 已保证不越冲 ⇒ 小 uDist 时 chase=uDist
                //   （一帧精确贴合、无过冲无残留），大 uDist 仍受 (1.0+uDist×0.02)×dt 限速。
                if (uDist > UNIT_CHASE_EPS) {
                    // 归位速度只取固定预算：阵面转了 180° 只会让归位更久，
                    // 不会因为目标距离变大而突然加速、收拢或瞬移。
                    const nextPosition = moveTowardsAtSpeed(
                        { x: u.sprite.x, y: u.sprite.y },
                        { x: targetUnitX, y: targetUnitY },
                        UNIT_FORMATION_SPEED * dt,
                    );
                    u.sprite.x = nextPosition.x;
                    u.sprite.y = nextPosition.y;
                }
                 
                u.sprite.setAlpha(uDist > 320 ? 0.4 : 1.0);
                // [v47 visHeading] 逐舰物理舰首 = 跟随**自身位移航迹**（限速 UNIT_VIS_TURN_RATE×dt）。
                //   旧实现 sprite.rotation 全舰队刚性 = facingSmooth，而每舰真实位移方向是"冲向
                //   移动格位"的方向 —— 转弯/变阵期两者差 60~180° ⇒ 舰首朝前、船体侧滑 = 用户实报
                //   「转向后所有战舰摇头晃脑边晃边前进」。现在舰首贴着航迹走，物理上不再侧移。
                //   刚性例外（舰首本就不该跟航迹的姿态）：wheel 原地转向期 / 拖刀 / 顶敌倒退 / 静止。
                const _ux = u.sprite.x, _uy = u.sprite.y;
                const _dx = _ux - ((u as any)._px ?? _ux);
                const _dy = _uy - ((u as any)._py ?? _uy);
                (u as any)._px = _ux; (u as any)._py = _uy;
                const _rigid = (fleet as any)._uturn === true
                    || (isRetreating && isEngaging) || _backing
                    || (_dx * _dx + _dy * _dy) < 0.02;
                const _wantH = _rigid ? (fleet.facingSmooth ?? fAngle) : Math.atan2(_dy, _dx);
                if (typeof (u as any).visHeading !== 'number') (u as any).visHeading = _wantH;
                (u as any).visHeading = rateLimitAngle((u as any).visHeading, _wantH, UNIT_VIS_TURN_RATE * dt);
                u.sprite.rotation = (u as any).visHeading;

                // 舰头方向补偿：原图舰头朝上(-Y)，容器+X轴对应舰队前进方向
                // 需要将原图顺时针转 90°(π/2)，使舰头从"上"转到"右"(容器前进方向)
                const borderShape = u.sprite.getByName('border') as any;
                if (borderShape) borderShape.rotation = Math.PI / 2;

                // 阴影已移除

                // 距离过远阵型拉扯时，底盘光环变成警告色（阈值与上方 0.4 渐隐同源 = 320px）
                const auraColor = uDist > 320 ? 0x38bdf8 : myFac.color;
                const auraShape = u.sprite.getByName('aura') as any;
                if (auraShape) {
                    auraShape.setFillStyle(auraColor, uDist > 320 ? 0.8 : 0.4);
                    auraShape.rotation = -(u as any).visHeading; // 光环保持世界水平（容器现按逐舰航向旋转）
                }

                // 尾焰：仅在移动时显示，带闪烁/脉动效果
                // isMoving 判断与速度挂钩：移动越快尾焰越亮越长
                const isMoving = uDist > 5;
                const flameShape = u.sprite.getByName('flame') as any;
                if (flameShape) {
                    flameShape.setVisible(isMoving);
                    if (isMoving) {
                        const speedFactor = Math.min(1, uDist / 60);
                        const phase = time * 0.018 + slotIdx * 0.7;
                        // 增强闪烁幅度，让动画效果明显
                        const flicker = 0.75 + Math.sin(phase * 1.3) * 0.20 + Math.sin(phase * 2.7) * 0.08;
                        flameShape.setAlpha(flicker * (0.85 + speedFactor * 0.15));
                        // 增强脉动幅度
                        const pulseX = 0.85 + Math.sin(phase * 1.7) * 0.12 + speedFactor * 0.08;
                        const pulseY = 0.90 + Math.sin(phase * 2.1) * 0.08 + speedFactor * 0.05;
                        flameShape.scaleX = pulseX;
                        flameShape.scaleY = pulseY;
                    }
                }

                // 确保文字永远保持正向可读：按**本舰显示航向**反向补偿（v47：原 -fAngle 是
                //   未平滑的瞬时舰队朝向，转向期逐帧摆动 = "文字跟着摇头"的最大观感来源）
                const textObj = u.sprite.getByName('text') as any;
                if (textObj) textObj.rotation = -(u as any).visHeading;
                // [v55] 统一开火门（aiDirector.fireGate 判定表）：①交战态=combat（既有行为）；
                //   ②受击且攻击者在射程内=return_fire——无视撤退/信标/视野模糊，受击必还击；
                //   ③其余=none。替换旧 `isEngaging && …` 单门（撤退/信标态被 250px 卡死的病灶）。
                const gate = fireGate({
                    engaged: isEngaging,
                    underFire,
                    attackerDist,
                    strikeRange,
                });
                if (gate.canFire && time - u.lastAtkTime > (u.atkInterval / dt)) {
                    let targetShip: any = null;
                    // return_fire 模式强制打攻击者（谁打我我打谁）；combat 模式按目标选择结果
                    const fireTargetFleet = (gate.mode === 'return_fire' && attackerFleet) ? attackerFleet : closestEnemyFleet;
                    if (fireTargetFleet) {
                        // P1 地形：小行星带射程-30%
                        // v5：射程直接用 u.range（gameData 已超视距分层），去掉 +30 补偿
                        const rangeMul = this.getTerrainRangeMul(fleet.x, fleet.y);
                        const effectiveRange = u.range * rangeMul;
                        // 后勤舰不维持“战斗存活”，但始终是可选火力目标：击沉它会让
                        // collectAuxShips / 补给链自然失去该运输舰，后勤切断战术因此成立。
                        const inRangeUnits = targetableUnits(fireTargetFleet).filter((eu: any) =>
                            Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, eu.sprite.x, eu.sprite.y) <= effectiveRange
                        );
                        if (inRangeUnits.length > 0) targetShip = inRangeUnits[Math.floor(Math.random() * inRangeUnits.length)];
                    }

                    if (targetShip) {
                        // [FIX-volley] 相位推进（原 u.lastAtkTime = time 会把全体冷却钉回同一时刻 → 齐射同步）
                        advanceAtkPhase(u, slotIdx);
                        const targetFac = this.factionMap.get(targetShip.factionId);
                        
                        const unitSupplyFactor = u.supply > 30 ? 1.0 : 0.5;
                        // 士气衰减：士气越低伤害越低（100→1.0，0→0.6），与补给衰减叠乘
                        const flMorale1 = (fleet.morale === undefined ? 100 : fleet.morale);
                        const moraleDmgMult = 0.6 + 0.4 * (flMorale1 / 100);
                        const admAtk = myFac.admiralStats?.attack || 0;
                        const tgtDef = targetFac?.admiralStats?.defense || 0;
                        // [兵力折算·N 不变性] 平摊项按本舰队同型实体数摊分（见循环外 classTypeCount 注释）：
                        // 同型 n 个实体各承担 1/n，聚合后每个舰种恰好贡献一次，与 N 无关。
                        const typeShare = typeShareOf(u.classType);
                        
                        // 【待改4】补给→防御连续衰减（去掉 supply=0 断崖：原实现 supply 一归零防御瞬间清零 → 级联崩盘）
                        // supply≥50 满防御，supply=0 仍有 30% 底，线性过渡。
                        // [FIX-volley·B] 提督权重上调：原 攻0.2/防0.1 时提督属性满级与白板差距仅 ~15%，
                        //   用户实报"提督属性全面碾压却被一轮齐射秒"——齐射同步修复外，属性差异必须可感。
                        //   攻 0.2→0.5、防 0.1→0.2（仍 ÷typeShare 保 N 不变性，量纲同 economy v4）。
                        const supplyDefFactor = 0.3 + 0.7 * Math.max(0, Math.min(1, targetShip.supply / 50));
                        // [v33 P1-4.3] 阵型崩溃 → **受击方**防御乘区（旧案「防御 −50%」）。
                        const tgtCollapseDefMul = collapseMuls((closestEnemyFleet as any)._formationCollapsed === true).def;
                        const effectiveDef = ((targetShip.def + Math.floor(tgtDef * 0.2)) / typeShare) * supplyDefFactor * tgtCollapseDefMul;
                        // P1 地形闪避减伤（星云 +20%；表见 config/terrainEffects.ts）
                        const terrainDodge = this.getTerrainDodgeMul(closestEnemyFleet.x, closestEnemyFleet.y);
                        let baseDmg = (((u.atk + Math.floor(admAtk * 0.5) / typeShare) * unitSupplyFactor) - effectiveDef) / terrainDodge;
                        if (u.classType === '电子' || u.classType === '无') baseDmg = (u.atk + Math.floor(admAtk * 0.1) / typeShare) * unitSupplyFactor / terrainDodge;

                        // ── [v33 P0-3] 方向装甲：前 / 侧 / 后（收口替换原"仅 >135° 背击 ×1.5"）──────
                        //   原实现只有一档背击、且装甲是单值 ⇒ **舰种编成在战术层没有形状差异**
                        //   （高速战舰与盾战舰除 hp/def 标量差外，挨打方式完全一样）。
                        //   现按**受击舰自身舰种**的三向装甲取倍率（逐舰而非舰队均值：伤害本就结算在
                        //   具体 targetShip 上，逐舰粒度更细、可从侧后专打高战的薄侧，且省一次加权遍历）。
                        //   ⚠ 参考系优先取**实际运动方向**：`formFacing` 是低通平滑值，急转/撤退时会与
                        //     新航向背离 ⇒ 用它会出"背向敌人却在挨正面的伤"的观感矛盾。
                        //     速度过低（换向瞬间/停船）才回退，阈值 DIRECTION_ARMOR.MIN_SPD2_FOR_MOTION。
                        const tgtSpd2 = (closestEnemyFleet.vx || 0) * (closestEnemyFleet.vx || 0)
                                      + (closestEnemyFleet.vy || 0) * (closestEnemyFleet.vy || 0);
                        const tgtFacing = tgtSpd2 > 0.25
                            ? Math.atan2(closestEnemyFleet.vy, closestEnemyFleet.vx)
                            : ((closestEnemyFleet as any).formFacing ?? closestEnemyFleet.facingAngle);
                        const angleToAttacker = Math.atan2(u.sprite.y - closestEnemyFleet.y, u.sprite.x - closestEnemyFleet.x);
                        let angleDiff = Math.abs(angleToAttacker - tgtFacing);
                        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

                        const hitSide = hitSideFromAngle(angleDiff);
                        let backstabMulti = dirArmorMul(hitSide, targetShip.classType || '无');
                        // ⚠ 这里**不要**加"背面至少 ×1.5"的保底：那会让 空母 1.34 / 补给 1.32 / 电子 1.44
                        //   全部被抬到 1.5，把刚在台架上验证过的"装甲偏序"重新抹平
                        //   —— 与 EXP 从 0.5 改到 0.30 修的是**同一个错误**（clamp/保底吃掉区分度）。
                        //   CRIT! 提示的阈值是 1.2（既有口径），不为提示而改动数值。
                        if (backstabMulti >= DIRECTION_CRIT_MIN) {
                            const critText = this.add.text(targetShip.sprite.x, targetShip.sprite.y - 15, 'CRIT!', { fontSize: '10px', color: '#fbbf24', fontStyle: 'bold' }).setOrigin(0.5);
                            this.tweens.add({ targets: critText, y: targetShip.sprite.y - 30, alpha: 0, duration: 800 / dt, onComplete: () => critText.destroy() });
                        }
                        // 隐身奇袭加成：隐身舰队破隐后首次攻击 +30%
                        if ((fleet as any).ambushReady) {
                            (fleet as any).ambushReady = false;
                            backstabMulti *= 1.3;
                            const ambushText = this.add.text(targetShip.sprite.x, targetShip.sprite.y - 25, 'AMBUSH!', { fontSize: '10px', color: '#06b6d4', fontStyle: 'bold' }).setOrigin(0.5).setDepth(50);
                            this.tweens.add({ targets: ambushText, y: targetShip.sprite.y - 40, alpha: 0, duration: 800 / dt, onComplete: () => ambushText.destroy() });
                        }

                        // ── 指挥点修正：伤害倍率（isDefending=驻守姿态时激活护盾分支）──
                        const isFleetDefending = fleet.stance === 'defend';
                        const cpDmgMult = this.cpState ? getDamageMultiplier(this.cpState, fleet.id, isFleetDefending, fleet.factionId) : 1.0;
                        // ── 指挥点修正：士气加成（morale_rally 等 morale 效果 → 每10点士气+3%伤害）──
                        const cpMorale = this.cpState ? getMoraleModifier(this.cpState, fleet.id, fleet.factionId) : 0;
                        const cpMoraleMult = 1.0 + Math.max(0, cpMorale) * 0.003;
                        // P4b 逆境宣言buff：+15%伤害
                        const adversityMult = (fleet._adversityBuffUntil && this.time.now < fleet._adversityBuffUntil) ? 1.15 : 1.0;
                        // P5 决战时刻buff：+20%伤害
                        const finalMult = fleet._finalBattle ? 1.2 : 1.0;
                        // v29：撤退档位 → 火力乘区（脱离接触保留 70% / 撤离 40% / 溃散 0%）。
                        //   这是"边打边退"与"掉头就跑"的数值区别；旧实现撤退中火力不打折。
                        const retreatFireMul = isRetreating
                            ? retreatParams(((fleet as any)._retreatTier ?? 'withdraw') as RetreatTier).fireMul
                            : 1.0;
                        // ══ [v33] 四项新增乘区：**先合并再钳制** ══════════════════════════════════
                        // 为什么合并钳制：既有 9 个乘区各已 playtest，而新加的 4 项若各自独立乘下去，
                        // 理论上限会被推到 5× 以上（单看每项都"温和"，但乘区是相乘的）——
                        // 这是"某一帧出现秒杀级伤害"的典型成因（docs/design/loch-web-plan/02 §6.2）。
                        const bandNowLocal: RangeBand = (fleet as any)._rangeBand ?? 'mid';
                        const isStrikeUnit = u.classType === '舰载' || u.classType === '突击';
                        // P0-2 列位 × 距离带（净增益恒 1.0，只对"能否维持理想交战距"敏感）
                        const colMul = columnMatrixMul(colProfile, slotIdx, bandNowLocal, isStrikeUnit);
                        // P1-4.5 舰种偏好距离带（命中 +5% / 未命中 −3%）
                        const bandMul = shipBandMul(u.classType || '无', bandNowLocal);
                        // P1-4.3 阵型崩溃 → 攻方火力 −50%
                        const collapseFireMul = collapseMuls((fleet as any)._formationCollapsed === true).fire;
                        // P1-4.2 受击方拦截减伤（1/(1+rate)；巡航舰防空最高 ⇒ 打掉防空舰即削弱拦截）
                        //   ⚠ 走 `interceptRateOf`（250ms TTL 缓存）——直接调 `fleetInterceptRate`
                        //     会逐发遍历受击方全部单位，是 O(N²)/帧。
                        const interceptMul = interceptDamageMul(this.interceptRateOf(closestEnemyFleet));
                        const v33Combo = Math.max(TACTICAL_COMBO_CLAMP.MIN, Math.min(TACTICAL_COMBO_CLAMP.MAX,
                            colMul * bandMul * collapseFireMul * interceptMul));

                        let finalDmg = Math.max(1, baseDmg * damageMultiplier * backstabMulti * cpDmgMult * cpMoraleMult * adversityMult * finalMult * moraleDmgMult * retreatFireMul * v33Combo);
                        // 战损保底：最低造成目标 1% 最大舰数的破甲伤害
                        const minDmg = Math.max(1, Math.floor(targetShip.maxHp * 0.01));
                        finalDmg = Math.max(finalDmg, minDmg);

                        // ── 指挥点修正：受击方护盾减伤 + reflect 反弹 ──
                        // 受击舰队有活跃 shield 效果（紧急抢修/紧急回避等）或处于驻守姿态 → 减伤；
                        // 有 reflect 效果（杨威利魔术的反击）→ 按系数反弹给攻击方
                        const tgtFleet = fireTargetFleet; // 受击的是敌方舰队（return_fire 时=攻击者）
                        // [v55] 受击台账写入端：一舰中弹 ⇒ 受击舰队获得 8s 还击权（aiDirector 不变量
                        //   「受击必还击」的证据链）。读取端在本帧上方 activeAttacker 解析处。
                        if (tgtFleet) noteIncomingFire(tgtFleet, fleet.id, this.time.now);
                        if (this.cpState && tgtFleet) {
                            const tgtDefending = tgtFleet.stance === 'defend';
                            const incomingMult = getIncomingMultiplier(this.cpState, tgtFleet.id, tgtDefending);
                            finalDmg = Math.max(1, finalDmg * incomingMult);
                            const reflectRatio = getReflectRatio(this.cpState, tgtFleet.id);
                            if (reflectRatio > 0) {
                                const reflected = finalDmg * reflectRatio;
                                u.hp -= reflected;
                                if (reflected > 1) this.spawnDamageNumber(u.sprite.x, u.sprite.y - 10, reflected, false);
                            }
                        }

                        if (u.classType === '突击') {
                            const fighterCount = 4;
                            const dmgPerFighter = finalDmg / fighterCount;
                            // v6：3D 舰载机小队（专用模型 + 飞行→格斗→击落→返航），2D 保留三角机 tween（factionId 供 3D 按敌我选模型）
                            pushFx3d({ kind: 'strike', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: targetShip.sprite.x, y: targetShip.sprite.y }, color: myFac.color, count: fighterCount, dmg: dmgPerFighter, factionId: u.factionId });
                            for (let i = 0; i < fighterCount; i++) {
                                const fighter = this.add.triangle(u.sprite.x, u.sprite.y, 0, 3, 5, 1.5, 0, 0, myFac.color).setDepth(20);
                                const tgtX = targetShip.sprite.x + Phaser.Math.Between(-20, 20); const tgtY = targetShip.sprite.y + Phaser.Math.Between(-20, 20);
                                fighter.rotation = Math.atan2(tgtY - u.sprite.y, tgtX - u.sprite.x);

                                this.tweens.add({
                                    targets: fighter, x: tgtX, y: tgtY, duration: (500 + Math.random() * 400) / dt, ease: 'Sine.easeInOut',
                                    onComplete: () => {
                                        fighter.destroy();
                                        const exp = this.add.circle(tgtX, tgtY, 5, 0xffaa00).setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
                                        this.tweens.add({ targets: exp, scale: 1.5, alpha: 0, duration: 200 / dt, onComplete: () => exp.destroy()});
                                        
                                        targetShip.hp -= dmgPerFighter;
                                        if (targetShip.sprite && targetShip.sprite.active) {
                                            targetShip.sprite.setAlpha(0.5);
                                            this.time.delayedCall(50, () => { if (targetShip.sprite && targetShip.sprite.active) targetShip.sprite.setAlpha(1.0); });
                                        }
                                    }
                                });
                            }
                        } else {
                            const dist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, targetShip.sprite.x, targetShip.sprite.y);
                            const fireAngle = Math.atan2(targetShip.sprite.y - u.sprite.y, targetShip.sprite.x - u.sprite.x);
                            // [FIX-laser-density] 视觉抽稀门（仅表现层，伤害/命中数字/闪白全保留）：
                            //   数十实体 × 每发全长光束 ⇒ 屏幕交叉成"激光汤"（用户实报）。
                            //   2D 与 3D 共用同一枚硬币 ⇒ 两种风格不会一边有一边无；弹壳/尾迹粒子不受影响。
                            const drawBeam = Math.random() < 0.30;
                            const drawRipple = Math.random() < 0.45;
                            
                            // 导弹/鱼雷 → 驱逐和巡洋专属（兼容中英文 classType）
                            const isMissileShip = u.classType === 'destroyer' || u.classType === 'cruiser' 
                                || u.classType === '驱逐' || u.classType === '巡洋';
                            if (isMissileShip) {
                                // v6.5 弹药约束：导弹齐射耗弹 1/轮；耗尽后降级为主炮激光（不白板）
                                // burstCount 提到外层：2D 弹幕循环同用它，且弹尽时 2D 侧也一并收敛
                                var burstCount = u.classType === 'destroyer' || u.classType === '驱逐' ? 6 : 4;
                                if ((u.missileAmmo ?? 999) > 0) {
                                    if (u.missileAmmo !== undefined) u.missileAmmo -= 1;
                                    // v5：3D 导弹独立视觉（弹幕小体+蛇形+尾焰），不再复用激光束
                                    pushFx3d({ kind: 'missiles', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: targetShip.sprite.x, y: targetShip.sprite.y }, color: myFac.color, count: burstCount });
                                } else {
                                    burstCount = 0;   // 弹尽：2D 弹幕循环不执行，只剩下方共享的伤害/护盾/激光结算
                                    if (drawBeam) {
                                        const laserDist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, targetShip.sprite.x, targetShip.sprite.y);
                                        const laserAngle = Math.atan2(targetShip.sprite.y - u.sprite.y, targetShip.sprite.x - u.sprite.x);
                                        const laser = this.add.rectangle(u.sprite.x, u.sprite.y, laserDist, 1.5, myFac.color).setOrigin(0, 0.5).setRotation(laserAngle).setDepth(15).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7);
                                        const laserCore = this.add.rectangle(u.sprite.x, u.sprite.y, laserDist, 0.6, 0xffffff).setOrigin(0, 0.5).setRotation(laserAngle).setDepth(16).setAlpha(0.9);
                                        this.tweens.add({ targets: [laser, laserCore], alpha: 0, duration: 700 / dt, onComplete: () => { laser.destroy(); laserCore.destroy(); } });
                                    }
                                }
                                const totalDur = Math.min(800, dist * 3.0) / dt;
                                const perpBase = fireAngle + Math.PI / 2;
                                const startX = u.sprite.x, startY = u.sprite.y;
                                const tgtX = targetShip.sprite.x, tgtY = targetShip.sprite.y;
                                
                                for (let m = 0; m < burstCount; m++) {
                                    // 宽散射角 + 发射口错位（模拟多联装发射管陆续射出）
                                    const launchAngle = fireAngle + (m - burstCount/2 + 0.5) * 0.15;
                                    const offsetX = Math.cos(perpBase) * (m - burstCount/2) * 3;
                                    const offsetY = Math.sin(perpBase) * (m - burstCount/2) * 3;
                                    
                                    // 小型光点导弹，密集齐射时以蛇形轨迹突进
                                    const missile = this.add.circle(startX + offsetX, startY + offsetY, 1.0, myFac.color)
                                        .setDepth(18).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.0);
                                    
                                    this.time.delayedCall(m * 35 / dt, () => {
                                        if (!missile.active) return;
                                        missile.setAlpha(0.95);
                                        const proxy = { t: 0 };
                                        this.tweens.add({
                                            targets: proxy, t: 1,
                                            duration: totalDur, ease: 'Sine.easeIn',
                                            onUpdate: () => {
                                                if (!missile.active) return;
                                                const p = proxy.t;
                                                const wobbleAmp = (1 - p) * 40 * Math.sin(p * 12 + m * 2.5);
                                                const wobbleMed = (1 - p) * 18 * Math.sin(p * 7 + m * 0.8);
                                                const wobble = wobbleAmp + wobbleMed;
                                                
                                                const cx = (startX + offsetX) + (tgtX - startX - offsetX) * p;
                                                const cy = (startY + offsetY) + (tgtY - startY - offsetY) * p;
                                                missile.x = cx + Math.cos(perpBase) * wobble;
                                                missile.y = cy + Math.sin(perpBase) * wobble;
                                                
                                                // 稀疏尾迹粒子
                                                if (Math.random() < 0.45) {
                                                    const dot = this.add.circle(missile.x, missile.y, 0.5, 0xffffff, 0.4)
                                                        .setDepth(17).setBlendMode(Phaser.BlendModes.ADD);
                                                    this.tweens.add({ targets: dot, alpha: 0, scale: 0.2, duration: 250 / dt, onComplete: () => dot.destroy() });
                                                }
                                            },
                                            onComplete: () => {
                                                missile.destroy();
                                                const exp = this.add.circle(tgtX + Phaser.Math.Between(-4, 4), tgtY + Phaser.Math.Between(-4, 4), 3, 0xffaa00, 0.8)
                                                    .setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
                                                this.tweens.add({ targets: exp, scale: 3.0, alpha: 0, duration: 280 / dt, onComplete: () => exp.destroy()});
                                            }
                                        });
                                    });
                                }
                            } else {
                                // === 战列舰主炮激光（细束，银英风格）=== [FIX-laser-density: 30% 抽稀]
                                if (drawBeam) {
                                    // 外层辉光: 2px 宽，半透明
                                    const laser = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 2, myFac.color).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(15).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7);
                                    // 内核: 0.8px 亮白细线
                                    const core = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 0.8, 0xffffff).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(16).setAlpha(0.9);
                                    this.tweens.add({ targets: [laser, core], alpha: 0, duration: 900 / dt, ease: 'Expo.easeOut', onComplete: () => { laser.destroy(); core.destroy(); } });
                                }
                            }

                            targetShip.hp -= finalDmg;
                            // 伤害数字
                            const isCrit = backstabMulti > 1.2;
                            this.spawnDamageNumber(targetShip.sprite.x, targetShip.sprite.y, finalDmg, isCrit);
                            // [FIX-1 · #73] 删除原「受击后坐力」对 closestEnemyFleet.x/y 的直写（旧 W2）：
                            //   它是「位置瞬移」而非速度/冲量（不乘 dt、无衰减、无上限、逐发线性累加，
                            //   单发 0.08–8px、同帧多舰最坏 ≈24px），且方向取「单舰 u.sprite → 目标质心」
                            //   在包围合围时会反相。太空战无整队后坐的物理依据 ⇒ 整块移除。
                            //   下方受击视觉反馈全部保留：伤害数字(上一行)、命中闪白、护盾涟漪、激光、impactFlash。
                            if (targetShip.sprite && targetShip.sprite.active) {
                                targetShip.sprite.setAlpha(0.3);
                                this.time.delayedCall(100, () => { if (targetShip.sprite && targetShip.sprite.active) targetShip.sprite.setAlpha(1.0); });
                            }
                            
                            const tFac = this.factionMap.get(targetShip.factionId);
                            const shieldColor = tFac ? tFac.color : 0x06b6d4;
                            const impactAngleRad = Math.atan2(u.sprite.y - targetShip.sprite.y, u.sprite.x - targetShip.sprite.x);
                            const impactAngleDeg = Phaser.Math.RadToDeg(impactAngleRad);
                            // v5 护盾舰队级定位：中心=受击舰队全队质心，size=舰队展开半径
                            //   （旧版用单舰 sprite 坐标 → 3D 半球只罩一艘，与舰队视觉错开，用户实报）
                            // v6.1 护盾尺寸回归单舰口径：护盾是舰艇自身的偏导护盾，尺寸必须与舰长挂钩
                            //   （v5 舰队展开半径 / v6 半径钳制两条路都把盾撑大了，用户二次实报）。
                            //   直接传受击舰舰种，3D 侧按 dimsOf(舰种).L 计算半径，与舰艇严格同源。
                            if (drawRipple) pushFx3d({ kind: 'shield', at: { x: targetShip.sprite.x, y: targetShip.sprite.y }, shipClass: targetShip.classType, dir: { x: -Math.cos(impactAngleRad), y: -Math.sin(impactAngleRad) }, color: shieldColor, factionId: targetShip.factionId });
                            // 3D 覆盖层：激光事件与 2D 光束同门（drawBeam）；护盾涟漪与 2D 弧线同门（drawRipple）
                            if (drawBeam) pushFx3d({ kind: 'laser', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: targetShip.sprite.x, y: targetShip.sprite.y }, color: myFac.color });

                            const impactX = targetShip.sprite.x + Math.cos(impactAngleRad) * 10;
                            const impactY = targetShip.sprite.y + Math.sin(impactAngleRad) * 10;
                            const impactFlash = this.add.circle(impactX, impactY, 4, 0xffffff, 1).setDepth(21).setBlendMode(Phaser.BlendModes.ADD);

                            // 【球形护盾涟漪】[FIX-laser-density: 45% 抽稀，与 3D 护盾同门]
                            const gfx = drawRipple ? this.add.graphics().setDepth(20) : null;
                            const rippleState: any = { rx: 14, ry: 8, span: 0.45, alpha: 1 };
                            const drawShieldArc = () => {
                                if (!gfx) return;
                                gfx.clear();
                                if (rippleState.alpha <= 0) return;
                                const a1 = impactAngleRad - rippleState.span;
                                const a2 = impactAngleRad + rippleState.span;
                                gfx.lineStyle(Math.max(0.4, 2 * rippleState.alpha), shieldColor, rippleState.alpha);
                                gfx.beginPath();
                                for (let s = 0; s <= 24; s++) {
                                    const t = a1 + (a2 - a1) * (s / 24);
                                    const px = targetShip.sprite.x + rippleState.rx * Math.cos(t);
                                    const py = targetShip.sprite.y + rippleState.ry * Math.sin(t);
                                    s === 0 ? gfx.moveTo(px, py) : gfx.lineTo(px, py);
                                }
                                gfx.strokePath();
                            };
                            drawShieldArc();

                            this.tweens.add({ targets: impactFlash, scale: 0.1, alpha: 0, duration: 200 / dt, ease: 'Cubic.easeOut', onComplete: () => impactFlash.destroy() });
                            this.tweens.add({
                                targets: rippleState, rx: 32, ry: 18, span: Math.PI * 0.6, alpha: 0,
                                duration: 1100 / dt, ease: 'Sine.easeOut',
                                onUpdate: drawShieldArc,
                                onComplete: () => { if (gfx) gfx.destroy(); }
                            });
                        }
                    } 
                    else if (closestEnemyTile && Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, closestEnemyTile.x, closestEnemyTile.y) <= u.range + (u.classType==='战列' || u.classType==='突击' || u.classType==='无' ? 0 : 60)) {
                         // [FIX-volley] 同舰炮分支：相位推进，不再全体钉回同一时刻
                         advanceAtkPhase(u, slotIdx);
                         const admAtk = myFac.admiralStats?.attack || 0;
                         // v29：与舰队速度乘区同口径——补给连续衰减（原为 >30 的二值开关）
                         const unitSupplyFactor = supplyFactor(u.supply);
                         // 士气衰减（同上）
                         const flMorale2 = (fleet.morale === undefined ? 100 : fleet.morale);
                         const moraleDmgMult = 0.6 + 0.4 * (flMorale2 / 100);
                         
                         const dist = Phaser.Math.Distance.Between(u.sprite.x, u.sprite.y, closestEnemyTile.x, closestEnemyTile.y);
                         const fireAngle = Math.atan2(closestEnemyTile.y - u.sprite.y, closestEnemyTile.x - u.sprite.x);
                         // [FIX-laser-density] 对地光束 50% 抽稀（2D/3D 同门），命中闪光全保留
                         const drawTileBeam = Math.random() < 0.5;
                         if (drawTileBeam) {
                             const tileLaser = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 3, myFac.color).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
                             const tileCore = this.add.rectangle(u.sprite.x, u.sprite.y, dist, 1, 0xffffff).setOrigin(0, 0.5).setRotation(fireAngle).setDepth(16);
                             this.tweens.add({ targets: [tileLaser, tileCore], alpha: 0, duration: 300 / dt, ease: 'Expo.easeOut', onComplete: () => { tileLaser.destroy(); tileCore.destroy(); } });
                         }
                         // 3D 覆盖层：对地激光 + 命中闪光
                         if (drawTileBeam) pushFx3d({ kind: 'laser', from: { x: u.sprite.x, y: u.sprite.y }, to: { x: closestEnemyTile.x, y: closestEnemyTile.y }, color: myFac.color });
                         pushFx3d({ kind: 'hit', at: { x: closestEnemyTile.x, y: closestEnemyTile.y }, color: myFac.color });

                         closestEnemyTile.hp -= ((u.atk + Math.floor(admAtk * 0.5) / typeShareOf(u.classType)) * unitSupplyFactor);

                         // v6.9 伊谢尔伦：要塞地块被攻击 → 同步扣雷神之锤主炮结构 HP，
                         //   瘫痪后主炮停火（对齐战役轨道"摧毁要塞 HP 10000 可瘫痪主炮"设定）。
                         if (closestEnemyTile.type === 'fortress' && this.fortressWeapon && !this.fortressWeapon.destroyed) {
                             this.fortressWeapon.fortressHp = Math.max(0, this.fortressWeapon.fortressHp - ((u.atk + Math.floor(admAtk * 0.5) / typeShareOf(u.classType)) * unitSupplyFactor));
                             if (this.fortressWeapon.fortressHp <= 0) {
                                 this.fortressWeapon.destroyed = true;
                                 this.fortressWeapon.isCharging = false;
                                 this.store.triggerToast('⚡ 伊谢尔伦要塞结构崩坏——雷神之锤主炮瘫痪！');
                             }
                         }

                         if (closestEnemyTile.hp <= 0) { 
                             const oldOwnerFac = this.factionMap.get(closestEnemyTile.ownerId);
                             if (oldOwnerFac) {
                                 if (closestEnemyTile.type === 'barracks') { oldOwnerFac.buildCounts.barracks = Math.max(0, oldOwnerFac.buildCounts.barracks - 1); oldOwnerFac.goldRate -= 1; }
                                 else if (closestEnemyTile.type === 'gold_mine') { oldOwnerFac.buildCounts.mines = Math.max(0, oldOwnerFac.buildCounts.mines - 1); oldOwnerFac.goldRate -= 4; }
                                 else if (closestEnemyTile.type === 'tower') { oldOwnerFac.buildCounts.towers = Math.max(0, oldOwnerFac.buildCounts.towers - 1); oldOwnerFac.goldRate -= 1; }
                                 else if (closestEnemyTile.type === 'planet') { oldOwnerFac.goldRate -= 15; }
                             }

                             if (closestEnemyTile.type === 'castle') {                              
                                 const targetFac = this.factionMap.get(closestEnemyTile.ownerId);
                                 if (targetFac && targetFac.active) {
                                     targetFac.goldRate = Math.max(0, targetFac.goldRate - 20);
                                     this.tilesList.filter((tx: any) => tx.ownerId === targetFac.id).forEach((tx: any) => {
                                         tx.ownerId = 0; tx.type = 'pending'; tx.connected = false;
                                         tx.sprite.setFillStyle(0x2d3446, 0.9); tx.sprite.setStrokeStyle(2, 0x475569, 1);
                                         tx.text.setText('').setAlpha(0);
                                     });
                                 }
                             } else {
                                 closestEnemyTile.ownerId = u.factionId;
                                 closestEnemyTile.sprite.setFillStyle(myFac.color, 0.9);
                                 closestEnemyTile.sprite.setStrokeStyle(3, myFac.color, 1.0);
                                 
                                 if (closestEnemyTile.type === 'pier') { closestEnemyTile.hp = 250; }
                                 else if (closestEnemyTile.type === 'planet') { closestEnemyTile.hp = 1000; }
                                 else { 
                                     closestEnemyTile.type = 'pending'; closestEnemyTile.hp = 150; closestEnemyTile.cost = 50; 
                                     closestEnemyTile.text.setText('').setAlpha(0); 
                                 }
                             }
                         }
                    }
                }
            });
        });

        // ===== v3 独立往返：运输舰每帧独立航行 + 2D sprite 同步 =====
        // moveAuxShips 推进独立坐标（朝目标舰队/母港）；sprite 跟随独立坐标而非舰队阵型。
        // 3D 侧 syncShips() 每帧读 u.sprite.x/y → 真模型（alliance_supply.glb 等）自动跟随。
        moveAuxShips(this.auxShips, dt);
        this.auxShips.forEach((aux: any) => {
            if (!aux.unit?.sprite || !aux.unit.sprite.active) return;
            const sp = aux.unit.sprite;
            const uDist = Phaser.Math.Distance.Between(sp.x, sp.y, aux.x, aux.y);
            // 显示层同样以固定步长跟随独立航行坐标，不能用指数插值吞掉积累误差。
            if (uDist > UNIT_CHASE_EPS) {
                const nextPosition = moveTowardsAtSpeed(
                    { x: sp.x, y: sp.y },
                    { x: aux.x, y: aux.y },
                    AUX_SPEED * dt,
                );
                sp.x = nextPosition.x;
                sp.y = nextPosition.y;
            }
            // 朝向 = 航向（容器 +X 为前进方向，贴图竖向需 +π/2 补偿，与作战舰一致）
            if (aux.unit.hp > 0) sp.rotation = aux.heading;
        });

        // ===== 航母舰载机系统：突击型舰船环绕母舰的护卫机群 =====
        this.globalFleets.forEach(fleet => {
            if (fleet.units.length === 0) return;
            fleet.units.forEach((u: any) => {
                if (u.classType !== '突击' && u.classType !== 'CV') return;
                // 每架母舰最多 6 架舰载机
                let fighters = this.carrierFighters.get(fleet.id);
                if (!fighters) {
                    fighters = [];
                    for (let i = 0; i < 6; i++) {
                        const fDot = this.add.circle(u.sprite.x, u.sprite.y, 1.5, 0x06b6d4).setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
                        fighters!.push(fDot);
                    }
                    this.carrierFighters.set(fleet.id, fighters);
                }
                const mx = u.sprite.x; const my = u.sprite.y;
                fighters.forEach((fDot, i) => {
                    const orbitAngle = time * 0.002 + (i / fighters!.length) * Math.PI * 2;
                    const orbitR = 18 + Math.sin(time * 0.003 + i) * 3;
                    fDot.x = mx + Math.cos(orbitAngle) * orbitR;
                    fDot.y = my + Math.sin(orbitAngle) * orbitR;
                    fDot.setAlpha(0.5 + Math.sin(time * 0.005 + i) * 0.3);
                });
            });
        });

        // 清理已死亡航母的舰载机
        for (const [fleetId, fighters] of this.carrierFighters.entries()) {
            const fleet = this.globalFleets.find(fl => fl.id === fleetId);
            const hasCV = fleet && fleet.units.some((u: any) => u.classType === '突击' || u.classType === 'CV');
            if (!hasCV) {
                fighters.forEach(f => f.destroy());
                this.carrierFighters.delete(fleetId);
            }
        }

        const uiData: any[] = [];
        const cam = this.cameras.main;
        const playerFac = this.store.factions.find((f: any) => f.type === 'player');
        
        // 【修复】视野共享：将所有友军阵营（与玩家同Team）纳入视野贡献节点
        const allyFactions = this.store.factions.filter((f: any) => f.team === playerFac?.team);
        const allyFactionIds = allyFactions.map((f: any) => f.id);
        const allyFleets = this.globalFleets.filter(fl => allyFactionIds.includes(fl.factionId));
        const allyVisionNodes = this.tilesList.filter(t => allyFactionIds.includes(t.ownerId) && (t.type === 'castle' || t.type === 'tower' || t.type === 'planet' || t.type === 'relay'));

        // 1. 初始化各阵营的实时统计数据与视野状态
        this.store.factions.forEach((f: any) => {
            f.inVision = (f.type === 'player');
            f.unitCount = 0;
            f.hp = 0;
            f.maxHp = 0;
            // [v57] 面板士气/补给聚合（口径见 types/game.ts Faction.morale 注释）：先清零，末尾换算均值
            f.morale = 0;
            f.supply = 0;
        });

        this.globalFleets.forEach(fl => {
            if (fl.units.length > 0) {
                const flagship = fl.units[0]; 
                const fac = this.factionMap.get(fl.factionId);
                
                if (fac) {
                    // 实时累加该阵营当前的建制数与绝对血量
                    fac.unitCount += fl.units.length;
                    fl.units.forEach((u: any) => { fac.hp += u.hp; fac.maxHp += u.maxHp; });
                    // [v57] 士气=舰队级 fl.morale 按舰数加权（末尾 ÷unitCount 得均值）；补给=舰级 u.supply 求和
                    fac.morale += (typeof fl.morale === 'number' ? fl.morale : 100) * fl.units.length;
                    fl.units.forEach((u: any) => { fac.supply += (typeof u.supply === 'number' ? u.supply : 100); });
                }

                // 2. 战争迷雾：敌方舰队默认隐藏，除非进入玩家视野
                let isVisible = true;
                if (fac && fac.team !== playerFac?.team) {
                    isVisible = false;
                    // 修复坐标：必须使用战舰 sprite 的绝对坐标计算视距
                    const fx = flagship.sprite.x;
                    const fy = flagship.sprite.y;

                    // 判断是否在友军高价值建筑视野内 (雷达半径 300)
                    for (const node of allyVisionNodes) {
                        if (Phaser.Math.Distance.Between(fx, fy, node.x, node.y) < 300) { isVisible = true; break; }
                    }
                    // 判断是否在友军舰队视野内 (普通视野 250，索敌姿态视野 450)
                    if (!isVisible) {
                        for (const pFl of allyFleets) {
                            if (pFl.units.length > 0) {
                                const px = pFl.units[0].sprite.x;
                                const py = pFl.units[0].sprite.y;
                                const visionRange = pFl.stance === 'search' ? 450 : 250;
                                if (Phaser.Math.Distance.Between(fx, fy, px, py) < visionRange) { isVisible = true; break; }
                            }
                        }
                    }
                }
                
                // 2.5 隐身检测：隐身舰队被敌方索敌单位发现 → 破隐
                if (fl.stance === 'stealth') {
                    let stealthBroken = false;
                    const enemyFleets = this.globalFleets.filter(
                        ef => ef.factionId !== fl.factionId && ef.stance === 'search' && ef.units.length > 0
                    );
                    for (const ef of enemyFleets) {
                        const ex = ef.units[0].sprite.x;
                        const ey = ef.units[0].sprite.y;
                        const detectRange = 450;
                        if (Phaser.Math.Distance.Between(flagship.sprite.x, flagship.sprite.y, ex, ey) < detectRange) {
                            stealthBroken = true;
                            break;
                        }
                    }
                    if (stealthBroken && !this.isStanceLocked(fl)) {   // [V18-B · B2] L3 常规：L1 锁期内不覆写姿态（含破除提示，防锁期逐帧 toast）
                        fl.stance = 'search';
                        fl.formation = 'spindle';
                        (fl as any).ambushReady = true;
                        this.store.triggerToast?.('敌踪暴露！隐身舰队被发现，转入索敌状态。');
                    }
                    // 隐身中可视化：己方半透明，敌方不可见
                    if (fac && fac.team === playerFac?.team) {
                        fl.units.forEach((u: any) => u.sprite.setAlpha(0.25));
                    } else if (!isVisible) {
                        fl.units.forEach((u: any) => u.sprite.setVisible(false));
                    }
                }
                
                // 3. 根据视野状态处理模型隐身与 UI 渲染
                if (fac && isVisible) {
                    fl.units.forEach((u: any) => { u.sprite.setVisible(true); });
                    if (fac.type !== 'player') fac.inVision = true;

                    const screenX = (flagship.sprite.x - cam.worldView.x) * cam.zoom;
                    const screenY = (flagship.sprite.y - cam.worldView.y) * cam.zoom;
                    uiData.push({
                        id: fl.id, x: screenX, y: screenY, name: fac.name, imageId: fac.imageId,
                        hp: flagship.hp, maxHp: flagship.maxHp, unitCount: fl.units.length,
                        supply: flagship.supply, team: fac.team, stance: fl.stance
                    });
                } else if (fac && fac.team !== playerFac?.team) {
                    fl.units.forEach((u: any) => { 
                        u.sprite.setVisible(false); 
                        // 强制隐藏挂载的血条或文本对象
                        if (u.hpBar) u.hpBar.setVisible(false);
                        if (u.text) u.text.setVisible(false);
                        // 如果游戏底层是全局统一 Graphics 绘制血条，需在此处将其 scale 或 alpha 设为 0
                    });
                }
            }
        });

        // 4. 将阵营绝对血量转换为 Vue 顶部 UI 进度条所需的百分比
        this.store.factions.forEach((f: any) => {
            if (f.maxHp > 0) { f.hp = (f.hp / f.maxHp) * 100; }
            else { f.hp = 0; }
            // [v57] 士气/补给：加权和 ÷ 总舰数 = 面板均值（0-100）；无存活舰时士气 0 / 补给 100
            if (f.unitCount > 0) { f.morale = f.morale / f.unitCount; f.supply = f.supply / f.unitCount; }
            else { f.morale = 0; f.supply = 100; }
        });
        
        this.store.fleetsUI = uiData;

        // （原「CRT 模式强制隐藏单位 sprite」块已随该模式删除）

        // 实时覆盖地块迷雾：不在玩家视野内的地块统一涂暗
        // CRT模式：使用CRT兼容alpha值而非完全跳过
        this.tilesList.forEach(t => {
            let tileVisible = false;
            for (const node of allyVisionNodes) {
                if (Phaser.Math.Distance.Between(t.x, t.y, node.x, node.y) < 350) { tileVisible = true; break; }
            }
            if (!tileVisible) {
                for (const pFl of allyFleets) {
                    if (pFl.units.length > 0) {
                        const px = pFl.units[0].sprite.x; const py = pFl.units[0].sprite.y;
                        const vRange = pFl.stance === 'search' ? 450 : 250;
                        if (Phaser.Math.Distance.Between(t.x, t.y, px, py) < vRange) { tileVisible = true; break; }
                    }
                }
            }

            if (tileVisible) t.explored = true;

            // ⚠ 以下只写「占位 sprite」的样式。指挥制下 `body.battle3d-mode` 会隐藏整个
            //   Phaser 画布 ⇒ 本段在正常战斗中不可见，只为 3D overlay 建不起来时的降级显示负责。
            if (!t.explored) {
                t.sprite.setFillStyle(0x0f172a, 1.0);
                t.sprite.setStrokeStyle(1, 0x0f172a, 1);
                if (t.text) t.text.setAlpha(0);
            } else {
                let fillColor = 0x2d3446; let strokeColor = 0x475569; let sWidth = 1;
                const ownerFac = t.ownerId !== 0 ? this.factionMap.get(t.ownerId) : undefined;
                if (ownerFac) { fillColor = ownerFac.color; strokeColor = ownerFac.color; sWidth = 2; }
                else if (t.type === 'sea') { fillColor = 0x1e3a8a; strokeColor = 0x2563eb; }
                else if (t.type === 'ruined') { fillColor = 0x1c1917; strokeColor = 0x44403c; }
                else if (t.type === 'pier') { fillColor = 0x0284c7; strokeColor = 0x0ea5e9; }
                else if (t.type === 'planet') { fillColor = 0x92400e; strokeColor = 0xf59e0b; }
                else if (t.type === 'fortress') { fillColor = 0x3a3a4a; strokeColor = 0x8a8a9a; sWidth = 2; }
                else if (t.type === 'mine') { fillColor = 0x8B6914; strokeColor = 0xd4a017; }
                else if (t.type === 'tower') { fillColor = 0x4a3a6a; strokeColor = 0x9a7acc; sWidth = 2; }

                if (!tileVisible) {
                    t.sprite.setAlpha(1.0);
                    t.sprite.setFillStyle(fillColor, 0.4);
                    t.sprite.setStrokeStyle(sWidth, strokeColor, 0.4);
                    if (t.text) t.text.setAlpha(0.25);
                } else {
                    if (t.ownerId !== 0 && !t.connected && t.type !== 'castle' && t.type !== 'planet') {
                        t.sprite.setAlpha(1.0);
                        t.sprite.setFillStyle(fillColor, 0.3);
                        t.sprite.setStrokeStyle(2, 0xff0000, 0.7);
                    } else {
                        t.sprite.setAlpha(0.9);
                        t.sprite.setFillStyle(fillColor, 1.0);
                        t.sprite.setStrokeStyle(sWidth, strokeColor, 1.0);
                    }

                    if (t.text) {
                        const txtAlpha = (t.type === 'sea' || t.type === 'ruined' || t.type === 'pending') ? 0.0 : 0.8;
                        t.text.setAlpha(t.type === 'castle' ? 1.0 : txtAlpha);
                    }
                }
            }
        });

        // 接壤高亮：可扩张空域描边（仅 2D 降级路径可见）
        if (pFac) {
            this.tilesList.forEach(t => {
                if (t.ownerId === 0 && t.type !== 'sea' && t.type !== 'ruined' && t.type !== 'planet') {
                    if (this.isAdjacentToTeam(t, pFac.team) && pFac.gold >= t.cost) {
                        const glowAlpha = 0.2 + 0.3 * Math.abs(Math.sin(time * 0.002));
                        t.sprite.setStrokeStyle(2, 0x0ea5e9, glowAlpha);
                    }
                }
            });
        }

        // 要塞武器更新（v6.9：不再限战役轨道——演习轨道伊谢尔伦图同样初始化 fortressWeapon）
        if (this.fortressWeapon && !this.fortressWeapon.destroyed) {
            this.updateFortressWeapon(this.game.loop.delta);
        }

        // [v57] 战中提督闲聊调度：部署期不开口；开战 25s 后第一句，之后每 30~55s 一句
        if (!(this.store as any).battleDeployPhase) {
            if (this.nextBanterAt === 0) this.nextBanterAt = this.time.now + 25000;
            else if (this.time.now >= this.nextBanterAt) {
                this.nextBanterAt = this.time.now + 30000 + Math.random() * 25000;
                this.emitBanter();
            }
        }

        this.checkGameEnd();
    
    }

    // 渲染漫画风对话气泡（固定于头像框右侧）
    // [v58] customText：banter 闲聊由 emitBanter 预选台词（含防连续重复），事件台词仍从池内随机
    private showFleetDialogue(fleet: any, eventType: string, isDefeat: boolean = false, customText?: string) {
        const myFac = this.factionMap.get(fleet.factionId);
        if (!myFac) return;
        if (myFac.team !== 1 && !myFac.inVision) return;

        const admName = myFac.name.replace('舰队', ''); 
        let pool = battleDialogues[admName]?.[eventType] || battleDialogues['general']?.[eventType];
        if (customText === undefined && (!pool || pool.length === 0)) return;

        const text = customText ?? pool![Math.floor(Math.random() * pool!.length)];
        // [v58] 单例气泡：任意时刻至多一个在场气泡，新建前杀掉旧气泡补间并销毁，杜绝互相遮挡
        this.activeDialogues.forEach(b => { this.tweens.killTweensOf(b); b.destroy(); });
        this.activeDialogues = [];
        const targetShip = isDefeat ? null : fleet.units[0];
        
        const cam = this.cameras.main;
        const targetZoom = 1 / cam.zoom; // 目标 UI 缩放级
        
        // 初始坐标（若是击毁状态则固定在原地）
        const px = isDefeat ? fleet.x + (90 * targetZoom) : targetShip?.sprite?.x;
        const py = isDefeat ? fleet.y - (40 * targetZoom) : targetShip?.sprite?.y;
        if (px === undefined || py === undefined) return;

        const bubble = this.add.container(px, py).setDepth(100); // 调高层级避免被挡
        const bg = this.add.graphics();
        
        const bgColor = 0x0f172a; 
        bg.fillStyle(bgColor, 0.95).lineStyle(2, myFac.color, 1);
        
        const txt = this.add.text(0, 0, text, {
            fontSize: '12px', color: '#f8fafc', padding: { x: 10, y: 6 },
            wordWrap: { width: 140 }, align: 'center', fontFamily: 'sans-serif', fontStyle: 'bold'
        }).setOrigin(0.5);

        const bW = txt.width + 16; const bH = txt.height + 12;
        
        // 绘制带圆角的气泡主体
        bg.fillRoundedRect(-bW/2, -bH/2, bW, bH, 6).strokeRoundedRect(-bW/2, -bH/2, bW, bH, 6);
        
        // 绘制指向左侧（头像框方向）的对话尾巴
        bg.fillTriangle(-bW/2, 0, -bW/2 - 12, 6, -bW/2, 12);
        bg.strokeTriangle(-bW/2, 0, -bW/2 - 12, 6, -bW/2, 12);
        // 擦除连接处的线条
        bg.lineStyle(3, bgColor, 1).beginPath().moveTo(-bW/2, 1).lineTo(-bW/2, 11).strokePath();
        
        bubble.add([bg, txt]);

        // [v58] 统一入列 activeDialogues 参与单例清理；targetShip 为 null（击毁语录）时跟随循环跳过定位
        bubble.setData('targetShip', targetShip);
        this.activeDialogues.push(bubble);

        bubble.setScale(0);
        this.tweens.add({
            targets: bubble, scale: targetZoom, duration: 300, ease: 'Back.easeOut', // 弹到 UI 对应的大小
            onComplete: () => {
                this.tweens.add({
                    targets: bubble, alpha: 0, delay: 2500, duration: 400,
                    onComplete: () => {
                        bubble.destroy();
                        this.activeDialogues = this.activeDialogues.filter(b => b !== bubble);
                    }
                });
            }
        });
    }

    /** [v57→v58] 战中提督闲聊：随机可见提督 → 台词池（专属 banter 优先、general 兜底）→ 旗舰位置浮动气泡。
     *  [v58] 不再走 GameHeader 右侧立绘卡（store.showDialog）——会被军议任务指令侧栏遮挡；
     *  改调 showFleetDialogue(fl, 'banter', false, text) 以旗舰气泡呈现（预选台词含防连续重复），
     *  与事件台词同一呈现层、单例互不遮挡。
     *  ⚠ 选人前先按可见性过滤（不可见敌舰直接排除）：否则随机选中迷雾敌舰会静默吞掉一次
     *    发言配额（探针实测 calls=0 而 nextBanterAt 已重排的根因）。 */
    private emitBanter() {
        const cands = this.globalFleets.filter(fl => {
            if (fl.units.length === 0) return false;
            const fac = this.factionMap.get(fl.factionId);
            return !!fac && (fac.team === 1 || fac.inVision);
        });
        if (!cands.length) return;
        const fl = cands[Math.floor(Math.random() * cands.length)];
        const fac = this.factionMap.get(fl.factionId)!;
        const admName = String(fac.name).replace('舰队', '');
        const pool = battleDialogues[admName]?.['banter'] || battleDialogues['general']?.['banter'];
        if (!pool || pool.length === 0) return;
        let text = pool[Math.floor(Math.random() * pool.length)];
        if (pool.length > 1 && text === this.lastBanterText) {
            text = pool[(pool.indexOf(text) + 1) % pool.length];   // 防连续重复同一句
        }
        this.lastBanterText = text;
        this.showFleetDialogue(fl, 'banter', false, text);   // [v58] 旗舰位置浮动气泡（单例），替代右侧立绘卡
    }

    // ===== 伊谢尔伦要塞武器系统 =====
    private updateFortressWeapon(deltaMs: number) {
        if (!this.fortressWeapon || this.fortressWeapon.destroyed) return;
        const fw = this.fortressWeapon;

        // 显示 HP 条（受损时）
        if (fw.fortressHp < fw.fortressMaxHp) {
            fw.hpBarBg.setVisible(true);
            fw.hpBarFill.setVisible(true);
            const pct = Math.max(0, fw.fortressHp / fw.fortressMaxHp);
            fw.hpBarFill.width = 80 * pct;
        }

        // 速度因子
        const speedFactor = (this.store.currentSpeedFactor?.value ?? this.store.currentSpeedFactor) ?? 1;
        fw.chargeTimer += deltaMs * speedFactor;

        // 首次发射前等待 firstFireDelay，后续等 chargeInterval
        const threshold = fw.chargeTimer < fw.firstFireDelay ? fw.firstFireDelay : fw.chargeInterval;
        // 修正：如果已经超过首次，用 interval 判断
        const totalTimer = fw.chargeTimer;
        const shouldFire = totalTimer >= fw.firstFireDelay && (totalTimer - fw.firstFireDelay) % fw.chargeInterval < deltaMs * speedFactor + 1;

        // 更简单：用离散计数
        if (fw.chargeTimer >= fw.firstFireDelay && !fw.isCharging) {
            // 检查是否到了发射周期（首次或每 interval）
            const elapsedSinceFirst = fw.chargeTimer - fw.firstFireDelay;
            if (elapsedSinceFirst < deltaMs * speedFactor + 1 || (elapsedSinceFirst > 0 && elapsedSinceFirst % fw.chargeInterval < deltaMs * speedFactor + 1)) {
                fw.isCharging = true;
                this.startFortressCharge();
            }
        }
    }

    private startFortressCharge() {
        const fw = this.fortressWeapon!;
        const chargeDuration = 5000; // 5秒充能
        // v6.9：3D 覆盖层充能光球（指挥制 Phaser 画布隐藏，纯 Phaser VFX 不可见）
        pushFx3d({ kind: 'fortress_charge', at: { x: fw.fortressX, y: fw.fortressY }, color: 0x60a5fa, duration: chargeDuration });
        // === 充能 VFX：三层效果 ===
        // 1. 核心聚能光球（快速膨胀 + 脉冲）
        const corePulse = this.add.circle(fw.fortressX, fw.fortressY, 5, 0x60a5fa, 0.4)
            .setDepth(49).setBlendMode(Phaser.BlendModes.ADD);
        // 2. 外围能量环（缓慢扩大）
        const outerRing = this.add.circle(fw.fortressX, fw.fortressY, 10, 0x000000, 0)
            .setDepth(48);
        outerRing.setStrokeStyle(2, 0x3b82f6, 0.6);
        // 3. 粒子向内汇聚
        const particles: Phaser.GameObjects.Arc[] = [];
        for (let i = 0; i < 8; i++) {
            const pAngle = (Math.PI * 2 * i) / 8;
            const pDist = 40 + Math.random() * 30;
            const p = this.add.circle(
                fw.fortressX + Math.cos(pAngle) * pDist,
                fw.fortressY + Math.sin(pAngle) * pDist,
                2, 0x93c5fd, 0.7
            ).setDepth(49).setBlendMode(Phaser.BlendModes.ADD);
            particles.push(p);
        }

        this.tweens.addCounter({
            from: 0, to: 1, duration: chargeDuration,
            ease: 'Quad.easeIn',
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                const p = tween.getValue() ?? 0;
                // 核心脉冲：呼吸效果
                const pulse = 1 + Math.sin(p * 12) * 0.2;
                const coreRadius = 5 + p * 35 * pulse;
                corePulse.setRadius(coreRadius);
                corePulse.setAlpha(0.3 + p * 0.5);
                corePulse.setFillStyle(p > 0.7 ? 0xfbbf24 : 0x60a5fa, corePulse.alpha);

                // 外环扩大
                const ringRadius = 10 + p * 80;
                outerRing.setRadius(ringRadius);
                outerRing.setStrokeStyle(2 + p * 1.5, p > 0.6 ? 0xfbbf24 : 0x3b82f6, 0.3 + p * 0.5);

                // 粒子向内移动
                particles.forEach((pt, idx) => {
                    const baseAngle = (Math.PI * 2 * idx) / particles.length;
                    const curDist = 60 - p * 50; // 从60缩减到10
                    pt.x = fw.fortressX + Math.cos(baseAngle) * curDist;
                    pt.y = fw.fortressY + Math.sin(baseAngle) * curDist;
                    pt.setScale(1 + p * 1.5);
                    pt.setAlpha(p > 0.8 ? 0.9 : 0.4 + p * 0.5);
                });
            },
            onComplete: () => {
                corePulse.destroy(); outerRing.destroy();
                particles.forEach(pt => pt.destroy());
                // 充能完毕瞬间：要塞位置剧烈白光
                const chargeFlash = this.add.circle(fw.fortressX, fw.fortressY, 60, 0xffffff, 0.9)
                    .setDepth(55).setBlendMode(Phaser.BlendModes.ADD);
                this.tweens.add({
                    targets: chargeFlash, scale: 3, alpha: 0,
                    duration: 300, ease: 'Quad.easeOut',
                    onComplete: () => chargeFlash.destroy(),
                });
                this.fireFortressLaser();
                fw.isCharging = false;
                fw.chargeTimer = fw.firstFireDelay;
            },
        });
    }

    private fireFortressLaser() {
        const fw = this.fortressWeapon!;
        const target = this.selectFortressTarget();
        if (!target) return;

        const fx = fw.fortressX, fy = fw.fortressY;
        const tx = target.x, ty = target.y;
        const angle = Math.atan2(ty - fy, tx - fx);
        const dist = Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2);

        // === 屏幕震动：发射瞬间强烈震感 ===
        this.cameras.main.shake(600, 0.025);

        // === 全屏白闪：立即猛烈变白，然后缓慢消退 ===
        const flash = this.add.rectangle(
            this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY,
            this.cameras.main.width / this.cameras.main.zoom * 2,
            this.cameras.main.height / this.cameras.main.zoom * 2,
            0xffffff, 0.8
        ).setDepth(60).setScrollFactor(0);
        this.tweens.add({
            targets: flash, alpha: 0,
            duration: 600, ease: 'Cubic.easeOut',
            onComplete: () => flash.destroy(),
        });

        // === 多层同心光束（从粗到细、从外到内）===
        // v6.9：3D 覆盖层同步渲染三层雷神之锤光束（外晕/中层/核心）
        pushFx3d({ kind: 'fortress_beam', from: { x: fx, y: fy }, to: { x: tx, y: ty }, color: 0xf97316, width: 70, duration: 2500 });
        pushFx3d({ kind: 'fortress_beam', from: { x: fx, y: fy }, to: { x: tx, y: ty }, color: 0xfbbf24, width: 32, duration: 1800 });
        pushFx3d({ kind: 'fortress_beam', from: { x: fx, y: fy }, to: { x: tx, y: ty }, color: 0xffffff, width: 14, duration: 1200 });
        const createBeamLayer = (width: number, color: number, alpha: number, fadeDuration: number, delay: number) => {
            const beam = this.add.graphics().setDepth(50);
            beam.lineStyle(width, color, alpha);
            beam.lineBetween(fx, fy, tx, ty);
            // 光束两端加圆帽
            beam.fillStyle(color, alpha * 0.5);
            beam.fillCircle(fx, fy, width / 2);
            beam.fillCircle(tx, ty, width / 2);
            // 光晕：沿光束铺一层半透明粗线
            beam.lineStyle(width * 2.5, color, alpha * 0.15);
            beam.lineBetween(fx, fy, tx, ty);
            this.tweens.add({
                targets: beam, alpha: 0,
                duration: fadeDuration, delay: delay,
                ease: 'Cubic.easeIn',
                onComplete: () => beam.destroy(),
            });
            return beam;
        };

        // 外层光晕：极粗，橘红色，缓慢消散
        createBeamLayer(70, 0xf97316, 0.7, 2500, 0);
        // 中层光束：金色，中等粗细
        createBeamLayer(32, 0xfbbf24, 0.85, 1800, 100);
        // 内层核心：白热色，最亮
        createBeamLayer(14, 0xffffff, 0.95, 1200, 200);
        // 极细激光轨：纯白，先闪现再消失
        const tracer = this.add.graphics().setDepth(51);
        tracer.lineStyle(3, 0xffffff, 1);
        tracer.lineBetween(fx, fy, tx, ty);
        this.tweens.add({
            targets: tracer, alpha: 0,
            duration: 400, delay: 50,
            onComplete: () => tracer.destroy(),
        });

        // === 光束 "迸发" 动效 ===
        // 一束极宽的能量柱从要塞向前推进
        const burst = this.add.graphics().setDepth(52);
        const burstLength = Math.min(200, dist * 0.3);
        const burstEndX = fx + Math.cos(angle) * burstLength;
        const burstEndY = fy + Math.sin(angle) * burstLength;
        burst.fillStyle(0xffffff, 0.9);
        burst.fillCircle(burstEndX, burstEndY, 40);
        burst.fillStyle(0xfbbf24, 0.6);
        burst.fillCircle(burstEndX, burstEndY, 60);
        this.tweens.add({
            targets: burst, alpha: 0,
            duration: 350, delay: 50,
            ease: 'Quad.easeOut',
            onComplete: () => burst.destroy(),
        });

        // === 命中爆炸：多层冲击波 ===
        // 核心爆心
        const coreBoom = this.add.circle(tx, ty, 20, 0xffffff, 1)
            .setDepth(53).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: coreBoom, scale: 4, alpha: 0, duration: 1200, ease: 'Cubic.easeOut', onComplete: () => coreBoom.destroy() });

        // 冲击波圆环（第一道）
        for (let i = 1; i <= 3; i++) {
            const ring = this.add.circle(tx, ty, 30, 0x000000, 0) // 透明填充
                .setDepth(52);
            ring.setStrokeStyle(3 + i, i === 1 ? 0xfbbf24 : i === 2 ? 0xf97316 : 0xef4444, 0.8);
            this.tweens.add({
                targets: ring, scale: i + 2, alpha: 0,
                duration: 600 + i * 400, delay: i * 150, ease: 'Quad.easeOut',
                onComplete: () => ring.destroy(),
            });
        }

        // 碎片粒子飞散
        for (let i = 0; i < 12; i++) {
            const particleAngle = (Math.PI * 2 * i) / 12;
            const particle = this.add.rectangle(
                tx, ty, 3 + Math.random() * 3, 8 + Math.random() * 6,
                Math.random() > 0.5 ? 0xfbbf24 : 0xef4444, 0.9
            ).setDepth(53).setRotation(particleAngle);
            const speed = 80 + Math.random() * 120;
            this.tweens.add({
                targets: particle,
                x: tx + Math.cos(particleAngle) * speed,
                y: ty + Math.sin(particleAngle) * speed,
                alpha: 0, scale: 0.2,
                duration: 400 + Math.random() * 600,
                ease: 'Quad.easeOut',
                onComplete: () => particle.destroy(),
            });
        }

        // === 范围伤害（半径 2 格 = 2 * hexRadius 像素）===
        const damageRadius = this.hexRadius * 2;
        this.globalFleets.forEach(fl => {
            fl.units.forEach((u: any) => {
                if (u.hp <= 0) return;
                const dx = u.sprite.x - tx;
                const dy = u.sprite.y - ty;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= damageRadius) {
                    u.hp -= 1500;
                    if (u.sprite) {
                        const origAlpha = u.sprite.alpha;
                        u.sprite.setAlpha(0.3);
                        this.time.delayedCall(200, () => { if (u.sprite) u.sprite.setAlpha(origAlpha); });
                    }
                    if (u.hp <= 0) {
                        u.hp = 0;
                        if (u.sprite) {
                            const deathExp = this.add.circle(u.sprite.x, u.sprite.y, 15, 0xef4444, 0.7).setDepth(40);
                            this.tweens.add({ targets: deathExp, scale: 2, alpha: 0, duration: 500, onComplete: () => deathExp.destroy() });
                            u.sprite.setVisible(false);
                        }
                    }
                }
            });
        });
    }

    private selectFortressTarget(): { x: number, y: number } | null {
        const fw = this.fortressWeapon!;
        const enemyUnits: { x: number; y: number; hp: number }[] = [];
        const friendlyUnits: { x: number; y: number }[] = [];

        this.globalFleets.forEach(fl => {
            fl.units.forEach((u: any) => {
                if (u.hp <= 0 || !u.sprite) return;
                const pos = { x: u.sprite.x, y: u.sprite.y, hp: u.hp };
                if (fl.factionId === fw.ownerFactionId) friendlyUnits.push(pos);
                else enemyUnits.push(pos);
            });
        });
        if (enemyUnits.length === 0) return null;

        // 筛出有效目标：在射程内 + 在要塞正前方（右侧，x > fortressX）
        // 雷神之锤固定向左→右开火（回廊方向），只打要塞东侧的敌军
        const validTargets = enemyUnits.filter(e => {
            const dx = e.x - fw.fortressX;
            const dy = e.y - fw.fortressY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return dist <= fw.maxRange && e.x > fw.fortressX;
        });
        if (validTargets.length === 0) return null;

        // 按密度评分选最佳目标（HP 加权集群）
        const scanRadius = this.hexRadius * 2;
        const friendlyPenaltyRadius = this.hexRadius * 3;
        const BEAM_AVOID_WIDTH = 50; // 光束避让宽度，友军在此范围内则不射击

        let bestScore = -Infinity;
        let bestTarget: { x: number; y: number } | null = null;

        validTargets.forEach(enemy => {
            let score = 0;
            // 敌方密度加分
            enemyUnits.forEach(other => {
                const d = Math.sqrt((other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2);
                if (d <= scanRadius) score += other.hp * 0.01;
            });

            // 友方惩罚
            friendlyUnits.forEach(friend => {
                const d = Math.sqrt((friend.x - enemy.x) ** 2 + (friend.y - enemy.y) ** 2);
                if (d <= friendlyPenaltyRadius) score -= 0.5;
            });

            // 核心检查：光束是否穿过友军？
            // 从要塞到目标的线段，检查是否有友军单位在 BEAM_AVOID_WIDTH 范围内
            const beamBlocked = friendlyUnits.some(friend => {
                return this.pointToSegmentDist(
                    friend.x, friend.y,
                    fw.fortressX, fw.fortressY,
                    enemy.x, enemy.y
                ) < BEAM_AVOID_WIDTH;
            });
            // 友军在光束路径上 → 大幅降分，基本不选
            if (beamBlocked) score -= 50;

            if (score > bestScore) {
                bestScore = score;
                bestTarget = enemy;
            }
        });

        // 若最佳目标仍有友军在光路上 → 本轮不发射
        if (bestTarget) {
            const blocked = friendlyUnits.some(friend =>
                this.pointToSegmentDist(friend.x, friend.y, fw.fortressX, fw.fortressY, bestTarget!.x, bestTarget!.y) < BEAM_AVOID_WIDTH
            );
            if (blocked) return null;
        }
        return bestTarget;
    }

    /** 点到线段的最短距离（用于光路友军检测） */
    private pointToSegmentDist_(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const nearX = x1 + t * dx, nearY = y1 + t * dy;
        return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
    }
    private pointToSegmentDist = this.pointToSegmentDist_;

    /** 【待改5】舰队补给度 = 存活单位补给的算术平均（不再只读旗舰 units[0]，
     *  避免旗舰沉没/单点低补给误判全舰队断粮 → 假撤退/拒战）。空舰队按满补给。 */
    private fleetSupplyPct(fleet: any): number {
        const alive = (fleet.units || []).filter((u: any) => u.hp > 0);
        if (alive.length === 0) return 100;
        let sum = 0;
        alive.forEach((u: any) => { sum += (typeof u.supply === 'number' ? u.supply : 100); });
        return sum / alive.length;
    }

    private checkGameEnd() {
        if (this.store.gameOver) return;

        // 防御：战斗尚未初始化（舰队还没部署完）
        if (this.globalFleets.length === 0) return;

        // 1. 统计存活阵营与存活阵营(team)。team 内任一 faction 有存活单位即该 team 存活。
        const aliveFactions = new Set<number>();
        const aliveTeams = new Set<number>();
        this.globalFleets.forEach(fl => {
            if (hasCombatUnits(fl)) {
                aliveFactions.add(fl.factionId);
                const f = this.factionMap.get(fl.factionId);
                if (f && typeof f.team === 'number') aliveTeams.add(f.team);
            }
        });
        // 【待改6】胜负按 team 判定（多提督同队时 factionId 计数永不 ≤1，旧判定会漏结束）
        const battleOver = aliveTeams.size <= 1;

        const state = (this.store as any).tacticalState;
        const isCampaign = state && state.mode === 'campaign';

        // =======================================================
        // 轨道 A：大地图战役模式的独有结算（微观战损 -> 宏观回写）
        // =======================================================
        if (isCampaign) {
            if (battleOver) {
                this.store.gameOver = true;
                const winnerId = aliveFactions.size === 1 ? Array.from(aliveFactions)[0] : 0;
                
                // 战后清点：收集存活兵力并反推舰船数量
                const survivors: any[] = [];
                this.globalFleets.forEach(fl => {
                    const remainingSlots: any[] = [];
                    fl.units.forEach((u: any) => {
                        if (u.hp > 0) {
                            // [兵力回写] 与正向共用同一张 SHIP_TYPE_HP 表，不再写死 2000/1200/800 三元链。
                            // 优先用正向留在 unit 上的精确摊派兵力（避开 def/补给/科技倍率导致的漂移）；
                            // 退化时才用 HP 表反推。type 统一归一为英文 key，保证下游 composition 能对上。
                            const shipType = resolveShipType(u.classType) ?? resolveShipType(u.type);
                            const baseHp = shipType ? SHIP_TYPE_HP[shipType] : undefined;
                            let count: number;
                            if (typeof u.shipCount === 'number' && u.shipCount > 0) {
                                count = Math.max(1, Math.round(u.shipCount));
                            } else if (baseHp) {
                                count = Math.max(1, Math.ceil((u.hp / baseHp) * SHIP_SCALE));
                            } else {
                                count = Math.max(1, Math.ceil((u.hp / SHIP_TYPE_HP.destroyer) * SHIP_SCALE));
                            }

                            remainingSlots.push({
                                x: u.gridX, // 注意：前面让你在 spawnStrategicFleets 里存的 gridX 和 gridY
                                y: u.gridY,
                                type: shipType || 'destroyer',
                                count: count
                            });
                        }
                    });
                    survivors.push({ fleetId: fl.id, remainingSlots });
                });

                // 呼叫 Store 战略中枢进行宏观回写
                if (typeof this.store.resolveCampaignBattle === 'function') {
                    this.store.resolveCampaignBattle(winnerId, survivors);
                }
                
                // 彻底卸载战术物理引擎，平滑切回大地图
                this.scene.stop();
                return;
            }
        } 
        // =======================================================
        // 轨道 B：演习小游戏模式的结算逻辑 (保留原版 UI 弹窗)
        // =======================================================
        else {
            if (battleOver) {
                this.store.gameOver = true;
                const playerFac = this.store.factions.find((f: any) => f.type === 'player');
                const playerTeam = playerFac?.team ?? 1;
                const winnerTeam = aliveTeams.size === 1 ? Array.from(aliveTeams)[0] : 0;
                this.store.isWin = winnerTeam === playerTeam;

                // P4c 最后一击慢镜头
                try {
                    this.cameras.main.setZoom(1.5);
                    this.cameras.main.shake(600, 0.008);
                    this.time.delayedCall(2500, () => this.cameras.main.setZoom(1));
                } catch (e) { /* 镜头动画非关键路径 */ }

                // 如果是战败，走原有逻辑
                if (!this.store.isWin) {
                    this.store.winStatus = 'defeat';
                } else {
                    // ── P3 战损结算：胜利奖励按战损率加权 ──
                    // 战损率 = 本场玩家损失舰数 / (损失 + 存活)；完胜上浮50%，惨胜下浮30%
                    const playerFleet = this.globalFleets.find(fl => fl.factionId === playerFac?.id);
                    const survivingShips = playerFleet ? playerFleet.units.length : 0;
                    const totalCommitted = survivingShips + this.battleLosses.ships;
                    const lossRate = totalCommitted > 0 ? this.battleLosses.ships / totalCommitted : 0;
                    const baseGold = this.store.rewardGold || 350;
                    if (lossRate < 0.1 && this.battleLosses.ships === 0) {
                        // 完胜：一舰未失
                        this.store.rewardGold = Math.round(baseGold * 1.5);
                        (this.store as any).triggerToast?.('完胜！舰队无一损失，军费奖励上浮50%。');
                    } else if (lossRate > 0.5) {
                        // 惨胜：过半战舰有去无回
                        this.store.rewardGold = Math.max(10, Math.round(baseGold * 0.7));
                        (this.store as any).triggerToast?.(`因舰队损失惨重（${this.battleLosses.ships} 艘），军费奖励削减30%。`);
                    }
                    if ((this.store as any).addBattleLog) {
                        (this.store as any).addBattleLog({ text: `战损结算：损失 ${this.battleLosses.ships} 舰 · 抚恤 ₮${Math.round(this.battleLosses.pension / 10000)}万 · 战损率 ${(lossRate * 100).toFixed(0)}%`, type: 'battle' });
                    }
                }
            }
        }
    }
    // （原 `crt/CrtRenderer.ts` 的委托方法已随「全息战术投影」模式一并删除：
    //   drawCRTBackground / renderCRTWireframeMap / updateCRTEffects / redrawCRTFleets / drawCRTOverlays）
}
