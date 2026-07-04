import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Youtubook',
  version: '0.1.0',
  description: '유튜브 영상을 그림책(PDF/PPTX)과 대본(TXT)으로 변환합니다.',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
    },
  },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/bridge/main-world.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
  ],
  host_permissions: ['https://www.youtube.com/*'],
  permissions: ['storage'],
});
