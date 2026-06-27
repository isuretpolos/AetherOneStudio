import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import { DeviceStore } from './device-store.service';

const MONACO_VS_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs';

interface MonacoLoaderWindow extends Window {
  require?: {
    config(options: unknown): void;
    (modules: string[], onLoad: () => void, onError?: () => void): void;
  };
  monaco?: {
    editor: {
      create(host: HTMLElement, options: Record<string, unknown>): MonacoEditor;
    };
  };
  MonacoEnvironment?: {
    getWorkerUrl(): string;
  };
}

interface MonacoEditor {
  dispose(): void;
  getValue(): string;
  setValue(value: string): void;
  updateOptions(options: Record<string, unknown>): void;
  onDidChangeModelContent(callback: () => void): void;
}

@Component({
  selector: 'app-script-editor',
  template: `
    <div class="script-header">
      <h2>Behavior Script</h2>
      <span>{{ status }}</span>
    </div>
    <div #editorHost class="editor-host" [class.is-hidden]="!editorReady"></div>
    <textarea
      class="fallback-editor"
      [class.is-hidden]="editorReady"
      [disabled]="!store.selectedElement()"
      [value]="store.selectedElement()?.behavior?.script ?? ''"
      spellcheck="false"
      (input)="updateScript($any($event.target).value)"
    ></textarea>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 0;
      border-top: 1px solid #383f48;
      background: #11151a;
    }

    .script-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid #383f48;
      background: #16191d;
    }

    h2,
    span {
      margin: 0;
      color: #98a4ad;
      font-size: 12px;
    }

    h2 {
      text-transform: uppercase;
    }

    .editor-host,
    .fallback-editor {
      width: 100%;
      height: 100%;
      min-height: 0;
      grid-row: 2;
      grid-column: 1;
    }

    .fallback-editor {
      border: 0;
      padding: 12px 14px;
      background: #0d1116;
      color: #eef2f4;
      font: 13px/1.45 Consolas, 'Cascadia Code', 'Courier New', monospace;
      resize: none;
      outline: none;
    }

    .is-hidden {
      display: none;
    }
  `,
})
export class ScriptEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorHost', { static: true }) private readonly editorHost!: ElementRef<HTMLDivElement>;

  readonly store = inject(DeviceStore);
  status = 'Select an element to edit its script.';
  editorReady = false;
  private editor?: MonacoEditor;
  private suppressChange = false;

  constructor() {
    effect(() => {
      const selected = this.store.selectedElement();
      this.status = selected ? `${selected.id} behavior script` : 'Select an element to edit its script.';
      this.syncEditorValue(selected?.behavior.script ?? '');
      this.editor?.updateOptions({ readOnly: !selected });
    });
  }

  ngAfterViewInit(): void {
    const monacoWindow = window as MonacoLoaderWindow;
    if (!monacoWindow.require) {
      this.status = 'Monaco unavailable. Using textarea fallback.';
      return;
    }

    monacoWindow.MonacoEnvironment = {
      getWorkerUrl() {
        const workerSource = `self.MonacoEnvironment={baseUrl:'${MONACO_VS_BASE}/'};importScripts('${MONACO_VS_BASE}/base/worker/workerMain.js');`;
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSource)}`;
      },
    };
    monacoWindow.require.config({ paths: { vs: MONACO_VS_BASE } });
    monacoWindow.require(
      ['vs/editor/editor.main'],
      () => this.createEditor(monacoWindow),
      () => {
        this.status = 'Monaco failed to load. Using textarea fallback.';
      },
    );
  }

  ngOnDestroy(): void {
    this.editor?.dispose();
  }

  updateScript(script: string): void {
    this.store.updateSelectedBehavior({ script });
  }

  private createEditor(monacoWindow: MonacoLoaderWindow): void {
    if (!monacoWindow.monaco) return;

    this.editor = monacoWindow.monaco.editor.create(this.editorHost.nativeElement, {
      value: this.store.selectedElement()?.behavior.script ?? '',
      language: 'typescript',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      tabSize: 2,
      wordWrap: 'on',
      readOnly: !this.store.selectedElement(),
    });
    this.editor.onDidChangeModelContent(() => {
      if (!this.editor || this.suppressChange) return;
      this.updateScript(this.editor.getValue());
    });
    this.editorReady = true;
  }

  private syncEditorValue(script: string): void {
    if (!this.editor || this.editor.getValue() === script) return;
    this.suppressChange = true;
    this.editor.setValue(script);
    this.suppressChange = false;
  }
}
