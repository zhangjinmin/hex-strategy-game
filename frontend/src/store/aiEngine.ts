/**
 * AI Engine — 战略AI与自动防御逻辑（v2 重构版）
 *
 * v2 改进点（对标银英4EX的AI威胁感）：
 * 1. 战力评估：跃迁前比较己方战力vs目标守军，劣势时不出击
 * 2. 集结行为：多支舰队先集结到前线节点，再一起进攻
 * 3. 战略优先级：优先攻击经济星球/首都/要塞，而非距离最近
 * 4. 回防增强：己方节点被攻击时附近2跳内idle舰队自动回防，首都优先
 * 5. 提督性格驱动：积极型更愿进攻，保守型更倾向防守
 *
 * 保持对外API不变（runAIStrategicTurn/runPlayerDefensiveAI签名相同）
 */
import type { StrategicFleet, FleetComposition } from '../types/game';
import { totalShips } from '../types/game';
import { AI_TREASURY_MINIMUM } from '../config/economy';

export interface AIEngineState {
  strategicNodes: any[];
  strategicFleets: StrategicFleet[];
  factionGold: { alliance: number; empire: number };
  /** v2 新增：提督数据（用于性格驱动AI行为），可选 */
  admirals?: any[];
}

/** 欧几里得距离 */
export function euclideanDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** BFS 检查从 fromNodeId 是否可通过己方/中立节点到达 toNodeId */
export function bfsReachable(
  nodes: any[],
  fromNodeId: number,
  toNodeId: number,
  factionId: number
): boolean {
  if (fromNodeId === toNodeId) return true;
  const visited = new Set<number>([fromNodeId]);
  const queue: number[] = [fromNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodes.find((n: any) => n.id === current);
    if (!node || !node.connections) continue;

    for (const nextId of node.connections) {
      if (visited.has(nextId)) continue;
      if (nextId === toNodeId) return true;

      const nextNode = nodes.find((n: any) => n.id === nextId);
      if (!nextNode) continue;
      if (nextNode.ownerFactionId !== factionId && nextNode.ownerFactionId !== 0) continue;

      visited.add(nextId);
      queue.push(nextId);
    }
  }
  return false;
}

// ========== v2 新增：战力评估 ==========

/** 舰种战力系数（与 battleResolver.ts AUTO_RESOLVE_DEFAULTS 保持一致） */
const SHIP_POWER_COEFF: Record<string, number> = {
  battleships: 4.0,
  fast_battleships: 3.2,
  cruisers: 2.5,
  destroyers: 1.5,
  carriers: 2.0,
  fighters: 1.0,
};

// ========== v2 新增：提督性格驱动 ==========

/** 提督性格类型 */
type AdmiralPersonality = 'aggressive' | 'cautious' | 'balanced';

/**
 * 根据提督的hiddenStats和tags判断性格类型
 * - aggressive：野心>70 或有'aggressive'标签 → 更愿意进攻，战力阈值降低
 * - cautious：义理>70 或有'cautious'标签 → 更倾向防守，战力阈值提高
 * - balanced：标准行为
 */
function getPersonality(admirals: any[] | undefined, commanderId: number): AdmiralPersonality {
  if (!admirals) return 'balanced';
  const adm = admirals.find(a => a.id === commanderId);
  if (!adm) return 'balanced';

  const tags: string[] = adm.tags || [];
  const ambition = adm.hiddenStats?.ambition ?? 50;
  const righteousness = adm.hiddenStats?.righteousness ?? 50;

  // 冒险标签优先级最高
  if (tags.includes('aggressive') || ambition > 70) return 'aggressive';
  // 谨慎标签次之
  if (tags.includes('cautious') || righteousness > 70) return 'cautious';
  return 'balanced';
}

/** 根据性格返回进攻战力比阈值 */
function getAttackThreshold(personality: AdmiralPersonality): number {
  switch (personality) {
    case 'aggressive': return 1.1; // 冒险型：更低阈值，更愿意出击
    case 'cautious':   return 1.5; // 谨慎型：更高阈值，需要更大优势
    default:           return 1.3; // 平衡型：标准
  }
}

/**
 * 快速估算舰队战力（简化版，用于AI决策）
 * 不依赖admiral详情，仅基于舰船数量+士气+补给
 * 与 battleResolver.calculatePower 的区别：省略统帅/科技/特技修正（AI不需要精确值）
 */
function quickEstimatePower(fleet: StrategicFleet, admirals?: any[]): number {
  const c: FleetComposition = fleet.composition;
  const shipCount = totalShips(c);
  if (shipCount === 0) return 0;

  const rawPower =
    c.battleships * SHIP_POWER_COEFF['battleships'] +
    c.fastBattleships * SHIP_POWER_COEFF['fast_battleships'] +
    c.cruisers * SHIP_POWER_COEFF['cruisers'] +
    c.destroyers * SHIP_POWER_COEFF['destroyers'] +
    c.carriers * SHIP_POWER_COEFF['carriers'] +
    c.fighters * SHIP_POWER_COEFF['fighters'];

  // 士气和补给影响（衰减而非加成，避免AI高估自己）
  const moraleFactor = Math.max(0.3, (fleet.morale || 100) / 100);
  const supplyFactor = Math.max(0.3, (fleet.supply || 100) / 100);

  // P1修复：补统帅修正（原估算不含指挥官能力 → AI 系统性低估名帅舰队，送人头；
  // 与 battleResolver 一致取 clamp 1.6 上限，并对未知指挥官保守取 1.0）
  const commander = admirals?.find(a => a.id === fleet.commanderId);
  let commandMod = 1.0;
  if (commander?.stats?.command) {
    commandMod = Math.min(1.6, Math.max(0.6, commander.stats.command / 50));
  }

  return rawPower * moraleFactor * supplyFactor * commandMod;
}

/**
 * 估算节点防御战力（守军舰队 + 要塞/城防加成）
 */
function estimateNodeDefense(
  node: any,
  allFleets: StrategicFleet[],
  defendingFactionId: number,
  admirals?: any[]
): number {
  const defenders = allFleets.filter(
    f => f.factionId === defendingFactionId &&
         f.currentNodeId === node.id &&
         f.status !== 'retreating'
  );

  let totalPower = defenders.reduce((sum, f) => sum + quickEstimatePower(f, admirals), 0);

  // 要塞/首都防御加成 ×2.0
  if (node.type === 'fortress' || node.type === 'capital') {
    totalPower *= 2.0;
  }

  // 城防HP加成（每点defenseHp = 0.1战力）
  totalPower += (node.defenseHp || 0) * 0.1;

  return totalPower;
}

// ========== v2 新增：战略优先级评分 ==========

/**
 * 目标节点战略价值评分（越高越值得攻击）
 * 评分 = 节点类型基础分 + 经济价值 - 距离惩罚
 */
function scoreTargetNode(node: any, distance: number): number {
  let score = 0;

  // 节点类型基础分
  if (node.type === 'capital') score += 1000;       // 首都：最高价值
  else if (node.type === 'fortress') score += 500;  // 要塞：高价值
  else if (node.type === 'resource') score += 200;  // 资源星：中价值
  else score += 50;                                  // 普通：低价值

  // 经济价值
  score += (node.economy || 0) * 2;

  // 距离惩罚（越远越不值得）
  score -= distance * 0.5;

  return Math.max(0, score);
}

// ========== v2 新增：集结逻辑 ==========

/**
 * 寻找最佳集结点
 * 条件：己方前线节点，距离目标最近，有己方舰队驻留
 */
function findAssemblyPoint(
  nodes: any[],
  fleets: StrategicFleet[],
  factionId: number,
  targetNodeId: number
): number | null {
  const targetNode = nodes.find((n: any) => n.id === targetNodeId);
  if (!targetNode) return null;

  // 己方前线节点（有连接到非己方节点）
  const frontierNodes = nodes.filter((n: any) => {
    if (n.ownerFactionId !== factionId) return false;
    const isFrontier = (n.connections || []).some((cid: number) => {
      const cn = nodes.find((nn: any) => nn.id === cid);
      return cn && cn.ownerFactionId !== factionId;
    });
    return isFrontier;
  });

  if (frontierNodes.length === 0) return null;

  // 选择距离目标最近的前线节点
  let best: { id: number; dist: number } | null = null;
  for (const node of frontierNodes) {
    const d = euclideanDistance(targetNode, node);
    if (!best || d < best.dist) best = { id: node.id, dist: d };
  }

  return best?.id ?? null;
}

// ========== 战略AI主函数（v2） ==========

/**
 * 执行一个阵营的战略AI回合（v2）
 *
 * 决策流程：
 * 1. 筛选idle舰队（排除空舰队）
 * 2. 对每支舰队，找所有可达敌方节点并按战略价值评分
 * 3. 评估己方战力 vs 目标守军战力
 *    - 战力比 > 1.3：直接进攻
 *    - 战力比 1.0~1.3：寻找友军联合（集结）
 *    - 战力比 < 1.0：不出击
 * 4. 防御预备：前线最后一支守军保留
 * 5. 经济约束：国库 < 500 休眠
 * 6. 费沙免战
 */
export function runAIStrategicTurn(
  state: AIEngineState,
  factionId: number,
  onWarpAI: (fleetId: number, targetNodeId: number) => void,
  excludeCommanderId?: number
) {
  const rawNodes = state.strategicNodes;
  const opponentId = factionId === 1 ? 2 : 1;

  // 经济约束（使用 economy.ts 统一常量；低于下限停止扩张）
  const treasury = factionId === 1 ? state.factionGold.alliance : state.factionGold.empire;
  if (treasury < AI_TREASURY_MINIMUM) return;

  const PHEZZAN_ID = 29;

  // 筛选可行动的idle舰队（排除空舰队；排除玩家亲自指挥的舰队，避免越权调动）
  const aiFleets = state.strategicFleets.filter(
    f => f.factionId === factionId &&
         f.status === 'idle' &&
         f.currentNodeId !== null &&
         f.currentNodeId >= 0 &&
         totalShips(f.composition) > 0 &&
         (excludeCommanderId === undefined || f.commanderId !== excludeCommanderId)
  );

  if (aiFleets.length === 0) return;

  // 记录本回合已下令的舰队（避免重复下令）
  const dispatchedFleetIds = new Set<number>();

  for (const fleet of aiFleets) {
    if (dispatchedFleetIds.has(fleet.id)) continue;
    // 每次迭代读取当前国库（跃迁会实时扣款，避免使用循环前的过期快照）
    const liveTreasury = factionId === 1 ? state.factionGold.alliance : state.factionGold.empire;
    if (liveTreasury < AI_TREASURY_MINIMUM) break;

    const cur = rawNodes.find((n: any) => n.id === fleet.currentNodeId);
    if (!cur) continue;

    // 防御预备：前线最后一支守军保留不动
    const isFrontier = (cur.connections || []).some((cid: number) => {
      const cn = rawNodes.find((n: any) => n.id === cid);
      return cn && cn.ownerFactionId !== factionId;
    });
    if (isFrontier) {
      const defendersHere = state.strategicFleets.filter(
        f2 => f2.id !== fleet.id &&
              f2.factionId === factionId &&
              f2.currentNodeId === cur.id &&
              f2.status === 'idle'
      );
      if (defendersHere.length === 0) continue;
    }

    // === v2 核心：目标选择 + 战力评估 ===

    // 收集所有可达敌方目标
    const candidates: { nodeId: number; score: number; dist: number; defensePower: number }[] = [];
    for (const node of rawNodes) {
      if (node.ownerFactionId === factionId) continue;
      if (node.id === fleet.currentNodeId) continue;
      if (node.id === PHEZZAN_ID) continue;
      // 首都/要塞暂时不直接攻击（需要集结后才能打）
      if ((node.type === 'capital' || node.type === 'fortress') && node.ownerFactionId === opponentId) continue;
      if (!bfsReachable(rawNodes, fleet.currentNodeId!, node.id, factionId)) continue;

      const dist = euclideanDistance(cur, node);
      const score = scoreTargetNode(node, dist);
      const defensePower = estimateNodeDefense(node, state.strategicFleets, node.ownerFactionId, state.admirals);

      candidates.push({ nodeId: node.id, score, dist, defensePower });
    }

    if (candidates.length === 0) continue;

    // 按战略价值排序（高分优先）
    candidates.sort((a, b) => b.score - a.score);

    const myPower = quickEstimatePower(fleet, state.admirals);

    // v2: 提督性格驱动进攻阈值
    const personality = getPersonality(state.admirals, fleet.commanderId);
    const attackThreshold = getAttackThreshold(personality);

    // 遍历候选目标，找第一个能打的
    for (const target of candidates) {
      // 战力比 = 己方战力 / 目标守军战力
      const ratio = target.defensePower > 0 ? myPower / target.defensePower : 99;

      if (ratio > attackThreshold) {
        // 战力优势足够，直接进攻
        onWarpAI(fleet.id, target.nodeId);
        dispatchedFleetIds.add(fleet.id);
        break;
      } else if (ratio >= 1.0) {
        // 战力接近，寻找友军联合进攻
        const allies = aiFleets.filter(
          f2 => f2.id !== fleet.id &&
                !dispatchedFleetIds.has(f2.id) &&
                f2.status === 'idle' &&
                f2.currentNodeId !== null &&
                f2.currentNodeId >= 0
        );

        // 找一支能到达同一目标的友军
        const supportingAlly = allies.find(ally => {
          if (totalShips(ally.composition) === 0) return false;
          return bfsReachable(rawNodes, ally.currentNodeId!, target.nodeId, factionId);
        });

        if (supportingAlly) {
          // 联合战力足够 → 一起进攻
          const combinedPower = myPower + quickEstimatePower(supportingAlly, state.admirals);
          const combinedRatio = target.defensePower > 0 ? combinedPower / target.defensePower : 99;
          if (combinedRatio > attackThreshold) {
            onWarpAI(fleet.id, target.nodeId);
            dispatchedFleetIds.add(fleet.id);
            // 友军也一起出动（跃迁到同一目标）
            const allyCur = rawNodes.find((n: any) => n.id === supportingAlly.currentNodeId);
            if (allyCur) {
              onWarpAI(supportingAlly.id, target.nodeId);
              dispatchedFleetIds.add(supportingAlly.id);
            }
            break;
          }
        }

        // 找不到友军或联合仍不够 → 尝试集结
        const assemblyPoint = findAssemblyPoint(rawNodes, state.strategicFleets, factionId, target.nodeId);
        if (assemblyPoint !== null && assemblyPoint !== fleet.currentNodeId) {
          // 跃迁到集结点等待友军
          onWarpAI(fleet.id, assemblyPoint);
          dispatchedFleetIds.add(fleet.id);
          break;
        }
        // 没有集结点 → 保持原位等待
      }
      // ratio < 1.0：战力不足，不进攻，检查下一个候选目标
    }
  }
}

// ========== 防御AI（v2 增强） ==========

/** 节点威胁等级 */
type ThreatLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * 评估节点威胁等级
 * - critical：首都受威胁
 * - high：要塞/经济星球受威胁
 * - medium：普通己方节点有敌方舰队逼近
 * - low：前线节点相邻敌方
 */
function assessThreatLevel(
  node: any,
  enemyFleets: StrategicFleet[],
  playerFactionId: number,
  nodes: any[]
): ThreatLevel {
  const CAPITAL_IDS: Record<number, number> = { 1: 14, 2: 56 };

  // 检查是否有敌方舰队正在跃迁到此节点或已到达
  const enemyHere = enemyFleets.some(
    ef => ef.warpTargetId === node.id || ef.currentNodeId === node.id
  );

  if (!enemyHere) {
    // 检查是否前线相邻敌方（仅相邻，无敌方舰队到达）
    const isFrontier = (node.connections || []).some((cid: number) => {
      const cn = nodes.find((n: any) => n.id === cid);
      return cn && cn.ownerFactionId !== playerFactionId && cn.ownerFactionId !== 0;
    });
    return isFrontier ? 'low' : 'low';
  }

  // 首都受威胁 = critical
  if (node.id === CAPITAL_IDS[playerFactionId]) return 'critical';
  // 要塞受威胁 = high
  if (node.type === 'fortress') return 'high';
  // 经济星球受威胁 = high
  if (node.type === 'resource' && (node.economy || 0) > 50) return 'high';
  // 普通节点受威胁 = medium
  return 'medium';
}

/**
 * 己方自动防御AI（v2 增强）
 *
 * v2 改进：
 * 1. 威胁分级：首都(critical) > 要塞/经济星(high) > 普通星(medium)
 * 2. 回防范围：critical威胁 → 3跳内所有idle舰队回防；high → 2跳；medium → 1跳
 * 3. 首都守军：首都至少保留1支舰队
 * 4. 优先级排序：先处理critical，再high，最后medium
 */
export function runPlayerDefensiveAI(
  state: AIEngineState,
  playerFactionId: number,
  onWarpAI: (fleetId: number, targetNodeId: number) => void,
  excludeCommanderId?: number
) {
  const pfId = playerFactionId;
  const rawNodes = state.strategicNodes;

  const idleFriendlies = state.strategicFleets.filter(
    f => f.factionId === pfId &&
         f.status === 'idle' &&
         f.currentNodeId !== null &&
         f.currentNodeId >= 0 &&
         totalShips(f.composition) > 0 &&
         (excludeCommanderId === undefined || f.commanderId !== excludeCommanderId)
  );
  if (idleFriendlies.length === 0) return;

  const enemyFleets = state.strategicFleets.filter(
    f => f.factionId !== pfId &&
         (f.status === ('warping' as any) || f.status === 'idle')
  );
  if (enemyFleets.length === 0) return;

  // 首都节点
  const CAPITAL_IDS: Record<number, number> = { 1: 14, 2: 56 };
  const capitalNodeId = CAPITAL_IDS[pfId];
  const capitalNode = rawNodes.find((n: any) => n.id === capitalNodeId);

  // 收集所有受威胁的己方节点
  const threatenedNodes: { node: any; level: ThreatLevel; enemyCount: number }[] = [];

  for (const node of rawNodes) {
    if (node.ownerFactionId !== pfId) continue;

    // 检查是否有敌方舰队正在攻击或逼近此节点
    const enemyTargeting = enemyFleets.filter(
      ef => ef.warpTargetId === node.id || ef.currentNodeId === node.id
    );

    if (enemyTargeting.length === 0) continue;

    const level = assessThreatLevel(node, enemyFleets, pfId, rawNodes);
    threatenedNodes.push({ node, level, enemyCount: enemyTargeting.length });
  }

  if (threatenedNodes.length === 0) return;

  // 按威胁等级排序：critical > high > medium > low
  const levelPriority: Record<ThreatLevel, number> = {
    critical: 0, high: 1, medium: 2, low: 3,
  };
  threatenedNodes.sort((a, b) => levelPriority[a.level] - levelPriority[b.level]);

  // 回防跳数限制
  const maxHopsByLevel: Record<ThreatLevel, number> = {
    critical: 3,  // 首都受威胁：3跳内所有舰队回防
    high: 2,      // 要塞/经济星：2跳
    medium: 1,    // 普通星：1跳
    low: 1,
  };

  // 最大回防调动数（避免一次tick调动太多）
  const MAX_DEFENSIVE_MOVES = 3;
  let movesMade = 0;
  const dispatchedFleetIds = new Set<number>();

  for (const threat of threatenedNodes) {
    if (movesMade >= MAX_DEFENSIVE_MOVES) break;

    const maxHops = maxHopsByLevel[threat.level];
    const targetNodeId = threat.node.id;

    // 找到maxHops跳内可达目标节点的idle舰队
    const candidates = idleFriendlies.filter(fleet => {
      if (dispatchedFleetIds.has(fleet.id)) return false;
      if (fleet.currentNodeId === targetNodeId) return false; // 已在目标节点

      // 首都守军保留逻辑
      if (capitalNode && fleet.currentNodeId === capitalNodeId) {
        const capitalDefenders = idleFriendlies.filter(
          f => f.currentNodeId === capitalNodeId && !dispatchedFleetIds.has(f.id)
        );
        // 首都守军≤1支时不调动（除非首都本身就是被攻击目标）
        if (capitalDefenders.length <= 1 && targetNodeId !== capitalNodeId) return false;
      }

      // BFS检查可达性（maxHops跳内）
      return bfsReachableWithinHops(rawNodes, fleet.currentNodeId!, targetNodeId, pfId, maxHops);
    });

    // 按距离排序，最近的先回防
    candidates.sort((a, b) => {
      const curA = rawNodes.find((n: any) => n.id === a.currentNodeId);
      const curB = rawNodes.find((n: any) => n.id === b.currentNodeId);
      if (!curA || !curB) return 0;
      return euclideanDistance(curA, threat.node) - euclideanDistance(curB, threat.node);
    });

    // 根据威胁等级决定调动几支舰队
    const fleetsToDispatch = threat.level === 'critical' ? Math.min(candidates.length, 3)
                           : threat.level === 'high' ? Math.min(candidates.length, 2)
                           : 1;

    for (let i = 0; i < fleetsToDispatch && movesMade < MAX_DEFENSIVE_MOVES; i++) {
      const fleet = candidates[i];
      if (!fleet) break;
      onWarpAI(fleet.id, targetNodeId);
      dispatchedFleetIds.add(fleet.id);
      movesMade++;
    }
  }
}

// ========== v2 新增：BFS跳数限制版 ==========

/**
 * BFS检查从fromNodeId到toNodeId是否在maxHops跳内可达
 * 只经过己方/中立节点
 */
function bfsReachableWithinHops(
  nodes: any[],
  fromNodeId: number,
  toNodeId: number,
  factionId: number,
  maxHops: number
): boolean {
  if (fromNodeId === toNodeId) return true;

  const visited = new Set<number>([fromNodeId]);
  // 队列项：{ nodeId, hops }
  const queue: { nodeId: number; hops: number }[] = [{ nodeId: fromNodeId, hops: 0 }];

  while (queue.length > 0) {
    const { nodeId, hops } = queue.shift()!;
    if (hops >= maxHops) continue;

    const node = nodes.find((n: any) => n.id === nodeId);
    if (!node || !node.connections) continue;

    for (const nextId of node.connections) {
      if (visited.has(nextId)) continue;
      if (nextId === toNodeId) return true;

      const nextNode = nodes.find((n: any) => n.id === nextId);
      if (!nextNode) continue;
      // 回防路径允许经过己方节点和中立节点
      if (nextNode.ownerFactionId !== factionId && nextNode.ownerFactionId !== 0) continue;

      visited.add(nextId);
      queue.push({ nodeId: nextId, hops: hops + 1 });
    }
  }
  return false;
}
