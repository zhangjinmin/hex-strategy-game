import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { admiralsData } from '../config/admiralsData';
import type { Admiral, BaseAdmiral } from '../config/admiralsData';
import { Proposal, ProposalType } from '../types/game';
import type { PersonalityTag, AbilityTag } from '../types/game';
import {
  POLITICAL_VOTE_COEFFICIENTS,
  PERSONALITY_MODIFIERS,
  ROLE_FITNESS_MAP,
  ROLE_VOTE_INFLUENCE,
  calculateTagCompatibility,
  getTagsByCategory,
  isPoliticalTag,
} from '../config/tagConfig';

export const useAdmiralStore = defineStore('admiral', () => {
  // 所有提督数据（响应式）
  const admirals = ref<BaseAdmiral[]>(JSON.parse(JSON.stringify(admiralsData)));

  // 获取提督 by id
  const getAdmiralById = computed(() => {
    return (id: number) => admirals.value.find(a => a.id === id);
  });

  // 获取阵营所有提督
  const getAdmiralsByFaction = computed(() => {
    return (faction: 'empire' | 'alliance') => admirals.value.filter(a => a.faction === faction);
  });

  // 获取某星系的提督
  const getAdmiralsByNode = computed(() => {
    return (nodeId: number) => admirals.value.filter(a => a.currentNodeId === nodeId);
  });

  // 获取某舰队的提督
  const getAdmiralByFleet = computed(() => {
    return (fleetId: number) => admirals.value.find(a => a.assignedFleetId === fleetId);
  });

  // 提督移动（更新位置）
  function moveAdmiral(admiralId: number, nodeId: number | null) {
    const adm = admirals.value.find(a => a.id === admiralId);
    if (adm) {
      adm.currentNodeId = nodeId;
    }
  }

  // 提督分配舰队
  function assignFleet(admiralId: number, fleetId: number | null) {
    const adm = admirals.value.find(a => a.id === admiralId);
    if (adm) {
      adm.assignedFleetId = fleetId;
    }
  }

  // 提督受伤
  function woundAdmiral(admiralId: number, severity: number) {
    const adm = admirals.value.find(a => a.id === admiralId);
    if (adm) {
      adm.state = 'wounded';
      adm.injury = {
        isInjured: true,
        severity,
        recoveryTicks: Math.ceil(severity * 2) // 简单恢复公式
      };
    }
  }

  // 提督恢复（每tick调用）
  function processInjuryRecovery(ticks: number = 1) {
    admirals.value.forEach(adm => {
      if (!adm.injury || !adm.injury.isInjured) return;
      if (adm.injury.recoveryTicks > 0) {
        adm.injury.recoveryTicks -= ticks;
        if (adm.injury.recoveryTicks <= 0) {
          adm.injury = { isInjured: false, severity: 0, recoveryTicks: 0 };
          adm.state = 'idle';
        }
      }
    });
  }

  // 计算提案成功率（基于 tags 标签驱动）
  function calculateProposalSuccess(admiralId: number, playerAdmiralId: number): number {
    const adm = admirals.value.find(a => a.id === admiralId);
    const player = admirals.value.find(a => a.id === playerAdmiralId);
    if (!adm || !player) return 50;

    const proposerTags = adm.tags || [];
    const playerTags = player.tags || [];

    // 基础值 50
    let score = 50;

    // 1. 人格修正：遍历 proposer.tags 的人格标签，累加 proposalMod
    const personalityTags = getTagsByCategory(proposerTags, 'personality');
    for (const tag of personalityTags) {
      const mod = PERSONALITY_MODIFIERS[tag as PersonalityTag];
      if (mod) {
        score += mod.proposalMod;
      }
    }

    // 2. 标签兼容性：proposer 与 player 的标签兼容性 (-20 ~ +20)
    score += calculateTagCompatibility(proposerTags, playerTags);

    // 3. 职位适配度：检查 proposer 的能力标签是否匹配当前职位
    const abilityTags = getTagsByCategory(proposerTags, 'ability') as AbilityTag[];
    const admRole = adm.role as string;
    for (const tag of abilityTags) {
      const fittedRoles = ROLE_FITNESS_MAP[tag];
      if (fittedRoles) {
        if (fittedRoles.includes(adm.role)) {
          score += 10;  // 适配 +10
        } else {
          score -= 10;  // 不适配 -10
        }
      }
    }

    // 4. 随机扰动 (±10)
    score += (Math.random() * 20 - 10);

    // clamp 到 5-95
    return Math.min(95, Math.max(5, Math.round(score)));
  }


  // 核心：基于 tags 标签的 AI 投票算法
  function calculateAIVote(voterId: number, proposal: Proposal, proposerId: number): boolean {
    const voter = admirals.value.find(a => a.id === voterId);
    const proposer = admirals.value.find(a => a.id === proposerId);

    if (!voter || !proposer) return false;

    const voterTags = voter.tags || [];
    const proposerTags = proposer.tags || [];
    const proposalType = proposal.type as ProposalType;

    // 基础值 50，及格线 60
    let score = 50;

    // 1. 政治标签系数：遍历 voter.tags 中的政治标签，查 POLITICAL_VOTE_COEFFICIENTS[tag][proposalType] 累加
    let politicalSum = 0;
    for (const tag of voterTags) {
      if (isPoliticalTag(tag)) {
        const coef = POLITICAL_VOTE_COEFFICIENTS[tag]?.[proposalType];
        if (coef !== undefined) {
          politicalSum += coef;
        }
      }
    }
    score += politicalSum * 30;  // 政治系数 ×30

    // 2. 标签兼容性：voter 与 proposer 的标签兼容性 (-20 ~ +20)
    score += calculateTagCompatibility(voterTags, proposerTags);

    // 3. 人格修正：遍历 voter.tags 的人格标签，查 PERSONALITY_MODIFIERS[tag].proposalMod 累加
    const voterPersonalityTags = getTagsByCategory(voterTags, 'personality');
    for (const tag of voterPersonalityTags) {
      const mod = PERSONALITY_MODIFIERS[tag as PersonalityTag];
      if (mod) {
        score += mod.proposalMod;
      }
    }

    // 4. 职务影响（保留现有逻辑）：从 ROLE_VOTE_INFLUENCE 查询
    const voterRole = voter.role as string;
    const roleInfluence = ROLE_VOTE_INFLUENCE[voterRole]?.[proposalType];
    if (roleInfluence !== undefined) {
      score += roleInfluence;
    }

    // 5. budget 特殊处理：提案人投自己 +100
    if (proposalType === 'budget' && voterId === proposerId) {
      score += 100;
    }

    // 6. 随机扰动 (±10)
    score += (Math.random() * 20 - 10);

    return score >= 60;  // 达到 60 分即投赞成票
  }




  return {
    admirals,
    getAdmiralById,
    getAdmiralsByFaction,
    getAdmiralsByNode,
    getAdmiralByFleet,
    moveAdmiral,
    assignFleet,
    woundAdmiral,
    processInjuryRecovery,
    calculateProposalSuccess,
    calculateAIVote,
  };
});

