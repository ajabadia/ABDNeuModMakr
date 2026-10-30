import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  server: {
    port: 8388,
    fs: {
      allow: ['..', '../..']
    }
  },
  build: {
    chunkSizeWarningLimit: 1000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '../utils/index.js': path.resolve(__dirname, './vendor/@abdsynths/shared/Utils/index.js'),
      '@abdsynths/shared/utils': path.resolve(__dirname, './vendor/@abdsynths/shared/Utils/index.js')
    }
  }
});
