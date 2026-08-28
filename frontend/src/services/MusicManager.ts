/**
 * MusicManager — 背景音乐播放服务 (v2)
 *
 * 功能：
 * - 随机顺序播放 public/music/track_XX.mp3
 * - 曲终自动切歌 | 手动选曲 | 音量/开关控制
 * - 单 Audio 实例，避免反复创建导致的事件泄露
 *
 * 文件命名：track_01.mp3 ~ track_33.mp3（纯ASCII，Go embed 兼容）
 *  增删曲目：调整 TOTAL_TRACKS + TRACK_NAMES 映射即可。
 */

// ── 曲目总数 ──
const TOTAL_TRACKS = 33;

// ── 曲目名称映射 ──
const TRACK_NAMES: Record<number, string> = {
  1:  'Binary Star (Vocal)',
  2:  '暗雲',
  3:  '出航',
  4:  '想い',
  5:  '高雅',
  6:  '感傷',
  7:  'ゴールデンバウム',
  8:  '緊張',
  9:  '戦闘',
  10: '激突',
  11: '休息',
  12: '別離',
  13: '追憶',
  14: 'I AM WAITING FOR YOU (Orch.)',
  15: 'I AM WAITING FOR YOU',
  16: 'Wish (帝国)',
  17: 'Wish (同盟)',
  18: 'Binary Star (OP)',
  19: 'Tranquility (帝国)',
  20: 'Tranquility (同盟)',
  21: 'Tranquility (ED-12)',
  22: 'dust (OP S3)',
  23: 'melt (帝国)',
  24: 'melt (同盟)',
  25: 'dust (OP S3+S4)',
  26: 'SKIES OF LOVE (Orch.)',
  27: 'SKIES OF LOVE',
  28: '帝国軍軍楽曲',
  29: '光の橋を越えて (Orch.)',
  30: '光の橋を越えて',
  31: '旅立ちの序曲 (Orch.)',
  32: '旅立ちの序曲',
  33: '同盟国歌',
};

// ── 类型 ──

export interface MusicManagerState {
  isPlaying: boolean;
  currentTrack: string | null;
  currentTrackNum: number | null;
  volume: number;
  enabled: boolean;
}

type StateListener = (state: MusicManagerState) => void;

// ── 状态 ──

let el: HTMLAudioElement | null = null;
let currentTrackNum: number | null = null;
let listeners: StateListener[] = [];
let enabled = true;
let vol = 0.8;
let unlocked = false;   // 浏览器已允许播放
let pendingTrack: number | null = null; // 等待解锁后播放的曲目

// 洗牌队列
let shuffledQueue: number[] = [];
let queueIndex = -1;

// ── 工具函数 ──

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function trackUrl(num: number): string {
  return `/music/track_${String(num).padStart(2, '0')}.mp3`;
}

function trackName(num: number): string {
  return TRACK_NAMES[num] || `Track ${num}`;
}

function emit() {
  const state: MusicManagerState = {
    isPlaying: !!(el && !el.paused),
    currentTrack: currentTrackNum !== null ? trackName(currentTrackNum) : null,
    currentTrackNum,
    volume: vol,
    enabled,
  };
  listeners.forEach(fn => fn(state));
}

// ── 核心：播放指定曲目 ──

let endedBound = false;

function doPlay(num: number) {
  if (!unlocked) {
    pendingTrack = num;
    return;
  }
  currentTrackNum = num;

  if (!el) {
    el = new Audio();
    el.preload = 'auto';
  }

  // 清理旧监听器，换上新监听器
  el.removeEventListener('ended', onEnded);
  el.removeEventListener('error', onError);
  el.addEventListener('ended', onEnded);
  el.addEventListener('error', onError);

  el.src = trackUrl(num);
  el.volume = enabled ? vol : 0;
  el.load();

  el.play().catch((e) => {
    // 浏览器可能仍阻止自动播放
    console.warn('[MusicManager] play rejected:', e.message);
  });
  emit();
}

function onEnded() {
  playNext();
}

function onError() {
  console.warn(`[MusicManager] 加载失败: track_${String(currentTrackNum ?? 0).padStart(2, '0')}.mp3`);
  setTimeout(playNext, 2000);
}

function playNext() {
  if (shuffledQueue.length === 0 || queueIndex >= shuffledQueue.length - 1) {
    shuffledQueue = shuffle(Array.from({ length: TOTAL_TRACKS }, (_, i) => i + 1));
    queueIndex = -1;
  }
  queueIndex++;
  const num = shuffledQueue[queueIndex];
  if (num) doPlay(num);
}

/** 解锁音频（首次用户交互后调用） */
function unlock() {
  if (unlocked) return;
  unlocked = true;
  if (pendingTrack !== null) {
    const t = pendingTrack;
    pendingTrack = null;
    doPlay(t);
  } else if (enabled) {
    // 尚未初始化队列 → 随机起播
    if (shuffledQueue.length === 0) playNext();
    else if (currentTrackNum !== null) doPlay(currentTrackNum);
  }
}

// ── 公开 API ──

export function initMusic() {
  if (enabled && !unlocked) {
    // 准备队列但不播放（等用户交互）
    shuffledQueue = shuffle(Array.from({ length: TOTAL_TRACKS }, (_, i) => i + 1));
    queueIndex = 0;
    pendingTrack = shuffledQueue[0];
  }
}

export function unlockAudio() {
  unlock();
}

export function playTrack(num: number) {
  if (num < 1 || num > TOTAL_TRACKS) return;
  doPlay(num);
}

export function setEnabled(value: boolean) {
  enabled = value;
  if (el) {
    el.volume = value ? vol : 0;
  }
  if (value) {
    if (pendingTrack !== null && unlocked) {
      doPlay(pendingTrack);
      pendingTrack = null;
    } else if (currentTrackNum !== null && el?.paused && unlocked) {
      el.play().catch(() => {});
    } else if (!currentTrackNum && unlocked) {
      playNext();
    }
  } else {
    el?.pause();
  }
  emit();
}

export function setVolume(value: number) {
  vol = Math.max(0, Math.min(1, value / 100));
  if (el) el.volume = enabled ? vol : 0;
  emit();
}

export function skipToNext() {
  playNext();
}

/** 获取曲目列表（供UI下拉框使用） */
export function getTrackEntries(): { num: number; name: string }[] {
  const list: { num: number; name: string }[] = [];
  for (let i = 1; i <= TOTAL_TRACKS; i++) {
    list.push({ num: i, name: TRACK_NAMES[i] || `Track ${i}` });
  }
  return list;
}

export function addListener(fn: StateListener) { listeners.push(fn); }
export function removeListener(fn: StateListener) { listeners = listeners.filter(l => l !== fn); }

export function getState(): MusicManagerState {
  return {
    isPlaying: !!(el && !el.paused),
    currentTrack: currentTrackNum !== null ? trackName(currentTrackNum) : null,
    currentTrackNum,
    volume: vol,
    enabled,
  };
}
