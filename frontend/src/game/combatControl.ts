/**
 * Deterministic tactical movement control.
 *
 * The controller owns the legal order of large fleet maneuvers. It deliberately
 * has no Phaser dependency so a battle can be tested without rendering it.
 */

export type ManeuverPhase = 'cruise' | 'brake' | 'turn' | 'reform' | 'disengage';
export type MotionDirective = 'forward' | 'reverse' | 'hold';

export interface ContactState {
  engaged: boolean;
  /** Seconds out of weapons contact before a fleet is free to turn. */
  releaseAfter: number;
  secondsSinceContact: number;
}

export interface ManeuverState {
  phase: ManeuverPhase;
  phaseSeconds: number;
  motion?: MotionDirective;
}

export interface ManeuverInput {
  engaged: boolean;
  retreatRequested: boolean;
  /** Absolute difference between current and requested fleet heading, radians. */
  headingError: number;
  stopped: boolean;
  reformed: boolean;
}

export interface ManeuverOrder {
  phase: ManeuverPhase;
  motion: MotionDirective;
  /** Rotate hulls in place; formation slots must stay frozen while true. */
  rotateInPlace: boolean;
  /** Assign new formation slots once when entering reformation. */
  beginReform: boolean;
}

export const TURN_THRESHOLD = Math.PI / 6;
export const DEFAULT_CONTACT_RELEASE_SECONDS = 2;

export function updateContact(previous: ContactState, inRange: boolean, dtSeconds: number): ContactState {
  const releaseAfter = previous.releaseAfter || DEFAULT_CONTACT_RELEASE_SECONDS;
  if (inRange) return { engaged: true, releaseAfter, secondsSinceContact: 0 };
  const secondsSinceContact = previous.secondsSinceContact + Math.max(0, dtSeconds);
  return {
    engaged: previous.engaged && secondsSinceContact < releaseAfter,
    releaseAfter,
    secondsSinceContact,
  };
}

export function maneuverOrder(phase: ManeuverPhase): ManeuverOrder {
  switch (phase) {
    case 'disengage': return { phase, motion: 'reverse', rotateInPlace: false, beginReform: false };
    case 'brake': return { phase, motion: 'hold', rotateInPlace: false, beginReform: false };
    case 'turn': return { phase, motion: 'hold', rotateInPlace: true, beginReform: false };
    case 'reform': return { phase, motion: 'hold', rotateInPlace: false, beginReform: true };
    default: return { phase, motion: 'forward', rotateInPlace: false, beginReform: false };
  }
}

export function advanceManeuver(state: ManeuverState, input: ManeuverInput, dtSeconds: number): ManeuverState {
  const elapsed = state.phaseSeconds + Math.max(0, dtSeconds);
  // A fleet under live fire cannot start or continue a free-space turn.
  if (input.engaged && (input.retreatRequested || state.phase === 'disengage')) {
    return { phase: 'disengage', phaseSeconds: elapsed, motion: 'reverse' };
  }
  // Contact released: a withdrawing fleet can now turn toward its withdrawal route.
  if (state.phase === 'disengage') {
    return { phase: input.headingError > TURN_THRESHOLD ? 'brake' : 'cruise', phaseSeconds: 0 };
  }
  if (state.phase === 'cruise' && input.headingError > TURN_THRESHOLD) {
    return { phase: 'brake', phaseSeconds: 0 };
  }
  if (state.phase === 'brake' && input.stopped) {
    return { phase: 'turn', phaseSeconds: 0 };
  }
  if (state.phase === 'turn' && input.headingError <= TURN_THRESHOLD / 4) {
    return { phase: 'reform', phaseSeconds: 0 };
  }
  if (state.phase === 'reform' && input.reformed) {
    return { phase: 'cruise', phaseSeconds: 0 };
  }
  return { ...state, phaseSeconds: elapsed, motion: maneuverOrder(state.phase).motion };
}
