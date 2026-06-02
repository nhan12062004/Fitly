import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = mode === 'development'
    ? env.VITE_DEV_API_URL || 'http://localhost:5000'
    : env.VITE_API_URL || 'https://trendfit.onrender.com';
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
        },
      },
    },
  };
})
