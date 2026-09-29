/* gitglass demo page. A plain script (it also runs when the page is opened from disk):
   no build step, no dependencies, no inline styles; every look comes from demo.css.

   GitHub allows 60 unauthenticated API calls per hour per IP address. gitglass spends
   one per repo tree and caches it for the tab session, so this page mounts the main
   viewer first and the other repo viewers only after it has loaded: they then read
   the cached tree and the whole page costs one call. Viewers below the fold mount only
   once they are on screen, because gitglass scrolls a new viewer's tab (and a tour's
   highlighted lines) into view, and doing that off screen would make the page jump. */
(function () {
  'use strict';

  var VERSION = '1.3.0';
  var CDN = 'https://cdn.jsdelivr.net/gh/gdhami-net/gitglass@' + VERSION + '/dist/';
  var DEFAULT_REPO = 'gdhami-net/gitglass';
  var REPO_RX = /^[\w.-]+\/[\w.-]+$/;   // the check gitglass itself makes

  /* All 18 themes. bundle: also in gitglass.themes.min.css, which this page loads up
     front. The others exist only as dist/themes/<name>.min.css, fetched on first pick. */
  var THEMES = [
    { name: 'vs-dark', look: 'dark', bundle: true, tag: 'default' },
    { name: 'github-dark', look: 'dark', bundle: true },
    { name: 'monokai', look: 'dark', bundle: true },
    { name: 'dracula', look: 'dark', bundle: true },
    { name: 'solarized-dark', look: 'dark', bundle: true },
    { name: 'nord', look: 'dark', bundle: true },
    { name: 'slate-dark', look: 'dark', bundle: true },
    { name: 'midnight', look: 'dark' },
    { name: 'reef', look: 'dark' },
    { name: 'dune', look: 'dark' },
    { name: 'forest', look: 'dark' },
    { name: 'ember', look: 'dark' },
    { name: 'vs-light', look: 'light', bundle: true },
    { name: 'github-light', look: 'light', bundle: true },
    { name: 'solarized-light', look: 'light', bundle: true },
    { name: 'slate-light', look: 'light', bundle: true },
    { name: 'daylight', look: 'light' },
    { name: 'quiet-light', look: 'light' }
  ];
  var BY = {};
  THEMES.forEach(function (t) { BY[t.name] = t; });

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function deferred() {
    var d = {};
    d.promise = new Promise(function (resolve) { d.resolve = resolve; });
    return d;
  }
  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var form = $('repo-form'), input = $('repo'), msg = $('repo-msg'), apiLeft = $('api-left');
  var mainHost = $('main-host'), snippetHost = $('snippet-host'), tourHost = $('tour-host'), narrowHost = $('narrow-host');
  var usageCode = $('usage-code'), usageNote = $('usage-note'), usageTitle = $('usage-title'), copyBtn = $('copy-usage');
  var live = $('live');

  var state = { theme: 'vs-dark', repo: DEFAULT_REPO, lazy: false };
  var usageText = '';

  /* ---------- small helpers ---------- */

  // "owner/repo", or a pasted GitHub URL such as https://github.com/owner/repo/tree/main/src
  function normalizeRepo(v) {
    v = String(v || '').trim();
    var url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+)/i.exec(v);
    if (url) v = url[1] + '/' + url[2];
    v = v.replace(/\.git$/i, '').replace(/\/+$/, '');
    return REPO_RX.test(v) ? v : null;
  }
  function lazyFor(repo) {
    var chip = form.querySelector('[data-repo="' + repo + '"]');
    return !!(chip && chip.hasAttribute('data-lazy'));
  }
  function readHash() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) { try { out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* bad escape */ } }
    });
    return out;
  }
  function writeHash() {
    var parts = ['theme=' + state.theme];
    if (state.repo !== DEFAULT_REPO) parts.push('repo=' + state.repo);
    try { history.replaceState(null, '', '#' + parts.join('&')); } catch (e) { /* not allowed here */ }
  }
  function announce(text) {
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  // mount a viewer only once it is on screen (see the note at the top)
  function whenVisible(node, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      fn();
    }, { rootMargin: '0px 0px -40px 0px' });
    io.observe(node);
  }

  // A repo viewer has settled when its file tree has rows, or when gitglass has put its
  // error text in the tree. Both are plain DOM, so this needs nothing from the library.
  function whenSettled(host) {
    return new Promise(function (resolve) {
      var done = false, mo = new MutationObserver(check), timer = setTimeout(function () { finish(false, 'timeout'); }, 30000);
      function finish(ok, text) {
        if (done) return;
        done = true;
        mo.disconnect();
        clearTimeout(timer);
        resolve({ ok: ok, text: text || '' });
      }
      function check() {
        var err = host.querySelector('.gg-side .gg-empty');
        if (err) finish(false, err.textContent);
        else if (host.querySelector('.gg-side .gg-row')) finish(true);
      }
      mo.observe(host, { childList: true, subtree: true });
      check();
    });
  }

  function placeholder(host, text) {
    host.textContent = '';
    host.appendChild(el('div', 'viewer-wait', text));
  }

  function showMsg(kind, strong, text) {
    msg.textContent = '';
    msg.className = 'msg msg-' + kind;
    if (strong) msg.appendChild(el('strong', null, strong + ' '));
    msg.appendChild(document.createTextNode(text));
    msg.hidden = false;
  }
  function hideMsg() { msg.hidden = true; msg.textContent = ''; }

  /* ---------- GitHub API budget (the rate_limit endpoint itself is free) ---------- */
  function refreshApiLeft() {
    if (!window.fetch) return;
    fetch('https://api.github.com/rate_limit').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var core = j.resources.core;
      var at = new Date(core.reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      apiLeft.textContent = 'GitHub API: ';
      apiLeft.appendChild(el('b', null, String(core.remaining)));
      apiLeft.appendChild(document.createTextNode(' of ' + core.limit + ' calls left, resets ' + at));
      apiLeft.classList.toggle('is-low', core.remaining < 10);
    }).catch(function () { /* keep the static line */ });
  }

  /* ---------- themes ---------- */
  function buildPicker() {
    var fieldset = $('theme-picker'), key = $('tp-key');
    ['dark', 'light'].forEach(function (look) {
      var group = el('div', 'tp-group');
      var head = el('p', 'tp-head', look === 'dark' ? 'Dark' : 'Light');
      head.id = 'tp-head-' + look;
      var list = el('div', 'tp-list');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-labelledby', head.id);
      THEMES.filter(function (t) { return t.look === look; }).forEach(function (t) {
        var item = el('label', 'tp-item');
        var radio = el('input', 'tp-radio');
        radio.type = 'radio';
        radio.name = 'theme';
        radio.value = t.name;
        var sw = el('span', 'tp-sw gg' + (t.bundle ? '' : ' is-pending'));
        sw.setAttribute('data-theme', t.name);
        sw.setAttribute('aria-hidden', 'true');
        sw.appendChild(el('i'));
        sw.appendChild(el('i'));
        sw.appendChild(el('i'));
        var tag = el('span', 'tp-tag' + (t.bundle ? '' : ' tp-tag-file'), t.tag || (t.bundle ? 'bundle' : 'file'));
        item.appendChild(radio);
        item.appendChild(sw);
        item.appendChild(el('span', 'tp-name', t.name));
        item.appendChild(tag);
        list.appendChild(item);
        t.radio = radio; t.item = item; t.sw = sw; t.tagEl = tag;
      });
      group.appendChild(head);
      group.appendChild(list);
      fieldset.insertBefore(group, key);
    });
    fieldset.addEventListener('change', function (e) {
      if (e.target.name !== 'theme') return;
      var t = BY[e.target.value];
      if (t.item.scrollIntoView) t.item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      pickTheme(t.name, true);
    });
  }

  // a single-file theme: add its <link> the first time it is picked, resolve once it has loaded
  function ensureTheme(t) {
    if (t.bundle) return Promise.resolve();
    if (t.ready) return t.ready;
    t.ready = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '../dist/themes/' + t.name + '.min.css';
      link.onload = function () {
        var timing = window.performance && performance.getEntriesByName ? performance.getEntriesByName(link.href)[0] : null;
        t.bytes = timing && timing.encodedBodySize ? timing.encodedBodySize : 0;
        t.sw.classList.remove('is-pending');
        t.tagEl.classList.add('is-loaded');
        t.tagEl.textContent = 'loaded';
        resolve();
      };
      link.onerror = function () {
        t.ready = null;
        if (link.parentNode) link.parentNode.removeChild(link);
        reject(new Error('could not fetch ' + link.href));
      };
      document.head.appendChild(link);
    });
    return t.ready;
  }

  var pickSeq = 0;
  function pickTheme(name, byUser) {
    var t = BY[name], seq = ++pickSeq;
    t.radio.checked = true;
    return ensureTheme(t).then(function () {
      if (seq !== pickSeq) return;   // a later pick won the race
      state.theme = name;
      applyTheme();
      renderUsage();
      if (byUser) { writeHash(); announce('Theme ' + name + ' applied.'); }
    }, function () {
      if (seq !== pickSeq) return;
      BY[state.theme].radio.checked = true;
      showMsg('error', 'Theme file missing.', 'Could not fetch dist/themes/' + name + '.min.css. Is the page served from the repo root?');
    });
  }

  // the page look follows the theme; every mounted viewer switches by its data-theme attribute
  function applyTheme() {
    var t = BY[state.theme];
    document.documentElement.setAttribute('data-look', t.look);
    [].forEach.call(document.querySelectorAll('.viewer .gg'), function (g) { g.setAttribute('data-theme', t.name); });
    snippetHost.setAttribute('data-gitglass-theme', t.name);   // read if the snippet has not mounted yet
  }

  /* ---------- copy-paste code ---------- */
  function renderUsage() {
    var t = BY[state.theme], builtIn = t.name === 'vs-dark';
    var lines = ['<link rel="stylesheet" href="' + CDN + 'gitglass.min.css">'];
    if (!builtIn) lines.push('<link rel="stylesheet" href="' + CDN + 'themes/' + t.name + '.min.css">');
    lines.push('<script src="' + CDN + 'gitglass.min.js"></script>', '');
    if (builtIn) lines.push('<!-- vs-dark is the built-in default: no theme file, no theme attribute -->');
    lines.push('<div data-gitglass="' + state.repo + '"' + (builtIn ? '' : ' data-gitglass-theme="' + t.name + '"') +
      (state.lazy ? ' data-gitglass-lazy' : '') + '></div>');
    usageText = lines.join('\n');
    usageCode.innerHTML = GitGlass.highlight(usageText, 'xml');   // gitglass escapes before it highlights

    usageTitle.textContent = 'Paste this into your page ';
    usageTitle.appendChild(el('span', null, '· ' + t.name + ' · ' + state.repo));

    var note;
    if (builtIn) note = 'vs-dark is built into gitglass.min.css, so it needs no theme file. Every colour is a CSS variable (--gg-bg, --gg-kw …) that you can override in your own stylesheet.';
    else if (t.bundle) note = t.name + ' is also in the bundle: link dist/gitglass.themes.min.css instead of the single file to get all eleven presets at once (1.1 KB gzipped).';
    else note = t.name + ' ships only as this single file.' + (t.bytes ? ' This page fetched it when you picked it: ' + t.bytes + ' bytes.' : '');
    if (state.lazy) note += ' data-gitglass-lazy makes each folder list itself when it opens, one API call per folder: the right trade for a repo with a huge tree.';
    usageNote.textContent = note;
  }

  function copyText(text, btn) {
    function done(ok) {
      btn.textContent = ok ? 'Copied' : 'Select and copy';
      btn.classList.toggle('is-done', ok);
      announce(ok ? 'Code copied to the clipboard.' : 'Copying failed. The code is selected; press Ctrl+C or Cmd+C.');
      clearTimeout(btn.resetTimer);
      btn.resetTimer = setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('is-done'); }, 1800);
    }
    function fallback() {
      var ta = el('textarea', 'offscreen');
      ta.value = text;
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      btn.focus();
      if (!ok && window.getSelection) window.getSelection().selectAllChildren(usageCode);
      done(ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  /* ---------- the main viewer ---------- */
  var mainView = null, mainGen = 0, firstSettle = deferred();
  // the other repo viewers wait for the first main load (so they hit the cache), but never for long
  function afterMain() { return Promise.race([firstSettle.promise, delay(4000)]); }

  function loadMain() {
    var gen = ++mainGen;
    if (mainView) { mainView.destroy(); mainView = null; }
    mainHost.textContent = '';
    // no "loading" box: anything that changes height above the viewer while it loads
    // would move it just as gitglass scrolls its first tab into view (the viewer's own
    // status bar says "loading repository …")
    hideMsg();
    mainView = GitGlass.mount(mainHost, { repo: state.repo, theme: state.theme, lazy: state.lazy });
    renderUsage();
    whenSettled(mainHost).then(function (res) {
      firstSettle.resolve();
      if (gen !== mainGen) return;
      refreshApiLeft();
      if (!res.ok) showLoadError(state.repo, res.text);
    });
  }

  // gitglass writes "Could not load the repository (HTTP 404). Open it on GitHub →" in the tree
  function showLoadError(repo, text) {
    var m = /\(([^)]*)\)/.exec(text), why = m ? m[1] : text;
    if (why === 'timeout') showMsg('error', 'No answer.', 'GitHub did not answer within 30 seconds. Check your connection and press Load again.');
    else if (/HTTP 404/.test(why)) showMsg('error', 'Not found.', 'GitHub has no public repo ' + repo + ' with a main or master branch. Check the spelling (owner/repo); private repos cannot be shown.');
    else if (/rate limit/i.test(why)) showMsg('error', 'Rate limit reached.', why + '. Without a token GitHub allows 60 API calls per hour per IP address. Repos already opened in this tab still load from the cache.');
    else showMsg('error', 'Could not load ' + repo + '.', why + '.');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var repo = normalizeRepo(input.value);
    if (!repo) {
      input.setAttribute('aria-invalid', 'true');
      showMsg('error', 'Not a repo name.', 'Type it as owner/repo, for example dotnet/runtime, or paste its GitHub URL.');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    input.value = repo;
    state.repo = repo;
    state.lazy = lazyFor(repo);
    writeHash();
    loadMain();
  });
  input.addEventListener('input', function () {
    if (input.getAttribute('aria-invalid')) { input.removeAttribute('aria-invalid'); hideMsg(); }
  });
  [].forEach.call(form.querySelectorAll('[data-repo]'), function (b) {
    b.addEventListener('click', function () {
      input.value = b.getAttribute('data-repo');
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  });
  copyBtn.addEventListener('click', function () { copyText(usageText, copyBtn); });

  /* ---------- snippet, tour, narrow ---------- */
  var tourScript = tourHost.querySelector('script[type="application/json"]');
  var tourSteps = JSON.parse(tourScript.textContent).steps;

  function renderStaticCode() {
    $('snippet-code').innerHTML = GitGlass.highlight('<div data-gitglass="' + snippetHost.getAttribute('data-gitglass') + '"></div>', 'xml');

    var list = $('tour-steps');
    tourSteps.forEach(function (s) {
      var li = el('li');
      li.appendChild(el('b', null, s.title));
      li.appendChild(document.createTextNode(' '));
      li.appendChild(el('code', null, s.file + ' L' + s.lines[0] + '–' + s.lines[1]));
      list.appendChild(li);
    });

    var short = function (s) { var w = s.split(' '); return w.length > 6 ? w.slice(0, 6).join(' ') + ' …' : s; };
    var src = ['<div data-gitglass="' + tourHost.getAttribute('data-repo') + '">', '  <script type="application/json">', '  {"steps": ['];
    tourSteps.forEach(function (s, i) {
      src.push('    {"file": "' + s.file + '", "lines": [' + s.lines.join(', ') + '], "title": "' + s.title + '",');
      src.push('     "text": "' + short(s.text) + '"}' + (i < tourSteps.length - 1 ? ',' : ''));
    });
    src.push('  ]}', '  </script>', '</div>');
    $('tour-code').innerHTML = GitGlass.highlight(src.join('\n'), 'xml');
  }

  $('tour-start').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Starting …';
    afterMain().then(function () {
      $('tour-cover').hidden = true;
      tourHost.hidden = false;
      // gitglass reads the steps from the JSON script inside the host
      GitGlass.mount(tourHost, { repo: tourHost.getAttribute('data-repo'), theme: state.theme });
      var gg = tourHost.querySelector('.gg');
      if (gg) gg.focus({ preventScroll: true });   // arrow keys work straight away
    });
  });

  /* ---------- start ---------- */
  var hash = readHash();
  var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  var firstTheme = BY[hash.theme] ? hash.theme : (prefersLight ? 'github-light' : 'vs-dark');
  var hashRepo = normalizeRepo(hash.repo);
  if (hashRepo) { state.repo = hashRepo; input.value = hashRepo; }
  state.lazy = lazyFor(state.repo);

  buildPicker();
  document.documentElement.setAttribute('data-look', BY[firstTheme].look);   // before any viewer paints
  state.theme = BY[firstTheme].bundle ? firstTheme : 'vs-dark';
  renderUsage();
  pickTheme(firstTheme, false);
  renderStaticCode();
  refreshApiLeft();

  placeholder(mainHost, 'The viewer loads when it is on screen …');
  placeholder(narrowHost, 'Loads when it scrolls into view …');
  whenVisible(mainHost, loadMain);
  afterMain().then(function () {
    whenVisible(narrowHost, function () {
      narrowHost.textContent = '';
      GitGlass.mount(narrowHost, { repo: DEFAULT_REPO, theme: state.theme });
    });
  });
})();
