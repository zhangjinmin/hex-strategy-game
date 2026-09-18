/**
 * sceneProps.ts — 战场设施 GLB 模型注册表（中继补给站 / 出生点司令部 / 要塞 等静态设施）
 *
 * ── 与舰船模型（shipModels.ts）为什么是独立一套 ──
 *   ① 舰船加载管线含舰船专属处理：最长轴旋转对齐 Z 轴（长度轴）+ 舰首 180° 翻转。
 *      设施模型若走这条管线会直接躺倒 / 朝向错乱；独立管线 = 零例外表、零回归风险。
 *   ② assets/ship/ 会被「舰艇模型巡览」全量收录，设施混入会污染巡览分组。
 *   ③ 语义不同：舰船有舰首/尾焰/引擎挂点，设施是静止物体，无这些挂点。
 *
 * ── 使用方式（详见 assets/scene/模型命名规范.md）──
 *   1. 把 GLB 放进 frontend/src/assets/scene/，文件名 = 设施键（relay / base / fortress …）
 *   2. 尺寸只改本文件 SCENE_PROP_CONFIG[key].size（单位 = hexR 倍数，等比缩放，改一个即可）
 *   3. 新增文件后重启 dev（import.meta.glob 在构建期收集文件列表）
 *
 * ── 坐标与朝向约定 ──
 *   模型自身坐标系即最终朝向（不自动翻转/旋转）；战场：y 轴向上，水平面 x/z，
 *   世界坐标 = (px, 高度, -py)。buildScenePropFromModel 返回的 Group 局部原点 = 地面，
 *   模型底面精确落在 y=0（含 lift 悬浮量），调用方只需把 Group 放到目标格的 groundY。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** 自动发现 assets/scene/ 下所有 GLB，值为 URL */
export const SCENE_PROP_FILES = import.meta.glob('../../assets/scene/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** 设施姿态（度）与自旋动画（度/秒）—— 建筑的"朝向 + 动画"配置。
 *  旋转序固定 **YXZ**（先绕 x 竖起、再绕 y 定朝向）⇒ `yaw` 恒为绕**世界竖直轴**的朝向，符合直觉。
 *  · yaw  ：绕 y 轴朝向修正（度）。正面朝错方向时填 90 / 180 / -90。
 *  · pitch：绕 x 轴（度）。**"竖起来"就用它** —— 平躺的环 / 盘 / 门类模型填 90 即立起。
 *  · roll ：绕 z 轴（度）。
 *  · spinY：**绕模型竖向中线持续自转**（度/秒）—— "360° 缓慢旋转"最常用，6 秒一圈填 60。
 *  · spinX / spinZ：绕 x / z 轴的翻滚（度/秒）。翻滚会改变模型竖直包围盒 ⇒ 代码每帧重算贴地，
 *    模型始终"贴着地面翻滚"，不会穿地。
 *  ⚠ 自旋按**真实时间**推进（不随战斗倍速缩放），与 relayRings / fortressRings 既有自旋口径一致。
 * ============================================================== */
export interface ScenePropPose {
  yaw?: number;
  pitch?: number;
  roll?: number;
  spinY?: number;
  spinX?: number;
  spinZ?: number;
}

/** 设施配置：尺寸 / 悬浮 / 姿态 / 自旋。**尺寸与动画的唯一调整入口就是本表。** */
export type ScenePropConfig = ScenePropPose & {
  /** 模型**最长边**的战场长度，单位 = hexR 倍数（hexR = 六角格外接圆半径；指挥制 ≈50）。等比缩放。 */
  size: number;
  /** 悬浮高度，单位 = **旋转后**模型高度倍数（0/缺省 = 底面贴地；0.6 = 离地 0.6×自身高） */
  lift?: number;
};

export const SCENE_PROP_CONFIG: Record<string, ScenePropConfig> = {
  relay: { size: 0.8, lift: 0.6, spinY: 12 },   // 中继补给站（悬浮空间站）
  base:     { size: 2.2 },              // 出生点/司令部基地（贴地）
  fortress: { size: 4.5 },              // 要塞地块（伊谢尔伦要塞，巨物）
  planet:   { size: 1.2 },              // 宜居行星（球体模型：最长边=直径）
  mine:     { size: 0.9 },              // 资源矿点
  tower:    { size: 0.9 },              // 防御塔
  pier:     { size: 1.2 },              // 跳跃节点/码头
  castle:   { size: 1.0 },              // castle 地块定位标记（小体量）
  // ── 想给"不规范命名 / 暂未使用"的模型单独设尺寸 / 姿态 / 动画，就按**文件名（不含 .glb）**加一行 ──
  //   （不登记也能显示，只是走下面的兜底尺寸 2.0；巡览标签会标「（兜底）」）
  // 例：'空间站a': { size: 4.5 },
  //     'station_v2': { size: 3.0, lift: 0.3, yaw: 90 },

  // 星门：模型是"平躺的环" ⇒ pitch 90 让它**竖起来**；spinY 12 = 绕竖轴 12°/s（30 秒一圈）。
  // ⚠ 尺寸按需调（2.0 = 与兜底一致，即不改变现状）。
  // ⚠ 它要**上战场**还需一步：在 SCENE_PROP_BINDING 里绑到某个设施键（或改名为规范键名）。
  //    注意口径 —— 命中「文件登记」后 lift/yaw 不再回落槽位值，故绑到 relay 也不会自动悬浮；
  //    需要悬浮就连 lift 一起写在本行（例：`lift: 0.6`）。
  stargate2: { size: 2.0, pitch: 90, spinY: 12 },
};

/** 未配置设施的兜底尺寸（hexR 倍数）——任意命名的模型默认按此显示 */
export const DEFAULT_SCENE_PROP_SIZE = 2.0;

/** ==================== 模型绑定（可选）====================
 *  战场按"设施键"找文件：`{键}.glb` / `{键}_{阵营}.glb`。
 *  若模型文件名不按规范（如 `空间站_v2.glb`、`station_A.glb`），**不必改名**——
 *  在这里把"设施键 → 文件名（不含 .glb）"绑一行即可。
 *  支持数组：按顺序回退（第一个文件不存在就用第二个）。
 *  例：relay: '空间站_v2',              // 中继站改用 空间站_v2.glb
 *      base:  ['base_v2', 'base'],     // 优先 base_v2.glb，退而求其次 base.glb
 * ==================================================== */
export const SCENE_PROP_BINDING: Record<string, string | string[]> = {
  // 示例（需要时把注释去掉并改成你的文件名）：relay: 'my_station',
};

/** 解析结果：尺寸 / 悬浮 / 姿态 / 自旋，全部字段已填默认值 */
export type ResolvedScenePropConfig = {
  size: number; lift: number;
  yaw: number; pitch: number; roll: number;
  spinY: number; spinX: number; spinZ: number;
  source: 'file' | 'slot' | 'default';
};

/** 取设施配置（按设施键，含默认值填充）。单一委派到 resolveScenePropConfig，避免两处口径漂移。 */
export function getScenePropConfig(key: string): ResolvedScenePropConfig {
  return resolveScenePropConfig(key);
}

/** 该设施的尺寸是否已在 SCENE_PROP_CONFIG 中登记（未登记 → 走兜底尺寸，巡览会标注） */
export function isScenePropSizeRegistered(key: string): boolean {
  return !!SCENE_PROP_CONFIG[key];
}

/** 文件名 → 基础键（去扩展名、去阵营后缀）：`base_alliance.glb` → `base` */
export function scenePropFileKey(fileName: string): string {
  return fileName.replace(/\.glb$/i, '').replace(/_(empire|alliance)$/i, '');
}

/**
 * **尺寸解析唯一口径（巡览与战场共用，避免两处显示不一致）**：
 *   ① 文件自身登记 SCENE_PROP_CONFIG[文件名]  → source 'file'（最具体，优先）
 *   ② 绑定槽位登记 SCENE_PROP_CONFIG[槽位键]  → source 'slot'（如 my_station 绑到 fortress 时取 fortress 的尺寸）
 *   ③ 兜底 DEFAULT_SCENE_PROP_SIZE            → source 'default'
 * lift / yaw / pitch / roll / spin* 随同一条登记**整体**生效（file 命中即不再看 slot）。
 */
export function resolveScenePropConfig(
  fileBaseName: string, slotKey?: string,
): ResolvedScenePropConfig {
  const f = SCENE_PROP_CONFIG[fileBaseName];
  const s = slotKey ? SCENE_PROP_CONFIG[slotKey] : undefined;
  // 取值口径与旧版逐位一致：命中 file 即整条用 file（缺省字段回落**默认值**，不回落到 slot），
  // 命中 slot 同理 ⇒ 只是新增 pitch / roll / spin* 三组字段，既有 size / lift / yaw 行为零变化。
  const src = f ?? s;
  return {
    size: src?.size ?? DEFAULT_SCENE_PROP_SIZE,
    lift: src?.lift ?? 0,
    yaw: src?.yaw ?? 0,
    pitch: src?.pitch ?? 0,
    roll: src?.roll ?? 0,
    spinY: src?.spinY ?? 0,
    spinX: src?.spinX ?? 0,
    spinZ: src?.spinZ ?? 0,
    source: f ? 'file' : (s ? 'slot' : 'default'),
  };
}

/**
 * 组装某设施键的候选文件名（顺序即回退顺序）：
 *   ① SCENE_PROP_BINDING 手工绑定（不改名也能用） → ② `{键}_{阵营}.glb` → ③ `{键}.glb`
 */
export function scenePropCandidates(key: string, factionKey?: 'empire' | 'alliance'): string[] {
  const out: string[] = [];
  const bind = SCENE_PROP_BINDING[key];
  if (bind) {
    (Array.isArray(bind) ? bind : [bind]).forEach((n) => out.push(n.endsWith('.glb') ? n : `${n}.glb`));
  }
  if (factionKey) out.push(`${key}_${factionKey}.glb`);
  out.push(`${key}.glb`);
  return out;
}

/** 反查：某文件（不含扩展名）被绑定到了哪个设施键（巡览展示用） */
export function getScenePropSlotOf(fileBaseName: string): string | null {
  for (const [slot, bind] of Object.entries(SCENE_PROP_BINDING)) {
    const arr = Array.isArray(bind) ? bind : [bind];
    if (arr.some((n) => n.replace(/\.glb$/i, '') === fileBaseName)) return slot;
  }
  return null;
}

/** 设施模型注册表项：ready 前 geo 为空；就绪后 version++ 供使用方检测并原地换装 */
export interface ScenePropReg {
  status: 'loading' | 'ready' | 'failed';
  geo?: THREE.BufferGeometry;
  wire?: THREE.EdgesGeometry;
  maxDim?: number;
  tris?: number;
  fileName: string;
  version: number;
}

const propRegistry = new Map<string, ScenePropReg>(); // key = URL

/** 全部已发现的设施模型文件名（供调试/巡览） */
export function listScenePropFiles(): string[] {
  return Object.keys(SCENE_PROP_FILES).map(k => k.split('/').pop() || k).sort();
}

/** 是否存在某设施模型文件（只查表、不触发加载——供渲染层提前决定"走模型还是走程序化兜底"） */
export function hasScenePropFile(name: string): boolean {
  const f = name.endsWith('.glb') ? name : `${name}.glb`;
  return Object.keys(SCENE_PROP_FILES).some(k => k.endsWith('/' + f));
}

/** 按候选文件名顺序解析模型 URL 并确保加载；全部未命中返回 null。
 *  候选顺序即回退顺序：阵营差异（key_empire/key_alliance）→ 通用（key）。 */
export function acquireScenePropByFiles(candidates: string[]): ScenePropReg | null {
  for (const f of candidates) {
    const hit = Object.keys(SCENE_PROP_FILES).find(k => k.endsWith('/' + f));
    if (!hit) continue;
    const url = SCENE_PROP_FILES[hit];
    const fileName = hit.split('/').pop() || f;
    let reg = propRegistry.get(url);
    if (!reg) {
      reg = { status: 'loading', fileName, version: 0 };
      propRegistry.set(url, reg);
      enqueueSceneProp(url, reg);
    }
    return reg;
  }
  return null;
}

/** 按设施键取模型（绑定优先 → 阵营差异 → 通用名，见 scenePropCandidates） */
export function acquireSceneProp(key: string, factionKey?: 'empire' | 'alliance'): ScenePropReg | null {
  return acquireScenePropByFiles(scenePropCandidates(key, factionKey));
}

/** 是否存在可用于该设施键的模型文件（含绑定/阵营差异回退；只查表、不触发加载）。
 *  渲染层用它提前决定"走模型还是走程序化兜底"。 */
export function hasScenePropFor(key: string, factionKey?: 'empire' | 'alliance'): boolean {
  return scenePropCandidates(key, factionKey).some(f => hasScenePropFile(f));
}

// ── 并发限流加载队列（与舰船管線同策略：设施数量少，并发上限取 3）──
const MAX_CONCURRENT_PROP_LOADS = 3;
const loadQueue: Array<{ url: string; reg: ScenePropReg }> = [];
let activeLoads = 0;

function enqueueSceneProp(url: string, reg: ScenePropReg): void {
  loadQueue.push({ url, reg });
  pumpLoadQueue();
}

function pumpLoadQueue(): void {
  while (activeLoads < MAX_CONCURRENT_PROP_LOADS && loadQueue.length > 0) {
    const job = loadQueue.shift()!;
    activeLoads++;
    runScenePropLoad(job.url, job.reg, () => {
      activeLoads--;
      pumpLoadQueue();
    });
  }
}

/** 线框生成上限：超过此面数不再生成 EdgesGeometry（避免大模型线框计算卡顿/线爆量） */
const MAX_WIRE_TRIS = 200000;

/** 加载单个设施模型（每 URL 一次）。
 *  处理链：合并子网格 → 去贴图属性 → **不旋转/不翻转** → 居中 → 轮廓线框。 */
function runScenePropLoad(url: string, reg: ScenePropReg, done: () => void): void {
  new GLTFLoader().load(
    url,
    (gltf) => {
      try {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const parts: THREE.BufferGeometry[] = [];
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!(mesh as any).isMesh || !mesh.geometry) return;
          let g = mesh.geometry.clone();
          if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
          for (const name of Object.keys(g.attributes)) {
            if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
          }
          g.applyMatrix4(mesh.matrixWorld);
          parts.push(g);
        });
        if (parts.length === 0) { console.error(`[sceneProps] ${url} 无网格`); reg.status = 'failed'; done(); return; }
        const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
        parts.forEach(p => p.dispose());
        if (!merged) { console.error(`[sceneProps] ${url} 合并失败`); reg.status = 'failed'; done(); return; }
        // 居中（不做轴向旋转/朝向翻转——设施朝向由建模决定，必要时用 SCENE_PROP_CONFIG.yaw 修正）
        merged.computeBoundingBox();
        const size = new THREE.Vector3();
        merged.boundingBox!.getSize(size);
        const c = new THREE.Vector3();
        merged.boundingBox!.getCenter(c);
        merged.translate(-c.x, -c.y, -c.z);
        merged.computeBoundingBox();
        reg.geo = merged;
        reg.maxDim = Math.max(size.x, size.y, size.z) || 1;
        reg.tris = Math.round(merged.attributes.position.count / 3);
        reg.wire = reg.tris <= MAX_WIRE_TRIS ? new THREE.EdgesGeometry(merged, 30) : undefined;
        reg.status = 'ready';
        reg.version++;
        console.log(`[sceneProps] 设施模型就绪 ${reg.fileName}: ${reg.tris.toLocaleString()} tris${reg.wire ? '' : '（面数超限，跳线框）'}`);
      } catch (err) {
        console.error(`[sceneProps] ${url} 解析失败:`, err);
        reg.status = 'failed';
      }
      done();
    },
    undefined,
    (err) => {
      console.error(`[sceneProps] ${url} 加载失败:`, err);
      reg.status = 'failed';
      done();
    },
  );
}

/** 竖直方向包围盒：把 ±half 的 8 个角点过旋转矩阵，取 y 的极值。
 *  · 贴地：inner.position.y = −minY ⇒ 旋转后的最低点精确落在 y=0
 *  · 悬浮：再叠加 lift × 旋转后高度
 *  · **翻滚动画（spinX / spinZ）每帧复用本函数** ⇒ 模型始终"贴着地面翻滚"、不穿地
 *  ⚠ half 沿用"geo 包围盒中心在原点"这一既有假设（与旧版 `scaledH / 2` 同口径）——
 *    pitch = roll = 0 时 minY = −scaledH/2 ⇒ 贴地量 = scaledH/2，与旧公式逐位一致（零回归）。 */
const _extM4 = new THREE.Matrix4();
const _extV3 = new THREE.Vector3();
function verticalExtent(half: THREE.Vector3, euler: THREE.Euler): { minY: number; maxY: number } {
  _extM4.makeRotationFromEuler(euler);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    _extV3.set(
      (i & 1 ? 1 : -1) * half.x,
      (i & 2 ? 1 : -1) * half.y,
      (i & 4 ? 1 : -1) * half.z,
    ).applyMatrix4(_extM4);
    if (_extV3.y < minY) minY = _extV3.y;
    if (_extV3.y > maxY) maxY = _extV3.y;
  }
  return { minY, maxY };
}

/** 由已就绪模型构建战场设施对象（返回 Group，局部原点 = 地面）。
 *  · 尺寸：SCENE_PROP_CONFIG[key].size（hexR 倍数）→ 按包围盒最长边等比缩放
 *  · 姿态：yaw / pitch / roll（固定 YXZ 序）→ **按旋转后的竖直包围盒贴地**（"竖起来"也不会陷进地面）
 *  · 动画：spin* 写进 userData，由 advanceScenePropSpin 每帧推进（战场与巡览共用同一实现）
 *  · 外观：与舰船同一套"半透明体 + 轮廓线框"语言，颜色由调用方传入（阵营色/设施色）
 *  · 就绪前/失败返回 null
 *  @param override 尺寸/姿态覆盖 —— 供巡览"试转预览"在不改配置表的前提下按目标值重建 */
export function buildScenePropFromModel(
  reg: ScenePropReg, key: string, hexR: number, color: number,
  override?: Partial<ResolvedScenePropConfig>,
): THREE.Group | null {
  const geo = reg.geo;
  if (reg.status !== 'ready' || !geo) return null;
  // 尺寸/姿态唯一口径：文件自身登记 → 绑定槽位登记 → 兜底（与巡览显示一致），再叠加显式覆盖
  const cfg: ResolvedScenePropConfig = {
    ...resolveScenePropConfig(scenePropFileKey(reg.fileName), key),
    ...(override ?? {}),
  };
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = (cfg.size * hexR) / maxDim;

  const bodyMat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(color).multiplyScalar(0.55).getHex(),
    transparent: true, opacity: 0.62, shininess: 45, specular: 0x88aacc,
  });
  const wireMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex(),
    transparent: true, opacity: 0.9,
  });

  const inner = new THREE.Group();
  const body = new THREE.Mesh(geo, bodyMat);
  body.scale.setScalar(s);
  inner.add(body);
  if (reg.wire) {
    const wire = new THREE.LineSegments(reg.wire, wireMat);
    wire.scale.setScalar(s);
    inner.add(wire);
  }
  // 姿态：先设 order 再 set（Euler.set 不带 order 参数时保留当前 order）⇒
  //   YXZ 语义 = 先绕 x/z 竖起翻正、最后绕 y 定朝向 ⇒ yaw 恒为绕**世界竖直轴**。
  inner.rotation.order = 'YXZ';
  inner.rotation.set(
    THREE.MathUtils.degToRad(cfg.pitch),
    THREE.MathUtils.degToRad(cfg.yaw),
    THREE.MathUtils.degToRad(cfg.roll),
  );
  // 贴地/悬浮：按**旋转后**的竖直包围盒重算（旧版直接取 scaledH/2，竖起来的模型会陷地）
  const half = size.clone().multiplyScalar(s * 0.5);
  const ext = verticalExtent(half, inner.rotation);
  const rotH = ext.maxY - ext.minY;
  inner.position.y = -ext.minY + cfg.lift * rotH;

  const grp = new THREE.Group();
  grp.add(inner);
  grp.userData.sceneProp = {
    key, bodyMat, wireMat, hexR,
    inner, half, lift: cfg.lift,     // 供 advanceScenePropSpin 做翻滚期的贴地重算
    spin: {
      x: THREE.MathUtils.degToRad(cfg.spinX),
      y: THREE.MathUtils.degToRad(cfg.spinY),
      z: THREE.MathUtils.degToRad(cfg.spinZ),
    },
  };
  // H 取**旋转后**高度（巡览标签用它定位；pitch=roll=0 时 = scaledH，与旧值一致）
  grp.userData.dims = { L: size.z * s, W: size.x * s, H: rotH };
  return grp;
}

/** 推进设施自旋动画（**战场与巡览共用同一实现**，避免"两处各转各的"漂移）。
 *  · dt 单位 = 真实秒（与 relayRings / fortressRings 既有口径一致，不随战斗倍速缩放）
 *  · 绕 y 轴自转不改变竖直包围盒 ⇒ 最省；绕 x/z 翻滚会改变 ⇒ 每帧重算贴地偏移
 *  · 无自旋配置（或全为 0）时立即返回，零开销
 *  @returns 是否实际推进了（供调用方做统计/跳过） */
export function advanceScenePropSpin(grp: THREE.Object3D, dt: number): boolean {
  const sp = (grp.userData as any)?.sceneProp;
  if (!sp?.inner || !sp?.spin) return false;
  const spin = sp.spin as { x: number; y: number; z: number };
  if (!spin.x && !spin.y && !spin.z) return false;
  const inner = sp.inner as THREE.Group;
  if (spin.y) inner.rotation.y += spin.y * dt;
  let rolling = false;
  if (spin.x) { inner.rotation.x += spin.x * dt; rolling = true; }
  if (spin.z) { inner.rotation.z += spin.z * dt; rolling = true; }
  if (rolling && sp.half) {
    const ext = verticalExtent(sp.half as THREE.Vector3, inner.rotation);
    inner.position.y = -ext.minY + (sp.lift ?? 0) * (ext.maxY - ext.minY);
  }
  return true;
}

/** 阵营色/设施色同步（供每帧颜色刷新的使用方调用）。
 *  命中设施模型 → 按"体色×0.55 + 线框提亮"刷新（与舰船同源口径），返回 true；
 *  未命中（非模型对象 / 模型尚未就绪）→ 返回 false，调用方自行处理。
 *  兼容两种入参：buildScenePropFromModel 返回的 Group 本身，或包裹它的 holder。 */
export function applyScenePropColor(grp: THREE.Object3D, hex: number): boolean {
  const sp = (grp.userData as any)?.sceneProp ?? (grp.children[0]?.userData as any)?.sceneProp;
  if (!sp) return false;
  sp.bodyMat.color.setHex(new THREE.Color(hex).multiplyScalar(0.55).getHex());
  sp.wireMat.color.setHex(new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.35).getHex());
  return true;
}
