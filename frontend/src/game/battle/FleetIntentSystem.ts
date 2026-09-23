export type FleetIntentKind = 'survive' | 'engage' | 'mission' | 'beacon' | 'support' | 'search' | 'patrol';

export interface IntentPoint { x: number; y: number }
export interface IntentContact { id: number; destination: IntentPoint; inWeaponRange: boolean }
export interface IntentAlly { id: number; destination: IntentPoint }
export interface IntentMission { type: string; destination: IntentPoint }

export interface FleetIntentInput {
  retreatDestination: IntentPoint | null;
  attacker: IntentContact | null;
  engagement: IntentContact | null;
  beaconDestination: IntentPoint | null;
  mission: IntentMission | null;
  knownEnemy: IntentContact | null;
  fightingAlly: IntentAlly | null;
  forwardSearch: IntentPoint | null;
  patrolPoint: IntentPoint | null;
}

export interface FleetIntent {
  kind: FleetIntentKind;
  destination: IntentPoint | null;
  fireTargetId: number | null;
  missionPaused: boolean;
  reason: string;
}

/**
 * Resolves movement and fire independently. An assigned movement order remains the
 * destination while incoming fire is answered; a deliberate engagement may pause,
 * but never erase, a mission.
 */
export function resolveFleetIntent(input: FleetIntentInput): FleetIntent {
  if (input.retreatDestination) {
    return {
      kind: 'survive', destination: input.retreatDestination,
      fireTargetId: input.attacker?.inWeaponRange ? input.attacker.id : null,
      missionPaused: !!input.mission, reason: '生存与撤离优先',
    };
  }

  if (input.engagement) {
    return {
      kind: 'engage', destination: input.engagement.destination,
      fireTargetId: input.engagement.inWeaponRange ? input.engagement.id : null,
      missionPaused: !!input.mission, reason: input.mission ? '任务途中接敌，暂缓后交战' : '已识别敌军进入接战区',
    };
  }

  const returnFire = input.attacker?.inWeaponRange ? input.attacker.id : null;
  if (input.beaconDestination) {
    return { kind: 'beacon', destination: input.beaconDestination, fireTargetId: returnFire, missionPaused: false, reason: '执行玩家信标并保持自卫' };
  }
  if (input.mission) {
    return { kind: 'mission', destination: input.mission.destination, fireTargetId: returnFire, missionPaused: false, reason: '继续执行既定任务' };
  }
  if (input.knownEnemy) {
    return {
      kind: 'engage', destination: input.knownEnemy.destination,
      fireTargetId: input.knownEnemy.inWeaponRange ? input.knownEnemy.id : returnFire,
      missionPaused: false, reason: '目标完成后追击已知敌军',
    };
  }
  if (input.fightingAlly) {
    return { kind: 'support', destination: input.fightingAlly.destination, fireTargetId: returnFire, missionPaused: false, reason: '支援正在交战的友军' };
  }
  if (input.forwardSearch) {
    return { kind: 'search', destination: input.forwardSearch, fireTargetId: returnFire, missionPaused: false, reason: '沿敌方方向继续搜索' };
  }
  return { kind: 'patrol', destination: input.patrolPoint, fireTargetId: returnFire, missionPaused: false, reason: '巡逻己方关键节点' };
}
