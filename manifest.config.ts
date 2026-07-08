import { defineManifest } from '@crxjs/vite-plugin';

const isWebstore = process.env.VITE_EDITION === 'webstore';

export default defineManifest({
  manifest_version: 3,
  name: isWebstore ? 'Youtubook Lite' : 'Youtubook Full',
  version: '0.1.0',
  default_locale: 'en',
  description: '__MSG_appDesc__',
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
  permissions: ['storage', 'notifications'],
});
