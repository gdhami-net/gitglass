// Checks the single-file themes in themes/. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const RULE = /\.gg\[data-theme="([a-z0-9-]+)"\]\s*\{([^}]*)\}/g;
const COLOURS = ['bg', 'side', 'text', 'code', 'muted', 'dim', 'faint', 'gutter', 'hover', 'active',
  'hl', 'accent', 'kw', 'str', 'cm', 'num', 'sel', 'prop', 'folder'];

const bundle = readFileSync(new URL('gitglass.themes.css', root), 'utf8');
const presets = [...bundle.matchAll(RULE)].map((m) => m[1]);
const files = readdirSync(new URL('themes/', root)).filter((f) => f.endsWith('.css'));

function rgb(v) {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (fn) return fn.slice(1, 4).map(Number);
  throw new Error(`not a colour: ${v}`);
}
function luminance([r, g, b]) {
  const ch = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('there are single-file themes to check', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  const name = file.slice(0, -4);
  const src = readFileSync(new URL(`themes/${file}`, root), 'utf8');
  const rules = [...src.matchAll(RULE)];
  const vars = Object.fromEntries([...(rules[0]?.[2] ?? '').matchAll(/--gg-([a-z]+):\s*([^;]+);/g)]
    .map((m) => [m[1], m[2].trim()]));

  test(`${file}: one rule, named after the file, not a bundle preset`, () => {
    assert.equal(rules.length, 1);
    assert.equal(rules[0][1], name);
    assert.ok(!presets.includes(name), `${name} already exists in gitglass.themes.css`);
  });

  test(`${file}: sets every colour, each a valid colour`, () => {
    assert.deepEqual(Object.keys(vars).sort(), [...COLOURS].sort());
    for (const k of COLOURS) assert.doesNotThrow(() => rgb(vars[k]), `--gg-${k}`);
  });

  test(`${file}: text and syntax colours are readable on the background`, () => {
    for (const k of ['text', 'code', 'kw', 'str', 'num', 'sel', 'prop'])
      assert.ok(contrast(vars[k], vars.bg) >= 4.5, `--gg-${k} ${vars[k]} on ${vars.bg}: ${contrast(vars[k], vars.bg).toFixed(2)}`);
    assert.ok(contrast(vars.cm, vars.bg) >= 3, `--gg-cm on the background: ${contrast(vars.cm, vars.bg).toFixed(2)}`);
  });
}
