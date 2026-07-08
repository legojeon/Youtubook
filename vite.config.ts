import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

const isWebstore = process.env.VITE_EDITION === 'webstore';

export default defineConfig({
  plugins: [crx({ manifest })],
  define: { __WEBSTORE__: JSON.stringify(isWebstore) },
  build: {
    target: 'chrome111',
    outDir: isWebstore ? 'dist-webstore' : 'dist',
    rollupOptions: {
      input: {
        results: 'src/results/results.html',
        viewer: 'src/viewer/viewer.html',
      },
    },
  },
});
