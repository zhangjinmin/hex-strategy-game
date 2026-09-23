/**
 * Converts raw sensor coverage into information available to command.
 * It deliberately contains no faction, renderer or AI dependency.
 *
 * 依据：`2026-09-23-battle-command-and-ai-flow-rebuild-design.md` §Fog and intelligence：
 *   · 渲染消费**团队域**情报而非阵营原始数据（createIntelArchive 的 team 域）；
 *   · 开火敌舰立即产生战斗接触，**交战中不可消失**（resolveContactMemory 的 engaged 入参）；
 *   · 确认识别 ⇒ **持久已知目标档案**（recordKnownContact：末次确认位置 + 时间，**无 TTL**）；
 *   · 实时视野外的已知舰队 ⇒ 显示为「末次位置」情报接触，不得用真实实时位置
 *     （resolveIntelDisplay）；
 *   · 已知固定基地常驻可见于确认位置（kind='base' 的档案记录）；
 *   · **仅显式电子战/欺骗转换**可降级/失效航迹（concealmentSucceeded / invalidateKnownTrack）。
 *
 * @param {{ distance: number, sensorRange: number, scoutReport?: boolean, electronicStrength?: number, jammingStrength?: number }} input
 * @returns {{ state: 'unknown' | 'anomaly' | 'contact' | 'identified', effectiveSensorRange: number }}
 */
export function assessContact(input) {
  const effectiveSensorRange = Math.max(0, input.sensorRange + (input.electronicStrength ?? 0) - (input.jammingStrength ?? 0));
  if (input.scoutReport) return { state: 'identified', effectiveSensorRange };
  if (input.distance > effectiveSensorRange || effectiveSensorRange === 0) return { state: 'unknown', effectiveSensorRange };
  const ratio = input.distance / effectiveSensorRange;
  if (ratio > 0.8) return { state: 'anomaly', effectiveSensorRange };
  if (ratio > 0.35) return { state: 'contact', effectiveSensorRange };
  return { state: 'identified', effectiveSensorRange };
}

/**
 * Keeps a confirmed combat contact visible until an explicit concealment action
 * succeeds. Merely crossing a sensor threshold cannot make a firing fleet vanish.
 *
 * 关键规则（design §Fog）：
 *   · fired / engaged（交战窗口内）⇒ 强制 'identified'，**交战中不可消失**——
 *     此时连显式电子战也不能把它藏回去；
 *   · concealmentSucceeded（显式电子战/欺骗转换）是**唯一**降档入口，且只在交战结束后生效；
 *   · 普通离开视野不降级（已确认记忆单调保持）。
 *
 * @param {{ previous: 'unknown'|'anomaly'|'contact'|'identified', observed: 'unknown'|'anomaly'|'contact'|'identified', fired?: boolean, engaged?: boolean, concealmentSucceeded?: boolean }} input
 * @returns {'unknown'|'anomaly'|'contact'|'identified'}
 */
export function resolveContactMemory(input) {
  if (input.fired || input.engaged) return 'identified';
  if (input.concealmentSucceeded) return input.observed;
  if (input.previous === 'identified') return 'identified';
  const rank = { unknown: 0, anomaly: 1, contact: 2, identified: 3 };
  return rank[input.observed] >= rank[input.previous] ? input.observed : input.previous;
}

// ============================================================
// 持久已知目标档案（团队域 · 无 TTL）
// ============================================================

/**
 * 团队域情报档案：每个**已确认识别**的敌舰队/基地一条记录，
 * 含末次确认位置 + 时间（design §Fog：persistent known-object record）。
 * 只有显式电子战/欺骗（invalidateKnownTrack）可使记录的 reliable 变 false。
 */
export function createIntelArchive() {
  return { records: new Map() };
}

function intelKey(team, targetId) {
  return `${team}:${targetId}`;
}

/**
 * 写入/刷新持久档案（recordScoutReport 与 markFleetIdentified 的落地点）。
 * 新的确认会重建可靠航迹（reliable=true）并把末次确认位置/时间推进到当前。
 *
 * @param {{ team: number, targetId: number|string, kind: 'fleet'|'base', x: number, y: number, now: number, strength?: number|null }} input
 */
export function recordKnownContact(archive, input) {
  const k = intelKey(input.team, input.targetId);
  const prev = archive.records.get(k) || null;
  const record = {
    team: input.team,
    targetId: input.targetId,
    kind: input.kind,
    /** 末次确认位置 */
    x: input.x,
    y: input.y,
    /** 末次确认时间 */
    t: input.now,
    firstConfirmedAt: prev ? prev.firstConfirmedAt : input.now,
    /** 兵力估计（舰数；用于「敌兵力重大变化」判定） */
    strength: input.strength !== undefined ? input.strength : (prev ? prev.strength : null),
    /** 可靠航迹是否成立（仅显式电子战/欺骗可置 false） */
    reliable: true,
  };
  archive.records.set(k, record);
  return record;
}

/** 档案读接口：direct attack track（lastKnown/reliable）与 UI（末次位置标签）消费 */
export function getKnownContact(archive, team, targetId) {
  return archive.records.get(intelKey(team, targetId)) || null;
}

/** 显式电子战/欺骗转换的唯一失效入口：已知航迹失效（reliable=false），档案保留供重新识别 */
export function invalidateKnownTrack(archive, team, targetId) {
  const k = intelKey(team, targetId);
  const rec = archive.records.get(k);
  if (!rec) return null;
  const broken = { ...rec, reliable: false };
  archive.records.set(k, broken);
  return broken;
}

/** 航迹是否可靠（有档案且未被显式失效） */
export function isKnownTrackReliable(archive, team, targetId) {
  const rec = getKnownContact(archive, team, targetId);
  return !!rec && rec.reliable === true;
}

// ============================================================
// 渲染档位（团队域情报 → 呈现决策）
// ============================================================

/**
 * 渲染档位判定（3D 模型 / 环 / 标签 / 瞄准 / 任务选择同规则）：
 *   · live       — 实时可见（交战窗口内，或原始观测确认识别，或已知目标在实时视内）⇒ 实时渲染；
 *   · fuzzy      — 未识别目标的模糊接触（异常信号 / 未识别舰队）⇒ 只画接触符号；
 *   · last_known — 实时视野外的已知目标 ⇒ 画在**档案的末次确认位置**（绝不实时跟位）；
 *                  已知固定基地（kind='base'）⇒ 永远至少这一档（常驻可见于确认位置）；
 *   · hidden     — 未知 ⇒ 不渲染。
 *
 * @param {{ observed: 'unknown'|'anomaly'|'contact'|'identified', identified?: boolean, engaged?: boolean, record?: { x:number, y:number, t:number, reliable?: boolean, kind?: string }|null }} input
 * @returns {{ mode: 'live'|'fuzzy'|'last_known'|'hidden', label: string|null, x?: number, y?: number, t?: number }}
 */
export function resolveIntelDisplay(input) {
  if (input.engaged || input.observed === 'identified') return { mode: 'live', label: null };
  if (input.identified && input.observed !== 'unknown') return { mode: 'live', label: null };
  if (input.observed === 'anomaly' || input.observed === 'contact') {
    return { mode: 'fuzzy', label: input.observed === 'anomaly' ? '异常信号' : '未识别舰队' };
  }
  const rec = input.record;
  if (rec && rec.reliable !== false) {
    return { mode: 'last_known', label: '末次位置', x: rec.x, y: rec.y, t: rec.t };
  }
  return { mode: 'hidden', label: null };
}

/**
 * 「敌兵力/方位重大变化」判定（通知 4 类之一）：
 * 兵力估计变化 ≥ 2 艘，或末次确认位置位移 ≥ moveThreshold（默认 600 世界单位）。
 * @param {{ x:number, y:number, strength?: number|null }|null} prev
 * @param {{ x:number, y:number, strength?: number|null, moveThreshold?: number }} next
 */
export function isMaterialIntelChange(prev, next) {
  if (!prev) return false;
  const strengthPrev = typeof prev.strength === 'number' ? prev.strength : null;
  const strengthNext = typeof next.strength === 'number' ? next.strength : null;
  const strengthChanged = strengthPrev !== null && strengthNext !== null
    && Math.abs(strengthNext - strengthPrev) >= 2;
  const moved = Math.hypot((next.x || 0) - (prev.x || 0), (next.y || 0) - (prev.y || 0))
    >= (next.moveThreshold ?? 600);
  return strengthChanged || moved;
}
