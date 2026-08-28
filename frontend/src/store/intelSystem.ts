/**
 * 情报战轻量版
 * - 每个星系有情报等级(0-100)，决定可见度
 * - 花金币提高情报等级
 * - AI也有情报等级，影响它能看到你多少信息
 * - 情报等级高→看到敌方舰队位置；情报等级低→只能看到"这里有敌人"
 */
import { ref, computed } from 'vue';

export type IntelVisibility = 'hidden' | 'presence' | 'fleet_count' | 'full';

export interface IntelNode {
  nodeId: number;
  level: number;        // 0-100
  lastUpdate: number;   // tick
  decayRate: number;    // 每tick衰减
}

const intelCosts = [
  { level: 10, cost: 50, label: '基础侦察' },
  { level: 25, cost: 100, label: '深入调查' },
  { level: 50, cost: 250, label: '全面监视' },
  { level: 80, cost: 500, label: '渗透网络' },
  { level: 100, cost: 1000, label: '完全掌控' },
];

const visibilityThresholds: Array<{ min: number; visibility: IntelVisibility }> = [
  { min: 0, visibility: 'hidden' },       // 0: 完全不知道
  { min: 20, visibility: 'presence' },    // 20: 知道有敌人
  { min: 40, visibility: 'fleet_count' }, // 40: 知道舰队数量
  { min: 70, visibility: 'full' },        // 70: 完全可见
];

export function useIntelSystem() {
  const intelNodes = ref<Map<number, IntelNode>>(new Map());

  function initIntel(nodeId: number, startingLevel: number = 10) {
    if (!intelNodes.value.has(nodeId)) {
      intelNodes.value.set(nodeId, {
        nodeId, level: startingLevel, lastUpdate: 0, decayRate: 1,
      });
    }
  }

  function investIntel(nodeId: number, gold: number): { added: number; cost: number } {
    const node = intelNodes.value.get(nodeId);
    if (!node) return { added: 0, cost: 0 };
    const added = Math.floor(gold / 5); // 1金币=0.2情报值
    node.level = Math.min(100, node.level + added);
    node.lastUpdate = Date.now();
    return { added, cost: gold };
  }

  function getVisibility(nodeId: number): IntelVisibility {
    const node = intelNodes.value.get(nodeId);
    if (!node) return 'hidden';
    for (const t of visibilityThresholds) {
      if (node.level >= t.min) return t.visibility;
    }
    return 'hidden';
  }

  function decayIntel(ticksElapsed: number) {
    intelNodes.value.forEach(node => {
      node.level = Math.max(0, node.level - node.decayRate * ticksElapsed * 0.5);
    });
  }

  // AI 情报：AI对玩家的可见度，随难度变化
  function getAIVisibility(difficulty: string): IntelVisibility {
    return difficulty === 'hard' ? 'fleet_count' : difficulty === 'easy' ? 'presence' : 'fleet_count';
  }

  return { intelNodes, intelCosts, initIntel, investIntel, getVisibility, decayIntel, getAIVisibility };
}
