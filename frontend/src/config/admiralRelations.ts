/**
 * 提督关系矩阵 — 利用 hiddenStats.compatibility 驱动物理/政治/战术效果
 *
 * 设计原则：
 * - compatibility (兼容性): 影响编入同一舰队的buff/debuff
 * - righteousness (正义值): 影响事件中的道德选择偏好
 * - ambition (野心值): 影响叛变概率和晋升欲望
 * - 预设关系对覆盖随机值，体现原著人物关联
 */

// === 预设关系对（覆盖 hiddenStats.compatibility） ===
// 值域 0-100: 0=死敌, 50=中立, 100=挚友
export const PRESET_RELATIONS: { from: number; to: number; compatibility: number; label: string }[] = [
  // 莱因哈特核心圈
  { from: 1, to: 3, compatibility: 100, label: '莱因哈特与齐格飞：生死挚友' },
  { from: 1, to: 10, compatibility: 70, label: '莱因哈特与奥贝斯坦：君臣信任' },
  { from: 1, to: 0, compatibility: 30, label: '莱因哈特与杨威利：惺惺相惜的宿敌' },

  // 齐格飞关系
  { from: 3, to: 0, compatibility: 50, label: '齐格飞与杨威利：相互尊敬' },
  { from: 3, to: 10, compatibility: 35, label: '齐格飞与奥贝斯坦：理念冲突' },

  // 杨威利核心圈
  { from: 0, to: 44, compatibility: 85, label: '杨威利与先寇布：绝对信任' },
  { from: 0, to: 45, compatibility: 80, label: '杨威利与菲列特利加：亲密无间' },
  { from: 0, to: 37, compatibility: 75, label: '杨威利与卡介伦：后勤支柱' },

  // 帝国阵营内的对立
  { from: 10, to: 181, compatibility: 90, label: '奥贝斯坦与皇帝：忠诚侍从' },
];

// === 关系效果 ===

/** 根据 compatibility 返回舰队编队 buff 修正 */
export function getRelationBuff(compatibility: number): {
  moraleBoost: number;
  atkBoost: number;
  defBoost: number;
  label: string;
} {
  if (compatibility >= 80) return { moraleBoost: 15, atkBoost: 0.1, defBoost: 0.05, label: '生死与共' };
  if (compatibility >= 60) return { moraleBoost: 8, atkBoost: 0.05, defBoost: 0, label: '配合默契' };
  if (compatibility >= 40) return { moraleBoost: 0, atkBoost: 0, defBoost: 0, label: '正常工作' };
  if (compatibility >= 20) return { moraleBoost: -5, atkBoost: -0.05, defBoost: 0, label: '互不信任' };
  return { moraleBoost: -15, atkBoost: -0.1, defBoost: -0.05, label: '水火不容' };
}

/** 计算两提督之间的有效兼容值 */
export function getEffectiveCompatibility(adm1Id: number, adm2Id: number, admList: any[]): number {
  // 1. 查预设关系
  const preset = PRESET_RELATIONS.find(
    r => (r.from === adm1Id && r.to === adm2Id) || (r.from === adm2Id && r.to === adm1Id)
  );
  if (preset) return preset.compatibility;

  // 2. 使用 hiddenStats.compatibility 的平均值
  const a1 = admList.find(a => a.id === adm1Id);
  const a2 = admList.find(a => a.id === adm2Id);
  const c1 = a1?.hiddenStats?.compatibility ?? 50;
  const c2 = a2?.hiddenStats?.compatibility ?? 50;
  return Math.round((c1 + c2) / 2);
}

/** 计算提督叛变概率 (0-1) */
export function getDefectionProbability(admiral: any): number {
  const ambition = admiral.hiddenStats?.ambition ?? 50;
  const loyalty = admiral.loyalty ?? 70;
  const righteousness = admiral.hiddenStats?.righteousness ?? 50;

  // 基础概率 = (野心 - 忠诚度) / 200
  const baseProb = Math.max(0, (ambition - loyalty) / 200);
  // 正义修正：高正义值降低叛变概率
  const righteousPenalty = (righteousness - 50) / 500;
  return Math.max(0, Math.min(1, baseProb - righteousPenalty));
}
