import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './', // 必须添加此行
  plugins: [vue()],
  // 3D 模型资源：.glb / .fbx（动作模型）以 URL 形式引入
  assetsInclude: ['**/*.glb', '**/*.fbx'],
  // ... 其他配置
})
