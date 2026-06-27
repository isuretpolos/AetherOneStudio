import { computed, Injectable, signal } from '@angular/core';
import {
  BackgroundState,
  BehaviorAction,
  DeviceElement,
  DrawingTool,
  EditorMode,
  ElementBehavior,
  ElementType,
  HitArea,
  Point,
  ProjectManifest,
  ProjectPayload,
  ProjectSnapshot,
  ProjectSummary,
  RuntimeState,
  SessionState,
  ZoomLevel,
} from './device.model';

@Injectable({ providedIn: 'root' })
export class DeviceStore {
  readonly mode = signal<EditorMode>('edit');
  readonly tool = signal<DrawingTool>('select');
  readonly zoom = signal<ZoomLevel>('fit');
  readonly status = signal('Draw regions on the panel image.');
  readonly manifest = signal<ProjectManifest>(this.normalizeManifest());
  readonly background = signal<BackgroundState>({ src: 'prototype.jpg', exportSrc: 'prototype.jpg', width: 1280, height: 860 });
  readonly elements = signal<DeviceElement[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly hoveredId = signal<string | null>(null);
  readonly polygonDraft = signal<Point[]>([]);
  readonly session = signal<SessionState>({ mode: 'idle', activeOperation: null, events: [], blockedCount: 0, completed: {} });
  readonly dirty = signal(false);
  readonly undoCount = signal(0);
  readonly redoCount = signal(0);
  readonly selectedElement = computed(() => this.elements().find((element) => element.id === this.selectedId()) ?? null);
  readonly validationMessages = computed(() => this.validateDevice());
  readonly completedSummary = computed(() => {
    const completed = Object.entries(this.session().completed)
      .filter(([, isComplete]) => isComplete)
      .map(([action]) => this.getActionLabel(action as BehaviorAction));
    return completed.length > 0 ? completed.join(', ') : 'None';
  });

  private nextElementNumber = 1;
  private copiedElement: DeviceElement | null = null;
  private lastCanvasPoint: Point | null = null;
  private undoStack: ProjectSnapshot[] = [];
  private redoStack: ProjectSnapshot[] = [];
  private restoring = false;

  setMode(mode: EditorMode): void {
    this.mode.set(mode);
    if (mode === 'simulate') {
      this.tool.set('select');
    }
    this.status.set(mode === 'simulate' ? 'Simulation mode: click marked regions to trigger them.' : 'Edit mode: create and configure regions.');
  }

  setTool(tool: DrawingTool): void {
    this.tool.set(tool);
    if (tool !== 'polygon') {
      this.polygonDraft.set([]);
    }
    this.status.set(tool === 'polygon' ? 'Click points to build a polygon. Double-click to finish it.' : 'Draw regions on the panel image.');
  }

  setZoom(zoom: ZoomLevel): void {
    this.zoom.set(zoom);
  }

  stepZoom(direction: number): void {
    const levels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
    const current = this.zoom() === 'fit' ? 1 : (this.zoom() as number);
    const index = levels.reduce((nearest, level, candidateIndex) => (Math.abs(level - current) < Math.abs(levels[nearest] - current) ? candidateIndex : nearest), 0);
    this.zoom.set(levels[Math.min(levels.length - 1, Math.max(0, index + direction))]);
  }

  setCanvasPointer(point: Point): void {
    this.lastCanvasPoint = point;
  }

  selectElement(id: string | null): void {
    this.selectedId.set(id);
  }

  setHovered(id: string | null): void {
    this.hoveredId.set(id);
  }

  beginHistory(): void {
    this.commitHistory();
  }

  addDraftPolygonPoint(point: Point): void {
    this.polygonDraft.update((points) => [...points, { x: Math.round(point.x), y: Math.round(point.y) }]);
  }

  finishPolygon(): void {
    const points = this.polygonDraft();
    if (points.length < 3) return;
    this.addElement({ shape: 'polygon', points });
    this.polygonDraft.set([]);
  }

  clearPolygonDraft(): void {
    this.polygonDraft.set([]);
  }

  addElement(hitArea: HitArea): void {
    if (!this.isUsefulHitArea(hitArea)) return;
    this.commitHistory();
    const type = this.defaultTypeForShape(hitArea.shape);
    const element: DeviceElement = {
      id: this.nextElementId(hitArea.shape),
      type,
      label: '',
      hitArea: this.clone(hitArea),
      behavior: this.createDefaultBehavior(type),
      runtime: this.createRuntimeState(type),
      states: hitArea.shape === 'rect' ? ['idle', 'active'] : undefined,
      initial: hitArea.shape === 'rect' ? 'idle' : undefined,
    };
    this.elements.update((elements) => [...elements, element]);
    this.selectedId.set(element.id);
    this.setTool('select');
  }

  updateSelected(patch: Partial<DeviceElement>): void {
    const selectedId = this.selectedId();
    if (!selectedId) return;
    this.commitHistory();
    this.elements.update((elements) =>
      elements.map((element) => {
        if (element.id !== selectedId) return element;
        const next = { ...element, ...patch };
        if (patch.id) {
          next.id = this.sanitizeId(patch.id, selectedId);
          this.selectedId.set(next.id);
        }
        return next;
      }),
    );
  }

  updateSelectedType(type: ElementType): void {
    const selected = this.selectedElement();
    if (!selected) return;
    this.updateSelected({
      type,
      behavior: { ...this.createDefaultBehavior(type), script: selected.behavior.script },
      runtime: this.createRuntimeState(type),
    });
  }

  updateSelectedBehavior(patch: Partial<ElementBehavior>): void {
    const selected = this.selectedElement();
    if (!selected) return;
    this.commitHistory();
    const behavior = { ...selected.behavior, ...patch };
    if (patch.providesPower && behavior.providesPower) {
      behavior.requiresPower = false;
    }
    if (patch.requiresPower && behavior.requiresPower) {
      behavior.providesPower = false;
    }
    if (selected.type === 'knob') {
      this.normalizeValueRange(behavior);
      this.normalizeArcRange(behavior);
    }
    this.elements.update((elements) => elements.map((element) => (element.id === selected.id ? { ...element, behavior, runtime: this.clampRuntimeValue({ ...element, behavior }) } : element)));
  }

  moveElement(id: string, hitArea: HitArea, commit = false): void {
    if (commit) this.commitHistory();
    this.elements.update((elements) => elements.map((element) => (element.id === id ? { ...element, hitArea: this.clone(hitArea) } : element)));
  }

  deleteSelected(): void {
    const selectedId = this.selectedId();
    if (!selectedId) return;
    this.commitHistory();
    this.elements.update((elements) => elements.filter((element) => element.id !== selectedId));
    this.selectedId.set(null);
  }

  updateManifest(patch: Partial<ProjectManifest>): void {
    this.commitHistory();
    this.manifest.update((manifest) => this.normalizeManifest({ ...manifest, ...patch }));
  }

  copySelected(): boolean {
    const selected = this.selectedElement();
    if (!selected || this.mode() !== 'edit') return false;
    this.copiedElement = this.serializeElement(selected);
    this.status.set(`Copied ${selected.id}.`);
    return true;
  }

  pasteCopied(): boolean {
    if (!this.copiedElement || this.mode() !== 'edit') return false;
    this.commitHistory();
    const copy = this.clone(this.copiedElement);
    copy.id = this.nextGroupedElementId(copy.id);
    copy.hitArea = this.moveHitAreaToPoint(copy.hitArea, this.lastCanvasPoint ?? this.getHitAreaCenter(copy.hitArea));
    copy.runtime = this.createRuntimeState(copy.type);
    delete copy.flashUntil;
    delete copy.flashKind;
    this.elements.update((elements) => [...elements, copy]);
    this.selectedId.set(copy.id);
    this.status.set(`Pasted ${copy.id}.`);
    return true;
  }

  async importImage(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.status.set('Choose an image file for the panel background.');
      return;
    }
    this.commitHistory();
    const src = URL.createObjectURL(file);
    const exportSrc = await this.fileToDataUrl(file);
    const size = await this.loadImageSize(src);
    this.background.set({ src, exportSrc, width: size.width, height: size.height });
    this.status.set(`Imported image: ${file.name}`);
  }

  async importProject(file: File): Promise<void> {
    const project = JSON.parse(await file.text()) as ProjectPayload;
    this.validateProjectPayload(project);
    this.commitHistory();
    const normalizedElements = this.normalizeElements(project.elements ?? []);
    this.manifest.set(this.normalizeManifest(project.manifest));
    this.elements.set(normalizedElements);
    this.selectedId.set(null);
    this.nextElementNumber = normalizedElements.length + 1;
    this.resetSession();
    this.background.set({
      src: project.background?.src || 'prototype.jpg',
      exportSrc: project.background?.src || 'prototype.jpg',
      width: Number(project.background?.width) || 1280,
      height: Number(project.background?.height) || 860,
    });
    const summary = this.buildProjectSummary(normalizedElements, this.background());
    this.status.set(`Imported ${file.name}: ${summary.elementCount} elements, ${summary.operationCount} operations.`);
  }

  exportProject(): void {
    const background = this.background();
    const payload: ProjectPayload = {
      manifest: this.normalizeManifest(this.manifest()),
      exportedAt: new Date().toISOString(),
      app: {
        name: 'AetherOne Studio',
        format: 'aetherone-device-json',
        formatVersion: 1,
      },
      background: {
        src: background.exportSrc,
        width: background.width,
        height: background.height,
      },
      elements: this.elements().map((element) => this.serializeElement(element)),
    };
    payload.summary = this.buildProjectSummary(payload.elements, background);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.getProjectFileName(payload.manifest);
    link.click();
    URL.revokeObjectURL(url);
    this.dirty.set(false);
    this.status.set(`Exported ${payload.summary.elementCount} elements to ${link.download}.`);
  }

  triggerElement(element: DeviceElement, direction = 1): void {
    this.selectedId.set(element.id);
    const current = this.elements().find((item) => item.id === element.id);
    if (!current) return;
    const ruleResult = this.evaluateRules(current);
    if (!ruleResult.allowed) {
      this.blockElement(current, ruleResult.reason);
      return;
    }

    const operationHandled = this.applyBehaviorAction(current);
    let runtime = current.runtime ?? this.createRuntimeState(current.type);
    let detail = 'Momentary action triggered.';
    if (operationHandled) {
      if (current.type === 'toggle' || current.type === 'led') {
        runtime = { ...runtime, on: !runtime.on };
      } else if (current.type === 'display') {
        runtime = { ...runtime, text: this.getRuntimeSummary(current).toUpperCase() };
      } else if (typeof runtime.value === 'number') {
        runtime = this.adjustValueRuntime({ ...current, runtime }, direction);
      } else if (current.type === 'button') {
        runtime = { ...runtime, presses: (runtime.presses || 0) + 1 };
      }
      detail = `${this.getActionLabel(current.behavior.action)} triggered.`;
    } else if (current.type === 'toggle') {
      runtime = { ...runtime, on: !runtime.on };
      this.session.update((session) => ({ ...session, mode: runtime.on ? 'powered' : 'idle' }));
      detail = runtime.on ? 'Switched on.' : 'Switched off.';
    } else if (current.type === 'well') {
      runtime = { ...runtime, hasContent: !runtime.hasContent };
      detail = runtime.hasContent ? 'Virtual content placed.' : 'Virtual content removed.';
    } else if (current.type === 'knob' || current.type === 'slider' || current.type === 'meter' || current.type === 'resonance') {
      runtime = this.adjustValueRuntime({ ...current, runtime }, direction);
      detail = current.type === 'knob' ? `Value set to ${runtime.value}.` : `Level set to ${runtime.value}.`;
    } else if (current.type === 'led') {
      runtime = { ...runtime, on: !runtime.on };
      detail = runtime.on ? 'Indicator lit.' : 'Indicator cleared.';
    } else if (current.type === 'display') {
      runtime = { ...runtime, text: runtime.text === 'READY' ? 'ACTIVE' : 'READY' };
      detail = `Display changed to ${runtime.text}.`;
    } else {
      runtime = { ...runtime, presses: (runtime.presses || 0) + 1 };
    }

    this.elements.update((elements) => elements.map((item) => (item.id === current.id ? { ...item, runtime, flashUntil: Date.now() + 260, flashKind: 'active' } : item)));
    this.logEvent({ ...current, runtime }, detail);
    this.status.set(`${current.label || current.id}: ${this.getRuntimeSummary({ ...current, runtime })}`);
    window.setTimeout(() => this.clearFlash(current.id), 280);
  }

  handleSimulationKey(key: string): boolean {
    if (this.mode() !== 'simulate' || !['+', '=', '-', '_'].includes(key)) return false;
    const hovered = this.elements().find((element) => element.id === this.hoveredId());
    if (!hovered || hovered.type !== 'knob') return false;
    this.triggerElement(hovered, key === '-' || key === '_' ? -1 : 1);
    return true;
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    const current = this.getProjectSnapshot();
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(current);
    this.restoreProjectSnapshot(snapshot);
    this.dirty.set(true);
    this.status.set('Undo applied.');
    this.updateHistoryCounts();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    const current = this.getProjectSnapshot();
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(current);
    this.restoreProjectSnapshot(snapshot);
    this.dirty.set(true);
    this.status.set('Redo applied.');
    this.updateHistoryCounts();
  }

  resetSession(): void {
    this.session.set({ mode: 'idle', activeOperation: null, events: [], blockedCount: 0, completed: {} });
    this.elements.update((elements) => elements.map((element) => ({ ...element, runtime: this.createRuntimeState(element.type), flashUntil: undefined, flashKind: undefined })));
    this.status.set(this.mode() === 'simulate' ? 'Simulation reset.' : 'Session reset.');
  }

  createDefaultBehavior(type: ElementType): ElementBehavior {
    const providesPower = type === 'toggle' && !this.getPowerProvider();
    return {
      action: 'default',
      providesPower,
      requiresPower: !providesPower,
      requiresWell: type === 'button' || type === 'meter' || type === 'resonance',
      rotateGraphics: false,
      transformGraphics: false,
      transformVertical: false,
      showValue: true,
      min: this.getDefaultMin(type),
      max: this.getDefaultMax(type),
      arcMin: this.getDefaultArcMin(type),
      arcMax: this.getDefaultArcMax(type),
      step: this.getDefaultStep(type),
      script: '',
    };
  }

  createRuntimeState(type: ElementType): RuntimeState {
    if (type === 'toggle' || type === 'led') return { on: false };
    if (type === 'well') return { hasContent: false };
    if (type === 'display') return { text: 'READY' };
    if (type === 'knob' || type === 'slider' || type === 'meter' || type === 'resonance') return { value: 0 };
    return { presses: 0 };
  }

  getRuntimeSummary(element: DeviceElement): string {
    const runtime = element.runtime || this.createRuntimeState(element.type);
    if (element.type === 'toggle' || element.type === 'led') return runtime.on ? 'on' : 'off';
    if (element.type === 'well') return runtime.hasContent ? 'occupied' : 'empty';
    if (element.type === 'display') return runtime.text || 'READY';
    if (element.type === 'knob') return String(this.clampNumber(Number(runtime.value), this.getBehaviorMin(element), this.getBehaviorMax(element), this.getBehaviorMin(element)));
    if (typeof runtime.value === 'number') return `${runtime.value}%`;
    return 'triggered';
  }

  getKnobRotationDegrees(element: DeviceElement): number {
    const min = this.getBehaviorMin(element);
    const max = this.getBehaviorMax(element);
    const value = this.clampNumber(Number(element.runtime?.value), min, max, min);
    const ratio = max === min ? 0 : (value - min) / (max - min);
    return this.getBehaviorArcMin(element) + ratio * (this.getBehaviorArcMax(element) - this.getBehaviorArcMin(element));
  }

  getHitAreaCenter(hitArea: HitArea): Point {
    if (hitArea.shape === 'rect') return { x: hitArea.x + hitArea.w / 2, y: hitArea.y + hitArea.h / 2 };
    if (hitArea.shape === 'circle') return { x: hitArea.x, y: hitArea.y };
    const sum = hitArea.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / hitArea.points.length, y: sum.y / hitArea.points.length };
  }

  getHitAreaAnchor(hitArea: HitArea): Point {
    if (hitArea.shape === 'rect') return { x: hitArea.x + hitArea.w / 2, y: hitArea.y };
    if (hitArea.shape === 'circle') return { x: hitArea.x, y: hitArea.y - hitArea.radius };
    const center = this.getHitAreaCenter(hitArea);
    return center;
  }

  moveHitArea(hitArea: HitArea, dx: number, dy: number): HitArea {
    if (hitArea.shape === 'rect') return { ...hitArea, x: Math.round(hitArea.x + dx), y: Math.round(hitArea.y + dy) };
    if (hitArea.shape === 'circle') return { ...hitArea, x: Math.round(hitArea.x + dx), y: Math.round(hitArea.y + dy) };
    return { ...hitArea, points: hitArea.points.map((point) => ({ x: Math.round(point.x + dx), y: Math.round(point.y + dy) })) };
  }

  buildProjectSummary(elements = this.elements(), background = this.background()): ProjectSummary {
    const typeCounts: Record<string, number> = {};
    const operationCounts: Record<string, number> = {};
    const powerProviderIds: string[] = [];
    let requiresPowerCount = 0;
    let requiresWellCount = 0;
    elements.forEach((element) => {
      typeCounts[element.type] = (typeCounts[element.type] || 0) + 1;
      if (element.behavior.action !== 'default') {
        operationCounts[element.behavior.action] = (operationCounts[element.behavior.action] || 0) + 1;
      }
      if (element.behavior.providesPower) powerProviderIds.push(element.id);
      if (element.behavior.requiresPower) requiresPowerCount += 1;
      if (element.behavior.requiresWell) requiresWellCount += 1;
    });
    return {
      elementCount: elements.length,
      operationCount: Object.values(operationCounts).reduce((total, count) => total + count, 0),
      typeCounts,
      operationCounts,
      powerProviderIds,
      requiresPowerCount,
      requiresWellCount,
      canvas: { width: background.width, height: background.height },
    };
  }

  private applyBehaviorAction(element: DeviceElement): boolean {
    const action = element.behavior.action;
    if (action === 'default') return false;
    if (action === 'scan') {
      this.session.update((session) => ({ ...session, mode: 'scanning', activeOperation: action }));
      this.logEvent(element, 'Scan started.');
      return true;
    }
    if (action === 'diagnosis') {
      this.session.update((session) => ({ ...session, mode: session.mode === 'diagnosis' ? this.getPoweredSessionMode() : 'diagnosis', activeOperation: session.mode === 'diagnosis' ? null : action }));
      this.logEvent(element, this.session().mode === 'diagnosis' ? 'Diagnosis mode started.' : 'Diagnosis completed.');
      return true;
    }
    if (action === 'broadcast') {
      const completing = this.getActiveOperation() === action;
      this.session.update((session) => ({
        ...session,
        mode: completing ? this.getPoweredSessionMode() : 'broadcasting',
        activeOperation: completing ? null : action,
        completed: completing ? { ...session.completed, broadcast: true } : session.completed,
      }));
      this.logEvent(element, completing ? 'Broadcast completed.' : 'Broadcast started.');
      return true;
    }
    if (action === 'neutralize') {
      const completing = this.getActiveOperation() === action;
      this.session.update((session) => ({
        ...session,
        mode: completing ? this.getPoweredSessionMode() : 'neutralizing',
        activeOperation: completing ? null : action,
        completed: { ...session.completed, neutralize: completing || session.completed.neutralize },
      }));
      this.logEvent(element, completing ? 'Neutralize completed.' : 'Neutralize sequence started.');
      return true;
    }
    if (action === 'custom') {
      this.logEvent(element, 'Custom event triggered.');
      return true;
    }
    return false;
  }

  private evaluateRules(element: DeviceElement): { allowed: true } | { allowed: false; reason: string } {
    const action = element.behavior.action;
    const isPowerProvider = Boolean(element.behavior.providesPower);
    if (isPowerProvider) {
      if (element.runtime?.on) {
        const activeOperation = this.getActiveOperation();
        if (activeOperation) return { allowed: false, reason: `Complete ${this.getActionLabel(activeOperation)} before switching power off.` };
        if (this.hasLoadedWell()) return { allowed: false, reason: 'Clear loaded wells before switching power off.' };
      }
      return { allowed: true };
    }
    if (this.elements().length === 1 && action === 'default') return { allowed: true };
    const requiresPower = Boolean(element.behavior.requiresPower);
    const powerToggle = this.getPowerProvider();
    if ((requiresPower || action !== 'default') && !powerToggle) return { allowed: false, reason: 'No power source is configured.' };
    if ((requiresPower || action !== 'default') && !powerToggle?.runtime?.on) return { allowed: false, reason: 'Power is off.' };
    if (element.behavior.requiresWell && this.hasAnyWell() && !this.hasLoadedWell()) return { allowed: false, reason: 'Load a well before this operation.' };
    const activeOperation = this.getActiveOperation();
    const completingOperation = action !== 'default' && activeOperation === action;
    const interruptingOperation = action !== 'default' && activeOperation && !completingOperation;
    if (interruptingOperation && !(activeOperation === 'broadcast' && action === 'neutralize')) {
      return { allowed: false, reason: `Complete ${this.getActionLabel(activeOperation)} before starting ${this.getActionLabel(action)}.` };
    }
    if (action === 'broadcast' && this.session().mode === 'diagnosis') return { allowed: false, reason: 'Broadcast is blocked during diagnosis.' };
    if (action === 'neutralize' && this.session().mode !== 'broadcasting' && !this.session().completed.broadcast) {
      return { allowed: false, reason: 'Start or complete broadcast before neutralizing.' };
    }
    if (this.session().mode === 'blocked') {
      this.session.update((session) => ({ ...session, mode: powerToggle?.runtime?.on ? 'powered' : 'idle' }));
    }
    return { allowed: true };
  }

  private blockElement(element: DeviceElement, reason: string): void {
    this.session.update((session) => ({ ...session, blockedCount: session.blockedCount + 1, mode: 'blocked' }));
    this.logEvent(element, reason, 'blocked');
    this.elements.update((elements) => elements.map((item) => (item.id === element.id ? { ...item, flashUntil: Date.now() + 260, flashKind: 'blocked' } : item)));
    this.status.set(`${element.label || element.id}: blocked - ${reason}`);
    window.setTimeout(() => this.clearFlash(element.id), 280);
  }

  private clearFlash(id: string): void {
    this.elements.update((elements) => elements.map((element) => (element.id === id ? { ...element, flashUntil: undefined, flashKind: undefined } : element)));
  }

  private logEvent(element: DeviceElement, detail: string, kind: 'info' | 'blocked' = 'info'): void {
    const now = new Date();
    this.session.update((session) => ({
      ...session,
      events: [
        {
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          label: element.label || element.id,
          detail,
          kind,
        },
        ...session.events,
      ].slice(0, 100),
    }));
  }

  private validateDevice(): string[] {
    const messages: string[] = [];
    const ids = new Map<string, number>();
    if (this.elements().length === 0) messages.push('Add at least one interactive region.');
    if (!this.manifest().name.trim()) messages.push('Add a project name before export.');
    if (!this.manifest().version.trim()) messages.push('Add a project version before export.');
    this.elements().forEach((element) => {
      const id = element.id.trim();
      ids.set(id, (ids.get(id) || 0) + 1);
      if (!id) messages.push('Every element needs an ID.');
      if (!this.isUsefulHitArea(element.hitArea)) messages.push(`${element.id || 'Unnamed element'} has a region that is too small.`);
      if (element.type === 'knob' && this.getBehaviorMax(element) <= this.getBehaviorMin(element)) messages.push(`${element.id || 'Unnamed knob'} needs a max value greater than min.`);
    });
    if (this.elements().some((element) => element.behavior.requiresPower) && !this.getPowerProvider()) {
      messages.push('Mark one toggle as a power provider before requiring power on other elements.');
    }
    if (this.elements().some((element) => element.behavior.requiresWell) && !this.elements().some((element) => element.type === 'well')) {
      messages.push('Add a well element for actions that require loaded well content.');
    }
    if (this.elements().some((element) => element.behavior.action !== 'default') && !this.getPowerProvider()) {
      messages.push('Add a power provider for operation-oriented simulation.');
    }
    ids.forEach((count, id) => {
      if (id && count > 1) messages.push(`Duplicate element ID: ${id}.`);
    });
    return messages;
  }

  private commitHistory(): void {
    if (this.restoring) return;
    const snapshot = this.getProjectSnapshot();
    const previous = this.undoStack.at(-1);
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.dirty.set(true);
    this.updateHistoryCounts();
  }

  private getProjectSnapshot(): ProjectSnapshot {
    return {
      manifest: this.normalizeManifest(this.manifest()),
      background: this.clone(this.background()),
      elements: this.elements().map((element) => this.serializeElement(element)),
      selectedId: this.selectedId(),
      nextElementNumber: this.nextElementNumber,
    };
  }

  private restoreProjectSnapshot(snapshot: ProjectSnapshot): void {
    this.restoring = true;
    this.manifest.set(this.normalizeManifest(snapshot.manifest));
    this.background.set(this.clone(snapshot.background));
    this.elements.set(this.normalizeElements(snapshot.elements));
    this.selectedId.set(snapshot.selectedId);
    this.nextElementNumber = snapshot.nextElementNumber;
    this.restoring = false;
  }

  private updateHistoryCounts(): void {
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
  }

  private normalizeElements(elements: DeviceElement[]): DeviceElement[] {
    let hasPowerProvider = false;
    return (Array.isArray(elements) ? elements : []).map((element) => {
      const normalized = this.normalizeElement(element, hasPowerProvider);
      hasPowerProvider = hasPowerProvider || normalized.behavior.providesPower;
      return normalized;
    });
  }

  private normalizeElement(element: Partial<DeviceElement>, hasPowerProvider: boolean): DeviceElement {
    const type = element.type || 'button';
    const rawBehavior = element.behavior || {};
    const hasExplicitPowerProvider = Object.hasOwn(rawBehavior, 'providesPower');
    const behavior = { ...this.createDefaultBehavior(type), ...rawBehavior };
    behavior.script = typeof behavior.script === 'string' ? behavior.script : '';
    if (type === 'knob') {
      this.normalizeValueRange(behavior);
      this.normalizeArcRange(behavior);
    }
    if (type === 'toggle' && !hasExplicitPowerProvider) {
      behavior.providesPower = !hasPowerProvider;
      behavior.requiresPower = hasPowerProvider;
    }
    return {
      id: element.id || this.nextElementId('element'),
      label: typeof element.label === 'string' ? element.label : '',
      type,
      hitArea: element.hitArea ? this.clone(element.hitArea) : { shape: 'rect', x: 0, y: 0, w: 80, h: 40 },
      behavior,
      runtime: this.createRuntimeState(type),
      states: element.states,
      initial: element.initial,
    };
  }

  private serializeElement(element: DeviceElement): DeviceElement {
    const { flashUntil, flashKind, ...projectElement } = element;
    return this.clone(projectElement);
  }

  private validateProjectPayload(project: ProjectPayload): void {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Project JSON must contain an object.');
    if (!Array.isArray(project.elements)) throw new Error('Project JSON must contain an elements array.');
    project.elements.forEach((element, index) => {
      if (!element || typeof element !== 'object') throw new Error(`Element ${index + 1} is not an object.`);
      if (!element.hitArea || !element.hitArea.shape) throw new Error(`${element.id || `Element ${index + 1}`} is missing a hit area.`);
    });
  }

  private normalizeManifest(manifest: Partial<ProjectManifest> = {}): ProjectManifest {
    return {
      name: manifest.name || 'AetherOne Studio Device',
      author: manifest.author || '',
      version: manifest.version || '0.1.0',
      formatVersion: Number(manifest.formatVersion) || 1,
      description: manifest.description || '',
    };
  }

  private adjustValueRuntime(element: DeviceElement, direction = 1): RuntimeState {
    const runtime = element.runtime || this.createRuntimeState(element.type);
    const min = this.getBehaviorMin(element);
    const max = this.getBehaviorMax(element);
    return { ...runtime, value: this.clampNumber(Number(runtime.value) + this.getBehaviorStep(element) * direction, min, max, min) };
  }

  private clampRuntimeValue(element: DeviceElement): RuntimeState {
    const runtime = element.runtime || this.createRuntimeState(element.type);
    if (typeof runtime.value !== 'number') return runtime;
    return { ...runtime, value: this.clampNumber(runtime.value, this.getBehaviorMin(element), this.getBehaviorMax(element), this.getBehaviorMin(element)) };
  }

  private getBehaviorStep(element: DeviceElement): number {
    const range = this.getBehaviorMax(element) - this.getBehaviorMin(element);
    return this.clampNumber(Number(element.behavior.step), 1, Math.max(1, range), this.getDefaultStep(element.type));
  }

  private getBehaviorMin(element: DeviceElement): number {
    return Number.isFinite(Number(element.behavior.min)) ? Number(element.behavior.min) : this.getDefaultMin(element.type);
  }

  private getBehaviorMax(element: DeviceElement): number {
    return Number.isFinite(Number(element.behavior.max)) ? Number(element.behavior.max) : this.getDefaultMax(element.type);
  }

  private getBehaviorArcMin(element: DeviceElement): number {
    return Number.isFinite(Number(element.behavior.arcMin)) ? Number(element.behavior.arcMin) : this.getDefaultArcMin(element.type);
  }

  private getBehaviorArcMax(element: DeviceElement): number {
    return Number.isFinite(Number(element.behavior.arcMax)) ? Number(element.behavior.arcMax) : this.getDefaultArcMax(element.type);
  }

  private normalizeValueRange(behavior: ElementBehavior): void {
    behavior.min = Number.isFinite(Number(behavior.min)) ? Math.round(Number(behavior.min)) : 0;
    behavior.max = Number.isFinite(Number(behavior.max)) ? Math.round(Number(behavior.max)) : 100;
    if (behavior.max <= behavior.min) behavior.max = behavior.min + 1;
    behavior.step = this.clampNumber(Number(behavior.step), 1, Math.max(1, behavior.max - behavior.min), 10);
  }

  private normalizeArcRange(behavior: ElementBehavior): void {
    behavior.arcMin = Number.isFinite(Number(behavior.arcMin)) ? Math.round(Number(behavior.arcMin)) : 0;
    behavior.arcMax = Number.isFinite(Number(behavior.arcMax)) ? Math.round(Number(behavior.arcMax)) : 270;
    if (behavior.arcMax === behavior.arcMin) behavior.arcMax = behavior.arcMin + 1;
  }

  private getPowerProvider(except: DeviceElement | null = null): DeviceElement | undefined {
    return this.elements().find((element) => element !== except && element.behavior.providesPower);
  }

  private hasAnyWell(): boolean {
    return this.elements().some((element) => element.type === 'well');
  }

  private hasLoadedWell(): boolean {
    return this.elements().some((element) => element.type === 'well' && element.runtime?.hasContent);
  }

  private getActiveOperation(): BehaviorAction | null {
    if (this.session().activeOperation) return this.session().activeOperation;
    const modes: Partial<Record<string, BehaviorAction>> = {
      scanning: 'scan',
      diagnosis: 'diagnosis',
      broadcasting: 'broadcast',
      neutralizing: 'neutralize',
    };
    return modes[this.session().mode] || null;
  }

  private getPoweredSessionMode(): 'powered' | 'idle' {
    return this.getPowerProvider()?.runtime?.on ? 'powered' : 'idle';
  }

  private getActionLabel(action: BehaviorAction): string {
    const labels: Record<BehaviorAction, string> = {
      default: 'Default',
      scan: 'Scan',
      diagnosis: 'Diagnosis',
      broadcast: 'Broadcast',
      neutralize: 'Neutralize',
      custom: 'Custom',
    };
    return labels[action] || this.titleCase(action);
  }

  private defaultTypeForShape(shape: HitArea['shape']): ElementType {
    if (shape === 'circle') return 'well';
    if (shape === 'polygon') return 'display';
    return 'button';
  }

  private getDefaultStep(type: ElementType): number {
    if (type === 'knob') return 10;
    if (type === 'slider' || type === 'meter' || type === 'resonance') return 20;
    return 1;
  }

  private getDefaultMin(_type: ElementType): number {
    return 0;
  }

  private getDefaultMax(_type: ElementType): number {
    return 100;
  }

  private getDefaultArcMin(_type: ElementType): number {
    return 0;
  }

  private getDefaultArcMax(_type: ElementType): number {
    return 270;
  }

  private isUsefulHitArea(hitArea: HitArea): boolean {
    if (hitArea.shape === 'rect') return hitArea.w > 8 && hitArea.h > 8;
    if (hitArea.shape === 'circle') return hitArea.radius > 6;
    return hitArea.points.length >= 3;
  }

  private moveHitAreaToPoint(hitArea: HitArea, point: Point): HitArea {
    const center = this.getHitAreaCenter(hitArea);
    return this.moveHitArea(hitArea, point.x - center.x, point.y - center.y);
  }

  private nextElementId(prefix: string): string {
    let id = '';
    do {
      id = `${prefix}${this.nextElementNumber}`;
      this.nextElementNumber += 1;
    } while (this.elements().some((element) => element.id === id));
    return id;
  }

  private nextGroupedElementId(id: string): string {
    const parsed = this.parseElementIdGroup(id);
    const highest = this.elements().reduce((max, element) => {
      const candidate = this.parseElementIdGroup(element.id);
      return candidate.prefix === parsed.prefix ? Math.max(max, candidate.number) : max;
    }, 0);
    return `${parsed.prefix}${highest + 1}`;
  }

  private parseElementIdGroup(id: string): { prefix: string; number: number } {
    const match = String(id || 'ELEMENT').match(/^(.*?)(\d+)$/);
    if (match) return { prefix: match[1] || 'ELEMENT', number: Number(match[2]) };
    return { prefix: String(id || 'ELEMENT'), number: 0 };
  }

  private sanitizeId(value: string, fallback: string): string {
    const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || fallback || this.nextElementId('element');
  }

  private getProjectFileName(manifest: ProjectManifest): string {
    return `${this.slugify(manifest.name || 'aetherone-device')}-${this.slugify(manifest.version || '0.1.0')}.json`;
  }

  private slugify(value: string): string {
    return (
      String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'aetherone-device'
    );
  }

  private clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  private titleCase(value: string): string {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }

  private async fileToDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
      reader.addEventListener('error', () => reject(reader.error), { once: true });
      reader.readAsDataURL(file);
    });
  }

  private async loadImageSize(src: string): Promise<{ width: number; height: number }> {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve({ width: image.naturalWidth || 1280, height: image.naturalHeight || 860 }), { once: true });
      image.addEventListener('error', () => reject(new Error('Could not load image.')), { once: true });
      image.src = src;
    });
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
