import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Local Wrangler dev server (npm run dev -w worker).
const API_TARGET = process.env.HC_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist', // served by the Worker as static assets (worker/wrangler.jsonc → ../web/dist)
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin for the browser: SameSite=Strict cookies and WebSockets just work.
      '/api': {
        target: API_TARGET,
        ws: true,
        changeOrigin: true,
        configure(proxy) {
          // The Worker rejects mutations whose Origin differs from its own; present the proxied
          // request as same-origin so local dev behaves exactly like production.
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', API_TARGET);
          });
          proxy.on('proxyReqWs', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', API_TARGET);
          });
        },
      },
    },
  },
});
