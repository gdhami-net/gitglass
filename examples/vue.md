# Vue 3

```vue
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import 'gitglass/dist/gitglass.min.css';
import 'gitglass/dist/gitglass.min.js';

const props = defineProps({ repo: String, branch: String, open: String, theme: String });
const host = ref(null);
let view;
onMounted(() => { view = window.GitGlass.mount(host.value, { ...props }); });
onBeforeUnmount(() => view && view.destroy());
</script>

<template><div ref="host" /></template>

<!-- <RepoViewer repo="gdhami-net/gitglass" theme="dracula" /> -->
```
