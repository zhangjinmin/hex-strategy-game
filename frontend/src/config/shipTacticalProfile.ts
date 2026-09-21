/**
 * shipTacticalProfile — 舰种战术侧写（v33 · 单一真源 · 纯数据 + 纯函数）
 *
 * 来源：旧案 44 图《银英 WEB》舰种数据表（`docs/design/loch-web-plan/01_*` §6.3）的三列
 *   「装甲 · 前 / 侧 / 后」与「防空」，以及武器表（§6.4）的射程区间语义。
 *
 * ── 只借结构，不借数值 ────────────────────────────────────────────────────
 * 旧案是 2012 年草稿：舰体 hp 1500 / 装甲 120 / 射程"光秒"，与现项目
 * hp 1200 / def 15 / 射程 px 差 1~2 个数量级。
 * ⇒ 本文件只保留旧案的**偏序关系**（谁更怕侧后、谁是防空核心），
 *   绝对量级由 `balance.DIRECTION_ARMOR` 的 clamp 重标定。
 *
 * ── 三向装甲要解决的问题（现存缺陷）────────────────────────────────────────
 * 现项目伤害方向**只有一档背击**（`BattleScene` 仅 `angleDiff > 0.75π → ×1.5`），
 * 且舰船装甲是单值 `def` ⇒ **舰种编成在战术层没有"形状"**：
 * 高速战舰与盾战舰除了 hp/def 标量差，挨打方式完全一样。
 * 补上三向后，"高速战舰多的部队侧后被爆很痛"第一次成为编成决策。
 *
 * ── 为什么按**受击舰自身舰种**取装甲，而不是按舰队平均值 ──────────────────
 * 原方案（`02_*` §3.2）写的是"舰队级倍率 = 按目标舰队编制加权平均"。
 * 实施时改为**逐舰**：伤害本来就结算在具体 `targetShip` 上，按舰取装甲
 *   · 粒度更细（可从侧后专打高战的薄侧，而非被平均值抹平）；
 *   · 不引入额外的一次加权遍历（伤害热路径每发只查一次表）。
 * 代价是同一舰队内不同舰的受击倍率不同 ⇒ 伤害方差略升，属**期望内**的行为。
 */

import { DIRECTION_ARMOR, INTERCEPT, TACTICAL_V33 } from './balance';
import type { RangeBand } from './formationColumns';

/** 受击方向（以**受击方朝向**为参考系）。 */
export type HitSide = 'front' | 'side' | 'rear';

/** 三向装甲（旧案偏序：前 ≥ 侧 ≥ 后）。`null` = 各向同性（小艇 / 未登记）。 */
export interface ArmorProfile {
  front: number;
  side: number;
  rear: number;
}

/**
 * 舰种 → 三向装甲。键 = `gameData.baseStats` 的舰种名。
 *
 * 映射依据（旧案 → 现项目，只借偏序）：
 *   标准战舰 → 战列（均衡肉盾）        100/50/20
 *   高速战舰 → 高战（**全表最脆侧后**） 125/30/15   前/后 = 8.33，旧案最大
 *   巡航舰   → 巡洋                    50/20/10
 *   驱逐舰   → 驱逐                    30/15/5
 *   标准空母 → 空母                    80/60/30
 *   盾战舰   → （现项目无对应 12 巨舰种，其"三向最均衡"的特征并入战列的上限 clamp）
 *   小艇（舰载/突击）= 各向同性 ⇒ 方向不产生倍率（对小型单位谈"侧后"无意义）
 *   电子/补给 = 旧案无对应舰种，按其战场角色取薄装甲
 */
export const SHIP_ARMOR: Record<string, ArmorProfile | null> = {
  战列: { front: 100, side: 50, rear: 20 },
  高战: { front: 125, side: 30, rear: 15 },
  巡洋: { front: 50, side: 20, rear: 10 },
  驱逐: { front: 30, side: 15, rear: 5 },
  空母: { front: 80, side: 60, rear: 30 },
  电子: { front: 40, side: 25, rear: 12 },
  补给: { front: 20, side: 15, rear: 8 },
  /** 小艇：各向同性（null ⇒ `dirArmorMul` 恒返回 1.0） */
  舰载: null,
  突击: null,
  无: null,
};

/**
 * 舰种 → 拦截（防空）权重。取旧案「防空」列的**偏序**：
 *   巡航舰 150（全表最高）→ 巡洋是防空核心；驱逐 120 / 盾战 120 / 标准 100 / 高速 80 / 空母 50。
 * 小艇与未登记舰种为 0（不贡献拦截）。
 */
export const SHIP_INTERCEPT: Record<string, number> = {
  战列: 100,
  高战: 80,
  巡洋: 150,
  驱逐: 120,
  空母: 50,
  电子: 60,
  补给: 20,
  舰载: 0,
  突击: 0,
  无: 0,
};

/**
 * 舰种 → 偏好距离带（P1-4.5）。用**集合**而非单值：舰队级 band 由编制决定，
 * 单值会让"纯战列舰队永远在 mid"这类正常编制吃惩罚。
 * 依据现项目 `gameData.baseStats.range` 的既有三档语义
 *   （激光 880~840 远程 / 导弹 720 中程 / 舰载机 560~640 近程）。
 */
const SHIP_PREFERRED_BAND: Record<string, RangeBand[]> = {
  战列: ['mid', 'far'],
  高战: ['mid', 'far'],
  巡洋: ['mid'],
  驱逐: ['near', 'mid'],
  空母: ['mid', 'far'],
  舰载: ['near'],
  突击: ['near'],
  电子: ['mid'],
  补给: ['near', 'mid'],
};

/** 该舰种的偏好距离带（未登记返回 null = 中性，不参与判定）。 */
export function getShipPreferredBand(classType: string): RangeBand[] | null {
  return SHIP_PREFERRED_BAND[classType] ?? null;
}

/**
 * 方向 → 装甲倍率。**这是本文件唯一的数值出口**。
 *
 *   倍率 = clamp( (前装甲 / 该方向装甲) ^ EXP , 下限, 上限 )
 *   · `front`  恒 1.0（正面即基准）
 *   · `side`   下限 1.00 / 上限 1.60
 *   · `rear`   下限 1.20 / 上限 2.00
 *
 * `EXP = 0.30`（幂次压缩）：线性用装甲比会得到 8.33×（高速战舰 前/后）这种破坏平衡的值。
 *   ⚠ 不要改回 0.5（开方）——台架实测开方会让 战列(5→2.24) 与 高战(8.33→2.89) **双双撞上
 *     REAR_MAX=2.00**，把"高速战舰最怕后击"这条旧案偏序在背面档抹平。
 *   0.30 下全部落在 clamp 区间内、偏序完整，且战列背面 1.62 贴近旧实现的固定 ×1.5。
 *
 * @param side      受击方向
 * @param classType 受击舰的舰种
 */
export function dirArmorMul(side: HitSide, classType: string): number {
  if (!TACTICAL_V33.DIRECTION_ARMOR) return 1.0;
  if (side === 'front') return 1.0;
  const prof = SHIP_ARMOR[classType];
  if (!prof) return 1.0;                       // 未登记 / 各向同性 → 无方向倍率
  const denom = side === 'side' ? prof.side : prof.rear;
  if (!(denom > 0) || !(prof.front > 0)) return 1.0;
  const raw = Math.pow(prof.front / denom, DIRECTION_ARMOR.EXP);
  const lo = side === 'side' ? DIRECTION_ARMOR.SIDE_MIN : DIRECTION_ARMOR.REAR_MIN;
  const hi = side === 'side' ? DIRECTION_ARMOR.SIDE_MAX : DIRECTION_ARMOR.REAR_MAX;
  return Math.min(hi, Math.max(lo, raw));
}

/** 夹角（弧度，0~π）→ 受击方向。 */
export function hitSideFromAngle(angleDiff: number): HitSide {
  const a = Math.abs(angleDiff);
  if (a <= DIRECTION_ARMOR.FRONT_MAX_RAD) return 'front';
  if (a <= DIRECTION_ARMOR.SIDE_MAX_RAD) return 'side';
  return 'rear';
}

/**
 * 判 `CRIT!` 提示的倍率阈值。
 * 取值 1.2 与既有实现同源（`BattleScene` 的 `isCrit = backstabMulti > 1.2`），
 * 故收口后"什么时候弹 CRIT!"与旧行为保持一致：正面不弹、侧后按装甲比决定。
 */
export const DIRECTION_CRIT_MIN = DIRECTION_ARMOR.CRIT_THRESHOLD;

/**
 * 舰队拦截率（P1-4.2）。**不做弹道实体**——现项目无弹道层（伤害在 finalDmg 一次乘算后
 * 直接扣 hp），为拦截新增实体层的收益/成本比不成立。改为对来袭伤害乘 `1/(1+rate)`。
 *
 * rate = clamp(加权防空均值 / 100 × K, 0, MAX)
 *   · 权重 = 该舰队**存活单位**的 `SHIP_INTERCEPT` 均值 ⇒ 打掉防空舰即削弱拦截
 *   · `skillBonus` 来自特技 `intercept_bonus`（P1-4.4）
 *
 * @param units       受击舰队的单位数组（读 `classType`）
 * @param skillBonus  特技加值（绝对量，0~`INTERCEPT.SKILL_MAX`）
 */
export function fleetInterceptRate(units: readonly { classType?: string }[], skillBonus = 0): number {
  if (!TACTICAL_V33.INTERCEPT) return 0;
  const n = units?.length ?? 0;
  if (n === 0) return 0;
  let sum = 0;
  for (const u of units) sum += SHIP_INTERCEPT[u.classType || '无'] ?? 0;
  const avg = sum / n;
  const base = (avg / 100) * INTERCEPT.K;
  const skill = Math.max(0, Math.min(INTERCEPT.SKILL_MAX, skillBonus));
  return Math.max(0, Math.min(INTERCEPT.MAX, base + skill));
}

/** 拦截率 → 减伤乘区（供 finalDmg 直接乘）。 */
export function interceptDamageMul(rate: number): number {
  if (!(rate > 0)) return 1.0;
  return 1 / (1 + rate);
}
