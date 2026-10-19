/**
 * OpenType `name` 表解析（纯函数 · 零依赖 · 无 DOM）。
 *
 * 为什么单独成文件：`fontManager.ts` 里有 `import.meta.glob`（Vite 专属），
 * 在 Node 台架里 require 不了；而"名字取得对不对"恰恰是**最需要台架锁住**的部分
 * （`DataView` 的偏移/字节序错一位，结果就是乱码或静默回落，肉眼很难发现）。
 * ⇒ 把纯解析部分抽出来，台架直接喂真实字体文件跑。
 *
 * 只支持未压缩的 sfnt（`.ttf` / `.otf` / 字体集合 `ttcf`）。
 * `.woff2` 的 `name` 表被 brotli 压缩，需要解压器 —— 本项目不为此引入依赖，
 * 这类文件由调用方回落文件名。
 */

/** 一个字体里可用的名称字段。 */
export interface FontNameTable {
  /** nameID 1（family）或 16（typographic family） */
  family?: string;
  /** nameID 4（full name） */
  full?: string;
}

/** 需要收集的 nameID。 */
const NAME_IDS = [1, 4, 16] as const;

/**
 * 各语言记录的优先级评分（越高越优先）。
 *
 * 规则来源：同一字体里 `family` 可能同时存在英文（pid 3 / lid 0x0409）与中文
 * （pid 3 / lid 0x0804）两条记录。用户要的是"字体工具里显示的那个名字"，
 * 对中文用户而言就是中文记录 ⇒ 中文/日韩记录优先，其次英文，其余最后。
 * 平台分：Windows(3) / Unicode(0) 的编码可靠（UTF-16BE）；Mac(1) 多为 MacRoman，
 * 直接按字节转字符会把中文变成乱码（实测阿里健康体的 Mac 记录就是乱码），故给 0。
 */
function languageScore(platformID: number, languageID: number): number {
  const isCjk = languageID === 0x0804 || languageID === 0x0404
    || languageID === 0x0c04 || languageID === 0x1004
    || languageID === 0x0411 || languageID === 0x0412;
  const platform = platformID === 0 || platformID === 3 ? 2 : 0;
  return platform + (isCjk ? 4 : languageID === 0x0409 ? 1 : 0);
}

/**
 * 解析字体二进制里的 `name` 表。
 * @param buf 字体文件的完整字节（`ArrayBuffer`）
 * @returns 取不到时返回 `null`（绝不抛错 —— 调用方要能安静回落到文件名）
 */
export function parseFontNameTable(buf: ArrayBuffer): FontNameTable | null {
  if (!buf || buf.byteLength < 12) return null;
  const dv = new DataView(buf);
  const numTag = dv.getUint32(0);

  // 'ttcf' = 字体集合（一个文件装多个字重）：取第一个子字体的表目录
  let base = 0;
  if (numTag === 0x74746366) {
    if (buf.byteLength < 16) return null;
    base = dv.getUint32(12);
    if (base + 12 > buf.byteLength) return null;
  } else if (numTag !== 0x00010000 && numTag !== 0x4f54544f /* OTTO */) {
    // 既不是 TrueType/OpenType 也不是集合 ⇒ 不是我们能解析的容器
    return null;
  }

  const numTables = dv.getUint16(base + 4);
  let nameOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > buf.byteLength) break;
    if (dv.getUint32(rec) === 0x6e616d65) { // 'name'
      nameOff = dv.getUint32(rec + 8);
      break;
    }
  }
  if (nameOff < 0 || nameOff + 6 > buf.byteLength) return null;

  const count = dv.getUint16(nameOff + 2);
  const stringBase = nameOff + dv.getUint16(nameOff + 4);
  const best = new Map<number, { text: string; score: number }>();

  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12;
    if (r + 12 > buf.byteLength) break;
    const platformID = dv.getUint16(r);
    const languageID = dv.getUint16(r + 4);
    const nameID = dv.getUint16(r + 6) as (typeof NAME_IDS)[number];
    if (!NAME_IDS.includes(nameID)) continue;
    const len = dv.getUint16(r + 8);
    const off = stringBase + dv.getUint16(r + 10);
    if (len === 0 || off + len > buf.byteLength) continue;

    let text = '';
    if (platformID === 0 || platformID === 3) {
      for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(dv.getUint16(off + k));
    } else {
      for (let k = 0; k < len; k++) text += String.fromCharCode(dv.getUint8(off + k));
    }
    // 记录里可能夹 NUL（某些导出器把 UTF-16 补齐到偶数长度时留下）
    text = text.replace(/\u0000/g, '').trim();
    if (!text) continue;

    const score = languageScore(platformID, languageID) + (nameID === 1 ? 2 : 0);
    const prev = best.get(nameID);
    if (!prev || score > prev.score) best.set(nameID, { text, score });
  }

  const family = best.get(1)?.text ?? best.get(16)?.text;
  const full = best.get(4)?.text;
  if (!family && !full) return null;
  return { family, full };
}
