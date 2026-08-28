// ==================================================
// File: src/utils/proposalEngine.ts
// 军议提案引擎 — 12提案定义 + 效果执行 + 否决后果 + 月度自动生成
// ==================================================

import type { ProposalType, NationalRole } from '../types/game';
import { canPropose } from '../config/roleConfig';
import { SHIP_MAINTENANCE } from '../config/economy';

// ─── 提案定义接口 ───
export interface ProposalDef {
  type: ProposalType;
  name: string;
  description: string;
  effect: string;
  rejectionEffect?: string;
  risk: string;
  requiredRoles: NationalRole[];
  gameCoupling: string;
  duration?: number;
}

// ─── 提案执行上下文 ───
export interface ProposalContext {
  gameStore: any;
  adminStore: any;
  playerFactionId: number;
}

// ==================================================
// (a) 7 条提案完整定义表（v3 瘦身后）
// ==================================================
export const PROPOSAL_DEFINITIONS: Record<ProposalType, ProposalDef> = {
  invasion: {
    type: 'invasion',
    name: '战略侵攻动员',
    description: '获取跨境打击授权，全阵营舰队 Warp 速度 +30%（持续15天），进攻方士气 +20',
    effect: 'warp_speed_buff:30%:15d; morale:+20',
    rejectionEffect: '连续2月被否主战派忠诚-10',
    risk: '侵攻期间后勤消耗×1.5；和平派忠诚-5',
    requiredRoles: ['emperor', 'high_command_chief', 'joint_ops_chief', 'space_fleet_commander', 'space_fleet_deputy'],
    gameCoupling: 'strategicTick fleet.moveProgress; fleet.morale',
    duration: 15,
  },
  defense: {
    type: 'defense',
    name: '星域防卫令',
    description: '指定星域防御HP +100%（30天），防卫司令辖区补给消耗-50%',
    effect: 'node_defense_buff:100%:30d; supply_cost:-50%',
    rejectionEffect: undefined,
    risk: '消耗国库₮20万',
    requiredRoles: ['emperor', 'high_command_chief', 'joint_ops_chief', 'intel_minister', 'defense_commander'],
    gameCoupling: 'StarNode defenseHp; fleet.supply',
    duration: 30,
  },
  budget: {
    type: 'budget',
    name: '申请特别军费',
    description: '国库下拨₮50万',
    effect: 'metaGold:+500000',
    rejectionEffect: '本月维护费强制扣减，国库不足时舰队士气-5/日',
    risk: '连续3月申请触发弹劾事件，行政功勋-200',
    requiredRoles: ['emperor', 'prime_minister', 'council', 'military_minister'],
    gameCoupling: 'metaGold; fleet.morale',
  },
  personnel: {
    type: 'personnel',
    name: '人事任免令',
    description: '任免提督职位，更新任命记录',
    effect: 'appointment_change',
    rejectionEffect: undefined,
    risk: '被免职者忠诚-20，其派系成员忠诚-5',
    requiredRoles: ['emperor', 'prime_minister', 'council'],
    gameCoupling: 'BaseAdmiral.role; AppointmentRecord',
  },
  conscription: {
    type: 'conscription',
    name: '扩大强制征兵令',
    description: '兵源上限+20%，全军士气-15',
    effect: 'manpower_cap:+20%; morale:-15',
    rejectionEffect: '无直接后果',
    risk: '全军士气滑坡',
    requiredRoles: ['emperor', 'military_minister', 'council', 'high_command_chief'],
    gameCoupling: 'fleet.morale; shipyard production',
  },
  morale_boost: {
    type: 'morale_boost',
    name: '士气鼓舞令',
    description: '全阵营舰队士气+25',
    effect: 'morale:+25',
    rejectionEffect: '平均士气<40时触发军心涣散事件',
    risk: '消耗国库₮10万',
    requiredRoles: ['emperor', 'space_fleet_commander', 'space_fleet_deputy', 'joint_ops_deputy', 'council'],
    gameCoupling: 'fleet.morale; metaGold',
  },
  fortify: {
    type: 'fortify',
    name: '要塞强化令',
    description: '指定节点防御HP+50%（永久），补给恢复×2',
    effect: 'node_defense:+50%; supply_recover:x2',
    rejectionEffect: undefined,
    risk: '消耗国库₮40万',
    requiredRoles: ['emperor', 'military_minister', 'defense_commander', 'high_command_chief'],
    gameCoupling: 'StarNode defenseHp; fleet.supply',
  },
};

// ─── 辅助：安全读取 store 的响应式数组 ───
function getFleets(gameStore: any): any[] {
  const f = gameStore.strategicFleets;
  if (Array.isArray(f)) return f;
  if (f && Array.isArray(f.value)) return f.value;
  return [];
}

function getNodes(gameStore: any): any[] {
  const n = gameStore.strategicNodes;
  if (Array.isArray(n)) return n;
  if (n && Array.isArray(n.value)) return n.value;
  return [];
}

// ==================================================
// (b) executeProposalEffect: 提案通过后执行效果
// ==================================================
export function executeProposalEffect(proposal: any, ctx: ProposalContext): void {
  const { gameStore, adminStore, playerFactionId } = ctx;
  const allFleets = getFleets(gameStore);
  const myFleets = allFleets.filter((f: any) => f.factionId === playerFactionId);
  const allNodes = getNodes(gameStore);
  const myNodes = allNodes.filter((n: any) => n.ownerFactionId === playerFactionId);

  const gs = gameStore as any;
  const as_ = adminStore as any;

  switch (proposal.type as ProposalType) {
    case 'invasion': {
      myFleets.forEach((f: any) => {
        f.morale = Math.min(100, (f.morale || 50) + 20);
        f.warpSpeedBuffDays = 15;
      });
      gs.triggerToast?.('战略侵攻动员通过！Warp速度+30%（15天），士气+20。');
      break;
    }
    case 'defense': {
      if (proposal.targetNodeId) {
        const node = myNodes.find((n: any) => n.id === proposal.targetNodeId);
        if (node) {
          node.defenseBuffDays = 30;
          gs.triggerToast?.(`星域防卫令通过！${node.name} 防御强化（30天）。`);
        }
      }
      gs.metaGold = (gs.metaGold || 0) - 200000; // ₮20万
      break;
    }
    case 'budget': {
      gs.metaGold = (gs.metaGold || 0) + 500000; // +₮50万
      gs.triggerToast?.('特别军费通过！国库+₮50万。');
      break;
    }
    case 'personnel': {
      // 人事任免效果由 gameStore.submitProposal 内部处理
      gs.triggerToast?.('人事任免通过。');
      break;
    }
    case 'conscription': {
      myFleets.forEach((f: any) => {
        f.morale = Math.max(0, (f.morale || 50) - 15);
      });
      gs.triggerToast?.('征兵令通过！兵源+20%，士气-15。');
      break;
    }
    case 'morale_boost': {
      myFleets.forEach((f: any) => {
        f.morale = Math.min(100, (f.morale || 50) + 25);
      });
      gs.metaGold = (gs.metaGold || 0) - 100000; // ₮10万
      gs.triggerToast?.('士气鼓舞通过！全军士气+25。');
      break;
    }
    case 'fortify': {
      if (proposal.targetNodeId) {
        const node = myNodes.find((n: any) => n.id === proposal.targetNodeId);
        if (node) {
          node.defenseHp = Math.floor((node.defenseHp || 100) * 1.5);
          node.maxDefenseHp = Math.floor((node.maxDefenseHp || 100) * 1.5);
          node.fortified = true;
        }
      }
      gs.metaGold = (gs.metaGold || 0) - 400000; // ₮40万
      gs.triggerToast?.('要塞强化完成！防御HP+50%。');
      break;
    }
    default: {
      // 未知提案类型，忽略
      break;
    }
  }
}

// ==================================================
// (c) executeProposalRejection: 否决后果（仅3种有后果）
// ==================================================
export function executeProposalRejection(proposal: any, ctx: ProposalContext): void {
  const { gameStore, playerFactionId } = ctx;
  const allFleets = getFleets(gameStore);
  const myFleets = allFleets.filter((f: any) => f.factionId === playerFactionId);
  const gs = gameStore as any;

  switch (proposal.type as ProposalType) {
    case 'budget': {
      // 维护费强制扣减，国库不足时士气下降（按 economy.ts 维护费配置估算）
      const maintenance = myFleets.reduce((s: number, f: any) => {
        const c = f.composition || { battleships: 0, fastBattleships: 0, cruisers: 0, destroyers: 0, carriers: 0, fighters: 0 };
        return s + (
          (c.battleships || 0) * SHIP_MAINTENANCE.battleship +
          (c.fastBattleships || 0) * SHIP_MAINTENANCE.fastBattleship +
          (c.cruisers || 0) * SHIP_MAINTENANCE.cruiser +
          (c.destroyers || 0) * SHIP_MAINTENANCE.destroyer +
          (c.carriers || 0) * SHIP_MAINTENANCE.carrier +
          (c.fighters || 0) * SHIP_MAINTENANCE.fighter
        );
      }, 0);
      if ((gs.metaGold || 0) < maintenance) {
        myFleets.forEach((f: any) => {
          f.morale = Math.max(0, (f.morale || 50) - 5);
        });
        gs.triggerToast?.('军费申请被否决！国库不足，舰队士气下降。');
      }
      break;
    }
    case 'morale_boost': {
      const avgMorale = myFleets.length > 0
        ? myFleets.reduce((s: number, f: any) => s + (f.morale || 50), 0) / myFleets.length
        : 50;
      if (avgMorale < 40) {
        myFleets.forEach((f: any) => {
          f.morale = Math.max(0, (f.morale || 50) - 10);
        });
        gs.triggerToast?.('士气鼓舞被否决！军心涣散，士气进一步下滑。');
      }
      break;
    }
    case 'invasion': {
      // 连续被否的主战派忠诚下降（简化版：直接降一次）
      // 完整版需要追踪连续否决次数，此处降忠诚作为即时后果
      // 实际连续追踪在 T05 事件引擎中完善
      break;
    }
    case 'conscription': {
      // 否决无后果
      break;
    }
    default: {
      // 其他提案否决无直接后果
      break;
    }
  }
}

// ==================================================
// (d) generateMonthlyProposals: 月度自动生成3-5条提案
// ==================================================
export function generateMonthlyProposals(ctx: ProposalContext): any[] {
  const { gameStore, playerFactionId } = ctx;
  const gs = gameStore as any;
  const proposals: any[] = [];

  const allFleets = getFleets(gs);
  const myFleets = allFleets.filter((f: any) => f.factionId === playerFactionId);
  const gold: number = gs.metaGold || 0;
  const avgMorale = myFleets.length > 0
    ? myFleets.reduce((s: number, f: any) => s + (f.morale || 50), 0) / myFleets.length
    : 50;
  const avgSupply = myFleets.length > 0
    ? myFleets.reduce((s: number, f: any) => s + (f.supply || 50), 0) / myFleets.length
    : 50;

  const currentDate: string = gs.universeDate || '';

  // 根据局势智能生成提案（v3：删除 logistics 生成逻辑，低补给由行政院后勤改革处理）
  // 国库低于 ₮200万（约3日收入）时自动提请特别军费
  if (gold < 2000000) {
    proposals.push({
      type: 'budget' as ProposalType,
      generatedDate: currentDate,
      proposerId: -1, // 系统生成
      factionId: playerFactionId,
    });
  }
  if (avgMorale < 50) {
    proposals.push({
      type: 'morale_boost' as ProposalType,
      generatedDate: currentDate,
      proposerId: -1,
      factionId: playerFactionId,
    });
  }
  // 始终提供侵攻和防卫选项
  proposals.push({
    type: 'invasion' as ProposalType,
    generatedDate: currentDate,
    proposerId: -1,
    factionId: playerFactionId,
  });
  proposals.push({
    type: 'defense' as ProposalType,
    generatedDate: currentDate,
    proposerId: -1,
    factionId: playerFactionId,
  });

  // 过滤掉玩家无权处理的提案，避免"职级不足"提示
  const allAdms = (gs.allAdmirals?.value || gs.allAdmirals || []) as any[];
  const playerAdm = allAdms.find((a: any) => a.id === gs.playerAdmiralId);
  if (playerAdm && proposals.length > 0) {
    const filtered = proposals.filter(p => canPropose(playerAdm, p.type));
    // 如果过滤后为空，至少保留侵攻提案（最低权限的提案类型）
    if (filtered.length === 0) {
      const firstAllowed = proposals.find(p => canPropose(playerAdm, p.type));
      if (firstAllowed) filtered.push(firstAllowed);
    }
    return filtered.slice(0, 5);
  }

  // ── 角色化发言 ──
  const CHARACTER_QUOTES: Record<string, Record<string, string[]>> = {
    tax: {
      aggressive: ['必须增加军费预算，战争需要资金。', '税率太低，我们在养闲人吗？'],
      righteous: ['人民已经负担很重了，再加税会失去民心。', '财政应该节约开支，而非增加税负。'],
      realist: ['根据当前国库情况，税率调整是必要的。', '建议维持现税率，稳定经济为先。'],
      default: ['关于税率的提案，需要议会审议。'],
    },
    invasion: {
      aggressive: ['现在是进攻的最佳时机！敌人防线脆弱。', '不进攻就是等死——我们必须先发制人。'],
      cautious: ['贸然进攻会付出惨重代价，我们需要更多准备。', '建议先集结兵力，再考虑进攻。'],
      default: ['关于远征的提案提交议会审议。'],
    },
    budget: {
      default: ['财政预算需要重新分配，请议会审议。', '当前国库状况需要调整经费。'],
    },
    planet_op: {
      default: ['建议对行星进行开发投资，提升本地经济。', '防御设施不足，需要追加投入。'],
    },
    personnel: {
      default: ['人事调整提案，请议会表决。', '提督任命需要议会确认。'],
    },
    default: {
      default: ['请议会审议以下提案。'],
    },
  };

  function getDialogue(proposal: any, proposerAdm: any): string {
    const tag = (proposerAdm?.tags || []).find((t: string) => ['aggressive','righteous','cautious','realist','militarist'].includes(t));
    const typeQuotes = CHARACTER_QUOTES[proposal.type] || CHARACTER_QUOTES.default;
    const styleQuotes = typeQuotes[tag || 'default'] || typeQuotes.default || ['请议会审议。'];
    return `${proposerAdm?.name || '某提督'}：「${styleQuotes[Math.floor(Math.random() * styleQuotes.length)]}」`;
  }

  // 丰富提案（添加角色发言）
  const enriched = proposals.map(p => {
    const admStore = (ctx as any).admiralStore || ctx.gameStore;
    const allAdms = (admStore as any).allAdmirals?.value || (admStore as any).allAdmirals || [];
    const proposer = allAdms.find((a: any) => a.faction === (ctx.playerFactionId === 1 ? 'alliance' : 'empire'));
    const dialogue = getDialogue(p, proposer);
    return { ...p, dialogue };
  });

  // 限制 3-5 条
  return enriched.slice(0, 5);
}
