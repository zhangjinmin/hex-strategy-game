/**
 * Shared low-level motion rules for tactical entities.
 *
 * Positions are advanced by a fixed per-tick budget. A destination changing
 * far away is never permission to move faster; it only lengthens the trip.
 */
export interface Point {
  x: number;
  y: number;
}

export function moveTowardsAtSpeed(current: Point, target: Point, maxStep: number): Point {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || maxStep <= 0) return { x: current.x, y: current.y };
  const step = Math.min(distance, maxStep);
  return { x: current.x + dx / distance * step, y: current.y + dy / distance * step };
}

/** Move an orientation towards its target via the shortest arc, with no jump. */
export function advanceFormationFacing(current: number, target: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  if (Math.abs(delta) <= maxStep) return current + delta;
  return current + Math.sign(delta) * Math.max(0, maxStep);
}

/** Absolute wrapped difference between two headings. */
export function headingDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}
