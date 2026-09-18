/**
 * TacticalCommandSystem — 提督扮演战术指挥系统（银英4EX 式"扮演提督"核心）
 *
 * 解决的问题：
 *   1. 原战术层玩家是"操作国家"——所有己方舰队都能直接下令（全局姿态），扮演感为零
 *   2. 改为：玩家 = 总指挥，只能直接指挥自己的旗舰舰队；
 *      其他己方舰队只能通过"任务指令"间接指挥
 *   3. AI 舰队意图不可见 → 一窝蜂。每支舰队头顶要有可读的当前任务文本
 *
 * 三层模型：
 *   A. 指挥权限：总指挥判定（职位 → 军衔 → 功绩）+ 直接命令拦截（BattleScene 调度器）
 *   B. 任务指令：fleet.mission 五类任务，AI 决策循环优先执行
 *   C. 意图可见：fleetIntentText 生成头顶任务文本；3D 意图线由 overlay 绘制
 *
 * 纯计算模块，不碰 Phaser/Three 渲染；仅指挥制（command）模式启用。
 */

/** 国家职务权重（排序第一键：职位高低） */
export const ROLE_WEIGHT: Record<string, number> = {
  emperor: 100,
  prime_minister: 95,
  council: 95,               // 同盟最高评议会，对标帝国宰相
  military_minister: 90,
  high_command_chief: 88,
  joint_ops_chief: 88,       // 统合作战本部长，对标统帅总部总长
  space_fleet_commander: 85,
  space_fleet_deputy: 80,
  joint_ops_deputy: 78,
  intel_minister: 70,
  defense_commander: 60,
  fleet_commander: 50,
  fleet_staff: 30,
  none: 0,
};

/** 国家职务中文名（军议面板「总指挥判定依据」显示用；与 ROLE_WEIGHT 键一一对应） */
export const ROLE_LABEL: Record<string, string> = {
  emperor: '皇帝',
  prime_minister: '宰相',
  council: '最高评议会议长',
  military_minister: '军务尚书',
  high_command_chief: '统帅本部总长',
  joint_ops_chief: '统合作战本部长',
  space_fleet_commander: '宇宙舰队司令长官',
  space_fleet_deputy: '宇宙舰队副司令长官',
  joint_ops_deputy: '统合作战本部次长',
  intel_minister: '情报部长',
  defense_commander: '防卫司令官',
  fleet_commander: '舰队指挥官',
  fleet_staff: '舰队参谋',
  none: '—',
};

/** AI 战前计划 role 中文名（fleetIntentText 前缀显示用；见 BattleScene.planFactionBattle） */
export const PLAN_ROLE_LABEL: Record<string, string> = {
  assault: '突击',
  capture: '夺取',
  hold: '坚守',
  support: '协同',
  resupply: '补给',
};

/** 提督资序三元键：[职位权重, 数字军衔(1-13), 功绩(stats.tactics 近似)] */
export function admiralSeniority(a: any): [number, number, number] {
  return [
    ROLE_WEIGHT[a?.role ?? 'none'] ?? 0,
    a?.rank ?? 0,
    a?.stats?.tactics ?? 0,
  ];
}

/**
 * 总指挥判定：职位高低 → 军衔高低 → 同军衔比功绩。
 * 候选为空返回 null。不打平加随机——完全平手时取数组首位（确定性，便于测试）。
 */
export function pickSupremeCommander<T = any>(candidates: T[]): T | null {
  if (!candidates || candidates.length === 0) return null;
  let best: T = candidates[0];
  let bestKey = admiralSeniority(best);
  for (let i = 1; i < candidates.length; i++) {
    const k = admiralSeniority(candidates[i]);
    if (k[0] > bestKey[0] ||
        (k[0] === bestKey[0] && k[1] > bestKey[1]) ||
        (k[0] === bestKey[0] && k[1] === bestKey[1] && k[2] > bestKey[2])) {
      best = candidates[i];
      bestKey = k;
    }
  }
  return best;
}

// ============================================================
// B. 任务指令系统
// ============================================================

export type MissionType = 'attack_fleet' | 'capture_planet' | 'hold_point' | 'support_fleet' | 'retreat_supply';

export interface Mission {
  type: MissionType;
  /** attack_fleet/support_fleet: 目标舰队 id 或 factionId；capture_planet: 敌方 factionId（夺其根据地）或 0=最近非己方星球 */
  targetId?: number;
  /** hold_point: 坚守点坐标（发布时可缺省 → BattleScene 用舰队当前位置填充） */
  x?: number;
  y?: number;
  /** 头顶/面板显示文本 */
  text: string;
}

export type MissionTargetKind = 'enemy_fleet' | 'ally_fleet' | 'planet' | 'none';

export const MISSION_TYPES: { type: MissionType; label: string; needsTarget: MissionTargetKind }[] = [
  { type: 'attack_fleet', label: '攻击敌舰队', needsTarget: 'enemy_fleet' },
  { type: 'capture_planet', label: '夺取星球/根据地', needsTarget: 'planet' },
  { type: 'hold_point', label: '坚守当前位置', needsTarget: 'none' },
  { type: 'support_fleet', label: '协同友军作战', needsTarget: 'ally_fleet' },
  { type: 'retreat_supply', label: '撤回后勤站补货', needsTarget: 'none' },
];

/** 构造任务对象（text 为显示用快照；目标名变化不影响执行——执行读 targetId） */
export function buildMission(
  type: MissionType,
  opts: { targetId?: number; targetName?: string; x?: number; y?: number } = {},
): Mission {
  switch (type) {
    case 'attack_fleet':
      return { type, targetId: opts.targetId, text: `攻击 ${opts.targetName || '目标舰队'}` };
    case 'capture_planet':
      return { type, targetId: opts.targetId ?? 0, text: `夺取 ${opts.targetName || '最近的中立星球'}` };
    case 'hold_point':
      return { type, x: opts.x, y: opts.y, text: '坚守指定空域' };
    case 'support_fleet':
      return { type, targetId: opts.targetId, text: `协同 ${opts.targetName || '友军舰队'}` };
    case 'retreat_supply':
      return { type, text: '撤回后勤站补货' };
  }
}

/** 直接命令类型（stance/attack 等实时操控）——非总指挥舰队一律拦截 */
export const DIRECT_COMMAND_TYPES = ['stance', 'attack'];

/** 是否允许对该舰队下达直接命令（玩家 = 总指挥，只能直接指挥旗舰舰队） */
export function isDirectCommandAllowed(fleet: any, supremeCommanderId: number | null | undefined): boolean {
  if (supremeCommanderId === null || supremeCommanderId === undefined) return true; // 非指挥制/未判定：不拦截
  return fleet?.commanderId === supremeCommanderId;
}

// ============================================================
// C. AI 意图可见
// ============================================================

/**
 * 舰队当前意图的可读文本（头顶标签）。
 * 有任务 → 任务文本；否则从状态机/姿态推导（敌方 AI 同样适用）。
 * @param nameOfFleet 按舰队 id 解析显示名（如"比克古舰队"），解析不到可返回 null
 */
export function fleetIntentText(fleet: any, nameOfFleet?: (fleetId: any) => string | null, opts?: { team?: number }): string {
  const enemy = opts?.team == null ? true : opts.team !== 1;
  const base = ((): string => {
    if (!enemy && fleet?.mission?.text) {
      // [V18-B · B3] 途中接战可见（D2-C）：任务执行被战斗抢占（先接战、任务暂缓）时显式标注，避免误读为「任务被忽略」。
      //   attack_fleet 的 engaging 即任务执行本身 → 不加；其余类型被接战抢占 → 加。
      const mtype = fleet?.mission?.type;
      if (fleet?.state === 'engaging' && mtype !== 'attack_fleet') return `${fleet.mission.text}（途中接战）`;
      return fleet.mission.text;
    }
    const state = fleet?.state || '';
    if (state === 'retreating') return '撤退补给中';
    if (state === 'engaging') {
      const tn = fleet?._lastTargetFleetId != null && nameOfFleet ? nameOfFleet(fleet._lastTargetFleetId) : null;
      return tn ? `攻击 ${tn}` : '交战中';
    }
    if (state === 'flaring') return '前往信标点';
    if (state === 'assembling') return '集结中';
    const stance = fleet?.stance || 'search';
    if (stance === 'defend') return '驻守警戒';
    if (stance === 'siege') return '攻坚推进';
    if (stance === 'fallback') return '撤退';
    return '索敌推进';
  })();
  // [V18-A · B-0] AI 战前计划 role 前缀（仅 planFactionBattle 写 _planRole 的 AI 舰队有；玩家/无计划舰队不受影响）
  const roleKey = fleet?._planRole as string | undefined;
  const roleLabel = roleKey ? (PLAN_ROLE_LABEL[roleKey] || '') : '';
  return roleLabel ? `[${roleLabel}] ${base}` : base;
}

/** 军议面板：战中改派门槛（准将 rank 8 以上可临机改派；以下只"接令"——部署阶段全员可派） */
export const REASSIGN_MIN_RANK = 8;

export function canReassignMission(factionRank: number | undefined, deployPhase: boolean): boolean {
  if (deployPhase) return true;
  return (factionRank ?? 0) >= REASSIGN_MIN_RANK;
}
