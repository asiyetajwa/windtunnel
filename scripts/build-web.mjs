// Builds the web app into dist/, which the server serves. The simulator is bundled in: the browser runs the scenes itself.
import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: { app: 'src/web/main.ts' }, bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: true, outdir: 'dist', logLevel: 'warning' });
for (const f of ['index.html', 'styles.css', 'logo.svg']) await cp(`src/web/${f}`, `dist/${f}`);
console.log('web: built dist/');
