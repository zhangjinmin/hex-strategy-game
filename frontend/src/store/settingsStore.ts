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
  const battlefieldMode = ref<'hex' | 'crt' | '3d' | 'command'>('command');
  /** 是否显示补给链可视化（补给圈/运输舰/链路）。默认开启，让玩家看清补给范围。 */
  const showSupplyChain = ref(true);
  /** 舰船模型档位：high=原始 ~5万面 / medium=LOD1 ~20% / low=LOD2 ~5%（离线减面产物，缺文件自动回落原始） */
  const shipModelDetail = ref<'high' | 'medium' | 'low'>('high');
  /**
   * 3D 战场画质档：high=现状观感（devicePixelRatio≤2 + 离屏 MSAA 4×）/
   * medium（dpr≤1.5 + MSAA 2×）/ low（dpr≤1 + 无 MSAA）。降低 3D 渲染分辨率与抗锯齿，缓解核显卡顿。
   * 语义 = **下一场战斗生效**（与 shipModelDetail 同规则：3D 层创建时读取一次，热切换需重建整层）。
   */
  const battle3dQuality = ref<'high' | 'medium' | 'low'>('high');
  /**
   * 3D 战场帧率保护：开启后实测帧时 EMA 持续超预算时，自动把多余实体退回光点层（保住帧率）。
   * [v12.1 C3] 默认 **true**（用户实机"帧数很低 / 打着打着就卡" ⇒ 兜底应默认开）；
   * 存量存档经 settingsVersion 迁移也会被置为 true（见 load()：ver<2 强制 true）。
   */
  const battle3dPerfGuard = ref(true);
  /** 3D 战场显示帧率：开启时在 3D 容器一角显示极简实时 FPS，用于对比调档前后。默认关。 */
  const battle3dShowFps = ref(false);

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
        // [v12.1 C3] 设置结构版本：用于把存量存档迁移到新的默认值（缺字段的旧档视为 ver=1）。
        const ver = data.settingsVersion ?? 1;
        musicVolume.value = data.musicVolume ?? 80;
        sfxVolume.value = data.sfxVolume ?? 100;
        musicEnabled.value = data.musicEnabled ?? true;
        sfxEnabled.value = data.sfxEnabled ?? true;
        musicTrack.value = data.musicTrack ?? 'default';
        showSupplyChain.value = data.showSupplyChain ?? true;
        battlefieldMode.value = (data.battlefieldMode === 'hex' || data.battlefieldMode === 'crt' || data.battlefieldMode === '3d' || data.battlefieldMode === 'command')
          ? data.battlefieldMode
          : 'command';
        // 白名单校验：非法值回落 'high'（不静默降画质）
        shipModelDetail.value = (data.shipModelDetail === 'high' || data.shipModelDetail === 'medium' || data.shipModelDetail === 'low')
          ? data.shipModelDetail
          : 'high';
        // 3D 战场性能档（白名单校验：非法值回落 'high'，不静默降画质）
        battle3dQuality.value = (data.battle3dQuality === 'high' || data.battle3dQuality === 'medium' || data.battle3dQuality === 'low')
          ? data.battle3dQuality
          : 'high';
        battle3dPerfGuard.value = ver < 2 ? true : (data.battle3dPerfGuard ?? true);
        battle3dShowFps.value = data.battle3dShowFps ?? false;
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
        settingsVersion: 2,   // [v12.1 C3] 写出结构版本，供下次 load 做迁移判定
        musicVolume: musicVolume.value,
        sfxVolume: sfxVolume.value,
        musicEnabled: musicEnabled.value,
        sfxEnabled: sfxEnabled.value,
        musicTrack: musicTrack.value,
        battlefieldMode: battlefieldMode.value,
        showSupplyChain: showSupplyChain.value,
        shipModelDetail: shipModelDetail.value,
        battle3dQuality: battle3dQuality.value,
        battle3dPerfGuard: battle3dPerfGuard.value,
        battle3dShowFps: battle3dShowFps.value,
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
  watch([musicVolume, sfxVolume, musicEnabled, sfxEnabled, musicTrack, battlefieldMode, factionColorScheme, starmapDisplayMode, briefingDisabled, uiScale, apiKey, apiModel, apiUrl, showSupplyChain, shipModelDetail, battle3dQuality, battle3dPerfGuard, battle3dShowFps], save, { deep: true });

  // 初始化加载
  load();

  const resetDefaults = () => {
    musicVolume.value = 80;
    sfxVolume.value = 100;
    musicEnabled.value = true;
    sfxEnabled.value = true;
    musicTrack.value = 'default';
    battlefieldMode.value = 'command';
    showSupplyChain.value = true;   // 修复：原实现漏重置该项
    shipModelDetail.value = 'high';
    battle3dQuality.value = 'high';
    battle3dPerfGuard.value = true;   // [v12.1 C3] 与默认值一致（帧率保护默认开）
    battle3dShowFps.value = false;
    factionColorScheme.value = 'default';
    starmapDisplayMode.value = 'universe';
    apiKey.value = '';
    apiModel.value = 'gpt-4o';
    apiUrl.value = 'https://api.openai.com/v1';
    briefingDisabled.value = false;
    uiScale.value = 100;
  };

  /**
   * 读取舰船模型档位。
   *  ⚠️ 必须用**函数**而不是直接暴露 ref 读值：本仓 pinia 3.0.4 + TS 4.9.5 下 setup store 的
   *  ref 字段在类型层未被解包（实测类型为 `{ value; [RefSymbol] }`，运行时 pinia 已解包为纯值），
   *  直接 `useSettingsStore().shipModelDetail` 拿到的是错类型，下游只能用 as any 压回去。
   *  返回值是普通函数 → 类型原样透传，调用方拿到正确的字面量联合类型，无需任何断言。
   */
  const getShipModelDetailValue = (): 'high' | 'medium' | 'low' => shipModelDetail.value;

  /** 3D 战场性能三项：同样用函数 getter 透传正确类型（理由见 getShipModelDetailValue）。 */
  const getBattle3dQualityValue = (): 'high' | 'medium' | 'low' => battle3dQuality.value;
  const getBattle3dPerfGuardValue = (): boolean => battle3dPerfGuard.value;
  const getBattle3dShowFpsValue = (): boolean => battle3dShowFps.value;

  return {
    musicVolume, sfxVolume, musicEnabled, sfxEnabled, musicTrack,
    battlefieldMode,
    showSupplyChain,
    shipModelDetail,
    getShipModelDetailValue,
    battle3dQuality,
    battle3dPerfGuard,
    battle3dShowFps,
    getBattle3dQualityValue,
    getBattle3dPerfGuardValue,
    getBattle3dShowFpsValue,
    factionColorScheme,
    starmapDisplayMode,
    apiKey, apiModel, apiUrl,
    briefingDisabled, uiScale,
    load, save, resetDefaults,
  };
});
