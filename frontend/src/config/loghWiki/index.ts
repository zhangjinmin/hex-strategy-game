// ==================================================
// File: src/config/loghWiki/index.ts
// 词条库访问器：懒加载 + 查询
//
// 设计说明：
//   词条全量约 20 万字符，静态 import 会拖慢首屏，
//   故正文数据经动态 import 分包，首次打开名册/百科时再加载。
// ==================================================

import type { WikiEntry, WikiCategory } from './types';
import { ADMIRAL_WIKI_MAP, WIKI_TO_ADMIRALS } from './admiralWikiMap';

export * from './types';
export { ADMIRAL_WIKI_MAP, WIKI_TO_ADMIRALS };

let _cache: Record<string, WikiEntry> | null = null;
let _loading: Promise<Record<string, WikiEntry>> | null = null;
let _listCache: WikiEntry[] | null = null;

/** 懒加载全部词条（key -> entry） */
export async function loadWiki(): Promise<Record<string, WikiEntry>> {
    if (_cache) return _cache;
    if (!_loading) {
        _loading = import('./wikiEntries').then((m) => {
            _cache = m.WIKI_BY_KEY as Record<string, WikiEntry>;
            return _cache;
        });
    }
    return _loading;
}

/** 懒加载词条数组（用于列表/搜索） */
export async function loadWikiList(): Promise<WikiEntry[]> {
    if (_listCache) return _listCache;
    await loadWiki();
    const m = await import('./wikiEntries');
    _listCache = m.WIKI_ENTRIES as WikiEntry[];
    return _listCache;
}

/** 取某提督绑定的词条 key */
export function getWikiKeyForAdmiral(admiralId: number): string | undefined {
    return ADMIRAL_WIKI_MAP[admiralId];
}

/** 是否已有词条覆盖 */
export function hasWikiForAdmiral(admiralId: number): boolean {
    return !!ADMIRAL_WIKI_MAP[admiralId];
}

/**
 * 正文互链：在文本中把其他词条标题标为可跳转。
 * 返回分段数组，命中项带 key。
 */
export interface TextFragment {
    text: string;
    key?: string;
}

let _titleIndex: { title: string; key: string }[] | null = null;

async function ensureTitleIndex() {
    if (_titleIndex) return _titleIndex;
    const list = await loadWikiList();
    _titleIndex = list
        .map((e) => ({ title: e.title, key: e.key }))
        // 长标题优先匹配，避免「杨威利」被「杨」之类短词抢占
        .sort((a, b) => b.title.length - a.title.length);
    return _titleIndex;
}

/** 把一段文本切成「纯文本 / 可跳转词条」的片段序列 */
export async function linkify(raw: string, excludeKeys: string[] = []): Promise<TextFragment[]> {
    const idx = await ensureTitleIndex();
    const skip = new Set(excludeKeys);
    const frags: TextFragment[] = [];
    let i = 0;
    let buf = '';
    while (i < raw.length) {
        let hit: { title: string; key: string } | null = null;
        for (const t of idx) {
            if (t.title.length < 2) continue;
            if (t.title.length > raw.length - i) continue;
            if (skip.has(t.key)) continue;
            if (raw.startsWith(t.title, i)) { hit = t; break; }
        }
        if (hit) {
            if (buf) { frags.push({ text: buf }); buf = ''; }
            frags.push({ text: hit.title, key: hit.key });
            i += hit.title.length;
        } else {
            buf += raw[i];
            i += 1;
        }
    }
    if (buf) frags.push({ text: buf });
    return frags;
}
