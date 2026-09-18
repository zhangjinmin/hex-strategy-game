/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 战斗 3D 特效 —— **唯一真源**（v23）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 为什么有这个文件：
 *   尾焰 / 激光 / 导弹 / 护盾 / 命中爆闪原先在 `Battle3DOverlay`（战场）与
 *   `ShipGalleryOverlay`（模型巡览）各存一份**复制品**，靠注释里的"与战场一致"口头维系。
 *   实改结果：改战场忘巡览 ⇒ 巡览里看到的激光是又粗又连续的一条实线、导弹是旧款三维结构、
 *   尾焰还是锥形（用户实报"巡览和实际游戏效果不一样"）。
 *
 * 边界（关键）：
 *   本模块**无状态** —— 不持有 scene，不持有对象池，不碰生命周期。
 *   只负责两件事：① 造一个对象（几何 / 材质 / 时序参数）；② 推进一帧。
 *   入池、加场景、回收销毁由调用方负责（战场用 this.lasers 等池，巡览用本地数组）。
 *
 * 口径（与旧实现逐位一致）：
 *   · 所有尺寸都是 **hexR 的倍数** ⇒ hexR 由调用方传入（战场 = this.hexR，巡览 = 折算值）；
 *   · 不引入 Math.random 于"每帧"路径（导弹呼吸为确定性正弦，见 missileStep 注释）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ══════════════════════════════════════════════════════════════════════════════
// 类型（战场与巡览共用同一套条目结构）
// ══════════════════════════════════════════════════════════════════════════════

/** [v22 尾焰 / v24 重塑] 引擎喷口（局部坐标，**按模型长度归一化**：乘缩放 s 即世界单位）。
 *  s = 1 时可直接当世界单位用（程序化兜底造型走这条）。
 *
 *  ⚠ v24：由"中心点 + **全舰统一半径**"改为"**该喷口自己轮廓的半宽 / 半高**"。
 *    用户实报三宗罪：① 光斑是八边形圆饼、"不应该是圆形"；② 方尾舰顶着圆盘（形状不匹配）；
 *    ③ **穿模**（半径按舰宽 16% 给，大于实际开口 ⇒ 溢出舰体）。
 *    根因就是"用一个统一尺度代替了每个喷口的真实开口"。现在尺寸与形状都从**模型几何**来。 */
export interface EnginePort {
  x: number; y: number; z: number;
  /** 半宽（X，横向），归一化 */
  hx: number;
  /** 半高（Y，竖向），归一化 */
  hy: number;
  /** true = 圆管口（画圆盘）；false = 方 / 矩形开口（画矩形片） */
  round: boolean;
  /** [v25/v26] 从模型该处描出的**开口轮廓多边形**（扁平 [x0,y0,x1,y1,…]，归一化、以喷口中心为原点）。
   *  有它时几何按多边形挤出（ExtrudeGeometry）⇒ 光斑形状 = **模型内框线本身**，
   *  既不会像外接矩形那样四角伸出舰体（用户实报"长方块穿模"），也不是拿圆盘硬套。
   *  ⚠ v26：轮廓改为**可凹**（栅格化 + 空腔识别 + 裂缝跟随）—— v25 的凸包只能得到"外框线"，
   *  会把凹口填平、把整块结构圈成一圈（用户实报截图里那种跨住整个机翼的大六边形）。 */
  outline?: number[];
  /** [v27] 轮廓**缩放**（默认 1）。用户原话："之前用外轮廓做的那版，其实只要缩小就好了" ⇒
   *  在巡览标注面板里可直接调，实时预览，随配置行一起固化。 */
  outlineScale?: number;
  /** [v27] **朝向四元数**（仅模型自带的 FX 锚点会给）：光斑平面垂直于锚点局部 +Z。 */
  q?: [number, number, number, number];
  /** [v27/v28] 该喷口来自模型自带锚点时的**作者指定形状**：
   *  `round`/`rect` ⇒ 以作者为准（不再描轮廓）；`outline`/`scan`/未指定 ⇒ 从该处几何描轮廓
   *  （v28 起默认走**扫描**：以锚点为原点向四周撞墙 ⇒ 形状与尺寸都不用作者给）。 */
  fxMode?: PortMarkMode;
  /** [标定用] 尾端面顶点在 (x,y) 外接矩形内的栅格填充率（0~1）。
   *  渲染不读它；`_port_survey.cjs` 用它判断 `round` 阈值是否合理、是否需要进覆盖表。 */
  fill?: number;
  /** [v28 标定用] 该喷口的轮廓是**扫描**出来的读数（命中率 / 中位半径 / 切割深度）。
   *  渲染不读它；探针与巡览用它回答"这一刀切到墙了没有、光斑多大"。 */
  scan?: PortScanResult;
}

/** [v24] 按**文件名**（不含 .glb）钉死喷口造型的覆盖表。
 *  探测判据对绝大多数舰有效；个别舰尾结构特殊（整块尾板 / 异形开口）时，在此钉死，
 *  不必为它改探测算法 —— 这就是"逐个模型按其实际状态做"的兜底闸门。
 *  取值：'round' 圆盘 | 'rect' 矩形片 | 'none' 不画光斑（该舰自带头部发光或不需要）。
 *  例：`{ empire_battleship: 'rect', alliance_engine_ring: 'none' }` */
export const ENGINE_PORT_STYLE: Record<string, 'round' | 'rect' | 'none'> = {
  // （按实测逐舰标定；留空 = 全部走自动探测）
};

/** [v27/v28] 程序侧的**轮廓档**（巡览里可逐舰切换，落进 `ENGINE_PORT_OPTS*`）：
 *  · `scan` —— [v28] **扫描开口截面**：以给定点为原点向四周撞墙（形状/尺寸都不用作者给）—— 默认；
 *  · `convex` —— [v25] 结构**外轮廓**（凸包，可配缩放）；
 *  · `inner`  —— [v26] 栅格化空腔识别的**内框线**。 */
export type PortShapeMode = 'convex' | 'inner' | 'scan';
/** [v25/v27] 手点标注 / 锚点自定义属性 `mode` 的形状档 = 轮廓档 + 两个"硬形状" + 关。
 *  · `round` 圆盘 / `rect` 方片 / `none` 不画（这三档需要作者给半径）；
 *  · `outline` 是 v25 的老写法，与 `scan` 等价（保留是为了老配置行不用改）。 */
export type PortMarkMode = PortShapeMode | 'outline' | 'round' | 'rect' | 'none';

/** [v25] **手动标注的喷口**（按文件名；坐标**归一化**：÷ 包围盒最长边，与 EnginePort 同域）。
 *
 *  为什么需要它：自动探测对"尾部是一整块结构"的舰无能为力（例如休伯利安 Hyperion ——
 *  程序探到左右两个口，而实际尾焰在**中间一块**）。手动标注是最终裁决手段：
 *  一旦某文件出现在本表，就**完全按标注点**从模型几何描轮廓，不再走自动探测。
 *
 *  每个标注：x/y/z = 标注点（模型局部坐标，归一化）；r = 取点半径（归一化，默认 0.06）；
 *  mode = 'convex'（默认，**结构外轮廓** = v25 那版）| 'inner' 内框线 | 'round' 圆盘 | 'rect' 矩形 | 'none' 不画；
 *  scale = 轮廓缩放（默认 1）——"外轮廓其实只要缩小就好了"的那个旋钮，巡览里可实时调。
 *  ⚠ [v27] 遍历顺序与分组顺序一致；复制出来的行会带上 mode / scale（非默认值才写）。
 *
 *  ⚠ v26 修掉单位错位：`mark` 历来按归一化传入而 `pos` 是原始单位 ⇒ 旧版标注点其实**没起作用**
 *  （取点等效于"离模型原点最近的一小圈"）。现在函数内统一换算成原始单位，标注点精确生效。
 *
 *  怎么标：巡览里点「📍 标注喷口」进入标注模式 → 单击模型上要发光的部位（可多点）→
 *  点「📋 复制标注行」得到可直接粘贴到本表的配置行（边标边看，实时预览轮廓）。
 *  ⚠ [v27] **多点 = 一整块区域**：间距 ≤ 1.5× 半径的标注点会自动**并成一个喷口**
 *  （连点几下圈一片，得到的是"围住这些点的那块结构轮廓"，而不是几个小点）。想要多个独立喷口就拉开距离。
 *  ⚠ **键格式**：写 `flagship_hyperion` 或 `flagship_hyperion.glb` 都可以（内部按文件名归一查找）。
 *  例：{ flagship_hyperion: [{ x: 0, y: 0, z: 0.5, r: 0.075 }] } */
export const ENGINE_PORT_MARKS: Record<string, Array<{ x: number; y: number; z: number; r?: number; mode?: PortMarkMode; scale?: number }>> = {
  // 休伯利安：自动探测给的是左右两点，实际尾焰在**中间一块**（用户实拍标注）
  flagship_hyperion: [{ x: 0, y: 0, z: 0.5, r: 0.028 }],
};

/** [v25] **运行时标注层**（巡览标注模式写这里，用于"边标边看"的即时预览；不持久化）。
 *  优先级高于 ENGINE_PORT_MARKS ⇒ 标注时不必先改源码即可看到效果；
 *  满意后把巡览给出的配置行贴进 ENGINE_PORT_MARKS 即永久生效。 */
export const ENGINE_PORT_MARKS_RUNTIME: Record<string, Array<{ x: number; y: number; z: number; r?: number; mode?: PortMarkMode; scale?: number }>> = {};

/** [v27/v28] **模型自带的 FX 锚点**（在 Blender 里做，随 GLB 一起导出）—— 这是最稳的"喷口真源"：
 *  · 在 Blender 里加一个**空物体（Empty）**，命名以 `FX_ENGINE` / `ENGPORT` 开头（见 `FX_ANCHOR_RE`），
 *    摆到喷口**中心**（放在口内即可），局部 **+Z 指向喷口朝外方向**；
 *  · **[v28] 半径可以不设**：默认按"以锚点为原点向四周扫描撞到内壁为止"现场量出形状与尺寸
 *    （圆/方/椭圆/异形一律不分派）。想强制圆盘/方片时才需要给半径：
 *    `缩放 X`（按模型原始单位解释）、自定义属性 `radius`（同单位）或 `radiusRel`（占舰长比例）。
 *    ⚠ 缩放 X 落在可信区间（舰长的 0.4%~12%）之外时**不予采信**，直接走扫描 ——
 *    这就是"忘了改缩放 ⇒ 一个口 50% 舰长、另一个 0.15%"那个灾难的根治。
 *  · 形状/开关用自定义属性 `mode` = `round|rect|outline|scan|none`（缺省 = 扫描）。 */
export interface FxAnchor {
  name: string;
  /** 归一化坐标（÷ 最终模型最长边），与 EnginePort 同域 */
  x: number; y: number; z: number;
  /** 朝向四元数（局部）—— 光斑平面垂直于它 */
  q: [number, number, number, number];
  /** [v27b] 作者**没有旋转**这个空物体（X/Y/Z 旋转全 0）⇒ 程序自动把光斑正对舰尾方向
   *  （沿模型长度轴、朝锚点所在的那一端）。Blender 里零旋转即可用，不必算角度；
   *  只要作者转过（哪怕 1°），就完全以作者为准。 */
  autoOrient?: boolean;
  /** 归一化半径（仅"强制圆盘/方片"或扫描的搜索距离用到；缺省/离谱值 ⇒ 走扫描） */
  rN: number;
  mode?: PortMarkMode;
}

/** 锚点命名约定（大小写不敏感）：`FX_ENGINE_L` / `fx-engine-1` / `ENGPORT_R` / `EnginePort_mid` 都认。 */
export const FX_ANCHOR_RE = /^(fx[_-]?engine|engine[_-]?port|engport)/i;

/** 由锚点生成喷口（**最高优先级真源**）：位置/朝向取作者数据；形状与尺寸默认由**扫描**现场量出。
 *  ⚠ [v28] 半径不再必需，且**只采信合理区间内的值**（`SCAN_R_SANE`）：
 *  空物体的缩放 X 留在 1（= 0.5 舰长那种）或漏改（0.0015 舰长）都会被忽略 ⇒ 不会再出现
 *  "同一个模型上两个口差了 300 倍"这种事故，形状与尺寸一律由"向外撞墙"决定。 */
export function portsFromAnchors(anchors: FxAnchor[] | undefined): EnginePort[] {
  if (!anchors || !anchors.length) return [];
  const out: EnginePort[] = [];
  for (const a of anchors) {
    if (a.mode === 'none') continue;
    const raw = Math.max(1e-4, a.rN);
    const rN = raw >= SCAN_R_SANE[0] && raw <= SCAN_R_SANE[1] ? raw : SCAN_R_DEFAULT;
    // [v27b] 作者没转空物体 ⇒ 自动定向：光斑平面垂直于长度轴、朝锚点所在的那一端（±Z）。
    //   几何的盘轴是 +Z ⇒ 锚点在 −Z 端时转 180°（绕 Y）即可指向 −Z。
    const q: [number, number, number, number] = a.autoOrient
      ? (a.z >= 0 ? [0, 0, 0, 1] : [0, 1, 0, 0])
      : a.q;
    out.push({
      x: a.x, y: a.y, z: a.z,
      hx: rN, hy: rN,
      // [v28] 缺省先按**圆盘**兜底（扫描成功后才换成扫出的轮廓）；只有作者明写 rect 才是方片
      //   —— 旧版对 outline 给 round=false ⇒ 扫描失败会退化成一个巨大的**方片**（比圆盘更糟）。
      round: a.mode !== 'rect',
      outlineScale: 1,
      q,
      fxMode: a.mode,
    });
  }
  return out;
}

/** [v27/v28] **按舰的轮廓选项（持久层）**：不必打点也能调"扫描 / 外轮廓 / 内框线 / 缩放"。
 *  用户实报"点了外轮廓/内框线/缩放没效果" —— 因为那三个开关此前只对**手动标注**生效；
 *  现在它们对**任何选中的舰**都生效（模型自带锚点与自动探测路径也读这里），巡览里实时预览、
 *  复制出来即固化。 */
export const ENGINE_PORT_OPTS: Record<string, { mode?: PortShapeMode; scale?: number }> = {
  // 例：flagship_Berlin: { mode: 'convex', scale: 0.7 },
};

/** [v27] 同上，**运行时层**（巡览调参写这里；不持久化，优先级高于 ENGINE_PORT_OPTS）。 */
export const ENGINE_PORT_OPTS_RUNTIME: Record<string, { mode?: PortShapeMode; scale?: number }> = {};

export interface LaserEntry {
  /** [v13 ①] 由单 Mesh 放宽为 Object3D：普通激光为「细核+柔晕」双层 Group。 */
  mesh: THREE.Object3D;
  life: number; max: number;
}

export interface HitEntry { sprite: THREE.Sprite; life: number; max: number }

export interface ShieldEntry {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  active: boolean;
  t: number;
  R0: number; R1: number; R2: number;
}

/** 3D 导弹弹幕单枚（v13 重设计：弹尖+细弹体+引擎光点+渐变拖尾） */
export interface MissileEntry {
  /** [v13 ②] 收紧为 Group（弹尖原点，+z 向后：弹体 / 引擎光点 / 拖尾三 mesh） */
  mesh: THREE.Group;
  /** 引擎光点（弹尾，确定性呼吸缩放） */
  flame: THREE.Mesh;
  /** 弹体材质（出膛淡入用 baseOpacity 同步 ramp） */
  bodyMat: THREE.MeshBasicMaterial;
  /** 引擎光点材质（出膛淡入） */
  flameMat: THREE.MeshBasicMaterial;
  /** 拖尾 ShaderMaterial（uFade 兼作出膛淡入，无 Math.random） */
  trailMat: THREE.ShaderMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;          // 0→1 推进进度
  dur: number;        // 总时长（秒）
  delay: number;      // 发射延迟（秒，多联装错峰）
  seed: number;       // 确定性呼吸相位（v13：不再用于摆动/噪声）
  perp: THREE.Vector3;
  color: number;
  hitFlashDone: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// 护盾（定向半球涟漪）—— shader 注意 pow(负底数,y) 未定义行为
// ══════════════════════════════════════════════════════════════════════════════

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
  vec3  col = uColor * (0.22 + fres * 0.60 + ring * 0.35)
            + vec3(0.75, 0.90, 1.0) * core * 0.55;
  // v6.4：整体降透明——护盾是氛围反馈不是主角，用户实报"太深、抢戏，要淡淡的"
  float a   = (0.05 + fres * 0.32 + grid * 0.15 + ring * 0.30 + core * 0.40) * uAlpha;
  gl_FragColor = vec4(col * a, a);
}`;

/** 护盾单次涟漪时长（秒） */
export const SHIELD_DUR = 0.85;

export const easeOutBack = (x: number): number => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** 造一个待用护盾（Mesh + ShaderMaterial，**不加入 scene**，由调用方 add 并入池） */
export function makeShieldEntry(): ShieldEntry {
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
  return { mesh, mat, active: false, t: 0, R0: 0, R1: 0, R2: 0 };
}

/**
 * 触发一次护盾涟漪（复用已建条目）。
 *
 * 口径：**纯单舰盾** —— shipLen 即受击舰舰长，半球半径 = 舰长 × 固定小系数。
 * （v5 的"舰队级展开"与 v6 的"半径钳制"两套口径全部废弃：用户两次实报护盾过大。）
 *
 * @param incomingDir 来袭方向（从靶心指向来袭者）；函数内取反得 outward，盾朝来袭侧张开
 * @param hexR        基准尺度（战场 = this.hexR；巡览 = 折算值）
 */
export function shieldFire(
  s: ShieldEntry, hitPoint: THREE.Vector3, incomingDir: THREE.Vector3,
  shipLen: number, color: number, hexR: number,
): void {
  const outward = incomingDir.clone().negate().normalize();
  // v6.4：系数整体收紧（1.15/0.35/1.55 → 0.85/0.28/1.15）——贴舰皮薄罩，护盾只包住舰体
  const L = Math.max(shipLen, hexR * 0.5);
  const R1 = L * 0.85;

  s.active = true; s.t = 0;
  s.R0 = L * 0.28; s.R1 = R1; s.R2 = L * 1.15;
  s.mesh.visible = true;
  s.mesh.position.copy(hitPoint).addScaledVector(outward, -s.R0 * 0.25);
  s.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
  s.mesh.scale.setScalar(s.R0);
  // v6.4：去掉 wireGain 提亮——阵营原色本身就够辨识，提亮是"太深太艳"的主因之一；
  // 再压 0.85 倍让盾色整体淡一档
  (s.mat.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(0.85);
  s.mat.uniforms.uGridScale.value = Math.max(6, Math.round((L / hexR) * 9));
  s.mat.uniforms.uTime.value = 0;
  s.mat.uniforms.uAlpha.value = 1;
  s.mat.uniforms.uRingPos.value = 0;
}

/** 护盾三段动画推进（收缩到位 → 平台期 → 膨胀淡出）。返回 true 表示本帧已结束（调用方应隐藏 mesh）。 */
export function shieldStep(s: ShieldEntry, dt: number): boolean {
  if (!s.active) return false;
  s.t += dt;
  const k = s.t / SHIELD_DUR;
  if (k >= 1) { s.active = false; s.mesh.visible = false; return true; }
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
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// 激光（断续脉冲串）
// ══════════════════════════════════════════════════════════════════════════════

/** [v22 激光断续] 沿 **+y 轴**排列的"短段串"几何（总长 = len、中心在原点）。
 *  · 段长 ≈ 周期的 55~62%，段间**留空** ⇒ 明显的断续，而不是一条实心直线；
 *  · 近端（出膛处）段更长、远端更短（能量沿程衰减）⇒ 读作"从炮口射出的脉冲串"；
 *  · 同时产出 core / halo 两套几何，段划分**完全一致** ⇒ 两层亮段严格对齐、不糊成实线。 */
export function buildDashedBeamGeo(len: number, coreR: number, hexR: number): { core: THREE.BufferGeometry; halo: THREE.BufferGeometry } {
  const period = Math.max(hexR * 0.16, len / 14);        // 段周期（远距离自动变长；段数封顶 ~14）
  const segCount = Math.max(2, Math.min(14, Math.round(len / period)));
  const step = len / segCount;                           // 实际周期：让段串正好铺满全长
  const parts: THREE.BufferGeometry[] = [];
  const partsHalo: THREE.BufferGeometry[] = [];
  for (let i = 0; i < segCount; i++) {
    const t0 = i / segCount;                             // 0 = 出膛端
    const segLen = step * (0.62 - 0.28 * t0);            // 近端长、远端短
    const yCenter = -len / 2 + step * (i + 0.5);
    const g = new THREE.CylinderGeometry(coreR, coreR, segLen, 5);
    g.translate(0, yCenter, 0);
    parts.push(g);
    const gh = new THREE.CylinderGeometry(coreR * 2.6, coreR * 2.6, segLen * 1.15, 5);
    gh.translate(0, yCenter, 0);
    partsHalo.push(gh);
  }
  const merge = (arr: THREE.BufferGeometry[]) => {
    const n = arr.map((g) => (g.index ? g.toNonIndexed() : g));
    const m = mergeGeometries(n, false) || n[0];
    arr.forEach((g) => g.dispose());
    return m;
  };
  return { core: merge(parts), halo: merge(partsHalo) };
}

/**
 * 造一条激光束（**细白核 + 柔色晕**，核心是断续段串）。
 *
 * [v13 ①] 用户实报"战舰这么多，激光粗就很丑" ⇒ 单层粗柱改双层，径向尺寸显著下调。
 *   · 细白核 radius = (power≥2 ? 0.004 : 0.005)·hexR，0xffffff，opacity 0.95；
 *   · 色晕层 radius = 核×2.6，color=传入色，opacity 0.22。
 *  各材质 userData.baseOpacity 存基础透明度，laserStep 按 life 同步淡出。
 * [v22 断续] 用户实报"动画里激光其实是**断续**射出的，一轮射击不要一条线" ⇒ 短段串。
 *  ⚠ 分段只在**几何**里做（N 个短柱 merge 成 1 个 BufferGeometry，整组再旋转到射向）
 *   ⇒ draw call 与旧实现**逐位相同**（仍是 core + halo 两个 Mesh）。
 *
 * @returns 未加入 scene 的条目；长度 < 1 时返回 null（与旧实现同样的早退）
 */
export function buildLaserEntry(
  from: THREE.Vector3, to: THREE.Vector3, color: number, hexR: number, power?: number,
): LaserEntry | null {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1) return null;
  const heavy = power !== undefined && power >= 2;
  const coreR = (heavy ? 0.004 : 0.005) * hexR;
  // [v24 激光回退] 用户复核后判定"断续读起来像虚线、不如原来" ⇒ **改回连续直线**（恢复 v13 形态）。
  //   这里的"连续"= 单段柱体、中心在原点（Group 再整体旋转到射向），与 v13 逐位同构。
  //   ⚠ 断续实现 `buildDashedBeamGeo` 仍在本文导出保留（不删），若将来想再切回，把下面两行换成它返回的
  //     `segGeo.core / segGeo.halo` 即可 —— 只是 buildLaserEntry 内部一处改动。
  const coreGeo = new THREE.CylinderGeometry(coreR, coreR, len, 5);
  const haloGeo = new THREE.CylinderGeometry(coreR * 2.6, coreR * 2.6, len, 5);
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  coreMat.userData.baseOpacity = 0.95;
  group.add(new THREE.Mesh(coreGeo, coreMat));
  const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  haloMat.userData.baseOpacity = 0.22;
  group.add(new THREE.Mesh(haloGeo, haloMat));
  group.position.copy(from).addScaledVector(dir, 0.5);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return { mesh: group, life: 0.3, max: 0.3 };
}

/** 激光淡出推进（Group 内逐 mesh 按 userData.baseOpacity 同步淡出）。
 *  返回 true 表示已过期 —— 调用方负责 remove + 逐 mesh dispose 几何/材质。 */
export function laserStep(L: LaserEntry, dt: number): boolean {
  L.life -= dt;
  const fade = Math.max(0, L.life / L.max);
  L.mesh.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const base = (mat.userData && mat.userData.baseOpacity != null) ? mat.userData.baseOpacity : 0.95;
    mat.opacity = fade * base;
  });
  return L.life <= 0;
}

/** 逐 mesh 释放激光的几何 + 材质（无跨束共享：每条激光自建 geometry/material） */
export function disposeLaserEntry(L: LaserEntry): void {
  L.mesh.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose?.();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 导弹（光子鱼雷齐射）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * v13 ②：光子鱼雷设计——用户实报"发射出去的导弹还是有种跳跃感…就是一条直线，显得很粗，没有质感"。
 * 跳跃感根因 = 旧 updateMissiles 每帧 `headPulse = 0.9 + Math.random()*0.2` 白噪声缩放（60Hz 闪烁读作"跳"）⇒ 删除，
 * 改**确定性呼吸**（见 missileStep：el*32+seed 正弦）。
 * 结构改为「弹尖 + 细弹体 + 引擎光点 + 渐变拖尾」，**弹尖朝前、拖尾在后**、-z=飞行方向（沿用 v6.5 出膛即定向）。
 *   · 原点 = 弹尖（leading point）；group.position = lerp 位置；-z 对齐飞行方向（spawn 时 setFromUnitVectors 一次）。
 *   · 弹体：细锥（尖 hexR*0.0035 → 尾 hexR*0.006），沿 +z 从弹尖向后，长 bodyLen=hexR*0.13，白 additive 0.8。
 *   · 引擎光点：小球挂弹尾 z=+bodyLen，半径 hexR*0.006，色=传入色，0.85。
 *   · 拖尾：从弹尾继续 +z，trailLen=hexR*0.42；锥形（近端 hexR*0.004 → 远端 0.35×），ShaderMaterial
 *     vZ=原始几何 position.z∈[0,1]（scale 前），alpha=pow(1-vZ,1.5)*0.38*uFade，additive、depthWrite:false；
 *     uFade 兼作出膛淡入（delay 结束起 0.07s 内 0→1，弹体/引擎光点同步 ramp，消灭"弹入"感）。
 * 齐射节奏保持：出膛横向散布 + 逐枚 delay 0.05s；**直线弹道**（sway 不得复活）。
 * 材质每枚独立（中途 dispose 不影响同批）；几何按齐射共享、回收不 dispose 几何；每枚仍 3 mesh，draw call 不涨。
 *
 * @returns 未加入 scene 的条目数组（visible 初始 false，等 delay 走完由 missileStep 打开）
 */
export function buildMissileSalvo(
  from: THREE.Vector3, to: THREE.Vector3, color: number, count: number, hexR: number,
): MissileEntry[] {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1) return [];
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  // 齐射共享几何（每帧该齐射新建；回收不 dispose，随场景 traverse 兜底）
  const bodyLen = hexR * 0.13;
  const rTip = hexR * 0.0035;              // 弹尖半径
  const rTail = hexR * 0.006;              // 弹尾半径
  const trailLen = hexR * 0.42;
  const trailR = hexR * 0.004;
  // 弹体：细锥，尖在 z=0、尾在 z=bodyLen（CylinderGeometry 经 rotateX(π/2) 后 top→+z、bottom→−z）
  const bodyGeo = new THREE.CylinderGeometry(rTail, rTip, bodyLen, 6);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, 0, bodyLen / 2);
  const engineGeo = new THREE.SphereGeometry(1, 8, 6);
  // 拖尾：单位锥（z∈[0,1]，近端 r=1、远端 r=0.35），mesh.scale 缩到 trailR / trailLen
  const trailGeo = new THREE.CylinderGeometry(0.35, 1, 1, 8, 1, true);
  trailGeo.rotateX(Math.PI / 2);
  trailGeo.translate(0, 0, 0.5);
  const out: MissileEntry[] = [];
  for (let m = 0; m < count; m++) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);
    const flameMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const engine = new THREE.Mesh(engineGeo, flameMat);
    engine.position.z = bodyLen;
    engine.scale.setScalar(hexR * 0.006);
    group.add(engine);
    const trailMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 0 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: [
        'varying float vZ;',
        'void main(){',
        '  vZ = position.z;',                     // 原始几何 z∈[0,1]（scale 前）
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying float vZ; uniform vec3 uColor; uniform float uFade;',
        'void main(){',
        '  float a = pow(1.0 - vZ, 1.5) * 0.38 * uFade;',
        '  gl_FragColor = vec4(uColor, a);',
        '}',
      ].join('\n'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.z = bodyLen;
    trail.scale.set(trailR, trailR, trailLen);
    group.add(trail);
    // 出膛即定向：local -z → 飞行方向（弹尖朝前、拖尾在后）
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
    group.visible = false;
    out.push({
      mesh: group, flame: engine, bodyMat, flameMat, trailMat,
      from: from.clone().addScaledVector(perp, (m - count / 2 + 0.5) * hexR * 0.22),
      to: to.clone(),
      t: 0,
      dur: Math.min(1.6, Math.max(0.55, len / (hexR * 26))),   // v6.3：更快（26×hexR/s），光矢应一闪而至
      delay: m * 0.05,
      seed: m * 2.5,                              // v13：确定性呼吸相位（不再用 Math.random）
      perp: perp.clone(),
      color,
      hitFlashDone: false,
    });
  }
  return out;
}

/**
 * 导弹每帧推进——**纯直线弹道**（v6.4 及之前的 sway 侧偏整段删除：
 * 正弦包络侧偏是"全程跳动"的根因，齐射观感改由出膛横向散布 + 逐枚 delay 承担）。
 * 朝向 spawn 时已一次性定死，每帧只推进位置。
 * v13 ②：**删除每帧 Math.random 白噪声缩放**（60Hz 闪烁 = 用户实报"跳跃感"根因），
 * 改确定性呼吸（el*32+seed 正弦）；出膛 0.07s 内弹体/引擎光点/拖尾同步淡入（消灭"弹入"感）。
 *
 * @returns hit = 本帧首次命中（调用方 spawnHit）；done = 本帧抵达（调用方回收）
 */
export function missileStep(M: MissileEntry, dt: number, hexR: number): { hit: boolean; done: boolean } {
  if (M.delay > 0) { M.delay -= dt; M.mesh.visible = false; return { hit: false, done: false }; }
  M.mesh.visible = true;
  M.t += dt / M.dur;
  const p = Math.min(1, M.t);
  const base = new THREE.Vector3().lerpVectors(M.from, M.to, p);
  M.mesh.position.copy(base);
  // v13：确定性呼吸（无 Math.random）+ 出膛淡入
  const el = M.t * M.dur;
  const fadeIn = Math.min(1, el / 0.07);
  M.flame.scale.setScalar(hexR * 0.006 * (1 + 0.06 * Math.sin(el * 32 + M.seed)));
  M.bodyMat.opacity = 0.8 * fadeIn;
  M.flameMat.opacity = 0.85 * fadeIn;
  M.trailMat.uniforms.uFade.value = fadeIn;
  let hit = false;
  if (p >= 1 && !M.hitFlashDone) { M.hitFlashDone = true; hit = true; }
  return { hit, done: p >= 1 };
}

/** 回收导弹：从场景移除 + 释放材质（几何为齐射共享，**不** dispose） */
export function disposeMissileEntry(scene: THREE.Scene, M: MissileEntry): void {
  scene.remove(M.mesh);
  M.mesh.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    (mesh.material as THREE.Material).dispose?.();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 命中小闪光
// ══════════════════════════════════════════════════════════════════════════════

/** 命中小闪光（Sprite 加法混合，0.25s）。返回未加入 scene 的条目。 */
export function buildHitEntry(at: THREE.Vector3, color: number, hexR: number): HitEntry {
  const size = hexR * 0.55;
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
  return { sprite: sp, life: 0.25, max: 0.25 };
}

/** 命中闪光推进。返回 true 表示已过期（调用方 remove + dispose 贴图/材质）。 */
export function hitStep(H: HitEntry, dt: number, hexR: number): boolean {
  H.life -= dt;
  (H.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, H.life / H.max);
  H.sprite.scale.setScalar(hexR * (0.55 + (1 - H.life / H.max) * 0.5));
  return H.life <= 0;
}

/** 回收命中闪光 */
export function disposeHitEntry(scene: THREE.Scene, H: HitEntry): void {
  scene.remove(H.sprite);
  (H.sprite.material as THREE.SpriteMaterial).map?.dispose();
  (H.sprite.material as THREE.SpriteMaterial).dispose();
}

// ══════════════════════════════════════════════════════════════════════════════
// 引擎喷口（尾焰）—— 从模型几何自动探测，再按喷口造"微白光斑"
// ══════════════════════════════════════════════════════════════════════════════

/**
 * [v22 尾焰] 从**模型几何**自动探测引擎喷口位置 —— 用户实报"每艘战舰尾巴不一样，
 * 之前尾焰都是从战舰中心处统一的"，所以不能在舰尾中心钉一个点。
 *
 * 判据（第一性原理：引擎喷管是**突出于尾板**的结构）：
 *  ① 尾部 12% 带（放宽自 4%：4% 只命中中央主结构，两舷喷口被排除）取顶点；
 *  ② 沿**横向（舰宽方向）做直方图**并平滑 ⇒ 引擎喷管在横截面上表现为**局部峰**；
 *  ③ 取显著峰（高于均值）× 非极大值抑制 ⇒ 每峰 = 一根喷管；z 取该横向位置**最靠后**的点（贴舰尾）。
 *
 * 退化兜底：峰 < 2 个、或峰全挤在中央（|x| < 舰宽 18%）⇒ 按舰宽给**两舷对称**喷口
 * （观感上必须读作"两侧引擎"，不能是"中间一团"）。
 *
 * @returns 归一化坐标（除以 modelLen）的喷口，最多 4 个、按峰高降序
 */
export function detectEnginePorts(
  geo: THREE.BufferGeometry, modelLen: number, style?: 'round' | 'rect' | 'none',
  outlineMode?: 'inner' | 'convex',
): EnginePort[] {
  if (style === 'none') return [];
  const pos = geo.attributes?.position as THREE.BufferAttribute | undefined;
  const bb = geo.boundingBox;
  if (!pos || !bb || modelLen <= 0) return [];
  const spanZ = bb.max.z - bb.min.z;
  const spanX = bb.max.x - bb.min.x;
  const spanY = bb.max.y - bb.min.y;
  if (spanZ <= 0 || spanX <= 0) return [];
  const band = spanZ * 0.12;
  const zCut = bb.max.z - band;
  const n = pos.count;
  const stride = Math.max(1, Math.floor(n / 80000));       // 大模型降采样（统计口径不变）
  const BINS = 24;
  const xOfBin = (b: number) => bb.min.x + (b / BINS) * spanX;
  const hist = new Float32Array(BINS);
  for (let i = 0; i < n; i += stride) {
    const z = pos.getZ(i);
    if (z < zCut) continue;
    let b = Math.floor(((pos.getX(i) - bb.min.x) / spanX) * BINS);
    if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
    hist[b]++;
  }
  const sm = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    const a0 = hist[Math.max(0, b - 1)], a1 = hist[b], a2 = hist[Math.min(BINS - 1, b + 1)];
    sm[b] = (a0 + a1 + a2) / 3;
  }
  let mean = 0, used = 0;
  for (let b = 0; b < BINS; b++) if (sm[b] > 0) { mean += sm[b]; used++; }
  mean = used ? mean / used : 0;
  const peaks: { b: number; v: number }[] = [];
  for (let b = 1; b < BINS - 1; b++) {
    if (sm[b] <= sm[b - 1] || sm[b] < sm[b + 1]) continue;   // 局部极大
    if (sm[b] < mean * 1.25) continue;                        // 只认显著峰（噪声不认）
    peaks.push({ b, v: sm[b] });
  }
  peaks.sort((p, q) => q.v - p.v);
  const chosen = peaks.slice(0, 4).map((p) => p.b).sort((a, b) => a - b);

  // ③ [v24] 以相邻峰中点为界划分归属 ⇒ **每口统计自己的 bbox**（不再共用全舰统一半径）；
  //    再用 12×12 栅格填充率判形状：方/矩形开口四角有点（fill 高），圆管口外接方四角空（fill 低）。
  const measure = (bs: number[]) => {
    const lo: number[] = [], hi: number[] = [];
    for (let i = 0; i < bs.length; i++) {
      lo.push(i === 0 ? bb.min.x : xOfBin((bs[i - 1] + bs[i]) / 2));
      hi.push(i === bs.length - 1 ? bb.max.x : xOfBin((bs[i] + bs[i + 1]) / 2));
    }
    // 第一遍：全带 bbox —— 只用于定位该口**最靠后的 z**（尾端面在哪）
    const box = bs.map(() => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: -Infinity }));
    for (let i = 0; i < n; i += stride) {
      const z = pos.getZ(i); if (z < zCut) continue;
      const x = pos.getX(i), y = pos.getY(i);
      for (let k = 0; k < bs.length; k++) {
        if (x < lo[k] || x > hi[k]) continue;
        const a = box[k];
        if (x < a.minX) a.minX = x; if (x > a.maxX) a.maxX = x;
        if (y < a.minY) a.minY = y; if (y > a.maxY) a.maxY = y;
        if (z > a.maxZ) a.maxZ = z;
      }
    }
    // 第二遍：**只取尾端面**（该口 maxZ 往回 tailD 内）的顶点 ⇒ 真正的"开口轮廓"。
    //   ⚠ 实测教训一：用整条 12% 带统计，竖向会把**整块尾板**算进来（hy 顶到 70% 舰高 ⇒ 光斑糊住舰尾）。
    //   ⚠ 实测教训二：尾端面里仍会混入**上方离群结构**（尾翼/上层建筑的最后点）⇒ 取 10%~90% 分位
    //     而非 min/max 把离群剔除。"开口"是局部结构，不该被舰体其它部位撑大。
    const tailD = spanZ * 0.03;
    const openPts = bs.map(() => ({ xs: [] as number[], ys: [] as number[] }));
    for (let i = 0; i < n; i += stride) {
      const z = pos.getZ(i); if (z < zCut) continue;
      const x = pos.getX(i);
      let k = -1;
      for (let t = 0; t < bs.length; t++) if (x >= lo[t] && x <= hi[t]) { k = t; break; }
      if (k < 0) continue;
      if (z < box[k].maxZ - tailD) continue;
      openPts[k].xs.push(x); openPts[k].ys.push(pos.getY(i));
    }
    const qv = (arr: number[], p: number) => {
      if (!arr.length) return 0;
      const sorted = arr.slice().sort((a2, b2) => a2 - b2);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
    };
    // 尾端面顶点太少（该口在尾端没有可辨结构）⇒ 退回全带 bbox（仍受上限保护）
    const use = bs.map((_, k) => {
      const o = openPts[k];
      if (o.xs.length < 4) {
        return { minX: box[k].minX, maxX: box[k].maxX, minY: box[k].minY, maxY: box[k].maxY, maxZ: box[k].maxZ, tail: false };
      }
      return { minX: qv(o.xs, 0.1), maxX: qv(o.xs, 0.9), minY: qv(o.ys, 0.1), maxY: qv(o.ys, 0.9), maxZ: box[k].maxZ, tail: true };
    });
    // 第三遍：栅格填充率（形状判据）—— 与尺寸**同源**（都只用尾端面点集），判据才自洽
    const G = 12;
    const grids = bs.map(() => new Uint8Array(G * G));
    for (let k = 0; k < bs.length; k++) {
      const o = openPts[k], a = use[k];
      const wx = Math.max(1e-6, a.maxX - a.minX), wy = Math.max(1e-6, a.maxY - a.minY);
      for (let i = 0; i < o.xs.length; i++) {
        const gx = Math.floor(((o.xs[i] - a.minX) / wx) * G);
        const gy = Math.floor(((o.ys[i] - a.minY) / wy) * G);
        if (gx >= 0 && gy >= 0 && gx < G && gy < G) grids[k][gy * G + gx] = 1;
      }
    }
    return bs.map((_, k) => {
      const a = use[k];
      let filled = 0; for (let t = 0; t < G * G; t++) filled += grids[k][t];
      return {
        x: ((a.minX + a.maxX) * 0.5) / modelLen,
        y: ((a.minY + a.maxY) * 0.5) / modelLen,
        z: a.maxZ / modelLen,
        hx: Math.max(1e-6, (a.maxX - a.minX) * 0.5) / modelLen,
        hy: Math.max(1e-6, (a.maxY - a.minY) * 0.5) / modelLen,
        fill: filled / (G * G),
      };
    });
  };

  let raw = measure(chosen);
  // 退化兜底：峰 < 2 个、或峰全挤在中央（|x| < 舰宽 18%）⇒ 用**尾部左右两半的实际 bbox** 给两舷喷口
  const maxAbsX = raw.length ? Math.max(...raw.map((p) => Math.abs(p.x))) * modelLen : 0;
  if (raw.length < 2 || maxAbsX < spanX * 0.18) {
    const mid = (bb.min.x + bb.max.x) * 0.5;
    const halfOf = (x0: number, x1: number) => {
      let k = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < n; i += stride) {
        const z = pos.getZ(i); if (z < zCut) continue;
        const x = pos.getX(i); if (x < x0 || x > x1) continue;
        const y = pos.getY(i);
        k++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      if (k < 3) return null;
      return {
        x: ((minX + maxX) * 0.5) / modelLen,
        y: ((minY + maxY) * 0.5) / modelLen,
        z: maxZ / modelLen,
        hx: Math.max(1e-6, (maxX - minX) * 0.5) / modelLen,
        hy: Math.max(1e-6, (maxY - minY) * 0.5) / modelLen,
        fill: 1,                       // 兜底判不出形状 ⇒ 交给 style，缺省按"方"（尾板多为方形结构）
      };
    };
    const a = halfOf(bb.min.x, mid), b = halfOf(mid, bb.max.x);
    raw = [a, b].filter(Boolean) as typeof raw;
  }
  if (!raw.length) return [];

  // 上限保护与收缩（三轮实拍迭代的结论）：
  //  ① 单口不可能占掉半条舰宽（防某个峰把整块尾板吞进来）；
  //  ② **长宽比上限 1.8** —— 引擎开口不会是极端细长条（实测：同盟战列舰尾部是竖直框架，
  //     按尾端面 bbox 会得到 ar=0.09 的细竖条，光斑沿结构向上穿出舰体）；
  //  ③ **轮廓收缩 0.45** —— 尾端面 bbox 量的是"结构件"（帝国战列舰的方尾板整块算进去 ⇒
  //     光斑糊住整个尾部）。用户要的是"喷口里的**微白光**"，故只取开口中心一块。
  const hxCap = (spanX * 0.25) / modelLen;
  const hyCap = (spanY * 0.35) / modelLen;
  const MAX_AR = 1.8;
  const PORT_SHRINK = 0.55;
  //  ④ **绝对上限**：光斑本身不超过舰宽/舰高的 18% —— 有些舰（帝国战列舰）开口占舰宽 24%，
  //     单靠比例收缩仍会糊住半个尾部。这道上限保证"任何舰的尾焰都只是尾部一小块微光"。
  const hxAbsCap = (spanX * 0.09) / modelLen;
  const hyAbsCap = (spanY * 0.09) / modelLen;
  return raw.map((p) => {
    let hx = Math.min(p.hx, hxCap);
    let hy = Math.min(p.hy, hyCap);
    if (hx > hy * MAX_AR) hx = hy * MAX_AR;
    else if (hy > hx * MAX_AR) hy = hx * MAX_AR;
    hx = Math.min(hx * PORT_SHRINK, hxAbsCap);
    hy = Math.min(hy * PORT_SHRINK, hyAbsCap);
    // [v25/v26] 自动路径也描真实轮廓（v25 凸包 → v26 栅格化 + 空腔/凹轮廓 + 裂缝跟随），
    //   以该口中心为心、半径略大于实测开口取点 ⇒ 形状来自模型本身，不是外接矩形/圆盘硬套。
    //   ⚠ 最后套一层**尺寸硬上限**（≤ 实测开口的 OUTLINE_SIZE_CAP 倍）：轮廓描的是"结构"，
    //     可能远大于开口 —— 用户实报过一次"横跨全舰的大板"。
    let outline: number[] | undefined;
    try {
      const radiusWorld = Math.max(hx, hy) * modelLen * 1.35;
      outline = capOutlineSize(
        extractPortOutline(geo, modelLen, { x: p.x, y: p.y, z: p.z }, radiusWorld, { mode: outlineMode ?? OUTLINE_MODE }),
        hx, hy,
      ) ?? undefined;
    } catch { outline = undefined; }
    return {
      x: p.x, y: p.y, z: p.z,
      hx, hy,
      round: style ? style === 'round' : p.fill < 0.62,
      fill: p.fill,
      outline,
    };
  });
}

/** **轮廓尺寸硬上限**（防"横跨全舰的大板"的最后一闸）：多边形超了就**等比缩小**（形状不变）。
 *  @param hxN/hyN 该口自己的实测半宽/半高（归一化）—— 上限 = 它们 × OUTLINE_SIZE_CAP */
export function capOutlineSize(o: number[] | null, hxN: number, hyN: number): number[] | null {
  if (!o || o.length < 6) return o;
  let mx = 0, my = 0;
  for (let i = 0; i < o.length; i += 2) { mx = Math.max(mx, Math.abs(o[i])); my = Math.max(my, Math.abs(o[i + 1])); }
  const kx = (Math.max(1e-6, hxN) * OUTLINE_SIZE_CAP) / Math.max(1e-9, mx);
  const ky = (Math.max(1e-6, hyN) * OUTLINE_SIZE_CAP) / Math.max(1e-9, my);
  const k = Math.min(1, kx, ky);
  if (k >= 1) return o;
  const out: number[] = [];
  for (let i = 0; i < o.length; i++) out.push(o[i] * k);
  return out;
}

/** 2D 凸包（Andrew monotone chain，逆时针）—— 保证多边形简单、不自交（ExtrudeGeometry 要求）。 */function convexHull2D(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// ============================================================
// [v26] 轮廓提取工具：**内框线**（空腔）优先 + 裂纹跟随
//   为什么不用凸包：凸包 = 外框线，凹口被填平 ⇒ 光斑"描边一圈"把整块结构圈住
//   （用户实报：跨住整个机翼的大六边形），而模型自己那条内框线描不出来。
// ============================================================
/** 采样格数（窗口 = 2r × 2r；格宽 = 2r/G） */
export const OUTLINE_GRID = 40;
/** 闭运算半径（格）：桥接相邻框线间 ≤2k 格的缝，防空腔"漏"到窗外被判成非包围 */
export const OUTLINE_BRIDGE = 1;
/** 法线可见性阈值：只保留 |n_z|/|n| ≥ 此值的三角形（= "面朝舰尾"的那层表面）。
 *  少这一条，喷口内壁 / 舰体侧面这些陡面也会投影进栅格把凹处填满 ⇒ 空腔识别不出来。 */
export const OUTLINE_NORMAL_Z = 0.35;
/** 找空腔时的窗口倍率档（× 取点半径）：空腔可能比初始窗口大 ⇒ 逐档放大再找。 */
export const OUTLINE_WINDOW_STEPS = [1, 1.6, 2.4];
/** 收集三角形时用的最大窗口倍率（≥ WINDOW_STEPS 的最大值）。 */
export const OUTLINE_WINDOW_MAX = 2.4;
/** 退路轮廓的**内缩比例**（× 网格格数）：把结构分量的轮廓法向内推一点（读作"内框线"）。
 *  ⚠ 别调大：0.12 那一档把细结构的内缩成了细条，用户实报"比上一轮更不如"。 */
export const OUTLINE_INSET_FRAC = 0.05;
/** 轮廓尺寸硬上限（× 该口的**实测开口**半宽/半高）：轮廓描的是"结构"，往往比开口大 ——
 *  用户原话："其实只要缩小就好了" ⇒ 收到 **1.0**：轮廓恰好填满实测开口（形状来自结构，尺寸听开口的）。 */
export const OUTLINE_SIZE_CAP = 1.0;
/** 轮廓模式默认值：
 *  · `'convex'` = **结构外轮廓**（v25 那版；用户原话"其实只要缩小就好了"）—— 默认；
 *  · `'inner'`  = 空腔 / 内框线（v26 那套栅格化 + 裂缝跟随）。 */
/** [v27] 锚点走 `outline` 时，轮廓相对**作者所给半径**的硬上限。
 *  为什么需要：`extractPortOutline` 内部会按 `OUTLINE_WINDOW_STEPS` 逐级放大采样窗（本来是为
 *  "自动探测给的半径只是粗估"准备的）⇒ 实测轮廓会扩到 2.4× 半径，再乘柔晕 1.8× ⇒ 光斑比作者
 *  设的大 4 倍多。作者给了半径，就应该以它为准 ⇒ 轮廓超过 1.15× 半径时整条等比缩回。 */
export const ANCHOR_OUTLINE_CAP = 1.15;

/** 默认轮廓模式（巡览里可逐舰覆盖）。`convex` = 外轮廓（v25 行为，最稳）；`inner` = 内框线。 */
export const OUTLINE_MODE: 'inner' | 'convex' = 'convex';
/** [标定用] 最近一次 `extractPortOutline` 的决策来源：
 *  'hole' 命中被结构包围的空腔（= 真·内框线）| 'concave' 结构连通分量（凹轮廓）| 'convex' 凸包兜底 | 'none' 失败 */
export let OUTLINE_LAST_SRC: 'hole' | 'concave' | 'convex' | 'none' = 'none';

/** 盒式膨胀（可分离两趟；窗外视为空） */
function dilateBox(src: Uint8Array, G: number, k: number): Uint8Array {
  const t = new Uint8Array(G * G), o = new Uint8Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    let v = 0;
    for (let d = -k; d <= k; d++) { const x = i + d; if (x >= 0 && x < G && src[j * G + x]) { v = 1; break; } }
    t[j * G + i] = v;
  }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    let v = 0;
    for (let d = -k; d <= k; d++) { const y = j + d; if (y >= 0 && y < G && t[y * G + i]) { v = 1; break; } }
    o[j * G + i] = v;
  }
  return o;
}
/** 盒式腐蚀（窗外视为空 ⇒ 边界处向内收，轮廓不会跑到采样窗边缘上） */
function erodeBox(src: Uint8Array, G: number, k: number): Uint8Array {
  const t = new Uint8Array(G * G), o = new Uint8Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    let v = 1;
    for (let d = -k; d <= k; d++) { const x = i + d; if (x < 0 || x >= G || !src[j * G + x]) { v = 0; break; } }
    t[j * G + i] = v;
  }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    let v = 1;
    for (let d = -k; d <= k; d++) { const y = j + d; if (y < 0 || y >= G || !t[y * G + i]) { v = 0; break; } }
    o[j * G + i] = v;
  }
  return o;
}
function countOn(m: Uint8Array): number {
  let c = 0; for (let i = 0; i < m.length; i++) c += m[i] ? 1 : 0; return c;
}

/** 连通分量标记：对 **mask===0 的格**（空腔）做 4 邻洪泛，返回「被结构包围且离 seed 近」的那个分量掩码。
 *  判据 `touchBorder=false` 是不变量：**从边界漏出去的空区不是空腔**（否则会把整片舰外也算成喷口）。 */
function pickEnclosedHole(mask: Uint8Array, G: number, seedIdx: number, list?: Record<string, number>[]): Uint8Array | null {
  const lab = new Int32Array(G * G).fill(-1);
  const si = seedIdx % G, sj = (seedIdx / G) | 0;
  let bestId = -1, bestScore = -Infinity;
  let next = 0;
  const stack: number[] = [];
  const NEI = [-1, 1, -G, G];
  const maxDist = Math.max(3, Math.round(G * 0.10));       // 空腔必须"就在标注点这一处"
  // ⚠ 空腔判据不能放松：v26 中途把"不许碰窗口边界"改成包围度 ≥0.45，结果"两舷引擎**之间**的空隙"
  //   也被当成空腔 ⇒ 描出一块横跨全舰的大板（用户实报"比上一轮更不如"）。
  //   现在要求几乎被结构包满（≥0.75）且尺寸受限。
  const capArea = G * G * 0.35;
  for (let s = 0; s < G * G; s++) {
    if (mask[s] || lab[s] >= 0) continue;
    const id = next++;
    let cnt = 0, dist = Infinity, oN = 0, bN = 0;
    let iLo = G, iHi = -1, jLo = G, jHi = -1;
    stack.length = 0; stack.push(s); lab[s] = id;
    while (stack.length) {
      const c = stack.pop() as number; cnt++;
      const ci = c % G, cj = (c / G) | 0;
      if (ci < iLo) iLo = ci; if (ci > iHi) iHi = ci;
      if (cj < jLo) jLo = cj; if (cj > jHi) jHi = cj;
      const d = Math.max(Math.abs(ci - si), Math.abs(cj - sj));
      if (d < dist) dist = d;
      for (const o of NEI) {
        const n = c + o;
        if (o === -1 && ci === 0) { bN++; continue; }
        if (o === 1 && ci === G - 1) { bN++; continue; }
        if (n < 0 || n >= G * G) { bN++; continue; }
        if (mask[n]) { oN++; continue; }                   // 靠结构 ⇒ 被包围的一面
        if (lab[n] >= 0) continue;
        lab[n] = id; stack.push(n);
      }
    }
    const surround = oN / Math.max(1, oN + bN);
    if (list) list.push({ cnt, dist, surround: Math.round(surround * 1000) / 1000 });
    if (cnt < 8 || cnt > capArea) continue;
    if (dist > maxDist) continue;
    if (surround < 0.75) continue;                         // 必须几乎被结构包住
    const spanX = iHi - iLo + 1, spanY = jHi - jLo + 1;
    if (spanX > G * 0.7 && spanY > G * 0.7) continue;      // 铺满窗口 ⇒ 是窗外空场，不是凹口
    const score = cnt - dist * 6;                          // 尺寸与贴近度折中
    if (score > bestScore) { bestScore = score; bestId = id; }
  }
  if (bestId < 0) return null;
  const out = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) if (lab[i] === bestId) out[i] = 1;
  return out;
}

/** 取「标注点所在的连通分量」（占用格）；该格为空则取最近的有占用分量。 */
function pickComponentNear(mask: Uint8Array, G: number, seedIdx: number): Uint8Array | null {
  const lab = new Int32Array(G * G).fill(-1);
  const si = seedIdx % G, sj = (seedIdx / G) | 0;
  let bestId = -1, bestScore = -Infinity;
  let next = 0;
  const stack: number[] = [];
  const NEI = [-1, 1, -G, G];
  for (let s = 0; s < G * G; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = next++;
    let cnt = 0, dist = Infinity;
    stack.length = 0; stack.push(s); lab[s] = id;
    while (stack.length) {
      const c = stack.pop() as number; cnt++;
      const ci = c % G, cj = (c / G) | 0;
      const d = Math.max(Math.abs(ci - si), Math.abs(cj - sj));
      if (d < dist) dist = d;
      for (const o of NEI) {
        const n = c + o;
        if (n < 0 || n >= G * G) continue;
        if (o === -1 && ci === 0) continue;
        if (o === 1 && ci === G - 1) continue;
        if (!mask[n] || lab[n] >= 0) continue;
        lab[n] = id; stack.push(n);
      }
    }
    const score = cnt - dist * 3;                          // 近优先，但**尺寸权重更高**
    if (cnt < 8) continue;                                 // 太碎 ⇒ 不是"这一处"的结构
    if (score > bestScore) { bestScore = score; bestId = id; }
  }
  if (bestId < 0) return null;
  const out = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) if (lab[i] === bestId) out[i] = 1;
  return out;
}

const DIR_E = 0, DIR_N = 1, DIR_W = 2, DIR_S = 3;
const DIR_DX = [1, 0, -1, 0];
const DIR_DY = [0, 1, 0, -1];
/** 行进方向 d 下、"区域在左侧"的那个格坐标（用于判定该裂缝是否为边界） */
function leftCell(px: number, py: number, d: number): [number, number] {
  if (d === DIR_E) return [px, py];
  if (d === DIR_N) return [px - 1, py];
  if (d === DIR_W) return [px - 1, py - 1];
  return [px, py - 1];
}
/** 行进方向 d 下、区域右侧的那个格坐标 —— **必须为空**，否则这条"裂缝"是内部缝、
 *  不是边界（v26 首版只校验了左侧 ⇒ 走出"出去又原路返回"的退化路径，面积≈0）。 */
function rightCell(px: number, py: number, d: number): [number, number] {
  if (d === DIR_E) return [px, py - 1];
  if (d === DIR_N) return [px, py];
  if (d === DIR_W) return [px - 1, py];
  return [px - 1, py - 1];
}

/** **裂缝跟随**（crack following）：沿「区域 / 非区域」的边界走一圈，输出**格点坐标**的闭合阶梯多边形。
 *  区域恒在行进方向**左侧** ⇒ 优先左转、否则直行、再否则右转 ⇒ 可凹（含缺口），且首尾自闭合。 */
function traceCrack(mask: Uint8Array, G: number): { x: number; y: number }[] | null {
  const at = (i: number, j: number): number => (i >= 0 && j >= 0 && i < G && j < G ? mask[j * G + i] : 0);
  let sx = -1, sy = -1;
  for (let j = 0; j < G && sx < 0; j++) for (let i = 0; i < G; i++) if (mask[j * G + i]) { sx = i; sy = j; break; }
  if (sx < 0) return null;
  const path: { x: number; y: number }[] = [];
  let px = sx, py = sy, d = DIR_E;
  const maxStep = 8 * G * G;
  for (let s = 0; s < maxStep; s++) {
    let nd = -1;
    for (const turn of [1, 0, 3]) {                        // 左转 → 直行 → 右转
      const c = (d + turn) % 4;
      const [lx, ly] = leftCell(px, py, c);
      const [rx, ry] = rightCell(px, py, c);
      if (at(lx, ly) && !at(rx, ry)) { nd = c; break; }    // 边界裂缝 = 左占用 且 右为空
    }
    if (nd < 0) return null;
    if (path.length > 0 && px === sx && py === sy && nd === DIR_E) return path;   // 闭合：回到起点且下一步同初态
    path.push({ x: px, y: py });
    px += DIR_DX[nd]; py += DIR_DY[nd]; d = nd;
  }
  return null;
}

/** 阶梯多边形 → 局部坐标（相对标注点）并去掉共线中点与过近点。
 *  ⚠ 去共线**不能**把"单格小台阶"也去掉（那是模型的真实缺口），阈值只到 0.6 格。 */
function simplifyLoop(nodes: { x: number; y: number }[] | null, cellW: number, radius: number): { x: number; y: number }[] | null {
  if (!nodes || nodes.length < 4) return null;
  const raw = nodes.map((n) => ({ x: -radius + n.x * cellW, y: -radius + n.y * cellW }));
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[(i - 1 + raw.length) % raw.length], b = raw[i], c = raw[(i + 1) % raw.length];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) > 1e-9 || dot < 0) corners.push(b);
  }
  const keep: { x: number; y: number }[] = [];
  const minSeg = cellW * 0.6;
  for (const q of corners) {
    const last = keep[keep.length - 1];
    if (last && Math.hypot(q.x - last.x, q.y - last.y) < minSeg) continue;
    keep.push(q);
  }
  if (keep.length > 2 && Math.hypot(keep[0].x - keep[keep.length - 1].x, keep[0].y - keep[keep.length - 1].y) < minSeg) keep.pop();
  return keep.length >= 3 ? keep : null;
}

// ============================================================
// [v28] **从给定点向外扫描撞墙** ⇒ 开口截面轮廓（喷口形状/尺寸不再需要作者给）
//
//   用户原话：「我不想要设置默认的 X 直径……需要的是按照我给出的点，然后向外扩散到撞到模型内框……
//   喷气口的形状不光是圆和方，还有很多异形的。」
//
//   做法：以锚点为中心、以锚点局部 **+Z 为法线切一刀**，在**切平面内** 360° 打射线，
//   取每条射线打到模型表面的**最近交点**半径 r(θ) ⇒ 连成闭合多边形 = 该处开口的真实截面。
//   圆 / 方 / 椭圆 / 异形（星形域）**一律不分派**，形状与尺寸全部来自几何本身。
//
//   为什么不是"再调一套栅格化参数"：v25/v26 那套是"从表面足迹里猜哪块是开口"，
//   每换一种异形就要重调（凸包→空腔→裂缝跟随，连打三版）。而"点在里面就必然看得见内壁"
//   是几何事实 —— 一条射线一次求交，没有需要调的阈值。
// ============================================================
/** 角向射线数（轮廓点密度；96 ⇒ 每 3.75° 一点） */
export const SCAN_RAYS = 96;
/** 命中率下限：低于它 ⇒ 该深度上没有"围住这个点的壁" ⇒ 换深度/退回基础形状 */
export const SCAN_MIN_HIT = 0.35;
/** 扫描面沿锚点 **−Z（朝内）** 的偏移档（× 搜索半径）。**只在锚点那一刀完全撞不到墙时**才启用
 *  （点压在口沿上、或落在口外一点点）—— 逐档往里找*第一档*能围住这个点的切面。 */
export const SCAN_DEPTH_STEPS = [-0.12, -0.25, -0.45, -0.7];
/** [v28b] 从锚点**朝外**逐档推进（× 搜索半径）—— 用户原话："我放在喷气口的内部，
 *  那么最好就是自动的**扩展到这个模型的圆框**"。取"仍被内壁围住"的**最大**截面
 *  （通常就是口沿那一圈）；点放深了不再导致量到的口偏小。第一档 = 锚点那一刀。 */
export const SCAN_GROW_STEPS = [0, 0.12, 0.24, 0.38, 0.5];
/** [v28e] 朝外扩展的**形状闸门**：候补档的 `p90/med` 超过此值（= 截面已经不圆了，出现楔形/尖角）
 *  ⇒ 判定"已经越过喷口、切到外面的大腔"⇒ 停用上一档。
 *  为什么必须要它：旧闸门只看 `rMed` —— 实测同盟战舰某个口外扩一档时 **rMed 只涨 3.7%**（1.732%→1.796%），
 *  但 `p90/med` 从 **1.25 坏到 1.90**、逃逸占比 1.0%→4.2% ⇒ 旧闸门全放行，
 *  于是光斑从"正圆贴口"变成"带楔形伸到舰体上"（用户实报的交叉长条）。 */
export const SCAN_GROW_MAX_P90 = 1.6;
/** [v28e] 朝外扩展的第二道形状闸门：候补档里"逃逸射线"（> `SCAN_CLAMP_MED`×中位）占比超过此值 ⇒ 停。 */
export const SCAN_GROW_MAX_CAP = 0.03;
/** 逐档允许的半径增幅上限：切平面跑出口外时会咬住"尾板外缘/整块结构" ⇒ 一超标就停（用上一档）。 */
export const SCAN_GROW_JUMP = 1.6;
/** 相对"锚点那一刀"的最大扩张倍率（第二道防咬闸）。 */
export const SCAN_GROW_RATIO = 2.5;
/** [v28c] **朝外扩展的前提**：这一刀必须被内壁**完整**围住（命中率 ≥ 此值）。
 *  为什么：命中率 0.76（24% 方向没打到墙）时，推导出的截面是"半开放"的，量出的直径能达到
 *  同一艘舰另一口的 1.92 倍（实测 2.76% vs 5.29% 舰长）—— 用户实报"为什么这么大"。 */
export const SCAN_GROW_MIN_HIT = 0.85;
/** [v28c] **锚点喷口的绝对尺寸上限**（半径 ≤ 舰长 6% ⇒ 直径 ≤ 12%）。
 *  为什么必须有：v24 那四道尺寸保护**只作用于自动探测路径**，锚点路径此前是"作者说了算"、
 *  **完全无上限** —— 作者手滑把空物体缩放 X 留在 1（= 半径 0.85 条舰长）或扫描量到"大空腔"时，
 *  就会得到盖住大半条舰的光斑（用户实报）。34 舰普查实测真实喷口半径 ≤ 5% 舰长。 */
export const ANCHOR_PORT_MAX_N = 0.06;

/** [v28c] 把一条**锚点喷口**整体缩到绝对上限内（形状/长宽比不变）。
 *  @returns 缩放系数（1 = 未触发） */
export function clampAnchorPort(p: EnginePort): number {
  let mx = Math.max(p.hx, p.hy);
  if (p.outline) {
    for (let i = 0; i < p.outline.length; i += 2) {
      mx = Math.max(mx, Math.abs(p.outline[i]), Math.abs(p.outline[i + 1]));
    }
  }
  if (!(mx > ANCHOR_PORT_MAX_N)) return 1;
  const k = ANCHOR_PORT_MAX_N / mx;
  if (p.outline) for (let i = 0; i < p.outline.length; i++) p.outline[i] *= k;
  p.hx *= k; p.hy *= k;
  return k;
}
/** 逐射线半径的**中位数上限倍率**：剔掉"从缝里穿过去打到舰体另一侧"的尖刺 */
export const SCAN_CLAMP_MED = 2.2;
/** [v28e] **掠射命中**闸门：|cos(命中面法线, 射线)| < 此值 ⇒ 不算墙（当缺口处理）。
 *  依据（`_fx_spike.cjs` 用 three 自带 `Raycaster` 独立复核同盟战舰 8 个锚点）：
 *    · 腔内壁正对锚点 ⇒ |cos| **≥ 0.9**（实测 0.91~1.00）；
 *    · 而"擦着面滑出去"的远命中（r > 2×中位）⇒ |cos| 中位只有 **0.35~0.39**。
 *  这类命中把半径撑到中位的 **3.3~4.5 倍**，扇形板上就是用户实报的"交叉长条"——直接不采信。 */
export const SCAN_HIT_COS = 0.5;
/** [v28e] "**本腔的墙**有多大"的估计：±`SPAN` 条射线窗口内的 `PCT` 分位。
 *  为什么用**低分位**而不是中位：逃逸常是**成片**的（实测连续 4~13 条），中位会被它们抬高 ⇒ 松弛失效；
 *  低分位只反映"这一带最近的那些真墙"，成片逃逸抬不动它。 */
export const SCAN_WALL_SPAN = 6;
export const SCAN_WALL_PCT = 0.4;
/** [v28e] 命中半径 > "本腔墙量级 × 此值" ⇒ 判为**别的结构**（相邻喷口外壁 / 舰体别处）⇒ 当缺口。
 *  与 `SCAN_CLAMP_MED`（夹到上限，会留下一条**等长假边**）的区别：这里是**整条丢掉**，
 *  再由两侧按角度插值补回 ⇒ 轮廓回到内壁、且与真墙交界处**没有径向跳变**（那正是长条的来源）。 */
export const SCAN_WALL_CAP = 1.6;
/** [v28e] **孤立尖刺**判据：射线半径 > 邻域(±3 射线，不含自身)中位 × 此值 ⇒ 判定为"从缝里穿出去"。
 *  与 `SCAN_CLAMP_MED`（全局上限，只能夹到 2.2 倍）不同，这条是**局部**判据：
 *  实测 50k 档同盟战舰有射线是邻域中位的 **1.93 倍**，被全局夹取压成一条**等长的假边**
 *  ⇒ 扇形板出现细长三角形（用户实报的"交叉长条"）。 */
export const SCAN_SPIKE_K = 1.45;
/** 轮廓整体内缩比例（贴壁但不与内壁互穿） */
export const SCAN_INSET = 0.02;
/** 锚点半径未给、或给了个不合理值时的兜底半径（× 舰长） */
export const SCAN_R_DEFAULT = 0.03;
/** 锚点半径的**可信用区间**（× 舰长）：超出即认为"作者没调缩放 X"，不予采信 */
export const SCAN_R_SANE: [number, number] = [0.004, 0.12];
/** 搜索半径 = 采信半径 × 此值（射线打到更远的表面一律忽略） */
export const SCAN_SEARCH_MUL = 3;
/** 搜索半径的上下限（× 舰长）：光斑不会小到看不见，也不会大到盖住半个舰 */
export const SCAN_SEARCH_N: [number, number] = [0.06, 0.25];
/** 合理性闸门：中位半径超过此值（× 舰长）说明"这个点根本不在开口里" ⇒ 弃用 */
export const SCAN_MAX_MED_N = 0.18;
/** [v28] 扫描读数（**标定用**：探针/巡览可读，渲染不读） */
export interface PortScanResult {
  /** 归一化扁平点对 [x0,y0,x1,y1,…]，以锚点为原点的切平面内坐标 */
  outline: number[];
  /** 轮廓半宽 / 半高（归一化） */
  hx: number; hy: number;
  /** r(θ) 的中位数（归一化）—— "光斑有多大"的一眼读数 */
  rMed: number;
  /** 有壁方向占比（1 = 一圈全撞到墙） */
  hitRate: number;
  /** 实际采用的切割深度（沿朝外法线，归一化；0 = 就在锚点那一刀） */
  depth: number;
  /** 搜索半径上限（归一化） */
  rmax: number;
  /** 参与求交的三角形 / 生成了平面线段的三角形数（性能与几何合理性读数） */
  tri: number; seg: number;
  /** [v28c 标定用] 朝外扩展的逐档读数（rMed, hitRate 交替；第一对 = 锚点那一刀） */
  grow?: number[];
  /** [v28e] 朝外扩展的逐档**形状**读数（每档一条：`{d,rMed,p90,caps,lone}`，第一条 = 锚点那一刀）。
   *  为什么必须看形状：`grow` 只记 rMed/hitRate ⇒ **形状变尖（射线从缝里穿出去）时完全看不出来**，
   *  于是"外扩找口沿"会一路推进到一个**已经不是喷口**的开放截面（用户实报 50k 档出现交叉长条）。 */
  growShape?: { d: number; rMed: number; p90: number; caps: number; lone: number }[];
  /** [v28e] 采用档的**原始**（未夹取）形状读数 —— 夹取会把尖刺压到上限而掩盖它们 */
  quality?: { p90OverMed: number; maxOverMed: number; capFrac: number; lone: number; fixed?: number; dropped?: number; rawHit?: number };
  /** [v28c 标定用] 命中**绝对尺寸闸门**时的缩放系数（< 1 = 被缩回，见 `ANCHOR_PORT_MAX_N`） */
  clamp?: number;
}

/** [v28] **从给定点向外扫描到撞墙** —— 开口截面轮廓（喷口真形状）。
 *
 *  @param mark    锚点（**归一化**坐标 ÷ modelLen，与 `EnginePort` 同域）
 *  @param q       锚点朝向（局部 **+Z = 朝外**）；缺省 identity ⇒ 切平面 ⟂ 模型 +Z
 *  @param searchR 搜索半径（**模型原始单位**）：更远的命中一律忽略 ⇒ 光斑有硬上界
 *  @returns 轮廓 + 读数；无可信结果（一圈都撞不到壁 / 尺寸不合理）时 null
 *
 *  剖面取哪一刀：**从锚点沿 +Z（朝外）逐档推进，取"仍被内壁围住"的最大截面**
 *  —— 于是"把空物体放在喷口内部"也能自动扩展到口沿那一圈（用户原话），
 *  而"锚点深度决定尺寸"的直觉仍然成立（点放浅了量到的自然小）。
 *  锚点那一刀完全撞不到墙时，才改成沿 −Z 往里找第一档能围住的。
 *
 *  ⚠ 已知边界（写清以免被误判成 bug）：
 *   · 截面是**星形域**（对锚点可见的那圈内壁）—— "包裹超过 180° 的月牙形"其凹进部分
 *     会被弦取代。喷口 = 口内壁一圈，天然满足。
 *   · 与切平面**共面**的三角形不挡光（射线在平面内 ⇒ 物理上就是掠过），这是刻意的：
 *     否则把点压在平尾板上时会描出三角网格的蜘蛛网。
 */
export function scanPortOpening(
  geo: THREE.BufferGeometry, modelLen: number,
  mark: { x: number; y: number; z: number }, q?: [number, number, number, number],
  searchR?: number,
  opts?: { rays?: number; minHit?: number },
): PortScanResult | null {
  const pos = geo.attributes?.position as THREE.BufferAttribute | undefined;
  if (!pos || modelLen <= 0) return null;
  const Rmax = Math.max(1e-6, searchR && searchR > 0 ? searchR : modelLen * SCAN_R_DEFAULT * SCAN_SEARCH_MUL);
  const nR = Math.max(24, Math.min(240, Math.round(opts?.rays ?? SCAN_RAYS)));
  const minHit = opts?.minHit ?? SCAN_MIN_HIT;
  const idx = (geo.index as THREE.BufferAttribute | null) ?? null;
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
  if (triCount < 4) return null;

  // ── 锚点局部坐标系：u/v = 切平面内两轴，nz = 朝外 ──
  const qt = new THREE.Quaternion(q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1);
  const uA = new THREE.Vector3(1, 0, 0).applyQuaternion(qt);
  const vA = new THREE.Vector3(0, 1, 0).applyQuaternion(qt);
  const nA = new THREE.Vector3(0, 0, 1).applyQuaternion(qt);
  const cx = mark.x * modelLen, cy = mark.y * modelLen, cz = mark.z * modelLen;
  const cU = cx * uA.x + cy * uA.y + cz * uA.z;      // 锚点到各轴上的投影（与切割深度无关）
  const cV = cx * vA.x + cy * vA.y + cz * vA.z;
  const cN = cx * nA.x + cy * nA.y + cz * nA.z;

  // ── 逐顶点投影一次：后面每换一个切割深度只差一个常数 ──
  const nv = pos.count;
  const pU = new Float32Array(nv), pV = new Float32Array(nv), pN = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pU[i] = x * uA.x + y * uA.y + z * uA.z - cU;
    pV[i] = x * vA.x + y * vA.y + z * vA.z - cV;
    pN[i] = x * nA.x + y * nA.y + z * nA.z - cN;
  }
  const dxA = new Float32Array(nR), dyA = new Float32Array(nR);
  for (let k = 0; k < nR; k++) {
    const a = -Math.PI + ((k + 0.5) * 2 * Math.PI) / nR;
    dxA[k] = Math.cos(a); dyA[k] = Math.sin(a);
  }
  const eps = Math.max(1e-9, modelLen * 1e-5);
  const inPlane = Rmax * 1.001;

  /** 在"离锚点 dz（沿朝外法线）"的切平面上打一圈射线 ⇒ r(θ)（原始单位；Infinity = 没撞到） */
  const ringAt = (dz: number, stat: { tri: number; seg: number }): Float32Array => {
    const res = new Float32Array(nR).fill(Infinity);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const d0 = pN[i0] - dz, d1 = pN[i1] - dz, d2 = pN[i2] - dz;
      if (Math.min(d0, d1, d2) > eps || Math.max(d0, d1, d2) < -eps) continue;        // 与切平面不相交
      if (Math.abs(d0) < eps && Math.abs(d1) < eps && Math.abs(d2) < eps) continue;   // 共面 ⇒ 挡不住平面内射线
      const u0 = pU[i0], u1 = pU[i1], u2 = pU[i2];
      const v0 = pV[i0], v1 = pV[i1], v2 = pV[i2];
      // 面内粗筛：整块三角形都在搜索盘之外
      if (Math.min(Math.abs(u0), Math.abs(u1), Math.abs(u2)) > inPlane) continue;
      if (Math.min(Math.abs(v0), Math.abs(v1), Math.abs(v2)) > inPlane) continue;
      stat.tri++;
      // 三角形 × 切平面 ⇒ 线段（取最远的一对交点；顶点正好落在平面上时取该顶点）
      const cu: number[] = [], cw: number[] = [];
      const vv = [i0, i1, i2], dd = [d0, d1, d2];
      for (let e = 0; e < 3; e++) {
        const ea = vv[e], eb = vv[(e + 1) % 3];
        const da = dd[e], db = dd[(e + 1) % 3];
        if (da * db < 0) {
          const tt = da / (da - db);
          cu.push(pU[ea] + (pU[eb] - pU[ea]) * tt);
          cw.push(pV[ea] + (pV[eb] - pV[ea]) * tt);
        } else if (Math.abs(da) < eps) { cu.push(pU[ea]); cw.push(pV[ea]); }
      }
      const m2 = cu.length;
      if (m2 < 2) continue;                        // 只擦到一个点 ⇒ 掠过，不挡光
      let Ai = 0, Bi = 1, bl = -1;
      for (let i2 = 0; i2 < m2; i2++) for (let j2 = i2 + 1; j2 < m2; j2++) {
        const dx2 = cu[i2] - cu[j2], dy2 = cw[i2] - cw[j2];
        const l2 = dx2 * dx2 + dy2 * dy2;
        if (l2 > bl) { bl = l2; Ai = i2; Bi = j2; }
      }
      if (bl < 1e-18) continue;
      const Ax = cu[Ai], Ay = cw[Ai];
      const vx = cu[Bi] - Ax, vy = cw[Bi] - Ay;
      const cAv = Ax * vy - Ay * vx;               // cross(A, v)：与射线无关 ⇒ 提出来
      // [v28e] **掠射闸门**：求该三角形法线在**切平面内**的两个分量。
      //   射线是面内的 ⇒ cos(法线, 射线) = (nx·dx + ny·dy) / |n|。
      //   腔内壁正对锚点 ⇒ |cos| ≈ 1；"擦着面滑出去"的远命中 ⇒ |cos| ≈ 0.35（实测），
      //   那类命中会把半径撑到 4 倍以上（= 用户实报的交叉长条）⇒ 直接不采信（当缺口）。
      const p0x = pos.getX(i0), p0y = pos.getY(i0), p0z = pos.getZ(i0);
      const e1x = pos.getX(i1) - p0x, e1y = pos.getY(i1) - p0y, e1z = pos.getZ(i1) - p0z;
      const e2x = pos.getX(i2) - p0x, e2y = pos.getY(i2) - p0y, e2z = pos.getZ(i2) - p0z;
      const rgx = e1y * e2z - e1z * e2y, rgy = e1z * e2x - e1x * e2z, rgz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(rgx, rgy, rgz);
      const nxA = rgx * uA.x + rgy * uA.y + rgz * uA.z;
      const nyA = rgx * vA.x + rgy * vA.y + rgz * vA.z;
      const cosMin = SCAN_HIT_COS * nl;            // nl = 0（退化三角形）⇒ 阈值 0 ⇒ 不拦
      stat.seg++;
      for (let k = 0; k < nR; k++) {
        const dx = dxA[k], dy = dyA[k];
        if (Ax * dx + Ay * dy <= 0 && (Ax + vx) * dx + (Ay + vy) * dy <= 0) continue;  // 整段在射线后方
        const den = dx * vy - dy * vx;
        if (den > -1e-12 && den < 1e-12) continue;                                    // 平行
        const s = cAv / den;                                                          // 交点距离
        if (s <= 1e-9 || s >= res[k] || s > Rmax) continue;
        const tt = (Ax * dy - Ay * dx) / den;                                          // 线段参数
        if (tt < -1e-6 || tt > 1 + 1e-6) continue;
        if (nl > 1e-12 && Math.abs(nxA * dx + nyA * dy) < cosMin) continue;            // 掠射 ⇒ 不算墙
        res[k] = s;
      }
    }
    return res;
  };

  /** 一圈 r(θ) ⇒ 可信轮廓（补缺口 / 夹尖刺 / 归一化）；不达标返回 null */
  const finish = (res: Float32Array, dz: number, stat: { tri: number; seg: number }): PortScanResult | null => {
    const vals: number[] = [];
    for (let k = 0; k < nR; k++) if (res[k] < Infinity) vals.push(res[k]);
    const hitRate = vals.length / nR;
    if (hitRate < minHit) return null;
    vals.sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    if (med <= modelLen * 1e-4) return null;                    // 退化成一团
    // [v28e] **形状读数必须在夹取之前算** —— 夹取会把尖刺一律压到 `med×SCAN_CLAMP_MED`，
    //   于是 `max/med` 恒等于 2.2 看起来"很正常"，而实际上那一片是**齐平的假墙**
    //   （用户实报的"交叉长条"就是这么来的：滑出去打到远处的射线被夹成一条等长的边）。
    const q90 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
    let caps = 0;
    for (let k = 0; k < nR; k++) if (res[k] < Infinity && res[k] > med * SCAN_CLAMP_MED) caps++;
    // 孤立尖刺：比"邻域中位"突出 `SCAN_SPIKE_K` 倍以上的射线。
    //   邻域取 ±3 且**不含自身** ⇒ 2~3 条成簇的逃逸射线也认得出；真实拐角是斜坡、邻居同样变大 ⇒ 不误伤。
    let lone = 0;
    for (let k = 0; k < nR; k++) {
      if (!(res[k] < Infinity)) continue;
      const w: number[] = [];
      for (let d = 1; d <= 3; d++) {
        const vp = res[(k + d) % nR]; if (vp < Infinity) w.push(vp);
        const vm = res[(k - d + nR) % nR]; if (vm < Infinity) w.push(vm);
      }
      if (w.length < 3) continue;
      w.sort((a, b) => a - b);
      if (res[k] > w[w.length >> 1] * SCAN_SPIKE_K) lone++;
    }
    // [v28e] **局部去尖刺**（在算完诊断、做全局夹取**之前**执行）。
    //   为什么不能只靠全局夹取：夹取把尖刺一律压到 `med × SCAN_CLAMP_MED` ⇒ 尖刺**没消失**，
    //   只是变成"一条等长的边"，扇形板上照样是那根细长三角形（用户实报的"交叉长条"）。
    //   这里把突出邻域中位 `SCAN_SPIKE_K` 倍以上的射线**替换成邻域中位** ⇒ 形状回到内壁本身。
    //   · 邻域取 ±3 且**不含自身** ⇒ 2~3 条成簇的逃逸射线也认得出；
    //   · 真实拐角是**斜坡**（邻居同样大）⇒ 不误伤；顺序覆盖即可处理成簇（前一条被改后，后一条的邻域就干净了）。
    let fixed = 0;
    for (let k = 0; k < nR; k++) {
      if (!(res[k] < Infinity)) continue;
      const w: number[] = [];
      for (let d = 1; d <= 3; d++) {
        const vp = res[(k + d) % nR]; if (vp < Infinity) w.push(vp);
        const vm = res[(k - d + nR) % nR]; if (vm < Infinity) w.push(vm);
      }
      if (w.length < 3) continue;
      w.sort((a, b) => a - b);
      const lm = w[w.length >> 1];
      if (res[k] > lm * SCAN_SPIKE_K) { res[k] = lm; fixed++; }
    }
    // [v28e] **本腔墙上限**：超过"这一带的墙量级 × `SCAN_WALL_CAP`"的命中判为**别的结构**
    //   ⇒ 整条丢掉（当缺口），**不是**夹到上限。实测同盟战舰 4 个口：真墙在 1.37~2.43% 舰长，
    //   而逃逸在 3.0~4.4%（相邻喷口外壁），比值 1.6 上下就分得开。
    const wallScale: number[] = [];
    for (let k = 0; k < nR; k++) {
      const w: number[] = [];
      for (let d = -SCAN_WALL_SPAN; d <= SCAN_WALL_SPAN; d++) {
        const v = res[(k + d + nR * 2) % nR];
        if (v < Infinity && v <= med * SCAN_CLAMP_MED) w.push(v);   // 先排掉明显逃逸，免得污染分位
      }
      if (w.length < 3) { wallScale.push(med); continue; }
      w.sort((a, b) => a - b);
      wallScale.push(w[Math.floor(w.length * SCAN_WALL_PCT)]);
    }
    let dropped = 0;
    for (let k = 0; k < nR; k++) {
      if (res[k] < Infinity && res[k] > wallScale[k] * SCAN_WALL_CAP) { res[k] = Infinity; dropped++; }
    }
    // hitRate 用**去假之后**的有壁占比 —— 外扩闸门看的是"内壁是否真的围住了"。
    //   ⚠ 必须在"缺口插值"**之前**统计：插值会把所有缺口填满 ⇒ 之后再数永远是 1.0（踩过）。
    let hit2 = 0;
    for (let k = 0; k < nR; k++) if (res[k] < Infinity) hit2++;
    const hitReal = hit2 / nR;
    // [v28e] **缺口补全 = 两侧按角度插值**（取代"填全局中位"）。
    //   v28c 踩过"左右最近有效射线取**较大**者"⇒ 被撑出 40% 大瓣；
    //   而"填全局中位"会在缺口处造出一段**半径恒定的假圆弧**，与真墙交界处形成**径向跳变**
    //   ⇒ 扇形板上就是那根长条。按角度线性插值既无方向性偏置、又不产生跳变。
    for (let k = 0; k < nR; k++) {
      if (res[k] < Infinity) continue;
      let l = 1; while (l < nR && !(res[(k - l + nR * 2) % nR] < Infinity)) l++;
      let r = 1; while (r < nR && !(res[(k + r) % nR] < Infinity)) r++;
      if (l >= nR || r >= nR) continue;                            // 整圈都没墙 ⇒ 下面兜底
      const lv = res[(k - l + nR * 2) % nR], rv = res[(k + r) % nR];
      res[k] = (lv * r + rv * l) / (l + r);                        // 离谁近就更像谁
    }
    for (let k = 0; k < nR; k++) if (!(res[k] < Infinity)) res[k] = med;   // 真·整圈无墙时兜底
    const cap = Math.min(Rmax, med * SCAN_CLAMP_MED);
    for (let k = 0; k < nR; k++) if (res[k] < Infinity && res[k] > cap) res[k] = cap;
    const quality = {
      p90OverMed: q90 / Math.max(1e-9, med),
      maxOverMed: vals[vals.length - 1] / Math.max(1e-9, med),
      capFrac: caps / nR,
      lone,
      fixed,
      dropped,
      rawHit: hitRate,
    };
    const minSeg = Math.max(med * 0.01, modelLen * 1e-4);
    const keep: { x: number; y: number }[] = [];
    for (let k = 0; k < nR; k++) {
      const a = -Math.PI + ((k + 0.5) * 2 * Math.PI) / nR;
      const rr = res[k] * (1 - SCAN_INSET);
      const b = { x: rr * Math.cos(a), y: rr * Math.sin(a) };
      const last = keep[keep.length - 1];
      if (last && Math.hypot(b.x - last.x, b.y - last.y) < minSeg) continue;
      keep.push(b);
    }
    if (keep.length > 2 && Math.hypot(keep[0].x - keep[keep.length - 1].x, keep[0].y - keep[keep.length - 1].y) < minSeg) keep.pop();
    if (keep.length < 3) return null;
    const outline: number[] = [];
    let mx = 0, my = 0;
    for (const p of keep) {
      const nx = p.x / modelLen, ny = p.y / modelLen;
      outline.push(nx, ny);
      mx = Math.max(mx, Math.abs(nx)); my = Math.max(my, Math.abs(ny));
    }
    return {
      outline, hx: Math.max(1e-6, mx), hy: Math.max(1e-6, my),
      rMed: med / modelLen, hitRate: hitReal, depth: dz / modelLen, rmax: Rmax / modelLen,
      tri: stat.tri, seg: stat.seg, quality,
    };
  };

  // ① 锚点那一刀
  const st0 = { tri: 0, seg: 0 };
  const base = finish(ringAt(0, st0), 0, st0);
  if (base && base.rMed <= SCAN_MAX_MED_N) {
    // ② 朝外逐档推进：取"仍被内壁**完整**围住"的最大截面（= 用户要的"扩展到模型的圆框"）。
    //   ⚠⚠ [v28c 实拍修正] 早前只要"命中率 ≥ 0.35"就允许推进 ⇒ 命中率 0.76 的那一口
    //   （24% 方向根本没打到墙）被推进到一档"半开放"的切面，量出的直径是同一艘舰另一口的
    //   **1.92 倍**（2.76% vs 5.29% 舰长）——用户实报"为什么这么大"。现在：
    //   起点与每一档都要求 **hitRate ≥ SCAN_GROW_MIN_HIT**（内壁完整围住）才认。
    //   余下三道闸门不变：开始收窄 / 单档增幅 > SCAN_GROW_JUMP / 总面积 > 第一刀 SCAN_GROW_RATIO 倍。
    let best = base;
    const trace: number[] = [+base.rMed.toFixed(5), +base.hitRate.toFixed(3)];
    // [v28e] 逐档**形状**读数（第一条 = 锚点那一刀）—— `trace` 只有 rMed/hitRate，
    //   形状变尖（射线从缝里穿出去）时完全看不出，所以外扩必须同时盯形状。
    const sh = (f: PortScanResult, d: number) => ({
      d: +(d / modelLen).toFixed(4), rMed: +(f.rMed * 100).toFixed(3),
      p90: +(f.quality ? f.quality.p90OverMed : 0).toFixed(2),
      caps: +(f.quality ? f.quality.capFrac : 0).toFixed(3),
      lone: f.quality ? f.quality.lone : 0,
    });
    const growShape = [sh(base, 0)];
    if (base.hitRate >= SCAN_GROW_MIN_HIT) {
      for (let i = 1; i < SCAN_GROW_STEPS.length; i++) {
        const dz = SCAN_GROW_STEPS[i] * Rmax;
        const st = { tri: 0, seg: 0 };
        const f = finish(ringAt(dz, st), dz, st);
        if (!f || f.rMed > SCAN_MAX_MED_N) break;
        if (f.hitRate < SCAN_GROW_MIN_HIT) break;
        growShape.push(sh(f, dz));
        // [v28e] **形状闸门**：截面在往外走的过程中变尖/出现逃逸 ⇒ 说明已经越过喷口、
        //   切到外面的大腔了（实测 rMed 只涨 3.7% 而 p90/med 从 1.25 坏到 1.90）⇒ 停用上一档。
        if (f.quality && f.quality.p90OverMed > SCAN_GROW_MAX_P90) break;
        if (f.quality && f.quality.capFrac > SCAN_GROW_MAX_CAP) break;
        trace.push(+f.rMed.toFixed(5), +f.hitRate.toFixed(3));
        if (f.rMed < best.rMed) break;
        if (f.rMed > best.rMed * SCAN_GROW_JUMP) break;
        if (f.rMed > base.rMed * SCAN_GROW_RATIO) break;
        best = f;
      }
    }
    best.grow = trace;
    best.growShape = growShape;
    return best;
  }
  // ③ 锚点那一刀撞不到墙（点在口外/口沿）⇒ 沿 −Z 逐档往里，取第一档能围住的
  for (const step of SCAN_DEPTH_STEPS) {
    const dz = step * Rmax;
    const st = { tri: 0, seg: 0 };
    const f = finish(ringAt(dz, st), dz, st);
    if (f && f.rMed <= SCAN_MAX_MED_N) return f;
  }
  return null;
}

/**
 * [v26] **从模型「内框线」描出开口轮廓** —— 手动标注方案的几何核心。
 *
 * ⚠ v25 求的是**凸包 = 外框线**：凹口被填平、整块结构被圈成一圈（用户实报截图里那种
 *   跨住整个机翼的大六边形）。本版改为「**栅格化 + 空腔识别 + 裂缝跟随**」：
 *   取**被结构包围的那块空区**——它的边界就是模型自己的内框线，可凹、可带缺口。
 *
 * ⚠⚠ 同时修掉一个**单位错位 bug**：`mark` 三个分量历来按**归一化**传入，
 *   而 `pos.getX/Y/Z` 是模型原始单位、`radius` 又是世界单位 ⇒ 旧代码把标注点当成了
 *   "原始单位里靠近原点的位置"，标注坐标其实没起作用（只是碰巧结果看着还行）。
 *   现在统一在函数内换算成原始单位；`radius` 仍按世界单位传入。
 *
 * 步骤：① 邻域取点（**薄 z 带**：只取最近那一层表面 ⇒ 凹进去的板面自然留成空腔）
 *      ② 占用栅格 → 闭运算（桥接 ≤2k 格缝隙，防空腔"漏"出窗外）
 *      ③ 空腔识别（4 邻洪泛 + 不接触窗边界 + 离标注点近 + 取最大）
 *      ④ 裂缝跟随描闭合阶梯多边形 → 去共线 → 归一化
 *      ⑤ 退路：凹轮廓（结构连通分量内缩 1 格）→ 凸包（v25 行为）
 *
 * @param radius 取点半径（**世界单位**；调用方按 modelLen × 归一化半径给出）
 * @returns 扁平点对 [x0,y0,x1,y1,…]（归一化、以标注点为原点）；点不足时 null
 */
export function extractPortOutline(
  geo: THREE.BufferGeometry, modelLen: number,
  mark: { x: number; y: number; z: number }, radius: number,
  opts?: { grid?: number; bridge?: number; bandZ?: number; mode?: 'inner' | 'convex'; dbg?: Record<string, unknown> },
): number[] | null {
  const pos = geo.attributes?.position as THREE.BufferAttribute | undefined;
  if (!pos || modelLen <= 0 || radius <= 0) { OUTLINE_LAST_SRC = 'none'; return null; }
  // [v26] 标注点：归一化 → 原始单位（与 pos 同尺度）
  const mx = mark.x * modelLen, my = mark.y * modelLen;
  const G = Math.max(12, Math.min(96, Math.round(opts?.grid ?? OUTLINE_GRID)));
  const mode = opts?.mode ?? OUTLINE_MODE;
  OUTLINE_LAST_SRC = 'none';

  // ① 邻域取点。半径在"点太少"时逐级放大重试 —— 小口 / 残段几何上原半径里可能只有几个点，
  //    那样会直接 null（= 退回圆盘/方片），比"轮廓稍大"更糟。
  // ① 邻域**三角形**收集（= 表面足迹栅格化的输入）。
  //   ⚠ v26 首版只用**顶点打点** ⇒ 网格格宽往往小于网格顶点间距 ⇒ 占用格互不连通、
  //     描出来的轮廓碎成几小块（实测 BirdofPrey / 帝国战列舰塌成小色块）。
  //     改成把**三角形投影后填充进网格**：占用 = 该处表面的真实足迹，稠密且连通。
  const idx = geo.index as THREE.BufferAttribute | null;
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
  // ② **以标注点 z 为中心的两侧薄层**（[mz−bandZ, mz+bandZ]）。
  //   ⚠ 两次踩坑：
  //     ① v25 是"z ≥ mz − bandZ"（**往后无限延伸**）⇒ 整条舰的正面结构都被投影进来 ⇒
  //        占用格糊成一片、凹处被填平 ⇒ 只能描到**外框线**（用户实报的那个大六边形）。
  //     ② "锚在局部最靠后的那层表面"⇒ 尾部有凸脊/双引擎块的舰只剩几根细条 ⇒ 轮廓塌成边条。
  //   现在：**标注点的深度就是你要发光的那一层** —— 点在外框上，凹进去的面自然成为空腔。
  //   （半径与带厚联试：表面过于倾斜/稀疏时逐级加厚，再不行才放大半径。）
  const mz = mark.z * modelLen;
  const baseBand = Math.max(radius * 0.12, modelLen * 0.004);
  const maxWin = OUTLINE_WINDOW_MAX;                       // 最大窗口倍率（先按最大窗口收集，逐档收窗）
  const BANDS = [1, 2, 4, 8, 16];
  // 两趟：先带**法线可见性过滤**（清出干净的尾面 + 凹口）；不够再**放低**门槛（不是撤掉 ——
  //   撤掉会把舰体侧面这种大面积斜面也投影进来 ⇒ 描出一块横跨全舰的大板，用户实报"更不如"）。
  const PASSES = [OUTLINE_NORMAL_Z, 0.15];
  let bandZ = baseBand, tri: number[] = [], pts: { x: number; y: number }[] = [], nzGate = 0;
  collect: for (const gate of PASSES) {
    const Rmax = radius * maxWin;
    for (const bMul of BANDS) {
      bandZ = baseBand * bMul;
      const zLo = mz - bandZ, zHi = mz + bandZ;
      tri = []; pts = [];
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const z0 = pos.getZ(i0), z1 = pos.getZ(i1), z2 = pos.getZ(i2);
        if (Math.min(z0, z1, z2) > zHi || Math.max(z0, z1, z2) < zLo) continue; // 与薄层不相交
        const ax = pos.getX(i0) - mx, ay = pos.getY(i0) - my;
        const bx = pos.getX(i1) - mx, by = pos.getY(i1) - my;
        const cx2 = pos.getX(i2) - mx, cy2 = pos.getY(i2) - my;
        if (Math.min(ax, bx, cx2) > Rmax || Math.max(ax, bx, cx2) < -Rmax) continue;
        if (Math.min(ay, by, cy2) > Rmax || Math.max(ay, by, cy2) < -Rmax) continue;
        if (gate > 0) {
          // **法线可见性过滤**：只保留"面朝舰尾"（|n_z| 足够大）的三角形。少了这一条，
          //   喷口内壁 / 舰体侧面这些陡面也会投影进栅格把凹处填满 ⇒ 空腔识别不出来，
          //   又退化成外轮廓（StarDestroyer 环形尾面实测：中间圆盘被内壁投影占满）。
          const nx = (by - ay) * (z2 - z0) - (z1 - z0) * (cy2 - ay);
          const ny = (z1 - z0) * (cx2 - ax) - (bx - ax) * (z2 - z0);
          const nz = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (nl < 1e-12 || Math.abs(nz) / nl < gate) continue;
        }
        tri.push(ax, ay, bx, by, cx2, cy2);
        pts.push({ x: ax, y: ay }, { x: bx, y: by }, { x: cx2, y: cy2 });
      }
      if (tri.length >= 72) { nzGate = gate; break collect; }  // ≥12 个三角形就够栅格化
      nzGate = gate;
    }
  }
  if (tri.length < 24) return null;

  const seed = Math.min(G - 1, Math.floor(G / 2));         // 窗中心 = 标注点所在格
  const emit = (loop: { x: number; y: number }[] | null): number[] | null => {
    if (!loop || loop.length < 3) return null;
    const flat: number[] = [];
    for (const q of loop) flat.push(q.x / modelLen, q.y / modelLen);
    return flat;
  };
  const b0 = Math.max(1, Math.round(opts?.bridge ?? OUTLINE_BRIDGE));
  const dbg = opts?.dbg;                                   // [标定] 由探针传入；生产路径不传，零开销
  // [v27] `mode:'convex'` = **v25 那版（结构外轮廓）** —— 用户明确要求保留：
  //   "你之前有过一版用外轮廓做的，其实只要缩小就好了，为什么要重写计算方式呢？"
  //   ⇒ 形状就是"该处结构轮廓"，尺寸交给 capOutlineSize（自动路径）与 outlineScale（标注）控制。
  if (mode === 'convex') {
    const hull = convexHull2D(pts);
    if (hull.length < 3) { OUTLINE_LAST_SRC = 'none'; return null; }
    const minD = radius * 0.18;
    const keep: { x: number; y: number }[] = [];
    for (const q of hull) {
      const last = keep[keep.length - 1];
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < minD) continue;
      keep.push(q);
    }
    const out = emit(keep);
    OUTLINE_LAST_SRC = out ? 'convex' : 'none';
    if (dbg) {
      dbg.mode = 'convex'; dbg.modelLen = modelLen; dbg.R = radius; dbg.cellW = (2 * radius) / G;
      dbg.band = pts; dbg.nTri = tri.length / 6; dbg.mz = mz; dbg.bandZ = bandZ;
      dbg.mark = { x: mark.x, y: mark.y, z: mark.z };
    }
    return out;
  }

  /** 按窗口半径 RR 造占用栅格：三角形足迹填充（退化成线段的三角形靠顶点打点兜底）。 */
  const buildOcc = (RR: number): { occ: Uint8Array; cellW: number } => {
    const cw = (2 * RR) / G;
    const o = new Uint8Array(G * G);
    const put = (px: number, py: number): void => {
      const ci = Math.floor((px + RR) / cw), cj = Math.floor((py + RR) / cw);
      if (ci < 0 || cj < 0 || ci >= G || cj >= G) return;
      o[cj * G + ci] = 1;
    };
    for (let k = 0; k < tri.length; k += 6) {
      const ax = tri[k], ay = tri[k + 1], bx = tri[k + 2], by = tri[k + 3], cx2 = tri[k + 4], cy2 = tri[k + 5];
      put(ax, ay); put(bx, by); put(cx2, cy2);
      const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
      if (Math.abs(den) < 1e-12) continue;                   // 退化成线段 ⇒ 顶点已打点
      const iLo = Math.max(0, Math.floor((Math.min(ax, bx, cx2) + RR) / cw));
      const iHi = Math.min(G - 1, Math.floor((Math.max(ax, bx, cx2) + RR) / cw));
      const jLo = Math.max(0, Math.floor((Math.min(ay, by, cy2) + RR) / cw));
      const jHi = Math.min(G - 1, Math.floor((Math.max(ay, by, cy2) + RR) / cw));
      for (let j = jLo; j <= jHi; j++) {
        const py = -RR + (j + 0.5) * cw;
        for (let i = iLo; i <= iHi; i++) {
          const px = -RR + (i + 0.5) * cw;
          const w0 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / den;
          if (w0 < -1e-9) continue;
          const w1 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / den;
          if (w1 < -1e-9 || w0 + w1 > 1 + 1e-9) continue;
          o[j * G + i] = 1;
        }
      }
    }
    return { occ: o, cellW: cw };
  };

  // ④ **空腔（内框线）优先**，窗口从小逐档放大 —— 空腔可能比小窗口更大（休伯利安尾口实测），
  //   若只在固定窗口里找，它会"贴到窗口边界"而被判成非包围 ⇒ 又退回描外轮廓。
  for (const wm of OUTLINE_WINDOW_STEPS) {
    const RR = radius * wm;
    const { occ, cellW } = buildOcc(RR);
    for (const k of [b0, b0 + 1]) {
      const closed = erodeBox(dilateBox(occ, G, k), G, k);
      const cands: Record<string, number>[] = [];
      const hole = pickEnclosedHole(closed, G, seed, cands);
      if (dbg) dbg.holes = (dbg.holes as unknown[] || []).concat([{ wm, k, cands: cands.slice(0, 8) }]);
      if (!hole) continue;
      const poly = emit(simplifyLoop(traceCrack(hole, G), cellW, RR));
      if (poly) {
        OUTLINE_LAST_SRC = 'hole';
        if (dbg) {
          dbg.modelLen = modelLen; dbg.G = G; dbg.R = RR; dbg.cellW = cellW;
          dbg.mz = mz; dbg.bandZ = bandZ; dbg.occ = occ; dbg.nTri = tri.length / 6;
          dbg.band = pts; dbg.holeMask = hole; dbg.closed = closed; dbg.win = wm; dbg.nzGate = nzGate;
          dbg.mark = { x: mark.x, y: mark.y, z: mark.z };
        }
        return poly;
      }
    }
  }
  // ⑤a 退路：结构连通分量（凹轮廓）+ **自适应内缩** —— 用户要的是"内框线"，贴着结构的外轮廓还差一层：
  //   把分量按格腐蚀（= 轮廓法向内推），从最大内缩起试，直到分量还在（≥24 格）。
  {
    for (const wm of OUTLINE_WINDOW_STEPS) {
      const RR = radius * wm;
      const { occ, cellW } = buildOcc(RR);
      const closed = erodeBox(dilateBox(occ, G, b0), G, b0);
      const comp = pickComponentNear(closed, G, seed);
      if (!comp) continue;
      const maxInset = Math.max(0, Math.round(G * OUTLINE_INSET_FRAC));
      const minCells = Math.max(6, Math.round(countOn(comp) * 0.06));   // 细结构别被内缩吃光
      for (let k = maxInset; k >= 0; k--) {
        const use = k > 0 ? erodeBox(comp, G, k) : comp;
        if (countOn(use) < minCells) continue;
        const poly = emit(simplifyLoop(traceCrack(use, G), cellW, RR));
        if (!poly) continue;
        OUTLINE_LAST_SRC = 'concave';
        if (dbg) {
          dbg.modelLen = modelLen; dbg.G = G; dbg.R = RR; dbg.cellW = cellW;
          dbg.mz = mz; dbg.bandZ = bandZ; dbg.occ = occ; dbg.nTri = tri.length / 6;
          dbg.band = pts; dbg.compMask = use; dbg.closed = closed; dbg.win = wm;
          dbg.nzGate = nzGate; dbg.inset = k;
          dbg.mark = { x: mark.x, y: mark.y, z: mark.z };
        }
        return poly;
      }
    }
  }
  // ⑤b 兜底：凸包（v25 行为）
  const hull = convexHull2D(pts);
  if (hull.length < 3) { OUTLINE_LAST_SRC = 'none'; return null; }
  const minD = radius * 0.18;                              // 合并过近顶点（控制多边形点数）
  const keep: { x: number; y: number }[] = [];
  for (const q of hull) {
    const last = keep[keep.length - 1];
    if (last && Math.hypot(q.x - last.x, q.y - last.y) < minD) continue;
    keep.push(q);
  }
  const out = emit(keep);
  OUTLINE_LAST_SRC = out ? 'convex' : 'none';
  return out;
}

/** 覆盖表键归一：`reg.baseName` 是**带 .glb** 的（`shipModels.ts` 里 `baseName = f`），
 *  而人工填表时习惯写不带扩展名 ⇒ 两种写法都要能命中（并兼容低档 `.lodN`）。
 *  ⚠ 这就是 v25 首次实测"标注写了却没用上"的原因 —— 键格式不一致。 */
function lookupByFile<T>(table: Record<string, T>, baseName?: string): T | undefined {
  if (!baseName) return undefined;
  const bare = baseName.replace(/\.lod\d+$/i, '').replace(/\.glb$/i, '');
  for (const k of [baseName, bare, bare + '.glb']) {
    const v = table[k];
    if (v !== undefined) return v;
  }
  return undefined;
}

/** [v25/v27] 解析某模型最终使用的喷口 —— **优先级从"作者意图"到"程序推断"**：
 *  ① **模型自带锚点**（`reg.fxAnchors`，Blender 空物体 `FX_ENGINE_*`）—— 作者说了算；
 *  ② ENGINE_PORT_MARKS / RUNTIME（巡览里手点的标注）；
 *  ③ ENGINE_PORT_STYLE 覆盖形状/隐藏 → 否则自动探测（detectEnginePorts）。
 *  ⚠ [v27] **多点合并**：用户连点几下想圈出"一整块区域"（实报：点了 3 下却得到 3 个小光斑），
 *  故间距 ≤ 1.5× 半径的标注点归为一组 ⇒ 一组 = 一个喷口 = **一整块轮廓**。 */
export function resolveEnginePortsFor(
  geo: THREE.BufferGeometry, modelLen: number, baseName?: string, anchors?: FxAnchor[],
): EnginePort[] {
  // [v27/v28] 按舰的轮廓档：运行时可调（巡览面板）> 持久表；对**所有**路径都生效
  const opt = lookupByFile(ENGINE_PORT_OPTS_RUNTIME, baseName) || lookupByFile(ENGINE_PORT_OPTS, baseName);
  // ⚠ 'scan' 只对"锚点/标注"两路有意义（自动探测的取点位置本就是统计出来的，扫描无意义）
  //   ⇒ 这里折回 OUTLINE_MODE，供自动探测的轮廓用。
  const omode: 'inner' | 'convex' = opt?.mode === 'inner' ? 'inner' : opt?.mode === 'convex' ? 'convex' : OUTLINE_MODE;
  const oscale = opt?.scale ?? 1;
  const rt = lookupByFile(ENGINE_PORT_MARKS_RUNTIME, baseName);
  const marks = (rt && rt.length) ? rt : lookupByFile(ENGINE_PORT_MARKS, baseName);
  // [v27/v28] ① **模型自带锚点**（Blender 里做的空物体）—— **最高优先级**：作者写的位置/朝向
  //   比任何推断与手点标注都可信。**[v28] 形状与尺寸不再需要作者给**：默认以锚点为原点、
  //   锚点 +Z 为法线切一刀，在切平面内向 360° 撞墙 ⇒ 圆/方/椭圆/异形一律现场量出来
  //   （用户原话："我给你定了位置，然后你负责扫描内框处形状"）。
  //   作者明写 `round`/`rect` 时才以作者为准（此时半径仍是必需的）；巡览面板里选了
  //   `convex`/`inner` 才走 v25/v26 的栅格化轮廓。
  const anchorPorts = portsFromAnchors(anchors);
  if (anchorPorts.length) {
    const pm: PortShapeMode = opt?.mode ?? 'scan';
    for (const p of anchorPorts) {
      p.outlineScale = oscale;
      if (p.fxMode === 'round' || p.fxMode === 'rect') continue;      // 作者钦定形状 ⇒ 一个字都不改
      // 搜索半径：作者半径（已过滤离谱值）× N，再夹在"看得见"与"别盖住半个舰"之间
      const search = Math.min(
        Math.max(p.hx * modelLen * SCAN_SEARCH_MUL, modelLen * SCAN_SEARCH_N[0]),
        modelLen * SCAN_SEARCH_N[1],
      );
      if (pm === 'scan') {
        const s = scanPortOpening(geo, modelLen, { x: p.x, y: p.y, z: p.z }, p.q, search);
        if (s) { p.outline = s.outline; p.round = false; p.hx = s.hx; p.hy = s.hy; p.scan = s; }
        // 扫不到墙（点不在开口里等）⇒ 保持"兜底圆盘"，不会退化成巨大的方片
      } else {
        const raw = extractPortOutline(geo, modelLen, { x: p.x, y: p.y, z: p.z }, p.hx * modelLen, { mode: pm });
        // 作者给的半径是"光斑多大"的**权威值** ⇒ 轮廓不得超过它 1.15 倍（详见 ANCHOR_OUTLINE_CAP）
        const outline = raw ? capOutlineSize(raw, p.hx * ANCHOR_OUTLINE_CAP, p.hy * ANCHOR_OUTLINE_CAP) : null;
        if (outline) { p.outline = outline; p.round = false; }
      }
      // [v28c] **绝对尺寸闸门**：锚点路径此前完全没有上限（v24 那四道只护自动探测路径）⇒
      //   作者手滑 / 扫描咬到大结构时会得到"盖住大半条舰"的光斑。超了整体等比缩回并点名。
      const kc = clampAnchorPort(p);
      if (kc < 1) {
        if (p.scan) p.scan.clamp = kc;
        console.warn(`[battleFx] FX 锚点 (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) 的开口半径超过上限 `
          + `（舰长 ${(ANCHOR_PORT_MAX_N * 100).toFixed(0)}%）⇒ 已按 ${(kc * 100).toFixed(0)}% 等比缩回。`
          + '请检查该空物体是否真在喷口内、缩放 X 是否还留在 1（= 半径等于整条舰长）');
      }
    }
    return anchorPorts;
  }
  if (marks && marks.length) {
    const live = marks.filter((m) => m.mode !== 'none');
    // ── 分组：并查集式贪心（链式相邻也能并到一组）──
    const used = new Array(live.length).fill(false);
    const groups: typeof live[] = [];
    for (let i = 0; i < live.length; i++) {
      if (used[i]) continue;
      const g = [live[i]]; used[i] = true;
      for (let j = i + 1; j < live.length; j++) {
        if (used[j]) continue;
        const rj = live[j].r ?? 0.06;
        // 与组内**任一点**够近即并入（支持用户沿一条线连点成片）
        const near = g.some((q) => {
          const rq = q.r ?? 0.06;
          const d = Math.hypot(live[j].x - q.x, live[j].y - q.y, live[j].z - q.z);
          return d <= 1.5 * Math.max(rq, rj);
        });
        if (near) { g.push(live[j]); used[j] = true; }
      }
      groups.push(g);
    }
    const out: EnginePort[] = [];
    for (const g of groups) {
      const cx = g.reduce((s, m) => s + m.x, 0) / g.length;
      const cy = g.reduce((s, m) => s + m.y, 0) / g.length;
      const cz = g.reduce((s, m) => s + m.z, 0) / g.length;
      const mode = g[0].mode;
      // 合并后半径要**盖住组内所有点**（含各自半径）+ 一点余量，并夹在合理区间
      let rN = 0;
      for (const m of g) {
        const rm = m.r ?? 0.06;
        rN = Math.max(rN, Math.hypot(m.x - cx, m.y - cy, m.z - cz) + rm);
      }
      rN = Math.min(0.4, Math.max(0.02, rN * 1.15));
      const mark = { x: cx, y: cy, z: cz };
      const pscale = (g[0].scale ?? 1) * oscale;
      // [v28] `scan` 档：打一个点就得到该处开口截面（不再需要"半径给多大才对"这个旋钮）。
      //   点不在腔内（扫不到墙）时退回该组的圆盘 —— 不会退化成巨大的方片。
      if (mode === 'scan') {
        const search = Math.min(
          Math.max(rN * modelLen * SCAN_SEARCH_MUL, modelLen * SCAN_SEARCH_N[0]),
          modelLen * SCAN_SEARCH_N[1],
        );
        const s = scanPortOpening(geo, modelLen, mark, undefined, search);
        out.push(s
          ? { x: cx, y: cy, z: cz, hx: s.hx, hy: s.hy, round: false, outline: s.outline, outlineScale: pscale, scan: s }
          : { x: cx, y: cy, z: cz, hx: rN, hy: rN, round: true, outlineScale: pscale });
        continue;
      }
      const wantOutline = mode === undefined || mode === 'outline' || mode === 'convex' || mode === 'inner';
      const gm: 'inner' | 'convex' = mode === 'inner' ? 'inner' : (mode === 'convex' ? 'convex' : omode);
      const outline = wantOutline ? extractPortOutline(geo, modelLen, mark, rN * modelLen, { mode: gm }) : null;
      let hx = rN, hy = rN;
      if (outline) {                                                        // 用轮廓 bbox 作占位尺寸
        let mx = 0, my = 0;
        for (let i = 0; i < outline.length; i += 2) {
          mx = Math.max(mx, Math.abs(outline[i]));
          my = Math.max(my, Math.abs(outline[i + 1]));
        }
        hx = Math.max(1e-6, mx); hy = Math.max(1e-6, my);
      }
      out.push({
        x: cx, y: cy, z: cz, hx, hy,
        round: mode === 'round' ? true : mode === 'rect' ? false : !outline,
        outline: outline ?? undefined,
        outlineScale: (g[0].scale ?? 1) * oscale,
      });
    }
    return out;
  }
  // [v27] ③ 无锚点、无标注时：ENGINE_PORT_STYLE 覆盖形状/隐藏 → 否则自动探测。
  const style = lookupByFile(ENGINE_PORT_STYLE, baseName);
  return detectEnginePorts(geo, modelLen, style, omode).map((p) => ({ ...p, outlineScale: oscale }));
}

/** 喷口解析结果缓存（挂在模型注册表对象上，同型舰共用一次；巡览为独立 reg 实例，各算一次）。
 *  ⚠ 缓存键含 baseName / style / 标注签名 / 轮廓选项 / 锚点数 ⇒ 改了任何一处都不会读到旧结果。 */
export function getEnginePortsFor(
  reg: object, geo: THREE.BufferGeometry, modelLen: number, fileBaseName?: string, anchors?: FxAnchor[],
): EnginePort[] {
  const cache = reg as { __enginePorts?: EnginePort[]; __enginePortsKey?: string };
  const rt = lookupByFile(ENGINE_PORT_MARKS_RUNTIME, fileBaseName);
  const marks = (rt && rt.length) ? rt : lookupByFile(ENGINE_PORT_MARKS, fileBaseName);
  const opt = lookupByFile(ENGINE_PORT_OPTS_RUNTIME, fileBaseName) || lookupByFile(ENGINE_PORT_OPTS, fileBaseName);
  // ⚠ 缓存键必须含**每个标注自身的 mode/scale** —— 只含标注数量的话，改了模式/缩放会读到旧结果
  const sig = marks
    ? marks.map((m) => `${m.x},${m.y},${m.z},${m.r ?? ''},${m.mode ?? ''},${m.scale ?? ''}`).join(';')
    : '';
  const key = `${fileBaseName || ''}|${lookupByFile(ENGINE_PORT_STYLE, fileBaseName) || ''}|${marks ? marks.length : -1}|${sig}`
    + `|${opt?.mode ?? ''},${opt?.scale ?? ''}|${anchors ? anchors.length : 0}`;
  if (cache.__enginePorts && cache.__enginePortsKey === key) return cache.__enginePorts;
  let ports: EnginePort[] = [];
  try { ports = resolveEnginePortsFor(geo, modelLen, fileBaseName, anchors); } catch { ports = []; }
  cache.__enginePorts = ports;
  cache.__enginePortsKey = key;
  return ports;
}

/** [v28d] 按"**中心 + 轮廓**"扇形挤出薄片（替代 `ExtrudeGeometry`）。
 *
 *  为什么必须扇形：`edgeFade` 是**逐顶点**写进顶点色的，而 `ExtrudeGeometry` 的封盖三角化
 *  （earcut）**不产生内部顶点** —— 所有顶点都落在轮廓上 ⇒ 线性插值后整片封盖只能落在
 *  "轮廓=最暗"那一档色上，**光核直接消失**（v28d 首版实测：中心顶点色 0.007、中位色和 0.507，
 *  渲染出来几乎看不见）。扇形有**中心顶点**（u=0）⇒ 径向渐变才成立、核才亮。
 *
 *  ⚠ 轮廓必须**星形**（对中心可见）—— 扫描出的轮廓天然满足（见 `scanPortOpening` 注释）。
 *  @param pts 轮廓点（与 thick 同单位）
 *  @param thick 板厚 */
function buildFanPlate(pts: { x: number; y: number }[], thick: number): THREE.BufferGeometry {
  const n = pts.length;
  const z0 = -thick / 2, z1 = thick / 2;
  const v: number[] = [];
  const put = (x: number, y: number, z: number): void => { v.push(x, y, z); };
  for (const z of [z0, z1]) {                       // 两面：中心扇形
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      put(0, 0, z); put(a.x, a.y, z); put(b.x, b.y, z);
    }
  }
  for (let i = 0; i < n; i++) {                     // 侧壁（全在轮廓上 ⇒ 天然最暗）
    const a = pts[i], b = pts[(i + 1) % n];
    put(a.x, a.y, z0); put(b.x, b.y, z0); put(b.x, b.y, z1);
    put(a.x, a.y, z0); put(b.x, b.y, z1); put(a.x, a.y, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  // ⚠ mergeGeometries 要求**属性集合一致**（同舰的多口可能走不同分支：轮廓 / 圆盘 / 方片）
  //   ⇒ 这里补齐 normal / uv 占位（MeshBasicMaterial 不用它们，但缺一个就会 merge 失败、
  //   只剩第一个口的几何 —— 那种失败是静默的）。
  const cnt = v.length / 3;
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(cnt * 3), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cnt * 2), 2));
  return g;
}

/** [v22 尾焰] 喷口光斑几何 —— 每喷口一个**薄片**（替代原"锥形喷流"，消灭用户实报的"尖尖"）。
 *  · 每个盘 = 沿 z 的短圆柱（厚 ≈ L×0.018），径向对称 ⇒ 任何角度看都是一小团光；
 *  · 顶点色沿 z 由**近端白 (1,1,1)** 到**远端淡黄 (1,0.9,0.62)**；加色混合 ⇒ "喷口透出的微光"；
 *  · N 个盘合并 ⇒ 仍是 **1 个 Mesh**（draw call 与旧实现逐位相同，只是几何从 1 个锥变 N 个盘）。
 *  @param ports 喷口（乘 s 后即世界单位）
 *  @param s 缩放（归一化 → 世界）；程序化造型传 1
 *  @param rMul 半径倍率（glow 柔晕层传 > 1）
 *  @param pScale 归一化坐标 → 显示尺寸的换算系数（模型舰传显示长度；程序化造型省略）
 *  @param edgeFade [v28d] 边缘淡出起点（0~1，相对"椭圆归一化半径"；1 = 不淡出）。
 *    加色混合下顶点色趋黑 = 不可见 ⇒ 硬多边形边收成柔和的光，且**超出开口的部分自动不可见**
 *    （用户实报"外面一圈穿模、不够精致"就是这么修的）。 */
export function buildEnginePortGeo(L: number, ports: EnginePort[], s: number, rMul: number, pScale?: number, edgeFade?: number): THREE.BufferGeometry {
  const thick = Math.max(1e-3, L * 0.018);
  const cNear = new THREE.Color(1, 1, 1);
  const cFar = new THREE.Color(1, 0.9, 0.62);
  const minHalfN = Math.max(1e-3, L * 0.006) / Math.max(1e-6, s);   // 可见性下限（归一化；世界 ≈ 舰长 0.6%）
  // ⚠⚠ [v26b 关键修复] `ports` 里的坐标是**按模型原始长度归一化**的（÷ modelLen），
  //   而舰体网格被缩放到**显示长度**（`s = 显示长度 / modelLen`）⇒ 换算到显示尺寸必须用
  //   **显示长度**（= `L`），而不是 `s`。旧代码用 `s` ⇒ 整体差了 `modelLen` 倍：
  //   · modelLen ≈ 1 的舰看着正常；
  //   · modelLen 很大（几百）的舰，光斑被缩到舰体中心、糊成一坨；
  //   · modelLen 很小的舰（柏林这类），光斑被放大几十倍、**甩到大老远**（用户实报"遥远的远方一个圆形"）。
  //   程序化兜底造型的 ports 本来就是**显示单位**（调用方传 s=1）⇒ 显式传 pScale=1 保持不变。
  const ps = pScale ?? s;
  const parts: THREE.BufferGeometry[] = [];
  const list: EnginePort[] = ports.length
    ? ports
    : [{ x: 0, y: 0, z: (L * 0.5) / Math.max(1e-6, ps), hx: minHalfN, hy: minHalfN, round: true }];   // 极端兜底：舰尾一团光
  for (const p of list) {
    // [v24] 半宽 / 半高：**取该喷口自己的实测轮廓**（乘 rMul 供柔晕层放大），不再用全舰统一半径
    const k = ps * rMul;                                       // 归一化 → 显示单位（含柔晕放大）
    const hx = Math.max(minHalfN * s, p.hx * k);
    const hy = Math.max(minHalfN * s, p.hy * k);
    // [v28d] 边缘柔化用的**形状半宽/半高**（与坐标同单位；下面按 1/ref 归一化算"椭圆半径"）
    let refX = hx, refY = hy;
    let g: THREE.BufferGeometry;
    if (p.outline && p.outline.length >= 6) {
      // [v25 手动标注] 按**模型内框线**描出的多边形挤出 —— 形状来自模型本身，
      //   既不会像外接矩形那样四角伸出舰体（用户实报"长方块穿模"），也不是拿圆盘硬套。
      //   ⚠ 轮廓是"该处真实结构"，可能很细 ⇒ 做**最小尺寸保底**（世界直径 ≥ L×1.2%），
      //     否则远景下等于看不见（用户第一轮就报过"几乎是没的"）。
      let mx = 0, my = 0;
      for (let i = 0; i < p.outline.length; i += 2) {
        mx = Math.max(mx, Math.abs(p.outline[i]));
        my = Math.max(my, Math.abs(p.outline[i + 1]));
      }
      const minWorld = Math.max(1e-4, L * 0.012);
      const curWorld = Math.max(mx, my) * k * 2;
      const kk = curWorld < minWorld ? k * (minWorld / Math.max(1e-6, curWorld)) : k;
      const kk2 = kk * (p.outlineScale ?? 1);                  // [v27] 用户可"只缩小"轮廓
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < p.outline.length; i += 2) pts.push({ x: p.outline[i] * kk2, y: p.outline[i + 1] * kk2 });
      g = buildFanPlate(pts, thick);
      refX = Math.max(1e-9, mx * kk2); refY = Math.max(1e-9, my * kk2);
    } else if (p.round) {
      // 圆管口：走**同一条扇形路径**（48 段椭圆）—— 段数直接决定径向渐变的平滑度，
      //   旧的 `CylinderGeometry(…,16,…)` 在封盖上只有"中心 + 16 个轮廓点"，
      //   渐变呈 16 瓣（用户看到的"八边形饼"是更早的 8 段版）。
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * hx, y: Math.sin(a) * hy });
      }
      g = buildFanPlate(pts, thick);
      refX = hx; refY = hy;                                    // 椭圆归一化半径的分母
    } else {
      // 方 / 矩形开口：矩形薄片，宽高 = 开口实际跨度 ⇒ 方尾舰得到方光斑。
      //   ⚠ 必须**有内部顶点**（3×3 网格）逐顶点淡出才成立（同 buildFanPlate 的理由）。
      g = new THREE.BoxGeometry(hx * 2, hy * 2, thick, 3, 3, 1);
    }
    // 顶点色先上（用**局部** z），再平移 —— 避免把世界 z 混进渐变。
    // [v28d] `edgeFade` = 从"椭圆半径"的哪一档开始向**黑**淡出（加色混合下黑=不可见）：
    //   用户实报"外面一圈穿模、不够精致" ⇒ ①`glow` 层不再放大到 1.8×（必然捅穿内壁），
    //   ②两层都把边缘淡掉 ⇒ 硬多边形边变成柔和的光，且超出开口的部分自动不可见。
    const fadeStart = Math.min(1, Math.max(0, edgeFade ?? 1));
    const gp = g.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      const t = Math.min(1, Math.max(0, gp.getZ(i) / thick + 0.5));
      let f = 1;
      if (fadeStart < 1) {
        const u = Math.hypot(gp.getX(i) / refX, gp.getY(i) / refY);       // 椭圆归一化半径（1 = 形状边缘）
        const w = Math.min(1, Math.max(0, (u - fadeStart) / (1 - fadeStart)));
        f = 1 - w * w * (3 - 2 * w);                                      // smoothstep 反向 ⇒ 平滑收边
      }
      cols[i * 3] = (cNear.r + (cFar.r - cNear.r) * t) * f;
      cols[i * 3 + 1] = (cNear.g + (cFar.g - cNear.g) * t) * f;
      cols[i * 3 + 2] = (cNear.b + (cFar.b - cNear.b) * t) * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    // [v27] 锚点朝向：光斑平面垂直于锚点的局部 +Z ⇒ 先把整片几何按锚点四元数转好，再平移到锚点位置。
    //   顶点色渐变用的是**旋转前**的局部 z（沿喷口轴），故必须在着色之后再转。
    if (p.q) g.applyQuaternion(new THREE.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]));
    g.translate(p.x * ps, p.y * ps, p.z * ps + thick * 0.5);      // 盘面贴喷口、向后略移（整片在舰尾之外）
    parts.push(g);
  }
  // mergeGeometries 要求索引态一致 ⇒ 统一转非索引（光斑顶点极少，开销可忽略）
  const nonIdx = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(nonIdx, false) || nonIdx[0];
  parts.forEach((g) => g.dispose());
  return merged;
}
/** [v22 尾焰] 一次性装配「喷口光斑（白核）+ 暖晕」两层，材质每舰一份。
 *  统一入口 ⇒ 各舰型（GLB / 通用兜底 / 补给 / 帝国战列）行为一致，不必各写一遍材质。
 *  ⚠ 两层都用**同一套喷口**（共用喷口坐标 ⇒ 读作"喷口里透出的光"，不是舰尾那颗独立小球）。
 *  ⚠ 保留 `MeshBasicMaterial.color` 通道：受创逻辑仍走 `flame.material.color.setHex(...)`（白=不改色相、红=受创）。
 *  ⚠⚠ [v28d 实拍修正] 用户原话："里面那个部分是对的，但**外面一圈会穿模**，而且不够精致"。
 *    旧实现把柔晕放大到 **1.8×** —— 而 v28 起白核是**按内壁量到边**的（wall-to-wall），
 *    放大必然捅穿内壁（实测暖晕可见半径 = 开口的 **1.80 倍**，两个金晕多边形横跨在舰体面板上）。
 *    现在：**两层都用同一套开口尺寸**（不再放大），各自从内向外淡出到黑
 *    ⇒ 可见能量**全部落在开口以内**，物理上不可能穿模（加色混合：黑 = 不加任何东西）；
 *    同时硬多边形边被 smoothstep 化开 ⇒ 观感从"一块硬板"变成"一团光"。
 *    （白核 = 亮核 + 柔和收边；暖晕 = 偏暖、更宽更软的余辉，负责"热"的观感。） */
export function buildEngineFx(L: number, ports: EnginePort[], s: number, pScale?: number): { flame: THREE.Mesh; glow: THREE.Mesh } {
  // ⚠⚠ [v28d 二次修正] **两层都必须 `vertexColors: true`**。
  //   上一版给 `glow` 的材质漏了这个开关 ⇒ `edgeFade` 写进几何的顶点色**根本不被读取**，
  //   于是暖晕仍是**满幅硬边琥珀板**：与白核同心 ⇒ 视觉上正是用户说的"外面一圈"，
  //   硬多边形边 ⇒ 就是"不够精致"。开上之后两层共用同一套径向淡出，硬边收成光。
  //   `color` 保留为**色相调制**：白核白、暖晕琥珀（顶点色只负责明暗与淡出）。
  const flame = new THREE.Mesh(buildEnginePortGeo(L, ports, s, 1.0, pScale, 0.55), new THREE.MeshBasicMaterial({
    vertexColors: true, color: 0xffffff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const glow = new THREE.Mesh(buildEnginePortGeo(L, ports, s, 1.0, pScale, 0.0), new THREE.MeshBasicMaterial({
    vertexColors: true, color: 0xffcc66, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  return { flame, glow };
}
