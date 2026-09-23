import { resolveMoraleTick } from './MoraleSystem.js';

/**
 * The deterministic boundary for tactical combat simulation.
 * Rendering layers consume its events but never mutate its returned state.
 */
export interface BattleFleetState {
  id: string | number;
  morale?: number;
  supply?: number;
  underAttack?: boolean;
  advantage?: boolean;
  units: unknown[];
  [key: string]: unknown;
}

export interface BattleState {
  tick: number;
  fleets: BattleFleetState[];
  events: unknown[];
  [key: string]: unknown;
}

export interface BattleTickResult {
  state: BattleState;
  events: unknown[];
}

/**
 * Advances one simulation step without mutating the supplied state.
 * Subsystems will be introduced here in the fixed order defined by the rebuild plan.
 */
export function advanceBattle(state: BattleState, _dtMs: number, _rng: () => number): BattleTickResult {
  const next = structuredClone(state) as BattleState;
  next.tick = state.tick + 1;
  next.events = [];
  for (const fleet of next.fleets) {
    if (typeof fleet.morale !== 'number' || typeof fleet.supply !== 'number') continue;
    const morale = resolveMoraleTick({
      morale: fleet.morale,
      supply: fleet.supply,
      underAttack: fleet.underAttack === true,
      advantage: fleet.advantage === true,
      dtMs: _dtMs,
    });
    fleet.morale = morale.morale;
    next.events.push(...morale.events.map(kind => ({ kind, fleetId: fleet.id })));
  }
  return { state: next, events: next.events };
}
