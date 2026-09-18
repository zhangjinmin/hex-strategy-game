/**
 * planetModels.ts — 战略地图星球/要塞 GLB 模型注册表
 *
 * 与舰船模型（shipModels.ts）同构，但有三点不同：
 *   1. 存放目录：assets/planet/（命名 = {节点id}.glb，见 docs/design/战略地图星球模型规范.md）
 *   2. 不使用模型自带材质：加载后全部丢弃，改用战略层统一阵营色材质
 *      （模型材质对用户无意义 —— 用户会压缩材质以减小体积；
 *        且战略地图是"全息沙盘"风格，统一材质才能与其他程序化星球视觉一致）
 *   3. 尺寸自动归一化到节点半径，模型导出尺寸随意
 *
 * 旋转：模型 Mesh 直接 add 进节点 Group，自动继承该 Group 的 userData.axis/spin
 *       自转（ThreeStrategicMap.ts），无需在此处理。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** 自动发现 assets/planet/ 下所有 GLB */
export const PLANET_MODEL_FILES = import.meta.glob('../../assets/planet/*.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** 节点 id → 模型文件名。新增要塞/星球：加一行即可，不用改 ThreeStrategicMap.ts */
export const PLANET_MODEL_MAP: Record<number, string> = {
  1: '1.glb',   // 伊谢尔伦要塞
  // 例：7: '7.glb',  // 某要塞
};

/** 无需翻转的模型文件名 → true（默认与舰船一致：glTF +Z 朝前，按需翻转） */
export const PLANET_MODEL_FLIP: Record<string, true> = {};

export interface PlanetModelReg {
  status: 'loading' | 'ready' | 'failed';
  geo?: THREE.BufferGeometry;
  wire?: THREE.EdgesGeometry;
}

const registry = new Map<string, PlanetModelReg>();
const loader = new GLTFLoader();

/** 按节点 id 取模型 URL（未登记或未找到文件返回 null） */
export function getPlanetModelUrl(nodeId: number): string | null {
  const file = PLANET_MODEL_MAP[nodeId];
  if (!file) return null;
  const hit = Object.keys(PLANET_MODEL_FILES).find(k => k.endsWith('/' + file));
  return hit ? PLANET_MODEL_FILES[hit] : null;
}

/** 加载并解析：合并 Mesh → 丢弃自带材质 → 中心化 → 最长轴归一 → 生成线框 */
export function acquirePlanetModel(nodeId: number, radius: number): PlanetModelReg | null {
  const url = getPlanetModelUrl(nodeId);
  if (!url) return null;

  let reg = registry.get(url);
  if (reg) return reg.status === 'failed' ? null : reg;

  reg = { status: 'loading' };
  registry.set(url, reg);

  loader.load(
    url,
    (gltf: any) => {
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o: any) => { if (o.isMesh && o.geometry) meshes.push(o); });
      if (meshes.length === 0) { reg!.status = 'failed'; console.error('[planetModels] 无网格:', url); return; }

      // 取体积最大的 Mesh（多部件模型取主体，避免小部件主导尺寸）
      let best = meshes[0];
      let bestVol = 0;
      meshes.forEach(m => {
        m.geometry.computeBoundingBox();
        const s = new THREE.Vector3();
        m.geometry.boundingBox!.getSize(s);
        const vol = s.x * s.y * s.z;
        if (vol > bestVol) { bestVol = vol; best = m; }
      });

      const geo = best.geometry.clone();
      // 丢弃模型自带材质（用户要求：不用模型材质，统一用战略层阵营色）
      geo.deleteAttribute('uv');

      // 中心化
      geo.computeBoundingBox();
      const c = new THREE.Vector3();
      geo.boundingBox!.getCenter(c);
      geo.translate(-c.x, -c.y, -c.z);

      // 最长轴归一化到 2 * radius（直径）
      geo.computeBoundingBox();
      const size = new THREE.Vector3();
      geo.boundingBox!.getSize(size);
      const maxAxis = Math.max(size.x, size.y, size.z) || 1;
      const s = (radius * 2) / maxAxis;
      geo.scale(s, s, s);
      geo.computeBoundingBox();

      reg!.geo = geo;
      reg!.wire = new THREE.EdgesGeometry(geo, 24);
      reg!.status = 'ready';
    },
    undefined,
    () => { reg!.status = 'failed'; console.error('[planetModels] 加载失败:', url); },
  );

  return reg;
}

/** 构造模型 Mesh（套用阵营色材质，与程序化星球视觉一致） */
export function buildPlanetMesh(
  reg: PlanetModelReg,
  radius: number,
  pal: { main: number; glow: string },
): THREE.Group | null {
  if (reg.status !== 'ready' || !reg.geo) return null;

  const group = new THREE.Group();

  // 主体：阵营色 + 自发光 + 加色混合（对标 contMat 的观感）
  const bodyMat = new THREE.MeshPhongMaterial({
    color: pal.main,
    emissive: pal.main,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.95,
    shininess: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Mesh(reg.geo, bodyMat));

  // 线框：突出结构（要塞类模型靠线框体现细节）
  if (reg.wire) {
    const wireMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(pal.main).lerp(new THREE.Color(0xffffff), 0.4),
      transparent: true, opacity: 0.9,
    });
    group.add(new THREE.LineSegments(reg.wire, wireMat));
  }

  return group;
}
