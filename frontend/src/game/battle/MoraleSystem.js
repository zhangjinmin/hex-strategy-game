/**
 * Supply deprivation degrades morale/readiness first. Hull attrition is reserved
 * for a force that has already broken while receiving hostile fire.
 *
 * @param {{ morale: number, supply: number, underAttack: boolean, advantage?: boolean, dtMs: number }} input
 * @returns {{ morale: number, hullLossRatio: number, events: string[] }}
 */
export function resolveMoraleTick(input) {
  const seconds = Math.max(0, input.dtMs) / 1000;
  const events = [];
  let morale = Math.max(0, Math.min(100, input.morale));

  if (input.supply < 30) {
    morale = Math.max(0, morale - ((30 - Math.max(0, input.supply)) / 30) * 4 * seconds);
    events.push('supply-strain');
  }
  if (input.advantage) {
    morale = Math.min(100, morale + 3 * seconds);
    events.push('morale-surge');
  }

  const hullLossRatio = morale === 0 && input.underAttack ? 0.01 * seconds : 0;
  if (hullLossRatio > 0) events.push('broken-under-fire');
  return { morale, hullLossRatio, events };
}
