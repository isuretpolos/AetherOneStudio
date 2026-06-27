import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import Konva from 'konva';
import { DeviceStore } from './device-store.service';
import { DeviceElement, HitArea, Point } from './device.model';

@Component({
  selector: 'app-device-stage',
  template: '<div #stageHost class="stage-host"></div>',
  styles: `
    :host,
    .stage-host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
  `,
})
export class DeviceStageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stageHost', { static: true }) private readonly stageHost!: ElementRef<HTMLDivElement>;

  private readonly store = inject(DeviceStore);
  private stage?: Konva.Stage;
  private backgroundLayer?: Konva.Layer;
  private elementLayer?: Konva.Layer;
  private overlayLayer?: Konva.Layer;
  private world?: Konva.Group;
  private overlayWorld?: Konva.Group;
  private transformer?: Konva.Transformer;
  private backgroundImage?: HTMLImageElement;
  private draft: { shape: 'rect' | 'circle'; start: Point; end: Point } | null = null;
  private backgroundNode?: Konva.Image;
  private selectedNode?: Konva.Shape;
  private readonly resizeObserver = new ResizeObserver(() => this.resizeStage());

  constructor() {
    effect(() => {
      this.store.background();
      this.loadBackground();
    });
    effect(() => {
      this.store.elements();
      this.store.selectedId();
      this.store.mode();
      this.store.polygonDraft();
      this.store.zoom();
      this.renderAll();
    });
  }

  ngAfterViewInit(): void {
    const host = this.stageHost.nativeElement;
    this.stage = new Konva.Stage({ container: host, width: host.clientWidth, height: host.clientHeight });
    this.backgroundLayer = new Konva.Layer();
    this.elementLayer = new Konva.Layer();
    this.overlayLayer = new Konva.Layer();
    this.world = new Konva.Group();
    this.overlayWorld = new Konva.Group();
    this.transformer = new Konva.Transformer({ rotateEnabled: false, ignoreStroke: true });
    this.backgroundLayer.add(this.world);
    this.overlayLayer.add(this.overlayWorld);
    this.overlayLayer.add(this.transformer);
    this.stage.add(this.backgroundLayer, this.elementLayer, this.overlayLayer);
    this.stage.on('pointerdown', (event) => this.onPointerDown(event));
    this.stage.on('pointermove', () => this.onPointerMove());
    this.stage.on('pointerup', () => this.onPointerUp());
    this.stage.on('pointerleave', () => this.onPointerLeave());
    this.stage.on('dblclick dbltap', () => this.store.finishPolygon());
    this.stage.container().addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.stage.container().addEventListener('contextmenu', (event) => this.onContextMenu(event));
    this.resizeObserver.observe(host);
    this.loadBackground();
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
    this.stage?.destroy();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.isTextInput(event.target)) return;
    if (this.store.mode() === 'edit' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (this.store.copySelected()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (this.store.mode() === 'edit' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      if (this.store.pasteCopied()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (this.store.handleSimulationKey(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  private loadBackground(): void {
    if (!this.stage) return;
    const source = this.store.background().src;
    const image = new Image();
    image.onload = () => {
      this.backgroundImage = image;
      this.renderAll();
    };
    image.src = source;
  }

  private renderAll(): void {
    if (!this.stage || !this.world || !this.overlayWorld || !this.backgroundLayer || !this.elementLayer || !this.overlayLayer) return;
    this.applyViewport();
    this.renderBackground();
    this.renderElements();
    this.renderDrafts();
  }

  private applyViewport(): void {
    if (!this.stage || !this.world || !this.overlayWorld) return;
    const background = this.store.background();
    const fitScale = Math.min(this.stage.width() / background.width, this.stage.height() / background.height, 1);
    const scale = this.store.zoom() === 'fit' ? fitScale : (this.store.zoom() as number);
    const x = (this.stage.width() - background.width * scale) / 2;
    const y = (this.stage.height() - background.height * scale) / 2;
    for (const group of [this.world, this.overlayWorld]) {
      group.position({ x, y });
      group.scale({ x: scale, y: scale });
    }
  }

  private renderBackground(): void {
    if (!this.world || !this.backgroundLayer || !this.backgroundImage) return;
    this.world.destroyChildren();
    const background = this.store.background();
    this.backgroundNode = new Konva.Image({ image: this.backgroundImage, x: 0, y: 0, width: background.width, height: background.height, listening: false });
    this.world.add(this.backgroundNode);
    this.backgroundLayer.batchDraw();
  }

  private renderElements(): void {
    if (!this.elementLayer || !this.overlayLayer || !this.transformer) return;
    this.elementLayer.destroyChildren();
    const elementWorld = new Konva.Group(this.worldTransform());
    const selectedId = this.store.selectedId();
    const nodesById = new Map<string, Konva.Node>();

    this.store.elements().forEach((element) => {
      const group = new Konva.Group({ name: element.id });
      this.addGraphicTransform(group, element);
      const shape = this.createHitShape(element);
      shape.on('pointerdown', (event) => {
        event.cancelBubble = true;
        this.onElementPointerDown(element, event);
      });
      shape.on('pointerover', () => this.store.setHovered(element.id));
      shape.on('pointerout', () => this.store.setHovered(null));
      shape.on('dragstart', () => this.store.beginHistory());
      shape.on('dragend', () => this.updateElementFromShape(element, shape));
      group.add(shape);
      this.addLabel(group, element);
      this.addRuntimeValue(group, element);
      elementWorld.add(group);
      nodesById.set(element.id, shape);
    });

    this.elementLayer.add(elementWorld);
    const selectedNode = selectedId ? nodesById.get(selectedId) : undefined;
    this.selectedNode = selectedNode instanceof Konva.Shape ? selectedNode : undefined;
    this.transformer.nodes(this.selectedNode && this.store.mode() === 'edit' ? [this.selectedNode] : []);
    this.transformer.off('transformstart.aether transformend.aether');
    this.transformer.on('transformstart.aether', () => this.store.beginHistory());
    this.transformer.on('transformend.aether', () => {
      const selected = this.store.selectedElement();
      if (!selected || !this.selectedNode) return;
      this.updateElementFromShape(selected, this.selectedNode);
    });
    this.addPolygonVertexHandles();
    this.elementLayer.batchDraw();
    this.overlayLayer.batchDraw();
  }

  private renderDrafts(): void {
    if (!this.overlayWorld || !this.overlayLayer) return;
    this.overlayWorld.destroyChildren();
    if (this.draft) {
      this.overlayWorld.add(this.createDraftShape(this.draft));
    }
    const polygon = this.store.polygonDraft();
    if (polygon.length > 0) {
      this.overlayWorld.add(
        new Konva.Line({
          points: polygon.flatMap((point) => [point.x, point.y]),
          stroke: '#f2b84b',
          strokeWidth: 2,
          dash: [8, 6],
          closed: false,
        }),
      );
      polygon.forEach((point) => this.overlayWorld?.add(new Konva.Circle({ x: point.x, y: point.y, radius: 4, fill: '#f2b84b' })));
    }
    this.addPolygonVertexHandles();
    this.overlayLayer.batchDraw();
  }

  private addPolygonVertexHandles(): void {
    if (!this.overlayWorld || this.store.mode() !== 'edit') return;
    const selected = this.store.selectedElement();
    if (!selected || selected.hitArea.shape !== 'polygon') return;
    selected.hitArea.points.forEach((point, index) => {
      const handle = new Konva.Rect({
        x: point.x - 5,
        y: point.y - 5,
        width: 10,
        height: 10,
        fill: '#f2b84b',
        stroke: '#07090b',
        strokeWidth: 2,
        draggable: true,
      });
      handle.on('dragstart', () => this.store.beginHistory());
      handle.on('dragend', () => {
        const points = selected.hitArea.shape === 'polygon' ? selected.hitArea.points.map((vertex, vertexIndex) => (vertexIndex === index ? { x: Math.round(handle.x() + 5), y: Math.round(handle.y() + 5) } : vertex)) : [];
        this.store.moveElement(selected.id, { shape: 'polygon', points });
      });
      this.overlayWorld?.add(handle);
    });
  }

  private createHitShape(element: DeviceElement): Konva.Shape {
    const active = Boolean(element.flashUntil && element.flashUntil > Date.now());
    const blocked = element.flashKind === 'blocked';
    const selected = element.id === this.store.selectedId();
    const style = {
      stroke: active ? (blocked ? '#e05f5f' : '#fff4a3') : selected ? '#f2b84b' : this.getElementStroke(element),
      strokeWidth: selected ? 3 : 2,
      fill: active ? (blocked ? 'rgba(224,95,95,0.26)' : 'rgba(255,244,163,0.26)') : selected ? 'rgba(242,184,75,0.18)' : this.getElementFill(element),
      draggable: this.store.mode() === 'edit',
      listening: true,
    };
    if (element.hitArea.shape === 'circle') return new Konva.Circle({ ...style, x: element.hitArea.x, y: element.hitArea.y, radius: element.hitArea.radius });
    if (element.hitArea.shape === 'polygon') return new Konva.Line({ ...style, points: element.hitArea.points.flatMap((point) => [point.x, point.y]), closed: true });
    return new Konva.Rect({ ...style, x: element.hitArea.x, y: element.hitArea.y, width: element.hitArea.w, height: element.hitArea.h });
  }

  private addGraphicTransform(group: Konva.Group, element: DeviceElement): void {
    if (!this.backgroundImage) return;
    if (element.type === 'knob' && element.behavior.rotateGraphics) {
      const center = this.store.getHitAreaCenter(element.hitArea);
      const clip = this.clipConfig(element.hitArea);
      const clipGroup = new Konva.Group(clip);
      const transformGroup = new Konva.Group({
        x: center.x,
        y: center.y,
        rotation: this.store.getKnobRotationDegrees(element),
        listening: false,
      });
      const image = new Konva.Image({
        image: this.backgroundImage,
        x: -center.x,
        y: -center.y,
        width: this.store.background().width,
        height: this.store.background().height,
        listening: false,
      });
      transformGroup.add(image);
      clipGroup.add(transformGroup);
      group.add(clipGroup);
    }
    if (this.store.mode() === 'simulate' && element.type === 'toggle' && element.behavior.transformGraphics && element.runtime.on) {
      const center = this.store.getHitAreaCenter(element.hitArea);
      const clipGroup = new Konva.Group(this.clipConfig(element.hitArea));
      const transformGroup = new Konva.Group({
        x: center.x,
        y: center.y,
        scaleX: element.behavior.transformVertical ? 1 : -1,
        scaleY: element.behavior.transformVertical ? -1 : 1,
        listening: false,
      });
      const image = new Konva.Image({
        image: this.backgroundImage,
        x: -center.x,
        y: -center.y,
        width: this.store.background().width,
        height: this.store.background().height,
        listening: false,
      });
      transformGroup.add(image);
      clipGroup.add(transformGroup);
      group.add(clipGroup);
    }
  }

  private addLabel(group: Konva.Group, element: DeviceElement): void {
    const label = element.label.trim();
    if (!label) return;
    const anchor = this.store.getHitAreaAnchor(element.hitArea);
    const text = new Konva.Text({ text: label, x: anchor.x, y: anchor.y - 24, fontSize: 14, fontStyle: '600', fontFamily: 'Segoe UI, Arial', fill: '#eef2f4', align: 'center' });
    text.offsetX(text.width() / 2);
    const bg = new Konva.Rect({ x: anchor.x - text.width() / 2 - 8, y: anchor.y - 24, width: text.width() + 16, height: 24, fill: 'rgba(7,9,11,0.78)' });
    group.add(bg, text);
  }

  private addRuntimeValue(group: Konva.Group, element: DeviceElement): void {
    if (this.store.mode() !== 'simulate' || !element.behavior.showValue) return;
    const anchor = this.store.getHitAreaAnchor(element.hitArea);
    const summary = this.store.getRuntimeSummary(element);
    const text = new Konva.Text({ text: summary, x: anchor.x, y: anchor.y + 9, fontSize: 13, fontStyle: '700', fontFamily: 'Segoe UI, Arial', fill: '#c9fff7', align: 'center' });
    text.offsetX(text.width() / 2);
    const bg = new Konva.Rect({ x: anchor.x - text.width() / 2 - 9, y: anchor.y + 6, width: text.width() + 18, height: 24, fill: 'rgba(7,9,11,0.82)' });
    group.add(bg, text);
  }

  private createDraftShape(draft: { shape: 'rect' | 'circle'; start: Point; end: Point }): Konva.Shape {
    const x1 = Math.min(draft.start.x, draft.end.x);
    const y1 = Math.min(draft.start.y, draft.end.y);
    const x2 = Math.max(draft.start.x, draft.end.x);
    const y2 = Math.max(draft.start.y, draft.end.y);
    const base = { stroke: '#f2b84b', strokeWidth: 2, fill: 'rgba(242,184,75,0.16)', dash: [8, 6], listening: false };
    if (draft.shape === 'circle') {
      const radius = Math.max(x2 - x1, y2 - y1) / 2;
      return new Konva.Circle({ ...base, x: (x1 + x2) / 2, y: (y1 + y2) / 2, radius });
    }
    return new Konva.Rect({ ...base, x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }

  private onPointerDown(event: Konva.KonvaEventObject<PointerEvent>): void {
    if (!this.stage) return;
    const point = this.getCanvasPoint();
    if (!point) return;
    this.store.setCanvasPointer(point);
    if (this.store.mode() === 'simulate') {
      const hit = this.findElementAt(point);
      if (hit) this.store.triggerElement(hit, hit.type === 'knob' ? -1 : 1);
      return;
    }
    if (this.store.tool() === 'polygon') {
      this.store.addDraftPolygonPoint(point);
      return;
    }
    if (this.store.tool() === 'rect' || this.store.tool() === 'circle') {
      this.draft = { shape: this.store.tool() as 'rect' | 'circle', start: point, end: point };
      return;
    }
    if (event.target === this.stage) {
      this.store.selectElement(null);
    }
  }

  private onPointerMove(): void {
    const point = this.getCanvasPoint();
    if (!point) return;
    this.store.setCanvasPointer(point);
    const hit = this.findElementAt(point);
    this.store.setHovered(hit?.id ?? null);
    if (this.draft) {
      this.draft.end = point;
      this.renderDrafts();
    }
  }

  private onPointerUp(): void {
    if (!this.draft) return;
    const hitArea = this.draftToHitArea(this.draft);
    this.draft = null;
    this.store.addElement(hitArea);
    this.renderDrafts();
  }

  private onPointerLeave(): void {
    this.store.setHovered(null);
  }

  private onWheel(event: WheelEvent): void {
    if (this.store.mode() !== 'simulate') return;
    const point = this.getCanvasPoint();
    if (!point) return;
    const hit = this.findElementAt(point);
    if (!hit || hit.type !== 'knob') return;
    event.preventDefault();
    this.store.setHovered(hit.id);
    this.store.triggerElement(hit, event.deltaY < 0 ? 1 : -1);
  }

  private onContextMenu(event: MouseEvent): void {
    if (this.store.mode() !== 'simulate') return;
    const point = this.getCanvasPoint();
    const hit = point ? this.findElementAt(point) : null;
    if (hit?.type === 'knob') event.preventDefault();
  }

  private onElementPointerDown(element: DeviceElement, event: Konva.KonvaEventObject<PointerEvent>): void {
    if (this.store.mode() === 'simulate') {
      const direction = element.type === 'knob' && event.evt.button === 0 ? -1 : 1;
      this.store.triggerElement(element, direction);
      return;
    }
    this.store.selectElement(element.id);
  }

  private updateElementFromShape(element: DeviceElement, node: Konva.Shape): void {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    if (element.hitArea.shape === 'circle' && node instanceof Konva.Circle) {
      this.store.moveElement(element.id, { shape: 'circle', x: Math.round(node.x()), y: Math.round(node.y()), radius: Math.max(7, Math.round(node.radius() * Math.max(scaleX, scaleY))) });
      return;
    }
    if (element.hitArea.shape === 'rect' && node instanceof Konva.Rect) {
      this.store.moveElement(element.id, { shape: 'rect', x: Math.round(node.x()), y: Math.round(node.y()), w: Math.max(10, Math.round(node.width() * scaleX)), h: Math.max(10, Math.round(node.height() * scaleY)) });
      return;
    }
    if (element.hitArea.shape === 'polygon') {
      const dx = node.x();
      const dy = node.y();
      node.position({ x: 0, y: 0 });
      this.store.moveElement(element.id, this.store.moveHitArea(element.hitArea, dx, dy));
    }
  }

  private draftToHitArea(draft: { shape: 'rect' | 'circle'; start: Point; end: Point }): HitArea {
    const dx = draft.end.x - draft.start.x;
    const dy = draft.end.y - draft.start.y;
    if (Math.hypot(dx, dy) < 4) {
      if (draft.shape === 'circle') return { shape: 'circle', x: Math.round(draft.start.x), y: Math.round(draft.start.y), radius: 42 };
      return { shape: 'rect', x: Math.round(draft.start.x - 60), y: Math.round(draft.start.y - 35), w: 120, h: 70 };
    }

    const x1 = Math.min(draft.start.x, draft.end.x);
    const y1 = Math.min(draft.start.y, draft.end.y);
    const x2 = Math.max(draft.start.x, draft.end.x);
    const y2 = Math.max(draft.start.y, draft.end.y);
    if (draft.shape === 'rect') return { shape: 'rect', x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
    const radius = Math.max(x2 - x1, y2 - y1) / 2;
    return { shape: 'circle', x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), radius: Math.round(radius) };
  }

  private findElementAt(point: Point): DeviceElement | undefined {
    return [...this.store.elements()].reverse().find((element) => this.containsPoint(element.hitArea, point));
  }

  private containsPoint(hitArea: HitArea, point: Point): boolean {
    if (hitArea.shape === 'rect') return point.x >= hitArea.x && point.x <= hitArea.x + hitArea.w && point.y >= hitArea.y && point.y <= hitArea.y + hitArea.h;
    if (hitArea.shape === 'circle') return Math.hypot(point.x - hitArea.x, point.y - hitArea.y) <= hitArea.radius;
    let inside = false;
    const points = hitArea.points;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;
      const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  private clipConfig(hitArea: HitArea): Konva.ContainerConfig {
    if (hitArea.shape === 'rect') return { clipX: hitArea.x, clipY: hitArea.y, clipWidth: hitArea.w, clipHeight: hitArea.h };
    return {
      clipFunc: (ctx) => {
        ctx.beginPath();
        if (hitArea.shape === 'circle') {
          ctx.arc(hitArea.x, hitArea.y, hitArea.radius, 0, Math.PI * 2);
        } else {
          hitArea.points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
          ctx.closePath();
        }
      },
    };
  }

  private getCanvasPoint(): Point | null {
    if (!this.stage || !this.world) return null;
    const pointer = this.stage.getPointerPosition();
    if (!pointer) return null;
    const transform = this.world.getAbsoluteTransform().copy().invert();
    return transform.point(pointer);
  }

  private worldTransform(): Konva.ContainerConfig {
    if (!this.world) return {};
    return { x: this.world.x(), y: this.world.y(), scaleX: this.world.scaleX(), scaleY: this.world.scaleY() };
  }

  private resizeStage(): void {
    if (!this.stage) return;
    this.stage.size({ width: this.stageHost.nativeElement.clientWidth, height: this.stageHost.nativeElement.clientHeight });
    this.renderAll();
  }

  private getElementStroke(element: DeviceElement): string {
    if ((element.type === 'toggle' || element.type === 'led') && element.runtime.on) return '#9ee66e';
    if (element.type === 'well' && element.runtime.hasContent) return '#76a9ff';
    if (element.type === 'meter' || element.type === 'resonance') return '#e7d46a';
    return '#54c3b1';
  }

  private getElementFill(element: DeviceElement): string {
    if ((element.type === 'toggle' || element.type === 'led') && element.runtime.on) return 'rgba(158,230,110,0.18)';
    if (element.type === 'well' && element.runtime.hasContent) return 'rgba(118,169,255,0.18)';
    if (element.type === 'meter' || element.type === 'resonance') return 'rgba(231,212,106,0.15)';
    return 'rgba(84,195,177,0.14)';
  }

  private isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }
}
