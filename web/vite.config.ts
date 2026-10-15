import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端地址，默认与 dev 脚本里的 8090 一致；改端口时用 KANBAN_API 覆盖
// （docker 部署是 8080，dev 特意错开，免得和已运行的容器/其它服务打架）
const API = process.env.KANBAN_API ?? 'http://127.0.0.1:8090'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/static',
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'] } } },
  },
  server: {
    // 固定绑 IPv4：localhost 与 127.0.0.1 在浏览器里是两个不同的 cookie 域，
    // 混用会出现"明明登录了却提示未登录"，统一用 127.0.0.1 避免踩坑
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // API 与 SSE 都走代理，浏览器侧始终同源，Cookie 无需 CORS
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/files': { target: API, changeOrigin: false },
    },
  },
})
