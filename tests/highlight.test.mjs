// Runs the library's highlighter against hostile inputs. `node --test tests/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Minimal DOM shim: the IIFE only touches these at load time when no host elements exist.
globalThis.window = globalThis;
globalThis.document = { readyState: 'complete', addEventListener() {}, querySelectorAll() { return []; } };
new Function(readFileSync(new URL('../gitglass.js', import.meta.url), 'utf8'))();
const { highlight, langFor } = globalThis.GitGlass;

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  'javascript:alert(1) // <b>bold</b>',
  '`${"<iframe>"}`',
];

for (const lang of ['cs', 'ts', 'py', 'go', 'rs', 'json', 'xml', 'yaml', 'sql', 'sh', 'css', 'plain']) {
  test(`highlight(${lang}) never emits raw markup from input`, () => {
    for (const h of HOSTILE) {
      const out = highlight(h, lang);
      assert.ok(!/<(script|img|svg|iframe|b)/i.test(out), `${lang}: leaked markup in ${out}`);
      for (const t of out.match(/<[^>]+>/g) || []) assert.ok(/^<\/?span( class="gg-(kw|str|cm|num)")?>$/.test(t), `${lang}: unexpected tag ${t}`);
    }
  });
}

test('highlight only emits its own span classes', () => {
  const out = highlight('var x = "a<b"; // c\n1234', 'cs');
  const tags = out.match(/<[^>]+>/g) || [];
  for (const t of tags) assert.ok(/^<\/?span( class="gg-(kw|str|cm|num)")?>$/.test(t), `unexpected tag ${t}`);
});

test('escapes are correct for the three dangerous characters', () => {
  assert.equal(highlight('a < b && c > d', 'plain'), 'a &lt; b &amp;&amp; c &gt; d');
});

test('language detection by extension and special names', () => {
  assert.equal(langFor('src/Program.cs'), 'cs');
  assert.equal(langFor('app/main.tsx'), 'ts');
  assert.equal(langFor('Dockerfile'), 'dockerfile');
  assert.equal(langFor('.gitignore'), 'yaml');
  assert.equal(langFor('notes.unknownext'), 'plain');
});
