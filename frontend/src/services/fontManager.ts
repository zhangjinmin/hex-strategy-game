/**
 * [v66] 界面字体管理：自动发现 + 动态 @font-face + 即时切换。
 *
 * 目录约定：把 .ttf / .otf / .woff2 直接丢进 `frontend/src/assets/fonts/` 即可，
 * 重新 build（dev 下 Vite 会热更新 glob 结果）后就会出现在「设置 → 字体」里，**不需要改任何代码**。
 *
 * 设计要点：
 *  · `import.meta.glob(..., { eager: true, query: '?url', import: 'default' })` 只预解析 **URL**，
 *    字体二进制仍然是「用到才下载」（打开设置页渲染预览、或选中该字体时才拉文件），不会拖慢启动。
 *  · 动态注入 `<style>` 里的 @font-face（而不是只用 new FontFace()）—— 保证 CSS 里 `var(--dmc-font)`
 *    引用的族名能被解析，且在 DevTools 里可见可排查。
 *  · 内置的 `lemi-pixel.ttf` 复用 App.vue 里已有的 `@font-face { font-family:'LeMiPixel' }`，
 *    不再重复注入同名族（否则同一份 2.4MB 会被注册两次）。
 *  · 切换只改 `--dmc-font` / `--dmc-font-mono` 两个变量 —— `--font-family` 是 `var(--dmc-font)` 的别名，
 *    所以整站（含 mono 语义的数值位）会一起换，不会出现「只换了一半」。
 */

export interface FontEntry {
  /** 稳定标识：相对 assets/fonts 的文件名（含扩展名），用于持久化 */
  id: string;
  /** 显示名（文件名去扩展名后美化） */
  displayName: string;
  /** 注入到 CSS 的 font-family 族名（唯一，避免和系统字体撞名） */
  family: string;
  /** 打包后的字体 URL */
  url: string;
  /** @font-face 的 format() 值 */
  format: 'truetype' | 'opentype' | 'woff2';
  /** 是否为内置字体（内置的不允许在 UI 上「删除」，也不重复注入） */
  builtin: boolean;
}

/** 内置族名映射：这些文件的 @font-face 已经写死在别处，直接复用其族名。 */
const BUILTIN_FAMILY: Record<string, string> = {
  'lemi-pixel.ttf': 'LeMiPixel',
};

/** 内置字体的显示名（品牌名，比自动生成的 "Lemi Pixel" 好认）。 */
const DISPLAY_NAME_OVERRIDE: Record<string, string> = {
  'lemi-pixel.ttf': '乐米像素体',
  'nunito-v16-latin-regular.woff2': 'Nunito（仅拉丁）',
  // [v99] 显示名优先与**字体文件内置名称**一致 —— 用户按名字找字体，
  //   而 `Smiley-Sans.ttf` 自动美化成 "Smiley Sans" 后，中文用户反而找不到"得意黑"。
  //   下面是按 OpenType `name` 表实测结果登记的（不是猜的）：
  //     jiangjunti.ttf  → family "平方将军体"
  //     Smiley-Sans.ttf → family "Smiley Sans Oblique"（**斜体字重**，故标注出来）
  'Smiley-Sans-Regular.ttf': '得意黑',
  'Smiley-Sans.ttf': '得意黑（斜体）',
  'jiangjunti.ttf': '平方将军体',
};

/** 用户丢进 assets/fonts 的所有字体文件 → URL 映射（编译期收集）。 */
const FONT_URLS = import.meta.glob('../assets/fonts/*.{ttf,otf,woff2}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 从文件名生成可读显示名：`LXGW-WenKai-Regular.ttf` → `LXGW WenKai Regular` */
function toDisplayName(fileName: string): string {
  const base = fileName.replace(/\.(ttf|otf|woff2)$/i, '');
  // 去掉常见的字重/字面后缀，避免列表里出现一长串 "Regular"
  const cleaned = base.replace(/[-_ ](regular|normal|book|medium|bold|light|thin|black)$/i, '');
  return cleaned.replace(/[-_]+/g, ' ').trim() || base;
}

/**
 * 生成 CSS 族名。
 * 用 `DMC_` 前缀 + 仅保留 [A-Za-z0-9_-]，保证 `font-family: "xxx"` 里不需要转义，
 * 也避免用户字体叫 `sans-serif` / `serif` 之类的通用族名时把整站字体劫持掉。
 */
function toFamily(id: string): string {
  if (BUILTIN_FAMILY[id]) return BUILTIN_FAMILY[id];
  const safe = id.replace(/\.(ttf|otf|woff2)$/i, '').replace(/[^A-Za-z0-9_-]/g, '_');
  return `DMC_${safe}`;
}

function toFormat(id: string): FontEntry['format'] {
  const ext = id.toLowerCase().split('.').pop();
  if (ext === 'otf') return 'opentype';
  if (ext === 'woff2') return 'woff2';
  return 'truetype';
}

/** 字体清单（按文件名自然排序，内置的乐米像素体置顶）。 */
export const FONT_CATALOG: FontEntry[] = Object.keys(FONT_URLS)
  .map((path) => {
    const id = path.split('/').pop() as string;
    return {
      id,
      displayName: DISPLAY_NAME_OVERRIDE[id] ?? toDisplayName(id),
      family: toFamily(id),
      url: FONT_URLS[path],
      format: toFormat(id),
      builtin: id in BUILTIN_FAMILY,
    } satisfies FontEntry;
  })
  .sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
  });

/** 「系统字体」选项的 id。
 *
 *  [v99] 从空串改为显式哨兵 `'system'`：
 *   默认值变成得意黑之后，**空串必须让位给"未设置过"**（老存档里存的就是空串），
 *   否则老用户会永远停在系统栈上，看不到新的默认字体；
 *   而"我就是要系统字体"这个选择也需要一个能被持久化、且不会被迁移覆盖的值。
 */
export const SYSTEM_FONT_ID = 'system';

/**
 * [v99] 默认界面字体：**得意黑**（OFL 授权、随包分发）。
 *
 * 为什么换默认为自定义字体：原默认是"系统字体栈"，在 Windows 上会落到 **微软雅黑** ——
 * 雅黑是商业授权字体，不能随程序分发/嵌入，作为默认渲染链的一环在法务上不成立。
 *
 * ⚠ **优先 Regular 字重**：目录里现有 `Smiley-Sans.ttf` 实测是 **Oblique（斜体）** 字重
 *   （OpenType `name` 表 family = "Smiley Sans Oblique"，`head.macStyle` italic=1）。
 *   斜体不适合做界面正文，所以这里按候选表选第一个**实际存在**的文件：
 *   用户把 Regular 版丢进 `assets/fonts/`（文件名 `Smiley-Sans-Regular.ttf`）即自动生效，
 *   无需改代码；只有斜体版时退回斜体，并在列表里明确标出「斜体」。
 */
const DEFAULT_FONT_CANDIDATES = ['Smiley-Sans-Regular.ttf', 'Smiley-Sans.ttf'];
export const DEFAULT_UI_FONT_ID: string =
  DEFAULT_FONT_CANDIDATES.find((id) => FONT_CATALOG.some((f) => f.id === id)) ?? SYSTEM_FONT_ID;

/** 系统字体栈（与 tokens.css 的默认值保持一致，去掉自定义字体段）。
 *
 *  [v99] **移除 `Microsoft YaHei`**：雅黑是商业授权字体，不能随程序分发，
 *  也不该作为默认渲染链的一环（缺字回落直接落到它＝实质依赖）。改用各平台自带的无衬线：
 *   Windows ⇒ `system-ui` 解析到 Segoe UI + 系统中文字体；macOS ⇒ PingFang SC；
 *   Linux ⇒ Noto Sans SC（若已安装）。缺字由通用 `sans-serif` 兜底，不会出豆腐块。
 */
const SYSTEM_SANS = "'Inter', 'Noto Sans SC', system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', sans-serif";
const SYSTEM_MONO = "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace";

export function findFont(id: string): FontEntry | null {
  return FONT_CATALOG.find((f) => f.id === id) ?? null;
}

// ===== 动态 @font-face 注入 =====
let facesInjected = false;

/**
 * 注入所有字体的 @font-face 规则（幂等）。
 * 只写规则、不触发下载：字体文件在该族名第一次真正参与排版时才会请求。
 */
export function ensureFontFacesInjected(): void {
  if (facesInjected) return;
  facesInjected = true;
  if (typeof document === 'undefined') return;

  const rules = FONT_CATALOG
    // 内置 LeMiPixel 已有静态 @font-face（App.vue），跳过避免重复注册同一份 2.4MB 文件
    .filter((f) => !(f.id in BUILTIN_FAMILY))
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${f.url}") format("${f.format}");` +
        `font-style:normal;font-weight:100 900;font-display:swap;}`,
    );

  if (rules.length === 0) return;
  const style = document.createElement('style');
  style.id = 'dmc-user-fonts';
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}

/**
 * 应用字体方案（即时生效，改两个 CSS 变量即可）。
 * @param id 字体 id（见 FONT_CATALOG）；空串/未找到 = 系统默认栈
 * @returns 实际生效的 FontEntry（系统默认返回 null）
 */
export function applyFontFamily(id: string): FontEntry | null {
  const entry = findFont(id);
  const root = document.documentElement;
  if (!entry) {
    root.style.setProperty('--dmc-font', SYSTEM_SANS);
    root.style.setProperty('--dmc-font-mono', SYSTEM_MONO);
    return null;
  }
  ensureFontFacesInjected();
  // 自定义族排最前；后面整条系统栈保留 —— 该字体缺字（生僻汉字、★◆ 等符号）时逐字回落到系统字体，
  // 不会出现豆腐块，也不会让「拉丁用字体 A、汉字用字体 B」的观感断层扩大到整段变形。
  root.style.setProperty('--dmc-font', `'${entry.family}', ${SYSTEM_SANS}`);
  root.style.setProperty('--dmc-font-mono', `'${entry.family}', ${SYSTEM_MONO}`);
  return entry;
}

// ===== 字形覆盖检测（告诉用户「这个字体有没有中文」）=====
const SAMPLE_CJK = '舰况士气补给混战';
const SAMPLE_LATIN = 'AaBbGg0123';

let probeCtx: CanvasRenderingContext2D | null = null;
function getProbeCtx(): CanvasRenderingContext2D | null {
  if (probeCtx) return probeCtx;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 40;
  probeCtx = c.getContext('2d', { willReadFrequently: true });
  return probeCtx;
}

/** 把 text 用指定字体渲染成像素签名（用于和基线比较）。 */
function renderSignature(fontSpec: string, text: string): string {
  const ctx = getProbeCtx();
  if (!ctx) return '';
  ctx.clearRect(0, 0, 240, 40);
  ctx.font = fontSpec;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillText(text, 0, 6);
  return ctx.canvas.toDataURL();
}

/**
 * 判断某字体族是否**自带**该文本的字形。
 *
 * 原理：`document.fonts.check()` 只能判断「字体是否已加载」，判断不了「有没有这个字」——
 * 缺 CJK 字形的字体照样返回 true，所以不能用。这里改用**像素对比**：
 *   同一段文字，一次用 `"Family", monospace`，一次只用 `monospace`；
 *   若两者渲染结果完全一致 ⇒ 该 Family 没有参与这次渲染 ⇒ 说明它缺这些字形（全部回落到 monospace）。
 */
async function hasGlyphs(family: string, text: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    await document.fonts.load(`20px "${family}"`, text);
  } catch {
    /* 加载失败按「无覆盖」处理 */
  }
  const withFamily = renderSignature(`20px "${family}", monospace`, text);
  const baseline = renderSignature('20px monospace', text);
  return withFamily !== baseline;
}

export interface FontCoverage {
  /** 是否含中日韩字形（决定中文会不会回落到系统字体） */
  cjk: boolean;
  /** 是否含拉丁字形 */
  latin: boolean;
}

/** 检测结果缓存：同一字体只需测一次（字体文件很大时测得慢）。 */
const coverageCache = new Map<string, FontCoverage>();

/** 检测某个字体的字形覆盖（异步，带缓存）。 */
export async function detectFontCoverage(entry: FontEntry): Promise<FontCoverage> {
  const cached = coverageCache.get(entry.id);
  if (cached) return cached;
  ensureFontFacesInjected();
  const [cjk, latin] = await Promise.all([hasGlyphs(entry.family, SAMPLE_CJK), hasGlyphs(entry.family, SAMPLE_LATIN)]);
  const result: FontCoverage = { cjk, latin };
  coverageCache.set(entry.id, result);
  return result;
}
