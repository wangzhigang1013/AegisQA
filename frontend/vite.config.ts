import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // Ant Design 与 ECharts 都是后台系统的基础依赖；当前包体在可接受范围内，
    // 这里把告警阈值调到 1.2MB，避免验收日志被已知的大型依赖噪音淹没。
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 后台类产品会同时依赖组件库、画布和图表；手动分包可以让首屏包体更可控。
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          query: ['@tanstack/react-query'],
          flow: ['@xyflow/react'],
          charts: ['echarts', 'echarts-for-react'],
        },
      },
    },
  },
});
