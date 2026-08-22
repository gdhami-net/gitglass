# React

```jsx
import { useEffect, useRef } from 'react';
import 'gitglass/dist/gitglass.min.css';
import 'gitglass/dist/gitglass.min.js';          // registers window.GitGlass

export function RepoViewer({ repo, branch, open, theme }) {
  const host = useRef(null);
  useEffect(() => {
    const view = window.GitGlass.mount(host.current, { repo, branch, open, theme });
    return () => view.destroy();                 // aborts fetches, removes DOM
  }, [repo, branch, open, theme]);
  return <div ref={host} />;
}

// <RepoViewer repo="gdhami-net/gitglass" theme="github-dark" />
```

Next.js: mark the component `'use client'`; the library touches `window`,
so import it inside the component (or with `next/dynamic`, `ssr: false`).
