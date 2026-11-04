import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  server: {
    port: 8388,
    fs: {
      // S7.2: exposición mínima en dev — solo el raíz del proyecto (incluye vendor/).
      allow: [path.resolve(__dirname)]
    },
    proxy: {
      '/api/proxy/replicate': {
        target: 'https://api.replicate.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/proxy\/replicate/, ''),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Split the vendored sampler/MIDI packages out of the app bundle so their
        // cache lifetime is independent from app churn (they change only on vendor:sync).
        manualChunks(id: string) {
          if (!/[\\/]@abdsynths[\\/]/.test(id)) return undefined;
          if (/[\\/]@abdsynths[\\/]midi-keyb[\\/]/.test(id)) return 'vendor-midi-keyb';
          if (/[\\/]@abdsynths[\\/]shared[\\/]Components[\\/]/.test(id)) {
            return 'vendor-shared-components';
          }
          return 'vendor-shared-core';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '../utils/index.js': path.resolve(__dirname, './vendor/@abdsynths/shared/Utils/index.js'),
      '@abdsynths/shared/utils': path.resolve(__dirname, './vendor/@abdsynths/shared/Utils/index.js')
    }
  }
});
