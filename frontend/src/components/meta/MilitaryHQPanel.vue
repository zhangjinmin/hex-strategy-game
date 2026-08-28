<template>
  <div class="military-hq-panel">
    <FleetHQPanel />
  </div>
</template>

<script setup lang="ts">
import FleetHQPanel from './FleetHQPanel.vue';
</script>

<style scoped>
.military-hq-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
</style>
