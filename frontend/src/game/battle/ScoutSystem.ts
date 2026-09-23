/**
 * ScoutSystem — 阵营级侦察分队生命周期（纯计算 · 无渲染依赖）
 *
 * 依据：`2026-09-23-battle-command-and-ai-flow-rebuild-design.md` §Reconnaissance lifecycle：
 *   · 每阵营至多 1 个侦察分队，由至多 3 架巡洋机模型（前左/前中/前右）组成——
 *     **分兵或新建正式舰队不增加上限**（放飞锚 = 阵营部署中心，见 BattleScene.launchScoutForFaction）；
 *   · 一个生命周期、一个放飞冷却、一个汇总状态（shouldLaunchScouts 的入参即该汇总状态）；
 *   · 搜索航线最大化前向覆盖（resolveScoutForwardHeading 指向敌战线/敌接近估计）；
 *   · 接触后**最佳位置的机**跟踪目标（selectScoutTracker），其余扩大覆盖或返航；
 *     被跟踪接触是该队优先目标，直到摧毁 / 移交友军传感器 / 反情报显式丢失；
 *   · 通知抑制：例行放飞、扇区返回、普通扫描转换**不发全局通知**——
 *     仅 4 类通知（classifyScoutNotice）：首次确认接触 / 敌兵力方位重大变化 / 侦察损失 / 重要航迹丢失。
 */

export type ScoutSector = 'left' | 'centre' | 'right';
export type ScoutPhase = 'outbound' | 'sweeping' | 'tracking' | 'returning' | 'lost';

export interface ScoutFlight {
  id: string;
  parentFleetId: number;
  factionId: number;
  team: number;
  sector: ScoutSector;
  x: number;
  y: number;
  originX: number;
  originY: number;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  sensorRange: number;
  weaponRange: number;
  phase: ScoutPhase;
  launchedAt: number;
  maxForwardDistance: number;
  contactId: number | null;
}

export interface ScoutLaunchInput {
  parentFleetId: number;
  factionId: number;
  team: number;
  x: number;
  y: number;
  heading: number;
  parentSpeed: number;
  now: number;
  serial?: number;
  scoutSpeed?: number;
  maxForwardDistance?: number;
  sensorRange?: number;
  weaponRange?: number;
  hitPoints?: number;
}

export interface ScoutHostileContact {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface ScoutAdvanceInput {
  now: number;
  deltaSeconds: number;
  parent: { x: number; y: number; alive: boolean } | null;
  hostiles: readonly ScoutHostileContact[];
  /** 本帧的跟踪指派（selectScoutTracker 的结果）：仅最佳位置的机开始**新**跟踪；null = 不指派（自行跟踪） */
  trackerId?: string | null;
  /** 被跟踪接触已移交友军传感器 ⇒ 跟踪优先级安静结束（例行，不发通知） */
  contactHandoff?: boolean;
  /** 被跟踪接触的可靠航迹被反情报/电子战显式失效 ⇒ 重要航迹丢失 */
  trackBroken?: boolean;
}

export interface ScoutReport {
  targetId: number;
  x: number;
  y: number;
  sector: ScoutSector;
}

export interface ScoutAdvanceResult {
  flight: ScoutFlight;
  report: ScoutReport | null;
  fireTargetId: number | null;
  returned: boolean;
  /** 本帧丢失了被跟踪接触的重要航迹（目标消失 / 反情报失效；移交友军传感器不算） */
  trackLost: boolean;
  /** 本帧侦察机损失（被击落或失联离场） */
  scoutLost: boolean;
}

export interface ScoutLaunchPolicyInput {
  now: number;
  lastContactAt: number;
  cooldownUntil: number;
  liveFlightCount: number;
  staleAfterMs?: number;
}

export interface ScoutForwardHeadingInput {
  x: number;
  y: number;
  currentHeading: number;
  hostilePositions: readonly { x: number; y: number }[];
  hostileObjectives: readonly { x: number; y: number }[];
}

/** 全局通知的 4 类（design §Reconnaissance lifecycle 末段） */
export type ScoutNoticeKind = 'first_contact' | 'strength_change' | 'scout_loss' | 'track_lost';

/** 侦察事件（例行事件 ⇒ classifyScoutNotice 返回 null = 不发全局通知） */
export type ScoutEventKind =
  | 'launch'        // 例行放飞
  | 'return'        // 例行返航
  | 'sector_sweep'  // 普通扫描/扇区转换
  | 'contact'       // 发现接触
  | 'strength_change' // 敌兵力/方位变化
  | 'scout_loss'    // 侦察损失
  | 'track_lost';   // 重要航迹丢失

export interface ScoutNoticeInput {
  event: ScoutEventKind;
  /** 同一目标是否首次确认接触 */
  firstForTarget?: boolean;
  /** 兵力/方位变化是否重大（isMaterialIntelChange） */
  materialChange?: boolean;
}

const SECTORS: readonly { sector: ScoutSector; offset: number }[] = [
  { sector: 'left', offset: -Math.PI / 6 },
  { sector: 'centre', offset: 0 },
  { sector: 'right', offset: Math.PI / 6 },
];

/** 每阵营侦察分队的视觉上限（= 3 扇区；分兵/新建舰队不增加） */
export const SCOUT_FLIGHTS_PER_DETACHMENT = SECTORS.length;

/**
 * 通知抑制（纯计算）：例行放飞/返航/普通扫描转换不发全局通知；
 * 只保留 4 类——首次确认接触、敌兵力/方位重大变化、侦察损失、重要航迹丢失。
 * 返回 null ⇒ 调用方不得发全局 toast。
 */
export function classifyScoutNotice(input: ScoutNoticeInput): ScoutNoticeKind | null {
  switch (input.event) {
    case 'launch':
    case 'return':
    case 'sector_sweep':
      return null;
    case 'contact':
      return input.firstForTarget ? 'first_contact' : (input.materialChange ? 'strength_change' : null);
    case 'strength_change':
      return input.materialChange ? 'strength_change' : null;
    case 'scout_loss':
      return 'scout_loss';
    case 'track_lost':
      return 'track_lost';
    default:
      return null;
  }
}

/**
 * 跟踪指派（纯计算）：接触后由**最佳位置的机**（距目标最近）跟踪，
 * 其余机扩大覆盖或返航（advanceScoutFlight 的 trackerId 入参消费本结果）。
 */
export function selectScoutTracker(
  flights: readonly { id: string; x: number; y: number; hp?: number }[],
  contact: { x: number; y: number },
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const f of flights) {
    if (typeof f.hp === 'number' && f.hp <= 0) continue;
    const d = Math.hypot(f.x - contact.x, f.y - contact.y);
    if (d < bestD) { bestD = d; best = f.id; }
  }
  return best;
}

export function launchScoutFlights(input: ScoutLaunchInput): ScoutFlight[] {
  const speed = Math.max(input.parentSpeed * 2.2, input.scoutSpeed ?? 220);
  const serial = input.serial ?? input.now;
  return SECTORS.map(({ sector, offset }, index) => ({
    id: `scout:${input.parentFleetId}:${serial}:${index}`,
    parentFleetId: input.parentFleetId,
    factionId: input.factionId,
    team: input.team,
    sector,
    x: input.x,
    y: input.y,
    originX: input.x,
    originY: input.y,
    heading: input.heading + offset,
    speed,
    hp: input.hitPoints ?? 100,
    maxHp: input.hitPoints ?? 100,
    sensorRange: input.sensorRange ?? 520,
    weaponRange: input.weaponRange ?? 180,
    phase: 'outbound',
    launchedAt: input.now,
    maxForwardDistance: input.maxForwardDistance ?? 900,
    contactId: null,
  }));
}

/**
 * 放飞策略（阵营级汇总状态）：情报陈旧（staleAfterMs，默认 12s）且无在途航班、
 * 不在整备冷却中 ⇒ 允许放飞。**与舰队数无关**——入参是该阵营（分队）的汇总状态。
 */
export function shouldLaunchScouts(input: ScoutLaunchPolicyInput): boolean {
  if (input.liveFlightCount > 0 || input.cooldownUntil > input.now) return false;
  return input.now - input.lastContactAt >= (input.staleAfterMs ?? 12000);
}

/** Points the reconnaissance fan at the hostile battlefront, never at the carrier's incidental hull angle. */
export function resolveScoutForwardHeading(input: ScoutForwardHeadingInput): number {
  const candidates = input.hostilePositions.length > 0 ? input.hostilePositions : input.hostileObjectives;
  if (candidates.length === 0) return input.currentHeading;
  let nearest = candidates[0];
  let best = Math.hypot(nearest.x - input.x, nearest.y - input.y);
  for (let i = 1; i < candidates.length; i++) {
    const distance = Math.hypot(candidates[i].x - input.x, candidates[i].y - input.y);
    if (distance < best) {
      best = distance;
      nearest = candidates[i];
    }
  }
  return Math.atan2(nearest.y - input.y, nearest.x - input.x);
}

function nearestWithin(
  flight: ScoutFlight,
  hostiles: readonly ScoutHostileContact[],
  range: number,
): ScoutHostileContact | null {
  let nearest: ScoutHostileContact | null = null;
  let best = range;
  for (const hostile of hostiles) {
    if (!hostile.alive) continue;
    const distance = Math.hypot(hostile.x - flight.x, hostile.y - flight.y);
    if (distance <= best) {
      best = distance;
      nearest = hostile;
    }
  }
  return nearest;
}

function moveTowards(flight: ScoutFlight, x: number, y: number, distance: number): ScoutFlight {
  const dx = x - flight.x;
  const dy = y - flight.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= 1e-6) return flight;
  const step = Math.min(distance, remaining);
  return {
    ...flight,
    x: flight.x + dx / remaining * step,
    y: flight.y + dy / remaining * step,
    heading: Math.atan2(dy, dx),
  };
}

export function advanceScoutFlight(flight: ScoutFlight, input: ScoutAdvanceInput): ScoutAdvanceResult {
  if (flight.phase === 'lost' || flight.hp <= 0) {
    return {
      flight: { ...flight, phase: 'lost' }, report: null, fireTargetId: null,
      returned: false, trackLost: false, scoutLost: true,
    };
  }

  const detected = nearestWithin(flight, input.hostiles, flight.sensorRange);
  const defensiveTarget = nearestWithin(flight, input.hostiles, flight.weaponRange);
  let next = { ...flight };
  let report: ScoutReport | null = null;
  let returned = false;
  let trackLost = false;

  if (detected && flight.contactId == null) {
    // 跟踪指派：只有最佳位置的机开始跟踪；其余机继续扩大前向覆盖（不绕目标转圈）
    const designated = input.trackerId == null || input.trackerId === flight.id;
    if (designated) {
      report = { targetId: detected.id, x: detected.x, y: detected.y, sector: flight.sector };
      next.contactId = detected.id;
      next.phase = 'tracking';
    }
  }

  const step = Math.max(0, next.speed * input.deltaSeconds);
  if (next.phase === 'tracking') {
    const tracked = input.hostiles.find(hostile => hostile.alive && hostile.id === next.contactId);
    if (input.contactHandoff) {
      // 移交友军传感器：跟踪优先级安静结束（例行转换，不发全局通知）
      next.phase = 'returning';
      next.contactId = null;
    } else if (input.trackBroken || !tracked) {
      // 反情报/电子战显式失效，或目标消失 ⇒ 重要航迹丢失
      next.phase = 'returning';
      next.contactId = null;
      trackLost = true;
    } else {
      // Stay well inside sensor coverage while avoiding a suicidal collision with the fleet being shadowed.
      const distance = Math.hypot(tracked.x - next.x, tracked.y - next.y);
      const standOff = Math.max(next.weaponRange * 1.25, next.sensorRange * 0.55);
      if (distance > standOff * 1.15) {
        next = moveTowards(next, tracked.x, tracked.y, step);
      } else if (distance < standOff * 0.75) {
        const away = Math.atan2(next.y - tracked.y, next.x - tracked.x);
        next = moveTowards(next, next.x + Math.cos(away) * step, next.y + Math.sin(away) * step, step);
      } else {
        next.heading = Math.atan2(tracked.y - next.y, tracked.x - next.x);
      }
    }
  }

  if (next.phase === 'returning') {
    if (!input.parent?.alive) {
      next.phase = 'lost';
    } else {
      next = moveTowards(next, input.parent.x, input.parent.y, step);
      returned = Math.hypot(next.x - input.parent.x, next.y - input.parent.y) <= 8;
    }
  } else if (next.phase !== 'tracking') {
    const travelled = Math.hypot(next.x - next.originX, next.y - next.originY);
    const sweepExpired = input.now - next.launchedAt >= 12000;
    if (travelled >= next.maxForwardDistance || sweepExpired) {
      next.phase = travelled >= next.maxForwardDistance ? 'sweeping' : 'returning';
      if (next.phase === 'sweeping' && input.now - next.launchedAt >= 14000) next.phase = 'returning';
    }
    if (next.phase === 'returning') {
      if (input.parent?.alive) next = moveTowards(next, input.parent.x, input.parent.y, step);
      else next.phase = 'lost';
    } else {
      next.x += Math.cos(next.heading) * step;
      next.y += Math.sin(next.heading) * step;
    }
  }

  // flight.phase === 'lost' 已在函数入口早退 ⇒ 这里 next 进入 'lost' 即为本帧新损失
  const scoutLost = next.phase === 'lost';
  return {
    flight: next,
    report,
    fireTargetId: defensiveTarget?.id ?? null,
    returned,
    trackLost,
    scoutLost,
  };
}
