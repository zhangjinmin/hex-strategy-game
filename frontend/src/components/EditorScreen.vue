<template>
  <div class="editor-screen">
    <div id="editor-canvas-container" class="canvas-layer"></div>

    <div class="editor-ui neo-card animate-fade">
      <div class="editor-header">
        <h3 class="panel-title-small text-cyan">宙域地图编辑器</h3>
      </div>
      
      <div class="brush-panel">
        <button v-for="b in brushOptions" :key="b.id" @click="currentBrush = b.id" class="neo-btn brush-btn" :class="{active: currentBrush === b.id}">
          {{ b.name }}
        </button>
      </div>
      
      <div class="action-panel">
        <div class="control-group">
          <label>新建地图尺寸 (半径 1-20)</label>
          <div class="flex gap-2">
            <input type="number" v-model="mapRadius" min="1" max="20" class="neo-input flex-1 text-center" />
            <button @click="createNewMap" class="neo-btn text-red btn-create">清空并新建</button>
          </div>
        </div>

        <div class="control-group">
          <label>录入统合作战数据库</label>
          <div class="flex gap-2">
            <input type="text" v-model="mapName" placeholder="在此输入自定义星图名称..." class="neo-input flex-2" />
          </div>
          <button @click="saveCustomMap" class="neo-btn active w-full text-gold">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:4px;"><path d="M2 14h12V4l-3-2H5L2 4v10z"/><path d="M5 2v6h6V2"/><polyline points="4,8 7,11 12,4"/></svg>
            校验并保存星图
          </button>
        </div>
        
        <div class="divider"></div>

        <div class="control-group">
          <button @click="undoEditorAction" class="neo-btn w-full" :disabled="editorHistoryList.length <= 1">撤销上一步</button>
          <div class="flex gap-2">
            <button @click="exportMap" class="neo-btn flex-1" title="唤起另存为窗口">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:3px;"><path d="M8 2v10M3 7l5 5 5-5"/><path d="M2 14h12"/></svg>导出</button>
            <button @click="triggerImport" class="neo-btn flex-1">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:3px;"><path d="M8 14V4M3 9l5-5 5 5"/><path d="M2 2h12"/></svg>导入</button>
            <input type="file" ref="fileInput" @change="handleImport" style="display: none" accept=".json" />
          </div>
          <button @click="exitEditor" class="neo-btn w-full text-player">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:3px;"><path d="M14 8H3M6 3l-5 5 5 5"/></svg>退出编辑
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import * as Phaser from 'phaser';
import { useGameStore } from '../store/gameStore';
import { EditorScene } from '../game/scenes/EditorScene';

const store = useGameStore();
const fileInput = ref<any>(null);

const mapRadius = ref(8);
const mapName = ref('自定义星区-' + Math.floor(Math.random() * 1000));

const brushOptions = [
  { id: 'pending', name: '平原(空白)' },
  { id: 'sea', name: '暗物质(阻挡)' },
  { id: 'ruined', name: '碎石带(减速)' },
  { id: 'planet', name: '● 行星' },
  { id: 'castle', name: '★ 司令部' },
  { id: 'pier', name: '⚲ 补给站' },
  { id: 'gold_mine', name: '✧ 矿区' },
  { id: 'tower', name: '♜ 防卫塔' },
];

const currentBrush = computed<string>({
  get: () => { const r = (store as any).currentBrush; return r?.value !== undefined ? r.value : r; },
  set: (v) => { (store as any).currentBrush = v; }
});

const editorHistoryList = computed<string[]>(() => {
  const r = (store as any).editorHistory;
  return r?.value !== undefined ? r.value : (r || []);
});

const getEditorTilesData = () => {
  const r = (store as any).editorTilesData;
  return r?.value !== undefined ? r.value : (r || []);
};

let editorGameInstance: Phaser.Game | null = null;

const initEditorEngine = () => {
  if (editorGameInstance) {
    editorGameInstance.destroy(true);
    editorGameInstance = null;
  }
  
  const container = document.getElementById('editor-canvas-container');
  if (!container) return;

  editorGameInstance = new Phaser.Game({
    type: Phaser.AUTO,
    width: container.clientWidth,
    height: container.clientHeight,
    parent: 'editor-canvas-container',
    backgroundColor: 'transparent',
    transparent: true,
    scene: [EditorScene]
  });
};

const handleResize = () => {
  if (editorGameInstance) {
    const container = document.getElementById('editor-canvas-container');
    if (container) {
      editorGameInstance.scale.resize(container.clientWidth, container.clientHeight);
    }
  }
};

const refreshSceneMap = () => {
  if (editorGameInstance && editorGameInstance.scene.scenes.length > 0) {
    const scene = editorGameInstance.scene.scenes[0] as EditorScene;
    if (typeof scene.renderMap === 'function') {
       scene.renderMap();
    }
  }
};

onMounted(() => {
  if (typeof (store as any).setPhaserEditorInitializer === 'function') {
    (store as any).setPhaserEditorInitializer(initEditorEngine);
  }
  window.addEventListener('resize', handleResize);
  
  setTimeout(() => initEditorEngine(), 50);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  if (editorGameInstance) {
    editorGameInstance.destroy(true);
    editorGameInstance = null;
  }
});

const createNewMap = () => {
  let tempTiles = [];
  const maxR = Math.min(20, Math.max(1, mapRadius.value));
  for (let q = -maxR; q <= maxR; q++) {
    for (let r = -maxR; r <= maxR; r++) {
      if (Math.abs(q + r) > maxR) continue;
      tempTiles.push({ q, r, type: 'sea' });
    }
  }
  (store as any).editorTilesData = tempTiles;
  (store as any).editorHistory = [JSON.stringify(tempTiles)];
  refreshSceneMap();
  
  if (typeof (store as any).triggerToast === 'function') {
    (store as any).triggerToast(`已生成半径 ${maxR} 的初始星区`);
  }
};

const undoEditorAction = () => {
  const history = editorHistoryList.value;
  if (history.length > 1) {
    history.pop();
    (store as any).editorTilesData = JSON.parse(history[history.length - 1]);
    refreshSceneMap();
  }
};

const saveCustomMap = () => {
  const tiles = getEditorTilesData();
  const validTiles = tiles.filter((t: any) => t.type !== 'sea' && t.type !== 'pending');
  
  if (validTiles.length === 0) {
    if (typeof (store as any).triggerToast === 'function') {
      (store as any).triggerToast("警告：星图为空！请至少放置一个有效节点结构后再保存。");
    }
    return;
  }

  const customId = 'custom_' + Date.now();
  const rawMapsPool = (store as any).mapsPool;
  const pool = rawMapsPool?.value !== undefined ? rawMapsPool.value : rawMapsPool;
  
  pool.push({
    id: customId,
    name: mapName.value || '未命名星图',
    size: validTiles.length + '格',
    desc: '统合作战电脑记录的战区数据。'
  });

  const rawCustom = (store as any).customMapsData;
  const customData = rawCustom?.value !== undefined ? rawCustom.value : rawCustom;
  customData[customId] = JSON.parse(JSON.stringify(tiles));

  (store as any).selectedMapId = customId;
  exitEditor();
};

const exportMap = async () => {
  const dataStr = JSON.stringify(getEditorTilesData(), null, 2);
  const defaultFileName = `${mapName.value}_${Date.now()}.json`;

  try {
    if ('showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: defaultFileName,
        types: [{ description: 'JSON Map Config', accept: {'application/json': ['.json']} }],
      });
      const writable = await handle.createWritable();
      await writable.write(dataStr);
      await writable.close();
      if (typeof (store as any).triggerToast === 'function') (store as any).triggerToast("导出成功");
    } else {
      throw new Error("Fallback to default download");
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }
};

const triggerImport = () => {
  if (fileInput.value) fileInput.value.click();
};

const handleImport = (event: any) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e: any) => {
    try {
      const parsedData = JSON.parse(e.target.result);
      (store as any).editorTilesData = parsedData;
      (store as any).editorHistory = [JSON.stringify(parsedData)];
      
      mapName.value = file.name.replace(/\.[^/.]+$/, "");
      
      if (typeof (store as any).triggerToast === 'function') (store as any).triggerToast("导入地图成功");
      refreshSceneMap();
    } catch (err) {
      if (typeof (store as any).triggerToast === 'function') (store as any).triggerToast("地图文件格式错误");
    }
  };
  reader.readAsText(file);
};

const exitEditor = () => {
  (store as any).gameState = 'strategy';
  (store as any).strategyTab = 'starmap';
};
</script>

<style scoped>
.editor-screen { position: relative; width: 100%; height: 100vh; overflow: hidden; background: var(--neo-body); }
.canvas-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }

.editor-ui { 
  position: absolute; top: 2vh; left: 1vw; width: clamp(280px, 22vw, 340px); 
  padding: 2.5vh 1.5vw; z-index: 100; pointer-events: auto; 
  display: flex; flex-direction: column; gap: 2vh; 
}
.panel-title-small { margin: 0; font-size: clamp(14px, 2vh, 18px); font-weight: 900; border-left: 4px solid var(--color-cyan); padding-left: 10px; }

.brush-panel { display: grid; grid-template-columns: 1fr 1fr; gap: 1vh; }
.brush-btn { padding: 1.2vh 1vw; font-size: clamp(11px, 1.5vh, 13px); font-weight: 800; border: 1px solid var(--overlay-border); }
.brush-btn.active { background: var(--color-cyan); color: var(--neo-surface); border-color: var(--color-cyan); }

.action-panel { display: flex; flex-direction: column; gap: 2vh; }
.control-group { display: flex; flex-direction: column; gap: 1vh; }
.control-group label { font-size: clamp(11px, 1.5vh, 13px); font-weight: 800; color: var(--color-text-secondary); border-left: 3px solid var(--color-cyan); padding-left: 8px; line-height: 1.2; }

.neo-input { width: 100%; padding: 1.2vh 1vw; background: rgba(0,0,0,0.4); border: 1px solid rgba(6, 182, 212, 0.4); color: var(--color-text-primary); font-size: clamp(11px, 1.5vh, 14px); font-weight: 800; border-radius: 6px; outline: none; transition: border 0.2s; }
.neo-input:focus { border-color: var(--color-cyan); }

.action-panel button { font-size: clamp(11px, 1.5vh, 14px); font-weight: 800; padding: 1.2vh 1vw; margin: 0; }
.flex { display: flex; align-items: stretch; }
.gap-2 { gap: 1vh; }
.flex-1 { flex: 1; }
.flex-2 { flex: 2; }
.btn-create { flex: 0 0 auto; white-space: nowrap; }

.divider { height: 1px; background: var(--overlay-hover); margin: 0; }

/* 移动端响应式，停靠底部，紧凑布局且自适应 */
@media (max-width: 768px) {
  .editor-ui { 
    top: auto; bottom: 0; left: 0; width: 100vw; 
    border-radius: 16px 16px 0 0; 
    padding: 2vh 4vw 3vh 4vw; 
    background: var(--overlay-surface);
    backdrop-filter: blur(10px);
    gap: 1.5vh;
  }
  .brush-panel { grid-template-columns: repeat(4, 1fr); gap: 1vh; }
  .brush-btn { padding: 1vh 0.5vw; font-size: clamp(10px, 1.5vh, 12px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .action-panel { gap: 1.5vh; }
  .control-group { gap: 1vh; }
  .action-panel button { padding: 1vh 2vw; }
  .neo-input { padding: 1vh 2vw; }
}
</style>