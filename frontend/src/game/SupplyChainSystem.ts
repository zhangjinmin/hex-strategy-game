/**
 * SupplyChainSystem — 补给链系统（后勤战核心）
 *
 * 解决的问题：
 *   1. 原补给靠"地块连通"，运输舰在战斗中零逻辑 → 后勤战不存在
 *   2. 指挥制无格子 → 地块驱动补给失效
 *   3. 玩家看不到补给状态（不知道部队在不在补给线内）
 *
 * 补给链模型（单位驱动）：
 *   己方基地/星球（源） → [AUX 运输舰] → 前线舰队
 *   - 运输舰在源与舰队之间自动前出，形成可延伸的补给半径
 *   - 运输舰可被击沉 → 该链路断裂
 *
 * 设计要点：
 *   - 运输舰不脱离舰队（单位是 sprite 跟随制），而是"阵型外前出偏移"
 *   - 纯计算模块，不碰 Phaser 渲染；可视化由调用方用返回的数据绘制
 */
/** 补给源作用半径（基地/星球直接覆盖） */
export const SUPPLY_SOURCE_RADIUS = 420;
/** 运输舰补给半径（运输舰前出后覆盖的友军范围） */
export const SUPPLY_AUX_RADIUS = 260;
/** 运输舰自身补货半径（需回到此范围内才能补货） */
export const AUX_RESUPPLY_RADIUS = 300;
/** 运输舰载货量（可补给的总量单位） */
export const AUX_CAPACITY = 100;
/** 运输舰每次补给输出量（每帧） */
export const AUX_SUPPLY_RATE = 1.2;
/** 运输舰前出偏移（距舰队中心的世界单位，视觉上"前出"） */
export const AUX_FORWARD_OFFSET = 46;

export type AuxState = 'idle' | 'forward' | 'supplying' | 'returning';

export interface SupplyNode {
  x: number;
  y: number;
  team: number;
  kind: 'castle' | 'planet';
}

export interface AuxShip {
  unit: any;         // 战斗单位引用
  fleet: any;        // 所属舰队
  cargo: number;     // 剩余载货
  state: AuxState;
  ox: number;        // 前出偏移 x
  oy: number;        // 前出偏移 y
  /** 后勤站（母港 castlePos）坐标：返航的真实目的地（真往返，不再原地归零偏移） */
  homeX?: number;
  homeY?: number;
}

export interface FleetSupplyInfo {
  fleet: any;
  /** 是否在任何补给覆盖内 */
  inSupply: boolean;
  /** 补给来源：'source' 基地/星球 | 'aux' 运输舰 | null 断链 */
  via: 'source' | 'aux' | null;
  /** 到最近补给源的距离（无则 Infinity） */
  distToSource: number;
  /** 补给它的运输舰（via==='aux' 时有值） */
  aux: AuxShip | null;
}

/**
 * 计算所有舰队的补给状态，并驱动运输舰 AI。
 * @param fleets 所有存活舰队
 * @param sources 己方补给源（castle/planet 坐标）
 * @param auxShips 运输舰列表（会被就地更新状态与货量）
 * @param dt 帧时间缩放（用于补给速率）
 */
/** team 解析函数：由调用方传入（舰队本身无 team 字段，需经 factionMap 查） */
export type TeamOf = (fleet: any) => number | undefined;

export function updateSupplyChain(
  fleets: any[],
  sources: SupplyNode[],
  auxShips: AuxShip[],
  dt: number,
  teamOf: TeamOf,
): Map<any, FleetSupplyInfo> {
  const result = new Map<any, FleetSupplyInfo>();

  // 1. 先算每个舰队到最近己方补给源的距离
  fleets.forEach(fl => {
    let best = Infinity;
    sources.forEach(s => {
      const ft = teamOf(fl);
      if (s.team !== undefined && ft !== undefined && s.team !== ft) return;
      const d = Math.hypot(fl.x - s.x, fl.y - s.y);
      if (d < best) best = d;
    });
    result.set(fl, {
      fleet: fl,
      inSupply: best <= SUPPLY_SOURCE_RADIUS,
      via: best <= SUPPLY_SOURCE_RADIUS ? 'source' : null,
      distToSource: best,
      aux: null,
    });
  });

  // 2. 运输舰 AI：前出 → 补给 → 返航补货
  auxShips.forEach(aux => {
    const fl = aux.fleet;
    if (!fl || !fl.units || fl.units.length === 0) return;
    const info = result.get(fl);
    if (!info) return;

    // 找需要补给的友军舰队（含自己所属舰队）
    let target: any = null;
    let bestD = Infinity;
    fleets.forEach(other => {
      const ft2 = teamOf(fl);
      if (teamOf(other) !== ft2) return;
      const d = Math.hypot(fl.x - other.x, fl.y - other.y);
      // 优先补给补给度低的友军
      const need = (other.units?.[0]?.supply ?? 100) < 70;
      const score = d - (need ? 400 : 0);
      if (score < bestD) { bestD = score; target = other; }
    });

    // 状态机
    if (aux.cargo <= 0) {
      aux.state = 'returning';
    } else if (info.distToSource > SUPPLY_SOURCE_RADIUS && target) {
      aux.state = 'supplying';
    } else if (info.distToSource <= SUPPLY_SOURCE_RADIUS) {
      // 靠近源 → 补货
      aux.state = 'returning';
      aux.cargo = Math.min(AUX_CAPACITY, aux.cargo + AUX_SUPPLY_RATE * 2 * dt);
    } else {
      aux.state = 'forward';
    }

    // 前出偏移：forward/supplying 朝缺补给友军前出；returning 朝母港（homeCastle）返航。
    // 旧实现 returning/idle 直接归零偏移，视觉上运输舰从不"返航"，后勤战看不出往返。
    if (target && (aux.state === 'forward' || aux.state === 'supplying')) {
      const ang = Math.atan2(target.y - fl.y, target.x - fl.x);
      aux.ox = Math.cos(ang) * AUX_FORWARD_OFFSET;
      aux.oy = Math.sin(ang) * AUX_FORWARD_OFFSET;
    } else if (aux.state === 'returning' && aux.homeX !== undefined && aux.homeY !== undefined) {
      const ang = Math.atan2(aux.homeY - fl.y, aux.homeX - fl.x);
      aux.ox = Math.cos(ang) * AUX_FORWARD_OFFSET;
      aux.oy = Math.sin(ang) * AUX_FORWARD_OFFSET;
    } else {
      aux.ox = 0;
      aux.oy = 0;
    }

    // 补给输出：给半径内友军回补
    if (aux.state === 'supplying' && aux.cargo > 0) {
      fleets.forEach(other => {
        if (teamOf(other) !== teamOf(fl)) return;
        const d = Math.hypot(fl.x + aux.ox - other.x, fl.y + aux.oy - other.y);
        if (d <= SUPPLY_AUX_RADIUS) {
          other.units?.forEach((u: any) => {
            u.supply = Math.min(100, (u.supply ?? 100) + AUX_SUPPLY_RATE * dt);
          });
          aux.cargo = Math.max(0, aux.cargo - AUX_SUPPLY_RATE * dt);
          const oi = result.get(other);
          if (oi && !oi.inSupply) { oi.inSupply = true; oi.via = 'aux'; oi.aux = aux; }
        }
      });
    }
  });

  return result;
}

/** 判断是否为补给运输舰（舰种 supply / 中文 classType '补给'） */
export function isSupplyUnit(u: any): boolean {
  return u?.classType === 'supply' || u?.classType === '补给';
}

/** 从所有舰队中收集运输舰，初始化 AuxShip 结构。
 *  @param homeOf 可选：舰队 → 母港（后勤站 castlePos）坐标，写入 AuxShip.homeX/homeY 供真往返返航 */
export function collectAuxShips(fleets: any[], homeOf?: (fleet: any) => { x: number; y: number } | null): AuxShip[] {
  const out: AuxShip[] = [];
  fleets.forEach(fl => {
    const home = homeOf ? homeOf(fl) : null;
    fl.units?.forEach((u: any) => {
      if (isSupplyUnit(u)) {
        out.push({
          unit: u, fleet: fl, cargo: AUX_CAPACITY, state: 'idle', ox: 0, oy: 0,
          homeX: home?.x, homeY: home?.y,
        });
      }
    });
  });
  return out;
}
