#!/usr/bin/env node
/**
 * runAllSims.cjs — 全量台架**聚合门禁**（单一退出码）
 *
 * 为什么需要它：`scripts/*Sim.cjs` 此前只能靠人手敲
 *   `for f in scripts/*Sim.cjs; do node --import ./_ts_resolve.mjs "$f"; done`
 * ⇒ 某条台架红了**没人看得见**（实测发生过：主判据台架 15 PASS / 1 FAIL，而自陈写的是 16/0）。
 * 写了但没接线的守卫等于没有守卫，本脚本就是那条线。
 *
 * 用法（在仓库根）：
 *   node --import ./_ts_resolve.mjs scripts/runAllSims.cjs
 *   或 npm run sim
 *
 * 退出码：全部 exit 0 ⇒ 0；任一非 0 ⇒ 1（并打印该台架输出的末 30 行）。
 *
 * ⚠ 子进程必须继承 `--import` 钩子（.ts 直接 require 依赖它），故本脚本自己也被 --import 启动时
 *   会把同一个绝对路径再传给子进程；用 `_ts_resolve.mjs` 是否存在做探测，不硬编码。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const simsDir = __dirname;
const root = path.join(simsDir, '..');
const tsResolve = path.join(root, '_ts_resolve.mjs');
// ⚠ `--import` 的值会按 ESM loader 解析：Windows 绝对路径必须转成 file:// URL，
//   否则报 `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'f:'`（本脚本第一版就栽在这，
//   44 个台架全部因此 exit 1，而"PASS 0 / FAIL 44"又被一层管道吃掉了退出码 ⇒ 双重假绿）。
const nodeArgs = fs.existsSync(tsResolve) ? ['--import', pathToFileURL(tsResolve).href] : [];

const files = fs.readdirSync(simsDir)
  .filter((f) => /Sim\.cjs$/.test(f))
  .sort();

if (files.length === 0) {
  console.error('✗ 未找到任何 scripts/*Sim.cjs');
  process.exitCode = 1;
} else {
  const t0 = Date.now();
  const fails = [];
  console.log(`# 全量台架：${files.length} 个（node ${process.version}${nodeArgs.length ? ' + _ts_resolve' : ''}）\n`);
  for (const f of files) {
    const p = spawnSync(process.execPath, [...nodeArgs, path.join(simsDir, f)], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    const ok = p.status === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}`);
    if (!ok) {
      fails.push({
        f, code: p.status,
        tail: `${p.stdout || ''}${p.stderr || ''}`.trimEnd().split('\n').slice(-30).join('\n'),
      });
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (fails.length) {
    console.error(`\n=== ${fails.length} 个台架失败 ===`);
    for (const x of fails) {
      console.error(`\n--- ${x.f} (exit ${x.code}) 末尾 30 行 ---\n${x.tail}`);
    }
  }
  console.log(`\nPASS ${files.length - fails.length} / FAIL ${fails.length}   (${secs}s)`);
  process.exitCode = fails.length ? 1 : 0;
}
