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
