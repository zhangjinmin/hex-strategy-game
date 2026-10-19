<template>
  <!-- [v99] 小地图：**只画点**的顶视态势板（无地形、无边框装饰、无文字）
       · 数据源 = store.minimap（BattleScene 以 ~7Hz 发布的位置投影），不是第二套真源；
       · 迷雾口径与战场一致：我方恒显、敌方只有 live 才是实心红点，
         fuzzy / last_known 画成空心灰环 —— 否则小地图会变成"透视外挂"；
       · 点击 = 移动镜头（不开新界面），所以它只是"看一眼 + 跳过去"。 -->
  <div v-if="state" class="minimap" @mousedown.prevent="onClick">
    <canvas ref="cv" class="minimap-canvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useGameStore } from '../../store/gameStore';

/**
 * 快照类型在本组件内**本地声明**：它只是"渲染用的投影数据"，
 * 不从 store 里导出类型 —— 避免两个模块为一个纯展示结构互相耦合。
 */
interface MiniUnit { x: number; y: number; team: number; own: boolean; mode: string; scale: number }
interface MiniState {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  units: MiniUnit[];
  view: { x0: number; y0: number; x1: number; y1: number } | null;
}

const store = useGameStore();
const minimap = computed<MiniState | null>(() => ((store as any).minimap ?? null) as MiniState | null);
const state = computed(() => minimap.value);

const cv = ref<HTMLCanvasElement | null>(null);
/** 画布边长（CSS px）。取 168：右下角既不压住底部指令条，也够看清点群形状。 */
const SIZE = 168;

const COLORS = {
  own: '#38bdf8',        // 我方：青蓝（与舰队卡同色）
  enemyLive: '#ef4444',  // 已确认敌方：实心红
  enemyGhost: '#94a3b8', // 未确认：空心灰环（"有个东西"，但不确定是什么）
  view: 'rgba(226,232,240,0.55)',
};

/** 世界坐标 → 画布坐标（等比缩放 + 居中留边，避免拉伸变形）。 */
function makeProjector(b: { minX: number; maxX: number; minY: number; maxY: number }) {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const k = (SIZE - 12) / Math.max(w, h);   // 留 6px 边距
  const ox = (SIZE - w * k) / 2;
  const oy = (SIZE - h * k) / 2;
  return {
    toCanvas: (x: number, y: number) => ({ x: ox + (x - b.minX) * k, y: oy + (y - b.minY) * k }),
    k,
    ox,
    oy,
    b,
  };
}

let raf = 0;
let proj: ReturnType<typeof makeProjector> | null = null;

function draw() {
  raf = requestAnimationFrame(draw);
  const c = cv.value;
  const s = minimap.value;
  if (!c || !s) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const target = Math.floor(SIZE * dpr);
  if (c.width !== target) { c.width = target; c.height = target; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  proj = makeProjector(s.bounds);

  // 1) 视野框（最底层，避免盖住点）
  if (s.view) {
    const a = proj.toCanvas(s.view.x0, s.view.y0);
    const b2 = proj.toCanvas(s.view.x1, s.view.y1);
    ctx.strokeStyle = COLORS.view;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(a.x, a.y, b2.x - a.x, b2.y - a.y);
    ctx.setLineDash([]);
  }

  // 2) 舰队点：我方恒显；敌方按情报档位分"实心/空心"
  for (const u of s.units) {
    const p = proj.toCanvas(u.x, u.y);
    const r = Math.max(1.6, u.scale);
    // [v99] 用**快照里的 `own` 标记**判阵营，不在前端硬编码 team 号：
    //   演习/战役两条轨道的玩家 team 不保证都是 1。
    const isOwn = u.own;
    const solid = isOwn || u.mode === 'live';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (solid) {
      ctx.fillStyle = isOwn ? COLORS.own : COLORS.enemyLive;
      ctx.fill();
    } else {
      // fuzzy / last_known：空心灰环 —— "知道那边有东西，但不确定"
      ctx.strokeStyle = COLORS.enemyGhost;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function onClick(e: MouseEvent) {
  const s = minimap.value;
  if (!s || !proj) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  // 画布 → 世界（makeProjector 的逆变换）
  const wx = proj.b.minX + (cx - proj.ox) / proj.k;
  const wy = proj.b.minY + (cy - proj.oy) / proj.k;
  // 写入同一个 store 槽；App.vue 监听后调 3D 镜头聚焦（组件本身不碰 3D）
  (store as any).minimapFocus = { x: wx, y: wy, ts: Date.now() };
}

onMounted(() => { raf = requestAnimationFrame(draw); });
onBeforeUnmount(() => { cancelAnimationFrame(raf); });
</script>

<style scoped>
.minimap {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 168px;
  height: 168px;
  z-index: 12;
  border-radius: 10px;
  background: rgba(8, 12, 20, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.22);
  backdrop-filter: blur(2px);
  cursor: crosshair;
  pointer-events: auto;
  /* 窄窗口时不要顶到指令条：整体随视口缩一点，但保持可读 */
  max-width: 22vw;
  max-height: 22vw;
}
.minimap-canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 10px;
}
</style>
