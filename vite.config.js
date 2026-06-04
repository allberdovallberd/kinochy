import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';

const base = normalizeBasePath(process.env.APP_BASE_PATH || process.env.VITE_BASE_PATH || '/');

export default defineConfig({
  base,
  plugins: [
    react(),
    legacy({
      targets: ['Chrome >= 61', 'Edge >= 79', 'Firefox >= 67', 'Safari >= 11', 'iOS >= 11', 'Android >= 6'],
      modernPolyfills: true
    })
  ],
  build: {
    cssTarget: 'chrome61',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react']
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/media': 'http://localhost:4000'
    }
  }
});

function normalizeBasePath(value) {
  const clean = String(value || '/').trim();
  if (!clean || clean === '/') return '/';
  return `/${clean.replace(/^\/+|\/+$/g, '')}/`;
}
