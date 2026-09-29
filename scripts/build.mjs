// Builds dist/ (minified js + css) and reports raw / min / gzip sizes.
// esbuild is a dev dependency only — the shipped library has zero runtime dependencies.
import { build, transform } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({ entryPoints: ['gitglass.js'], outfile: 'dist/gitglass.min.js', minify: true, target: 'es2017', legalComments: 'inline', logLevel: 'silent' });
await build({ entryPoints: ['gitglass.css'], outfile: 'dist/gitglass.min.css', minify: true, logLevel: 'silent' });
await build({ entryPoints: ['gitglass.themes.css'], outfile: 'dist/gitglass.themes.min.css', minify: true, logLevel: 'silent' });

// One file per theme in dist/themes/, each optional: the eleven presets of
// gitglass.themes.css split out one by one, plus every themes/<name>.css, the
// themes that exist only as single files. New themes go in themes/, so the
// core files and the bundle never grow.
const RULE = /\.gg\[data-theme="([a-z0-9-]+)"\]\s*\{[^}]*\}/g;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
rmSync('dist/themes', { recursive: true, force: true });
mkdirSync('dist/themes', { recursive: true });

const themeFiles = [];
const bundleSrc = readFileSync('gitglass.themes.css', 'utf8');
const bundled = [...bundleSrc.matchAll(RULE)].map(([rule, name]) => ({ rule, name }));
if (stripComments(bundleSrc.replace(RULE, '')).trim())
  throw new Error('gitglass.themes.css: every rule must be one .gg[data-theme="…"] block');
for (const { rule, name } of bundled) {
  const { code } = await transform(rule, { loader: 'css', minify: true });
  // vs-dark is the built-in default: its rule is empty and minifies to nothing
  writeFileSync(`dist/themes/${name}.min.css`, code || `/* ${name} is gitglass's built-in default: nothing to load */\n`);
  themeFiles.push({ name, bundle: true });
}
for (const file of readdirSync('themes').filter((f) => f.endsWith('.css')).sort()) {
  const name = file.slice(0, -4);
  const src = readFileSync(`themes/${file}`, 'utf8');
  const rules = [...src.matchAll(RULE)];
  if (rules.length !== 1 || rules[0][1] !== name || stripComments(src.replace(RULE, '')).trim())
    throw new Error(`themes/${file}: must hold exactly one rule, .gg[data-theme="${name}"]`);
  if (bundled.some((b) => b.name === name))
    throw new Error(`themes/${file}: "${name}" is already a preset in gitglass.themes.css`);
  await build({ entryPoints: [`themes/${file}`], outfile: `dist/themes/${name}.min.css`, minify: true, logLevel: 'silent' });
  themeFiles.push({ name, bundle: false });
}

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
const themeTable = ['| optional single-theme file | also in the bundle | minified | min+gzip |', '| --- | --- | --- | --- |']
  .concat(themeFiles.map(({ name, bundle }) => {
    const m = readFileSync(`dist/themes/${name}.min.css`);
    return `| dist/themes/${name}.min.css | ${bundle ? 'yes' : 'no'} | ${m.length} B | ${gzipSync(m, { level: 9 }).length} B |`;
  })).join('\n');
writeFileSync('dist/SIZES.md', table + '\n\n' + themeTable + '\n');
console.log(table + '\n\n' + themeTable);
