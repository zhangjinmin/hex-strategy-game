<template>
  <div class="wb-overlay" @click.self="$emit('close')">
    <div class="wb-modal neo-card" :class="{ 'is-resizing': dragging }">
      <div class="wb-header">
        <div class="wb-head-left">
          <h3 class="wb-title">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:8px;">
              <path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z" />
              <line x1="8" y1="3.5" x2="8" y2="13.5" />
            </svg>
            银河百科
          </h3>
          <span class="wb-subtitle">全 {{ total }} 条词条 · {{ WIKI_CATEGORIES.length }} 类</span>
        </div>
        <button class="wb-close" @click="$emit('close')" title="关闭">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="2" y1="2" x2="14" y2="14" />
            <line x1="14" y1="2" x2="2" y2="14" />
          </svg>
        </button>
      </div>

      <!-- [v67] 左栏宽度可拖拽（默认 380px，范围 280~620，落盘 logh_wiki_side_width） -->
      <div class="wb-layout" ref="layoutRef">
        <!-- 左：检索 -->
        <aside class="wb-side" :style="{ width: sideWidth + 'px' }">
          <div class="wb-search">
            <svg class="wb-search-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
            <input v-model="keyword" class="wb-input" type="text" placeholder="搜索词条 / 简介…" spellcheck="false" />
            <button v-if="keyword" class="wb-clear" @click="keyword = ''" title="清空">×</button>
          </div>

          <div class="wb-cats">
            <button
              v-for="c in catOptions"
              :key="c.value"
              class="wb-cat-btn"
              :class="{ active: cat === c.value }"
              @click="cat = c.value"
            >
              <span>{{ c.label }}</span>
              <span class="wb-cat-num">{{ c.count }}</span>
            </button>
          </div>

          <div class="wb-list-meta">
            <span>词条列表</span>
            <span class="wb-list-count">{{ filtered.length }} 条</span>
          </div>

          <div class="wb-list">
            <div
              v-for="it in filtered"
              :key="it.key"
              class="wb-item"
              :class="{ active: it.key === activeKey }"
              @click="select(it.key)"
            >
              <img v-if="it.thumb" :src="it.thumb" class="wb-thumb" @error="onImgErr" />
              <div v-else class="wb-thumb wb-thumb-empty"></div>
              <div class="wb-item-text">
                <div class="wb-item-title">
                  <span class="wb-dot" :class="'cat-' + it.category"></span>
                  <span class="wb-item-name">{{ it.title }}</span>
                  <span v-if="linkedCount(it.key)" class="wb-linked" :title="'对应 ' + linkedCount(it.key) + ' 位提督'">提督</span>
                </div>
                <div class="wb-item-sub">{{ it.leadPreview }}</div>
              </div>
            </div>
            <div v-if="!filtered.length" class="wb-empty">无匹配词条</div>
          </div>
        </aside>

        <!-- 可拖拽分隔条 -->
        <div
          class="wb-splitter"
          :class="{ dragging }"
          role="separator"
          aria-orientation="vertical"
          title="拖拽调整左栏宽度 · 双击复位"
          @pointerdown="onSplitDown"
          @dblclick="resetSideWidth"
        ></div>

        <!-- 右：正文 -->
        <section class="wb-main">
          <div v-if="!activeKey" class="wb-main-empty">
            <svg viewBox="0 0 16 16" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35">
              <path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z" />
              <line x1="8" y1="3.5" x2="8" y2="13.5" />
            </svg>
            <p class="wb-main-empty-title">从左侧选择词条查阅</p>
            <p class="wb-main-empty-hint">支持按名称 / 简介搜索；左侧分隔条可拖动加宽，双击复位</p>
          </div>
          <div v-else class="wb-main-scroll" ref="scrollRef">
            <WikiEntryView :entry-key="activeKey" mode="full" open-mode="first" @open-entry="select" />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import WikiEntryView from './WikiEntryView.vue';
import { getWikiListItems, type WikiListItem } from '../../config/loghWiki/render';
import { WIKI_TO_ADMIRALS, WIKI_CATEGORIES, type WikiCategory } from '../../config/loghWiki';

defineEmits<{ close: [] }>();

const items = ref<WikiListItem[]>([]);
const keyword = ref('');
const cat = ref<'全部' | WikiCategory>('全部');
const activeKey = ref('');
const scrollRef = ref<HTMLElement | null>(null);

onMounted(async () => {
  items.value = await getWikiListItems();
});

const total = computed(() => items.value.length);

const catOptions = computed(() => {
  const opts: { value: '全部' | WikiCategory; label: string; count: number }[] = [
    { value: '全部', label: '全部', count: items.value.length },
  ];
  for (const c of WIKI_CATEGORIES) {
    opts.push({ value: c, label: c, count: items.value.filter((i) => i.category === c).length });
  }
  return opts;
});

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return items.value.filter((i) => {
    if (cat.value !== '全部' && i.category !== cat.value) return false;
    if (!kw) return true;
    return i.title.toLowerCase().includes(kw) || i.leadPreview.toLowerCase().includes(kw);
  });
});

const linkedCount = (key: string) => (WIKI_TO_ADMIRALS[key] || []).length;

const select = (key: string) => {
  activeKey.value = key;
  requestAnimationFrame(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = 0;
  });
};

const onImgErr = (e: Event) => {
  (e.target as HTMLImageElement).style.visibility = 'hidden';
};

// ===== [v67] 左栏宽度：可拖拽 + 持久化 =====
// 用户实报"左侧太挤、条目糊在一起"，且明确接受"手动拉宽" ⇒ 给一条真正的分隔条，
// 宽度落盘到 localStorage（每次打开不用重拖）。范围 280~620，双击复位。
const SIDE_MIN = 280;
const SIDE_MAX = 620;
const SIDE_DEFAULT = 380;
const SIDE_STORAGE_KEY = 'logh_wiki_side_width';
/** 右栏保底宽度：左栏再拉也不能把正文挤成一条 */
const MAIN_MIN = 380;

const layoutRef = ref<HTMLElement | null>(null);
const sideWidth = ref(readSideWidth());
const dragging = ref(false);

function clampSide(v: number): number {
  const maxByLayout = Math.max(SIDE_MIN, (layoutRef.value?.clientWidth ?? 1200) - MAIN_MIN);
  return Math.round(Math.min(SIDE_MAX, maxByLayout, Math.max(SIDE_MIN, v)));
}

function readSideWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDE_STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(n))) : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
}

function persistSideWidth(): void {
  try { localStorage.setItem(SIDE_STORAGE_KEY, String(sideWidth.value)); } catch { /* 隐私模式忽略 */ }
}

/**
 * 拖拽换算比例：本项目全局缩放走 #game-container 的 CSS zoom，
 * 指针事件给的是**视口 CSS 像素**，而 offsetWidth 是 **zoom 前的布局像素**，
 * 两者差一个 zoom 系数（uiScale=120% 时差 1.2 倍）。
 * 用 getBoundingClientRect().width / offsetWidth 现算，无需读 store，也不怕将来改缩放实现。
 */
let dragScale = 1;
let dragStartX = 0;
let dragStartW = 0;

function onSplitDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const layout = layoutRef.value;
  if (!layout) return;
  e.preventDefault();
  const scale = layout.offsetWidth > 0 ? layout.getBoundingClientRect().width / layout.offsetWidth : 1;
  dragScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  dragStartX = e.clientX;
  dragStartW = sideWidth.value;
  dragging.value = true;
  window.addEventListener('pointermove', onSplitMove);
  window.addEventListener('pointerup', onSplitUp);
  window.addEventListener('pointercancel', onSplitUp);
}

function onSplitMove(e: PointerEvent): void {
  if (!dragging.value) return;
  const delta = (e.clientX - dragStartX) / dragScale;
  sideWidth.value = clampSide(dragStartW + delta);
}

function onSplitUp(): void {
  if (!dragging.value) return;
  dragging.value = false;
  persistSideWidth();
  window.removeEventListener('pointermove', onSplitMove);
  window.removeEventListener('pointerup', onSplitUp);
  window.removeEventListener('pointercancel', onSplitUp);
}

function resetSideWidth(): void {
  sideWidth.value = clampSide(SIDE_DEFAULT);
  persistSideWidth();
}

/** 窗口变窄时把左栏收回可视范围（否则 flex-shrink:0 会把正文顶出界） */
function onWindowResize(): void {
  const next = clampSide(sideWidth.value);
  if (next !== sideWidth.value) sideWidth.value = next;
}

onMounted(() => window.addEventListener('resize', onWindowResize));
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('pointermove', onSplitMove);
  window.removeEventListener('pointerup', onSplitUp);
  window.removeEventListener('pointercancel', onSplitUp);
});
</script>

<style scoped>
.wb-overlay {
  position: fixed;
  inset: 0;
  z-index: 1260;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}
/* [v67] 原 94vw / 90vh：vh/vw 不参与 #game-container 的 zoom(--ui-scale) 折算（同 SaveManagerModal 注释），
   uiScale≠100% 时会溢出屏幕。父级 .wb-overlay 是 fixed inset:0 ⇒ 一律用 %。 */
.wb-modal {
  width: 95%;
  height: 92%;
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
}
/* 拖拽期间：禁掉文本选择与条目点击，光标保持 col-resize */
.wb-modal.is-resizing { user-select: none; cursor: col-resize; }
.wb-modal.is-resizing .wb-side { pointer-events: none; }

.wb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.wb-head-left { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.wb-title {
  font-size: calc(17px * var(--font-scale));
  font-weight: 800;
  color: var(--color-cyan);
  margin: 0;
  display: flex;
  align-items: center;
  letter-spacing: 1px;
}
.wb-subtitle {
  font-size: calc(11px * var(--font-scale));
  color: var(--color-text-disabled);
  letter-spacing: 1px;
}
.wb-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.wb-close:hover { color: var(--color-cyan); border-color: var(--color-cyan); }

.wb-layout {
  flex: 1;
  display: flex;
  gap: 0;
  min-height: 0;
}

/* ---------- 左栏 ---------- */
.wb-side {
  flex-shrink: 0;
  min-width: 0;
  max-width: 62%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding-right: 14px;
}
.wb-search { position: relative; flex-shrink: 0; }
.wb-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-disabled);
  pointer-events: none;
}
.wb-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--dmc-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: calc(12px * var(--font-scale));
  padding: 8px 26px 8px 30px;
  outline: none;
  font-family: var(--dmc-font);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.wb-input:focus { border-color: var(--color-cyan); }
.wb-input::placeholder { color: var(--color-text-disabled); }
.wb-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--color-text-disabled);
  font-size: calc(15px * var(--font-scale));
  cursor: pointer;
  line-height: 1;
  padding: 0 6px;
}
.wb-clear:hover { color: var(--color-text-primary); }

.wb-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  flex-shrink: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
}
.wb-cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text-secondary);
  font-size: calc(11px * var(--font-scale));
  padding: 4px 9px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  font-family: var(--dmc-font);
}
.wb-cat-btn:hover { color: var(--color-text-primary); border-color: var(--color-border-emphasized); }
.wb-cat-btn.active {
  border-color: var(--color-cyan);
  color: var(--color-cyan);
  background: rgba(52, 152, 219, 0.1);
}
.wb-cat-num {
  font-family: var(--dmc-font-mono);
  font-size: calc(10px * var(--font-scale));
  opacity: 0.7;
}

/* 列表小标题：与搜索/筛选拉开层次，不再"一坨" */
.wb-list-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: calc(10px * var(--font-scale));
  letter-spacing: 1px;
  color: var(--color-text-disabled);
  flex-shrink: 0;
  padding: 0 2px;
}
.wb-list-count { font-family: var(--dmc-font-mono); }

.wb-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding-right: 2px;
}
.wb-list::-webkit-scrollbar { width: 8px; }
.wb-list::-webkit-scrollbar-track { background: transparent; }
.wb-list::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 4px; }
.wb-list::-webkit-scrollbar-thumb:hover { background: var(--color-border-emphasized); }

.wb-item {
  display: flex;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}
.wb-item:hover { background: rgba(255, 255, 255, 0.04); border-color: var(--color-border); }
.wb-item.active {
  background: rgba(52, 152, 219, 0.14);
  border-color: rgba(52, 152, 219, 0.3);
  border-left-color: var(--color-cyan);
}
.wb-thumb {
  width: 38px;
  height: 50px;
  object-fit: cover;
  border-radius: 3px;
  border: 1px solid var(--color-border);
  flex-shrink: 0;
  background: var(--dmc-bg-input);
}
.wb-thumb-empty { opacity: 0.35; }
.wb-item-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.wb-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: calc(13px * var(--font-scale));
  line-height: 1.35;
  color: var(--color-text-primary);
  font-weight: 700;
}
.wb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--dmc-gold);
}
.wb-dot.cat-人物 { background: var(--dmc-gold); }
.wb-dot.cat-组织 { background: var(--color-purple); }
.wb-dot.cat-地点 { background: var(--color-green); }
.wb-dot.cat-事件 { background: var(--color-warning); }
.wb-dot.cat-科技 { background: var(--color-cyan); }
.wb-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.3px;
}
.wb-linked {
  font-size: calc(9px * var(--font-scale));
  padding: 0 4px;
  border-radius: 6px;
  border: 1px solid var(--color-cyan);
  color: var(--color-cyan);
  flex-shrink: 0;
  opacity: 0.85;
}
.wb-item-sub {
  font-size: calc(11px * var(--font-scale));
  line-height: 1.5;
  color: var(--color-text-disabled);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}
.wb-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--color-text-disabled);
  font-size: calc(12px * var(--font-scale));
}

/* ---------- 分隔条 ---------- */
.wb-splitter {
  flex: 0 0 11px;
  align-self: stretch;
  cursor: col-resize;
  position: relative;
  touch-action: none;
}
.wb-splitter::before {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--color-border);
  transition: background var(--duration-fast) var(--ease-out), width var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}
.wb-splitter:hover::before,
.wb-splitter.dragging::before {
  background: var(--color-cyan);
  width: 2px;
  box-shadow: 0 0 8px rgba(52, 152, 219, 0.55);
}

/* ---------- 右栏 ---------- */
.wb-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wb-main-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--color-text-disabled);
}
.wb-main-empty-title { font-size: calc(14px * var(--font-scale)); margin: 0; letter-spacing: 1px; }
.wb-main-empty-hint { font-size: calc(11px * var(--font-scale)); margin: 0; opacity: 0.6; }
.wb-main-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 8px;
}
.wb-main-scroll::-webkit-scrollbar { width: 9px; }
.wb-main-scroll::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 4px; }
</style>
