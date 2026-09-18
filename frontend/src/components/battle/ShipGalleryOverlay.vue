<!--
  ShipGalleryOverlay.vue — 模型巡览（QA 工具）
  一次性加载 assets/ship/ 下全部舰船 GLB + assets/scene/ 下全部 3D 建筑 GLB
  + assets/anim/ 下全部**动作模型 FBX**（自带动画，丢进文件夹即出现），
  按「通用战舰/专属旗舰 × 帝国/同盟 + 3D 建筑 + 动作模型」分区块排布，
  每件上方悬浮名称标签（专属旗舰带提督头像），舰船带舰尾推进火焰用于识别朝向。
  复用 shipModels.ts / sceneProps.ts / animModels.ts 注册表（与战斗层共享缓存 + 并发限流）。
  操作：左键拖拽旋转 / 滚轮缩放 / 右键平移。
-->
<template>
  <div class="gallery-root">
    <div ref="canvasHost" class="gallery-canvas"></div>
    <div ref="labelHost" class="gallery-labels"></div>

    <div class="gallery-hud">
      <div class="gh-title">⬡ 模型巡览（舰艇 / 3D 建筑 / 动作模型）</div>
      <div class="gh-stat">
        模型 {{ readyCount + failedCount }}/{{ totalCount }}
        <template v-if="readyCount"> · 总面数 {{ totalTris.toLocaleString() }} · 均面 {{ avgTris.toLocaleString() }}</template>
        <span v-if="failedCount" class="gh-fail"> · 失败 {{ failedCount }}</span>
        <span v-if="loadingCount" class="gh-loading"> · 加载中…</span>
      </div>
      <div v-if="propCount === 0" class="gh-tip">
        3D 建筑板块为空：把模型按 `{设施键}.glb` 放进 `frontend/src/assets/scene/` 后重启
      </div>
      <div v-else-if="unregisteredCount > 0" class="gh-tip">
        未登记尺寸 {{ unregisteredCount }} 件 → 兜底 2.0×hexR（在 sceneProps.ts 的 SCENE_PROP_CONFIG 按文件名加一行即可单独设）
      </div>
      <div v-if="animCount === 0" class="gh-tip">
        动作模型板块为空：把 `.fbx` 放进 `frontend/src/assets/anim/` 后重启（一个 fbx = 一段动作，自动循环播放）
      </div>
      <div class="gh-legend">
        <span><i style="background:#f43f5e"></i>帝国</span>
        <span><i style="background:#38bdf8"></i>同盟</span>
        <span><i style="background:#4ade80"></i>3D 建筑</span>
        <span><i style="background:#22d3ee"></i>动作模型 / 未分类</span>
      </div>
      <div class="gh-tip">左键旋转 · 滚轮缩放 · 右键平移 · <b>单击舰船 / 建筑可选中，调朝向 · 姿态 · 动画</b></div>
      <div class="gh-yaw">
        <span class="gh-fx-label">
          <template v-if="yawSelKind === 'prop'">建筑姿态：绕 X 轴 = <b>竖起来</b>，绕 Y 轴 = 朝向：</template>
          <template v-else>朝向修正（选中舰船，看橙色尾焰应在<b>舰体最后端</b>）：</template>
        </span>
        <template v-if="yawSel">
          <b class="gh-yaw-name">{{ yawSel }}</b>
          <span class="gh-yaw-val">朝向 {{ yawDeg }}°</span>
          <button v-for="d in [0, 90, 180, 270, -90]" :key="'y' + d" :class="{ active: yawDeg === d }" @click="setYaw(d)">{{ d }}°</button>
          <button class="gh-yaw-copy" @click="copyYawLine">📋 复制配置行</button>
        </template>
        <span v-else class="gh-yaw-hint">（未选中 · 在 3D 视图里单击任意舰船 / 建筑）</span>
      </div>
      <div v-if="yawSel && yawSelKind === 'prop'" class="gh-yaw">
        <span class="gh-fx-label">竖起（绕 X，平躺的环 / 盘填 <b>90</b>）：</span>
        <button v-for="d in [0, 90, -90, 180]" :key="'p' + d" :class="{ active: propPitch === d }" @click="setPropPitch(d)">{{ d }}°</button>
        <span class="gh-fx-label gh-yaw-gap">自旋动画（度/秒）：</span>
        <button v-for="p in SPIN_PRESETS" :key="'s' + p.key" :class="{ active: propSpinKey === p.key }" @click="setPropSpin(p)">{{ p.label }}</button>
        <span class="gh-yaw-val">绕 Y {{ propSpin.y }} / X {{ propSpin.x }} / Z {{ propSpin.z }}</span>
      </div>
      <div v-if="yawCopied" class="gh-tip">{{ yawCopied }}</div>
      <div class="gh-fx">
        <span class="gh-fx-label">特效测试（第一艘舰为靶）：</span>
        <button @click="fireLaser">⚡ 激光</button>
        <button @click="fireMissiles">🚀 导弹</button>
        <button @click="fireShield">🛡 护盾</button>
        <button @click="fireHit">💥 命中</button>
      </div>
      <div class="gh-fx">
        <span class="gh-fx-label">喷口标注（点模型打点 → <b>扫描该处开口</b>求形状；<b>近点自动并成一块</b>）：</span>
        <button :class="{ active: markMode }" @click="markMode = !markMode">📍 {{ markMode ? '标注中…（点模型）' : '标注喷口' }}</button>
        <span class="gh-fx-label gh-yaw-gap">搜索半径</span>
        <button v-for="r in [0.04, 0.06, 0.075, 0.1]" :key="'mr' + r" :class="{ active: markR === r }" @click="markR = r">{{ r }}</button>
        <span class="gh-fx-label gh-yaw-gap">形状来源</span>
        <button :class="{ active: markModeSel === 'scan' }" @click="setMarkMode('scan')">扫描内框</button>
        <button :class="{ active: markModeSel === 'convex' }" @click="setMarkMode('convex')">外轮廓</button>
        <button :class="{ active: markModeSel === 'inner' }" @click="setMarkMode('inner')">内框线</button>
        <span class="gh-fx-label gh-yaw-gap">缩放</span>
        <button v-for="sc in [0.5, 0.7, 0.85, 1]" :key="'ms' + sc" :class="{ active: markScale === sc }" @click="setMarkScale(sc)">{{ sc }}</button>
        <span class="gh-yaw-val">{{ markSel || '（未标）' }} · {{ markCount }} 点 · 模式 {{ markModeSel }} ×{{ markScale }}</span>
        <span v-if="scanInfo" class="gh-yaw-val">{{ scanInfo }}</span>
        <button class="gh-yaw-copy" @click="copyMarkLine">📋 复制标注行</button>
        <button @click="clearMarks">🗑 清除该舰标注</button>
      </div>
      <div v-if="anchorInfo" class="gh-tip">
        <template v-if="anchorInfo.kind === 'anchor'">✅ 该模型<b>自带喷口锚点 ×{{ anchorInfo.n }}</b>（{{ anchorInfo.names }}）—— 优先于手点标注与自动探测，无需再标</template>
        <template v-else-if="anchorInfo.kind === 'marks'">🖐 该模型无自带锚点，当前按<b>你手点的 {{ markCount }} 个标注</b>生成</template>
        <template v-else>🤖 该模型无自带锚点也无标注，当前用<b>自动探测</b>；要精确请在 Blender 里放 <code>FX_ENGINE_*</code> 空物体（见 docs/design/3d-tactical-battle/20-model-fx-anchors.md）</template>
      </div>
      <div v-if="markCopied" class="gh-tip">{{ markCopied }}</div>
    </div>

    <button class="gallery-close" @click="emit('close')">✕ 关闭巡览</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { listShipModelFiles, acquireShipModelByFiles, ensureShipFxAnchors, FLAGSHIP_MODEL_ALIAS, getShipModelYawFix, setShipModelDetail, type ShipModelReg } from '../../game/three/shipModels';
import { useSettingsStore } from '../../store/settingsStore';
// 3D 建筑（战场设施）：assets/scene/ 下的 GLB——巡览内单开一个板块，命名与战场一致
import { listScenePropFiles, acquireScenePropByFiles, buildScenePropFromModel, getScenePropSlotOf, resolveScenePropConfig, advanceScenePropSpin, type ScenePropReg } from '../../game/three/sceneProps';
// 动作模型（FBX，自带动画）：assets/anim/ 下的 .fbx —— 丢进文件夹即出现，零登记；
//   一个 fbx = 一段动作（循环播），故不做动作切换 UI。
import { listAnimModelFiles, acquireAnimModel, instantiateAnimModel, ANIM_CN, ANIM_SHOW_HEIGHT, type AnimModelReg } from '../../game/three/animModels';
// [v23 特效同源] 激光/导弹/护盾/爆闪/尾焰全部来自 `game/three/battleFx` ——
//   战场 Battle3DOverlay 用的是同一个模块，巡览所见即战场所得。
import {
  makeShieldEntry, shieldFire, shieldStep,
  buildLaserEntry, laserStep, disposeLaserEntry,
  buildMissileSalvo, missileStep, disposeMissileEntry,
  buildHitEntry, hitStep, disposeHitEntry,
  getEnginePortsFor, buildEngineFx, ENGINE_PORT_MARKS_RUNTIME, ENGINE_PORT_OPTS_RUNTIME,
  type ShieldEntry, type LaserEntry, type HitEntry, type MissileEntry,
  type PortShapeMode, type PortScanResult,
} from '../../game/three/battleFx';
import { admiralsData } from '../../config/admiralsData';
import { getPortrait } from '../../store/gameStore';
import { getShipScaleLength } from '../../game/three/shipModels';

const clock = new THREE.Clock();   // 特效测试台帧间隔

const emit = defineEmits<{ close: [] }>();
const canvasHost = ref<HTMLDivElement | null>(null);
const labelHost = ref<HTMLDivElement | null>(null);

const totalCount = ref(0);
const propCount = ref(0);   // 3D 建筑模型数（为 0 时 HUD 提示放置路径）
const animCount = ref(0);   // 动作模型（FBX）数（为 0 时 HUD 提示放置路径）
const unregisteredCount = ref(0);   // 未登记尺寸的建筑数（走兜底尺寸，HUD 提示如何单独设）

// ── 朝向 / 姿态 / 动画预览（v6.11 舰船朝向；v21 扩展到建筑：竖起 pitch + 自旋动画） ──
const yawSel = ref<string | null>(null);   // 选中的模型文件名（舰船或建筑）
const yawSelKind = ref<'ship' | 'prop'>('ship');   // 选中对象类型：决定 UI 行与"复制配置行"落到哪个文件
const yawDeg = ref(180);                   // 当前试转角度（= 拟写入配置的值）
const yawCopied = ref('');                 // 复制反馈
let yawBaseDeg = 180;                      // 该模型当前已烘焙的朝向修正
const shipGroups = new Map<string, THREE.Group>();   // fileName → 已摆放的舰船 group（供点选）
const propGroups = new Map<string, THREE.Group>();   // fileName → 已摆放的建筑 group（供点选 + 自旋预览）
/** 动作模型：fileName → { root, mixer }。每份实例独立 mixer（共享会把所有实例同步到同一相位） */
const animGroups = new Map<string, { root: THREE.Group; mixer: THREE.AnimationMixer }>();
/** 建筑重建索引：几何归注册表所有，改 pitch 时按此重建（比改外层 rotation 更正确——贴地会重算） */
const propRegsByFile = new Map<string, { reg: ScenePropReg; key: string; x: number; z: number }>();
// 建筑试转状态：pitch = 绕 X "竖起来"；spin = 自旋动画（度/秒）
const propPitch = ref(0);
const propSpinKey = ref('off');
const propSpin = ref({ x: 0, y: 0, z: 0 });
let propBase = { yaw: 0, pitch: 0, roll: 0, spinX: 0, spinY: 0, spinZ: 0 };   // 该建筑当前已烘焙的配置
/** 自旋预设：覆盖"关 / 绕竖轴缓慢 360° / 绕横轴翻滚 / 绕纵轴翻滚 / 复合"五类常用需求 */
const SPIN_PRESETS = [
  { key: 'off', label: '关',        x: 0,  y: 0,  z: 0 },
  { key: 'ys',  label: '绕竖轴·慢',  x: 0,  y: 12, z: 0 },
  { key: 'yf',  label: '绕竖轴·快',  x: 0,  y: 60, z: 0 },
  { key: 'x',   label: '绕横轴滚',   x: 30, y: 0,  z: 0 },
  { key: 'z',   label: '绕纵轴滚',   x: 0,  y: 0,  z: 30 },
  { key: 'mix', label: '复合',       x: 18, y: 24, z: 0 },
];
const readyCount = ref(0);
const failedCount = ref(0);
const loadingCount = ref(0);
const totalTris = ref(0);
const avgTris = ref(0);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let rafId = 0;
let pollTimer: number | null = null;
let disposed = false;

// ── 阵营色（同阵营统一；building = 3D 建筑板块专用色）──
const COLOR = { empire: 0xf43f5e, alliance: 0x38bdf8, neutral: 0x22d3ee, building: 0x4ade80 };
type Faction = 'empire' | 'alliance' | 'neutral' | 'building';

/** 3D 建筑巡览显示比例：1 hexR 折算多少巡览单位。
 *  战场尺寸 = SCENE_PROP_CONFIG.size × hexR；巡览取 9 保证要塞(4.5)不会超出区块间距，
 *  且各建筑之间的相对大小关系与战场一致（同比缩放，不改比例）。 */
const PROP_SHOW_UNIT = 9;

/** 建筑设施中文名（对应 assets/scene/ 文件键；命名规范见同级 模型命名规范.md） */
const PROP_CN: Record<string, string> = {
  relay: '中继补给站',
  base: '出生点 · 司令部基地',
  fortress: '要塞（伊谢尔伦）',
  planet: '宜居行星',
  mine: '资源矿点',
  tower: '防御塔',
  pier: '跳跃节点',
  castle: '地块定位标记',
};

// ════════════════════════════════════════════════════════════
// 特效测试台：**与战场同源**（v23）
// 激光 / 导弹 / 护盾 / 命中爆闪的几何·材质·时序全部来自 `game/three/battleFx.ts` ——
// 战场 Battle3DOverlay 用的是同一个模块，所以这里看到的**就是**战场上的效果。
// （此前巡览自存一份副本，早已漂移：激光是又粗又连续的一条实线、导弹是旧款三维结构。）
// 以第一艘就绪舰为靶：点按钮即可预览，不必进真战斗。
// ════════════════════════════════════════════════════════════

// ── 特效基准尺度：巡览无 hexR（战场 hexR = 六角格外接圆半径，指挥制约 50），
//    取战列舰显示长度(18)折算。战场舰长/hexR ≈ 18~35，这里取中值 26 保证观感同档 ──
const FX_HEX_R = 26;

const fxShields: ShieldEntry[] = [];
const fxMissiles: MissileEntry[] = [];
const fxHits: HitEntry[] = [];
const fxLasers: LaserEntry[] = [];
let fxTarget: THREE.Group | null = null;   // 靶舰（第一艘就绪舰）

/** 靶点：靶舰中心稍抬（视觉打在舰身上） */
function fxTargetPoint(): { pos: THREE.Vector3; shipLen: number } | null {
  if (!fxTarget) return null;
  const p = fxTarget.position;
  return { pos: new THREE.Vector3(p.x, p.y + SHIP_LEN * 0.45, p.z), shipLen: SHIP_LEN };
}

/** 攻击起点：靶舰侧上方远处（与战斗层"对射"观感一致） */
function fxAttackFrom(dirSign = 1): THREE.Vector3 {
  const t = fxTargetPoint();
  if (!t) return new THREE.Vector3();
  return new THREE.Vector3(t.pos.x + dirSign * FX_HEX_R * 10, t.pos.y + FX_HEX_R * 2.5, t.pos.z + dirSign * FX_HEX_R * 4);
}

function fxSpawnLaser() {
  const t = fxTargetPoint();
  if (!t || !scene) return;
  const to = t.pos.clone();
  const L = buildLaserEntry(fxAttackFrom(-1), to, COLOR.alliance, FX_HEX_R);
  if (!L) return;
  scene.add(L.mesh);
  fxLasers.push(L);
  // 激光到靶 → 补一发命中爆闪（战斗层里 laser 与 hit 常成对出现）
  fxSpawnHit(to, COLOR.alliance);
}

function fxSpawnMissiles() {
  const t = fxTargetPoint();
  if (!t || !scene) return;
  const from = fxAttackFrom(1);
  const to = t.pos.clone();
  const color = COLOR.empire;
  for (const M of buildMissileSalvo(from, to, color, 4, FX_HEX_R)) {
    scene.add(M.mesh);
    fxMissiles.push(M);
  }
}

function fxSpawnShield() {
  const t = fxTargetPoint();
  if (!t || !scene) return;
  // 共享实现的入参是"来袭方向"（内部取反得 outward）；原实现自己算 outward ⇒ 此处不取反。
  const inward = fxAttackFrom(-1).sub(t.pos).setY(0).normalize();
  let s = fxShields.find(x => !x.active);
  if (!s) {
    s = makeShieldEntry();
    scene.add(s.mesh);
    fxShields.push(s);
  }
  shieldFire(s, t.pos, inward, t.shipLen, COLOR.alliance, FX_HEX_R);
}

function fxSpawnHit(at: THREE.Vector3, color: number) {
  if (!scene) return;
  const H = buildHitEntry(at, color, FX_HEX_R);
  scene.add(H.sprite);
  fxHits.push(H);
}

function fxUpdate(dt: number) {
  const sc = scene;
  if (!sc) return;
  // laser 淡出
  for (let i = fxLasers.length - 1; i >= 0; i--) {
    const L = fxLasers[i];
    if (!laserStep(L, dt)) continue;
    sc.remove(L.mesh);
    disposeLaserEntry(L);
    fxLasers.splice(i, 1);
  }
  // hit 淡出
  for (let i = fxHits.length - 1; i >= 0; i--) {
    const H = fxHits[i];
    if (!hitStep(H, dt, FX_HEX_R)) continue;
    disposeHitEntry(sc, H);
    fxHits.splice(i, 1);
  }
  // shield 三段动画
  for (const s of fxShields) if (s.active) shieldStep(s, dt);
  // missiles
  for (let i = fxMissiles.length - 1; i >= 0; i--) {
    const M = fxMissiles[i];
    const st = missileStep(M, dt, FX_HEX_R);
    if (st.hit) fxSpawnHit(M.to, M.color);
    if (st.done) {
      disposeMissileEntry(sc, M);
      fxMissiles.splice(i, 1);
    }
  }
}

function fireLaser() { fxSpawnLaser(); }
function fireMissiles() { fxSpawnMissiles(); }
function fireShield() { fxSpawnShield(); }
function fireHit() {
  const t = fxTargetPoint();
  if (t) fxSpawnHit(t.pos, COLOR.neutral);
}

// ── 布局常量（区块横向并排，组内子网格）──
const PER_BLOCK_COLS = 3;   // 每个区块每行几艘
const SHIP_DX = 34;         // 组内水平间距
const SHIP_DZ = 30;         // 组内行间距
const BLOCK_GAP = 46;       // 区块之间间距
const HEADER_LIFT = 18;     // 标题在区块前方的抬升
const SHIP_LEN = 18;

// ── 中文名解析（数据驱动，无对应回落文件名）──
const flagshipKeyToCn: Record<string, string> = {};
for (const [cn, key] of Object.entries(FLAGSHIP_MODEL_ALIAS)) flagshipKeyToCn[key] = cn;
const flagshipNameToAdmiral: Record<string, any> = {};
for (const a of admiralsData as any[]) { if (a.flagshipName) flagshipNameToAdmiral[a.flagshipName] = a; }

const CLASS_CN: Record<string, string> = {
  battleship: '战列舰', fast_battleship: '高速战列舰', cruiser: '巡洋舰',
  destroyer: '驱逐舰', carrier: '航母', supply: '补给运输舰', fighter: '舰载机',
};
const FACTION_CN: Record<string, string> = { empire: '帝国', alliance: '同盟' };

interface ShipInfo {
  fileName: string;
  faction: Faction;
  kind: 'generic' | 'flagship' | 'other' | 'building' | 'anim';
  /** 舰种 key（battleship/cruiser/…），用于查询舰船长度等属性 */
  shipType?: string;
  /** 旗舰中文名（flagshipName），用于查询专属旗舰长度 */
  flagshipName?: string;
  /** 3D 建筑：设施键（relay/base/fortress…），用于取 SCENE_PROP_CONFIG 尺寸 */
  propKey?: string;
  title: string;
  sub: string;
  portrait?: string;
  x: number; z: number;   // 预计算世界坐标
}

/** 由文件名解析阵营/类别/中文名/头像（阵营对旗舰取拥有提督的 faction，而非文件名字符串） */
function resolveShip(fileName: string): Omit<ShipInfo, 'x' | 'z'> {
  const base = fileName.replace(/\.glb$/i, '');

  // 专属旗舰：flagship_{key}.glb → 查 FLAGSHIP_MODEL_ALIAS 得中文名 → 查提督阵营
  const fsMatch = base.match(/^flagship_(.+)$/);
  if (fsMatch) {
    const cn = flagshipKeyToCn[fsMatch[1]];
    if (cn) {
      const adm = flagshipNameToAdmiral[cn];
      const faction: Faction = adm ? (adm.faction === 'empire' ? 'empire' : adm.faction === 'alliance' ? 'alliance' : 'neutral') : 'neutral';
      return {
        fileName, faction, kind: 'flagship', title: cn,
        sub: adm ? `${adm.name} 座舰` : '专属旗舰',
        portrait: adm ? getPortrait(adm.imageId) : undefined,
        shipType: 'battleship',  // 旗舰体型按战列舰
        flagshipName: cn,        // 用于查 FLAGSHIP_LENGTH 专属长度
      };
    }
    return { fileName, faction: 'neutral', kind: 'flagship', title: `专属旗舰·${fsMatch[1]}`, sub: fileName, shipType: 'battleship' };
  }

  const facMatch = base.match(/^(empire|alliance)_(.+)$/);
  if (facMatch) {
    const faction = facMatch[1] as Faction;
    const clsKey = facMatch[2];
    const cls = CLASS_CN[clsKey] || clsKey;
    return {
      fileName, faction, kind: 'generic',
      title: `${FACTION_CN[facMatch[1]]}·${cls}`, sub: fileName,
      shipType: clsKey,  // 如 battleship / carrier / destroyer …
    };
  }

  if (CLASS_CN[base]) return { fileName, faction: 'neutral', kind: 'generic', title: `通用·${CLASS_CN[base]}`, sub: fileName, shipType: base };

  return { fileName, faction: 'neutral', kind: 'other', title: base, sub: '（数据无对应）' };
}

/** 3D 建筑（assets/scene/）→ 巡览条目。
 *  命名规范：{设施键}.glb，可选阵营差异 {设施键}_{empire|alliance}.glb；
 *  **不规范命名同样展示**（标题用文件名，尺寸走兜底 2.0×hexR，标签会标注）。
 *  副标题含尺寸来源与绑定关系，便于对照 sceneProps.ts 调整。 */
function resolveSceneProp(fileName: string): Omit<ShipInfo, 'x' | 'z'> {
  const base = fileName.replace(/\.glb$/i, '');
  const facMatch = base.match(/^(.+)_(empire|alliance)$/);
  const key = facMatch ? facMatch[1] : base;
  const cn = PROP_CN[key] || key;
  // 尺寸口径与战场完全一致（resolveScenePropConfig：文件登记 → 绑定槽位 → 兜底）
  const slot = getScenePropSlotOf(key);   // 反查绑定：该文件是否被绑到某个战场设施键
  const eff = resolveScenePropConfig(key, slot ?? undefined);
  const srcNote = eff.source === 'default' ? '（兜底）' : eff.source === 'slot' ? `（随槽位 ${slot}）` : '';
  const bits = [`${key}.glb`, `size ${eff.size}×hexR${srcNote}`];
  if (eff.lift) bits.push(`悬浮 ${eff.lift}H`);
  if (eff.pitch) bits.push(`竖起 ${eff.pitch}°`);
  if (eff.yaw) bits.push(`朝向 ${eff.yaw}°`);
  const spinNotes: string[] = [];
  if (eff.spinY) spinNotes.push(`绕Y ${eff.spinY}`);
  if (eff.spinX) spinNotes.push(`绕X ${eff.spinX}`);
  if (eff.spinZ) spinNotes.push(`绕Z ${eff.spinZ}`);
  if (spinNotes.length) bits.push(`自旋 ${spinNotes.join('/')}°/s`);
  if (slot) bits.push(`→ 绑定为 ${slot}`);
  return {
    fileName, faction: 'building', kind: 'building', propKey: key,
    title: cn, sub: bits.join(' · '),
  };
}

/** 动作模型（FBX，自带动画）：文件名即展示名，**无登记步骤** ——
 *  把 `.fbx` 丢进 `frontend/src/assets/anim/` 重启即出现；中文名可选在 `animModels.ts` 的 `ANIM_CN` 补一行。 */
function resolveAnimModel(fileName: string): Omit<ShipInfo, 'x' | 'z'> {
  const base = fileName.replace(/\.fbx$/i, '');
  const cn = ANIM_CN[base] || base;
  return {
    fileName, faction: 'neutral', kind: 'anim',
    title: cn, sub: `${fileName} · 自带 1 段动作（循环播放）`,
  };
}

/** 分组定义（按顺序首次命中归类；最后一条为兜底）*/
const GROUPS: { title: string; faction: Faction; test: (s: Omit<ShipInfo, 'x' | 'z'>) => boolean }[] = [  { title: '通用战舰 · 银河帝国', faction: 'empire', test: s => s.kind === 'generic' && s.faction === 'empire' },
  { title: '通用战舰 · 自由行星同盟', faction: 'alliance', test: s => s.kind === 'generic' && s.faction === 'alliance' },
  { title: '专属旗舰 · 银河帝国', faction: 'empire', test: s => s.kind === 'flagship' && s.faction === 'empire' },
  { title: '专属旗舰 · 自由行星同盟', faction: 'alliance', test: s => s.kind === 'flagship' && s.faction === 'alliance' },
  { title: '3D 建筑 · 战场设施', faction: 'building', test: s => s.kind === 'building' },
  { title: '动作模型 · 带动画', faction: 'neutral', test: s => s.kind === 'anim' },
  { title: '未分类 / 数据无对应', faction: 'neutral', test: () => true },
];

/** 标签条目：DOM + 世界锚点；ship=true 表示舰船标签（换档时需清除，区块标题/建筑标签保留） */
interface LabelEntry { el: HTMLDivElement; anchor: THREE.Vector3; ship?: boolean; propFile?: string }
const labels: LabelEntry[] = [];
const placed = new Set<string>();
const fileLayout = new Map<string, ShipInfo>(); // fileName → 预计算位置
/** 巡览的原始舰船文件名（不含 .lodN）与当前档位下取到的 reg（换档时整表重取） */
const shipFileNames: string[] = [];
const shipRegs: ShipModelReg[] = [];
const propRegs: ScenePropReg[] = [];
const animRegs: AnimModelReg[] = [];

/** 预计算所有舰的分组坐标（数据驱动，无需等模型就绪）。
 *  区块沿 X 横向并排，组内按 PER_BLOCK_COLS 排子网格，标题压在区块正上方。
 *  返回 { width, depth } 供相机取景。 */
function computeLayout(infos: Omit<ShipInfo, 'x' | 'z'>[]): { width: number; depth: number } {
  // 关键：分组必须“独占”。
  // 此前用 infos.filter(g.test) 让每个组独立过滤 —— 兜底组 test 恒真会收下全部舰，
  // 且它在 forEach 中最后写入 fileLayout，用未分类区块坐标覆盖掉前面各组的坐标，
  // 表现为“标题都对、舰船全堆在最后一区”。
  // 改为按 GROUPS 顺序取首个命中的组，命中即归入该组（find 天然保证独占）。
  const buckets = GROUPS.map(g => ({ title: g.title, faction: g.faction, test: g.test, members: [] as Omit<ShipInfo, 'x' | 'z'>[] }));
  infos.forEach(s => {
    const hit = buckets.find(b => b.test(s));
    if (hit) hit.members.push(s);
  });
  const groups = buckets.filter(g => g.members.length > 0);
  if (groups.length === 0) return { width: 100, depth: 100 };

  const blockWidth = PER_BLOCK_COLS * SHIP_DX;
  const totalWidth = groups.length * blockWidth + (groups.length - 1) * BLOCK_GAP;
  let maxRows = 1;
  groups.forEach(g => { maxRows = Math.max(maxRows, Math.ceil(g.members.length / PER_BLOCK_COLS)); });

  groups.forEach((g, bi) => {
    const blockCenterX = -totalWidth / 2 + bi * (blockWidth + BLOCK_GAP) + blockWidth / 2;
    // 标题：区块正上方（z 负方向为“前”）
    addGroupHeader(g.title, g.faction, blockCenterX, -HEADER_LIFT);
    g.members.forEach((m, j) => {
      const col = j % PER_BLOCK_COLS;
      const row = Math.floor(j / PER_BLOCK_COLS);
      const x = blockCenterX + (col - (PER_BLOCK_COLS - 1) / 2) * SHIP_DX;
      const z = row * SHIP_DZ;
      fileLayout.set(m.fileName, { ...m, x, z });
    });
  });

  return { width: totalWidth, depth: (maxRows - 1) * SHIP_DZ };
}

function addGroupHeader(title: string, faction: Faction, x: number, z: number) {
  const el = document.createElement('div');
  el.className = 'group-header';
  const c = faction === 'empire' ? '#f43f5e' : faction === 'alliance' ? '#38bdf8' : faction === 'building' ? '#4ade80' : '#22d3ee';
  el.innerHTML = `<span style="color:${c}">▮</span> ${title}`;
  labelHost.value!.appendChild(el);
  labels.push({ el, anchor: new THREE.Vector3(x, 6, z) });
}

function buildScene() {
  const host = canvasHost.value!;
  const w = host.clientWidth || window.innerWidth;
  const h = host.clientHeight || window.innerHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040810);

  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 8000);
  camera.position.set(0, 160, 220);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 20;
  controls.maxDistance = 3000;

  scene.add(new THREE.AmbientLight(0x8899bb, 1.4));
  const key = new THREE.DirectionalLight(0xbfe0ff, 1.2);
  key.position.set(200, 400, 200);
  scene.add(key);

  const grid = new THREE.GridHelper(6000, 120, 0x1fd28f, 0x0f3d2c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.22;
  scene.add(grid);

  window.addEventListener('resize', onResize);
  // 朝向修正预览：单击舰船选中（拖拽旋转视角时不触发）
  renderer.domElement.addEventListener('pointerdown', onPickDown);
  renderer.domElement.addEventListener('pointerup', onPickUp);
}

function onResize() {
  const host = canvasHost.value;
  if (!host || !renderer || !camera) return;
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/** 把已就绪的模型摆到预计算位置 */
function placeShip(reg: ShipModelReg) {
  // 坑1：布局表 / 朝向表都以**原始文件名**为键；低档 reg.fileName 带 .lodN 后缀，
  //   直接用会 miss → 巡览里该舰不显示、朝向标签也错。统一用 reg.baseName。
  const idKey = reg.baseName;
  if (!scene || placed.has(idKey)) { console.log('[GAL-DIAG] skip(placed/scene):', idKey); return; }
  const info = fileLayout.get(idKey);
  console.log('[GAL-DIAG]', idKey,
    info ? ('kind=' + info.kind + ' faction=' + info.faction + ' x=' + Math.round(info.x) + ' z=' + info.z) : 'FILE_LAYOUT_MISS');
  if (!info) return;
  placed.add(idKey);

  const geo = reg.geo!;
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  // 按舰种真实长度缩放（统一在 shipModels.ts 管理），取代此前所有舰统一 SHIP_LEN 的做法。
  // 旗舰按 flagshipName 查专属长度，通用舰按舰种查。
  //
  // 基准改为战列舰(900)而非 500：巡览舰位间距 SHIP_DX=34，若按 500 基准，
  // 运输舰(1800)会放大到 3.6 倍(64.8 单位)严重重叠撑出画面。
  // 战列舰为 1 倍基准 → 体型关系仍可辨，且不超出舰位。
  const lenMeters = getShipScaleLength((info as any).shipType || 'destroyer', (info as any).flagshipName,
    info.faction === 'empire' || info.faction === 'alliance' ? info.faction : undefined);
  const BATTLESHIP_M = 900;
  // 体型映射（受巡览舰位间距 SHIP_DX=34 约束，超过会重叠）：
  //  - 战列舰 = 基准 1.0（18 单位）
  //  - 运输舰 1800m 是战列舰 2 倍，但直接 2.0 会得 36 单位 > 间距 34 → 轻微重叠，
  //    故压缩到 1.67（30 单位）：明显最长，又留出安全余量
  //  - 舰载机 12m 按真实比例只有 0.2 单位（几乎看不见），设可见下限 0.22（4 单位）
  let ratio = lenMeters / BATTLESHIP_M;
  if (ratio > 1) ratio = 1 + Math.sqrt(ratio - 1) * 0.67; // 超长舰压缩
  if (ratio < 0.22) ratio = 0.22;                          // 超小舰可见下限
  const s = (SHIP_LEN * ratio) / (Math.max(size.x, size.y, size.z) || 1);

  // 阵营色（旗舰取拥有提督阵营，修掉此前按文件名字符串误判的蓝色 bug）
  const color = COLOR[info.faction];
  const bodyMat = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.55, shininess: 40, specular: 0x88aacc });
  const wireMat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4), transparent: true, opacity: 0.9 });

  const group = new THREE.Group();
  const body = new THREE.Mesh(geo, bodyMat);
  body.scale.setScalar(s);
  group.add(body);
  if (reg.wire) {
    const wire = new THREE.LineSegments(reg.wire, wireMat);
    wire.scale.setScalar(s);
    group.add(wire);
  }

  // [v23 FX] 舰尾引擎光斑：与战场**同源**（从模型几何探测喷口 + 薄盘微白光斑 + 柔晕）。
  //   旧实现是"舰尾中心一柱橙色锥"——用户实报"动画里尾焰几乎没有，只是尾巴几处微白光"，
  //   且"每艘战舰尾巴不一样" ⇒ 不再钉中心单点，喷口位置由 battleFx.detectEnginePorts 探测。
  const modelLen = Math.max(size.x, size.y, size.z) || 1;
  const engPorts = getEnginePortsFor(reg, geo, modelLen, reg.baseName, reg.fxAnchors);
  // ⚠ 第 4 参 pScale = **显示长度**（不是 s）：喷口坐标按模型原始长度归一化，而舰体缩放到显示尺寸，
  //   换算必须用显示长度；旧代码用 s ⇒ 差 modelLen 倍（柏林那类小原始尺寸舰会被放大几十倍甩到远处）。
  const engFx = buildEngineFx(SHIP_LEN * ratio, engPorts, s, SHIP_LEN * ratio);
  group.add(engFx.flame);
  group.add(engFx.glow);
  // [v24] 存下逐舰实测的开口（形状/尺寸）与缩放，便于探针核对与后续标定
  group.userData.enginePorts = engPorts;
  group.userData.engineScale = s;
  group.userData.dims = { L: SHIP_LEN * ratio, W: size.x * s, H: size.y * s };
  // [v25 标注] 重建光斑时要用到的基准与两层引用（标注后即时换装）
  group.userData.modelLen = modelLen;
  group.userData.engineL = SHIP_LEN * ratio;
  // [v27 锚点] 该模型自带的喷口锚点名（供面板提示"程序识别到了几个"，也是排查依据）
  group.userData.fxAnchorNames = (reg.fxAnchors || []).map((a) => a.name);
  engFx.flame.userData.__engFx = true;
  engFx.glow.userData.__engFx = true;

  group.position.set(info.x, 3, info.z);
  scene.add(group);
  shipGroups.set(idKey, group);   // 供"单击选中调朝向"使用

  // 特效测试台：登记第一艘就绪舰为靶
  if (!fxTarget) fxTarget = group;

  // 悬浮标签：中文名（专属旗舰带提督头像）+ 副标题 + 面数（按预算标色）+ 当前朝向修正
  const tris = reg.tris || 0;
  const trisColor = tris > 100000 ? '#f87171' : tris > 50000 ? '#fbbf24' : '#6ee7b7';
  const yawNow = getShipModelYawFix(idKey);
  const el = document.createElement('div');
  el.className = 'ship-label';
  const portraitHtml = info.portrait
    ? `<img class="sl-portrait" src="${info.portrait}" alt="" onerror="this.style.display='none'" />`
    : '';
  el.innerHTML = `
    ${portraitHtml}
    <div class="sl-text">
      <b>${info.title}</b>
      <em>${info.sub}</em>
      <span style="color:${trisColor}">${tris.toLocaleString()} tris</span>
      <span style="color:#94a3b8">朝向 ${yawNow}°${yawNow === 180 ? '（默认）' : ''}</span>
    </div>`;
  labelHost.value!.appendChild(el);
  labels.push({ el, anchor: new THREE.Vector3(info.x, 3 + SHIP_LEN * 0.34, info.z), ship: true });
}

// ── 朝向修正预览：点选 + 试转 + 复制配置行 ──
const rayc = new THREE.Raycaster();
const ndcV = new THREE.Vector2();
let pickDown = { x: 0, y: 0 };

function onPickDown(e: PointerEvent) { pickDown = { x: e.clientX, y: e.clientY }; }

/** 命中对象向上回溯，判断它属于哪个已登记 group（舰船或建筑） */
function findSelectable(obj: THREE.Object3D | null): { kind: 'ship' | 'prop'; file: string } | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    for (const [f, g] of shipGroups) if (g === cur) return { kind: 'ship', file: f };
    for (const [f, g] of propGroups) if (g === cur) return { kind: 'prop', file: f };
    cur = cur.parent;
  }
  return null;
}

// ── [v25/v28] 喷口手动标注：点模型 → **扫描该处开口**（或按外轮廓/内框线描） → 即时预览 → 复制配置行 ──
const markMode = ref(false);            // 标注模式（开启后单击模型 = 打点，不再触发"选中舰船"）
const markR = ref(0.075);               // 取点半径（归一化：÷ 模型最长边）；[v28] `scan` 档下 = 搜索半径
const markSel = ref<string | null>(null);
const markCount = ref(0);
const markCopied = ref('');
// [v27/v28] 形状来源与缩放：用户原话"之前用外轮廓做的那版，其实只要缩小就好了" ⇒ 可实时缩放；
//   [v28] 默认改为**扫描内框**：打一个点就得到该处开口的真实截面（形状与尺寸都不用给）。
const markModeSel = ref<PortShapeMode>('scan');
const markScale = ref(1);
/** [v28] 扫描读数（命中率 / 中位半径 / 切割深度）—— 直接把"这一刀切到墙了没有"显示出来 */
const scanInfo = ref('');

/** [v27] 把当前外轮廓/内框线/缩放套到**选中的舰**并即时换装。
 *  ⚠ 以前只写进标注表 ⇒ 没打过点的舰点了没反应（用户实报）。现在写进按舰的选项表，
 *    自动探测 / 模型自带锚点 / 标注三条路径都会读到它 ⇒ 选一艘舰就能实时调。 */
function applyMarkOpts() {
  const f = markSel.value;
  if (!f) return;
  ENGINE_PORT_OPTS_RUNTIME[f] = { mode: markModeSel.value, scale: markScale.value };
  const arr = ENGINE_PORT_MARKS_RUNTIME[f] || [];
  for (const m of arr) { m.mode = markModeSel.value; m.scale = markScale.value; }
  rebuildShipFx(f);
}
function setMarkMode(m: PortShapeMode) { markModeSel.value = m; applyMarkOpts(); }
function setMarkScale(s: number) { markScale.value = s; applyMarkOpts(); }

/** [v27] 当前选中舰的**喷口真源**提示：模型自带锚点 > 手点标注 > 自动探测。
 *  用户问过"程序到底识别到没有" ⇒ 直接把识别结果显示出来，不用猜。
 *  ⚠ 读**注册表现值**（而非建组时的快照）：低档位加载的 LOD 副本补采到锚点后要能立即反映。 */
const anchorTick = ref(0);                       // 补采到手时 +1，驱动本 computed 重算
const anchorWaitTried: Record<string, boolean> = {};
const anchorInfo = computed(() => {
  void anchorTick.value;
  const f = markSel.value;
  if (!f) return null;
  const reg = shipRegs.find((r) => r.baseName === f || r.fileName === f);
  const names = (reg?.fxAnchors || []).map((a) => a.name);
  if (names.length) return { kind: 'anchor' as const, n: names.length, names: names.join(', ') };
  const built = (shipGroups.get(f)?.userData?.fxAnchorNames as string[] | undefined) || [];
  if (built.length) return { kind: 'anchor' as const, n: built.length, names: built.join(', ') };
  return { kind: markCount.value > 0 ? ('marks' as const) : ('auto' as const), n: 0, names: '' };
});

/** [v27c] 低档位加载的是 `lodN` 减面副本，**通常没有 FX 锚点**（锚点在原文件里）。
 *  选中舰时后台补加载**原文件**采锚点；到手（同型传播 + version++）后自动换装一次。
 *  只对被选中的舰触发 —— 全场 34 艘都拉原文件会吃掉数 GB 内存。 */
function harvestAnchorsFor(file: string) {
  const reg = shipRegs.find((r) => r.baseName === file || r.fileName === file);
  if (!reg || reg.fxAnchors || anchorWaitTried[file]) return;
  anchorWaitTried[file] = true;
  if (!ensureShipFxAnchors(reg.baseName)) return;
  const t0 = Date.now();
  const wait = () => {
    if (disposed) return;
    if (reg.fxAnchors) {
      anchorTick.value++;
      rebuildShipFx(file);
      markCount.value = (ENGINE_PORT_MARKS_RUNTIME[file] || []).length;
    } else if (Date.now() - t0 < 30000) { window.setTimeout(wait, 400); }
  };
  wait();
}

/** 重建某舰的尾焰两层光斑（标注 / 清除后即时换装，无需重开巡览） */
function rebuildShipFx(file: string) {
  const g = shipGroups.get(file);
  const reg = shipRegs.find((r) => r.baseName === file || r.fileName === file);
  const mL = g && (g.userData.modelLen as number | undefined);
  const Lw = g && (g.userData.engineL as number | undefined);
  const s = g && (g.userData.engineScale as number | undefined);
  if (!g || !reg || !reg.geo || !mL || !Lw || !s) return;
  for (const c of [...g.children]) {            // 卸掉旧两层（几何/材质都自建 ⇒ 一并释放）
    if (c.userData && c.userData.__engFx) {
      g.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material)?.dispose?.();
    }
  }
  const ports = getEnginePortsFor(reg, reg.geo, mL, file, reg.fxAnchors);
  // [v28] 把**扫描读数**显示出来（"这一刀到底切到墙没有、光斑多大"）；走别的档时清空。
  //   ⚠ [v28c] 一并显示**最终画出来的直径**（含缩放与绝对上限）—— 用户实报"为什么这么大"时，
  //     画面与数字必须能对上；触发绝对上限会明确标出来。
  const sv = ports.map((p) => p.scan).filter((x): x is PortScanResult => !!x);
  let dMin = Infinity, dMax = 0;
  for (const p of ports) {
    let mx = Math.max(p.hx, p.hy);
    if (p.outline) for (let i = 0; i < p.outline.length; i += 2) mx = Math.max(mx, Math.abs(p.outline[i]), Math.abs(p.outline[i + 1]));
    const d = mx * 2 * (p.outlineScale ?? 1) * 100;
    dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
  }
  const dimTxt = ports.length ? ` · 光斑直径 ${dMin.toFixed(2)}~${dMax.toFixed(2)}% 舰长` : '';
  const cl = ports.some((p) => p.scan && p.scan.clamp != null && p.scan.clamp < 1) ? ' ⚠已按绝对上限缩回' : '';
  scanInfo.value = sv.length
    ? `🔎 扫描命中 ${(Math.min(...sv.map((x) => x.hitRate)) * 100).toFixed(0)}%`
      + ` · 中位半径 ${(Math.min(...sv.map((x) => x.rMed)) * 100).toFixed(2)}% 舰长`
      + ` · 切割深度 ${sv.map((x) => x.depth.toFixed(3)).join(' / ')}`
      + dimTxt + cl
    : (ports.length ? `📏${dimTxt}${cl}` : '');
  const fx = buildEngineFx(Lw, ports, s, Lw);
  fx.flame.userData.__engFx = true;
  fx.glow.userData.__engFx = true;
  g.add(fx.flame);
  g.add(fx.glow);
  g.userData.enginePorts = ports;
}

/** 把当前标注导出为可直接粘进 battleFx.ts 的 ENGINE_PORT_MARKS 配置行 */
function copyMarkLine() {
  const f = markSel.value;
  if (!f) { markCopied.value = '（先在标注模式下单击模型打点）'; return; }
  const arr = ENGINE_PORT_MARKS_RUNTIME[f] || [];
  const n = (x: number) => String(+x.toFixed(4));
  const body = arr.map((m) => {
    const parts = [`x: ${n(m.x)}`, `y: ${n(m.y)}`, `z: ${n(m.z)}`, `r: ${n(m.r ?? 0.06)}`];
    // ⚠ 标注表里的**隐式默认**是"外轮廓"（`resolveEnginePortsFor` 无 mode ⇒ 走按舰档/OUTLINE_MODE）
    //   ⇒ 只有非 convex 才写出来；`scan` 与 `inner` 都会带上 mode。
    if (m.mode && m.mode !== 'convex') parts.push(`mode: '${m.mode}'`);
    if (m.scale != null && Math.abs(m.scale - 1) > 1e-6) parts.push(`scale: ${n(m.scale)}`);
    return `{ ${parts.join(', ')} }`;
  }).join(', ');
  const line = `  ${f.replace(/\.glb$/i, '')}: [${body}],`;
  console.log('[PORT-MARK] 粘进 src/game/three/battleFx.ts 的 ENGINE_PORT_MARKS：\n' + line);
  try { navigator.clipboard?.writeText(line); } catch { /* 无剪贴板权限时看控制台 */ }
  markCopied.value = `已复制：${line}`;
}

/** 清空该舰标注 ⇒ 回落到 覆盖表 / 自动探测 */
function clearMarks() {
  const f = markSel.value;
  if (!f) return;
  ENGINE_PORT_MARKS_RUNTIME[f] = [];
  markCount.value = 0;
  rebuildShipFx(f);
  markCopied.value = '';
}

/** 单击（非拖拽）→ 射线拾取舰船 / 建筑 → 选中并按类型显示可调项 */
function onPickUp(e: PointerEvent) {
  if (Math.hypot(e.clientX - pickDown.x, e.clientY - pickDown.y) > 5) return;   // 拖拽视角，不算点选
  if (!camera || !renderer) return;
  const targets = [...shipGroups.values(), ...propGroups.values()];
  if (targets.length === 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  ndcV.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  rayc.setFromCamera(ndcV, camera);
  const hits = rayc.intersectObjects(targets, true);
  if (hits.length === 0) return;
  const hit = findSelectable(hits[0].object);
  if (!hit) return;
  // [v25] 标注模式：单击 = 在该处打一个喷口标注（交点 → 模型局部坐标 → 归一化）
  if (markMode.value) {
    if (hit.kind !== 'ship') return;
    const g = shipGroups.get(hit.file);
    // ⚠⚠ [v27 修复] 归一化基准必须是**显示长度**（engineL），不是模型原始长度（modelLen）。
    //   `worldToLocal` 给的是"已按 s 缩放"的组内坐标（s = 显示长度 / modelLen），
    //   而 EnginePort 的坐标口径是"模型原始坐标 ÷ modelLen" ⇒ 应由 组内坐标 ÷ Lw(=modelLen×s) 得到。
    //   旧代码除以 modelLen ⇒ 标注坐标被放大了 s 倍 ⇒ **光斑飞到老远**（模型原始尺寸越小飞得越远）。
    const Lw = g && (g.userData.engineL as number | undefined);
    if (!g || !Lw) return;
    g.updateMatrixWorld(true);
    const local = g.worldToLocal(hits[0].point.clone());
    const arr = ENGINE_PORT_MARKS_RUNTIME[hit.file] || (ENGINE_PORT_MARKS_RUNTIME[hit.file] = []);
    arr.push({ x: local.x / Lw, y: local.y / Lw, z: local.z / Lw, r: markR.value, mode: markModeSel.value, scale: markScale.value });
    markSel.value = hit.file;
    markCount.value = arr.length;
    markCopied.value = '';
    rebuildShipFx(hit.file);
    return;
  }
  yawCopied.value = '';
  if (hit.kind === 'ship') {
    yawSelKind.value = 'ship';
    yawSel.value = hit.file;
    // [v27] 普通点选也把该舰设为"轮廓调参对象" ⇒ 不用先打点也能实时切外轮廓/内框线/缩放
    markSel.value = hit.file;
    markCount.value = (ENGINE_PORT_MARKS_RUNTIME[hit.file] || []).length;
    const opt = ENGINE_PORT_OPTS_RUNTIME[hit.file];
    markModeSel.value = opt?.mode ?? 'scan';
    markScale.value = opt?.scale ?? 1;
    yawBaseDeg = getShipModelYawFix(hit.file);
    yawDeg.value = yawBaseDeg;
    harvestAnchorsFor(hit.file);
    return;
  }
  // 建筑：读回**当前已烘焙**的配置作为试转起点（与战场 / 巡览同一口径，避免"起点不是真相"）
  yawSelKind.value = 'prop';
  yawSel.value = hit.file;
  const key = propRegsByFile.get(hit.file)?.key ?? hit.file.replace(/\.glb$/i, '');
  const eff = resolveScenePropConfig(key, getScenePropSlotOf(key) ?? undefined);
  propBase = { yaw: eff.yaw, pitch: eff.pitch, roll: eff.roll, spinX: eff.spinX, spinY: eff.spinY, spinZ: eff.spinZ };
  yawDeg.value = eff.yaw;
  propPitch.value = eff.pitch;
  propSpin.value = { x: eff.spinX, y: eff.spinY, z: eff.spinZ };
  propSpinKey.value = SPIN_PRESETS.find(p => p.x === eff.spinX && p.y === eff.spinY && p.z === eff.spinZ)?.key ?? 'off';
}

/** 试转朝向：以"如果表里填这个角度"的视觉效果为准（增量 = 目标 − 已烘焙值） */
function setYaw(d: number) {
  yawDeg.value = d;
  if (!yawSel.value) return;
  if (yawSelKind.value === 'prop') { rebuildSelectedProp(); return; }
  const g = shipGroups.get(yawSel.value);
  if (g) g.rotation.y = THREE.MathUtils.degToRad(d - yawBaseDeg);
}

/** 建筑"竖起来"试转（绕 X 轴）。必须**重建**：pitch 改变竖直包围盒，
 *  只改外层 rotation 会让模型陷进地面，重建才能看到真实贴地效果。 */
function setPropPitch(d: number) {
  propPitch.value = d;
  rebuildSelectedProp();
}

/** 建筑自旋预设：改预览动画（与战场同源 —— 每帧都由 advanceScenePropSpin 推进）。
 *  **只改 userData 上的角速度、不重建** ⇒ 即时生效且不打断当前旋转相位
 *  （重建会把累积角度清零，调自旋时会读作"跳回起点"）。 */
function setPropSpin(p: { key: string; x: number; y: number; z: number }) {
  propSpinKey.value = p.key;
  propSpin.value = { x: p.x, y: p.y, z: p.z };
  const g = yawSel.value ? propGroups.get(yawSel.value) : undefined;
  const sp = (g?.userData as any)?.sceneProp;
  if (sp) {
    sp.spin = {
      x: THREE.MathUtils.degToRad(p.x),
      y: THREE.MathUtils.degToRad(p.y),
      z: THREE.MathUtils.degToRad(p.z),
    };
  }
}

/** 按当前试转值重建选中建筑。几何归注册表所有（不 dispose），只释放本组件新建的材质。 */
function rebuildSelectedProp() {
  const file = yawSel.value;
  if (!file || !scene) return;
  const info = propRegsByFile.get(file);
  const old = propGroups.get(file);
  if (!info || !old) return;
  scene.remove(old);
  old.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach(mm => mm.dispose()); else mat.dispose();
    }
  });
  const g = buildScenePropFromModel(info.reg, info.key, PROP_SHOW_UNIT, COLOR.building, {
    yaw: yawDeg.value,
    pitch: propPitch.value,
    roll: propBase.roll,
    spinX: propSpin.value.x,
    spinY: propSpin.value.y,
    spinZ: propSpin.value.z,
  });
  if (!g) return;
  g.position.set(info.x, 0, info.z);
  scene.add(g);
  propGroups.set(file, g);
  const dims = g.userData.dims as { H: number } | undefined;
  const lb = labels.find(l => l.propFile === file);
  if (lb && dims) lb.anchor.set(info.x, dims.H + 6, info.z);   // 标签锚点跟随旋转后高度
}

/** 复制/打印可直接粘进配置表的行（舰船 → shipModels.ts；建筑 → sceneProps.ts） */
function copyYawLine() {
  if (!yawSel.value) return;
  let line: string;
  let where: string;
  if (yawSelKind.value === 'prop') {
    const key = propRegsByFile.get(yawSel.value)?.key ?? yawSel.value.replace(/\.glb$/i, '');
    const eff = resolveScenePropConfig(key, getScenePropSlotOf(key) ?? undefined);
    const parts = [`size: ${eff.size}`];
    if (eff.lift) parts.push(`lift: ${eff.lift}`);
    if (yawDeg.value) parts.push(`yaw: ${yawDeg.value}`);
    if (propPitch.value) parts.push(`pitch: ${propPitch.value}`);
    if (propBase.roll) parts.push(`roll: ${propBase.roll}`);
    if (propSpin.value.y) parts.push(`spinY: ${propSpin.value.y}`);
    if (propSpin.value.x) parts.push(`spinX: ${propSpin.value.x}`);
    if (propSpin.value.z) parts.push(`spinZ: ${propSpin.value.z}`);
    const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`;
    line = `  ${k}: { ${parts.join(', ')} },`;
    where = 'src/game/three/sceneProps.ts 的 SCENE_PROP_CONFIG';
  } else {
    line = `  '${yawSel.value}': ${yawDeg.value},`;
    where = 'src/game/three/shipModels.ts 的 SHIP_MODEL_YAW_FIX';
  }
  console.log('[GALLERY-POSE] 把下面这行加进 ' + where + '：\n' + line);
  try { navigator.clipboard?.writeText(line); } catch { /* 无剪贴板权限时看控制台 */ }
  yawCopied.value = `已复制：${line.trim()}  （粘进 ${where}）`;
}

/** 把已就绪的**动作模型**摆到预计算位置：骨骼安全克隆 + 按身高归一化 + 贴地 + 起播自带动作。
 *  ⚠ 与舰船/建筑不同，这里**不参与"换挡重建"**（FBX 没有 LOD），也**不参与点选调姿态**
 *  （每型只有一段动作，不需要切换 UI）；标签上直接把 clip 时长 / 骨骼数 / 面数标出来供核对。 */
function placeAnimModel(reg: AnimModelReg) {
  if (!scene || placed.has(reg.fileName)) return;
  const info = fileLayout.get(reg.fileName);
  if (!info) return;
  placed.add(reg.fileName);
  const inst = instantiateAnimModel(reg, ANIM_SHOW_HEIGHT);
  if (!inst) return;
  inst.root.position.set(info.x, inst.root.position.y, info.z);   // y 由贴地算好，别覆盖
  scene.add(inst.root);
  animGroups.set(reg.fileName, { root: inst.root, mixer: inst.mixer });
  const nClip = reg.clips.length;
  const dur = nClip ? reg.clips.map((c) => c.duration.toFixed(2) + 's').join(' / ') : '—';
  const tris = reg.tris || 0;
  const trisColor = tris > 100000 ? '#f87171' : tris > 50000 ? '#fbbf24' : '#6ee7b7';
  const el = document.createElement('div');
  el.className = 'ship-label';
  el.innerHTML = `
    <div class="sl-text">
      <b>${info.title}</b>
      <em>${info.sub}</em>
      <span style="color:#22d3ee">动作 ${nClip} 段 · ${dur} · 骨骼 ${reg.bones}</span>
      <span style="color:${trisColor}">${tris.toLocaleString()} tris · 身高 ${inst.height.toFixed(1)}</span>
    </div>`;
  labelHost.value!.appendChild(el);
  labels.push({ el, anchor: new THREE.Vector3(info.x, inst.height + 6, info.z) });
}

/** 把已就绪的 3D 建筑模型摆到预计算位置（复用战场的贴地/悬浮/尺寸口径）。 */
function placeSceneProp(reg: ScenePropReg) {
  if (!scene || placed.has(reg.fileName)) return;
  const info = fileLayout.get(reg.fileName);
  if (!info) return;
  placed.add(reg.fileName);

  const key = info.propKey || reg.fileName.replace(/\.glb$/i, '');
  // 尺寸：buildScenePropFromModel 内部 s = size×hexR / 包围盒最长边 ——
  //   巡览传 hexR = PROP_SHOW_UNIT，即得"size × 9 巡览单位"的目标最长边（等比，不失真）。
  const g = buildScenePropFromModel(reg, key, PROP_SHOW_UNIT, COLOR.building);
  if (!g) return;
  g.position.set(info.x, 0, info.z);   // 返回组的局部原点 = 地面（贴地/悬浮已由构建函数处理）
  scene.add(g);
  // v21：登记进"可点选 / 可重建"索引 ⇒ 点选后能调朝向 · 竖起 · 自旋，并预览动画
  propGroups.set(reg.fileName, g);
  propRegsByFile.set(reg.fileName, { reg, key, x: info.x, z: info.z });

  const dims = g.userData.dims as { L: number; W: number; H: number } | undefined;
  const topY = dims ? dims.H + 6 : 12;
  const tris = reg.tris || 0;
  const trisColor = tris > 100000 ? '#f87171' : tris > 50000 ? '#fbbf24' : '#6ee7b7';
  const el = document.createElement('div');
  el.className = 'ship-label';
  el.innerHTML = `
    <div class="sl-text">
      <b>${info.title}</b>
      <em>${info.sub}</em>
      <span style="color:${trisColor}">${tris.toLocaleString()} tris</span>
    </div>`;
  labelHost.value!.appendChild(el);
  labels.push({ el, anchor: new THREE.Vector3(info.x, topY, info.z), propFile: reg.fileName });
}

/** 轮询注册表：就绪即摆放，统计 HUD（舰船 + 3D 建筑）。
 *  幂等：重复调用会先清旧定时器（换档重取模型后需重启轮询）。 */
function startPolling() {
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  pollTimer = window.setInterval(() => {
    if (disposed) return;
    let ready = 0, failed = 0, loading = 0, tris = 0;
    shipRegs.forEach(reg => {
      if (reg.status === 'ready') { ready++; tris += reg.tris || 0; placeShip(reg); }
      else if (reg.status === 'failed') failed++;
      else loading++;
    });
    propRegs.forEach(reg => {
      if (reg.status === 'ready') { ready++; tris += reg.tris || 0; placeSceneProp(reg); }
      else if (reg.status === 'failed') failed++;
      else loading++;
    });
    animRegs.forEach(reg => {
      if (reg.status === 'ready') { ready++; tris += reg.tris || 0; placeAnimModel(reg); }
      else if (reg.status === 'failed') failed++;
      else loading++;
    });
    readyCount.value = ready;
    failedCount.value = failed;
    loadingCount.value = loading;
    totalTris.value = tris;
    avgTris.value = ready > 0 ? Math.round(tris / ready) : 0;
    if (loading === 0 && pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  }, 300);
}

/** 每帧：渲染 + 标签投影 + 特效测试台推进 */
function animate() {
  if (disposed || !renderer || !scene || !camera) return;
  rafId = requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  controls?.update();
  fxUpdate(dt);
  // v21：建筑自旋动画预览 —— 与战场共用 advanceScenePropSpin（同一实现 ⇒ 巡览所见即战场所得）
  for (const g of propGroups.values()) advanceScenePropSpin(g, dt);
  // 动作模型：每份实例推进自己的混合器（FBX 自带的骨骼动画）
  for (const a of animGroups.values()) a.mixer.update(dt);
  renderer.render(scene, camera);

  const host = canvasHost.value;
  if (!host) return;
  const w = host.clientWidth, h = host.clientHeight;
  const v = new THREE.Vector3();
  for (const lb of labels) {
    v.copy(lb.anchor).project(camera);
    if (v.z > 1) { lb.el.style.display = 'none'; continue; }
    lb.el.style.display = 'flex';
    lb.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
  }
}

/** 按当前档位为全部舰船文件取 reg（换档后重取：新档 URL 不同 → 注册表新条目，从 loading 起） */
function acquireShipRegs() {
  shipRegs.length = 0;
  for (const f of shipFileNames) {
    const reg = acquireShipModelByFiles([f]);
    if (reg) shipRegs.push(reg);
  }
}

/** 档位热更新：清除旧档舰船视觉与登记 → 按新档重取模型 → 重启轮询。
 *  注册表按 URL 缓存：换档 = 换 URL = 新条目（旧档条目保留在表里，上限 34×3=102 条，内存可接受）；
 *  切回已加载过的档位时 reg 已 ready，无需重新下载，第一帧轮询即摆回。 */
function applyShipDetail(level: 'high' | 'medium' | 'low') {
  setShipModelDetail(level);
  // 几何归注册表所有（不 dispose）；本组件创建的材质与标签 DOM 需释放
  for (const g of shipGroups.values()) {
    scene?.remove(g);
    g.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach(mm => mm.dispose()); else mat.dispose();
      }
    });
  }
  shipGroups.clear();
  for (const f of shipFileNames) placed.delete(f);          // 只清舰船登记，建筑不受影响
  for (let i = labels.length - 1; i >= 0; i--) {
    if (labels[i].ship) { labels[i].el.remove(); labels.splice(i, 1); }
  }
  fxTarget = null;          // 靶舰已随旧档销毁
  acquireShipRegs();        // 按新档重取注册表（旧档 reg 仍留在注册表里，内存可接受）
  startPolling();           // 重启轮询，把新档模型摆回
}

// ════════════════════════════════════════════════════════════
// 挂载 / 卸载
// ════════════════════════════════════════════════════════════

onMounted(() => {
  // 应用当前档位（拿不到 store 时不阻断巡览打开）
  try { setShipModelDetail(useSettingsStore().getShipModelDetailValue()); } catch { /* 用默认档 */ }

  const shipFiles = listShipModelFiles();
  shipFileNames.push(...shipFiles);
  const propFiles = listScenePropFiles();
  propCount.value = propFiles.length;
  // 动作模型：assets/anim/ 下的 .fbx（丢进文件夹即出现，零登记）
  const animFiles = listAnimModelFiles();
  animCount.value = animFiles.length;
  // 未登记尺寸 = 既没按文件名、也没按绑定槽位登记的（走兜底 2.0×hexR）
  unregisteredCount.value = propFiles.filter((f) => {
    const base = f.replace(/\.glb$/i, '').replace(/_(empire|alliance)$/i, '');
    return resolveScenePropConfig(base, getScenePropSlotOf(base) ?? undefined).source === 'default';
  }).length;
  totalCount.value = shipFiles.length + propFiles.length + animFiles.length;

  buildScene();

  // 布局数据驱动（不等模型就绪）+ 相机按整体尺度取景
  const infos = [...shipFiles.map(resolveShip), ...propFiles.map(resolveSceneProp), ...animFiles.map(resolveAnimModel)];
  const { width, depth } = computeLayout(infos);
  const centerZ = depth / 2;
  const span = Math.max(width, depth, 120);
  controls!.target.set(0, 0, centerZ);
  camera!.position.set(0, span * 0.75, centerZ + span * 0.72);
  controls!.update();

  acquireShipRegs();
  propFiles.forEach((f) => {
    const reg = acquireScenePropByFiles([f]);
    if (reg) propRegs.push(reg);
  });
  animFiles.forEach((f) => {
    const reg = acquireAnimModel(f);
    if (reg) animRegs.push(reg);
  });

  startPolling();
  animate();

  // 档位热更新：watch 注册放最后（失败也只是没有热更新，不影响打开）
  try {
    const st = useSettingsStore();
    watch(() => st.getShipModelDetailValue(), (v) => { if (!disposed) applyShipDetail(v); });
  } catch { /* 无 store 时不做热更新 */ }
});

onBeforeUnmount(() => {
  disposed = true;
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', onResize);
  labels.forEach(lb => lb.el.remove());
  labels.length = 0;
  shipGroups.clear();
  propGroups.clear();
  animGroups.clear();
  propRegsByFile.clear();
  controls?.dispose();
  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', onPickDown);
    renderer.domElement.removeEventListener('pointerup', onPickUp);
  }
  // 特效测试台清理：共享模块造的对象不持有额外资源，交给下方 scene.traverse 统一释放
  fxTarget = null;
  fxShields.length = 0;
  fxMissiles.length = 0;
  fxHits.length = 0;
  fxLasers.length = 0;
  scene?.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as any).isMesh || (o as any).isLineSegments) {
      (m as any).geometry?.dispose?.();
      const mat = (m as any).material;
      if (Array.isArray(mat)) mat.forEach((mm: THREE.Material) => mm.dispose()); else mat?.dispose?.();
    }
  });
  renderer?.dispose();
  renderer?.domElement.remove();
});
</script>

<style scoped>
.gallery-root { position: fixed; inset: 0; z-index: 3000; background: #040810; }
.gallery-canvas { position: absolute; inset: 0; }
.gallery-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

.gallery-labels :deep(.group-header) {
  position: absolute; top: 0; left: 0; white-space: nowrap;
  font-size: 15px; font-weight: 900; letter-spacing: 1px; color: #e6fff4;
  padding: 4px 12px; border-radius: 6px;
  background: rgba(8, 14, 24, 0.72); border: 1px solid rgba(31, 210, 143, 0.25);
}

.gallery-labels :deep(.ship-label) {
  position: absolute; top: 0; left: 0; white-space: nowrap;
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: 5px;
  background: rgba(8, 14, 24, 0.62); border: 1px solid rgba(31, 210, 143, 0.18);
  font-size: 11px; line-height: 1.25; text-align: left;
}
.gallery-labels :deep(.sl-portrait) {
  width: 26px; height: 30px; object-fit: cover; border-radius: 3px;
  border: 1px solid rgba(148, 163, 184, 0.4); background: #0b1220; flex-shrink: 0;
}
.gallery-labels :deep(.sl-text) { display: flex; flex-direction: column; }
.gallery-labels :deep(.ship-label b) { color: #e6fff4; font-weight: 800; }
.gallery-labels :deep(.ship-label em) { color: #94a3b8; font-size: 10px; font-style: normal; }
.gallery-labels :deep(.ship-label span) { font-size: 10px; }

.gallery-hud { position: absolute; top: 14px; left: 16px; pointer-events: none; display: flex; flex-direction: column; gap: 4px; }
.gh-title { font-size: 15px; font-weight: 900; color: #1fd28f; letter-spacing: 1px; }
.gh-stat { font-size: 12px; color: #94a3b8; }
.gh-fail { color: #f87171; }
.gh-loading { color: #fbbf24; }
.gh-legend { display: flex; gap: 12px; font-size: 11px; color: #cbd5e1; }
.gh-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.gh-tip { font-size: 10px; color: #475569; }

.gh-fx { display: flex; align-items: center; gap: 6px; pointer-events: auto; margin-top: 2px; }
.gh-fx-label { font-size: 10px; color: #64748b; }
.gh-fx button {
  padding: 4px 10px; font-size: 11px; font-weight: 700;
  color: #cbd5e1; background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(31, 210, 143, 0.35); border-radius: 5px; cursor: pointer;
}
.gh-fx button:hover { border-color: #1fd28f; color: #1fd28f; }
.gh-fx button:active { background: rgba(31, 210, 143, 0.15); }

/* 朝向修正预览行 */
.gh-yaw { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; pointer-events: auto; margin-top: 2px; }
.gh-yaw-name { font-size: 11px; color: #1fd28f; }
.gh-yaw-gap { margin-left: 10px; }
.gh-yaw-val { font-size: 11px; color: #cbd5e1; }
.gh-yaw-hint { font-size: 10px; color: #475569; }
.gh-yaw button {
  padding: 3px 9px; font-size: 11px; font-weight: 700;
  color: #cbd5e1; background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 5px; cursor: pointer;
}
.gh-yaw button:hover { border-color: #38bdf8; color: #38bdf8; }
.gh-yaw button.active { border-color: #1fd28f; color: #1fd28f; background: rgba(31, 210, 143, 0.12); }
.gh-yaw button.gh-yaw-copy { border-color: rgba(251, 191, 36, 0.45); color: #fbbf24; }
.gh-yaw button.gh-yaw-copy:hover { border-color: #fbbf24; color: #fde68a; }

.gallery-close {
  position: absolute; top: 14px; right: 16px;
  padding: 7px 16px; font-size: 12px; font-weight: 700;
  color: #e2e8f0; background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(31, 210, 143, 0.4); border-radius: 6px; cursor: pointer;
}
.gallery-close:hover { border-color: #1fd28f; color: #1fd28f; }
</style>
