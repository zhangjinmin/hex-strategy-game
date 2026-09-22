/**
 * Fleet combat state → renderable attrition projection.
 *
 * Combat units remain the sole authority for damage, firing, and campaign
 * persistence. This module only answers how much of that aggregate force is
 * still visibly present, so a fleet at 30% structural strength cannot look
 * like an untouched full formation.
 */
export interface RepresentationUnit {
  hp: number;
  maxHp: number;
  /** Real ships represented by this aggregate visual/combat unit. */
  shipCount?: number;
}

export interface FleetRepresentation {
  hpPct: number;
  effectiveShips: number;
  visibleCount: number;
  /** Stable indexes of the surviving visual representatives. */
  visibleIndexes: number[];
}

/**
 * Produces a deterministic render projection from authoritative combat HP.
 * Models are selected by remaining structural integrity, then deployment
 * order; no randomness is permitted here because that would make the visual
 * formation flicker while no combat event occurred.
 */
export function projectFleetRepresentation(
  units: readonly RepresentationUnit[],
  visualCapacity: number = units.length,
): FleetRepresentation {
  const live = units
    .map((u, index) => ({ u, index, ratio: u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0 }))
    .filter((x) => x.ratio > 0);
  const maxHp = units.reduce((sum, u) => sum + Math.max(0, u.maxHp || 0), 0);
  const hp = units.reduce((sum, u) => sum + Math.max(0, Math.min(u.hp || 0, u.maxHp || 0)), 0);
  const hpPct = maxHp > 0 ? hp / maxHp : 0;
  const effectiveShips = Math.round(units.reduce((sum, u) => {
    const ratio = u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0;
    return sum + (u.shipCount ?? 1) * ratio;
  }, 0));
  const requested = hpPct > 0 ? Math.max(1, Math.round(Math.max(0, visualCapacity) * hpPct)) : 0;
  const visibleCount = Math.min(live.length, requested);
  live.sort((a, b) => b.ratio - a.ratio || a.index - b.index);
  const visibleIndexes = live.slice(0, visibleCount).map((x) => x.index).sort((a, b) => a - b);
  return { hpPct, effectiveShips, visibleCount, visibleIndexes };
}
