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
      for (const t of out.match(/<[^>]+>/g) || []) assert.ok(/^<\/?span( class="gg-(kw|str|cm|num|sel|prop)")?>$/.test(t), `${lang}: unexpected tag ${t}`);
    }
  });
}

test('highlight only emits its own span classes', () => {
  const out = highlight('var x = "a<b"; // c\n1234', 'cs');
  const tags = out.match(/<[^>]+>/g) || [];
  for (const t of tags) assert.ok(/^<\/?span( class="gg-(kw|str|cm|num|sel|prop)")?>$/.test(t), `unexpected tag ${t}`);
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

test('parseTarget handles repo, file, and line ranges', () => {
  const { parseTarget } = globalThis.GitGlass;
  assert.deepEqual(parseTarget('o/r'), { repo: 'o/r', path: null, lines: null });
  assert.deepEqual(parseTarget('o/r#src/a.cs'), { repo: 'o/r', path: 'src/a.cs', lines: null });
  assert.deepEqual(parseTarget('o/r#src/a.cs:L10-L40'), { repo: 'o/r', path: 'src/a.cs', lines: [10, 40] });
  assert.deepEqual(parseTarget('o/r#src/a.cs:L7'), { repo: 'o/r', path: 'src/a.cs', lines: [7, 7] });
});

test('splitLines keeps token spans balanced across line breaks', () => {
  const { highlight, splitLines } = globalThis.GitGlass;
  const lines = splitLines(highlight('/* a\nb */ x', 'cs'));
  assert.equal(lines.length, 2);
  for (const l of lines) {
    const opens = (l.match(/<span/g) || []).length, closes = (l.match(/<\/span>/g) || []).length;
    assert.equal(opens, closes, `unbalanced spans in ${l}`);
  }
  assert.ok(lines[1].startsWith('<span class="gg-cm">'), 'comment continues on the second line');
});

test('iconFor picks a badge by extension, falls back to a plain file', () => {
  const { iconFor } = globalThis.GitGlass;
  assert.equal(iconFor('src/Program.cs'), 'cs');
  assert.equal(iconFor('Demo.csproj'), 'cs');
  assert.equal(iconFor('app/main.ts'), 'ts');
  assert.equal(iconFor('dist/gitglass.min.js'), 'js');
  assert.equal(iconFor('README.md'), 'md');
  assert.equal(iconFor('index.html'), 'xml');
  assert.equal(iconFor('.gitignore'), 'yaml');
  assert.equal(iconFor('LICENSE'), 'file');
  assert.equal(iconFor('notes.unknownext'), 'file');
});
