/*! gitglass v1.3 — embed a VS Code-style, read-only GitHub repo browser in any static page.
 *  Zero dependencies. MIT. https://github.com/gdhami-net/gitglass
 *
 *  Repo browser:   <div data-gitglass="owner/repo" data-gitglass-theme="github-dark"></div>
 *  Big repo:       <div data-gitglass="dotnet/runtime" data-gitglass-lazy></div>   (folders list on demand)
 *  Snippet:        <div data-gitglass="owner/repo#src/file.cs:L10-L40"></div>
 *  Guided tour:    <div data-gitglass="owner/repo"><script type="application/json">{"steps":[...]}</script></div>
 *
 *  const view = GitGlass.mount(el, { repo, branch, open, theme, lazy, expand: 'auto'|'all'|'none', path, lines: [10, 40], tour: { steps } });
 *  view.goto('src/file.cs', [10, 40]); view.open(path); view.destroy();
 */
(function () {
  'use strict';

  const REPO_RX = /^[\w.-]+\/[\w.-]+$/;
  const SKIP = /\.(png|jpe?g|gif|ico|webp|avif|bmp|zip|gz|7z|rar|dll|pdb|exe|snk|woff2?|ttf|otf|eot|mp[34]|wav|pdf)$/i;
  const MAX_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const MIN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
  const FILES_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- target spec: "owner/repo", "owner/repo#path", "owner/repo#path:L10-L40" ---------- */
  function parseTarget(spec) {
    spec = (spec || '').trim();
    const hash = spec.indexOf('#');
    const out = { repo: hash === -1 ? spec : spec.slice(0, hash), path: null, lines: null };
    if (hash !== -1) {
      let rest = spec.slice(hash + 1);
      const lm = rest.match(/:L(\d+)(?:-L?(\d+))?$/);
      if (lm) {
        out.lines = [parseInt(lm[1], 10), parseInt(lm[2] || lm[1], 10)];
        rest = rest.slice(0, lm.index);
      }
      out.path = rest || null;
    }
    return out;
  }

  /* ---------- github ---------- */
  function ghError(r) {
    if (r.status === 403 || r.status === 429) {
      const remaining = r.headers.get('X-RateLimit-Remaining');
      const reset = r.headers.get('X-RateLimit-Reset');
      if (remaining === '0' && reset) {
        const at = new Date(parseInt(reset, 10) * 1000);
        return new Error('GitHub API rate limit reached — resets at ' + at.toLocaleTimeString());
      }
    }
    return new Error('HTTP ' + r.status);
  }

  const API = 'https://api.github.com/repos/';
  function ghJson(url, signal) {
    return fetch(url, { signal: signal }).then(function (r) { if (!r.ok) throw ghError(r); return r.json(); });
  }

  /* Whole tree in one call (default), or just the root when `lazy` — then each folder lists itself on demand. */
  function getTree(repo, branch, signal, lazy) {
    const key = 'gitglass:' + repo + '@' + (branch || 'auto') + (lazy ? '#lazy' : '');
    try {
      const hit = sessionStorage.getItem(key);
      if (hit) return Promise.resolve(JSON.parse(hit));
    } catch (e) { /* private mode */ }
    const attempt = function (b) {
      return ghJson(API + repo + '/git/trees/' + encodeURIComponent(b) + (lazy ? '' : '?recursive=1'), signal)
        .then(function (j) {
          return {
            branch: b,
            truncated: !!j.truncated,
            items: j.tree
              .filter(function (t) { return !SKIP.test(t.path); })
              .map(function (t) { return { path: t.path, type: t.type, sha: lazy && t.type === 'tree' ? t.sha : undefined }; })
          };
        });
    };
    const p = branch ? attempt(branch)
      : attempt('main').catch(function (err) { if (err.name === 'AbortError') throw err; return attempt('master'); });
    return p.then(function (tree) {
      try { sessionStorage.setItem(key, JSON.stringify(tree)); } catch (e) { /* full */ }
      return tree;
    });
  }

  function rawUrl(repo, branch, path) {
    return 'https://raw.githubusercontent.com/' + repo + '/' + encodeURIComponent(branch) + '/' +
      path.split('/').map(encodeURIComponent).join('/');
  }

  function getFile(repo, branch, path, signal) {
    return fetch(rawUrl(repo, branch, path), { signal: signal })
      .then(function (r) { if (!r.ok) throw ghError(r); return r.text(); });
  }

  /* snippet mode never touches the API: raw fetch with main→master fallback */
  function getFileAuto(repo, branch, path, signal) {
    if (branch) return getFile(repo, branch, path, signal).then(function (t) { return { branch: branch, text: t }; });
    return getFile(repo, 'main', path, signal)
      .then(function (t) { return { branch: 'main', text: t }; })
      .catch(function (err) {
        if (err.name === 'AbortError') throw err;
        return getFile(repo, 'master', path, signal).then(function (t) { return { branch: 'master', text: t }; });
      });
  }

  /* ---------- highlighting: tiny regex packs, per language ---------- */
  const C_KW = 'if|else|for|while|do|switch|case|default|break|continue|return|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|class|extends|implements|interface|enum|import|export|from|as|async|await|yield|static|public|private|protected|readonly|abstract|get|set|null|undefined|true|false|this|super|void|var|let|const|function';
  const PACKS = {
    cs:     { kw: 'using|namespace|class|record|struct|interface|enum|public|private|protected|internal|static|readonly|const|var|new|return|async|await|void|int|long|double|decimal|float|bool|string|object|char|byte|if|else|for|foreach|while|do|switch|case|default|break|continue|try|catch|finally|throw|null|true|false|this|base|is|as|in|out|ref|get|set|init|partial|sealed|override|virtual|abstract|where|typeof|nameof|with|lock|event|delegate|operator|yield', cm: 'c' },
    ts:     { kw: C_KW + '|type|namespace|declare|satisfies|keyof|infer|never|any|unknown|string|number|boolean|object|symbol|bigint', cm: 'c' },
    py:     { kw: 'def|class|return|if|elif|else|for|while|try|except|finally|raise|with|as|import|from|pass|break|continue|lambda|yield|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|self|async|await|match|case', cm: 'hash' },
    go:     { kw: 'package|import|func|return|var|const|type|struct|interface|map|chan|go|defer|if|else|for|range|switch|case|default|break|continue|fallthrough|select|goto|nil|true|false|make|new|len|cap|append|error|string|int|int64|bool|byte|float64', cm: 'c' },
    rs:     { kw: 'fn|let|mut|const|static|struct|enum|impl|trait|for|in|while|loop|if|else|match|return|pub|mod|use|crate|self|super|as|where|dyn|ref|move|async|await|unsafe|type|true|false|Some|None|Ok|Err|String|Vec|Box|Option|Result|u8|u32|u64|i32|i64|f32|f64|usize|bool|str', cm: 'c' },
    java:   { kw: 'package|import|class|interface|enum|record|extends|implements|public|private|protected|static|final|abstract|void|int|long|double|float|boolean|char|byte|short|new|return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|throws|this|super|null|true|false|var|instanceof|synchronized|sealed|permits|yield', cm: 'c' },
    kt:     { kw: 'package|import|class|interface|object|data|sealed|enum|fun|val|var|return|if|else|when|for|while|do|in|is|as|null|true|false|this|super|override|open|abstract|private|public|internal|protected|suspend|lateinit|companion|by|try|catch|finally|throw|break|continue', cm: 'c' },
    swift:  { kw: 'import|class|struct|enum|protocol|extension|func|var|let|return|if|else|guard|for|in|while|repeat|switch|case|default|break|continue|defer|throw|throws|try|catch|async|await|nil|true|false|self|super|init|deinit|public|private|fileprivate|internal|open|static|final|override|mutating|some|any|where', cm: 'c' },
    php:    { kw: 'namespace|use|class|interface|trait|enum|function|fn|return|if|elseif|else|foreach|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|new|public|private|protected|static|abstract|final|readonly|echo|print|null|true|false|match|instanceof|array|string|int|float|bool|void|mixed', cm: 'c' },
    rb:     { kw: 'def|end|class|module|if|elsif|else|unless|while|until|for|in|do|return|yield|begin|rescue|ensure|raise|self|nil|true|false|and|or|not|then|case|when|require|include|extend|attr_accessor|attr_reader|puts|lambda|proc', cm: 'hash' },
    sql:    { kw: 'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|AND|OR|NOT|NULL|IS|IN|EXISTS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|CONSTRAINT|BEGIN|COMMIT|ROLLBACK|TRANSACTION|WITH|RETURNING|select|from|where|insert|into|values|update|set|delete|create|table|join|left|inner|on|as|and|or|not|null|group|by|order|limit', cm: 'dash' },
    css:    { kw: 'important|media|import|keyframes|supports|font-face|root|hover|focus|active|before|after|nth-child|not|is|where|has', cm: 'block' },
    sh:     { kw: 'if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|local|readonly|echo|set|unset|source|shift|true|false|sudo|cd|ls|rm|cp|mv|mkdir|cat|grep|sed|awk|curl|git|npm|dotnet|docker', cm: 'hash' },
    c:      { kw: 'int|long|short|char|float|double|void|unsigned|signed|struct|union|enum|typedef|const|static|extern|volatile|inline|return|if|else|for|while|do|switch|case|default|break|continue|goto|sizeof|include|define|ifdef|ifndef|endif|pragma|class|public|private|protected|virtual|override|template|typename|namespace|using|new|delete|this|nullptr|true|false|auto|bool|std', cm: 'c' },
    dockerfile: { kw: 'FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS', cm: 'hash' },
    json:   { json: true },
    xml:    { xml: true },
    yaml:   { kw: 'true|false|null|yes|no|on|off', cm: 'hash' },
    plain:  {}
  };
  const EXT = {
    cs: 'cs', ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts', vue: 'ts', svelte: 'ts',
    py: 'py', go: 'go', rs: 'rs', java: 'java', kt: 'kt', kts: 'kt', swift: 'swift', php: 'php', rb: 'rb',
    sql: 'sql', css: 'css', scss: 'css', less: 'css',
    sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'sh', cmd: 'sh', bat: 'sh',
    c: 'c', h: 'c', cpp: 'c', cc: 'c', hpp: 'c', cxx: 'c',
    json: 'json', jsonc: 'json', csproj: 'xml', props: 'xml', targets: 'xml', xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', xaml: 'xml', razor: 'xml', cshtml: 'xml',
    yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', env: 'yaml', gitignore: 'yaml', editorconfig: 'yaml',
    dockerfile: 'dockerfile', md: 'plain', txt: 'plain', lock: 'plain', sln: 'plain', license: 'plain'
  };

  function langFor(path) {
    const base = path.split('/').pop().toLowerCase();
    if (base === 'dockerfile') return 'dockerfile';
    const ext = base.indexOf('.') !== -1 ? base.split('.').pop() : base.replace(/^\./, '');
    return EXT[ext] || 'plain';
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function span(cls, m) { return '<span class="gg-' + cls + '">' + m + '</span>'; }

  const COMMENT = {
    c: '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',
    hash: '(#[^\\n]*)',
    dash: '(--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    block: '(\\/\\*[\\s\\S]*?\\*\\/)'
  };
  const STRING = '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)';
  const NUMBER = '(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)';
  const rxCache = {};

  /* CSS gets its own pass: selectors, at-rules, properties, values with units, hex colors. */
  function highlightCss(esc) {
    return esc.replace(
      /(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[\w-]+)|(!important)|([^{};\/]+?)(\s*\{)|([\w-]+)(\s*:)(?=[^;{}]*[;}])|(#[0-9a-fA-F]{3,8}\b|\b\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b)/g,
      function (m, cm, str, at, imp, sel, brace, prop, colon, num) {
        if (cm) return span('cm', m);
        if (str) return span('str', m);
        if (at) return span('kw', m);
        if (imp) return span('kw', m);
        if (sel !== undefined && brace !== undefined) return span('sel', sel) + brace;
        if (prop !== undefined && colon !== undefined) return span('prop', prop) + colon;
        if (num) return span('num', m);
        return m;
      });
  }

  function highlight(src, lang) {
    const esc = escapeHtml(src);
    const pack = PACKS[lang] || PACKS.plain;
    if (lang === 'css') return highlightCss(esc);
    if (pack.json) {
      return esc.replace(/("(?:[^"\\]|\\.)*")|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b/g,
        function (m, s, n) { return span(s ? 'str' : n ? 'num' : 'kw', m); });
    }
    if (pack.xml) {
      return esc.replace(/(&lt;!--[\s\S]*?--&gt;)|("(?:[^"\\]|\\.)*")|(&lt;\/?)([\w:-]+)/g,
        function (m, c, s, lt, tag) { return c ? span('cm', m) : s ? span('str', m) : lt + span('kw', tag); });
    }
    if (!pack.kw) return esc;
    let rx = rxCache[lang];
    if (!rx) {
      rx = rxCache[lang] = new RegExp(
        COMMENT[pack.cm] + '|' + STRING + '|' + NUMBER + '|\\b(' + pack.kw + ')\\b', 'g');
    }
    return esc.replace(rx, function (m, cm, str, num) {
      return span(cm ? 'cm' : str ? 'str' : num ? 'num' : 'kw', m);
    });
  }

  /* Split highlighted HTML into lines, re-balancing the (never-nested) token spans. */
  function splitLines(html) {
    const lines = html.split('\n'), out = []; let open = null;
    const re = /<span class="([^"]+)">|<\/span>/g;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; let cur = open, m;
      re.lastIndex = 0;
      while ((m = re.exec(l))) cur = m[1] ? m[1] : null;
      out.push((open ? '<span class="' + open + '">' : '') + l + (cur ? '</span>' : ''));
      open = cur;
    }
    return out;
  }

  function renderLines(view, text, lang, from, to) {
    const lines = splitLines(highlight(text, lang));
    const a = Math.max(1, from || 1), b = Math.min(lines.length, to || lines.length);
    let html = '';
    for (let i = a; i <= b; i++) {
      html += '<div class="gg-line" data-n="' + i + '"><span class="gg-ln">' + i + '</span><span class="gg-lt">' + (lines[i - 1] || ' ') + '</span></div>';
    }
    view.code.innerHTML = html;
    view.lineCount = lines.length;
  }

  /* ---------- tree ---------- */
  const PAGE = 100;   // rows rendered per folder before a "show more" link
  const ICONS = { cs: 'C#', ts: 'TS', js: 'JS', py: 'PY', go: 'GO', rs: 'RS', java: 'J', kt: 'KT', swift: 'SW', php: 'PH', rb: 'RB', sql: 'DB', css: '#', sh: '>_', c: 'C', dockerfile: 'DK', json: '{}', xml: '<>', yaml: 'CF', md: 'M↓', vue: 'V', svelte: 'S' };
  const ICON_EXT = { html: 'xml', htm: 'xml', svg: 'xml', md: 'md', markdown: 'md', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', csproj: 'cs', sln: 'cs', props: 'cs', targets: 'cs', vue: 'vue', svelte: 'svelte' };

  function iconFor(path) {
    const base = path.split('/').pop().toLowerCase();
    const ext = base.indexOf('.') !== -1 ? base.split('.').pop() : base.replace(/^\./, '');
    const k = ICON_EXT[ext] || langFor(path);
    return ICONS[k] ? k : 'file';
  }

  function dirNode(path, sha) { return { path: path, sha: sha || null, loaded: !sha, dirs: {}, files: [] }; }

  function buildHierarchy(items) {
    const root = dirNode('', null);
    items.forEach(function (it) {
      const segs = it.path.split('/'); let node = root, i;
      for (i = 0; i < segs.length - 1; i++) {
        node = node.dirs[segs[i]] || (node.dirs[segs[i]] = dirNode(segs.slice(0, i + 1).join('/'), null));
      }
      const name = segs[segs.length - 1];
      if (it.type === 'blob') node.files.push({ name: name, path: it.path });
      else if (!node.dirs[name]) node.dirs[name] = dirNode(it.path, it.sha);
    });
    return root;
  }

  /* lazy mode: list one folder (by its immutable tree sha — cached forever for the session) */
  function fetchDir(view, node) {
    if (node.loaded) return Promise.resolve(node);
    const key = 'gitglass:t:' + node.sha;
    const fill = function (tree) {
      tree.forEach(function (t) {
        if (t.type === 'tree') node.dirs[t.path] = dirNode(node.path + '/' + t.path, t.sha);
        else if (t.type === 'blob' && !SKIP.test(t.path)) node.files.push({ name: t.path, path: node.path + '/' + t.path });
      });
      node.loaded = true;
      return node;
    };
    try {
      const hit = sessionStorage.getItem(key);
      if (hit) return Promise.resolve(fill(JSON.parse(hit)));
    } catch (e) { /* private mode */ }
    return ghJson(API + view.repo + '/git/trees/' + node.sha, view.signal).then(function (j) {
      const slim = j.tree.map(function (t) { return { path: t.path, type: t.type, sha: t.type === 'tree' ? t.sha : undefined }; });
      try { sessionStorage.setItem(key, JSON.stringify(slim)); } catch (e) { /* full */ }
      return fill(slim);
    });
  }

  function entriesOf(node) {
    const dirs = Object.keys(node.dirs).sort().map(function (n) { return { dir: true, name: n, node: node.dirs[n] }; });
    const files = node.files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return dirs.concat(files);
  }

  /* Folders first, then files; PAGE rows at a time, the rest behind a "show more" row. */
  function renderChildren(view, node, container, depth) {
    const entries = entriesOf(node); let i = 0;
    const chunk = function () {
      const end = Math.min(entries.length, i + PAGE);
      for (; i < end; i++) renderEntry(view, entries[i], container, depth);
      if (i < entries.length) {
        const left = entries.length - i;
        const more = el('div', 'gg-row gg-more', 'show ' + Math.min(PAGE, left) + ' more · ' + left + ' left');
        more.style.paddingLeft = (12 + depth * 14 + 18) + 'px';
        more.addEventListener('click', function () { container.removeChild(more); chunk(); });
        container.appendChild(more);
      }
    };
    chunk();
  }

  /* A folder's rows are built the first time it opens (and, in lazy mode, listed from GitHub right then). */
  function renderEntry(view, e, container, depth) {
    const row = el('div', 'gg-row' + (e.dir ? '' : ' gg-file'));
    row.style.paddingLeft = (12 + depth * 14 + (e.dir ? 0 : 18)) + 'px';
    if (!e.dir) {
      const k = iconFor(e.path);
      row.appendChild(el('span', 'gg-ico gg-i-' + k, ICONS[k] || ''));
      row.appendChild(el('span', 'gg-name', e.name));
      row.dataset.path = e.path;
      row.addEventListener('click', function () { openFile(view, e.path); if (view.narrow) hideSide(view); });
      container.appendChild(row);
      return;
    }
    const node = e.node, chev = el('span', 'gg-chev', '▸'), kids = el('div'); let open = false, built = null;
    kids.style.display = 'none';
    row.appendChild(chev);
    row.appendChild(el('span', 'gg-ico gg-i-dir'));
    row.appendChild(el('span', 'gg-name', e.name));
    container.appendChild(row);
    container.appendChild(kids);
    node.isOpen = function () { return open; };
    node.toggle = function () {
      open = !open;
      chev.textContent = open ? '▾' : '▸';
      row.classList.toggle('gg-open', open);
      kids.style.display = open ? '' : 'none';
      if (!open || built) return built || Promise.resolve();
      if (node.loaded) { renderChildren(view, node, kids, depth + 1); return (built = Promise.resolve()); }
      kids.textContent = '';
      const wait = el('div', 'gg-row gg-wait', 'listing …');
      wait.style.paddingLeft = (12 + (depth + 1) * 14 + 18) + 'px';
      kids.appendChild(wait);
      return (built = fetchDir(view, node).then(function () {
        kids.textContent = '';
        renderChildren(view, node, kids, depth + 1);
        markActiveRow(view);
      }, function (err) {
        built = null;
        if (err.name === 'AbortError') return;
        wait.textContent = 'could not list folder — ' + err.message;
      }));
    };
    row.addEventListener('click', function () { node.toggle(); });
  }

  /* Open every folder on the way to `path` and scroll the sidebar (not the page) to it. */
  function reveal(view, path) {
    if (!view.tree) return;
    const segs = path.split('/'); let node = view.tree, p = Promise.resolve();
    segs.pop();
    segs.forEach(function (seg) {
      p = p.then(function () {
        node = node.dirs[seg];
        if (!node || !node.toggle) throw new Error('unrendered');
        return node.isOpen() ? null : node.toggle();
      });
    });
    return p.then(function () {
      markActiveRow(view);
      const r = view.side.querySelector('.gg-file.gg-active'), s = view.side;
      if (!r) return;
      const y = r.offsetTop - s.offsetTop;
      if (y < s.scrollTop || y > s.scrollTop + s.clientHeight - 28) s.scrollTop = y - s.clientHeight / 2;
    }, function () { /* folder sits behind a "show more" row — nothing to reveal */ });
  }

  function expandAll(node) {
    Object.keys(node.dirs).forEach(function (n) {
      const d = node.dirs[n];
      if (d.toggle && !d.isOpen()) d.toggle();
      if (d.loaded) expandAll(d);
    });
  }

  /* ---------- tabs + editor ---------- */
  function closeTab(view, path) {
    const i = view.openFiles.indexOf(path);
    if (i === -1) return;
    view.openFiles.splice(i, 1);
    if (view.active === path) {
      view.active = view.openFiles[i] || view.openFiles[i - 1] || null;
      if (view.active) showFile(view, view.active);
      else { view.code.innerHTML = ''; setStatus(view, ''); }
    }
    renderTabs(view);
    markActiveRow(view);
  }

  function renderTabs(view) {
    if (!view.tabs) return;
    view.tabs.textContent = '';
    view.openFiles.forEach(function (path) {
      const tab = el('div', 'gg-tab' + (path === view.active ? ' gg-active' : ''));
      tab.title = path;
      tab.appendChild(el('span', 'gg-tabname', path.split('/').pop()));
      const x = el('span', 'gg-x', '×');
      x.setAttribute('aria-label', 'Close ' + path);
      x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(view, path); });
      tab.appendChild(x);
      tab.addEventListener('click', function () { openFile(view, path); });
      tab.addEventListener('auxclick', function (e) {
        if (e.button === 1) { e.preventDefault(); closeTab(view, path); }
      });
      tab.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
      view.tabs.appendChild(tab);
      if (path === view.active && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    updateTabNav(view);
  }

  function markActiveRow(view) {
    if (!view.side) return;
    [].forEach.call(view.side.querySelectorAll('.gg-file'), function (r) {
      r.classList.toggle('gg-active', r.dataset.path === view.active);
    });
  }

  function setStatus(view, right) {
    view.statusL.textContent = view.repo + ' @ ' + (view.branch || '…');
    view.statusR.textContent = right;
  }

  const REDUCED = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyHighlight(view) {
    const hl = view.hl;
    [].forEach.call(view.code.querySelectorAll('.gg-line.gg-hl'), function (l) { l.classList.remove('gg-hl'); });
    if (view.hlTimers) view.hlTimers.forEach(clearTimeout);
    view.hlTimers = [];
    if (!hl || hl.file !== view.active) return;
    let first = null, idx = 0;
    [].forEach.call(view.code.querySelectorAll('.gg-line'), function (l) {
      const n = parseInt(l.dataset.n, 10);
      if (n >= hl.lines[0] && n <= hl.lines[1]) {
        if (!first) first = l;
        if (REDUCED) l.classList.add('gg-hl');
        else view.hlTimers.push(setTimeout(function () { l.classList.add('gg-hl'); }, 120 + idx * 28));  // sweep in, line by line
        idx++;
      }
    });
    if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
  }

  function copyText(text, btn) {
    const done = function () {
      const old = btn.getAttribute('aria-label');
      btn.classList.add('gg-copied');
      btn.setAttribute('aria-label', 'Copied');
      setTimeout(function () { btn.classList.remove('gg-copied'); btn.setAttribute('aria-label', old); }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      done();
    }
  }
  const COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  function updateTabNav(view) {
    if (!view.tabs || !view.navL) return;
    const overflow = view.tabs.scrollWidth > view.tabs.clientWidth + 1;
    view.root.classList.toggle('gg-tabs-overflow', overflow);
    view.navL.disabled = view.tabs.scrollLeft <= 0;
    view.navR.disabled = view.tabs.scrollLeft + view.tabs.clientWidth >= view.tabs.scrollWidth - 1;
  }

  function showFile(view, path) {
    const text = view.cache[path];
    const lang = langFor(path);
    renderLines(view, text, lang);
    view.body.scrollTop = 0;
    setStatus(view, path + ' · ' + view.lineCount + ' lines · ' + lang);
    applyHighlight(view);
  }

  function openFile(view, path) {
    view.active = path;
    if (view.openFiles.indexOf(path) === -1) view.openFiles.push(path);
    renderTabs(view);
    markActiveRow(view);
    if (view.side) reveal(view, path);
    if (view.cache[path] != null) return showFile(view, path);
    view.code.innerHTML = '';
    setStatus(view, 'loading ' + path + ' …');
    getFile(view.repo, view.branch, path, view.signal).then(function (txt) {
      view.cache[path] = txt;
      if (view.active === path) showFile(view, path);
    }).catch(function (err) {
      if (err.name === 'AbortError') return;
      if (view.active === path) setStatus(view, 'failed to load ' + path + ' — ' + err.message);
    });
  }

  /* ---------- responsive sidebar ---------- */
  function showSide(view) { view.root.classList.add('gg-side-open'); }
  function hideSide(view) { view.root.classList.remove('gg-side-open'); }

  /* ---------- guided tour ---------- */
  function buildTour(view, tour) {
    const steps = (tour && tour.steps) || [];
    if (!steps.length) return;
    const panel = el('div', 'gg-tour');
    const info = el('div', 'gg-tour-info');
    const counter = el('span', 'gg-tour-n');
    const title = el('span', 'gg-tour-title');
    const text = el('div', 'gg-tour-text');
    const head = el('div', 'gg-tour-head');
    head.appendChild(counter);
    head.appendChild(title);
    info.appendChild(head);
    info.appendChild(text);
    const nav = el('div', 'gg-tour-nav');
    const prev = el('button', 'gg-tour-btn', '‹ prev');
    const next = el('button', 'gg-tour-btn gg-tour-next', 'next ›');
    nav.appendChild(prev);
    nav.appendChild(next);
    panel.appendChild(info);
    panel.appendChild(nav);
    const doneBar = el('div', 'gg-tour-done');
    doneBar.appendChild(el('span', null, 'Tour complete'));
    const replay = el('button', 'gg-tour-btn', 'replay ↻');
    doneBar.appendChild(replay);
    view.main.insertBefore(panel, view.status);
    view.main.insertBefore(doneBar, view.status);
    let i = 0, finished = false;
    function animateInfo() {
      if (REDUCED) return;
      info.classList.remove('gg-tour-anim');
      void info.offsetWidth;   // restart the keyframe
      info.classList.add('gg-tour-anim');
    }
    function go(n) {
      finished = false;
      panel.style.display = '';
      doneBar.style.display = 'none';
      i = Math.max(0, Math.min(steps.length - 1, n));
      const s = steps[i];
      counter.textContent = (i + 1) + ' / ' + steps.length;
      title.textContent = s.title || '';
      text.textContent = s.text || '';
      prev.disabled = i === 0;
      next.textContent = i === steps.length - 1 ? 'done ✓' : 'next ›';
      animateInfo();
      if (s.file) view.goto(s.file, s.lines || null);
    }
    function finish() {
      finished = true;
      view.hl = null;
      applyHighlight(view);
      panel.style.display = 'none';
      doneBar.style.display = '';
    }
    prev.addEventListener('click', function () { go(i - 1); });
    next.addEventListener('click', function () { if (i < steps.length - 1) go(i + 1); else finish(); });
    replay.addEventListener('click', function () { go(0); });
    view.root.addEventListener('keydown', function (e) {
      if (finished) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); if (i < steps.length - 1) go(i + 1); else finish(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    });
    doneBar.style.display = 'none';
    view.tour = { go: go, next: function () { go(i + 1); }, prev: function () { go(i - 1); }, finish: finish, steps: steps, index: function () { return i; } };
    return view.tour;
  }

  /* ---------- mounting ---------- */
  function mount(host, opts) {
    opts = opts || {};
    const target = parseTarget(opts.repo || host.getAttribute('data-gitglass') || '');
    const repo = target.repo;
    if (!REPO_RX.test(repo)) throw new Error('gitglass: expected "owner/repo", got ' + JSON.stringify(repo));
    const path = opts.path || target.path;
    const lines = opts.lines || target.lines;
    const theme = opts.theme || host.getAttribute('data-gitglass-theme');
    let tour = opts.tour || null;
    if (!tour) {
      const js = host.querySelector('script[type="application/json"]');
      if (js) { try { tour = JSON.parse(js.textContent); } catch (e) { tour = null; } }
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const snippet = !!path;

    const rootEl = el('div', 'gg' + (snippet ? ' gg-snippet' : ''));
    if (theme) rootEl.setAttribute('data-theme', theme);
    const main = el('div', 'gg-main');
    const body = el('div', 'gg-body');
    const code = el('div', 'gg-code');
    const status = el('div', 'gg-status');
    const statusL = el('span');
    const statusR = el('span');
    status.appendChild(statusL);
    status.appendChild(statusR);
    body.appendChild(code);

    const view = {
      repo: repo, branch: opts.branch || null, root: rootEl, host: host, main: main,
      side: null, tabs: null, body: body, code: code, status: status,
      statusL: statusL, statusR: statusR,
      openFiles: [], active: null, cache: {}, narrow: false, hl: null, lineCount: 0,
      signal: controller ? controller.signal : undefined
    };

    if (snippet) {
      const head = el('div', 'gg-snip-head');
      const pathEl = el('span', 'gg-snip-path', path + (lines ? ' · L' + lines[0] + (lines[1] !== lines[0] ? '–' + lines[1] : '') : ''));
      const whole = el('button', 'gg-snip-btn', lines ? 'whole file' : '');
      const snipCopy = el('button', 'gg-snip-btn gg-copy');
      snipCopy.setAttribute('aria-label', 'Copy');
      snipCopy.innerHTML = COPY_SVG + CHECK_SVG;
      const gh = el('a', 'gg-snip-btn', 'GitHub ↗');
      gh.rel = 'noopener';
      gh.target = '_blank';
      head.appendChild(pathEl);
      if (lines) head.appendChild(whole);
      head.appendChild(snipCopy);
      head.appendChild(gh);
      snipCopy.addEventListener('click', function () {
        let t = view.cache[path];
        if (t == null) return;
        if (lines && !rootEl.classList.contains('gg-expanded')) t = t.split('\n').slice(lines[0] - 1, lines[1]).join('\n');
        copyText(t, snipCopy);
      });
      main.appendChild(head);
      main.appendChild(body);
      main.appendChild(status);
      rootEl.appendChild(main);
      host.appendChild(rootEl);
      setStatus(view, 'loading …');
      let expanded = false;
      const draw = function () {
        const t = view.cache[path];
        renderLines(view, t, langFor(path), expanded ? null : lines && lines[0], expanded ? null : lines && lines[1]);
        if (lines) {
          view.hl = { file: path, lines: lines };
          view.active = path;
          if (expanded) applyHighlight(view);
        }
        setStatus(view, view.lineCount + ' lines · ' + langFor(path));
      };
      getFileAuto(repo, opts.branch, path, view.signal).then(function (res) {
        view.branch = res.branch;
        view.cache[path] = res.text;
        gh.href = 'https://github.com/' + repo + '/blob/' + encodeURIComponent(res.branch) + '/' + path + (lines ? '#L' + lines[0] + '-L' + lines[1] : '');
        draw();
      }).catch(function (err) {
        if (err.name === 'AbortError') return;
        code.appendChild(el('div', 'gg-empty', 'Could not load ' + path + ' (' + err.message + ').'));
        setStatus(view, '');
      });
      whole.addEventListener('click', function () {
        expanded = !expanded;
        whole.textContent = expanded ? 'just L' + lines[0] + '–' + lines[1] : 'whole file';
        rootEl.classList.toggle('gg-expanded', expanded);
        draw();
      });
    } else {
      const side = el('div', 'gg-side');
      const tabbar = el('div', 'gg-tabbar');
      const filesBtn = el('button', 'gg-files');
      filesBtn.setAttribute('aria-label', 'Toggle file list');
      filesBtn.innerHTML = FILES_SVG;
      const tabs = el('div', 'gg-tabs');
      const navL = el('button', 'gg-tabnav gg-tabnav-l', '‹');
      const navR = el('button', 'gg-tabnav gg-tabnav-r', '›');
      navL.setAttribute('aria-label', 'Scroll tabs left');
      navR.setAttribute('aria-label', 'Scroll tabs right');
      const copyBtn = el('button', 'gg-copy');
      copyBtn.setAttribute('aria-label', 'Copy file');
      copyBtn.innerHTML = COPY_SVG + CHECK_SVG;
      copyBtn.addEventListener('click', function () {
        if (view.active && view.cache[view.active] != null) copyText(view.cache[view.active], copyBtn);
      });
      const maxBtn = el('button', 'gg-max');
      maxBtn.setAttribute('aria-label', 'Maximize');
      maxBtn.innerHTML = MAX_SVG;
      maxBtn.addEventListener('click', function () {
        const on = rootEl.classList.toggle('gg-fullscreen');
        maxBtn.innerHTML = on ? MIN_SVG : MAX_SVG;
        maxBtn.setAttribute('aria-label', on ? 'Restore' : 'Maximize');
        setTimeout(function () { updateTabNav(view); }, 50);
      });
      tabbar.appendChild(filesBtn);
      tabbar.appendChild(navL);
      tabbar.appendChild(tabs);
      tabbar.appendChild(navR);
      tabbar.appendChild(copyBtn);
      tabbar.appendChild(maxBtn);
      const scrollTabs = function (dir) {
        const step = Math.max(120, Math.round(tabs.clientWidth * 0.6)) * dir;
        if (tabs.scrollBy) tabs.scrollBy({ left: step, behavior: REDUCED ? 'auto' : 'smooth' });
        else tabs.scrollLeft += step;
      };
      navL.addEventListener('click', function () { scrollTabs(-1); });
      navR.addEventListener('click', function () { scrollTabs(1); });
      tabs.addEventListener('scroll', function () { updateTabNav(view); }, { passive: true });
      tabs.addEventListener('wheel', function (e) {
        if (e.deltaY && !e.deltaX && tabs.scrollWidth > tabs.clientWidth) {
          e.preventDefault();
          tabs.scrollLeft += e.deltaY;
        }
      }, { passive: false });
      main.appendChild(tabbar);
      main.appendChild(body);
      main.appendChild(status);
      rootEl.appendChild(side);
      rootEl.appendChild(main);
      host.appendChild(rootEl);
      view.side = side;
      view.tabs = tabs;
      view.navL = navL;
      view.navR = navR;

      filesBtn.addEventListener('click', function () {
        if (rootEl.classList.contains('gg-side-open')) hideSide(view); else showSide(view);
      });
      rootEl.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W') && view.active) {
          e.preventDefault();
          closeTab(view, view.active);
        }
      });
      rootEl.tabIndex = 0;

      view.narrow = rootEl.clientWidth > 0 && rootEl.clientWidth < 720;
      rootEl.classList.toggle('gg-narrow', view.narrow);
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(function (entries) {
          const w = entries[0].contentRect.width;
          view.narrow = w < 720;
          rootEl.classList.toggle('gg-narrow', view.narrow);
          if (!view.narrow) hideSide(view);
          updateTabNav(view);
        });
        ro.observe(rootEl);
        view.ro = ro;
      }

      let lazy = opts.lazy != null ? !!opts.lazy : host.hasAttribute('data-gitglass-lazy');
      const expand = opts.expand || host.getAttribute('data-gitglass-expand') || 'auto';
      setStatus(view, 'loading repository …');
      getTree(repo, opts.branch, view.signal, lazy).then(function (t) {
        if (t.truncated && !lazy) { lazy = true; return getTree(repo, t.branch, view.signal, true); }   // past GitHub's limit: go folder by folder
        return t;
      }).then(function (t) {
        view.branch = t.branch;
        view.tree = buildHierarchy(t.items);
        renderChildren(view, view.tree, side, 0);
        setStatus(view, lazy ? 'large repo · folders list on demand' : '');
        if (!lazy && (expand === 'all' || (expand === 'auto' && t.items.length <= 60))) expandAll(view.tree);
        if (tour && tour.steps && tour.steps.length) {
          buildTour(view, tour).go(0);
          return;
        }
        const blobs = t.items.filter(function (i) { return i.type === 'blob'; }).map(function (i) { return i.path; });
        const pick = opts.open ||
          blobs.filter(function (p) { return /\.(cs|ts|tsx|js|py|go|rs|java|kt|swift|php|rb)$/.test(p); })
               .sort(function (a, b) { return a.length - b.length; })[0] ||
          blobs[0];
        if (pick) openFile(view, pick);
      }).catch(function (err) {
        if (err.name === 'AbortError') return;
        const empty = el('div', 'gg-empty');
        empty.appendChild(document.createTextNode('Could not load the repository (' + err.message + '). '));
        const a = el('a', null, 'Open it on GitHub →');
        a.href = 'https://github.com/' + repo;
        a.rel = 'noopener';
        empty.appendChild(a);
        side.appendChild(empty);
        setStatus(view, '');
      });
    }

    view.goto = function (file, range) {
      view.hl = range ? { file: file, lines: range } : null;
      if (view.active === file && view.cache[file] != null) applyHighlight(view);
      else openFile(view, file);
    };
    view.open = function (p) { openFile(view, p); };
    view.destroy = function () {
      if (controller) controller.abort();
      if (view.ro) view.ro.disconnect();
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      host.removeAttribute('data-gg-mounted');
    };
    return view;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    const m = document.querySelector('.gg.gg-fullscreen');
    if (!m) return;
    m.classList.remove('gg-fullscreen');
    const b = m.querySelector('.gg-max');
    if (b) { b.innerHTML = MAX_SVG; b.setAttribute('aria-label', 'Maximize'); }
  });

  function scan(root) {
    [].forEach.call((root || document).querySelectorAll('[data-gitglass]:not([data-gg-mounted])'), function (host) {
      host.setAttribute('data-gg-mounted', '');
      try { mount(host); } catch (err) { if (typeof console !== 'undefined' && console.warn) console.warn(err.message); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
  else scan();

  window.GitGlass = { mount: mount, scan: scan, highlight: highlight, langFor: langFor, iconFor: iconFor, parseTarget: parseTarget, splitLines: splitLines, version: '1.3.0' };
})();
