export type FleetOrderKind = 'hold' | 'advance' | 'approach' | 'beacon' | 'withdraw' | 'screen' | 'scout' | 'strikeFlagship';
export type FleetOrderIssuer = 'player' | 'ai' | 'system';

export interface FleetOrder {
  kind: FleetOrderKind;
  issuer: FleetOrderIssuer;
  target?: { x: number; y: number };
  expiresAt: number | null;
}

const ISSUER_PRIORITY: Record<FleetOrderIssuer, number> = {
  player: 3,
  system: 2,
  ai: 1,
};

/**
 * Resolves fleet movement authority. A live player order always owns its fleet,
 * so nearby friendly AI cannot rotate or retarget a player beacon.
 */
export function resolveFleetOrder(orders: readonly FleetOrder[], nowMs: number): FleetOrder | null {
  const active = orders.filter(order => order.expiresAt == null || order.expiresAt > nowMs);
  if (active.length === 0) return null;
  return active.reduce((winner, candidate) => {
    return ISSUER_PRIORITY[candidate.issuer] > ISSUER_PRIORITY[winner.issuer] ? candidate : winner;
  });
}

function hasLivingCombatUnit(fleet: any): boolean {
  return Array.isArray(fleet?.units) && fleet.units.some((unit: any) =>
    unit && unit.hp > 0 && unit.classType !== '补给' && unit.classType !== 'supply' && unit.classType !== '运输');
}

/** A detached fleet loss must not deactivate its whole admiral/faction. */
export function shouldDeactivateFactionAfterFleetLoss(
  fleets: readonly any[],
  factionId: number,
  lostFleetId: number,
): boolean {
  return !fleets.some((fleet: any) =>
    fleet?.id !== lostFleetId && fleet?.factionId === factionId && hasLivingCombatUnit(fleet));
}
