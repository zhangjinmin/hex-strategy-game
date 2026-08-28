import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './', // 必须添加此行
  plugins: [vue()],
  // ... 其他配置
})
