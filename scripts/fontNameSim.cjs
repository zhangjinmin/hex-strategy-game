/**
 * fontNameSim.cjs — 字体内部名解析台架（`services/fontNameTable.ts`）
 *
 * 运行：
 *   node --import ./_ts_resolve.mjs scripts/fontNameSim.cjs
 *
 * 为什么要这个台架：显示名此前只从**文件名**推导，用户在字体工具里看到的是
 * 「阿里健康体2.0 中文 45 R」，游戏里却是「AlibabaHealthFont2.0CN 45 R」。
 * 修法是读 OpenType `name` 表 —— 而这类二进制解析**错一位就是乱码或静默回落**，
 * 只有拿真实字体文件跑断言才能发现。所以本台架直接读 `assets/fonts/` 下的真文件。
 *
 * 纪律：
 *   · `require` 真源码，不在这里重写解析逻辑；
 *   · 断言打**行为**（拿到的名字），不打实现细节；
 *   · 每个字体文件都可以不存在（用户会增删），缺失时**跳过并计数**，不让台架红。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { parseFontNameTable } = require('../frontend/src/services/fontNameTable.ts');

const FONT_DIR = path.join(__dirname, '..', 'frontend', 'src', 'assets', 'fonts');

let passed = 0;
let failed = 0;
let skipped = 0;

function readFont(file) {
  const p = path.join(FONT_DIR, file);
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}\n         ${e.message}\n`);
    process.exitCode = 1;
  }
}

function checkFont(file, expect) {
  const buf = readFont(file);
  if (!buf) {
    skipped += 1;
    process.stdout.write(`  SKIP ${file}（文件不存在）\n`);
    return;
  }
  check(`${file} ⇒ 含「${expect}」`, () => {
    const n = parseFontNameTable(buf);
    if (!n) throw new Error('解析结果为 null');
    const text = `${n.family ?? ''} | ${n.full ?? ''}`;
    if (!text.includes(expect)) throw new Error(`实际 = ${text}`);
  });
}

// ── 1. 真实字体：内部名必须取到（中文记录优先）─────────────────────────────
// 阿里健康体的 name 表里同时有英文（pid3/lid0409）与中文（pid3/lid0804）两条记录，
// 用户要的是中文那条 —— 这条断言就是本轮的 bug 本体。
checkFont('AlibabaHealthFont2.0CN-45R.ttf', '阿里健康体');
checkFont('AlibabaHealthFont2.0CN-85B.ttf', '阿里健康体');
// 得意黑的文件在用户手里换过版本：英文构建内部名是 "Smiley Sans Oblique"，
// 中文构建是「得意黑 斜体」⇒ 两种都接受，只要求**别退化成文件名推导**。
check('Smiley-Sans.ttf ⇒ 内部名可读（得意黑 / Smiley Sans）', () => {
  const buf = readFont('Smiley-Sans.ttf');
  if (!buf) { skipped += 1; return; }
  const n = parseFontNameTable(buf);
  if (!n) throw new Error('解析结果为 null');
  const text = `${n.family ?? ''} | ${n.full ?? ''}`;
  if (!/得意黑|Smiley Sans/i.test(text)) throw new Error(`实际 = ${text}`);
});
checkFont('lemi-pixel.ttf', '乐米像素体');
checkFont('jiangjunti.ttf', '平方将军体');
checkFont('HarmonyOS_Sans_SC_Regular.ttf', 'HarmonyOS Sans');

check('阿里健康体 取的是**中文**记录，不是英文记录', () => {
  const buf = readFont('AlibabaHealthFont2.0CN-45R.ttf');
  if (!buf) { skipped += 1; return; }
  const n = parseFontNameTable(buf);
  const fam = n?.family ?? '';
  if (/^Alibaba Health Font/i.test(fam)) {
    throw new Error(`回落到了英文记录：${fam}`);
  }
  if (!fam.includes('阿里健康体')) throw new Error(`非预期名称：${fam}`);
});

check('不返回乱码（Mac Roman 记录不得胜出）', () => {
  const buf = readFont('AlibabaHealthFont2.0CN-45R.ttf');
  if (!buf) { skipped += 1; return; }
  const fam = parseFontNameTable(buf)?.family ?? '';
  // Mac(pid=1) 记录里中文是 MacRoman 字节，按字节直译会出现 ° ¢ À 这类字符
  if (/[°¢ÀÃÂ]/.test(fam)) throw new Error(`疑似乱码：${fam}`);
});

// ── 2. 退化输入：不抛错，返回 null ─────────────────────────────────────────
check('空 buffer ⇒ null 且不抛', () => {
  const r = parseFontNameTable(new ArrayBuffer(0));
  if (r !== null) throw new Error(`期望 null，实际 ${JSON.stringify(r)}`);
});

check('随机字节 ⇒ null 且不抛', () => {
  const b = new ArrayBuffer(64);
  const v = new Uint8Array(b);
  for (let i = 0; i < v.length; i++) v[i] = (i * 37 + 11) & 0xff;
  const r = parseFontNameTable(b);
  if (r !== null) throw new Error(`期望 null，实际 ${JSON.stringify(r)}`);
});

check('合法 sfnt 头但没有 name 表 ⇒ null 且不抛', () => {
  // 造一个 12 字节表目录：版本 0x00010000、numTables=0
  const b = new ArrayBuffer(12);
  const dv = new DataView(b);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, 0);
  const r = parseFontNameTable(b);
  if (r !== null) throw new Error(`期望 null，实际 ${JSON.stringify(r)}`);
});

process.stdout.write(
  `\n=== 结果：PASS ${passed} / 未通过 ${failed}${skipped ? ` / 跳过 ${skipped}` : ''} ===\n\n`,
);
