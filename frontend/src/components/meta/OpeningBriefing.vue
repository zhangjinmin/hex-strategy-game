<template>
  <div class="briefing-overlay">
    <div class="briefing-card neo-card">
      <div class="briefing-header">
        <h3 class="text-gold">宇宙历 796年 · 银河战略简报</h3>
        <div class="briefing-meta">统合作战本部 · 绝密</div>
      </div>

      <div class="briefing-body">
        <div class="briefing-section">
          <div class="section-icon">🌌</div>
          <div class="section-content">
            <div class="section-title">银河局势</div>
            <div class="power-bars">
              <div class="power-row">
                <span class="power-label text-empire">银河帝国</span>
                <div class="power-bar-bg"><div class="power-bar-fill empire-fill" :style="{ width: empirePower + '%' }"></div></div>
                <span class="power-val">{{ empirePower }}%</span>
              </div>
              <div class="power-row">
                <span class="power-label text-ally">自由行星同盟</span>
                <div class="power-bar-bg"><div class="power-bar-fill ally-fill" :style="{ width: alliancePower + '%' }"></div></div>
                <span class="power-val">{{ alliancePower }}%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="briefing-section">
          <div class="section-icon">🎯</div>
          <div class="section-content">
            <div class="section-title">当前战略目标</div>
            <p class="briefing-text" v-html="strategicObjective"></p>
          </div>
        </div>

        <div class="briefing-section">
          <div class="section-icon">👤</div>
          <div class="section-content">
            <div class="section-title">你的任命</div>
            <p class="briefing-text">
              <span :class="faction === 'empire' ? 'text-empire' : 'text-ally'">{{ admiralName }}</span>
              已被任命为舰队司令，麾下舰队待命于前线基地。
            </p>
          </div>
        </div>

        <div class="briefing-section">
          <div class="section-icon">💡</div>
          <div class="section-content">
            <div class="section-title">建议第一步</div>
            <ul class="briefing-steps">
              <li>打开 <b>星图</b> 查看阵营边界与兵力分布</li>
              <li>前往 <b>军令部</b> 确认是否有待处理提案</li>
              <li>在 <b>出击部署</b> 中编组舰队，准备首次跃迁</li>
              <li>或在 <b>战术模拟</b> 中演练会战（无需开局）</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="briefing-footer">
        <label class="dont-show">
          <input type="checkbox" v-model="dontShowAgain" /> 下次不再显示
        </label>
        <button class="neo-btn text-emerald" @click="close">了解，就任舰队司令</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';

const store = useGameStore() as any;
const settings = useSettingsStore();
const emit = defineEmits(['close']);
const dontShowAgain = ref(false);

const faction = computed(() => {
  const adm = (store.allAdmirals?.value || store.allAdmirals || []).find((a: any) => a.id === store.playerAdmiralId);
  return adm?.faction || 'alliance';
});

const admiralName = computed(() => {
  const adm = (store.allAdmirals?.value || store.allAdmirals || []).find((a: any) => a.id === store.playerAdmiralId);
  return `${adm?.rankName || ''} ${adm?.name || '提督'}`;
});

const empirePower = computed(() => {
  const facs = store.factions || [];
  const emp = facs.find((f: any) => f.team === 2);
  const ally = facs.find((f: any) => f.team === 1);
  const total = (emp?.hp || 0) + (ally?.hp || 0);
  if (total === 0) return 50;
  return Math.round(((emp?.hp || 0) / total) * 100);
});

const alliancePower = computed(() => 100 - empirePower.value);

const strategicObjective = computed(() => {
  if (faction.value === 'empire') {
    return '银河帝国正处于扩张期。统帅本部已下达指示：<b>巩固帝国边境、伺机攻取同盟外围星系</b>，为伊谢尔伦攻略创造条件。';
  }
  return '自由行星同盟处于战略防御态势。最高评议会要求：<b>守住现有防线、寻找反击突破口</b>，同时警惕帝国对伊谢尔伦的动向。';
});

const close = () => {
  if (dontShowAgain.value) {
    (settings.briefingDisabled as any as boolean) = true;
    // 强制持久化
    try { (settings as any).save(); } catch { }
  }
  emit('close');
};
</script>

<style scoped>
.briefing-overlay {
  position: fixed; inset: 0; z-index: 3500;
  background: var(--overlay-scrim);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px);
}
.briefing-card {
  width: 540px; max-width: 95vw; max-height: 88vh;
  padding: 28px; display: flex; flex-direction: column; gap: 20px;
  overflow-y: auto;
}
.briefing-header { text-align: center; }
.briefing-meta { font-size: 11px; color: var(--color-text-disabled); margin-top: 4px; letter-spacing: 2px; }
.briefing-body { display: flex; flex-direction: column; gap: 16px; }
.briefing-section { display: flex; gap: 12px; align-items: flex-start; }
.section-icon { font-size: 22px; flex-shrink: 0; }
.section-content { flex: 1; }
.section-title { font-size: 13px; font-weight: 800; color: var(--color-cyan); margin-bottom: 6px; }
.briefing-text { font-size: 13px; color: var(--color-text-secondary); line-height: 1.6; margin: 0; }
.briefing-steps { margin: 0; padding-left: 16px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.8; }

.power-bars { display: flex; flex-direction: column; gap: 8px; }
.power-row { display: flex; align-items: center; gap: 8px; }
.power-label { font-size: 12px; font-weight: 700; width: 100px; flex-shrink: 0; }
.power-bar-bg { flex: 1; height: 8px; background: var(--overlay-hover); border-radius: 4px; overflow: hidden; }
.power-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
.empire-fill { background: var(--color-empire); }
.ally-fill { background: var(--color-cyan); }
.power-val { font-size: 12px; font-weight: 800; min-width: 36px; text-align: right; }

.briefing-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--overlay-hover); }
.dont-show { font-size: 12px; color: var(--color-text-disabled); display: flex; align-items: center; gap: 6px; cursor: pointer; }

.text-gold { color: var(--color-warning); }
.text-empire { color: var(--color-empire) !important; }
.text-ally { color: var(--color-cyan) !important; }
.text-emerald { color: var(--color-green) !important; }
</style>
