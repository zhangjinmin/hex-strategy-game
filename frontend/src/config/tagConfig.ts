// ==================================================
// File: src/config/tagConfig.ts
// 标签体系配置中心：元数据表、影响系数、互斥规则、辅助函数
// ==================================================

import type {
  AdmiralTag,
  PoliticalTag,
  MilitaryTag,
  PersonalityTag,
  AbilityTag,
  TagMeta,
  TagCategory,
  NationalRole,
  ProposalType,
} from '../types/game';

// ─── 标签元数据表（28 条完整定义） ───
export const TAG_META_MAP: Record<AdmiralTag, TagMeta> = {
  // 政治立场 (7)
  'aristocrat':        { id: 'aristocrat', label: '大贵族派', category: 'political', description: '维护门阀贵族利益，抵制改革' },
  'reformer':          { id: 'reformer', label: '改革派', category: 'political', description: '主张制度革新，打破贵族垄断' },
  'democrat':          { id: 'democrat', label: '民主派', category: 'political', description: '追求民主制度（主要为同盟人物）' },
  'militarist':        { id: 'militarist', label: '军国派', category: 'political', description: '崇尚武力扩张，军功至上' },
  'pacifist':          { id: 'pacifist', label: '和平派', category: 'political', description: '反对战争，主张外交解决' },
  'royalist':          { id: 'royalist', label: '保皇派', category: 'political', description: '绝对忠于皇室（帝国专属）' },
  'ambition_faction':  { id: 'ambition_faction', label: '野心派', category: 'political', description: '追求个人权力，伺机夺权' },
  // 军事风格 (8)
  'frontal_assault':   { id: 'frontal_assault', label: '正面突击', category: 'military', description: '偏好主力正面决战' },
  'counter_defense':   { id: 'counter_defense', label: '防守反击', category: 'military', description: '以守为攻，消耗后反击' },
  'firepower':         { id: 'firepower', label: '火力压制', category: 'military', description: '依赖远程火力优势' },
  'mobile_raid':       { id: 'mobile_raid', label: '机动突袭', category: 'military', description: '高速穿插，打乱阵型' },
  'logistics_focus':   { id: 'logistics_focus', label: '后勤重视', category: 'military', description: '注重补给线与持续作战' },
  'intel_focus':       { id: 'intel_focus', label: '情报重视', category: 'military', description: '依赖侦察与信息优势' },
  'cautious':          { id: 'cautious', label: '谨慎型', category: 'military', description: '宁可保守不失' },
  'aggressive':        { id: 'aggressive', label: '冒险型', category: 'military', description: '敢于冒险，孤注一掷' },
  // 人格特质 (8)
  'high_charisma':     { id: 'high_charisma', label: '高魅力', category: 'personality', description: '天生领袖气质，容易获得追随' },
  'high_iq':           { id: 'high_iq', label: '高智商', category: 'personality', description: '战略洞察力强，善于谋略' },
  'high_eq':           { id: 'high_eq', label: '高情商', category: 'personality', description: '善于人际周旋，协调矛盾' },
  'ruthless':          { id: 'ruthless', label: '冷酷', category: 'personality', description: '不择手段，功利至上' },
  'righteous':         { id: 'righteous', label: '义理', category: 'personality', description: '重信守义，忠贞不二' },
  'opportunist':       { id: 'opportunist', label: '投机', category: 'personality', description: '见风使舵，唯利是图' },
  'idealist':          { id: 'idealist', label: '理想主义', category: 'personality', description: '为信念而战，不计得失' },
  'realist':           { id: 'realist', label: '现实主义', category: 'personality', description: '务实权衡，灵活应变' },
  // 能力倾向 (5)
  'tactician':         { id: 'tactician', label: '战术家', category: 'ability', description: '擅长战场指挥与临阵应变' },
  'strategist':        { id: 'strategist', label: '战略家', category: 'ability', description: '擅长全局规划与长远布局' },
  'politician':        { id: 'politician', label: '政客', category: 'ability', description: '擅长权力博弈与派系运作' },
  'administrator':     { id: 'administrator', label: '行政官', category: 'ability', description: '擅长内政管理与资源调度' },
  'diplomat':          { id: 'diplomat', label: '外交官', category: 'ability', description: '擅长谈判与情报外交' },
};

// ─── 政治标签投票系数表 ───
// 每个政治标签对 7 类提案的投票倾向修正（-0.5 ~ +0.5）
// v3 瘦身：删除 tax/logistics/tech_mobilize/intel_op/diplomat_op 5 列
export const POLITICAL_VOTE_COEFFICIENTS: Record<PoliticalTag, Record<ProposalType, number>> = {
  'aristocrat':       { invasion: -0.2, defense: +0.3, budget: +0.1, personnel: -0.3, conscription: +0.1,
                        morale_boost: 0,    fortify: +0.1 },
  'reformer':         { invasion: +0.2, defense:  0,   budget: -0.1, personnel: +0.3, conscription: +0.1,
                        morale_boost: 0,    fortify: 0 },
  'democrat':         { invasion: +0.1, defense: +0.4, budget:  0,   personnel: +0.2, conscription: -0.2,
                        morale_boost: +0.1, fortify: +0.1 },
  'militarist':       { invasion: +0.5, defense: +0.1, budget: +0.2, personnel:  0,   conscription: +0.5,
                        morale_boost: +0.1, fortify: 0 },
  'pacifist':         { invasion: -0.4, defense: +0.2, budget: -0.2, personnel: +0.1, conscription: -0.4,
                        morale_boost: +0.1, fortify: +0.2 },
  'royalist':         { invasion:  0,   defense: +0.3, budget:  0,   personnel: -0.2, conscription: +0.1,
                        morale_boost: 0,    fortify: +0.1 },
  'ambition_faction': { invasion: +0.3, defense: -0.2, budget: -0.3, personnel: -0.2, conscription: +0.3,
                        morale_boost: 0,    fortify: -0.1 },
};

// ─── 人格特质修正表 ───
export const PERSONALITY_MODIFIERS: Record<PersonalityTag, { loyaltyMod: number; proposalMod: number }> = {
  'high_charisma': { loyaltyMod: +10, proposalMod: +15 },
  'high_iq':       { loyaltyMod:  0,  proposalMod: +10 },
  'high_eq':       { loyaltyMod: +5,  proposalMod: +20 },
  'ruthless':      { loyaltyMod: -5,  proposalMod: -5 },
  'righteous':     { loyaltyMod: +20, proposalMod: -10 },
  'opportunist':   { loyaltyMod: -15, proposalMod: +5 },
  'idealist':      { loyaltyMod: +10, proposalMod: -15 },
  'realist':       { loyaltyMod:  0,  proposalMod: +10 },
};

// ─── 军事风格参数表 ───
export const MILITARY_STYLE_PARAMS: Record<MilitaryTag, {
  formation: 'wedge' | 'line' | 'spindle' | 'circle' | 'square' | 'flexible';
  attackMod: number;
  retreatThreshold: number; // 剩余兵力百分比
}> = {
  'frontal_assault':  { formation: 'wedge',    attackMod: 1.3, retreatThreshold: 0.20 },
  'counter_defense':  { formation: 'square',   attackMod: 0.8, retreatThreshold: 0.35 },
  'firepower':        { formation: 'line',     attackMod: 1.1, retreatThreshold: 0.25 },
  'mobile_raid':      { formation: 'spindle',  attackMod: 1.2, retreatThreshold: 0.30 },
  'logistics_focus':  { formation: 'circle',   attackMod: 0.9, retreatThreshold: 0.40 },
  'intel_focus':      { formation: 'flexible', attackMod: 1.0, retreatThreshold: 0.30 },
  'cautious':         { formation: 'square',   attackMod: 0.7, retreatThreshold: 0.45 },
  'aggressive':       { formation: 'wedge',    attackMod: 1.4, retreatThreshold: 0.15 },
};

// ─── 能力倾向职位适配表 ───
export const ROLE_FITNESS_MAP: Record<AbilityTag, NationalRole[]> = {
  'tactician':     ['fleet_commander', 'defense_commander'],
  'strategist':    ['high_command_chief', 'joint_ops_chief'],
  'politician':    ['prime_minister', 'council'],
  'administrator': ['military_minister', 'defense_commander'],
  'diplomat':      ['intel_minister'],
};

// ─── 职务投票影响系数表（从 gameStore 旧逻辑提取） ───
// 某些职务对特定提案类型有额外倾向或反对
export const ROLE_VOTE_INFLUENCE: Record<string, Partial<Record<ProposalType, number>>> = {
  'high_command_chief':  { invasion: -20 },
  'joint_ops_chief':     { invasion: -20 },
  'military_minister':   { budget: -40 },
  'council':             { budget: -40 },
  'prime_minister':      { budget: -40 },
};

// ─── 互斥标签组 ───
export const MUTUAL_EXCLUSION_GROUPS: AdmiralTag[][] = [
  ['cautious', 'aggressive'],         // 军事：谨慎 ↔ 冒险
  ['frontal_assault', 'mobile_raid'], // 军事：突击 ↔ 突袭
  ['ruthless', 'righteous'],          // 人格：冷酷 ↔ 义理
  ['idealist', 'realist'],            // 人格：理想 ↔ 现实
];

// ─── 对立标签对（跨人物兼容性计算用） ───
export const ANTAGONISTIC_TAGS: [AdmiralTag, AdmiralTag][] = [
  ['aristocrat', 'reformer'],
  ['militarist', 'pacifist'],
  ['ambition_faction', 'royalist'],
  ['ruthless', 'righteous'],
  ['idealist', 'realist'],
];

// ─── 政治立场分类标签列表（用于派系聚类） ───
export const POLITICAL_TAGS: PoliticalTag[] = [
  'aristocrat', 'reformer', 'democrat', 'militarist', 'pacifist', 'royalist', 'ambition_faction',
];

// ─── 标签上限常量 ───
export const MAX_TAGS_PER_ADMIRAL = 6;
export const TAG_LIMITS: Record<TagCategory, number> = {
  political: 1,
  military: 2,
  personality: 2,
  ability: 1,
};

// ─── 辅助函数：标签分类判断 ───
export function isPoliticalTag(tag: AdmiralTag): tag is PoliticalTag {
  return tag in POLITICAL_VOTE_COEFFICIENTS;
}

// ─── 辅助函数：按分类筛选标签 ───
export function getTagsByCategory(tags: AdmiralTag[], category: TagCategory): AdmiralTag[] {
  return tags.filter(t => TAG_META_MAP[t]?.category === category);
}

// ─── 辅助函数：标签兼容性计算（投票用） ───
export function calculateTagCompatibility(tagsA: AdmiralTag[], tagsB: AdmiralTag[]): number {
  let score = 0;

  // 政治立场：相同立场 +15
  const politicalA = tagsA.filter(isPoliticalTag);
  const politicalB = tagsB.filter(isPoliticalTag);
  const sharedPolitical = politicalA.filter(t => politicalB.includes(t));
  score += sharedPolitical.length * 15;

  // 对立标签检测
  ANTAGONISTIC_TAGS.forEach(([a, b]) => {
    if (tagsA.includes(a) && tagsB.includes(b)) score -= 20;
    if (tagsA.includes(b) && tagsB.includes(a)) score -= 20;
  });

  // 人格冲突：righteous vs opportunist
  if (tagsA.includes('righteous') && tagsB.includes('opportunist')) score -= 15;
  if (tagsA.includes('opportunist') && tagsB.includes('righteous')) score -= 15;

  return Math.max(-20, Math.min(20, score));
}

// ─── 辅助函数：获取政治立场中文标签（UI 用） ───
export function getPoliticalStanceLabel(tags: AdmiralTag[]): { label: string; css: string } {
  const political = tags.filter(isPoliticalTag);
  if (political.includes('militarist') || political.includes('ambition_faction'))
    return { label: '主战', css: 'stance-hawk' };
  if (political.includes('pacifist') || political.includes('democrat'))
    return { label: '保守', css: 'stance-cons' };
  if (political.includes('aristocrat') || political.includes('royalist'))
    return { label: '保守', css: 'stance-cons' };
  if (political.includes('reformer'))
    return { label: '改革', css: 'stance-reform' };
  return { label: '中立', css: 'stance-neutral' };
}

// ─── 辅助函数：标签验证（互斥检查 + 上限检查） ───
export function validateTags(tags: AdmiralTag[]): string[] {
  const errors: string[] = [];

  // 互斥标签检测
  for (const group of MUTUAL_EXCLUSION_GROUPS) {
    const conflicts = group.filter(t => tags.includes(t));
    if (conflicts.length > 1) {
      errors.push(`互斥标签冲突: ${conflicts.map(t => TAG_META_MAP[t].label).join(' ↔ ')}`);
    }
  }

  // 各分类数量检查
  for (const [category, limit] of Object.entries(TAG_LIMITS)) {
    const count = tags.filter(t => TAG_META_MAP[t]?.category === category).length;
    if (count > limit) {
      errors.push(`${category} 类标签超出上限 (${count}/${limit})`);
    }
  }

  // 总数检查
  if (tags.length > MAX_TAGS_PER_ADMIRAL) {
    errors.push(`标签总数超出上限 (${tags.length}/${MAX_TAGS_PER_ADMIRAL})`);
  }

  return errors;
}
