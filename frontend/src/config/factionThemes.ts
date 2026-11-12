// 势力配色方案（可切换，费沙保持琥珀金不变）
export type FactionSchemeKey = 'default' | 'redblue' | 'elegant' | 'highcontrast';

export interface FactionPalette {
  main: number;      // 十六进制颜色（0xRRGGBB）
  glow: string;      // 辉光 RGB（"r,g,b"）
  cont: [number, number, number];  // 大陆纹理 RGB 三元组
}

export interface FactionScheme {
  key: FactionSchemeKey;
  name: string;
  desc: string;
  ally: FactionPalette;
  empire: FactionPalette;
}

export const FACTION_SCHEMES: FactionScheme[] = [
  {
    // [统一界面语言] 与 design-system.css 的同盟蓝 / 帝国金逐位对齐。
    // 原「青 vs 紫」是 CRT 战术盘时代的遗留，会让 3D 星图与界面强调色互相打架；
    // key 不变（存量存档无需迁移），只重定标颜色与显示名。
    key: 'default', name: '正典', desc: '同盟冷蓝 / 帝国金，与界面语言和军服制式统一',
    ally: { main: 0x5B9DFF, glow: '91,157,255', cont: [91, 157, 255] },
    empire: { main: 0xD8B26A, glow: '216,178,106', cont: [216, 178, 106] },
  },
  {
    key: 'redblue', name: '红蓝', desc: '传统大战略敌我识别：同盟冷蓝、帝国警戒红，直观易懂',
    ally: { main: 0x00A8FF, glow: '0,168,255', cont: [0, 168, 255] },
    empire: { main: 0xFF3B30, glow: '255,59,48', cont: [255, 59, 48] },
  },
  {
    key: 'elegant', name: '典雅', desc: '取材双方制服与旗帜主色，兼具历史厚重感',
    ally: { main: 0xFFB703, glow: '255,183,3', cont: [255, 183, 3] },
    empire: { main: 0x3A86FF, glow: '58,134,255', cont: [58, 134, 255] },
  },
  {
    key: 'highcontrast', name: '高对比度', desc: '色弱友好，暗色深空下两军边界切割最清晰',
    ally: { main: 0xFFE600, glow: '255,230,0', cont: [255, 230, 0] },
    empire: { main: 0xFF007F, glow: '255,0,127', cont: [255, 0, 127] },
  },
];
