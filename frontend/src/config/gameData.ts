export const classToTypeCode: Record<string, string> = {
  '战列': 'BB',
  '高战': 'FB',
  '巡洋': 'CA',
  '驱逐': 'DD',
  '空母': 'CV',
  '舰载': 'FT',
  '突击': 'AS',
  '电子': 'EW',
  '补给': 'AUX',
  '无': 'AUX'
};

export const REFUGEE = { 
  id: 'refugee', name: '武装商船', shape: 'C', faction: 'none', cls: '无', 
  level: 1, chips: 0, hp: 15, atk: 2, def: 0, range: 12, interval: 1500, 
  speed: 0.5, quality: 1, desc: '降维生成，毫无火力。' 
};

export const availableFactions = [
  { id: 'empire', name: '银河帝国', desc: '罗严克拉姆正统 (突击舰移速+15%)', color: 0xef4444, cssColor: '#ef4444' },
  { id: 'alliance', name: '自由行星同盟', desc: '民主与均衡 (战列舰火力+10%)', color: 0x3b82f6, cssColor: '#3b82f6' },
  { id: 'nobles', name: '门阀贵族', desc: '旧体制遗毒 (大盘初始资金+100)', color: 0xa855f7, cssColor: '#a855f7' },
  { id: 'rebels', name: '救国军事会议', desc: '政变铁血 (全装甲与要塞防+20%)', color: 0x10b981, cssColor: '#10b981' }
];

export const diffConfig = [
  { level: 'easy', name: '局部冲突', desc: '充裕后勤，快速扩张' },
  { level: 'normal', name: '会战', desc: '标准星际战争' },
  { level: 'hard', name: '诸神之黄昏', desc: '敌军拥有压倒性舰队规模' }
];

export const troopNames: Record<string, Record<string, string[]>> = {
  empire: {
    '战列': ['齐格蒙德级','瓦伦丁级','纽伦堡装甲舰'],
    '巡洋': ['帝国护卫舰','标准巡洋舰','防空阵列舰'],
    '驱逐': ['轻型炮舰','标准驱逐舰','重火力驱逐舰'],
    '突击': ['突击登陆艇','女武神战机','高速突击舰'],
    '电子': ['侦察护卫舰','雷达观测舰','全频段干扰舰'],
    '补给': ['武装运输舰','装甲工程舰','战地医疗舰']
  },
  alliance: {
    '战列': ['天狼星级','休马松级','波罗丁重装舰'],
    '巡洋': ['边境巡防舰','同盟巡洋舰','密集阵防空舰'],
    '驱逐': ['改装炮艇','标准驱逐舰','远射导弹舰'],
    '突击': ['空战小队','斯巴达尼恩','强袭登陆舰'],
    '电子': ['边境预警机','电子干扰舰','区域压制舰'],
    '补给': ['民用补给船','战列维修舰','综合补给舰']
  },
  nobles: {
    '战列': ['私军护卫舰','贵族战列舰','门阀重装舰'],
    '巡洋': ['领地巡逻舰','贵族巡洋舰','华丽防空舰'],
    '驱逐': ['猎犬级炮舰','贵族驱逐舰','重型导弹舰'],
    '突击': ['私兵突击艇','贵族护卫战机','高速私掠舰'],
    '电子': ['私人游艇','情报监听舰','广域干扰舰'],
    '补给': ['奢华补给舰','私库运输舰','贵族医疗船']
  },
  rebels: {
    '战列': ['觉醒级炮舰','革命战列舰','断头台重装舰'],
    '巡洋': ['治安巡逻舰','反抗巡洋舰','铁壁防空舰'],
    '驱逐': ['游击驱逐舰','激进炮舰','高爆弹突击舰'],
    '突击': ['起义军小队','亡命突击艇','破袭登陆舰'],
    '电子': ['广播宣传舰','政变干扰舰','网络控制舰'],
    '补给': ['征用运输船','紧急抢修舰','前线医疗舰']
  }
};

/** 舰载机阵营命名：航母舰载机不占独立编队槽，随母舰出战，仅显示名不同。
 *  帝国 = 王尔古雷（Walküre，游戏内译"女武神"）；同盟 = 斯巴达尼恩（Spartanian）。 */
export const FIGHTER_NAMES: Record<string, { name: string; codeName: string }> = {
  empire:   { name: '王尔古雷', codeName: 'WK-Ⅱ 女武神' },
  alliance: { name: '斯巴达尼恩', codeName: 'SP-Ⅲ 斯巴达尼恩' },
  nobles:   { name: '贵族护卫机', codeName: 'NB-Ⅰ 私兵战机' },
  rebels:   { name: '亡命突击机', codeName: 'RB-Ⅰ 破袭战机' },
};

/** 按阵营取舰载机显示名（faction 字段为 'empire' / 'alliance' 等） */
export function getFighterName(faction: string): string {
  return FIGHTER_NAMES[faction]?.name || '舰载机';
}

/** 阵营可用舰种限制：同盟无高速战列舰（原著设定：同盟舰队以标准战列舰为主力）。
 *  未列出的阵营 = 全部舰种可用。 */
export const FACTION_SHIP_RESTRICTION: Record<string, string[]> = {
  // 同盟禁用高速战列舰
  alliance: ['fast_battleship'],
};

/** 判断某阵营是否可用某舰种 */
export function isShipAllowedForFaction(faction: string, shipType: string): boolean {
  const banned = FACTION_SHIP_RESTRICTION[faction];
  return !banned || !banned.includes(shipType);
}


export const baseStats: Record<string, any> = {
  // v5 超视距射程分层：激光（战列/高战/空母/电子）远程 / 导弹（巡洋）中程 / 舰载机（驱逐/突击/舰载）近程
  '战列': { hp: 1200, atk: 45, def: 15, range: 880, interval: 3500, speed: 0.4 },
  '高战': { hp: 1050, atk: 42, def: 13, range: 840, interval: 3200, speed: 0.55 },
  '巡洋': { hp: 800, atk: 28, def: 10, range: 720, interval: 2500, speed: 0.5 },
  '驱逐': { hp: 450, atk: 18, def: 5,  range: 580, interval: 1800, speed: 0.7 },
  '空母': { hp: 900, atk: 15, def: 12, range: 880, interval: 4000, speed: 0.35 },
  '舰载': { hp: 150, atk: 35, def: 2,  range: 640, interval: 1500, speed: 1.2 },
  '突击': { hp: 250, atk: 35, def: 2,  range: 560, interval: 1200, speed: 0.9 },
  '电子': { hp: 350, atk: 8,  def: 8,  range: 760, interval: 4000, speed: 0.6 },
  '补给': { hp: 500, atk: 5,  def: 5,  range: 300, interval: 5000, speed: 0.5 },
};

export const defaultMaps = [
  { id: 'random', name: '随机演算星域', size: '动态', desc: '系统随机生成未知宇宙与核心资源点。' },
  { id: 'standard', name: '伊谢尔伦要塞战', size: '61×29', desc: '帝国军最强要塞。雷神之锤主炮每90秒充能发射，威力足以歼灭整支舰队；摧毁要塞（HP 10000）可瘫痪主炮。攻方自西缘进场，守方驻防要塞。' }
];

export const brushOptions = [
  { id: 'pending', name: '普通空域', color: '#334155' },
  { id: 'sea', name: '深渊星云', color: '#1e3a8a' },
  { id: 'ruined', name: '暗物质带', color: '#1c1917' },
  { id: 'pier', name: '跳跃节点', color: '#0284c7' },
  { id: 'castle', name: '战役旗舰', color: '#ef4444' },
  { id: 'planet', name: '宜居行星', color: '#fbbf24' },
  { id: 'fortress', name: '要塞地块', color: '#8a8a9a' },
];

export const generateInitialTroops = () => {
  const qMult = [1, 1.2, 1.5, 2.0, 3.0];
  const generatedTroops: any[] = [];
  Object.keys(troopNames).forEach(fac => {
     Object.keys(troopNames[fac]).forEach(cls => {
        troopNames[fac][cls].forEach((name, idx) => {
           const q = idx + 1;
           const base = baseStats[cls];
           generatedTroops.push({
              id: `${fac}_${cls}_${q}`, name: name, faction: fac, cls: cls,
              shape: classToTypeCode[cls] || 'AUX', level: 1, chips: 0,
              hp: Math.floor(base.hp * qMult[idx]), atk: Math.floor(base.atk * qMult[idx]),
              def: Math.floor(base.def * qMult[idx]), range: base.range,
              interval: Math.max(300, base.interval - (idx * 100)),
              speed: base.speed + (idx * 0.05), quality: q,
           });
        });
     });
  });
  return generatedTroops;
};