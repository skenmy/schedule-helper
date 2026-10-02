import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, transformWithOxc, type Plugin } from 'vite';

const SERVER = `http://localhost:${process.env.PORT ?? 3000}`;
const ROOT = path.resolve(import.meta.dirname, 'src/client');

/** Files under `dir`, relative to it, with forward slashes. */
function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    // A stray .DS_Store isn't served (express.static skips dotfiles) and would fail the install.
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? listFiles(full, base)
      : [path.relative(base, full).split(path.sep).join('/')];
  });
}

/**
 * Emits /sw.js (src/client/sw.ts) with the exact list of files this build
 * produced, so the installed app can open with no signal. The version is a
 * hash of those files, so every deploy installs a fresh cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'schedule-helper:service-worker',
    apply: 'build',
    // After Vite's own plugins, so index.html is already in the bundle.
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const publicDir = path.join(ROOT, 'public');
      // Brand logos are only needed for UKSG rooms; the worker caches them on first use.
      const publicFiles = listFiles(publicDir).filter((f) => !f.startsWith('brand/'));
      // Every target browser takes woff2; the .woff fallbacks would only be dead weight.
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.endsWith('.woff'));
      const precache = [...built, ...publicFiles].sort();
      // Fail the build rather than ship a worker that can't open the app offline.
      if (!built.includes('index.html'))
        this.error('service worker: index.html missing from build');

      const hash = createHash('sha256');
      for (const file of built) {
        const out = bundle[file]!;
        hash.update(file).update(out.type === 'chunk' ? out.code : out.source);
      }
      for (const file of publicFiles)
        hash.update(file).update(fs.readFileSync(path.join(publicDir, file)));
      const version = hash.digest('hex').slice(0, 12);

      const source = fs.readFileSync(path.join(ROOT, 'sw.ts'), 'utf8');
      const { code } = await transformWithOxc(source, 'sw.ts', { lang: 'ts' });
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source:
          `const __PRECACHE__ = ${JSON.stringify(precache)};\n` +
          `const __VERSION__ = ${JSON.stringify(version)};\n` +
          code,
      });
    },
  };
}

export default defineConfig({
  root: 'src/client',
  plugins: [svelte(), serviceWorker()],
  // The client knows its own build, so a page served from the service worker's
  // cache still notices when the server has moved on (lib/room.svelte.ts).
  // Truncated exactly as the server does (src/server/config.ts).
  define: { __BUILD__: JSON.stringify((process.env.BUILD_SHA || 'dev').slice(0, 12)) },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER, ws: true },
    },
  },
});
