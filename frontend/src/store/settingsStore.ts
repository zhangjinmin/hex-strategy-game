import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { FactionSchemeKey } from '../config/factionThemes';

export const useSettingsStore = defineStore('settings', () => {
  // ===== 音频 =====
  const musicVolume = ref(80);
  const sfxVolume = ref(100);
  const musicEnabled = ref(true);
  const sfxEnabled = ref(true);
  const musicTrack = ref('default');

  // ===== 界面 =====
  const briefingDisabled = ref(false);
  // UI 缩放因子（80%~140%）：全局统一放大按钮/菜单/文字，解决"文字太小"
  const uiScale = ref(100);

  // ===== 战场模式 =====
  const battlefieldMode = ref<'hex' | 'crt'>('hex');

  // ===== 战略星图显示模式 =====
  // 'universe' 宇宙模式：无悬浮板，纯星际状态（全息沙盘原始观感）—— 默认模式
  // 'holo' 悬浮板：四角三维竖牌（垂直托盘、随地图侧转、暂停回正+微浮动）
  const starmapDisplayMode = ref<'universe' | 'holo'>('universe');

  // ===== 势力配色方案 =====
  const factionColorScheme = ref<FactionSchemeKey>('default');

  // ===== API 设置 =====
  const apiKey = ref('');
  const apiModel = ref('gpt-4o');
  const apiUrl = ref('https://api.openai.com/v1');

  // ===== 持久化 =====
  const STORAGE_KEY = 'logh_settings';

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        musicVolume.value = data.musicVolume ?? 80;
        sfxVolume.value = data.sfxVolume ?? 100;
        musicEnabled.value = data.musicEnabled ?? true;
        sfxEnabled.value = data.sfxEnabled ?? true;
        musicTrack.value = data.musicTrack ?? 'default';
        battlefieldMode.value = data.battlefieldMode ?? 'hex';
        factionColorScheme.value = data.factionColorScheme ?? 'default';
        // 尊重已保存的模式（旧存档里的 'holo' 也保留）；无存储值时默认 'universe'
        starmapDisplayMode.value = (data.starmapDisplayMode === 'universe' || data.starmapDisplayMode === 'holo')
          ? data.starmapDisplayMode
          : 'universe';
        apiKey.value = data.apiKey ?? '';
        apiModel.value = data.apiModel ?? 'gpt-4o';
        apiUrl.value = data.apiUrl ?? 'https://api.openai.com/v1';
        briefingDisabled.value = data.briefingDisabled ?? false;
        uiScale.value = data.uiScale ?? 100;
      }
    } catch { /* ignore */ }
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        musicVolume: musicVolume.value,
        sfxVolume: sfxVolume.value,
        musicEnabled: musicEnabled.value,
        sfxEnabled: sfxEnabled.value,
        musicTrack: musicTrack.value,
        battlefieldMode: battlefieldMode.value,
        factionColorScheme: factionColorScheme.value,
        starmapDisplayMode: starmapDisplayMode.value,
        apiKey: apiKey.value,
        apiModel: apiModel.value,
        apiUrl: apiUrl.value,
        briefingDisabled: briefingDisabled.value,
        uiScale: uiScale.value,
      }));
    } catch { /* ignore */ }
  };

  // 自动持久化
  watch([musicVolume, sfxVolume, musicEnabled, sfxEnabled, musicTrack, battlefieldMode, factionColorScheme, starmapDisplayMode, briefingDisabled, uiScale, apiKey, apiModel, apiUrl], save, { deep: true });

  // 初始化加载
  load();

  const resetDefaults = () => {
    musicVolume.value = 80;
    sfxVolume.value = 100;
    musicEnabled.value = true;
    sfxEnabled.value = true;
    musicTrack.value = 'default';
    battlefieldMode.value = 'hex';
    factionColorScheme.value = 'default';
    starmapDisplayMode.value = 'universe';
    apiKey.value = '';
    apiModel.value = 'gpt-4o';
    apiUrl.value = 'https://api.openai.com/v1';
    briefingDisabled.value = false;
    uiScale.value = 100;
  };

  return {
    musicVolume, sfxVolume, musicEnabled, sfxEnabled, musicTrack,
    battlefieldMode,
    factionColorScheme,
    starmapDisplayMode,
    apiKey, apiModel, apiUrl,
    briefingDisabled, uiScale,
    load, save, resetDefaults,
  };
});
