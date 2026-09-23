import {defineConfig, type Plugin, type ViteDevServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * New source GLBs added while `vite` is already running get their LOD siblings
 * without an extra artist command. Generated lod files are intentionally ignored
 * so their writes cannot recursively start another compiler pass.
 */
function shipLodWatchPlugin(): Plugin {
  const generator = fileURLToPath(new URL('./scripts/generateShipLods.mjs', import.meta.url))
  const isSourceShip = (path: string) => /[\\/]src[\\/]assets[\\/]ship[\\/][^\\/]+\.glb$/i.test(path)
    && !/\.lod[12]\.glb$/i.test(path)
  let timer: ReturnType<typeof setTimeout> | undefined
  let compiling = false
  let queued = false

  const compile = (server: ViteDevServer) => {
    if (compiling) { queued = true; return }
    compiling = true
    const child = spawn(process.execPath, [generator], { cwd: process.cwd(), stdio: 'inherit', shell: false })
    child.once('exit', (code) => {
      compiling = false
      if (code === 0) server.ws.send({ type: 'full-reload' })
      if (queued) { queued = false; compile(server) }
    })
    child.once('error', () => { compiling = false })
  }

  return {
    name: 'ship-lod-watch',
    configureServer(server) {
      const schedule = (path: string) => {
        if (!isSourceShip(path)) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => compile(server), 150)
      }
      server.watcher.on('add', schedule)
      server.watcher.on('change', schedule)
      server.httpServer?.once('close', () => {
        server.watcher.off('add', schedule)
        server.watcher.off('change', schedule)
      })
    },
  }
}

export default defineConfig({
  base: './', // 必须添加此行
  plugins: [vue(), shipLodWatchPlugin()],
  // 3D 模型资源：.glb / .fbx（动作模型）以 URL 形式引入
  assetsInclude: ['**/*.glb', '**/*.fbx'],
  // ... 其他配置
})
