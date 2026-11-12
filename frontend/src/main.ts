// ==================================================
// File: src/main.ts
// ==================================================

import { createApp } from 'vue';
import App from './App.vue';
import pinia from './store';
import './style.css';
import './theme/tokens.css';
// [统一界面语言] 设计系统真源必须在 tokens.css 之后引入：
// tokens.css 里的旧变量大量以 var(--ui-*) / var(--fs-*) 作别名，靠 CSS 变量运行时解析，
// 顺序只影响 :root 同名覆盖，不影响别名求值。
import './theme/design-system.css';

// 说明：已移除明暗模式，统一保留暗色 + 阵营皮肤（由 <html data-faction> 驱动）。
// 主题初始化逻辑已删除，不再读取 logh-theme。

document.addEventListener('keydown', (event) => {
  if (event.key === 'F12' || (event.ctrlKey && event.shiftKey && event.key === 'I')) {
    event.preventDefault();
  }
});

// 核心修复扩展：顺便禁用全局的文本长按拖拽选中（提升桌面端游戏手感）
document.addEventListener('selectstart', (event) => {
  // 允许在输入框里面选中文本，但不允许选中 UI 按钮的文字
  if (event.target && (event.target as HTMLElement)?.tagName?.toLowerCase() !== 'input') {
    event.preventDefault();
  }
});

const app = createApp(App);

app.use(pinia as any);
app.mount('#app');