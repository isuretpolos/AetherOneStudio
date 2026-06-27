export type EditorMode = 'edit' | 'simulate';
export type DrawingTool = 'select' | 'rect' | 'circle' | 'polygon';
export type ElementType = 'button' | 'toggle' | 'knob' | 'slider' | 'led' | 'meter' | 'well' | 'display' | 'resonance';
export type BehaviorAction = 'default' | 'scan' | 'diagnosis' | 'broadcast' | 'neutralize' | 'custom';
export type SessionMode = 'idle' | 'powered' | 'scanning' | 'diagnosis' | 'broadcasting' | 'neutralizing' | 'blocked';
export type EventKind = 'info' | 'blocked';
export type ZoomLevel = 'fit' | number;

export interface Point {
  x: number;
  y: number;
}

export interface RectHitArea {
  shape: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CircleHitArea {
  shape: 'circle';
  x: number;
  y: number;
  radius: number;
}

export interface PolygonHitArea {
  shape: 'polygon';
  points: Point[];
}

export type HitArea = RectHitArea | CircleHitArea | PolygonHitArea;

export interface ElementBehavior {
  action: BehaviorAction;
  providesPower: boolean;
  requiresPower: boolean;
  requiresWell: boolean;
  rotateGraphics: boolean;
  transformGraphics: boolean;
  transformVertical: boolean;
  showValue: boolean;
  min: number;
  max: number;
  arcMin: number;
  arcMax: number;
  step: number;
  script: string;
}

export interface RuntimeState {
  on?: boolean;
  hasContent?: boolean;
  text?: string;
  value?: number;
  presses?: number;
}

export interface DeviceElement {
  id: string;
  type: ElementType;
  label: string;
  hitArea: HitArea;
  behavior: ElementBehavior;
  runtime: RuntimeState;
  states?: string[];
  initial?: string;
  flashUntil?: number;
  flashKind?: 'active' | 'blocked';
}

export interface ProjectManifest {
  name: string;
  author: string;
  version: string;
  description: string;
  formatVersion: number;
}

export interface BackgroundState {
  src: string;
  exportSrc: string;
  width: number;
  height: number;
}

export interface SessionEvent {
  id: string;
  time: string;
  label: string;
  detail: string;
  kind: EventKind;
}

export interface SessionState {
  mode: SessionMode;
  activeOperation: BehaviorAction | null;
  events: SessionEvent[];
  blockedCount: number;
  completed: Partial<Record<Exclude<BehaviorAction, 'default' | 'custom'>, boolean>>;
}

export interface ProjectSnapshot {
  manifest: ProjectManifest;
  background: BackgroundState;
  elements: DeviceElement[];
  selectedId: string | null;
  nextElementNumber: number;
}

export interface ProjectPayload {
  manifest: ProjectManifest;
  exportedAt?: string;
  app?: {
    name: string;
    format: string;
    formatVersion: number;
  };
  background: {
    src: string;
    width: number;
    height: number;
  };
  elements: DeviceElement[];
  summary?: ProjectSummary;
}

export interface ProjectSummary {
  elementCount: number;
  operationCount: number;
  typeCounts: Record<string, number>;
  operationCounts: Record<string, number>;
  powerProviderIds: string[];
  requiresPowerCount: number;
  requiresWellCount: number;
  canvas: {
    width: number;
    height: number;
  };
}
