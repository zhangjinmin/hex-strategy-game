/**
 * scenarioConfig.ts — 剧本配置（Phase 3 银英战略层补全）
 *
 * 优先级最低的实现：先定义数据结构和3个核心剧本。
 * UI 选择面板由 ScenarioSelectModal.vue 实现。
 */

export interface ScenarioConfig {
  id: string;
  name: string;
  year: number;
  description: string;
  faction: string; // 玩家可选阵营: 'alliance' | 'empire' | 'both'
  difficulty: 'easy' | 'normal' | 'hard';
  bindableEvents: string[]; // 绑定的事件ID列表
  victoryConditions: VictoryCondition[];
}

export interface VictoryCondition {
  type: 'conquer_capital' | 'conquer_all' | 'eliminate_admiral' | 'survive_turns' | 'economic_dominance';
  factionId: number;
  params?: Record<string, number>;
  description: string;
}

export const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'astarte_eve',
    name: '亚斯提前夜',
    year: 795,
    description: '帝国与同盟的冷战格局。莱因哈特·冯·罗严克拉姆初露锋芒，杨威利还只是一个名不见经传的中尉。双方实力接近，但帝国略占优势。',
    faction: 'both',
    difficulty: 'normal',
    bindableEvents: ['astarte_battle', 'yang_emergence', 'reinhard_promotion', 'iserlohn_first'],
    victoryConditions: [
      { type: 'conquer_capital', factionId: 1, description: '同盟胜利：攻占奥丁' },
      { type: 'conquer_capital', factionId: 2, description: '帝国胜利：攻占海尼森' },
    ],
  },
  {
    id: 'empire_civil_war',
    name: '帝国叛乱（立普休塔特）',
    year: 797,
    description: '帝国门阀贵族结成「立普休塔特同盟」，对抗莱因哈特的改革派。可以选择效忠任何一方——辅佐莱因哈特统一帝国，或帮助旧贵族保全门阀体制。',
    faction: 'empire',
    difficulty: 'hard',
    bindableEvents: ['lippstadt_war', 'kirscheis_death', 'reinhard_name_change', 'verde_riots', 'aristocrat_purge'],
    victoryConditions: [
      { type: 'eliminate_admiral', factionId: 2, params: { admiralId: 0 }, description: '消灭所有叛乱贵族' },
      { type: 'survive_turns', factionId: 2, params: { turns: 100 }, description: '在100回合内统一帝国' },
    ],
  },
  {
    id: 'great_expedition',
    name: '大远征前夜（诸神黄昏）',
    year: 799,
    description: '莱因哈特成为帝国皇帝，集结帝国全部兵力发动「诸神黄昏」大远征。同盟国力空虚、背水一战。这是杨威利展现奇迹的最后舞台。',
    faction: 'both',
    difficulty: 'hard',
    bindableEvents: ['operation_ragnarok', 'yang_miracle', 'reinhard_unification', 'alliance_last_stand'],
    victoryConditions: [
      { type: 'conquer_all', factionId: 2, description: '帝国胜利：完全征服同盟领土' },
      { type: 'survive_turns', factionId: 1, params: { turns: 80 }, description: '同盟生存：坚守80回合' },
    ],
  },
];
