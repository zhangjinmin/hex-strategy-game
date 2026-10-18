/**
 * BattleTransientFields — 战斗运行时瞬态字段黑名单（存档序列化清洗 · 纯函数）
 *
 * W1 指令权威模型（retreatState/directOrder/attackState/_stall 等）与 W2 迷雾情报
 * 档案字段都是**战场运行时**状态，不得污染存档（build/HexFront_Saves.json 往返）：
 *   · 存档序列化（gameStore.saveToSlot / createNewSlot）用 battleTransientJsonReplacer 剥离；
 *   · 读档（loadFromSlot）用 stripBattleTransientFields 安全缺省（旧档已被污染时兜底）。
 */

/** 战斗瞬态字段黑名单（fleet / faction 对象上；键名精确匹配） */
export const BATTLE_TRANSIENT_FIELDS: readonly string[] = [
  // W1 指令权威 / 撤退三态 / 停滞看门狗
  'directOrder', 'attackState', 'retreatState', '_retreatTier',
  '_stall', '_stallTarget', '_directJustIssued', '_intentLabel', '_combatControl',
  'directOrderAccepted',
  // W1/W2 迷雾情报与可靠航迹
  '_trackReliable', '_identifiedByTeams', '_revealedByFireAt', '_revealedByFireToTeams',
  '_intelContactState', '_intelDisplayMode', '_intelLastKnown', '_scoutReports',
  // W2 侦察分队运行时（阵营级）
  '_lastScoutContactAt', '_scoutCooldownUntil', '_intelArchive',
  // [v67 阶段A] 战斗距离阶段状态（四阶段机读态；阈值缓存为场景级、非 JSON 键，不登记）
  '_phaseState',
  // [v68 阶段B] 舰载机编队运行时（fighterGroups/fighterDots 为场景级 Map，不在此表）
  '_returnUntil',
  // [v70/v71] 掉头格位反转状态（战局重开必须复位，否则首局翻转态污染次局阵型）
  '_slotFlip',
  // [v71] reform 起始时的阵面朝向（SLOT_FLIP 的 90° 判据比较基准）
  '_reformFromFacing',
  // [v73] 紧凑转收拢系数（0=展开 / 1=完全收拢；战局重开必须复位）
  '_compactTurn',
  // [v99] 距离保持三态（StandoffOrder）的滞回记忆、目标 id 与逐帧倒车标志
  '_standoffKind', '_standoffTargetId', '_standoffBacking',
  // [v99] 放弃包抄后的"强制转头"闩锁（转回来之前一直有效，跨战局必须复位）
  '_reorientFacing', '_reorientSince',
];

const TRANSIENT_SET: ReadonlySet<string> = new Set(BATTLE_TRANSIENT_FIELDS);

/** JSON.stringify 的 replacer：序列化时剥离战斗瞬态字段（存档不污染） */
export function battleTransientJsonReplacer(key: string, value: unknown): unknown {
  if (TRANSIENT_SET.has(key)) return undefined;
  return value;
}

/** 深拷贝并剥离战斗瞬态字段（读档时对旧污染档安全缺省） */
export function stripBattleTransientFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripBattleTransientFields(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TRANSIENT_SET.has(k)) continue;
      out[k] = stripBattleTransientFields(v);
    }
    return out as unknown as T;
  }
  return value;
}
