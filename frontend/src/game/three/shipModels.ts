/**
 * shipModels.ts — 舰船 GLB 模型注册表（战斗层 Battle3DOverlay 与模型巡览 ShipGalleryOverlay 共享）
 *
 * 命名规范（详见 assets/ship/模型命名规范.md）：
 *   舰种模型：{empire|alliance}_{舰种}.glb 或通用 {舰种}.glb
 *   专属旗舰：flagship_{key}.glb（中文名在 FLAGSHIP_MODEL_ALIAS 登记）
 * 放入 assets/ship/ 即自动发现；每个 URL 全 App 只加载解析一次（模块级缓存）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// [v27] 模型自带的 FX 锚点（Blender 空物体）—— 命名约定与类型都放在 battleFx 里，单一真源
import { FX_ANCHOR_RE, type FxAnchor } from './battleFx';
import shipLodManifest from '../../assets/ship/shipLodManifest.json';

/** 自动发现 assets/ship/ 下所有 GLB，值为 URL（含离线生成的 <名>.lod1/lod2.glb） */
export const SHIP_MODEL_FILES = import.meta.glob('../../assets/ship/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** ==================== 舰船模型档位（离线 LOD）====================
 *  原始 GLB 每艘约 5 万三角面；assets/ship/ 下另有离线减面产物 <名>.lod1.glb（≈20% 面）
 *  与 <名>.lod2.glb（≈5% 面），含 POSITION+NORMAL，与原始文件结构同构（drop-in）。
 *  档位由设置项驱动（settingsStore.shipModelDetail），在 battle overlay 创建时经
 *  setShipModelDetail() 注入。缺 lod 文件的模型自动静默回落到原始文件。
 *  ⚠️ 注意：轮廓线框（EdgesGeometry）边数下降远慢于三角数，低档主要是省实体着色成本。 */

export type ShipModelDetail = 'high' | 'medium' | 'low';

/** 档位 → 文件名中缀（high 用原始文件，无中缀） */
const DETAIL_FILE_SUFFIX: Record<Exclude<ShipModelDetail, 'high'>, string> = {
  medium: '.lod1',
  low: '.lod2',
};

/** 档位（按**实际加载的文件**归一）→ EdgesGeometry 折角阈值（度）；null = 不生成线框。
 *
 *  ⚠ 低档**必须保留线框**（用户反馈原话：「面数调低后，线框还是需要继续保留，否则感受不到
 *  这种 CRT 扫描线的风格」）。线框在本作里不是"可省的装饰"，而是 CRT 风格的主要来源 ——
 *  关掉它，低面数模型只剩几块平板，风格直接消失。
 *
 *  实测代价（34 模型，见 _lodverify/out_lod2_scan.txt）：低档无线框时几何顶点 = 高档的 4.1%，
 *  保留 24° 线框后 = 6.5%（相对低档自身 +56%），仍远低于中档 20.9%、高档 100% —— **低档依旧最省**。
 *  低模折角大、结构边少，24° 恰好把它的结构线全勾出来（Σedges 71,018 = 原始的 14.1%），
 *  观感最接近高档的扫描线；若改用 48°，低模本就稀少的软折角会被一并滤掉，线框更稀、风格更弱。
 *
 *  线框边数由**折角结构**决定、与三角数不同源，所以"降面数"并不等比降线框：
 *  low 档 body 仅 2,483 tris 而 wire 仍有 2,089 段。中档因此按档位放大阈值到 48°，
 *  以免出现"线框几乎与实体等重"——原始 24° 下中档 line 顶点/body 顶点 = 46.45%。
 *  （易混口径区分：236,314/505,136 = 46.8% 是「中档线框边数/原始线框边数」，分母不同。） */
const WIRE_THRESHOLD_BY_LOD: Record<'orig' | 'lod1' | 'lod2', number | null> = {
  orig: 24,     // 高档：保持原值，观感逐位不变
  lod1: 48,     // 中档：阈值翻倍 → 只留硬边
  lod2: 24,     // 低档：与高档同阈值（线框不可省，见上）
};

let currentShipModelDetail: ShipModelDetail = 'high';

/** 设置当前档位（由 Battle3DOverlay / 巡览在启动时调用；改动对**新建**的舰船生效） */
export function setShipModelDetail(detail: ShipModelDetail): void {
  if (detail === 'high' || detail === 'medium' || detail === 'low') currentShipModelDetail = detail;
}

export function getShipModelDetail(): ShipModelDetail {
  return currentShipModelDetail;
}

/** LOD 清单项：tris = 三角数；longestAxis = 归一化前、合并后几何的最长轴长度。
 *  用于把 LOD 等比缩放到与原始同长（减面会轻微削短最长轴，不校正会让换档时舰体/尾焰挂点跳动）。 */
interface ShipLodAxis { tris: number; longestAxis: number }
interface ShipLodEntry { orig: ShipLodAxis; lod1?: ShipLodAxis; lod2?: ShipLodAxis }

/** 离线减面清单（assets/ship/shipLodManifest.json，键 = 原始文件名） */
export const SHIP_LOD_MANIFEST = shipLodManifest as unknown as Record<string, ShipLodEntry>;

/** 文件名 → LOD 档位键；非 lod 文件返回 'orig' */
function lodKeyOf(fileName: string): 'orig' | 'lod1' | 'lod2' {
  const m = /\.(lod\d+)\.glb$/i.exec(fileName);
  if (!m) return 'orig';
  return m[1].toLowerCase() === 'lod1' ? 'lod1' : 'lod2';
}

/** 在自动发现的文件表里按文件名精确查找 key（endsWith('/'+name) 不会误命中 <name>.lodN.glb） */
function findShipFileKey(fileName: string): string | null {
  return Object.keys(SHIP_MODEL_FILES).find(k => k.endsWith('/' + fileName)) || null;
}

/** 按当前档位把原始文件名换成实际要加载的文件名；对应 lod 文件不存在时回落原始（不报错）。 */
function resolveDetailFileName(baseName: string): string {
  if (currentShipModelDetail === 'high') return baseName;
  const suffix = DETAIL_FILE_SUFFIX[currentShipModelDetail];
  const candidate = baseName.replace(/\.glb$/i, '') + suffix + '.glb';
  return findShipFileKey(candidate) ? candidate : baseName;
}

/** 舰种名归一：中英双轨 → 规范 key（战役英文 / 模拟中文混用） */
export const SHIP_CLASS_ALIAS: Record<string, string> = {
  battleship: 'battleship', '战列': 'battleship',
  fast_battleship: 'fast_battleship', '高速战列': 'fast_battleship',
  cruiser: 'cruiser', '巡洋': 'cruiser',
  destroyer: 'destroyer', '驱逐': 'destroyer',
  carrier: 'carrier', 'CV': 'carrier', '突击': 'carrier',
  electronic: 'electronic', '电子': 'electronic',
  supply: 'supply', '补给': 'supply',
  fighter: 'fighter', '战斗机': 'fighter',
};

/** 旗舰专属模型：旗舰中文名（admiralsData.flagshipName）→ 模型 key（文件名 flagship_{key}.glb） */
export const FLAGSHIP_MODEL_ALIAS: Record<string, string> = {
  '伯伦希尔': 'brunhild',   // 莱因哈特
  '休伯利安': 'hyperion',   // 杨威利
  '巴尔巴洛沙': 'barbarossa',   // 齐格飞
  '帕西法尔': 'Parcivale',   // 缪拉
  '人狼': 'Beiowolf',   // 米达麦亚
  '维札尔': 'Vissarr',   // 艾齐纳哈
  '特里古拉夫': 'Triglav',   // 亚典波罗
  '尤利西斯': 'Ulysses',   // 敏兹
  '冯凯尔': 'Vonkel',   // 舒坦梅茨
  '柏林': 'Berlin',   // 布朗胥百克
  '亚斯古里': 'Ashgrimm',   // 法伦海特
  '盘古': 'Pangu',   // 伍兰夫
  '王虎': 'Koenigstiger',   // 毕典菲尔特




  // '盘古': 'pangu', '王虎': 'wanghu', '火龙': 'huolong', …按需登记
};

/** ==================== 舰船长度（米）====================
 *  统一在 shipModels.ts 管理（不分散到 gameData.ts），避免"改长度要去两个文件"。
 *  用途：3D 战斗层与模型巡览的体型缩放基准 —— 此前所有舰统一 SHIP_LEN=18，
 *  导致战列舰与舰载机一样大，失去体型差异。
 *
 *  填写说明：
 *   - 通用舰：按舰种 key 填（见 SHIP_LENGTH 通用表）
 *   - 提督专属旗舰：按 flagshipName（中文旗舰名）填 FLAGSHIP_LENGTH 表
 *   - 未填写的旗舰 = 自动回退到 DEFAULT_FLAGSHIP_LENGTH
 *  ==================================================== */

/** 通用舰种长度（米）——阵营差异化长度在 FACTION_SHIP_LENGTH 覆盖 */
export const SHIP_LENGTH: Record<string, number> = {
  battleship: 900,        // 标准战列舰
  fast_battleship: 750,   // 高速战列舰（略短，换取机动）
  cruiser: 570,           // 巡洋舰
  destroyer: 260,         // 驱逐舰
  carrier: 1100,           // 空母（与战列舰相当，载机空间）
  fighter: 15,            // 舰载机：缩小（约为战列舰的 1/75）
  supply: 1800,           // 补给运输舰：加长，为战列舰的 2 倍（后勤舰体型最长）
};

/** 阵营差异化舰种长度（米）：覆盖 SHIP_LENGTH 通用表。
 *  同阵营同舰种体型可以不同——如同盟补给运输舰 1800（2 倍战列），帝国补给舰 900（战列舰级）。
 *  未列出的 舰种×阵营 组合回退 SHIP_LENGTH。 */
export const FACTION_SHIP_LENGTH: Record<'empire' | 'alliance', Record<string, number>> = {
  empire: {
    supply: 700,           // 帝国补给舰：标准战列舰级体量
  },
  alliance: {
    // 同盟补给舰走通用表 1800
  },
};

/** 未单独填写的专属旗舰，默认长度（旗舰多为战列舰级） */
export const DEFAULT_FLAGSHIP_LENGTH = 900;

/** 提督专属旗舰长度（米）：key = flagshipName（中文旗舰名）。
 *  52 名提督有专属旗舰；这里全部列出，默认值 900，你按实际模型尺寸逐条替换即可。 */
export const FLAGSHIP_LENGTH: { flagship: string; length: number; owner: string }[] = [
  { flagship: '乌尔丰', length: 900, owner: '帝国·克那普斯坦（准将）' },
  { flagship: '亚斯古里', length: 900, owner: '帝国·法伦海特（中将）' },
  { flagship: '人狼', length: 900, owner: '帝国·米达麦亚（中将）' },
  { flagship: '休伯利安', length: 900, owner: '同盟·杨威利（少将）' },
  { flagship: '优兹黑姆', length: 900, owner: '帝国·坎普（中将）' },
  { flagship: '伯伦希尔', length: 900, owner: '帝国·莱因哈特（元帅）' },
  { flagship: '佛尔瑟帝', length: 900, owner: '帝国·克斯拉（中将）' },
  { flagship: '佩伦', length: 900, owner: '同盟·波罗汀（中将）' },
  { flagship: '佩加蒙', length: 900, owner: '同盟·慕亚（上将）' },
  { flagship: '克利什那', length: 900, owner: '同盟·阿普顿（中将）' },
  { flagship: '冯凯尔', length: 900, owner: '帝国·舒坦梅茨（准将）' },
  { flagship: '利欧·格兰特', length: 900, owner: '同盟·比克古（中将）' },
  { flagship: '史奇尔尼尔', length: 900, owner: '帝国·鲁兹（中将）' },
  { flagship: '奥斯特马克', length: 900, owner: '帝国·立典亥姆（元帅）' },
  { flagship: '姆夫维瑟', length: 900, owner: '同盟·马利诺（上校）' },
  { flagship: '尤利西斯', length: 900, owner: '同盟·敏兹（中尉）' },
  { flagship: '巴尔巴洛沙', length: 900, owner: '帝国·吉尔菲艾斯（中将）' },
  { flagship: '希瓦', length: 900, owner: '同盟·费雪（准将）' },
  { flagship: '帕拉梅德斯', length: 900, owner: '同盟·亚尔·沙列姆（中将）' },
  { flagship: '帕西法尔', length: 900, owner: '帝国·缪拉（少将）' },
  { flagship: '库·赫林', length: 900, owner: '同盟·路菲普（中将）' },
  { flagship: '库克林', length: 900, owner: '帝国·德洛伊杰（少将）' },
  { flagship: '库瓦希尔', length: 900, owner: '帝国·梅克林格（中将）' },
  { flagship: '托利斯坦', length: 900, owner: '帝国·罗严塔尔（中将）' },
  { flagship: '柏林', length: 900, owner: '帝国·布朗胥百克（元帅）' },
  { flagship: '波罗库斯', length: 900, owner: '同盟·派特（中将）' },
  { flagship: '海登海姆', length: 900, owner: '帝国·艾尔拉赫（中将）' },
  { flagship: '火龙', length: 900, owner: '帝国·瓦列（中将）' },
  { flagship: '特里古拉夫', length: 900, owner: '同盟·亚典波罗（上校）' },
  { flagship: '狄奥梅狄司', length: 900, owner: '同盟·卡尔先（少将）' },
  { flagship: '王虎', length: 900, owner: '帝国·毕典菲尔特（中将）' },
  { flagship: '玛尔杜克', length: 900, owner: '同盟·雅拉肯（少将）' },
  { flagship: '瓦连当', length: 900, owner: '帝国·华根赛尔（少将）' },
  { flagship: '盘古', length: 900, owner: '同盟·伍兰夫（中将）' },
  { flagship: '纽伦堡', length: 900, owner: '帝国·拜耶尔蓝（少将）' },
  { flagship: '维尔赫米纳', length: 900, owner: '帝国·谬肯贝尔加（元帅）' },
  { flagship: '维札尔', length: 900, owner: '帝国·艾齐纳哈（中将）' },
  { flagship: '艾亚斯', length: 900, owner: '同盟·库布斯里（中将）' },
  { flagship: '艾亚斯', length: 900, owner: '同盟·罗波斯（元帅）' },
  { flagship: '艾斯特拉', length: 900, owner: '帝国·格利鲁帕尔兹（准将）' },
  { flagship: '茉莉亚', length: 900, owner: '同盟·阮文绍（少将）' },
  { flagship: '菲克利安德', length: 900, owner: '帝国·格留尼曼（少将）' },
  { flagship: '西奥德里克', length: 900, owner: '帝国·特奈杰（准将）' },
  { flagship: '诺德林根/西瓦', length: 900, owner: '帝国·梅尔卡兹（上将）' },
  { flagship: '贝茨曼', length: 900, owner: '帝国·佛格（上将）' },
  { flagship: '贝连那斯', length: 900, owner: '同盟·沙尼亚（准将）' },
  { flagship: '赫尔默德', length: 900, owner: '帝国·卡尔纳普（少将）' },
  { flagship: '阿奇利沃斯', length: 900, owner: '同盟·莫顿（少将）' },
  { flagship: '雷欧达', length: 900, owner: '同盟·培特雷（上将）' },
  { flagship: '雷欧达II', length: 900, owner: '同盟·鲁格拉希（中将）' },
  { flagship: '高尔加·法尔姆尔', length: 900, owner: '帝国·连内肯普（中将）' },
  { flagship: '鲁斯坦', length: 900, owner: '同盟·马里涅汀（准将）' }
];

/** 取通用舰长度（未知舰种回退战列舰 900）。faction 提供时优先查阵营差异化表。 */
export function getShipLength(shipType: string, faction?: 'empire' | 'alliance'): number {
  if (faction) {
    const facLen = FACTION_SHIP_LENGTH[faction]?.[shipType];
    if (facLen !== undefined) return facLen;
  }
  return SHIP_LENGTH[shipType] ?? 900;
}

/** 取专属旗舰长度：查 FLAGSHIP_LENGTH 数组，未登记则用 DEFAULT_FLAGSHIP_LENGTH。
 *  用数组而非对象字面量：存在同名旗舰（如"艾亚斯"同属库布斯里与罗波斯），对象 key 会冲突。 */
export function getFlagshipLength(flagshipName: string): number {
  const hit = FLAGSHIP_LENGTH.find(e => e.flagship === flagshipName);
  return hit ? hit.length : DEFAULT_FLAGSHIP_LENGTH;
}

/** 统一入口：给定舰种与可选旗舰名/阵营，返回用于 3D 缩放的长度（米）。
 *  旗舰名优先（专属长度），否则按 舰种+阵营（差异化）→ 舰种通用表 取值。 */
export function getShipScaleLength(shipType: string, flagshipName?: string, faction?: 'empire' | 'alliance'): number {
  if (flagshipName) {
    return getFlagshipLength(flagshipName);
  }
  return getShipLength(shipType, faction);
}


/** ==================== 朝向修正（唯一的朝向调整入口）====================
 *  加载时**烘焙进几何体** → 巡览（ShipGalleryOverlay）与战场（Battle3DOverlay）
 *  消耗同一份注册表，改一处两处同时生效，不会出现"巡览对了战场错"。
 *
 *  默认：Blender 导出的舰首普遍朝 glTF +Z，而战场约定舰首 -Z → 默认统一 rotateY(180°)。
 *
 *  个别模型朝向不对时，按**文件名**在这张表里覆盖（单位：度，绕 y 轴）：
 *    0    = 不旋转（模型本来就朝 -Z）
 *    90   = 侧向修正（模型朝 +X 或 -X）
 *    180  = 与默认相同
 *    -90 / 270 = 反向侧向
 *
 *  判定方法（巡览内）：每艘舰**舰尾有橙色火焰锥**，火焰应落在舰体最后端；
 *    若火焰跑到舰首 → 需要 0°；若火焰在舰体侧面 → 需要 ±90°。
 *    巡览 HUD 提供"选中舰船 → 试转 0/90/180/270"的预览按钮，找到正确的角度后
 *    把控制台打印的那一行粘到本表即可（重启 dev 生效）。
 *  ============================================================== */
export const SHIP_MODEL_YAW_FIX: Record<string, number> = {
  // 例：'flagship_xxx.glb': 0,      // 该模型导出时已朝 -Z，取消默认翻转
  //     'flagship_yyy.glb': 90,     // 该模型朝 +X，转 90° 使舰首朝 -Z
  'flagship_BirdofPrey.glb': 90,

};

/** 默认朝向修正（度）：未在 SHIP_MODEL_YAW_FIX 中登记的模型使用 */
export const SHIP_MODEL_DEFAULT_YAW = 180;

/** 兼容保留（旧接口）：无需翻转 = YAW_FIX 0。两者同时存在时 SHIP_MODEL_YAW_FIX 优先。 */
export const SHIP_MODEL_NO_FLIP: Record<string, true> = {};

/** 解析某文件的最终朝向修正（度）——加载器与巡览标签共用，保证显示与生效一致 */
export function getShipModelYawFix(fileName: string): number {
  const v = SHIP_MODEL_YAW_FIX[fileName];
  if (v !== undefined) return v;
  return SHIP_MODEL_NO_FLIP[fileName] ? 0 : SHIP_MODEL_DEFAULT_YAW;
}

/** 截面正方化名单（文件名 → true）：个别模型建模为扁盒（如帝国补给舰正面应为正方形），
 *  加载时长轴(Z)不动，横截面 X/Y 中较长的一边缩到较短边（用户定案：取短边）。 */
export const SHIP_MODEL_SQUARE_SECTION: Record<string, true> = {
  'empire_supply.glb': true,
};

/** 模型注册表项：ready 前 geo 为空；就绪后 version++ 供使用方检测并原地换装 */
export interface ShipModelReg {
  status: 'loading' | 'ready' | 'failed';
  geo?: THREE.BufferGeometry;
  wire?: THREE.EdgesGeometry;
  tris?: number;
  /** 实际加载的文件名（低档可能是 <名>.lod1.glb） */
  fileName: string;
  /** 去 .lodN 后的原始文件名：朝向修正 / 截面正方化 / LOD 清单一律用它查表 */
  baseName: string;
  /** [v27] 模型自带的 FX 锚点（Blender 里命名的空物体；位置/朝向/半径都来自作者数据）。
   *  ⚠ 只在**该文件自己**里有空物体时才有值 —— LOD 文件通常是减面复制品，没有空物体，
   *  此时回落到"标注 / 自动探测"。需要 LOD 也精确，就在导出 LOD 时保留这些空物体。 */
  fxAnchors?: FxAnchor[];
  version: number;
}

const shipModelRegistry = new Map<string, ShipModelReg>(); // key = URL

/** [v27] FX 锚点按 **baseName** 共享 —— LOD 文件是减面复制品，通常**不带空物体**，
 *  若只认"当前加载文件里的空物体"，同一个舰在切档后光斑会突然变回自动探测的结果（不一致）。
 *  锚点坐标是"÷ 模型最长边 + 居中"后的归一化量，LOD 也被缩放到同长并同样居中 ⇒ 可直接复用。 */
const fxAnchorCache = new Map<string, FxAnchor[]>();

/** 全部已发现的模型文件名（供巡览/调试）——已过滤离线 LOD 产物，避免巡览出现重复条目 */
export function listShipModelFiles(): string[] {
  return Object.keys(SHIP_MODEL_FILES)
    .map(k => k.split('/').pop() || k)
    .filter(f => !/\.lod\d+\.glb$/i.test(f))
    .sort();
}

/** 按候选文件名顺序解析模型 URL 并确保加载；全部未命中返回 null。
 *  候选顺序即回退顺序：旗舰专属 → 阵营+舰种 → 通用舰种。
 *  档位（high/medium/low）在此处生效：候选名经 resolveDetailFileName 换成 lod 文件，
 *  对应 lod 不存在则静默回落原始文件（不会变成加载失败）。 */
export function acquireShipModelByFiles(candidates: string[]): ShipModelReg | null {
  for (const f of candidates) {
    const baseKey = findShipFileKey(f);
    if (!baseKey) continue;
    // 档位解析：base 名 → 实际文件名（可能回落 base 本身）
    const detailFile = resolveDetailFileName(f);
    const hit = findShipFileKey(detailFile) || baseKey;
    const url = SHIP_MODEL_FILES[hit];
    const fileName = hit.split('/').pop() || f;
    let reg = shipModelRegistry.get(url);
    if (!reg) {
      reg = { status: 'loading', fileName, baseName: f, version: 0 };
      shipModelRegistry.set(url, reg);
      enqueueShipModel(url, reg);
    }
    return reg;
  }
  return null;
}

/** 按阵营+舰种取模型（含通用回退） */
export function acquireShipModel(factionKey: 'empire' | 'alliance', cls: string): ShipModelReg | null {
  return acquireShipModelByFiles([`${factionKey}_${cls}.glb`, `${cls}.glb`]);
}

/** [v27c] **绕过档位解析**、强制按用户给的文件名（通常是原文件）加载一个注册表项。
 *  用途：游戏低档位加载的是 `xxx.lodN.glb` 减面副本 —— 它们通常**不带 FX 锚点空物体**，
 *  而锚点在用户重新导出的**原文件**里 ⇒ 需要一条"去原文件把锚点采回来"的路。
 *  已在册（同 URL）直接返回；否则排队加载。 */
export function acquireShipModelByExactFile(fileName: string): ShipModelReg | null {
  const key = findShipFileKey(fileName);
  if (!key) return null;
  const url = SHIP_MODEL_FILES[key];
  const fn = key.split('/').pop() || fileName;
  // baseName 去 .lodN —— 锚点缓存/朝向修正/截面表一律按 baseName 查
  const baseName = fn.replace(/\.lod\d+\.glb$/i, '.glb');
  let reg = shipModelRegistry.get(url);
  if (!reg) {
    reg = { status: 'loading', fileName: fn, baseName, version: 0 };
    shipModelRegistry.set(url, reg);
    enqueueShipModel(url, reg);
  }
  return reg;
}

/** [v27c] 确保某型舰的 **FX 锚点可用**：当前档位文件里没有锚点时，后台补加载**原文件**去采。
 *  采到后由既有的"同型传播"逻辑（baseName 相同的注册表项 + version++）让已建好的舰就地换装。
 *  幂等：同型只补加载一次（用 `__anchorHarvestTried` 标记），不会反复拉 25MB 的原文件。
 *  @returns true = 已有锚点或已发起补采；false = 找不到该型的原文件（无计可施） */
const anchorHarvestTried = new Set<string>();
export function ensureShipFxAnchors(baseName: string): boolean {
  const base = baseName.replace(/\.lod\d+\.glb$/i, '.glb');
  if (fxAnchorCache.has(base)) return true;
  if (anchorHarvestTried.has(base)) return false;
  anchorHarvestTried.add(base);
  const reg = acquireShipModelByExactFile(base);
  if (!reg) return false;
  console.log(`[shipModels] ${base} 当前档位无 FX 锚点 ⇒ 后台补加载原文件采锚点`);
  return true;
}

// ── 并发限流加载队列 ──
// 单个模型 25~37MB，60+ 个同时加载会瞬间吃掉数 GB 内存并卡死浏览器。
// 限制同时进行的加载+解析数，其余排队。
const MAX_CONCURRENT_MODEL_LOADS = 5;
const loadQueue: Array<{ url: string; reg: ShipModelReg }> = [];
let activeLoads = 0;

function enqueueShipModel(url: string, reg: ShipModelReg): void {
  loadQueue.push({ url, reg });
  pumpLoadQueue();
}

function pumpLoadQueue(): void {
  while (activeLoads < MAX_CONCURRENT_MODEL_LOADS && loadQueue.length > 0) {
    const job = loadQueue.shift()!;
    activeLoads++;
    runShipModelLoad(job.url, job.reg, () => {
      activeLoads--;
      pumpLoadQueue();
    });
  }
}

/** 加载单个舰船模型（每 URL 一次；解析为线条化几何：合并、去贴图属性、归一化、轮廓线框）。
 *  done 回调在所有终态（成功/无网格/合并失败/解析异常/加载失败）都会触发一次，用于释放队列槽位。 */
function runShipModelLoad(url: string, reg: ShipModelReg, done: () => void): void {
  new GLTFLoader().load(
    url,
    (gltf) => {
      try {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        // [v27] 先采集**模型自带的 FX 锚点**（Blender 空物体）。此刻拿到的是"原始场景世界矩阵"，
        //   几何随后会被改写（LOD 缩放 / 长轴转 Z / 截面正方化 / 朝向修正 / 居中），
        //   所以下面把每一步都记进 `ops`，最后对锚点做**同一串变换** —— 保证不重演"错位"老问题。
        const ops: THREE.Matrix4[] = [];
        const rawAnchors: { name: string; m: THREE.Matrix4; ud: Record<string, unknown>; rot: { x: number; y: number; z: number } }[] = [];
        root.traverse((o) => {
          if (!o.name || !FX_ANCHOR_RE.test(o.name)) return;
          rawAnchors.push({
            name: o.name, m: o.matrixWorld.clone(),
            ud: (o.userData || {}) as Record<string, unknown>,
            rot: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
          });
        });
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
        if (parts.length === 0) { console.error(`[shipModels] ${url} 无网格`); reg.status = 'failed'; done(); return; }
        const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
        parts.forEach(p => p.dispose());
        if (!merged) { console.error(`[shipModels] ${url} 合并失败`); reg.status = 'failed'; done(); return; }
        // 坑2：LOD 几何按清单等比缩放到与原始同长——减面会轻微削短最长轴，
        //   不校正会让同型舰在换档时长度/尾焰挂点跳变。只需清单里的一个数，不加载原始模型。
        const lodKey = lodKeyOf(reg.fileName);
        if (lodKey !== 'orig') {
          const entry = SHIP_LOD_MANIFEST[reg.baseName];
          const lodAxis = entry?.[lodKey]?.longestAxis;
          const origAxis = entry?.orig?.longestAxis;
          if (lodAxis && origAxis && lodAxis > 1e-9) {
            const k = origAxis / lodAxis;
            if (Math.abs(k - 1) > 1e-6) { merged.scale(k, k, k); ops.push(new THREE.Matrix4().makeScale(k, k, k)); }
          }
        }
        // 最长轴归一到 Z（长度轴）
        merged.computeBoundingBox();
        const size = new THREE.Vector3();
        merged.boundingBox!.getSize(size);
        if (size.x > size.z && size.x >= size.y) { merged.rotateY(Math.PI / 2); ops.push(new THREE.Matrix4().makeRotationY(Math.PI / 2)); }
        else if (size.y > size.z && size.y > size.x) { merged.rotateX(Math.PI / 2); ops.push(new THREE.Matrix4().makeRotationX(Math.PI / 2)); }
        // v6.2：截面正方化（SHIP_MODEL_SQUARE_SECTION 名单内模型）——
        //   此时 Z 已确定为长度轴，X/Y 即横截面。扁盒模型取截面短边，
        //   把较长一边缩到短边（长度不动，正面变正方形）。
        //   坑1：查表必须用 baseName（低档 fileName 带 .lodN 后缀，直接查会漏 → 比例跑偏）。
        if (SHIP_MODEL_SQUARE_SECTION[reg.baseName]) {
          merged.computeBoundingBox();
          merged.boundingBox!.getSize(size);
          const secMax = Math.max(size.x, size.y);
          const secMin = Math.min(size.x, size.y);
          if (secMin > 0.0001 && secMax / secMin > 1.05) {
            const k = secMin / secMax;
            merged.scale(size.x >= size.y ? k : 1, size.x >= size.y ? 1 : k, 1);
            ops.push(new THREE.Matrix4().makeScale(size.x >= size.y ? k : 1, size.x >= size.y ? 1 : k, 1));
          }
        }
        // 坑1：朝向修正同样查 baseName，否则低档查不到 → 舰首朝向反/侧（如 BirdofPrey 少转 90°）
        const yawDeg = getShipModelYawFix(reg.baseName);
        if (yawDeg) { merged.rotateY(THREE.MathUtils.degToRad(yawDeg)); ops.push(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg))); }
        merged.computeBoundingBox();
        const c = new THREE.Vector3();
        merged.boundingBox!.getCenter(c);
        merged.translate(-c.x, -c.y, -c.z);
        ops.push(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
        // [v27] 把锚点过一遍**同一串变换**，换算到最终模型空间；
        //   半径直接量测"锚点局部 X 轴（长度 1）在最终模型中的长度" ⇒ 任何线性变换下都精确。
        if (rawAnchors.length) {
          const M = new THREE.Matrix4();
          for (const op of ops) M.premultiply(op);              // 应用顺序 = 记录顺序
          const anchors: FxAnchor[] = [];
          for (const a of rawAnchors) {
            const w = M.clone().multiply(a.m);
            const p0 = new THREE.Vector3().setFromMatrixPosition(w);
            const p1 = new THREE.Vector3(1, 0, 0).applyMatrix4(w);
            const scl = new THREE.Vector3(); const q = new THREE.Quaternion();
            w.decompose(new THREE.Vector3(), q, scl);
            let rRaw = p1.distanceTo(p0);                          // 锚点缩放 × 复合缩放
            if (typeof a.ud.radiusRel === 'number') rRaw = 0;      // 用比例，后面直接取 radiusRel
            const m0 = typeof a.ud.radiusRel === 'number'
              ? (a.ud.radiusRel as number)
              : (typeof a.ud.radius === 'number' && Math.abs(scl.x) > 1e-9
                ? (a.ud.radius as number) * (rRaw / Math.abs(scl.x))
                : rRaw);
            const md = typeof a.ud.mode === 'string' ? (a.ud.mode as FxAnchor['mode']) : undefined;
            // [v27b] 作者是否**完全没有旋转**这个空物体（局部欧拉角全 0）：
            //   全 0 ⇒ 程序自动把光斑正对舰尾（建模者不用算角度）；转过任何角度 ⇒ 以作者为准。
            const autoOrient = Math.abs(a.rot.x) + Math.abs(a.rot.y) + Math.abs(a.rot.z) < 1e-9;
            anchors.push({
              name: a.name,
              x: p0.x, y: p0.y, z: p0.z,          // 先按最终模型原始单位存，下面按 modelLen 归一
              q: [q.x, q.y, q.z, q.w],
              rN: m0,
              mode: md,
              autoOrient,
            });
          }
          const sizeF = new THREE.Vector3();
          merged.boundingBox!.getSize(sizeF);
          const mLen = Math.max(sizeF.x, sizeF.y, sizeF.z) || 1;
          for (const a of anchors) { a.x /= mLen; a.y /= mLen; a.z /= mLen; a.rN = Math.max(1e-4, a.rN / mLen); }
          reg.fxAnchors = anchors;
          fxAnchorCache.set(reg.baseName, anchors);
          // 同型舰（其它档位 / 另一处实例）若已在册且还没有锚点 ⇒ 一并补上并 bump version 触发换装
          for (const r of shipModelRegistry.values()) {
            if (r === reg || r.baseName !== reg.baseName || r.fxAnchors) continue;
            r.fxAnchors = anchors;
            if (r.status === 'ready') r.version++;
          }
          console.log(`[shipModels] ${reg.fileName} FX 锚点 ${anchors.length} 个: ` + anchors.map((a) => a.name).join(', '));
        } else {
          // 本文件没有空物体（多为 LOD 复制品）⇒ 复用同型（baseName）之前采到的锚点，保证切档一致。
          // ⚠ 若本型**从未**加载过带空物体的文件，这里仍是空 ⇒ 落回标注/自动探测。
          //   要彻底避免，请在导出 LOD 时**保留这些空物体**。
          const shared = fxAnchorCache.get(reg.baseName);
          if (shared) reg.fxAnchors = shared;
        }
        merged.computeBoundingBox();
        reg.geo = merged;
        // 线框随档位收敛：阈值取自**实际加载文件**推导的 lodKey（不用可变全局 currentShipModelDetail，
        // 否则中途改档会让缓存里已生成的 wire 与新档位对不上）。lod2 → null，不生成。
        const wireThr = WIRE_THRESHOLD_BY_LOD[lodKey];
        reg.wire = wireThr === null ? undefined : new THREE.EdgesGeometry(merged, wireThr);
        reg.tris = Math.round(merged.attributes.position.count / 3);
        reg.status = 'ready';
        reg.version++;
        console.log(`[shipModels] 舰船模型就绪 ${reg.fileName}: ${reg.tris.toLocaleString()} tris`);
      } catch (err) {
        console.error(`[shipModels] ${url} 解析失败:`, err);
        reg.status = 'failed';
      }
      done();
    },
    undefined,
    (err) => {
      console.error(`[shipModels] ${url} 加载失败:`, err);
      reg.status = 'failed';
      done();
    },
  );
}
