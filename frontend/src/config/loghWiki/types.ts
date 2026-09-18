// ==================================================
// File: src/config/loghWiki/types.ts
// 银河英雄传说词条库 —— 类型定义
// ==================================================

/** 词条大类 */
export type WikiCategory = '人物' | '组织' | '地点' | '事件' | '科技';

export const WIKI_CATEGORIES: WikiCategory[] = ['人物', '组织', '地点', '事件', '科技'];

/** 正文段落：字符串为普通段落，字符串数组为无序列表 */
export type WikiParagraph = string | string[];

/** 正文子节（对应 h3） */
export interface WikiSubSection {
    heading: string;
    paras: WikiParagraph[];
}

/** 正文分节（对应 h2） */
export interface WikiSection {
    title: string;
    subs: WikiSubSection[];
}

/** 一条词条 */
export interface WikiEntry {
    /** 稳定键（取自语源页面文件名，如「杨威利」） */
    key: string;
    title: string;
    category: WikiCategory;
    /** 属性表（本名/军衔/旗舰…），键值均为展示文本 */
    infobox: Record<string, string>;
    /** 导语 */
    lead: string;
    /** 正文分节 */
    sections: WikiSection[];
    /** 主图（相对 public 的路径） */
    image?: string;
    /** 图集 */
    gallery?: string[];
}

// --------------------------------------------------
// 渲染层类型
// --------------------------------------------------

/**
 * 富文本片段。
 * 之所以不用 v-html：语料中的 `<strong>` 已在上游解析为 bold 标记，
 * 因此模板只需按 class 渲染纯文本，彻底消除 HTML 注入面。
 */
export interface RichFragment {
    text: string;
    /** 命中词条标题时携带跳转键 */
    key?: string;
    /** 原文 `<strong>` 强调 */
    bold?: boolean;
}

/**
 * 一个段落。
 * 两种形态的字段都设为必填（不适用的为空数组），
 * 这样模板里无需依赖类型窄化，vue-tsc 下更稳。
 */
export interface RichPara {
    kind: 'text' | 'list';
    /** kind === 'text' 时有效 */
    frags: RichFragment[];
    /** kind === 'list' 时有效 */
    items: RichFragment[][];
}

/** 渲染后的子节 */
export interface RichSub {
    heading: string;
    paras: RichPara[];
}

/** 渲染后的分节 */
export interface RichSection {
    title: string;
    subs: RichSub[];
    /** 正文字数，用于折叠态提示体量 */
    chars: number;
}

/** 渲染后的词条 */
export interface RichEntry {
    key: string;
    title: string;
    category: WikiCategory;
    /** 属性表，值已按换行拆分为多行 */
    infoRows: { k: string; lines: RichFragment[][] }[];
    lead: RichFragment[];
    sections: RichSection[];
    image: string;
    gallery: string[];
    /** 全文字数 */
    totalChars: number;
}
