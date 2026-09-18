<template>
  <div class="wb-overlay" @click.self="$emit('close')">
    <div class="wb-modal neo-card">
      <div class="wb-header">
        <h3 class="wb-title">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:6px;">
            <path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z" />
            <line x1="8" y1="3.5" x2="8" y2="13.5" />
          </svg>
          银河百科 · 全 {{ total }} 条
        </h3>
        <button class="neo-btn text-slate-400 px-2" @click="$emit('close')">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="2" y1="2" x2="14" y2="14" />
            <line x1="14" y1="2" x2="2" y2="14" />
          </svg>
        </button>
      </div>

      <div class="wb-layout">
        <!-- 左：检索 -->
        <div class="wb-side">
          <div class="wb-search">
            <input v-model="keyword" class="wb-input" type="text" placeholder="搜索词条…" spellcheck="false" />
            <button v-if="keyword" class="wb-clear" @click="keyword = ''">×</button>
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
        </div>

        <!-- 右：正文 -->
        <div class="wb-main">
          <div v-if="!activeKey" class="wb-main-empty">← 从左侧选择词条查阅</div>
          <div v-else class="wb-main-scroll" ref="scrollRef">
            <WikiEntryView :entry-key="activeKey" mode="full" open-mode="first" @open-entry="select" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
.wb-modal {
  width: 94vw;
  height: 90vh;
  display: flex;
  flex-direction: column;
  padding: 14px;
}
.wb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.wb-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-cyan);
  margin: 0;
}
.wb-layout {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
}

/* ---------- 左栏 ---------- */
.wb-side {
  width: 286px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  border-right: 1px solid var(--color-border);
  padding-right: 12px;
}
.wb-search { position: relative; }
.wb-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--dmc-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 12px;
  padding: 6px 24px 6px 9px;
  outline: none;
  font-family: var(--dmc-font);
}
.wb-input:focus { border-color: var(--color-cyan); }
.wb-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--color-text-disabled);
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}
.wb-clear:hover { color: var(--color-text-primary); }

.wb-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wb-cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text-secondary);
  font-size: 11px;
  padding: 3px 8px;
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
  font-size: 10px;
  opacity: 0.7;
}

.wb-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}
.wb-item {
  display: flex;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 3px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background var(--duration-fast) var(--ease-out);
}
.wb-item:hover { background: rgba(255, 255, 255, 0.035); }
.wb-item.active {
  background: rgba(52, 152, 219, 0.12);
  border-left-color: var(--color-cyan);
}
.wb-thumb {
  width: 30px;
  height: 40px;
  object-fit: cover;
  border-radius: 2px;
  border: 1px solid var(--color-border);
  flex-shrink: 0;
  background: var(--dmc-bg-input);
}
.wb-thumb-empty { opacity: 0.35; }
.wb-item-text { min-width: 0; flex: 1; }
.wb-item-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
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
}
.wb-linked {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 6px;
  border: 1px solid var(--color-cyan);
  color: var(--color-cyan);
  flex-shrink: 0;
  opacity: 0.85;
}
.wb-item-sub {
  font-size: 10px;
  color: var(--color-text-disabled);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.wb-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--color-text-disabled);
  font-size: 12px;
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
  align-items: center;
  justify-content: center;
  color: var(--color-text-disabled);
  font-size: 12px;
}
.wb-main-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 6px;
}
</style>
