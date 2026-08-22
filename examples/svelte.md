# Svelte 5

```svelte
<script>
  import { onMount } from 'svelte';
  import 'gitglass/dist/gitglass.min.css';
  import 'gitglass/dist/gitglass.min.js';

  let { repo, branch, open, theme } = $props();
  let host;
  onMount(() => {
    const view = window.GitGlass.mount(host, { repo, branch, open, theme });
    return () => view.destroy();
  });
</script>

<div bind:this={host}></div>

<!-- <RepoViewer repo="gdhami-net/gitglass" theme="nord" /> -->
```
