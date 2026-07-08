import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'chrome111',
    rollupOptions: {
      input: {
        results: 'src/results/results.html',
        viewer: 'src/viewer/viewer.html',
      },
    },
  },
});
