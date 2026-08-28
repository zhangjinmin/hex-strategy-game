// ==================================================
// File: src/main.ts
// ==================================================

import { createApp } from 'vue';
import App from './App.vue';
import pinia from './store';
import './style.css';
import './theme/tokens.css';

// 说明：已移除明暗模式，统一保留当前暗色+阵营配色方案（用户需求）
// 主题初始化逻辑已删除，不再读取 logh-theme

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