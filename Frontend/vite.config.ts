import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_URL || 'https://trendfit.onrender.com';
  const isHttpsTarget = /^https:\/\//i.test(apiTarget);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: isHttpsTarget,
          configure: (proxy) => {
            proxy.on('error', (_error, _request, response) => {
              if ('writeHead' in response && !response.headersSent && !response.writableEnded) {
                response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({ error: 'Không thể kết nối tới máy chủ Fitly. Vui lòng thử lại sau.' }));
              }
            });
          },
        },
      },
    },
  };
})
