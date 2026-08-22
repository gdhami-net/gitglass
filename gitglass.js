/*! gitglass v1.0 — embed a VS Code-style, read-only GitHub repo browser in any static page.
 *  Zero dependencies. MIT. https://github.com/gdhami-net/gitglass
 *
 *  <link rel="stylesheet" href="dist/gitglass.min.css">
 *  <script src="dist/gitglass.min.js"></script>
 *  <div data-gitglass="owner/repo" data-gitglass-theme="github-dark"></div>
 *
 *  or: var view = GitGlass.mount(el, { repo: 'owner/repo', branch: 'main', open: 'README.md', theme: 'monokai' });
 *      view.destroy();   // aborts pending fetches and removes the DOM (SPA unmount)
 */
(function () {
  'use strict';

  var REPO_RX = /^[\w.-]+\/[\w.-]+$/;
  var SKIP = /\.(png|jpe?g|gif|ico|webp|avif|bmp|zip|gz|7z|rar|dll|pdb|exe|snk|woff2?|ttf|otf|eot|mp[34]|wav|pdf)$/i;
  var MAX_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var MIN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
  var FILES_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- github ---------- */
  function ghError(r) {
    if (r.status === 403 || r.status === 429) {
      var remaining = r.headers.get('X-RateLimit-Remaining');
      var reset = r.headers.get('X-RateLimit-Reset');
      if (remaining === '0' && reset) {
        var at = new Date(parseInt(reset, 10) * 1000);
        return new Error('GitHub API rate limit reached — resets at ' + at.toLocaleTimeString());
      }
    }
    return new Error('HTTP ' + r.status);
  }

  function getTree(repo, branch, signal) {
    var key = 'gitglass:' + repo + '@' + (branch || 'auto');
    try {
      var hit = sessionStorage.getItem(key);
      if (hit) return Promise.resolve(JSON.parse(hit));
    } catch (e) { /* private mode */ }
    var attempt = function (b) {
      return fetch('https://api.github.com/repos/' + repo + '/git/trees/' + encodeURIComponent(b) + '?recursive=1', { signal: signal })
        .then(function (r) { if (!r.ok) throw ghError(r); return r.json(); })
        .then(function (j) {
          return {
            branch: b,
            truncated: !!j.truncated,
            items: j.tree
              .filter(function (t) { return !SKIP.test(t.path); })
              .map(function (t) { return { path: t.path, type: t.type }; })
          };
        });
    };
    var p = branch ? attempt(branch)
      : attempt('main').catch(function (err) { if (err.name === 'AbortError') throw err; return attempt('master'); });
    return p.then(function (tree) {
      try { sessionStorage.setItem(key, JSON.stringify(tree)); } catch (e) { /* full */ }
      return tree;
    });
  }

  function getFile(repo, branch, path, signal) {
    var url = 'https://raw.githubusercontent.com/' + repo + '/' + encodeURIComponent(branch) + '/' +
      path.split('/').map(encodeURIComponent).join('/');
    return fetch(url, { signal: signal })
      .then(function (r) { if (!r.ok) throw ghError(r); return r.text(); });
  }

  /* ---------- highlighting: tiny regex packs, per language ---------- */
  var C_KW = 'if|else|for|while|do|switch|case|default|break|continue|return|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|class|extends|implements|interface|enum|import|export|from|as|async|await|yield|static|public|private|protected|readonly|abstract|get|set|null|undefined|true|false|this|super|void|var|let|const|function';
  var PACKS = {
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
  var EXT = {
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
    var base = path.split('/').pop().toLowerCase();
    if (base === 'dockerfile') return 'dockerfile';
    var ext = base.indexOf('.') !== -1 ? base.split('.').pop() : base.replace(/^\./, '');
    return EXT[ext] || 'plain';
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function span(cls, m) { return '<span class="gg-' + cls + '">' + m + '</span>'; }

  var COMMENT = {
    c: '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',
    hash: '(#[^\\n]*)',
    dash: '(--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    block: '(\\/\\*[\\s\\S]*?\\*\\/)'
  };
  var STRING = '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)';
  var NUMBER = '(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)';
  var rxCache = {};

  function highlight(src, lang) {
    var esc = escapeHtml(src);
    var pack = PACKS[lang] || PACKS.plain;
    if (pack.json) {
      return esc.replace(/("(?:[^"\\]|\\.)*")|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b/g,
        function (m, s, n) { return span(s ? 'str' : n ? 'num' : 'kw', m); });
    }
    if (pack.xml) {
      return esc.replace(/(&lt;!--[\s\S]*?--&gt;)|("(?:[^"\\]|\\.)*")|(&lt;\/?)([\w:-]+)/g,
        function (m, c, s, lt, tag) { return c ? span('cm', m) : s ? span('str', m) : lt + span('kw', tag); });
    }
    if (!pack.kw) return esc;
    var rx = rxCache[lang];
    if (!rx) {
      rx = rxCache[lang] = new RegExp(
        COMMENT[pack.cm] + '|' + STRING + '|' + NUMBER + '|\\b(' + pack.kw + ')\\b', 'g');
    }
    return esc.replace(rx, function (m, cm, str, num) {
      return span(cm ? 'cm' : str ? 'str' : num ? 'num' : 'kw', m);
    });
  }

  /* ---------- tree ---------- */
  function buildHierarchy(items) {
    var root = { dirs: {}, files: [] };
    items.forEach(function (it) {
      var segs = it.path.split('/');
      var node = root;
      for (var i = 0; i < segs.length - 1; i++) {
        node = node.dirs[segs[i]] || (node.dirs[segs[i]] = { dirs: {}, files: [] });
      }
      if (it.type === 'blob') node.files.push({ name: segs[segs.length - 1], path: it.path });
      else if (!node.dirs[segs[segs.length - 1]]) node.dirs[segs[segs.length - 1]] = { dirs: {}, files: [] };
    });
    return root;
  }

  function renderDir(view, node, container, depth) {
    Object.keys(node.dirs).sort().forEach(function (name) {
      var row = el('div', 'gg-row');
      row.style.paddingLeft = (12 + depth * 14) + 'px';
      var chev = el('span', 'gg-chev', '▾');
      row.appendChild(chev);
      row.appendChild(el('span', null, name));
      var kids = el('div');
      container.appendChild(row);
      container.appendChild(kids);
      renderDir(view, node.dirs[name], kids, depth + 1);
      row.addEventListener('click', function () {
        var closed = kids.style.display === 'none';
        kids.style.display = closed ? '' : 'none';
        chev.textContent = closed ? '▾' : '▸';
      });
    });
    node.files.sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (f) {
      var row = el('div', 'gg-row gg-file', f.name);
      row.style.paddingLeft = (12 + depth * 14 + 18) + 'px';
      row.dataset.path = f.path;
      row.addEventListener('click', function () { openFile(view, f.path); if (view.narrow) hideSide(view); });
      container.appendChild(row);
    });
  }

  /* ---------- tabs + editor ---------- */
  function closeTab(view, path) {
    var i = view.openFiles.indexOf(path);
    if (i === -1) return;
    view.openFiles.splice(i, 1);
    if (view.active === path) {
      view.active = view.openFiles[i] || view.openFiles[i - 1] || null;
      if (view.active) showFile(view, view.active);
      else { view.code.innerHTML = ''; view.gutter.textContent = ''; setStatus(view, ''); }
    }
    renderTabs(view);
    markActiveRow(view);
  }

  function renderTabs(view) {
    view.tabs.textContent = '';
    view.openFiles.forEach(function (path) {
      var tab = el('div', 'gg-tab' + (path === view.active ? ' gg-active' : ''));
      tab.title = path;
      tab.appendChild(el('span', 'gg-tabname', path.split('/').pop()));
      var x = el('span', 'gg-x', '×');
      x.setAttribute('aria-label', 'Close ' + path);
      x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(view, path); });
      tab.appendChild(x);
      tab.addEventListener('click', function () { openFile(view, path); });
      tab.addEventListener('auxclick', function (e) {        // middle-click closes
        if (e.button === 1) { e.preventDefault(); closeTab(view, path); }
      });
      tab.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
      view.tabs.appendChild(tab);
      if (path === view.active && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function markActiveRow(view) {
    [].forEach.call(view.side.querySelectorAll('.gg-file'), function (r) {
      r.classList.toggle('gg-active', r.dataset.path === view.active);
    });
  }

  function setStatus(view, right) {
    view.statusL.textContent = view.repo + ' @ ' + (view.branch || '…');
    view.statusR.textContent = right;
  }

  function showFile(view, path) {
    var text = view.cache[path];
    var lang = langFor(path);
    var lines = text.split('\n').length;
    var nums = [];
    for (var i = 1; i <= lines; i++) nums.push(i);
    view.gutter.textContent = nums.join('\n');
    view.code.innerHTML = highlight(text, lang);
    view.body.scrollTop = 0;
    setStatus(view, path + ' · ' + lines + ' lines · ' + lang);
  }

  function openFile(view, path) {
    view.active = path;
    if (view.openFiles.indexOf(path) === -1) view.openFiles.push(path);
    renderTabs(view);
    markActiveRow(view);
    if (view.cache[path] != null) return showFile(view, path);
    view.code.innerHTML = '';
    view.gutter.textContent = '';
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

  /* ---------- mounting ---------- */
  function mount(host, opts) {
    opts = opts || {};
    var repo = opts.repo || host.getAttribute('data-gitglass') || '';
    if (!REPO_RX.test(repo)) throw new Error('gitglass: expected "owner/repo", got ' + JSON.stringify(repo));
    var theme = opts.theme || host.getAttribute('data-gitglass-theme');
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    var rootEl = el('div', 'gg');
    if (theme) rootEl.setAttribute('data-theme', theme);
    var side = el('div', 'gg-side');
    var main = el('div', 'gg-main');
    var tabbar = el('div', 'gg-tabbar');
    var filesBtn = el('button', 'gg-files');
    filesBtn.setAttribute('aria-label', 'Toggle file list');
    filesBtn.innerHTML = FILES_SVG;
    var tabs = el('div', 'gg-tabs');
    var maxBtn = el('button', 'gg-max');
    maxBtn.setAttribute('aria-label', 'Maximize');
    maxBtn.innerHTML = MAX_SVG;
    maxBtn.addEventListener('click', function () {
      var on = rootEl.classList.toggle('gg-fullscreen');
      maxBtn.innerHTML = on ? MIN_SVG : MAX_SVG;
      maxBtn.setAttribute('aria-label', on ? 'Restore' : 'Maximize');
    });
    tabbar.appendChild(filesBtn);
    tabbar.appendChild(tabs);
    tabbar.appendChild(maxBtn);
    tabs.addEventListener('wheel', function (e) {        // vertical wheel scrolls the strip horizontally
      if (e.deltaY && !e.deltaX && tabs.scrollWidth > tabs.clientWidth) {
        e.preventDefault();
        tabs.scrollLeft += e.deltaY;
      }
    }, { passive: false });
    var body = el('div', 'gg-body');
    var gutter = el('div', 'gg-gutter');
    var code = el('pre', 'gg-code');
    var status = el('div', 'gg-status');
    var statusL = el('span');
    var statusR = el('span');
    status.appendChild(statusL);
    status.appendChild(statusR);
    body.appendChild(gutter);
    body.appendChild(code);
    main.appendChild(tabbar);
    main.appendChild(body);
    main.appendChild(status);
    rootEl.appendChild(side);
    rootEl.appendChild(main);
    host.appendChild(rootEl);

    var view = {
      repo: repo, branch: opts.branch || null, root: rootEl, host: host,
      side: side, tabs: tabs, body: body, gutter: gutter, code: code,
      statusL: statusL, statusR: statusR,
      openFiles: [], active: null, cache: {}, narrow: false,
      signal: controller ? controller.signal : undefined
    };
    filesBtn.addEventListener('click', function () {
      if (rootEl.classList.contains('gg-side-open')) hideSide(view); else showSide(view);
    });
    rootEl.addEventListener('keydown', function (e) {   // ctrl/cmd+W closes active tab when focus is inside
      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W') && view.active) {
        e.preventDefault();
        closeTab(view, view.active);
      }
    });
    rootEl.tabIndex = 0;

    view.narrow = rootEl.clientWidth > 0 && rootEl.clientWidth < 720;   // synchronous first check
    rootEl.classList.toggle('gg-narrow', view.narrow);
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function (entries) {
        var w = entries[0].contentRect.width;
        view.narrow = w < 720;
        rootEl.classList.toggle('gg-narrow', view.narrow);
        if (!view.narrow) hideSide(view);
      });
      ro.observe(rootEl);
      view.ro = ro;
    }

    setStatus(view, 'loading repository …');
    getTree(repo, opts.branch, view.signal).then(function (t) {
      view.branch = t.branch;
      renderDir(view, buildHierarchy(t.items), side, 0);
      setStatus(view, t.truncated ? 'tree truncated by GitHub (very large repo)' : '');
      var blobs = t.items.filter(function (i) { return i.type === 'blob'; }).map(function (i) { return i.path; });
      var pick = opts.open ||
        blobs.filter(function (p) { return /\.(cs|ts|tsx|js|py|go|rs|java|kt|swift|php|rb)$/.test(p); })
             .sort(function (a, b) { return a.length - b.length; })[0] ||
        blobs[0];
      if (pick) openFile(view, pick);
    }).catch(function (err) {
      if (err.name === 'AbortError') return;
      var empty = el('div', 'gg-empty');
      empty.appendChild(document.createTextNode('Could not load the repository (' + err.message + '). '));
      var a = el('a', null, 'Open it on GitHub →');
      a.href = 'https://github.com/' + repo;
      a.rel = 'noopener';
      empty.appendChild(a);
      side.appendChild(empty);
      setStatus(view, '');
    });

    view.destroy = function () {
      if (controller) controller.abort();
      if (view.ro) view.ro.disconnect();
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      host.removeAttribute('data-gg-mounted');
    };
    view.open = function (path) { openFile(view, path); };
    return view;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    var m = document.querySelector('.gg.gg-fullscreen');
    if (!m) return;
    m.classList.remove('gg-fullscreen');
    var b = m.querySelector('.gg-max');
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

  window.GitGlass = { mount: mount, scan: scan, highlight: highlight, langFor: langFor, version: '1.0.0' };
})();
