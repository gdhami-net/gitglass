# gitglass

Embed a VS Code-style, **read-only** GitHub repo browser in any static
page. File tree with file-type icons, tabs, syntax highlighting, line
numbers, fullscreen, themes, snippet mode, guided tours, copy, tab
scrolling, on-demand folders for huge repos — **9.9 KB min+gzip, zero
dependencies, zero build step, zero backend.**

| file | minified | min+gzip |
| --- | --- | --- |
| `dist/gitglass.min.js` | 25.7 KB | **9.9 KB** |
| `dist/gitglass.min.css` | 8.1 KB | 2.4 KB |
| `dist/gitglass.themes.min.css` (11 presets, optional) | 3.8 KB | 1.1 KB |

Born as the "browse the code" viewer on [gdhami.net](https://gdhami.net);
extracted because it turned out to be generally useful.

## Use it

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gdhami-net/gitglass@1.2.0/dist/gitglass.min.css">
<script src="https://cdn.jsdelivr.net/gh/gdhami-net/gitglass@1.2.0/dist/gitglass.min.js"></script>

<div data-gitglass="dotnet/runtime"></div>
```

That's the whole integration: every element with `data-gitglass` becomes a
browser for that repo. Programmatic use, with cleanup for SPAs:

```js
const view = GitGlass.mount(document.querySelector('#viewer'), {
  repo: 'gdhami-net/gitglass',
  branch: 'master',        // optional — auto-detects main/master
  open: 'gitglass.js',     // optional — file to open first
  theme: 'github-dark',    // optional — see themes
  lazy: false,             // optional — list folders on demand (see "Big repos")
  expand: 'auto'           // optional — 'auto' opens every folder of a small repo; 'all' | 'none'
});
view.open('README.md');    // open another file
view.destroy();            // abort pending fetches, remove the DOM
GitGlass.scan();           // mount any data-gitglass elements added later
```

Framework wrappers (React/Next, Vue, Angular, Svelte) are in
[`examples/`](examples/) — each is about ten lines because the core is plain DOM.

## Snippets and guided tours (v1.1)

```html
<!-- one file, a line range, real line numbers, zero API calls -->
<div data-gitglass="owner/repo#src/file.cs:L10-L40"></div>

<!-- a guided tour: each step opens a file, highlights a range, explains it -->
<div data-gitglass="owner/repo">
  <script type="application/json">
  {"steps": [
    {"file": "src/Program.cs", "lines": [12, 20], "title": "Where requests enter", "text": "..."},
    {"file": "src/Cache.cs", "lines": [40, 58], "title": "Single flight", "text": "..."}
  ]}
  </script>
</div>
```

Programmatically: `GitGlass.mount(el, { repo, path, lines: [10, 40] })` for a
snippet, `{ repo, tour: { steps } }` for a tour; `view.goto(file, [a, b])`
highlights any range, `view.tour.next()/prev()/go(i)` drive a tour. Arrow
keys work while the viewer has focus.

## Big repos (v1.2)

By default one API call fetches the whole tree, folders render their
rows the first time they open, and a folder with hundreds of entries
shows a hundred at a time behind a **"show more"** row. Repos past
GitHub's single-listing limit (≈100k entries) switch automatically to
**on-demand mode**: the root lists first and each folder lists itself
when opened — one API call per folder, cached for the session by its
tree sha. Opt a known-huge repo into that mode from the start with
`data-gitglass-lazy` (or `{ lazy: true }`) so the first paint never
downloads a multi-megabyte tree:

```html
<div data-gitglass="dotnet/runtime" data-gitglass-lazy></div>
```

Small repos (≤ 60 entries) open fully expanded; larger ones open
collapsed with the active file's folders revealed. `data-gitglass-expand="all|none"`
(or `{ expand }`) overrides that.

## Themes and styling

Every color is a CSS variable on `.gg` (`--gg-bg`, `--gg-side`, `--gg-kw`,
`--gg-str`, `--gg-cm`, `--gg-num`, `--gg-accent` …), plus `--gg-mono` for the
font stack, `--gg-font-size`, and `--gg-height`. Override them anywhere in
your own stylesheet.

Load `dist/gitglass.themes.min.css` for named presets and set
`data-gitglass-theme="…"` (or `{ theme }`): **vs-dark** (default),
**vs-light**, **github-dark**, **github-light**, **monokai**, **dracula**,
**solarized-dark**, **solarized-light**, **nord**, and **slate-dark** / **slate-light** — the original palette the viewer was born with on gdhami.net.

## What it does

- Fetches the tree and files **live from the GitHub API** at view time —
  it can never drift from the repo. Session-cached: one API call per repo.
- Collapsible folder tree with **file-type icons** (CSS badges, no icon
  font — a coloured `C#`, `TS`, `{}` … per kind, folder glyphs in
  `--gg-folder`); opening a file reveals it in the tree; real tabs
  (open/switch/close, **middle-click or Ctrl/Cmd+W closes**); the tab strip
  scrolls with edge fades when it overflows, with ‹ › scroll arrows when it
  does; hover the tab bar for a **copy-file** button; line-number gutter;
  status bar; maximize to fullscreen (Esc restores).
- **Responsive**: under 720px of container width the file tree folds behind
  a ☰ button as an overlay.
- Lightweight highlighting for **C#, TypeScript/JavaScript (incl. Vue/Svelte
  SFC), Python, Go, Rust, Java, Kotlin, Swift, PHP, Ruby, SQL, CSS/SCSS,
  shell/PowerShell, C/C++, Dockerfile, JSON, XML/HTML/Razor, YAML/TOML/ini**
  — plain text for everything else. It's keyword/string/comment/number
  level by design, not a full tokenizer: that's how it stays under 10 KB. CSS gets a dedicated pass (selectors, properties, values).
- Degrades honestly: offline or rate-limited, it shows why (including the
  rate-limit reset time) and links to the repo on GitHub.

## Security notes

- All file content is HTML-escaped before highlighting; the highlighter only
  ever emits its own `<span class="gg-…">` tags. `npm test` runs hostile
  inputs (script/img/svg/iframe injections) through every language pack.
- Repo names are validated (`owner/repo` only); branch and path segments are
  URL-encoded; outbound links carry `rel="noopener"`.
- No inline scripts or inline style attributes — works under a strict CSP
  that allows `connect-src` to `api.github.com` and
  `raw.githubusercontent.com`.
- `destroy()` aborts in-flight requests via `AbortController` so unmounted
  viewers never write to a removed DOM.

## Honest limits

- **Public repos only**, unauthenticated: GitHub allows 60 API requests per
  hour per visitor IP. One repo tree costs one request; file contents come
  from `raw.githubusercontent.com`, which is separate. On-demand mode
  spends one request per folder opened, so it is the right trade only for
  repos whose full tree would be huge.
- Read-only by design — a viewer, not an editor.
- Folders are paged at 100 rows; a folder behind an unclicked "show more"
  can't be auto-revealed when a tour or `open` points into it.

## Development

```
npm install      # esbuild, dev only
npm run build    # dist/ + size table
npm test         # hostile-input and detection tests
```

MIT licensed.
