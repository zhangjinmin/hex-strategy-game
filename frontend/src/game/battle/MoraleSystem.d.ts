export interface MoraleTickInput {
  morale: number;
  supply: number;
  underAttack: boolean;
  advantage?: boolean;
  dtMs: number;
}

export interface MoraleTickResult {
  morale: number;
  hullLossRatio: number;
  events: string[];
}

export function resolveMoraleTick(input: MoraleTickInput): MoraleTickResult;
