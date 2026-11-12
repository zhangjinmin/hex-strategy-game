/**
 * _ts_resolve.mjs — 台架专用 ESM 解析钩子（单文件，无需第二个 hook 文件）
 *
 * 为什么需要它：
 *   本项目台架要**直接 import 真源码（.ts）**，避免历史台架"把常量与算法抄一份"导致的
 *   假通过（源码改了台架不会红）。Node 22.22 原生支持类型剥离（`import './x.ts'` 可用），
 *   但**要求说明符完全指定扩展名** —— 而源码里写的是 TS 风格的无扩展名相对导入
 *   （`import { X } from './balance'`）⇒ 直接 import 会在**传递依赖**上炸
 *   （ERR_MODULE_NOT_FOUND: .../config/balance）。
 *
 * 做法：注册一个 resolve 钩子，在 Node 自身解析失败时补 `.ts` / `/index.ts` 再试一次。
 *   · 钩子用 **data: URL 内联**注册 ⇒ 只多一个文件，不必维护 `_hooks.mjs` + `_register.mjs` 两份。
 *   · 只在"Node 自己解析失败"后才介入 ⇒ 不改变任何原本可解析的说明符行为。
 *
 * 用法：
 *   node --import ./_ts_resolve.mjs _v33_tactics_sim.mjs
 *
 * ⚠ 本文件仅服务于**离线台架**，不参与 `vite build` / `vue-tsc`，对产物零影响。
 */
import { register } from 'node:module';

const HOOK = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATES = ['.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href;
      for (const ext of CANDIDATES) {
        const cand = base + ext;
        try { if (existsSync(fileURLToPath(cand))) return { url: cand, shortCircuit: true }; } catch {}
      }
    }
    throw err;
  }
}
`;

register('data:text/javascript,' + encodeURIComponent(HOOK));
