<template>
  <div class="wiki-view" :class="mode">
    <!-- 加载 / 空态 -->
    <div v-if="!rich" class="wk-state">
      <span v-if="loading" class="wk-loading">词条编译中…</span>
      <span v-else class="wk-missing">暂无该词条</span>
    </div>

    <template v-else>
      <!-- 头部：主图 + 标题 + 导语 -->
      <div class="wk-head">
        <img v-if="rich.image" :src="rich.image" class="wk-hero" @error="onImgErr" @click="preview = rich.image" />
        <div class="wk-head-text">
          <div class="wk-title-row">
            <h2 class="wk-title">{{ rich.title }}</h2>
            <span class="wk-cat" :class="'cat-' + rich.category">{{ rich.category }}</span>
            <span class="wk-vol">{{ rich.totalChars.toLocaleString() }} 字</span>
          </div>
          <p v-if="rich.lead.length" class="wk-lead">
            <span
              v-for="(f, i) in rich.lead"
              :key="i"
              :class="fragClass(f)"
              @click="onFrag(f)"
            >{{ f.text }}</span>
          </p>
        </div>
      </div>

      <!-- 属性表 -->
      <div v-if="rich.infoRows.length" class="wk-info">
        <div v-for="row in rich.infoRows" :key="row.k" class="wk-info-row">
          <div class="wk-info-k">{{ row.k }}</div>
          <div class="wk-info-v">
            <div v-for="(line, li) in row.lines" :key="li" class="wk-info-line">
              <span
                v-for="(f, fi) in line"
                :key="fi"
                :class="fragClass(f)"
                @click="onFrag(f)"
              >{{ f.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 正文分节 -->
      <div v-if="rich.sections.length" class="wk-sections">
        <div class="wk-sec-bar">
          <span class="wk-sec-bar-label">正文 · {{ rich.sections.length }} 节</span>
          <button class="wk-mini-btn" @click="toggleAll">
            {{ allOpen ? '全部收起' : '全部展开' }}
          </button>
        </div>

        <div v-for="(sec, si) in rich.sections" :key="si" class="wk-sec">
          <div class="wk-sec-head" @click="toggle(si)">
            <span class="wk-caret">{{ isOpen(si) ? '▾' : '▸' }}</span>
            <span class="wk-sec-title">{{ sec.title }}</span>
            <span class="wk-sec-vol">{{ sec.chars.toLocaleString() }} 字</span>
          </div>

          <div v-show="isOpen(si)" class="wk-sec-body">
            <div v-for="(sub, bi) in sec.subs" :key="bi" class="wk-sub">
              <h4 v-if="sub.heading" class="wk-sub-head">{{ sub.heading }}</h4>

              <template v-for="(p, pi) in sub.paras" :key="pi">
                <ul v-if="p.kind === 'list'" class="wk-list">
                  <li v-for="(item, ii) in p.items" :key="ii">
                    <span
                      v-for="(f, fi) in item"
                      :key="fi"
                      :class="fragClass(f)"
                      @click="onFrag(f)"
                    >{{ f.text }}</span>
                  </li>
                </ul>
                <p v-else class="wk-para">
                  <span
                    v-for="(f, fi) in p.frags"
                    :key="fi"
                    :class="fragClass(f)"
                    @click="onFrag(f)"
                  >{{ f.text }}</span>
                </p>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 图集 -->
      <div v-if="rich.gallery.length" class="wk-gallery">
        <div class="wk-sec-bar"><span class="wk-sec-bar-label">图集 · {{ rich.gallery.length }} 张</span></div>
        <div class="wk-gal-grid">
          <img
            v-for="(g, i) in rich.gallery"
            :key="i"
            :src="g"
            class="wk-gal-img"
            @error="onImgErr"
            @click="preview = g"
          />
        </div>
      </div>
    </template>

    <!-- 图片放大 -->
    <Teleport to="body">
      <div v-if="preview" class="wk-lightbox" @click="preview = ''">
        <img :src="preview" class="wk-lightbox-img" />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { compileEntryByKey } from '../../config/loghWiki/render';
import type { RichEntry, RichFragment } from '../../config/loghWiki/types';

const props = withDefaults(
  defineProps<{
    /** 词条键 */
    entryKey: string;
    /** compact 用于名册内嵌，full 用于独立阅读 */
    mode?: 'compact' | 'full';
    /** 初始展开策略 */
    openMode?: 'none' | 'first' | 'all';
  }>(),
  { mode: 'full', openMode: 'first' }
);

const emit = defineEmits<{ 'open-entry': [key: string] }>();

const rich = ref<RichEntry | null>(null);
const loading = ref(false);
const openSet = ref<Set<number>>(new Set());
const preview = ref('');
const allOpen = ref(false);

const isOpen = (i: number) => openSet.value.has(i);
const toggle = (i: number) => {
  const s = new Set(openSet.value);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  openSet.value = s;
};
const toggleAll = () => {
  const n = rich.value?.sections.length ?? 0;
  if (allOpen.value) {
    openSet.value = new Set();
    allOpen.value = false;
  } else {
    openSet.value = new Set(Array.from({ length: n }, (_, i) => i));
    allOpen.value = true;
  }
};

const applyOpenMode = () => {
  const n = rich.value?.sections.length ?? 0;
  if (props.openMode === 'all') {
    openSet.value = new Set(Array.from({ length: n }, (_, i) => i));
    allOpen.value = true;
  } else if (props.openMode === 'first') {
    openSet.value = new Set(n ? [0] : []);
    allOpen.value = false;
  } else {
    openSet.value = new Set();
    allOpen.value = false;
  }
};

const load = async (key: string) => {
  if (!key) {
    rich.value = null;
    return;
  }
  loading.value = true;
  rich.value = await compileEntryByKey(key);
  loading.value = false;
  applyOpenMode();
};

watch(() => props.entryKey, load, { immediate: true });

const fragClass = (f: RichFragment) => ({ 'frag-link': !!f.key, 'frag-bold': !!f.bold });
const onFrag = (f: RichFragment) => {
  if (f.key) emit('open-entry', f.key);
};
const onImgErr = (e: Event) => {
  const el = e.target as HTMLImageElement;
  el.style.display = 'none';
};
</script>

<style scoped>
.wiki-view {
  --wk-fs: 12.5px;
  --wk-hero: 118px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: var(--wk-fs);
  color: var(--color-text-secondary);
  line-height: 1.78;
}
.wiki-view.compact {
  --wk-fs: 11px;
  --wk-hero: 82px;
  gap: 9px;
  line-height: 1.7;
}

/* ---------- 状态 ---------- */
.wk-state {
  padding: 24px 0;
  text-align: center;
  color: var(--color-text-disabled);
  font-size: 12px;
}

/* ---------- 头部 ---------- */
.wk-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.wk-hero {
  width: var(--wk-hero);
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  cursor: zoom-in;
  object-fit: cover;
  background: var(--dmc-bg-input);
}
.wk-head-text {
  min-width: 0;
  flex: 1;
}
.wk-title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.wk-title {
  margin: 0;
  font-size: 1.55em;
  font-weight: 800;
  color: var(--color-text-primary);
  letter-spacing: 0.01em;
}
.wk-cat {
  font-size: 0.85em;
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px solid var(--dmc-gold);
  color: var(--dmc-gold);
  white-space: nowrap;
}
.wk-cat.cat-组织 { border-color: var(--color-purple); color: var(--color-purple); }
.wk-cat.cat-地点 { border-color: var(--color-green); color: var(--color-green); }
.wk-cat.cat-事件 { border-color: var(--color-warning); color: var(--color-warning); }
.wk-cat.cat-科技 { border-color: var(--color-cyan); color: var(--color-cyan); }
.wk-vol {
  font-size: 0.85em;
  color: var(--color-text-disabled);
  font-family: var(--dmc-font-mono);
}
.wk-lead {
  margin: 0;
  color: var(--color-text-secondary);
  text-align: justify;
}

/* ---------- 属性表 ---------- */
.wk-info {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--dmc-bg-input);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.wk-info-row {
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 10px;
  align-items: baseline;
}
.wk-info-k {
  color: var(--dmc-gold);
  font-size: 0.92em;
  font-weight: 700;
  text-align: right;
  opacity: 0.86;
  white-space: nowrap;
}
.wk-info-v {
  color: var(--color-text-primary);
  min-width: 0;
  word-break: break-word;
}
.wk-info-line + .wk-info-line { margin-top: 1px; }

/* ---------- 正文 ---------- */
.wk-sections { display: flex; flex-direction: column; gap: 6px; }
.wk-sec-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 4px;
  margin-bottom: 2px;
}
.wk-sec-bar-label {
  font-size: 0.9em;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--color-text-disabled);
}
.wk-mini-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text-secondary);
  font-size: 0.85em;
  padding: 1px 7px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.wk-mini-btn:hover {
  color: var(--color-cyan);
  border-color: var(--color-cyan);
}
.wk-sec { border-radius: var(--radius-sm); }
.wk-sec-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 3px;
  border-left: 3px solid rgba(201, 169, 110, 0.5);
  background: rgba(255, 255, 255, 0.015);
  transition: background var(--duration-fast) var(--ease-out);
}
.wk-sec-head:hover { background: rgba(201, 169, 110, 0.08); }
.wk-caret {
  color: var(--dmc-gold);
  font-size: 0.9em;
  width: 10px;
  flex-shrink: 0;
}
.wk-sec-title {
  flex: 1;
  font-weight: 800;
  color: var(--color-text-primary);
  font-size: 1.02em;
}
.wk-sec-vol {
  color: var(--color-text-disabled);
  font-size: 0.85em;
  font-family: var(--dmc-font-mono);
}
.wk-sec-body {
  padding: 6px 8px 8px 15px;
  border-left: 3px solid rgba(255, 255, 255, 0.05);
  margin-left: 0;
}
.wk-sub + .wk-sub { margin-top: 8px; }
.wk-sub-head {
  margin: 6px 0 3px;
  font-size: 1em;
  font-weight: 700;
  color: var(--color-cyan);
}
.wk-para {
  margin: 0 0 6px;
  text-align: justify;
  word-break: break-word;
}
.wk-para:last-child { margin-bottom: 0; }
.wk-list {
  margin: 0 0 6px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wk-list li { word-break: break-word; }

/* ---------- 片段 ---------- */
.frag-link {
  color: var(--color-cyan);
  border-bottom: 1px dashed rgba(52, 152, 219, 0.45);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.frag-link:hover {
  color: var(--color-text-primary);
  background: rgba(52, 152, 219, 0.2);
  border-bottom-color: var(--color-cyan);
}
.frag-bold {
  font-weight: 700;
  color: var(--color-text-primary);
}

/* ---------- 图集 ---------- */
.wk-gallery { display: flex; flex-direction: column; gap: 6px; }
.wk-gal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}
.wk-gal-img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 3px;
  border: 1px solid var(--color-border);
  cursor: zoom-in;
  background: var(--dmc-bg-input);
}

/* ---------- 灯箱 ---------- */
.wk-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: var(--overlay-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
  padding: 4vh 4vw;
}
.wk-lightbox-img {
  max-width: 100%;
  max-height: 92vh;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-high);
}
</style>
