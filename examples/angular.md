# Angular 17+ (standalone)

```ts
import { Component, ElementRef, Input, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';
import 'gitglass/dist/gitglass.min.js';
// add "node_modules/gitglass/dist/gitglass.min.css" to angular.json styles

declare const GitGlass: { mount(el: HTMLElement, opts: object): { destroy(): void } };

@Component({
  selector: 'app-repo-viewer',
  standalone: true,
  template: '<div #host></div>',
})
export class RepoViewerComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) repo!: string;
  @Input() branch?: string;
  @Input() open?: string;
  @Input() theme?: string;
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  private view?: { destroy(): void };

  ngAfterViewInit() {
    this.view = GitGlass.mount(this.host.nativeElement,
      { repo: this.repo, branch: this.branch, open: this.open, theme: this.theme });
  }
  ngOnDestroy() { this.view?.destroy(); }
}

// <app-repo-viewer repo="gdhami-net/gitglass" theme="vs-light" />
```
