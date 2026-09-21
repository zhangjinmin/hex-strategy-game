export interface Faction {
  id: number;
  type: 'player' | 'ai';
  team: number;
  name: string;
  leaderAdmiralId: number;    // 阵营最高领袖（拥有一票否决/强制通过权）

  // 军费切割
  treasury: number;           // 国家总金库（吸收所有税收）
  taxRate: number;            // 宏观税率 (0.0 - 1.0)

  hp: number;
  maxHp: number;
  gold: number;
  goldRate: number;
  color: number;
  cssColor: string;
  active: boolean;
  castlePos: { x: number, y: number };
  unitCount: number;
  trait: string;
  deck: string[];
  buildCounts: { barracks: number, mines: number, towers: number };
  admiralStats?: Record<string, number>;
  rank?: number;
  /** 提督标签（政治 / 军事 / 人格 / 能力）。战术层据此解析作战风格：
   *  阵型偏好 / 进攻系数 / **动摇线**（见 `game/retreatDoctrine.ts` → `resolveAdmiralDoctrine`）。
   *  v29 起接入：此前 `MILITARY_STYLE_PARAMS` 全项目零引用，个性标签对战场行为无影响。 */
  admiralTags?: string[];
}


// 国家职务字典
export type NationalRole =
  // 帝国专属
  | 'emperor'               // 皇帝 (通常不参与日常投票，作为终极存在)
  | 'prime_minister'        // 帝国宰相 (统管全局与财政)
  | 'military_minister'     // 军务尚书 (管辖军费与造船)
  | 'high_command_chief'    // 统帅总部总长 (管辖战略调动与作战权)
  | 'space_fleet_deputy'    // 宇宙舰队副司令 (统辖多个舰队)
  // 同盟专属
  | 'council'               // 最高评议会 (统管全局与财政)
  | 'joint_ops_chief'       // 统合作战本部长 (管辖战略与作战)
  | 'joint_ops_deputy'      // 统合作战本部次长
  // 共通职务
  | 'space_fleet_commander' // 宇宙舰队司令长官 (直接管辖所有前线舰队)
  | 'intel_minister'        // 情报部长 (管辖情报预算与敌情获取)
  | 'defense_commander'     // 防卫司令官 (行星/要塞最高军政长官)
  | 'fleet_commander'       // 分舰队司令 (如：第13舰队司令)
  | 'fleet_staff'           // 分舰队参谋
  | 'none';                 // 无职


// ================= 人物标签体系 =================

// A. 政治立场类（影响军议投票、派系归属、叛变倾向）
export type PoliticalTag =
  | 'aristocrat'        // 大贵族派
  | 'reformer'          // 改革派
  | 'democrat'          // 民主派
  | 'militarist'        // 军国派
  | 'pacifist'          // 和平派
  | 'royalist'          // 保皇派
  | 'ambition_faction'; // 野心派

// B. 军事风格类（影响战场 AI、舰队行为）
export type MilitaryTag =
  | 'frontal_assault'   // 正面突击
  | 'counter_defense'   // 防守反击
  | 'firepower'         // 火力压制
  | 'mobile_raid'       // 机动突袭
  | 'logistics_focus'   // 后勤重视
  | 'intel_focus'       // 情报重视
  | 'cautious'          // 谨慎型
  | 'aggressive';       // 冒险型

// C. 人格特质类（影响忠诚度、互动、事件触发）
export type PersonalityTag =
  | 'high_charisma'     // 高魅力
  | 'high_iq'           // 高智商
  | 'high_eq'           // 高情商
  | 'ruthless'          // 冷酷
  | 'righteous'         // 义理
  | 'opportunist'       // 投机
  | 'idealist'          // 理想主义
  | 'realist';          // 现实主义

// D. 能力倾向类（影响职位适配、行政效率）
export type AbilityTag =
  | 'tactician'         // 战术家
  | 'strategist'        // 战略家
  | 'politician'        // 政客
  | 'administrator'     // 行政官
  | 'diplomat';         // 外交官

/** 人物标签联合类型（4 子类共 28 个标签） */
export type AdmiralTag = PoliticalTag | MilitaryTag | PersonalityTag | AbilityTag;

/** 标签分类 */
export type TagCategory = 'political' | 'military' | 'personality' | 'ability';

/** 标签元数据（用于 UI 展示和算法查询） */
export interface TagMeta {
  id: AdmiralTag;
  label: string;          // 中文显示名
  category: TagCategory;
  description: string;    // 标签说明
}


export interface HexTile {
  q: number; r: number; cost: number; ownerId: number; type: string;
  tileClass: string; tier: string; hp: number; maxHp: number; x: number; y: number;
  lastTowerShotTime: number;
  connected: boolean;
  captureProgress: number;
}

export interface Unit {
  sprite?: any; // 修复TS报错
  factionId: number; hp: number; maxHp: number;
  atk: number; def: number; range: number; classType: string;
  atkInterval: number; speed: number; tier: string; lastAtkTime: number; 
  state: 'moving' | 'fighting' | 'garrison';
  supply: number;
  /** v6.5 导弹弹药（仅驱逐/巡洋有意义）：每轮齐射扣 1，耗尽后只打主炮激光；<=999 视为无限 */
  missileAmmo?: number;
}

export interface Fleet {
  id: number; displayId: number; factionId: number;
  x: number; y: number; target: any | null;
  state: 'assembling' | 'moving' | 'engaging';
  units: Unit[]; formation: 'wedge' | 'line' | 'spindle' | 'circle' | 'square';
  facingAngle: number;
  stance: 'search' | 'siege' | 'defend'; 
  targetFlare: {x: number, y: number} | null;
}

export interface Projectile {
  target: Unit; damage: number;
}

// ===== 阶段二：舰种定义与舰队编制 =====
import type { FormationType } from '../config/formations';
export type { FormationType } from '../config/formations';

export type ShipType = 'battleship' | 'fast_battleship' | 'cruiser' | 'destroyer'
| 'carrier' | 'fighter' | 'supply';
// 注：'supply'（AUX）即运输/后勤舰，不再单列 transport；
//    电子战不作为舰种（当前无电子战机制），日后若做则以机制形式实现而非新增舰种。

// ===== 阶段六：Warp 移动系统 — 枚举定义 =====

/** 舰队战略状态：驱动可见性、订单可用性、时间推进 */
export enum FleetStatus {
  IDLE = 'idle',
  WARPING = 'warping',
  ARRIVING = 'arriving',
  IN_BATTLE = 'in_battle',
  OCCUPYING = 'occupying',
  RETREATING = 'retreating',
}

/** 自动战斗结算结果等级 */
export enum BattleOutcome {
  DECISIVE_WIN = 'decisive_win',
  MARGINAL_WIN = 'marginal_win',
  STALEMATE = 'stalemate',
  ROUT = 'rout',
}

/** 到达目的地时玩家的决策选项 */
export enum ArrivalDecisionType {
  AUTO_OCCUPY = 'auto_occupy',
  CANCEL = 'cancel',
  MANUAL_BATTLE = 'manual_battle',
  AUTO_RESOLVE = 'auto_resolve',
  RETREAT = 'retreat',
}

/** 战斗结束后玩家的后续行动选项 */
export enum PostBattleActionType {
  HOLD_POSITION = 'hold_position',
  CONTINUE_ADVANCE = 'continue_advance',
  RETURN_TO_BASE = 'return_to_base',
  OCCUPY = 'occupy',
  PILLAGE = 'pillage',
  LIBERATE = 'liberate',
}

// ===== 阶段六：Warp 移动系统 — 接口定义 =====

/** 自动战斗计算参数（可通过常量表调整） */
export interface AutoResolveParams {
  typeCoeff: Record<string, number>;
  commandMod: number;
  attackMod: number;
  defenseMod: number;
  moraleFactor: number;
  fortressBonus: number;
}

/** 自动战斗结算结果 */
export interface AutoResolveResult {
  outcome: BattleOutcome;
  attackerLosses: number;
  defenderLosses: number;
  attackerRemaining: number;
  defenderRemaining: number;
  ratio: number;
  summary: string;
}

/** 舰队到达目的地时的环境上下文（用于 UI 决策面板） */
export interface ArrivalContext {
  fleetId: number;
  targetNodeId: number;
  hasEnemyFleet: boolean;
  isPlanetOccupied: boolean;
  enemyFleetId: number | null;
  enemyShipCount: number;
  enemyCommanderName: string | null;
}

/** 战斗结束后的状态上下文（用于 UI 战后选项面板） */
export interface PostBattleContext {
  fleetId: number;
  nodeId: number;
  result: AutoResolveResult | null;
  wasManualBattle: boolean;
  fleetSurvived: boolean;
}

export const SHIP_TYPES: { type: ShipType; name: string; cost: number; atk: number; def: number; speed: number }[] = [
  { type: 'battleship', name: '标准战舰', cost: 500, atk: 80, def: 60, speed: 0.5 },
  { type: 'fast_battleship', name: '高速战舰', cost: 420, atk: 75, def: 50, speed: 0.7 },
  { type: 'cruiser', name: '巡航舰', cost: 200, atk: 40, def: 30, speed: 0.8 },
  { type: 'destroyer', name: '驱逐舰', cost: 80, atk: 20, def: 15, speed: 1.0 },
  { type: 'carrier', name: '标准空母', cost: 600, atk: 30, def: 35, speed: 0.45 },
  { type: 'fighter', name: '舰载机', cost: 30, atk: 60, def: 5, speed: 1.5 },
  // 补给舰(AUX)：即运输/后勤舰，承担补给运力，可被击沉 → 断补给（后勤战核心）
  { type: 'supply', name: '补给运输舰', cost: 150, atk: 5, def: 18, speed: 0.6 },
];

/** P2修复：战术HP独立表（每艘舰的战术层HP基准）——原用 cost×10 当 HP，
 *  造价与生存力语义混用（舰载机 cost 30→HP 300 反而比战舰 cost 500→HP 5000 脆 16 倍是合理的，
 *  但空母 cost 600→HP 6000 高于战舰 5000，与"空母防御薄弱"的设定矛盾） */
export const SHIP_TACTICAL_HP: Record<string, number> = {
  battleship: 5000,
  fast_battleship: 4200,
  cruiser: 2200,
  destroyer: 1200,
  carrier: 3000,   // 空母：造价高（载机成本）但生存力低于战舰
  fighter: 300,
  supply: 1800,   // 补给运输舰：皮薄（后勤舰），但比舰载机耐打
};

export interface FleetComposition {
  battleships: number;
  fastBattleships: number;
  cruisers: number;
  destroyers: number;
  carriers: number;
  fighters: number;
  /** 补给运输舰(AUX)：后勤战核心。可编成、可进战斗、可被击沉 → 断补给 */
  supplies?: number;
}

/** 计算编制总舰数（自动汇总所有舰种） */
export function totalShips(comp: FleetComposition): number {
  return comp.battleships + comp.fastBattleships + comp.cruisers + comp.destroyers
    + comp.carriers + comp.fighters + (comp.supplies || 0);
}

/** 计算编制加权战力值（用于自动裁决等场景的快速战力估算） */
export function totalPowerWeight(comp: FleetComposition): number {
  return comp.battleships * 2 + comp.fastBattleships * 1.8 + comp.cruisers * 1
    + comp.destroyers * 0.5 + comp.carriers * 1.2 + comp.fighters * 0.3
    + (comp.supplies || 0) * 0.2; // 补给舰几乎不贡献直接战力，但影响后勤续航
}

/** 空编制常量 */
export const EMPTY_COMPOSITION: FleetComposition = {
  battleships: 0, fastBattleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0, supplies: 0,
};

export interface StrategicFleet {
  id: number;
  factionId: number;
  commanderId: number;
  currentNodeId: number;
  targetNodeId: number | null;
  status: FleetStatus | 'idle' | 'moving' | 'retreating' | 'bombarding';
  moveProgress: number;
  composition: FleetComposition; 

  // === Warp 移动系统字段 ===
  prevNodeId: number | null;      // 撤退时返回的原节点
  warpTargetId: number | null;    // Warp 跃迁目标节点
  warpOriginId: number | null;    // Warp 跃迁起始节点
  etaDay: number | null;          // 预计到达的游戏日（绝对 tick）

  // === 在此处新增以下字段 ===
  tacticalSlots: TacticalSlot[];  // 战术阵型槽位
  morale: number;                 // 士气 (0-100)
  supply: number;                 // 补给 (0-100)
  supplyDistance: number;         // 距最近己方节点的跳数

  // === 新增：舰队归属字段 ===
  /** 归属的上级司令 ID (space_fleet_commander 或 space_fleet_deputy 的 Admiral.id)
   *  null = 无上级，独立舰队（如防卫舰队、临时编组） */
  parentCommanderId: number | null;
  /** 舰队番号 (1 = 第1舰队, 13 = 第13舰队)
   *  0 = 未编号/临时编组 */
  fleetNumber: number;
  /** 阵型（战略层 + 战术层共用） */
  formation: FormationType;
}

// === 舰队归属初始化常量 ===
/** 帝国舰队分割阈值：fleetNumber ≤ 此值归谬肯贝尔加(space_fleet_commander)，
 *  > 此值归莱因哈特(space_fleet_deputy) */
export const EMPIRE_FLEET_SPLIT_THRESHOLD = 9;
/** factionId: 1 = 同盟, 2 = 帝国 */
export const FACTION_ALLIANCE_ID = 1;
export const FACTION_EMPIRE_ID = 2;

export interface TacticalSlot {
  x: number;  // 棋盘坐标 0-6
  y: number;  // 棋盘坐标 0-6
  type: 'battleship' | 'fast_battleship' | 'cruiser' | 'destroyer' | 'carrier' | 'fighter' | 'empty';
}


// 舰船建造队列项
export interface ShipConstruction {
  fleetId: number;
  nodeId: number;
  shipType: ShipType;
  count: number;
  progress: number;  // 0-100
  costPerShip: number;
}

export interface StarNode {
  id: number;
  name: string;
  type: 'capital' | 'fortress' | 'resource' | 'empty';
  ownerFactionId: number;
  connections: number[];
  garrisonFleets: number[];
  x: number;
  y: number;
  defenseHp: number;
  maxDefenseHp: number;
  // ===== 阶段一：经济与城防模型 =====
  population: number;     // 人口 (万)
  security: number;       // 治安度 (0-100)
  economy: number;        // 经济值 (影响基础税收)
  shipyardLevel: number;  // 造船厂等级 (决定修船与补给速度)
  defenseTurrets: number; // 防御炮塔数（战术地图显示）

  // ===== 特殊防御系统：阿尔泰米斯项链 =====
  hasArtemisNecklace?: boolean; // 同盟首都海尼森的12颗卫星防御轨道

  // ===== v3 新增：本地化操作字段 =====
  fortified?: boolean;         // L4 要塞化标记（每节点仅限1次）
  revealedUntil?: string;      // E2 渗透：持续可见到期日（宇宙历），null/过期 = 未渗透
}

// ================= 新增：提案与军议系统 =================

/** 军议提案类型（v3 瘦身后 7 种战略令） */
export type ProposalType =
  | 'invasion'        // 战略侵攻动员
  | 'defense'         // 星域防卫令
  | 'conscription'    // 扩大强制征兵令
  | 'morale_boost'    // 全军士气鼓舞令
  | 'personnel'       // 人事任免令
  | 'budget'          // 申请特别军费
  | 'fortify';        // 要塞强化令（战略级）

/** 行政院操作类型（从军议迁出的 4 种，tax 废弃由 warTaxRate 覆盖） */
export type AdminOperationType =
  | 'logistics'       // 后勤改革（补给消耗-30%/30天，₮2000）
  | 'tech_mobilize'   // 科技动员（研发速度×2/30天，₮3000）
  | 'intel_op'        // 情报行动（情报等级+1/15天，₮1000）
  | 'diplomat_op';    // 外交施压（关系+20，₮500）

/** 友方节点本地操作类型（7 种） */
export type LocalOperationType =
  | 'special_tax'     // L1 征收特别税（+₮500, security-5, 10天冷却）
  | 'security_boost'  // L2 强化治安（security+15, ₮300）
  | 'welfare_invest'  // L3 民生投资（economy+150, ₮800）
  | 'fortify_local'   // L4 要塞化（defenseHp×1.5, ₮4000, 永久）
  | 'set_hq'          // L5 设为防卫司令部（治安×3, 补给×2）
  | 'emergency_draft' // L6 紧急征召（兵源+5%, morale-10, 15天冷却）
  | 'intel_gather';   // L7 情报搜集（揭示相邻敌方, ₮200）

/** 敌方节点操作类型（3 种） */
export type EnemyOpType =
  | 'recon'           // E1 侦察（显示舰队数量, ₮200）
  | 'infiltrate'      // E2 渗透（持续可见15天, ₮800, 需情报≥basic）
  | 'subvert';        // E3 策反（降低守军忠诚, ₮1500, 需情报≥detailed, 30天冷却）
export type ProposalStatus = 'draft' | 'voting' | 'approved' | 'rejected' | 'completed';

export interface Proposal {
  id: number;
  proposerId: number;         // 提案人 (Admiral.id)
  factionId: number;          // 阵营归属 (1: 同盟, 2: 帝国)
  type: ProposalType;
  targetNodeId?: number;      // 军事行动的目标星系
  targetAdmiralId?: number;   // 人事调动的目标提督
  targetFactionId?: number;   // [新增] 外交施压目标阵营
  budgetAmount?: number;      // 申请的军费额度

  supportWeight: number;      // 赞成票总权重 (基于投票人阶级)
  opposeWeight: number;       // 反对票总权重
  status: ProposalStatus;

  createdAt: string;          // 提出时的宇宙历日期
  generatedDate?: string;     // [新增] 系统自动生成的日期
  resolvedDate?: string;      // [新增] 玩家处理日期
  duration?: number;          // [新增] 效果持续天数
  rejectionEffect?: string;   // [新增] 否决后果描述
  risk?: string;              // [新增] 风险描述
  requiredRoles?: NationalRole[]; // [新增] 所需职位权限
  gameCoupling?: string;      // [新增] 游戏耦合点说明
}

// ================= 行政状态接口 =================

/** 行政系统总状态（6 模块） */
export interface AdminState {
  finance: FinanceState;
  personnel: PersonnelState;
  technology: TechnologyState;
  welfare: WelfareState;
  diplomacy: DiplomacyState;
  intelligence: IntelligenceState;
  // ===== v3 新增 =====
  localCooldowns: Record<string, number>;  // key: `${nodeId}_${opType}`, value: 剩余天数
}

/** 财政状态 */
export interface FinanceState {
  treasury: number;              // 国库余额
  baseTaxRate: number;           // 基础税率 (0.1 ~ 0.3)
  warTaxRate: number;            // 战争附加税率 (0 ~ 0.2)
  fleetMaintenanceCost: number;  // 舰队维护费
  monthlyIncome: number;         // 月度收入
  monthlyExpense: number;        // 月度支出
  // v3 新增：费沙贷款
  loanPrincipal: number;         // 贷款本金（剩余）
  loanTotalInterest: number;     // 已付利息累计
  loanTermDays: number;          // 贷款期限（天）
  loanDaysElapsed: number;       // 已过天数
  loanDefaultCount: number;      // 逾期期数
  // v3 新增：月度累计
  pensionPaid: number;           // 本月已付抚恤金
  salaryPaid: number;            // 本月已付工资
  repairPaid: number;            // 本月已付修理费
}

/** 人事状态 */
export interface PersonnelState {
  appointments: AppointmentRecord[];     // 任命记录
  loyaltyModifiers: Record<number, number>; // 提督ID → 忠诚度修正值
  avgLoyalty: number;                    // 全阵营平均忠诚度 (0-100)
}

/** 任命记录 */
export interface AppointmentRecord {
  admiralId: number;
  role: NationalRole;
  appointedDate: string;         // 任命日期（宇宙历）
  efficiency: number;            // 职位适配效率 (0.5 ~ 1.5)
}

/** 科技研发领域 */
export type TechField = 'weapon' | 'armor' | 'engine' | 'electronic';

/** 科技状态 */
export interface TechnologyState {
  weaponLevel: number;           // 武器等级
  armorLevel: number;            // 装甲等级
  engineLevel: number;           // 引擎等级
  electronicLevel: number;       // 电子战等级
  researchProgress: Record<TechField, number>; // 各领域研发进度 (0-100)
  researchSpeed: number;         // 基础研发速度 (点/日)
  researchFocus: TechField;      // 当前研发重点
  techMobilizeBuffDays: number;  // 科技动员剩余天数
}

/** 民生状态 */
export interface WelfareState {
  avgSecurity: number;           // 全阵营平均治安度 (0-100)
  avgDevelopment: number;        // 全阵营平均开发度 (0-100)
  unrestRisk: number;            // 暴动风险 (0-100)
}

/** 外交状态 */
export interface DiplomacyState {
  relations: Record<number, number>; // 阵营ID → 关系值 (-100 ~ +100)
  treaties: Treaty[];            // 当前条约列表
}

/** 条约 */
export interface Treaty {
  targetFactionId: number;       // 目标阵营ID
  type: 'ceasefire' | 'trade' | 'alliance' | 'war';
  expiryDate: string;            // 到期日期（宇宙历）
}

/** 情报等级 */
export type IntelLevel = 'none' | 'basic' | 'detailed' | 'full';

/** 情报状态 */
export interface IntelligenceState {
  intelLevel: Record<number, IntelLevel>; // 阵营ID → 情报等级
  revealedFleets: number[];      // 已揭露的敌方舰队ID列表
  intelOpBuffDays: number;       // 情报行动剩余天数
}
