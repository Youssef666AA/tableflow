import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Where the dev server forwards /api and /socket.io. VITE_API_URL may be set to
// an empty string to make the *app* use a same-origin path, so fall back on any
// falsy value rather than only on undefined.
const apiTarget = process.env.VITE_API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: true,          // bind to 0.0.0.0 so LAN devices can reach the dev server
    port: 5173,
    strictPort: true,
    allowedHosts: true,  // allow requests arriving on the LAN IP (e.g. 192.168.x.x)
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },

});
