/**
 * animModels.ts — **动作模型（FBX，自带动画）** 的数据源与加载器（巡览"动作模型"板块用）
 *
 * 作者用法（**零登记**）：
 *   把 `.fbx` 丢进 `frontend/src/assets/anim/` ⇒ 重启 dev ⇒ 巡览里自动多出一件。
 *   文件名（去扩展名）= 展示名；中文名可选在 `ANIM_CN` 里补一行。
 *
 * 约定：**一个 fbx = 一段动作**（作者给的 walk.fbx / run.fbx 就是这样）⇒ 组件侧不做动作切换，
 * 只循环播放它自带的那一条 clip。想在同一模型上切换动作，正规做法是在 Blender 里把多个 Action
 * 一起导出成**一个 GLB**（多 clip），那属于 ship/scene 那条管线，不在本模块范围。
 *
 * ⚠ 三个实测坑（2026-09-17 探针 `_fbx_anim.cjs` 验证过）：
 *   1. FBX 单位多为 **cm**（实测模型高 186）⇒ 必须按包围盒归一化，别用默认 scale；
 *   2. 蒙皮网格**包围盒不随骨骼更新** ⇒ 视锥剔除会把模型整块剔掉（`frustumCulled = false`）；
 *   3. 要摆放**多份**实例必须 `SkeletonUtils.clone`（直接 `Object3D.clone` 会共用骨骼、姿态互串）。
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** 自动发现 `assets/anim/` 下全部 FBX（值 = URL）。
 *  ⚠ 新增文件需**重启 dev**（`import.meta.glob` 在构建期收集列表）。 */
export const ANIM_MODEL_FILES = import.meta.glob('../../assets/anim/*.fbx', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** 巡览里的目标**身高**（世界单位）—— 与舰船长度 `SHIP_LEN=18` 同一量级，站一起不显小。 */
export const ANIM_SHOW_HEIGHT = 22;

/** 文件名 → 中文展示名（可选；缺省用文件名本身）。例：`walk: '行走'` */
export const ANIM_CN: Record<string, string> = {
  walk: '行走动作',
  run: '奔跑动作',
};

/** 逐文件朝向修正（**度**）：Blender 导出的 FBX 常朝 +Z / −Z，与巡览相机不一致时在此登记。
 *  例：`{ 'walk.fbx': 180 }` */
export const ANIM_MODEL_YAW: Record<string, number> = {};

export interface AnimModelReg {
  fileName: string;
  url: string;
  status: 'loading' | 'ready' | 'failed';
  /** 原始场景（**不要直接放进场景**：多实例请走 `instantiateAnimModel`） */
  root?: THREE.Group;
  /** 该文件自带的 clip（FBX 的 clip 名多为 `Armature|<uuid>_remap`，无语义 ⇒ UI 一律用文件名） */
  clips: { name: string; duration: number; tracks: number }[];
  bones: number;
  tris: number;
  /** 归一化前的原始包围盒尺寸（FBX 单位，常见为 cm） */
  rawSize?: { x: number; y: number; z: number };
  error?: string;
}

const registry = new Map<string, AnimModelReg>();

/** 全部动模文件名（含扩展名；按名字排序，保证巡览顺序稳定） */
export function listAnimModelFiles(): string[] {
  return Object.keys(ANIM_MODEL_FILES)
    .map((p) => p.split('/').pop() || '')
    .filter((f) => /\.fbx$/i.test(f))
    .sort();
}

function urlOf(fileName: string): string | null {
  for (const [p, u] of Object.entries(ANIM_MODEL_FILES)) if (p.endsWith('/' + fileName)) return u;
  return null;
}

/** 取（并在首次调用时排队加载）某个动模的注册表项；返回 null = 文件不在 `assets/anim/` 里。
 *  与 `shipModels.ts` 同款用法：先拿 reg（可能 loading），组件侧轮询 status。 */
export function acquireAnimModel(fileName: string): AnimModelReg | null {
  const url = urlOf(fileName);
  if (!url) return null;
  const hit = registry.get(fileName);
  if (hit) return hit;
  const reg: AnimModelReg = { fileName, url, status: 'loading', clips: [], bones: 0, tris: 0 };
  registry.set(fileName, reg);
  new FBXLoader().load(
    url,
    (obj) => {
      try { fillReg(reg, obj as unknown as THREE.Group); }
      catch (err) { reg.status = 'failed'; reg.error = String(err); console.error(`[animModels] ${fileName} 解析失败:`, err); }
    },
    undefined,
    (err) => { reg.status = 'failed'; reg.error = String(err); console.error(`[animModels] ${fileName} 加载失败:`, err); },
  );
  return reg;
}

function fillReg(reg: AnimModelReg, root: THREE.Group): void {
  let tris = 0, bones = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry as THREE.BufferGeometry;
      const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      tris += n / 3;
      // ⚠ 蒙皮后包围盒不更新 ⇒ 不关剔除会被整块剔掉（尤其中远景）
      mesh.frustumCulled = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m) m.side = THREE.DoubleSide;
    }
    if ((o as THREE.Bone).isBone) bones++;
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  reg.root = root;
  reg.tris = Math.round(tris);
  reg.bones = bones;
  reg.rawSize = { x: size.x, y: size.y, z: size.z };
  reg.clips = (root.animations || []).map((a) => ({ name: a.name, duration: a.duration, tracks: a.tracks.length }));
  reg.status = 'ready';
}

/** 该动模的归一化系数（原始 → 显示单位）：按**身高**等比。 */
export function animUnitScale(reg: AnimModelReg, targetHeight = ANIM_SHOW_HEIGHT): number {
  const h = reg.rawSize ? reg.rawSize.y : 0;
  return targetHeight / Math.max(1e-6, h);
}

/** 摆放一份实例：**骨骼安全克隆** + 按身高归一化 + 贴地 + 起播它自带的动作。
 *  @returns root 已放在"脚底 y=0"；调用方只需设 `position.x/z`。
 *  ⚠ 每份实例一份 `AnimationMixer`（共享 mixer 会让所有实例同步到同一相位）。 */
export function instantiateAnimModel(reg: AnimModelReg, targetHeight = ANIM_SHOW_HEIGHT): {
  root: THREE.Group; mixer: THREE.AnimationMixer; action: THREE.AnimationAction | null; height: number;
} | null {
  if (reg.status !== 'ready' || !reg.root) return null;
  const root = skeletonClone(reg.root) as unknown as THREE.Group;
  const s = animUnitScale(reg, targetHeight);
  root.scale.setScalar(s);
  if (ANIM_MODEL_YAW[reg.fileName]) root.rotation.y = THREE.MathUtils.degToRad(ANIM_MODEL_YAW[reg.fileName]);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;                       // 贴地（缩放后重算，不假设原点在脚底）
  const mixer = new THREE.AnimationMixer(root);
  // ⚠ clip 取自**原始** root（克隆体不带头部 `animations` 引用），轨道名靠骨骼同名解析到克隆体上
  const clip = reg.root.animations && reg.root.animations[0];
  let action: THREE.AnimationAction | null = null;
  if (clip) {
    action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }
  return { root, mixer, action, height: (reg.rawSize ? reg.rawSize.y : 0) * s };
}
