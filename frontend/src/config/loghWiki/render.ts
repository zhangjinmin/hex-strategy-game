// ==================================================
// File: src/config/loghWiki/render.ts
// 词条渲染层：把原始词条编译成「结构化片段」
//
// 设计要点：
//   1) 不走 v-html。语料中的 <strong> 在上游解析为 bold 标记，
//      模板只渲染纯文本 + class，彻底消除 HTML 注入面。
//   2) 自动互链用「首字符索引」加速：每个字符位只查首字符相同的
//      少数候选，把 linkify 从 O(n×242) 降到近似 O(n×2)。
//   3) 段落内同词条只链一次、每段链接上限 5 个，避免正文变成蓝色海洋。
// ==================================================

import type {
    WikiEntry,
    WikiParagraph,
    RichFragment,
    RichPara,
    RichSub,
    RichSection,
    RichEntry,
} from './types';
import { loadWiki, loadWikiList } from './index';

// --------------------------------------------------
// 静态资源路径
// --------------------------------------------------

const RAW_BASE = import.meta.env.BASE_URL || './';

/** 把词条数据里的 `images/xxx.jpg` 解析为可运行时加载的 URL */
export function wikiAsset(p?: string): string {
    if (!p) return '';
    const rel = p.replace(/^images\//, 'logh-images/');
    if (/^(https?:|data:|\/)/.test(rel)) return rel;
    const base = RAW_BASE.endsWith('/') ? RAW_BASE : RAW_BASE + '/';
    return base + rel;
}

// --------------------------------------------------
// 富文本解析
// --------------------------------------------------

/** HTML 实体还原 */
function unescape(s: string): string {
    return s
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/** 剥离除 <strong> 外的所有标签（数据源经扫描确认仅含 strong，此处为防御） */
function stripTags(s: string): string {
    return s.replace(/<(?!\/?strong\b)[^>]*>/gi, '');
}

interface Block {
    text: string;
    bold: boolean;
}

/** 把原文切成「普通块 / 加粗块」的有序序列 */
function splitBold(raw: string): Block[] {
    const s = stripTags(raw);
    const out: Block[] = [];
    const re = /<strong>([\s\S]*?)<\/strong>/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
        out.push({ text: m[1], bold: true });
        last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ text: s.slice(last), bold: false });
    return out.filter((b) => b.text.length > 0);
}

// --------------------------------------------------
// 自动互链
// --------------------------------------------------

interface TitleNode {
    title: string;
    key: string;
}

let _index: Map<string, TitleNode[]> | null = null;

async function ensureIndex(): Promise<Map<string, TitleNode[]>> {
    if (_index) return _index;
    const list = await loadWikiList();
    const m = new Map<string, TitleNode[]>();
    for (const e of list) {
        const t = e.title;
        if (t.length < 2) continue;
        const c = t[0];
        let arr = m.get(c);
        if (!arr) {
            arr = [];
            m.set(c, arr);
        }
        arr.push({ title: t, key: e.key });
    }
    // 组内长标题优先，避免「派特」抢在更长的同前缀标题之前
    for (const arr of m.values()) arr.sort((a, b) => b.title.length - a.title.length);
    _index = m;
    return _index;
}

/**
 * 短标题误伤防护。
 *
 * 依据：对全部 242 条词条语料的出现位置统计 ——
 *   「派特」共出现 8 次，其中 4 次实为「派特里契夫」的前缀
 *   （即费奥多·帕特里契夫，提督 id=135），命中该形态时跳过，
 *   否则会把「派特里契夫」错误链到同名的「派特」词条。
 * 其余 27 个 ≤3 字标题经统计无可复现的前缀吞并形态。
 */
const BLOCK_SUFFIX: Record<string, string[]> = {
    派特: ['里契夫'],
};

function isBlocked(text: string, at: number, title: string): boolean {
    const suf = BLOCK_SUFFIX[title];
    if (!suf) return false;
    const rest = text.slice(at + title.length, at + title.length + 4);
    return suf.some((s) => rest.startsWith(s));
}

/** 段落内最多建立的自动链接数 */
const MAX_LINKS_PER_PARA = 5;

async function linkifyBlock(text: string, exclude: Set<string>): Promise<RichFragment[]> {
    const idx = await ensureIndex();
    const frags: RichFragment[] = [];
    const used = new Set<string>();
    let i = 0;
    let buf = '';
    let links = 0;

    while (i < text.length) {
        let hit: TitleNode | null = null;
        if (links < MAX_LINKS_PER_PARA) {
            const bucket = idx.get(text[i]);
            if (bucket) {
                for (const t of bucket) {
                    if (t.title.length > text.length - i) continue;
                    if (exclude.has(t.key) || used.has(t.key)) continue;
                    if (isBlocked(text, i, t.title)) continue;
                    if (text.startsWith(t.title, i)) {
                        hit = t;
                        break;
                    }
                }
            }
        }
        if (hit) {
            if (buf) {
                frags.push({ text: buf });
                buf = '';
            }
            frags.push({ text: hit.title, key: hit.key });
            used.add(hit.key);
            links += 1;
            i += hit.title.length;
        } else {
            buf += text[i];
            i += 1;
        }
    }
    if (buf) frags.push({ text: buf });
    return frags;
}

/** 渲染一段原始文本（含加粗解析 + 自动互链） */
export async function renderText(raw: string, exclude: Set<string> = new Set()): Promise<RichFragment[]> {
    const blocks = splitBold(raw);
    const out: RichFragment[] = [];
    for (const b of blocks) {
        if (b.bold) {
            out.push({ text: unescape(b.text), bold: true });
            continue;
        }
        const frags = await linkifyBlock(unescape(b.text), exclude);
        out.push(...frags);
    }
    return out;
}

// --------------------------------------------------
// 词条编译
// --------------------------------------------------

function fragLen(frags: RichFragment[]): number {
    return frags.reduce((a, f) => a + f.text.length, 0);
}

async function buildRichEntry(entry: WikiEntry): Promise<RichEntry> {
    const exclude = new Set<string>([entry.key]);

    // 属性表
    const infoRows: RichEntry['infoRows'] = [];
    for (const [k, v] of Object.entries(entry.infobox || {})) {
        const lines = String(v)
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        const rendered: RichFragment[][] = [];
        for (const ln of lines) rendered.push(await renderText(ln, exclude));
        if (rendered.length) infoRows.push({ k, lines: rendered });
    }

    // 导语
    const lead = await renderText(entry.lead || '', exclude);

    // 正文
    const sections: RichSection[] = [];
    for (const sec of entry.sections || []) {
        const subs: RichSub[] = [];
        let chars = 0;
        for (const sub of sec.subs || []) {
            const paras: RichPara[] = [];
            for (const p of (sub.paras || []) as WikiParagraph[]) {
                if (typeof p === 'string') {
                    chars += p.length;
                    paras.push({ kind: 'text', frags: await renderText(p, exclude), items: [] });
                } else {
                    const items: RichFragment[][] = [];
                    for (const li of p) {
                        chars += li.length;
                        items.push(await renderText(li, exclude));
                    }
                    paras.push({ kind: 'list', frags: [], items });
                }
            }
            subs.push({ heading: sub.heading || '', paras });
        }
        sections.push({ title: sec.title, subs, chars });
    }

    const totalChars = fragLen(lead) + sections.reduce((a, s) => a + s.chars, 0);

    return {
        key: entry.key,
        title: entry.title,
        category: entry.category,
        infoRows,
        lead,
        sections,
        image: wikiAsset(entry.image),
        gallery: (entry.gallery || []).map((g) => wikiAsset(g)).filter(Boolean),
        totalChars,
    };
}

const _cache = new Map<string, Promise<RichEntry>>();

/** 编译词条（带缓存，重复打开零成本） */
export function compileEntry(entry: WikiEntry): Promise<RichEntry> {
    const hit = _cache.get(entry.key);
    if (hit) return hit;
    const p = buildRichEntry(entry);
    _cache.set(entry.key, p);
    return p;
}

/** 按 key 编译词条 */
export async function compileEntryByKey(key: string): Promise<RichEntry | null> {
    const map = await loadWiki();
    let e: WikiEntry | undefined = map[key];
    if (!e) {
        // 防御兜底：映射表若误填「页面标题」而非「页面文件名键」，按标题再查一次。
        // 数据侧已修正，此处仅防御未来新增映射时的手误。
        e = Object.values(map).find((x) => x.title === key);
    }
    if (!e) return null;
    return compileEntry(e);
}

/** 该键是否可解析出词条（供列表/调试使用） */
export async function hasWikiEntryKey(key: string): Promise<boolean> {
    const map = await loadWiki();
    if (map[key]) return true;
    return Object.values(map).some((x) => x.title === key);
}

/** 词条列表中带缩略图的条目 */
export interface WikiListItem {
    key: string;
    title: string;
    category: string;
    thumb: string;
    leadPreview: string;
}

let _listItems: WikiListItem[] | null = null;

/** 取精简列表（列表页/搜索用，避免携带全文） */
export async function getWikiListItems(): Promise<WikiListItem[]> {
    if (_listItems) return _listItems;
    const list = await loadWikiList();
    _listItems = list.map((e) => ({
        key: e.key,
        title: e.title,
        category: e.category,
        thumb: wikiAsset(e.image),
        leadPreview: String(e.lead || '')
            .replace(/<[^>]+>/g, '')
            .slice(0, 70),
    }));
    return _listItems;
}
