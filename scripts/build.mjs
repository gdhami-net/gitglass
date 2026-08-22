// Builds dist/ (minified js + css) and reports raw / min / gzip sizes.
// esbuild is a dev dependency only — the shipped library has zero runtime dependencies.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({ entryPoints: ['gitglass.js'], outfile: 'dist/gitglass.min.js', minify: true, target: 'es2017', legalComments: 'inline', logLevel: 'silent' });
await build({ entryPoints: ['gitglass.css'], outfile: 'dist/gitglass.min.css', minify: true, logLevel: 'silent' });
await build({ entryPoints: ['gitglass.themes.css'], outfile: 'dist/gitglass.themes.min.css', minify: true, logLevel: 'silent' });

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const rows = [];
for (const [src, min] of [
  ['gitglass.js', 'dist/gitglass.min.js'],
  ['gitglass.css', 'dist/gitglass.min.css'],
  ['gitglass.themes.css', 'dist/gitglass.themes.min.css'],
]) {
  const raw = statSync(src).size;
  const m = readFileSync(min);
  rows.push({ file: min, raw: kb(raw), min: kb(m.length), gzip: kb(gzipSync(m, { level: 9 }).length) });
}
const table = ['| file | source | minified | min+gzip |', '| --- | --- | --- | --- |']
  .concat(rows.map((r) => `| ${r.file} | ${r.raw} | ${r.min} | ${r.gzip} |`)).join('\n');
writeFileSync('dist/SIZES.md', table + '\n');
console.log(table);
