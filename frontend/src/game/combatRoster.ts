/** A logistics hull can provide supply, but never grants combat persistence. */
export function isCombatUnit(unit: any): boolean {
  const logistics = unit?.classType === 'supply' || unit?.classType === '补给';
  return !!unit && unit.hp > 0 && !logistics;
}

export function combatUnits(fleet: any): any[] {
  return (fleet?.units || []).filter(isCombatUnit);
}

export function hasCombatUnits(fleet: any): boolean {
  return combatUnits(fleet).length > 0;
}

/**
 * Every surviving hull remains targetable. Logistics ships are deliberately
 * included here: destroying them cuts the supply chain, but does not decide
 * whether a fleet is still combat-capable.
 */
export function targetableUnits(fleet: any): any[] {
  return (fleet?.units || []).filter((unit: any) => unit?.hp > 0);
}
