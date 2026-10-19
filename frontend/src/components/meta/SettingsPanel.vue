<template>
  <div class="settings-body">
    <div class="settings-col settings-col-a">
    <!-- 音频设置 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><path d="M3 6h2l3-2v8L5 10H3z"/><path d="M10 5.5c1 0.5 1 5 0 5"/></svg>
        音频
      </div>
      <div class="setting-row">
        <span class="setting-label">音乐</span>
        <label class="toggle-switch">
          <input type="checkbox" v-model="settings.musicEnabled" />
          <span class="toggle-slider"></span>
        </label>
        <span class="setting-value">{{ settings.musicEnabled ? 'ON' : 'OFF' }}</span>
      </div>
      <div class="setting-row" v-if="settings.musicEnabled">
        <span class="setting-label">音乐音量</span>
        <input type="range" min="0" max="100" v-model.number="settings.musicVolume" class="setting-slider" />
        <span class="setting-value">{{ settings.musicVolume }}%</span>
      </div>
      <div class="setting-row" v-if="settings.musicEnabled && currentTrack">
        <span class="setting-label">当前曲目</span>
        <span class="track-name" :title="currentTrack">{{ displayTrackName }}</span>
        <button class="skip-btn" @click="skipTrack" title="下一首">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="4,2 13,8 4,14"/><line x1="13" y1="2" x2="13" y2="14"/></svg>
        </button>
      </div>
      <div class="setting-row" v-if="settings.musicEnabled">
        <span class="setting-label">选择曲目</span>
        <select class="neo-select" :value="currentTrackNum ?? 0" @change="onTrackSelect">
          <option :value="0" disabled>— 随机播放 —</option>
          <option v-for="t in trackList" :key="t.num" :value="t.num">{{ t.num.toString().padStart(2,'0') }}. {{ t.name }}</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">音效</span>
        <label class="toggle-switch">
          <input type="checkbox" v-model="settings.sfxEnabled" />
          <span class="toggle-slider"></span>
        </label>
        <span class="setting-value">{{ settings.sfxEnabled ? 'ON' : 'OFF' }}</span>
      </div>
      <div class="setting-row" v-if="settings.sfxEnabled">
        <span class="setting-label">音效音量</span>
        <input type="range" min="0" max="100" v-model.number="settings.sfxVolume" class="setting-slider" />
        <span class="setting-value">{{ settings.sfxVolume }}%</span>
      </div>
    </div>

    <!-- 界面缩放 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><path d="M6 3H2v4"/><path d="M2 3l5 5"/><path d="M10 13h4v-4"/><path d="M14 13l-5-5"/></svg>
        界面缩放
      </div>
      <div class="setting-row">
        <span class="setting-label">全局缩放</span>
        <input type="range" min="80" max="140" step="5" v-model.number="settings.uiScale" class="setting-slider" />
        <span class="setting-value">{{ settings.uiScale }}%</span>
      </div>
      <div class="setting-hints">
        <div class="setting-hint">统一放大界面文字、按钮、菜单（80%~140%）。</div>
        <div class="setting-hint">这里放大的是整个界面（含面板与间距）；只想让字更大就别动这里，用「字体与字号」里的「字号」。</div>
      </div>
    </div>

    <!-- 势力配色 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><circle cx="4" cy="8" r="2.5"/><circle cx="12" cy="8" r="2.5"/><line x1="6.5" y1="8" x2="9.5" y2="8"/></svg>
        势力配色
      </div>
      <div class="setting-row">
        <span class="setting-label">配色方案</span>
        <select class="neo-select" :value="factionScheme" @change="onSchemeChange">
          <option v-for="s in schemes" :key="s.key" :value="s.key">{{ s.name }} — {{ s.desc }}</option>
        </select>
      </div>
      <div class="scheme-preview" v-if="currentScheme">
        <span class="swatch ally" :style="{ background: hexToCss(currentScheme.ally.main) }"></span>
        <span class="scheme-preview-label">同盟 {{ hexToCss(currentScheme.ally.main) }}</span>
        <span class="swatch empire" :style="{ background: hexToCss(currentScheme.empire.main) }"></span>
        <span class="scheme-preview-label">帝国 {{ hexToCss(currentScheme.empire.main) }}</span>
      </div>
    </div>
    </div>

    <div class="settings-col settings-col-b">

    <!-- 3D 战场性能 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><path d="M1.5 13.5V9"/><path d="M6 13.5V6"/><path d="M10.5 13.5V9.5"/><path d="M15 13.5V4"/></svg>
        3D 战场性能
      </div>
      <div class="setting-row">
        <span class="setting-label">画质档</span>
        <select class="neo-select" :value="b3dQuality" @change="onB3dQualityChange">
          <option value="high">高（原始分辨率 + 抗锯齿）</option>
          <option value="medium">中（1.5× 分辨率 + 轻抗锯齿）</option>
          <option value="low">低（1× 分辨率 + 无抗锯齿）</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">帧率保护</span>
        <label class="toggle-switch">
          <input type="checkbox" v-model="settings.battle3dPerfGuard" />
          <span class="toggle-slider"></span>
        </label>
        <span class="setting-value">{{ settings.battle3dPerfGuard ? 'ON' : 'OFF' }}</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">显示帧率</span>
        <label class="toggle-switch">
          <input type="checkbox" v-model="settings.battle3dShowFps" />
          <span class="toggle-slider"></span>
        </label>
        <span class="setting-value">{{ settings.battle3dShowFps ? 'ON' : 'OFF' }}</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">模型精细度</span>
        <select class="neo-select" :value="shipDetail" @change="onShipDetailChange">
          <option value="high">高（原始 ~5 万面）</option>
          <option value="medium">中（LOD1 ≈20% 三角数）</option>
          <option value="low">低（LOD2 ≈5% 三角数）</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">开场动画</span>
        <select class="neo-select" :value="entryFx" @change="onEntryFxChange">
          <option value="door">传送门（能量块组装）</option>
          <option value="sphere">能量球（六边形拼接）</option>
          <option value="off">关闭</option>
        </select>
      </div>
      <div class="setting-hints">
        <div class="setting-hint">开场动画：开战时的入场特效（传送门 / 能量球 / 关闭）；选「关闭」后舰队立即正常显示、不暂停。下一场战斗生效。</div>
        <div class="setting-hint">画质档 / 舰船精细度：降档会降低 3D 渲染分辨率与模型面数（轮廓线框各档均保留）。下一场战斗生效。</div>
        <div class="setting-hint">帧率保护：低于约 45fps 时自动把多余实体退回光点层；跑得动时完全不生效。</div>
        <div class="setting-hint">显示帧率：3D 战场右下角显示实时帧率，用于对比调档前后。</div>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/><line x1="8" y1="0" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="16"/><line x1="0" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="16" y2="8"/></svg>
        战略星图显示模式
      </div>
      <div class="setting-row">
        <span class="setting-label">显示模式</span>
        <div class="mode-switch-group">
          <button class="mode-btn" :class="{ active: starmapMode === 'universe' }" @click="setStarmapMode('universe')">
            <span class="mode-icon"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/><line x1="8" y1="0" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="16"/><line x1="0" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="16" y2="8"/></svg></span>
            <span class="mode-label">宇宙模式</span>
            <span class="mode-desc">纯净星际星图，无悬浮板</span>
          </button>
          <button class="mode-btn" :class="{ active: starmapMode === 'holo' }" @click="setStarmapMode('holo')">
            <span class="mode-icon"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="2" width="10" height="11" rx="1"/><path d="M8 2v11"/><path d="M3 2L2 1"/></svg></span>
            <span class="mode-label">悬浮板</span>
            <span class="mode-desc">四角三维竖牌随地图侧转</span>
          </button>
        </div>
      </div>
    </div>
    </div>

    <div class="settings-col settings-col-c">

    <!-- 字体与字号 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><path d="M3 13L8 3l5 10"/><line x1="5" y1="9.5" x2="11" y2="9.5"/></svg>
        字体与字号
      </div>
      <div class="setting-row">
        <span class="setting-label">界面字体</span>
        <select class="neo-select" :value="settings.uiFont ?? ''" @change="onFontChange">
          <option :value="SYSTEM_FONT_ID">系统默认（{{ SYSTEM_FONT_HINT }}）</option>
          <option v-for="f in FONT_CATALOG" :key="f.id" :value="f.id">{{ f.displayName }}{{ coverageTag(f.id) }}</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">字号</span>
        <input type="range" min="100" max="140" step="5" v-model.number="settings.fontScale" class="setting-slider" />
        <span class="setting-value">{{ settings.fontScale }}%</span>
      </div>
      <div class="font-preview" style="font-family: var(--dmc-font)">
        <div class="font-preview-line">舰况士气 · 补给混战 · 阶段 AE-01</div>
        <div class="font-preview-sub">字号预览：这一行字会随上面的「字号」变化，面板尺寸不变。</div>
      </div>
      <div class="setting-hints">
        <div class="setting-hint">字体：把 .ttf / .otf / .woff2 丢进 <code>frontend/src/assets/fonts/</code>，重新 build（dev 下自动热更）后就会出现在下拉里，无需改代码。选中即时生效。</div>
        <div class="setting-hint" v-if="currentCoverage && !currentCoverage.cjk">⚠ 当前字体不含中文字形：中文会回落到「系统字体」，只有英文/数字变化。</div>
        <div class="setting-hint" v-if="currentCoverage && currentCoverage.cjk && !currentCoverage.latin">当前字体不含拉丁字形：英文/数字会回落。</div>
        <div class="setting-hint">字号：只放大文字（100%~140%），不动按钮/面板/间距，与「全局缩放」互相独立、可叠加。</div>
      </div>
    </div>

    <!-- 接口接入 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><path d="M5 1L1 5v6l4 4h6l4-4V5l-4-4z"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="10" x2="11" y2="10"/></svg>
        接口接入（预留）
      </div>
      <div class="setting-row">
        <span class="setting-label">API Key</span>
        <input type="password" v-model="settings.apiKey" class="neo-input" placeholder="sk-..." />
      </div>
      <div class="setting-row">
        <span class="setting-label">模型名称</span>
        <input type="text" v-model="settings.apiModel" class="neo-input" placeholder="gpt-4o" />
      </div>
      <div class="setting-row">
        <span class="setting-label">API URL</span>
        <input type="text" v-model="settings.apiUrl" class="neo-input" placeholder="https://api.openai.com/v1" />
      </div>
    </div>
    </div>
  </div>

  <!-- 恢复默认：面板外，固定在底部（不参与三列流） -->
  <div class="settings-footer">
    <button class="reset-btn" @click="settings.resetDefaults()">恢复默认设置</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSettingsStore } from '../../store/settingsStore';
import { FACTION_SCHEMES } from '../../config/factionThemes';
import { getState, addListener, removeListener, skipToNext, playTrack, getTrackEntries, type MusicManagerState } from '../../services/MusicManager';
import {
  FONT_CATALOG,
  SYSTEM_FONT_ID,
  ensureFontFacesInjected,
  detectFontCoverage,
  type FontCoverage,
} from '../../services/fontManager';

const settings = useSettingsStore() as any;

// ===== [v66] 字体与字号 =====
// 字体清单是编译期扫描 assets/fonts/ 得到的（见 services/fontManager.ts），无需手工维护。
// 打开设置页时确保动态 @font-face 已注入，否则预览/切换拿不到族名。
ensureFontFacesInjected();

// [v99] 不再写"雅黑"：雅黑是商业授权字体，项目既不默认使用、也不应该出现在选项文案里，
//   否则等于向用户暗示"这就是本项目的字体"。
const SYSTEM_FONT_HINT = '系统字体栈';

/** 各字体的字形覆盖检测结果（异步填充；未检测时下拉里只显示字体名）。 */
const coverageMap = ref<Record<string, FontCoverage>>({});

function coverageTag(id: string): string {
  const c = coverageMap.value[id];
  if (!c) return '';
  if (c.cjk && c.latin) return '　· 中/英';
  if (c.cjk) return '　· 仅中文（英文回落）';
  if (c.latin) return '　· 仅拉丁（中文回落）';
  return '　· 无可用字形';
}

const currentCoverage = computed<FontCoverage | null>(() => coverageMap.value[settings.uiFont ?? ''] ?? null);

function onFontChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  // 直接写 store ⇒ App.vue 的 watch 立即改写 --dmc-font / --dmc-font-mono（所见即所得，不用重启）
  settings.uiFont = v;
}

onMounted(async () => {
  // 逐个字体测字形覆盖：必须真的把文件加载进来才能判「有没有这个字」，
  // 所以只在本面板打开时做（不在启动时预加载）。并发跑，几 MB 的字体也能在 1s 内出标注。
  await Promise.all(
    FONT_CATALOG.map(async (f) => {
      if (coverageMap.value[f.id]) return;
      try {
        const c = await detectFontCoverage(f);
        coverageMap.value = { ...coverageMap.value, [f.id]: c };
      } catch { /* 单个字体检测失败不影响其它 */ }
    }),
  );
});

// [2026-09-20] 原「战场显示」模式选择（bfMode / setBfMode）已随
//   「星域棋盘 / 全息战术投影 / 3D 战场」三种模式一并删除 —— 现在只有指挥制。
//   ⚠ 不要再加回来：非指挥模式的代码会让"写了却不显示"的问题重新出现。

// 舰船模型精细度（high 原始 / medium LOD1 / low LOD2）——由战斗 3D 层在创建时读取生效
const shipDetail = computed<'high' | 'medium' | 'low'>({
  get: () => settings.shipModelDetail ?? 'high',
  set: (v) => { settings.shipModelDetail = v; },
});
function onShipDetailChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (v === 'high' || v === 'medium' || v === 'low') shipDetail.value = v;
}

// 3D 战场画质档（high/medium/low）——由战斗 3D 层在创建时读取生效（下一场战斗生效）。
// 帧率保护 / 显示帧率两项直接用 v-model 绑 settings（同为 3D 层创建时读取）。
const b3dQuality = computed<'high' | 'medium' | 'low'>({
  get: () => settings.battle3dQuality ?? 'high',
  set: (v) => { settings.battle3dQuality = v; },
});
function onB3dQualityChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (v === 'high' || v === 'medium' || v === 'low') b3dQuality.value = v;
}

// [v4] 开场动画形式（door 传送门 / sphere 能量球 / off 关闭）——由战斗 3D 层在创建时读取生效（下一场战斗生效）。
const entryFx = computed<'door' | 'sphere' | 'off'>({
  get: () => settings.entryFxStyle ?? 'door',
  set: (v) => { settings.entryFxStyle = v; },
});
function onEntryFxChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (v === 'door' || v === 'sphere' || v === 'off') entryFx.value = v;
}

// 战略星图显示模式（宇宙 / 悬浮板）
const starmapMode = computed<'universe' | 'holo'>({
  get: () => settings.starmapDisplayMode === 'universe' ? 'universe' : 'holo',
  set: (v) => { settings.starmapDisplayMode = v; },
});
function setStarmapMode(v: 'universe' | 'holo') { starmapMode.value = v; }

// 势力配色方案
const schemes = FACTION_SCHEMES;
const factionScheme = computed<string>({
  get: () => settings.factionColorScheme,
  set: (v) => { settings.factionColorScheme = v; },
});
const currentScheme = computed(() => schemes.find((s: any) => s.key === factionScheme.value) || null);
function setFactionScheme(key: string) {
  factionScheme.value = key;
  window.dispatchEvent(new Event('faction-scheme-changed'));
}
function onSchemeChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value;
  setFactionScheme(val);
}
function hexToCss(h: number) { return '#' + h.toString(16).padStart(6, '0'); }

// 曲目列表（下拉选项）
const trackList = getTrackEntries();

// 曲目状态
const currentTrack = ref<string | null>(null);
const currentTrackNum = ref<number | null>(null);
const displayTrackName = computed(() => {
  if (!currentTrack.value) return '—';
  return currentTrack.value.length > 28
    ? currentTrack.value.slice(0, 26) + '…'
    : currentTrack.value;
});

const onMusicState = (state: MusicManagerState) => {
  currentTrack.value = state.currentTrack;
  currentTrackNum.value = state.currentTrackNum;
};

onMounted(() => {
  const s = getState();
  currentTrack.value = s.currentTrack;
  currentTrackNum.value = s.currentTrackNum;
  addListener(onMusicState);
});

onUnmounted(() => {
  removeListener(onMusicState);
});

function skipTrack() { skipToNext(); }
function onTrackSelect(e: Event) {
  const val = parseInt((e.target as HTMLSelectElement).value);
  if (val > 0) playTrack(val);
}
</script>

<style scoped>
/* [v67] 桌面端三列：原 grid 1fr 1fr 是**逐行配对**（row1 = 音频 | 3D，row2 = 星图 | 字体 …），
   行高被行内最高的一节撑起 ⇒ 音频被拉到 523px、右侧留一大块空，整页仍要滚 540px。
   现在改成**三个独立的纵向列**（按内容高度手工配平，见各列注释），列内自然堆叠：
   · 不再有行高耦合，也就不会"一列空着另一列很长"；
   · 三列总高 ≈ 570，1560px 宽弹窗里一屏放得下（1920×1080 / 1600×900 实测 0 滚动）。
   ⚠ 不要改回 grid 逐行配对；也不要用 CSS 多列（column-count）——它在"整块不切断"时配不平，
     会把第 3 列留成半空（实测 671/550/306）。 */
.settings-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 26px; align-items: start; }
.settings-col { display: flex; flex-direction: column; min-width: 0; }
.settings-section { display: flex; flex-direction: column; gap: 9px; min-width: 0; margin-bottom: 18px; }
.settings-col > .settings-section:last-child { margin-bottom: 0; }
.section-title { font-size: calc(13px * var(--font-scale)); font-weight: 800; color: var(--color-cyan); border-bottom: 1px solid rgba(6,182,212,0.2); padding-bottom: 6px; display: flex; align-items: center; }

.setting-row { display: flex; align-items: center; gap: 10px; padding: 2px 0; }
.setting-label { flex: 0 0 96px; font-size: calc(13px * var(--font-scale)); font-weight: 700; color: var(--color-text-primary); white-space: nowrap; }
.setting-value { font-size: calc(12px * var(--font-scale)); font-weight: 700; color: var(--color-text-disabled); min-width: 50px; text-align: right; }
.setting-hints { display: flex; flex-direction: column; gap: 3px; }
.setting-hint { font-size: calc(11px * var(--font-scale)); color: var(--color-text-disabled); padding: 0; line-height: 1.45; }
.setting-hint code { font-size: calc(10px * var(--font-scale)); color: var(--color-cyan); background: rgba(6,182,212,0.08); padding: 0 4px; border-radius: 3px; font-family: var(--dmc-font-mono); }

/* [v66] 字体预览：用当前生效字体渲染，选中即变（所见即所得）。min-height 而非 height，字号放大时不裁切。 */
.font-preview {
  border: 1px dashed rgba(6,182,212,0.25); border-radius: 6px;
  padding: 8px 10px; background: rgba(0,0,0,0.25);
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
}
.font-preview-line { font-size: calc(16px * var(--font-scale)); font-weight: 700; color: var(--color-text-primary); line-height: 1.35; word-break: break-all; }
.font-preview-sub { font-size: calc(11px * var(--font-scale)); color: var(--color-text-disabled); line-height: 1.35; }

.setting-slider {
  flex: 1; min-width: 0; height: 6px;
  -webkit-appearance: none; appearance: none;
  background: var(--overlay-hover); border-radius: 3px; outline: none;
  cursor: pointer;
}
.setting-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
  background: var(--color-cyan); cursor: pointer;
}

.toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--overlay-hover); border-radius: 12px; transition: 0.2s;
}
.toggle-slider::before {
  content: ''; position: absolute; height: 18px; width: 18px;
  left: 3px; bottom: 3px; background: var(--color-text-primary);
  border-radius: 50%; transition: 0.2s;
}
.toggle-switch input:checked + .toggle-slider { background: var(--color-cyan); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }

.neo-select {
  flex: 1; min-width: 0; padding: 8px 12px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(6,182,212,0.25);
  color: var(--color-text-primary); font-size: calc(13px * var(--font-scale)); font-weight: 600;
  border-radius: 6px; outline: none; cursor: pointer;
}
.neo-input {
  flex: 1; min-width: 0; padding: 8px 12px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(6,182,212,0.25);
  color: var(--color-text-primary); font-size: calc(13px * var(--font-scale)); font-weight: 600;
  border-radius: 6px; outline: none; transition: border 0.2s;
}
.neo-input:focus { border-color: var(--color-cyan); }

.track-name {
  flex: 1; min-width: 0; padding: 6px 10px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(6,182,212,0.12);
  border-radius: 5px; font-size: calc(11px * var(--font-scale)); font-weight: 600;
  color: var(--color-text-disabled);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.skip-btn {
  flex: 0 0 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid rgba(6,182,212,0.2); border-radius: 5px;
  color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s;
}
.skip-btn:hover { border-color: var(--color-cyan); color: var(--color-cyan); }

.mode-switch-group { flex: 1; display: flex; gap: 10px; flex-wrap: wrap; }
.mode-switch-group .mode-btn { min-width: 110px; }
.mode-btn {
  flex: 1; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: var(--overlay-surface); border: 2px solid var(--overlay-hover);
  border-radius: 8px; cursor: pointer; transition: all 0.2s; text-align: center;
}
.mode-btn:hover { border-color: rgba(6,182,212,0.3); }
.mode-btn.active { border-color: var(--color-cyan); background: rgba(6,182,212,0.08); }
.mode-icon { display: flex; align-items: center; color: var(--color-text-secondary); }
.mode-label { font-size: calc(13px * var(--font-scale)); font-weight: 800; color: var(--color-text-primary); }
.mode-desc { font-size: calc(10px * var(--font-scale)); color: var(--color-text-disabled); }

/* 配色预览（下拉框下方色块预览） */
.scheme-preview { display: flex; align-items: center; gap: 8px; padding: 4px 2px; flex-wrap: wrap; }
.scheme-preview-label { font-size: calc(11px * var(--font-scale)); color: var(--color-text-disabled); font-family: var(--font-family); }
.swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; box-shadow: 0 0 6px rgba(0,0,0,0.4); }
.swatch.ally { border: 1px solid rgba(255,255,255,0.3); }
.swatch.empire { border: 1px solid rgba(255,255,255,0.3); }

/* 恢复默认（面板外、贴底，不参与三列流） */
.settings-footer { display: flex; justify-content: flex-end; padding-top: 10px; border-top: 1px solid var(--overlay-hover); flex-shrink: 0; }
.reset-btn {
  padding: 8px 18px; font-size: calc(12px * var(--font-scale)); font-weight: 700; color: var(--color-text-disabled);
  background: transparent; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.reset-btn:hover { color: var(--color-warning); border-color: var(--color-warning); }

/* 窄屏回落：窗口拉窄时列数递减（媒体查询按真实视口，不受 zoom 影响）。
   ⚠ 阈值按"弹窗内可用宽"折算：单列观感低于 ~430px 就开始挤。
   两列时第三列（字体 / 接口）横跨整行、内部再并排两列，避免出现半宽的孤岛。 */
@media (max-width: 1239px) {
  .settings-body { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settings-col-c { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 26px; align-items: start; }
}
/* 窄屏收紧纵向节奏（段间距 / 行距 / 提示行高），把 1280 档的滚动条压掉 */
@media (max-width: 1360px) {
  .settings-section { gap: 7px; margin-bottom: 14px; }
  .setting-row { padding: 1px 0; }
  .setting-hint { line-height: 1.4; }
}
@media (max-width: 780px) {
  .settings-body { grid-template-columns: 1fr; }
  .settings-col-c { display: flex; flex-direction: column; }
}
</style>
