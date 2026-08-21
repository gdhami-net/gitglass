# gitglass

Embed a VS Code-style, read-only GitHub repo browser in any static
page. File tree, tabs, syntax highlighting, line numbers, fullscreen —
in ~8 KB of vanilla JavaScript and one stylesheet. **Zero
dependencies, zero build step, zero backend.**

Born as the "browse the code" viewer on [gdhami.net](https://gdhami.net),
extracted because it turned out to be generally useful.

## Use it

```html
<link rel="stylesheet" href="gitglass.css">
<script src="gitglass.js"></script>

<div data-gitglass="dotnet/runtime"></div>
```

That's the whole integration. Every element with a `data-gitglass`
attribute becomes a browser for that repo. Or mount programmatically:

```js
GitGlass.mount(document.querySelector('#viewer'), {
  repo: 'gdhami-net/gitglass',
  branch: 'master',        // optional — auto-detects main/master
  open: 'gitglass.js'      // optional — file to open first
});
```

## What it does

- Fetches the tree and files **live from the GitHub API** at view
  time, so it can never drift from the repo (session-cached: one API
  call per repo per session).
- Collapsible folder tree, real tabs (open/switch/close), line-number
  gutter, status bar, maximize to fullscreen (Esc restores).
- Built-in lightweight highlighting for C#, TypeScript/JavaScript,
  Python, JSON, XML/HTML, YAML — and plain text for everything else.
- Dark by default; restyle everything through the `--gg-*` CSS
  variables on `.gg`.

## Honest limits

- Public repos only, unauthenticated: GitHub allows 60 API requests
  per hour per visitor IP. One repo tree costs one request (file
  contents come from `raw.githubusercontent.com`, which is separate).
  On failure it degrades to a plain "open it on GitHub" link.
- Read-only by design. It's a viewer, not an editor, and that's why
  it stays at 8 KB.
- Very large repos load their full tree in one call; trees over
  GitHub's truncation limit (100k entries) are not paged.

MIT licensed.
