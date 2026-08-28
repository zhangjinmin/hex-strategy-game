/**
 * 随机事件系统 — 战略层每日事件引擎
 * 
 * 设计原则：
 * - DAILY_EVENT_CHANCE 控制每天事件触发的总体概率
 * - 冷却机制防止同事件连续触发
 * - 事件配置与执行逻辑分离
 */

import { DAILY_EVENT_CHANCE, TICKS_PER_DAY } from './balance';

/** 剧本绑定事件：按日期/条件触发 */
export interface ScenarioEvent {
  id: string;
  scenarioId: string;
  title: string;
  description: string;
  triggerDate: string;    // '795.06.01' 或 ''
  triggerCondition?: string; // 'nodeOwned:14' 或 ''
  choices: { text: string; effect: string }[];
}

export const SCENARIO_EVENTS: ScenarioEvent[] = [
  // 亚斯提前夜 (795)
  { id: 'astarte_battle', scenarioId: 'astarte_eve', title: '亚斯提星域会战', description: '莱因哈特率领帝国舰队与同盟第2、4、6舰队在亚斯提星域爆发会战。杨威利中尉以第2舰队参谋身份参战。', triggerDate: '795.04.01', choices: [{ text: '以帝国身份参战', effect: 'forceBattle:astarte' }, { text: '以同盟身份参战', effect: 'forceBattle:astarte' }] },
  { id: 'yang_emergence', scenarioId: 'astarte_eve', title: '杨威利初露锋芒', description: '艾尔·法西尔星域撤退战中，一个名叫杨威利的中尉以冷静的判断力保全了300万平民。', triggerDate: '795.05.15', choices: [{ text: '关注这位年轻军官', effect: 'admiralBoost:1' }] },
  // 帝国叛乱 (797)
  { id: 'lippstadt_war', scenarioId: 'empire_civil_war', title: '立普休塔特战争爆发', description: '帝国门阀贵族组成「立普休塔特同盟」，公开反叛莱因哈特。帝国陷入内战。', triggerDate: '797.03.01', choices: [{ text: '支持莱因哈特改革派', effect: 'setAlignment:reinhard' }, { text: '支持门阀贵族', effect: 'setAlignment:aristocrat' }] },
  // 大远征 (799)
  { id: 'operation_ragnarok', scenarioId: 'great_expedition', title: '诸神黄昏作战发动', description: '莱因哈特以帝国皇帝身份，集结全军发动对同盟本土的全面进攻——代号「诸神黄昏」。', triggerDate: '799.01.01', choices: [{ text: '以帝国身份亲征', effect: 'forceCampaign:ragnarok' }, { text: '以同盟身份死守', effect: 'forceDefense:ragnarok' }] },
];

// === 事件分类 ===
export type EventCategory = 'political' | 'military' | 'economic' | 'social' | 'scandal';

// === 事件选择 ===
export interface EventChoice {
  text: string;
  effectPreview?: string;
  effect: (ctx: EventContext) => void;
  type?: 'positive' | 'negative' | 'neutral';
}

// === 事件定义 ===
export interface RandomEventDef {
  id: string;
  name: string;
  category: EventCategory;
  /** 事件描述文本 */
  description: string | ((ctx: EventContext) => string);
  /** 是否可触发的条件检查（返回 false 则跳过） */
  canTrigger: (ctx: EventContext) => boolean;
  /** 玩家选择列表 */
  choices: EventChoice[];
  /** 是否允许跳过（暂不处理） */
  canSkip?: boolean;
  /** 冷却天数（0 = 无冷却） */
  cooldownDays: number;
}

// === 事件上下文（由 gameStore 注入） ===

/** 连锁反应：事件选择后 N 天后触发的延迟效果（如战争债券到期兑付） */
export interface ChainReaction {
  type: string;
  nodeId: number;
  nodeName: string;
  turn: number;
  description: string;
  effect: () => void;
}

export interface EventContext {
  faction: string;
  factionId: number;
  metaGold: { value: number };
  adminMerit: { value: number };
  tacticalMerit: { value: number };
  strategicFleets: { value: any[] };
  allAdmirals: { value: any[] };
  playerAdmiralId: { value: number };
  playerRank: string;
  playerRole: string;
  triggerToast: (msg: string) => void;
  getNodeStore: () => any;
  /** 全局 tick 计数（用于连锁反应延迟结算） */
  totalTicks: { value: number };
  /** 连锁反应队列（push 进这里，gameStore 会在到期 tick 执行） */
  chainReactions: { value: ChainReaction[] };
}

// === 冷却追踪 ===
const cooldowns = new Map<string, number>();

// P1修复：全局事件节流——任意事件触发后至少间隔 GLOBAL_EVENT_GAP 天，
// 同 category 事件间隔 CATEGORY_GAP 天。原版 29%/日 + 无全局冷却 → 事件轰炸。
const GLOBAL_EVENT_GAP = 2;
const CATEGORY_GAP = 3;
let lastGlobalEventDay = -999;
const categoryLastDay: Record<string, number> = {};

export function resetEventCooldowns(): void {
  cooldowns.clear();
  lastGlobalEventDay = -999;
  Object.keys(categoryLastDay).forEach(k => delete categoryLastDay[k]);
}

function isOnCooldown(eventId: string, currentDay: number): boolean {
  const readyDay = cooldowns.get(eventId);
  return readyDay !== undefined && currentDay < readyDay;
}

function setCooldown(eventId: string, currentDay: number, days: number): void {
  if (days > 0) cooldowns.set(eventId, currentDay + days);
}

// === 职级映射工具 ===
const RANK_LEVEL: Record<string, number> = {
  '准尉':1,'少尉':2,'中尉':3,'上尉':4,'少校':5,'中校':6,'上校':7,
  '准将':8,'少将':9,'中将':10,'上将':11,'一级上将':12,'元帅':13,'议会':99,'皇帝':99
};
/** 检查玩家职级是否 >= 目标职级 */
const atLeast = (ctx: EventContext, rankName: string): boolean => {
  return (RANK_LEVEL[ctx.playerRank] ?? 0) >= (RANK_LEVEL[rankName] ?? 0);
};

// === 30 条事件库（选择式） ===
export const RANDOM_EVENTS: RandomEventDef[] = [
  {
    id: 'logistics_fraud',
    name: '后勤舞弊',
    category: 'economic',
    description: '军需部门发现大规模物资挪用迹象。调查显示，部分高级军官涉嫌将补给品转入黑市。',
    canTrigger: (ctx) => ctx.metaGold.value > 50000 && atLeast(ctx, '少将'),
    choices: [
      {
        text: '彻查到底，严惩不贷',
        effectPreview: '国库 -15%，行政功勋 +100',
        effect: (ctx) => {
          const loss = Math.floor(ctx.metaGold.value * 0.15);
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - loss);
          ctx.adminMerit.value += 100;
        },
        type: 'neutral',
      },
      {
        text: '低调处理，维护军心',
        effectPreview: '国库 -5%，士气不降',
        effect: (ctx) => {
          const loss = Math.floor(ctx.metaGold.value * 0.05);
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - loss);
        },
        type: 'positive',
      },
    ],
    cooldownDays: 14,
  },
  {
    id: 'political_impeach',
    name: '政敌弹劾',
    category: 'political',
    description: (ctx) => `${ctx.faction === 'alliance' ? '评议会' : '宫廷'}中的反对派发起了针对你的弹劾动议，指控你指挥失当。`,
    canTrigger: (ctx) => atLeast(ctx, '上将'), // 上将以上才会面临政治弹劾
    choices: [
      {
        text: '据理力争，反击弹劾',
        effectPreview: '50%概率：行政功勋 +200 / -150',
        effect: (ctx) => {
          if (Math.random() < 0.5) {
            ctx.adminMerit.value += 200;
            ctx.triggerToast('弹劾失败，你的声望上升！');
          } else {
            ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 150);
            ctx.triggerToast('弹劾通过，政治地位受损。');
          }
        },
        type: 'neutral',
      },
      {
        text: '妥协退让，化解危机',
        effectPreview: '行政功勋 -80',
        effect: (ctx) => {
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 80);
        },
        type: 'negative',
      },
    ],
    cooldownDays: 21,
  },
  {
    id: 'military_breakthrough',
    name: '军事突破',
    category: 'military',
    description: '军工研发部门报告，新型舰载武器测试取得重大突破，可立即投入量产。',
    canTrigger: (ctx) => atLeast(ctx, '中将'),
    choices: [
      {
        text: '全面投产，提升全军战力',
        effectPreview: '战术功勋 +300',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 300;
        },
        type: 'positive',
      },
      {
        text: '谨慎验证，确保可靠性',
        effectPreview: '战术功勋 +150，行政功勋 +50',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 150;
          ctx.adminMerit.value += 50;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 28,
  },
  {
    id: 'faction_infighting',
    name: '派系内斗',
    category: 'political',
    description: (ctx) => `${ctx.faction === 'alliance' ? '评议会' : '宫廷'}内部派系斗争激化，多位提督被迫站队，军心浮动。`,
    canTrigger: (ctx) => {
      const admList = ctx.allAdmirals.value;
      return admList.some((a: any) => a.faction === ctx.faction && a.role !== 'none');
    },
    choices: [
      {
        text: '强硬压制，维护统一',
        effectPreview: '3名提督忠诚度 -15，行政功勋 +80',
        effect: (ctx) => {
          const admList = ctx.allAdmirals.value;
          const affected = admList.filter((a: any) => a.faction === ctx.faction && a.role !== 'none');
          affected.slice(0, 3).forEach((a: any) => {
            a.loyalty = Math.max(0, (a.loyalty || 70) - 15);
          });
          ctx.adminMerit.value += 80;
        },
        type: 'neutral',
      },
      {
        text: '调解斡旋，缓和矛盾',
        effectPreview: '1名提督忠诚度 -10',
        effect: (ctx) => {
          const admList = ctx.allAdmirals.value;
          const affected = admList.filter((a: any) => a.faction === ctx.faction && a.role !== 'none');
          if (affected.length > 0) {
            affected[0].loyalty = Math.max(0, (affected[0].loyalty || 70) - 10);
          }
        },
        type: 'positive',
      },
    ],
    cooldownDays: 25,
  },
  {
    id: 'civilian_uprising',
    name: '平民起义',
    category: 'social',
    description: (ctx) => {
      const ns = ctx.getNodeStore();
      const nodes = (ns.nodes as unknown as any[]);
      const myNodes = nodes.filter((n: any) => n.ownerFactionId === ctx.factionId);
      const target = myNodes.length > 0 ? myNodes[Math.floor(Math.random() * myNodes.length)] : null;
      return `${target?.name || '某星球'}爆发大规模反战示威，民众要求结束战争，治安急剧恶化。`;
    },
    canTrigger: (ctx) => {
      const ns = ctx.getNodeStore();
      const nodes = (ns.nodes as unknown as any[]);
      // 只在治安恶化（<50）的己方星球爆发起义
      return nodes.some((n: any) => n.ownerFactionId === ctx.factionId && (n.security ?? 50) < 50);
    },
    choices: [
      {
        text: '武力镇压，恢复秩序',
        effectPreview: '治安 -20，行政功勋 -50',
        effect: (ctx) => {
          const ns = ctx.getNodeStore();
          const nodes = (ns.nodes as unknown as any[]);
          const myNodes = nodes.filter((n: any) => n.ownerFactionId === ctx.factionId);
          if (myNodes.length > 0) {
            const target = myNodes[Math.floor(Math.random() * myNodes.length)];
            target.security = Math.max(0, (target.security || 50) - 20);
          }
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 50);
        },
        type: 'negative',
      },
      {
        text: '安抚民众，让步妥协',
        effectPreview: '治安 -10，国库 -8万',
        effect: (ctx) => {
          const ns = ctx.getNodeStore();
          const nodes = (ns.nodes as unknown as any[]);
          const myNodes = nodes.filter((n: any) => n.ownerFactionId === ctx.factionId);
          if (myNodes.length > 0) {
            const target = myNodes[Math.floor(Math.random() * myNodes.length)];
            target.security = Math.max(0, (target.security || 50) - 10);
          }
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 80000);
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 20,
  },
  {
    id: 'merchant_donation',
    name: '商人献金',
    category: 'economic',
    description: '一位富商主动联系军方，愿意捐赠大笔资金支持战争，但要求战后获得某些特权。',
    canTrigger: (ctx) => atLeast(ctx, '少将'),
    choices: [
      {
        text: '接受捐赠，允诺特权',
        effectPreview: '国库 +15万，行政功勋 -50',
        effect: (ctx) => {
          ctx.metaGold.value += 150000;
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 50);
        },
        type: 'neutral',
      },
      {
        text: '接受捐赠，拒绝特权',
        effectPreview: '国库 +8万',
        effect: (ctx) => {
          ctx.metaGold.value += 80000;
        },
        type: 'positive',
      },
      {
        text: '婉拒好意，保持清廉',
        effectPreview: '行政功勋 +100',
        effect: (ctx) => {
          ctx.adminMerit.value += 100;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 15,
  },
  {
    id: 'admiral_scandal',
    name: '提督丑闻',
    category: 'scandal',
    description: (ctx) => {
      const admList = ctx.allAdmirals.value;
      const candidates = admList.filter((a: any) =>
        a.faction === ctx.faction && a.role !== 'none' && a.role !== 'emperor' && a.role !== 'council'
      );
      const target = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
      return `${target?.rankName || ''} ${target?.name || '某提督'}被曝出私生活丑闻，媒体大肆报道，军誉受损。`;
    },
    canTrigger: (ctx) => {
      const admList = ctx.allAdmirals.value;
      return admList.some((a: any) =>
        a.faction === ctx.faction && a.role !== 'none' && a.role !== 'emperor' && a.role !== 'council'
      );
    },
    choices: [
      {
        text: '公开道歉，停职审查',
        effectPreview: '该提督忠诚度 -20，行政功勋 -80',
        effect: (ctx) => {
          const admList = ctx.allAdmirals.value;
          const candidates = admList.filter((a: any) =>
            a.faction === ctx.faction && a.role !== 'none' && a.role !== 'emperor' && a.role !== 'council'
          );
          if (candidates.length > 0) {
            const target = candidates[Math.floor(Math.random() * candidates.length)];
            target.loyalty = Math.max(0, (target.loyalty || 70) - 20);
          }
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 80);
        },
        type: 'negative',
      },
      {
        text: '压下报道，冷处理',
        effectPreview: '行政功勋 -30',
        effect: (ctx) => {
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 30);
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 30,
  },
  {
    id: 'diplomatic_friction',
    name: '外交摩擦',
    category: 'political',
    description: (ctx) => `${ctx.faction === 'alliance' ? '帝国' : '同盟'}方面发表强硬声明，指责我方边境挑衅，局势骤然紧张。`,
    canTrigger: (ctx) => atLeast(ctx, '中将'),
    choices: [
      {
        text: '强硬回击，展示决心',
        effectPreview: '战术功勋 +100，但可能引发冲突',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 100;
          // TODO: 增加外交紧张度
        },
        type: 'neutral',
      },
      {
        text: '外交斡旋，缓和关系',
        effectPreview: '行政功勋 +50',
        effect: (ctx) => {
          ctx.adminMerit.value += 50;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 10,
  },
  {
    id: 'research_investor',
    name: '科研投资',
    category: 'economic',
    description: '一位退役提督带着私人资金回归，愿意投资军事科技研发，但要求参与决策。',
    canTrigger: (ctx) => atLeast(ctx, '中将'),
    choices: [
      {
        text: '接受投资，共享决策权',
        effectPreview: '战术功勋 +150，行政功勋 +150',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 150;
          ctx.adminMerit.value += 150;
        },
        type: 'positive',
      },
      {
        text: '接受投资，独立研发',
        effectPreview: '战术功勋 +100，行政功勋 +100',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 100;
          ctx.adminMerit.value += 100;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 35,
  },
  {
    id: 'mutiny',
    name: '兵变',
    category: 'military',
    description: (ctx) => {
      const myFleets = ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId);
      const target = myFleets.length > 0 ? myFleets[Math.floor(Math.random() * myFleets.length)] : null;
      const adm = target ? ctx.allAdmirals.value.find((a: any) => a.id === target.commanderId) : null;
      return `${adm?.name || '某舰队'}发生小规模兵变，部分士兵哗变，要求改善待遇。`;
    },
    canTrigger: (ctx) => {
      return ctx.strategicFleets.value.some((f: any) => f.factionId === ctx.factionId);
    },
    choices: [
      {
        text: '武力镇压，以儆效尤',
        effectPreview: '该舰队士气 -30，战术功勋 +50',
        effect: (ctx) => {
          const myFleets = ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId);
          if (myFleets.length > 0) {
            const target = myFleets[Math.floor(Math.random() * myFleets.length)];
            target.morale = Math.max(10, target.morale - 30);
          }
          ctx.tacticalMerit.value += 50;
        },
        type: 'negative',
      },
      {
        text: '安抚士兵，改善待遇',
        effectPreview: '该舰队士气 +10，国库 -5万',
        effect: (ctx) => {
          const myFleets = ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId);
          if (myFleets.length > 0) {
            const target = myFleets[Math.floor(Math.random() * myFleets.length)];
            target.morale = Math.min(100, target.morale + 10);
          }
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 50000);
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 40,
  },
  {
    id: 'supply_improvement',
    name: '补给线改善',
    category: 'military',
    description: '后勤部门报告，新的补给路线已经开通，可以更高效地向前线输送物资。',
    canTrigger: (ctx) => {
      return ctx.strategicFleets.value.some((f: any) => f.factionId === ctx.factionId);
    },
    choices: [
      {
        text: '全面调配，补给全军',
        effectPreview: '全体舰队补给 +15',
        effect: (ctx) => {
          ctx.strategicFleets.value.forEach((f: any) => {
            if (f.factionId === ctx.factionId) f.supply = Math.min(100, f.supply + 15);
          });
        },
        type: 'positive',
      },
    ],
    canSkip: true,
    cooldownDays: 18,
  },

  // === 第二批：12条新事件 ===

  {
    id: 'admiral_injury',
    name: '提督负伤',
    category: 'military',
    description: (ctx) => {
      const candidates = ctx.allAdmirals.value.filter((a: any) =>
        a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
      );
      const target = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
      return `${target?.name || '前线提督'}在最近一次巡逻中遭到伏击，身负重伤，需要紧急医疗。`;
    },
    canTrigger: (ctx) => {
      return ctx.allAdmirals.value.some((a: any) =>
        a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
      );
    },
    choices: [
      {
        text: '全力救治，不惜代价',
        effectPreview: '国库 -6万，提督康复',
        effect: (ctx) => {
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 60000);
          ctx.triggerToast('提督已得到妥善治疗，预计短期内可重返前线。');
        },
        type: 'neutral',
      },
      {
        text: '保守治疗，节省开支',
        effectPreview: '提督3回合内无法出战',
        effect: (ctx) => {
          ctx.triggerToast('提督转入后方医院，暂时无法指挥舰队。');
        },
        type: 'negative',
      },
    ],
    cooldownDays: 25,
  },

  {
    id: 'pirate_raid',
    name: '海盗袭击',
    category: 'military',
    description: (ctx) => {
      const ns = ctx.getNodeStore();
      const nodes = (ns.nodes as unknown as any[]);
      const myNodes = nodes.filter((n: any) => n.ownerFactionId === ctx.factionId);
      const target = myNodes.length > 0 ? myNodes[Math.floor(Math.random() * myNodes.length)] : null;
      return `星域海盗在${target?.name || '边境星系'}大肆劫掠，多支商船队被劫，民怨沸腾。`;
    },
    canTrigger: (ctx) => {
      const ns = ctx.getNodeStore();
      // 海盗在治安薄弱（<60）的边境星域劫掠
      return (ns.nodes as unknown as any[]).some((n: any) => n.ownerFactionId === ctx.factionId && (n.security ?? 50) < 60);
    },
    choices: [
      {
        text: '派出舰队清剿',
        effectPreview: '战术功勋 +80，消耗补给',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 80;
          const myFleets = ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId);
          if (myFleets.length > 0) {
            const target = myFleets[Math.floor(Math.random() * myFleets.length)];
            target.supply = Math.max(10, target.supply - 10);
          }
        },
        type: 'positive',
      },
      {
        text: '派小部队威慑',
        effectPreview: '战术功勋 +30',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 30;
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 20,
  },

  {
    id: 'natural_disaster',
    name: '天灾降临',
    category: 'social',
    description: (ctx) => {
      const ns = ctx.getNodeStore();
      const nodes = (ns.nodes as unknown as any[]);
      const myNodes = nodes.filter((n: any) => n.ownerFactionId === ctx.factionId);
      const target = myNodes.length > 0 ? myNodes[Math.floor(Math.random() * myNodes.length)] : null;
      return `${target?.name || '一颗边境星球'}遭到小行星撞击，基础设施严重损毁，平民死伤惨重。`;
    },
    canTrigger: (ctx) => {
      const ns = ctx.getNodeStore();
      // 小行星撞击只有对繁荣（economy>1000）星球才有足够损失值得演这个事件
      return (ns.nodes as unknown as any[]).some((n: any) => n.ownerFactionId === ctx.factionId && (n.economy ?? 0) > 1000);
    },
    choices: [
      {
        text: '全力救援，重建家园',
        effectPreview: '国库 -12万，行政功勋 +120',
        effect: (ctx) => {
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 120000);
          ctx.adminMerit.value += 120;
        },
        type: 'positive',
      },
      {
        text: '军事优先，灾区自治',
        effectPreview: '行政功勋 -40',
        effect: (ctx) => {
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 40);
        },
        type: 'negative',
      },
    ],
    cooldownDays: 30,
  },

  {
    id: 'tech_espionage',
    name: '科技间谍',
    category: 'political',
    description: (ctx) => {
      const enemyFaction = ctx.faction === 'alliance' ? '帝国' : '同盟';
      return `情报部门报告，${enemyFaction}可能在研发新型舰载武器。是否派遣间谍渗透其研究所？`;
    },
    canTrigger: (ctx) => atLeast(ctx, '中将'),
    choices: [
      {
        text: '派遣精英间谍',
        effectPreview: '40%概率：战术功勋 +200 / 间谍暴露 -1万',
        effect: (ctx) => {
          if (Math.random() < 0.4) {
            ctx.tacticalMerit.value += 200;
            ctx.triggerToast('间谍成功窃取关键技术！');
          } else {
            ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 10000);
            ctx.triggerToast('间谍暴露并被逮捕。');
          }
        },
        type: 'neutral',
      },
      {
        text: '加强自主研发',
        effectPreview: '行政功勋 +100，国库 -3万',
        effect: (ctx) => {
          ctx.adminMerit.value += 100;
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 30000);
        },
        type: 'positive',
      },
    ],
    cooldownDays: 35,
  },

  {
    id: 'peace_treaty_offer',
    name: '和谈提议',
    category: 'political',
    description: (ctx) => {
      const enemy = ctx.faction === 'alliance' ? '银河帝国' : '自由行星同盟';
      return `第三方中立势力斡旋，${enemy}方面传来口信，愿意在"互不侵犯"的前提下进行和谈。`;
    },
    canTrigger: (ctx) => atLeast(ctx, '上将'),
    choices: [
      {
        text: '开启和谈',
        effectPreview: '行政功勋 +200，战术功勋 -100',
        effect: (ctx) => {
          ctx.adminMerit.value += 200;
          ctx.tacticalMerit.value = Math.max(0, ctx.tacticalMerit.value - 100);
        },
        type: 'positive',
      },
      {
        text: '无视提议，继续战争',
        effectPreview: '战术功勋 +100',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 100;
        },
        type: 'neutral',
      },
      {
        text: '主动提出条件',
        effectPreview: '90%概率：国库 -10万 / 停战协议',
        effect: (ctx) => {
          if (Math.random() < 0.9) {
            ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 100000);
            ctx.triggerToast('和谈条件被对方拒绝。');
          } else {
            ctx.triggerToast('对方意外接受了你的条件！双方签署临时停战协议。');
          }
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 50,
  },

  {
    id: 'hero_recognition',
    name: '英雄典礼',
    category: 'social',
    description: (ctx) => `民间发起了对你的盛大表彰，数以万计的民众聚集在首都广场，高呼你的名字。政治对手暗示这是"个人崇拜"。`,
    canTrigger: (ctx) => atLeast(ctx, '中将') && ctx.tacticalMerit.value > 300,
    choices: [
      {
        text: '出席典礼，激励民心',
        effectPreview: '行政功勋 +80，战术功勋 +50',
        effect: (ctx) => {
          ctx.adminMerit.value += 80;
          ctx.tacticalMerit.value += 50;
        },
        type: 'positive',
      },
      {
        text: '低调处理，婉拒表彰',
        effectPreview: '行政功勋 +150',
        effect: (ctx) => {
          ctx.adminMerit.value += 150;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 35,
  },

  {
    id: 'fleet_exercise',
    name: '舰队演习',
    category: 'military',
    description: '军务部提议举行大规模联合演习，检验各舰队的协同作战能力。预计耗资巨大。',
    canTrigger: (ctx) => atLeast(ctx, '少将') && ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId).length >= 2,
    choices: [
      {
        text: '全力支持演习',
        effectPreview: '全体舰队士气 +10，国库 -10万',
        effect: (ctx) => {
          ctx.strategicFleets.value.forEach((f: any) => {
            if (f.factionId === ctx.factionId) f.morale = Math.min(100, f.morale + 10);
          });
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 100000);
        },
        type: 'positive',
      },
      {
        text: '小幅演习，控制预算',
        effectPreview: '随机2支舰队士气 +5，国库 -4万',
        effect: (ctx) => {
          const myFleets = ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId);
          myFleets.slice(0, 2).forEach((f: any) => f.morale = Math.min(100, f.morale + 5));
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 40000);
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 22,
  },

  {
    id: 'black_market',
    name: '黑市走私',
    category: 'economic',
    description: '军方情报部门发现大规模军火黑市，疑似有现役军官参与走私。调查难度极高。',
    canTrigger: (ctx) => atLeast(ctx, '少将'),
    choices: [
      {
        text: '成立专案组彻查',
        effectPreview: '国库 +8万（没收脏款），1名提督忠诚度 -15',
        effect: (ctx) => {
          ctx.metaGold.value += 80000;
          const admList = ctx.allAdmirals.value;
          const candidates = admList.filter((a: any) =>
            a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
          );
          if (candidates.length > 0) {
            const target = candidates[Math.floor(Math.random() * candidates.length)];
            target.loyalty = Math.max(0, (target.loyalty || 70) - 15);
          }
        },
        type: 'neutral',
      },
      {
        text: '暗中打击，不公开',
        effectPreview: '国库 +3万',
        effect: (ctx) => {
          ctx.metaGold.value += 30000;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 20,
  },

  {
    id: 'traitor_rumor',
    name: '内奸疑云',
    category: 'scandal',
    description: (ctx) => {
      const candidates = ctx.allAdmirals.value.filter((a: any) =>
        a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
      );
      const target = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
      return `匿名举报称，${target?.name || '某高级将领'}可能与敌方有秘密通信。缺乏确凿证据，但言之凿凿。`;
    },
    canTrigger: (ctx) => {
      return ctx.allAdmirals.value.some((a: any) =>
        a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
      );
    },
    choices: [
      {
        text: '秘密调查',
        effectPreview: '40%概率：发现真正叛徒/冤枉好人 -忠诚10',
        effect: (ctx) => {
          if (Math.random() < 0.4) {
            ctx.triggerToast('调查发现另一名提督才是真正内奸！');
            ctx.tacticalMerit.value += 80;
          } else {
            ctx.triggerToast('调查洗清了该提督的嫌疑，但信任已受损。');
            const candidates = ctx.allAdmirals.value.filter((a: any) =>
              a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
            );
            if (candidates.length > 0) {
              candidates[Math.floor(Math.random() * candidates.length)].loyalty = Math.max(0, (candidates[Math.floor(Math.random() * candidates.length)].loyalty || 70) - 10);
            }
          }
        },
        type: 'neutral',
      },
      {
        text: '公开审讯，杀一儆百',
        effectPreview: '该提督忠诚度 -30',
        effect: (ctx) => {
          const candidates = ctx.allAdmirals.value.filter((a: any) =>
            a.faction === ctx.faction && a.role !== 'emperor' && a.role !== 'council' && a.id !== ctx.playerAdmiralId.value
          );
          if (candidates.length > 0) {
            candidates[Math.floor(Math.random() * candidates.length)].loyalty = Math.max(0, (candidates[Math.floor(Math.random() * candidates.length)].loyalty || 70) - 30);
          }
          ctx.adminMerit.value = Math.max(0, ctx.adminMerit.value - 50);
        },
        type: 'negative',
      },
    ],
    cooldownDays: 30,
  },

  {
    id: 'war_bonds',
    name: '战争债券',
    category: 'economic',
    description: '财政部建议发行战争债券，向民间募资支持前线。战后需兑付本息。',
    canTrigger: (ctx) => atLeast(ctx, '中将'),
    choices: [
      {
        text: '发行高息债券',
        effectPreview: '立即获得 ₮25万，60天后兑付本息 ₮32.5万',
        effect: (ctx) => {
          ctx.metaGold.value += 250000;
          // 60 天后兑付：本金 25 万 + 30% 利息 = 32.5 万
          const goldRef = ctx.metaGold;
          ctx.chainReactions.value.push({
            type: 'war_bonds_repay_high',
            nodeId: -1,
            nodeName: '',
            turn: ctx.totalTicks.value + 60 * TICKS_PER_DAY,
            description: '高息战争债券到期，财政部兑付本息 ₮32.5万。',
            effect: () => { goldRef.value = Math.max(0, goldRef.value - 325000); },
          });
          ctx.triggerToast('债券发行成功！民间踊跃认购。');
        },
        type: 'positive',
      },
      {
        text: '发行低息债券',
        effectPreview: '立即获得 ₮15万，60天后兑付本息 ₮16.5万',
        effect: (ctx) => {
          ctx.metaGold.value += 150000;
          // 60 天后兑付：本金 15 万 + 10% 利息 = 16.5 万
          const goldRef = ctx.metaGold;
          ctx.chainReactions.value.push({
            type: 'war_bonds_repay_low',
            nodeId: -1,
            nodeName: '',
            turn: ctx.totalTicks.value + 60 * TICKS_PER_DAY,
            description: '低息战争债券到期，财政部兑付本息 ₮16.5万。',
            effect: () => { goldRef.value = Math.max(0, goldRef.value - 165000); },
          });
          ctx.triggerToast('债券发行成功！民间踊跃认购。');
        },
        type: 'positive',
      },
      {
        text: '不愿负债，否决提议',
        effectPreview: '行政功勋 +30',
        effect: (ctx) => {
          ctx.adminMerit.value += 30;
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 40,
  },

  {
    id: 'cultural_festival',
    name: '文化祭奠',
    category: 'social',
    description: (ctx) => `${ctx.faction === 'alliance' ? '同盟' : '帝国'}建国纪念日即将到来，民众期待盛大庆典，可提振士气。`,
    canTrigger: (ctx) => {
      // 庆典的动机是提振低迷士气，只在士气 <70 时才触发
      return ctx.strategicFleets.value.some((f: any) => f.factionId === ctx.factionId && (f.morale ?? 100) < 70);
    },
    choices: [
      {
        text: '拨款举办大庆典',
        effectPreview: '全体舰队士气 +5，国库 -6万',
        effect: (ctx) => {
          ctx.strategicFleets.value.forEach((f: any) => {
            if (f.factionId === ctx.factionId) f.morale = Math.min(100, f.morale + 5);
          });
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 60000);
        },
        type: 'positive',
      },
      {
        text: '小规模庆祝即可',
        effectPreview: '士气 +2，国库 -2万',
        effect: (ctx) => {
          const myFleets = ctx.strategicFleets.value.filter((f: any) => f.factionId === ctx.factionId);
          myFleets.slice(0, 3).forEach((f: any) => f.morale = Math.min(100, f.morale + 2));
          ctx.metaGold.value = Math.max(0, ctx.metaGold.value - 20000);
        },
        type: 'neutral',
      },
    ],
    canSkip: true,
    cooldownDays: 20,
  },

  // === 第三批：提督专属事件 ===

  // 杨威利 (id: 0)
  {
    id: 'yang_retirement_crisis',
    name: '杨威利的退路',
    category: 'social',
    description: '「和平的曙光似乎又远了一步……」杨威利在日记中写道。议员们开始讨论他的退役问题，而伊谢尔伦的守军正在等待他的决定。',
    canTrigger: (ctx) => ctx.playerAdmiralId.value === 0 && ctx.tacticalMerit.value > 200,
    choices: [
      {
        text: '「战争尚未结束，我不能走」',
        effectPreview: '行政功勋 +150，战术功勋 +100',
        effect: (ctx) => {
          ctx.adminMerit.value += 150;
          ctx.tacticalMerit.value += 100;
          ctx.triggerToast('「不败的魔术师」选择继续留在前线。民众高呼你的名字。');
        },
        type: 'positive',
      },
      {
        text: '「也许……是时候考虑了」',
        effectPreview: '行政功勋 +50，获得"和平主义者"声望',
        effect: (ctx) => {
          ctx.adminMerit.value += 50;
          ctx.triggerToast('杨威利宣布将在战后退役。军心震动，但民众表示理解。');
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 60,
  },

  {
    id: 'yang_victory_speech',
    name: '魔术师的演说',
    category: 'political',
    description: '杨威利在同盟议会发表即席演说：「战争不是目的，和平才是。但如果必须战斗才能保卫和平……那我们别无选择。」',
    canTrigger: (ctx) => ctx.playerAdmiralId.value === 0 && ctx.adminMerit.value > 200,
    choices: [
      {
        text: '发表反战演说',
        effectPreview: '行政功勋 +200，战术功勋 +50',
        effect: (ctx) => {
          ctx.adminMerit.value += 200;
          ctx.tacticalMerit.value += 50;
          ctx.triggerToast('演说震撼人心，同盟内部停战呼声高涨。');
        },
        type: 'positive',
      },
      {
        text: '保持低调',
        effectPreview: '行政功勋 +50',
        effect: (ctx) => {
          ctx.adminMerit.value += 50;
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 50,
  },

  // 莱因哈特 (id: 1)
  {
    id: 'reinhard_palace_coup',
    name: '王座之影',
    category: 'political',
    description: '伽罗伊斯秘密报告：宫廷内部有势力密谋推翻你的指挥权。是时候肃清这些「贵族残余」了。',
    canTrigger: (ctx) => ctx.playerAdmiralId.value === 1 && atLeast(ctx, '中将'),
    choices: [
      {
        text: '雷霆手段，一网打尽',
        effectPreview: '3名帝国提督忠诚度 -30，行政功勋 +180',
        effect: (ctx) => {
          const admList = ctx.allAdmirals.value;
          const affected = admList.filter((a: any) => a.faction === 'empire' && a.role !== 'emperor' && a.id !== 1);
          affected.slice(0, 3).forEach((a: any) => {
            a.loyalty = Math.max(0, (a.loyalty || 70) - 30);
          });
          ctx.adminMerit.value += 180;
          ctx.triggerToast('「朕是宇宙的主宰」——你的铁腕手段震慑了整个帝国。');
        },
        type: 'positive',
      },
      {
        text: '分化瓦解，各个击破',
        effectPreview: '1名提督忠诚度 -10，行政功勋 +100',
        effect: (ctx) => {
          ctx.adminMerit.value += 100;
          ctx.triggerToast('阴谋集团在你的手腕下自行瓦解。');
        },
        type: 'positive',
      },
    ],
    cooldownDays: 55,
  },

  {
    id: 'reinhard_imperial_rally',
    name: '帝国集结',
    category: 'military',
    description: '莱因哈特站在旗舰"伯伦希尔"的舰桥上，帝国全部舰队正在集结。这是一次改变历史的机会。',
    canTrigger: (ctx) => ctx.playerAdmiralId.value === 1 && ctx.strategicFleets.value.filter((f: any) => f.factionId === 2).length >= 3,
    choices: [
      {
        text: '「全军出击！目标：同盟本土」',
        effectPreview: '帝国舰队士气 +20，战术功勋 +200',
        effect: (ctx) => {
          ctx.strategicFleets.value.forEach((f: any) => {
            if (f.factionId === 2) f.morale = Math.min(100, f.morale + 20);
          });
          ctx.tacticalMerit.value += 200;
          ctx.triggerToast('帝国舰队以雷霆之势压向同盟本土。历史将记住这一天。');
        },
        type: 'positive',
      },
      {
        text: '稳扎稳打，先取伊谢尔伦',
        effectPreview: '战术功勋 +100，行政功勋 +100',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 100;
          ctx.adminMerit.value += 100;
        },
        type: 'positive',
      },
    ],
    cooldownDays: 60,
  },

  // 齐格飞 (id: 3)
  {
    id: 'kirchies_sacrifice',
    name: '挚友的抉择',
    category: 'social',
    description: '齐格飞·吉尔菲艾斯意识到——为了帝国、为了莱因哈特的伟大事业，他必须做出某种牺牲。「如果我必须成为支柱，那就让我成为支柱吧。」',
    canTrigger: (ctx) => ctx.playerAdmiralId.value === 3,
    choices: [
      {
        text: '「我将守护你的背后，直到最后一刻」',
        effectPreview: '忠诚度永久+50，行政功勋 +100',
        effect: (ctx) => {
          ctx.adminMerit.value += 100;
          const self = ctx.allAdmirals.value.find((a: any) => a.id === 3);
          if (self) self.loyalty = 100;
          ctx.triggerToast('齐格飞·吉尔菲艾斯成为了帝国无可撼动的支柱。');
        },
        type: 'positive',
      },
      {
        text: '「也许……还有更好的方式」',
        effectPreview: '行政功勋 +80',
        effect: (ctx) => {
          ctx.adminMerit.value += 80;
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 70,
  },

  {
    id: 'kirchies_parley',
    name: '红发使节',
    category: 'political',
    description: '齐格飞·吉尔菲艾斯受命前往中立星域，与同盟代表进行秘密谈判。他那头红色的头发在谈判桌上格外醒目——对方代表显然没料到帝国会派出如此和善的使者。',
    canTrigger: (ctx) => ctx.playerAdmiralId.value === 3 && atLeast(ctx, '中将'),
    choices: [
      {
        text: '真诚谈判，寻求共存',
        effectPreview: '行政功勋 +200，战术功勋 -50',
        effect: (ctx) => {
          ctx.adminMerit.value += 200;
          ctx.tacticalMerit.value = Math.max(0, ctx.tacticalMerit.value - 50);
          ctx.triggerToast('谈判取得突破性进展。双方签署临时互不侵犯协议。');
        },
        type: 'positive',
      },
      {
        text: '坚持帝国立场',
        effectPreview: '战术功勋 +80',
        effect: (ctx) => {
          ctx.tacticalMerit.value += 80;
        },
        type: 'neutral',
      },
    ],
    cooldownDays: 45,
  },
];

// === 待处理事件（供UI展示） ===
export interface PendingEvent {
  id: string;
  name: string;
  description: string;
  category: EventCategory;
  choices: EventChoice[];
  canSkip?: boolean;
}

// === 每日事件判定 ===
export function evaluateDailyEvents(ctx: EventContext, dayIndex: number): PendingEvent | null {
  // 1. 基础概率判定
  if (Math.random() > DAILY_EVENT_CHANCE) return null;

  // 1.5 P1修复：全局节流——距上次任意事件不足 GLOBAL_EVENT_GAP 天则跳过
  if (dayIndex - lastGlobalEventDay < GLOBAL_EVENT_GAP) return null;

  // 2. 筛选可触发且未冷却的事件（含 category 节流）
  const eligible = RANDOM_EVENTS.filter((evt) => {
    if (isOnCooldown(evt.id, dayIndex)) return false;
    const lastCat = categoryLastDay[evt.category];
    if (lastCat !== undefined && dayIndex - lastCat < CATEGORY_GAP) return false;
    return evt.canTrigger(ctx);
  });

  if (eligible.length === 0) return null;

  // 3. 随机选择一条
  const evt = eligible[Math.floor(Math.random() * eligible.length)];

  // 4. 设置冷却（含全局与 category 记录）
  setCooldown(evt.id, dayIndex, evt.cooldownDays);
  lastGlobalEventDay = dayIndex;
  categoryLastDay[evt.category] = dayIndex;

  // 5. 返回待处理事件（不立即执行）
  const description = typeof evt.description === 'function' ? evt.description(ctx) : evt.description;

  return {
    id: evt.id,
    name: evt.name,
    description,
    category: evt.category,
    choices: evt.choices,
    canSkip: evt.canSkip,
  };
}
