import { Component, HostListener, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeviceStageComponent } from './device-stage.component';
import { DeviceStore } from './device-store.service';
import { BehaviorAction, ElementBehavior, ElementType } from './device.model';
import { ScriptEditorComponent } from './script-editor.component';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DeviceStageComponent, ScriptEditorComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly store = inject(DeviceStore);
  readonly selected = this.store.selectedElement;
  readonly canEditRange = computed(() => this.selected()?.type === 'knob');

  readonly elementTypes: Array<{ value: ElementType; label: string }> = [
    { value: 'button', label: 'Button' },
    { value: 'toggle', label: 'Toggle switch' },
    { value: 'knob', label: 'Rotary knob' },
    { value: 'slider', label: 'Slider' },
    { value: 'led', label: 'LED' },
    { value: 'meter', label: 'Meter' },
    { value: 'well', label: 'Well' },
    { value: 'display', label: 'Text display' },
    { value: 'resonance', label: 'Resonance indicator' },
  ];
  readonly actions: Array<{ value: BehaviorAction; label: string }> = [
    { value: 'default', label: 'Default interaction' },
    { value: 'scan', label: 'Scan' },
    { value: 'diagnosis', label: 'Diagnosis' },
    { value: 'broadcast', label: 'Broadcast' },
    { value: 'neutralize', label: 'Neutralize' },
    { value: 'custom', label: 'Custom event' },
  ];

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.store.redo() : this.store.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.store.redo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (this.store.copySelected()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      if (this.store.pasteCopied()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.store.deleteSelected();
    }
  }

  updateSelectedId(id: string): void {
    this.store.updateSelected({ id: id.replace(/[^a-zA-Z0-9_-]/g, '') });
  }

  updateSelectedType(type: ElementType): void {
    this.store.updateSelectedType(type);
  }

  updateBehavior<K extends keyof ElementBehavior>(key: K, value: ElementBehavior[K]): void {
    this.store.updateSelectedBehavior({ [key]: value } as Partial<ElementBehavior>);
  }

  async importImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.store.importImage(file);
    input.value = '';
  }

  async importProject(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.store.importProject(file);
    input.value = '';
  }
}
