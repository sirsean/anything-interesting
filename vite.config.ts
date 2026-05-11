import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const wranglerConfigPath = fileURLToPath(new URL('./wrangler.toml', import.meta.url));
// Pin miniflare/D1 state to the project-root `.wrangler/state` so it shares
// the same local D1 instance as `wrangler dev` and
// `wrangler d1 migrations apply --local`. Without this, Vite's `root: 'web'`
// causes the plugin to persist under `web/.wrangler/state`, which is a
// different (empty) D1 — you'd get `no such table: clusters` until you also
// migrated *that* DB.
const persistStatePath = fileURLToPath(new URL('./.wrangler/state', import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [
    react(),
    cloudflare({
      configPath: wranglerConfigPath,
      persistState: { path: persistStatePath },
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
