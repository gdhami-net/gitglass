# No framework

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gdhami-net/gitglass@1.0.0/dist/gitglass.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gdhami-net/gitglass@1.0.0/dist/gitglass.themes.min.css">
<script src="https://cdn.jsdelivr.net/gh/gdhami-net/gitglass@1.0.0/dist/gitglass.min.js"></script>

<div data-gitglass="dotnet/runtime" data-gitglass-theme="github-dark"></div>
```

Every element with `data-gitglass` mounts automatically. For elements added
later (SPA routes, tabs), call `GitGlass.scan()` or `GitGlass.mount(el, opts)`.
