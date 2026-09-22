/** Pure geometry for tactical missions. */

export interface FleetPoint {
  x: number;
  y: number;
  /** Fleet heading in radians; +X is 0. */
  facing: number;
}

/**
 * A supporting fleet protects the vulnerable rear of its assigned ally rather
 * than converging on the ally's centre and corrupting both formations.
 */
export function escortDestination(ally: FleetPoint, _escort: Pick<FleetPoint, 'x' | 'y'>, distance: number): { x: number; y: number } {
  return {
    x: ally.x - Math.cos(ally.facing) * distance,
    y: ally.y - Math.sin(ally.facing) * distance,
  };
}
