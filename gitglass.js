/*! gitglass — embed a VS Code-style GitHub repo browser in any static page.
 *  Zero dependencies. MIT. https://github.com/gdhami-net/gitglass
 *
 *  <link rel="stylesheet" href="gitglass.css">
 *  <script src="gitglass.js"></script>
 *  <div data-gitglass="owner/repo"></div>
 *
 *  or: GitGlass.mount(element, { repo: 'owner/repo', branch: 'main' })
 */
(function () {
  'use strict';

  var SKIP = /\.(png|jpe?g|gif|ico|webp|zip|gz|dll|pdb|exe|snk|woff2?|ttf)$/i;
  var MAX_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var MIN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- github ---------- */
  function getTree(repo, branch) {
    var key = 'gitglass:' + repo + '@' + (branch || 'auto');
    try {
      var hit = sessionStorage.getItem(key);
      if (hit) return Promise.resolve(JSON.parse(hit));
    } catch (e) { /* private mode */ }
    var attempt = function (b) {
      return fetch('https://api.github.com/repos/' + repo + '/git/trees/' + b + '?recursive=1')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          return {
            branch: b,
            items: j.tree
              .filter(function (t) { return !SKIP.test(t.path); })
              .map(function (t) { return { path: t.path, type: t.type }; })
          };
        });
    };
    var p = branch ? attempt(branch)
      : attempt('main').catch(function () { return attempt('master'); });
    return p.then(function (tree) {
      try { sessionStorage.setItem(key, JSON.stringify(tree)); } catch (e) { /* full */ }
      return tree;
    });
  }

  function getFile(repo, branch, path) {
    return fetch('https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + path)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }

  /* ---------- highlighting (tiny, dependency-free) ---------- */
  var KW = {
    cs: 'using|namespace|class|record|struct|interface|enum|public|private|protected|internal|static|readonly|const|var|new|return|async|await|void|int|long|double|decimal|bool|string|object|char|if|else|for|foreach|while|do|switch|case|default|break|continue|try|catch|finally|throw|null|true|false|this|base|is|as|in|out|ref|get|set|init|partial|sealed|override|virtual|abstract|where|typeof|nameof|with',
    ts: 'const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|class|extends|implements|interface|type|enum|namespace|import|export|from|as|async|await|yield|static|public|private|protected|readonly|abstract|get|set|null|undefined|true|false|this|super|void|never|any|unknown|string|number|boolean|object|symbol|bigint|satisfies|keyof|infer|declare',
    py: 'def|class|return|if|elif|else|for|while|try|except|finally|raise|with|as|import|from|pass|break|continue|lambda|yield|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|self|async|await'
  };
  var LANG_OF = {
    cs: 'cs', ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', py: 'py',
    json: 'json', csproj: 'xml', props: 'xml', xml: 'xml', html: 'xml', svg: 'xml',
    yml: 'yaml', yaml: 'yaml', gitignore: 'yaml', toml: 'yaml',
    sln: 'plain', md: 'plain', txt: 'plain', lock: 'plain'
  };

  function span(cls, m) { return '<span class="gg-' + cls + '">' + m + '</span>'; }

  function highlight(src, ext) {
    var esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var lang = LANG_OF[ext] || 'plain';
    if (lang === 'plain') return esc;
    if (lang === 'json') {
      return esc.replace(/("(?:[^"\\]|\\.)*")|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b/g,
        function (m, s, n) { return span(s ? 'str' : n ? 'num' : 'kw', m); });
    }
    if (lang === 'xml') {
      return esc.replace(/(&lt;!--[\s\S]*?--&gt;)|("(?:[^"\\]|\\.)*")/g,
        function (m, c) { return span(c ? 'cm' : 'str', m); });
    }
    if (lang === 'yaml') {
      return esc.replace(/(#[^\n]*)|("(?:[^"\\]|\\.)*"|'[^'\n]*')/g,
        function (m, c) { return span(c ? 'cm' : 'str', m); });
    }
    var comment = lang === 'py' ? '(#[^\\n]*)' : '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)';
    var rx = new RegExp(
      comment +
      '|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)' +
      '|(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)' +
      '|\\b(' + KW[lang] + ')\\b', 'g');
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
      row.addEventListener('click', function () { openFile(view, f.path); });
      container.appendChild(row);
    });
  }

  /* ---------- tabs + editor ---------- */
  function renderTabs(view) {
    view.tabs.textContent = '';
    view.openFiles.forEach(function (path) {
      var tab = el('div', 'gg-tab' + (path === view.active ? ' gg-active' : ''));
      tab.appendChild(el('span', null, path.split('/').pop()));
      var x = el('span', 'gg-x', '×');
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = view.openFiles.indexOf(path);
        view.openFiles.splice(i, 1);
        if (view.active === path) {
          view.active = view.openFiles[i] || view.openFiles[i - 1] || null;
          if (view.active) showFile(view, view.active);
          else { view.code.innerHTML = ''; view.gutter.textContent = ''; setStatus(view, ''); }
        }
        renderTabs(view);
        markActiveRow(view);
      });
      tab.appendChild(x);
      tab.addEventListener('click', function () { openFile(view, path); });
      view.tabs.appendChild(tab);
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
    var ext = (path.indexOf('.') !== -1 ? path.split('.').pop() : path.replace(/^\./, '')).toLowerCase();
    var lines = text.split('\n').length;
    var nums = [];
    for (var i = 1; i <= lines; i++) nums.push(i);
    view.gutter.textContent = nums.join('\n');
    view.code.innerHTML = highlight(text, ext);
    setStatus(view, path + ' · ' + lines + ' lines');
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
    getFile(view.repo, view.branch, path).then(function (txt) {
      view.cache[path] = txt;
      if (view.active === path) showFile(view, path);
    }).catch(function () {
      if (view.active === path) setStatus(view, 'failed to load ' + path);
    });
  }

  /* ---------- mounting ---------- */
  function mount(host, opts) {
    opts = opts || {};
    var repo = opts.repo || host.getAttribute('data-gitglass');
    if (!repo || repo.indexOf('/') === -1) throw new Error('gitglass: need "owner/repo"');

    var rootEl = el('div', 'gg');
    var side = el('div', 'gg-side');
    var main = el('div', 'gg-main');
    var tabbar = el('div', 'gg-tabbar');
    var tabs = el('div', 'gg-tabs');
    var maxBtn = el('button', 'gg-max');
    maxBtn.setAttribute('aria-label', 'Maximize');
    maxBtn.innerHTML = MAX_SVG;
    maxBtn.addEventListener('click', function () {
      var on = rootEl.classList.toggle('gg-fullscreen');
      maxBtn.innerHTML = on ? MIN_SVG : MAX_SVG;
      maxBtn.setAttribute('aria-label', on ? 'Restore' : 'Maximize');
    });
    tabbar.appendChild(tabs);
    tabbar.appendChild(maxBtn);
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
      repo: repo, branch: opts.branch || null,
      side: side, tabs: tabs, gutter: gutter, code: code,
      statusL: statusL, statusR: statusR,
      openFiles: [], active: null, cache: {}
    };
    setStatus(view, 'loading repository …');
    getTree(repo, opts.branch).then(function (t) {
      view.branch = t.branch;
      renderDir(view, buildHierarchy(t.items), side, 0);
      setStatus(view, '');
      var blobs = t.items.filter(function (i) { return i.type === 'blob'; }).map(function (i) { return i.path; });
      var pick = opts.open ||
        blobs.filter(function (p) { return /\.(cs|ts|tsx|js|py)$/.test(p); }).sort(function (a, b) { return a.length - b.length; })[0] ||
        blobs[0];
      if (pick) openFile(view, pick);
    }).catch(function () {
      var empty = el('div', 'gg-empty');
      empty.appendChild(document.createTextNode('Could not load the repository (offline or rate-limited). '));
      var a = el('a', null, 'Open it on GitHub →');
      a.href = 'https://github.com/' + repo;
      empty.appendChild(a);
      side.appendChild(empty);
      setStatus(view, '');
    });
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

  function scan() {
    [].forEach.call(document.querySelectorAll('[data-gitglass]:not([data-gg-mounted])'), function (host) {
      host.setAttribute('data-gg-mounted', '');
      mount(host);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();

  window.GitGlass = { mount: mount, scan: scan };
})();
