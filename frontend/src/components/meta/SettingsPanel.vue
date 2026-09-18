<template>
  <div class="settings-body">
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

    <!-- 战场显示 -->
    <div class="settings-section">
      <div class="section-title">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:5px;"><polygon points="8,1 14,5 14,11 8,15 2,11 2,5"/></svg>
        战场显示
      </div>
      <div class="setting-row">
        <span class="setting-label">默认战场模式</span>
        <div class="mode-switch-group">
          <button class="mode-btn" :class="{ active: bfMode === 'command' }" @click="setBfMode('command')">
            <span class="mode-icon"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="2"/><path d="M8 2v2"/><path d="M8 12v2"/><path d="M2 8h2"/><path d="M12 8h2"/><circle cx="8" cy="8" r="6" stroke-dasharray="2 2"/></svg></span>
            <span class="mode-label">指挥模式</span>
            <span class="mode-desc">纯宇宙扫描投影 · 指挥链作战（默认）</span>
          </button>
          <button class="mode-btn" :class="{ active: bfMode === 'hex' }" @click="setBfMode('hex')">
            <span class="mode-icon"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3"><polygon points="8,1 14,5 14,11 8,15 2,11 2,5"/></svg></span>
            <span class="mode-label">星域棋盘</span>
            <span class="mode-desc">经典六角格战术视图</span>
          </button>
          <button class="mode-btn" :class="{ active: bfMode === 'crt' }" @click="setBfMode('crt')">
            <span class="mode-icon"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3"/><line x1="8" y1="0.5" x2="8" y2="2"/><line x1="8" y1="14" x2="8" y2="15.5"/></svg></span>
            <span class="mode-label">全息战术投影</span>
            <span class="mode-desc">CRT复古显示器风格</span>
          </button>
          <button class="mode-btn" :class="{ active: bfMode === '3d' }" @click="setBfMode('3d')">
            <span class="mode-icon"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 4.5L8 1l6.5 3.5v7L8 15l-6.5-3.5z"/><path d="M1.5 4.5L8 8l6.5-3.5"/><path d="M8 8v7"/></svg></span>
            <span class="mode-label">3D 战场</span>
            <span class="mode-desc">Three.js 全维战术沙盘</span>
          </button>
        </div>
      </div>
      <div class="setting-row">
        <span class="setting-label">舰船模型精细度</span>
        <select class="neo-select" :value="shipDetail" @change="onShipDetailChange">
          <option value="high">高（原始 ~5 万面）</option>
          <option value="medium">中（LOD1 ≈20% 三角数）</option>
          <option value="low">低（LOD2 ≈5% 三角数）</option>
        </select>
      </div>
      <div class="setting-hint">降低舰船模型面数可提升帧率（尤其核显）。轮廓线框各档位均保留 —— 它是 CRT 扫描线风格的主要来源；各档差别只在折角密度（中档只留硬折角）。下一场战斗生效。</div>
    </div>

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
      <div class="setting-hint">核显卡顿时优先调低画质档（中/低会降低 3D 渲染分辨率与抗锯齿）。</div>
      <div class="setting-hint">帧率保护：低于约 45fps 时自动把多余实体退回光点层；跑得动时完全不生效。</div>
      <div class="setting-hint">显示帧率：3D 战场右下角显示实时帧率，用于对比调档前后。画质档下一场战斗生效。</div>
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
      <div class="setting-hint">统一放大界面文字、按钮、菜单（80%~140%）。</div>
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

    <!-- 恢复默认 -->
    <div class="settings-footer">
      <button class="reset-btn" @click="settings.resetDefaults()">恢复默认设置</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSettingsStore } from '../../store/settingsStore';
import { FACTION_SCHEMES } from '../../config/factionThemes';
import { getState, addListener, removeListener, skipToNext, playTrack, getTrackEntries, type MusicManagerState } from '../../services/MusicManager';

const settings = useSettingsStore() as any;

const bfMode = computed<'hex' | 'crt' | '3d' | 'command'>({
  get: () => settings.battlefieldMode,
  set: (v) => { settings.battlefieldMode = v; },
});
function setBfMode(v: 'hex' | 'crt' | '3d' | 'command') { bfMode.value = v; }

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
/* 两列布局：充分利用弹窗宽度，避免竖长条 */
.settings-body { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 22px; }
.settings-section { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.section-title { font-size: 13px; font-weight: 800; color: var(--color-cyan); border-bottom: 1px solid rgba(6,182,212,0.2); padding-bottom: 6px; display: flex; align-items: center; }

.setting-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.setting-label { flex: 0 0 90px; font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.setting-value { font-size: 12px; font-weight: 700; color: var(--color-text-disabled); min-width: 50px; text-align: right; }
.setting-hint { font-size: 11px; color: var(--color-text-disabled); padding: 2px 0; line-height: 1.4; }

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
  color: var(--color-text-primary); font-size: 13px; font-weight: 600;
  border-radius: 6px; outline: none; cursor: pointer;
}
.neo-input {
  flex: 1; min-width: 0; padding: 8px 12px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(6,182,212,0.25);
  color: var(--color-text-primary); font-size: 13px; font-weight: 600;
  border-radius: 6px; outline: none; transition: border 0.2s;
}
.neo-input:focus { border-color: var(--color-cyan); }

.track-name {
  flex: 1; min-width: 0; padding: 6px 10px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(6,182,212,0.12);
  border-radius: 5px; font-size: 11px; font-weight: 600;
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
.mode-label { font-size: 13px; font-weight: 800; color: var(--color-text-primary); }
.mode-desc { font-size: 10px; color: var(--color-text-disabled); }

/* 配色预览（下拉框下方色块预览） */
.scheme-preview { display: flex; align-items: center; gap: 8px; padding: 4px 2px; flex-wrap: wrap; }
.scheme-preview-label { font-size: 11px; color: var(--color-text-disabled); font-family: monospace; }
.swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; box-shadow: 0 0 6px rgba(0,0,0,0.4); }
.swatch.ally { border: 1px solid rgba(255,255,255,0.3); }
.swatch.empire { border: 1px solid rgba(255,255,255,0.3); }

/* 恢复默认（横跨两列底部） */
.settings-footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; padding-top: 12px; border-top: 1px solid var(--overlay-hover); }
.reset-btn {
  padding: 8px 18px; font-size: 12px; font-weight: 700; color: var(--color-text-disabled);
  background: transparent; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.reset-btn:hover { color: var(--color-warning); border-color: var(--color-warning); }

/* 窄屏：回到单列 */
@media (max-width: 720px) {
  .settings-body { grid-template-columns: 1fr; }
}
</style>
