const canvas = document.querySelector("#deviceCanvas");
const ctx = canvas.getContext("2d");
const canvasHost = document.querySelector("#canvasHost");
const imageInput = document.querySelector("#imageInput");
const projectInput = document.querySelector("#projectInput");
const exportButton = document.querySelector("#exportButton");
const undoButton = document.querySelector("#undoButton");
const redoButton = document.querySelector("#redoButton");
const dirtyBadge = document.querySelector("#dirtyBadge");
const deleteButton = document.querySelector("#deleteButton");
const statusText = document.querySelector("#statusText");
const elementList = document.querySelector("#elementList");
const manifestForm = document.querySelector("#manifestForm");
const projectName = document.querySelector("#projectName");
const projectAuthor = document.querySelector("#projectAuthor");
const projectVersion = document.querySelector("#projectVersion");
const projectDescription = document.querySelector("#projectDescription");
const propertiesForm = document.querySelector("#propertiesForm");
const elementId = document.querySelector("#elementId");
const elementLabel = document.querySelector("#elementLabel");
const elementType = document.querySelector("#elementType");
const behaviorAction = document.querySelector("#behaviorAction");
const providesPower = document.querySelector("#providesPower");
const requiresPower = document.querySelector("#requiresPower");
const requiresWell = document.querySelector("#requiresWell");
const rotateGraphics = document.querySelector("#rotateGraphics");
const transformGraphics = document.querySelector("#transformGraphics");
const transformVertical = document.querySelector("#transformVertical");
const showValue = document.querySelector("#showValue");
const valueStep = document.querySelector("#valueStep");
const valueMin = document.querySelector("#valueMin");
const valueMax = document.querySelector("#valueMax");
const arcMin = document.querySelector("#arcMin");
const arcMax = document.querySelector("#arcMax");
const validationList = document.querySelector("#validationList");
const resetSessionButton = document.querySelector("#resetSessionButton");
const sessionMode = document.querySelector("#sessionMode");
const sessionEventCount = document.querySelector("#sessionEventCount");
const sessionBlockedCount = document.querySelector("#sessionBlockedCount");
const sessionCompleted = document.querySelector("#sessionCompleted");
const eventLog = document.querySelector("#eventLog");
const editModeButton = document.querySelector("#editModeButton");
const simulateModeButton = document.querySelector("#simulateModeButton");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomFitButton = document.querySelector("#zoomFitButton");
const zoomActualButton = document.querySelector("#zoomActualButton");
const zoomInButton = document.querySelector("#zoomInButton");

const state = {
  mode: "edit",
  tool: "select",
  backgroundSrc: "src/docs/prototype.jpg",
  backgroundExportSrc: "src/docs/prototype.jpg",
  backgroundExportPromise: null,
  manifest: {
    name: "AetherOne Studio Device",
    author: "",
    version: "0.1.0",
    formatVersion: 1,
    description: "",
  },
  background: new Image(),
  backgroundObjectUrl: null,
  elements: [],
  selectedId: null,
  zoom: "fit",
  hoveredId: null,
  copiedElement: null,
  lastCanvasPoint: null,
  draft: null,
  drag: null,
  resize: null,
  polygonDraft: null,
  nextElementNumber: 1,
  session: {
    mode: "idle",
    activeOperation: null,
    events: [],
    blockedCount: 0,
    completed: {},
  },
  history: {
    undo: [],
    redo: [],
    dirty: false,
    restoring: false,
  },
};

const elementDefaults = {
  rect: "button",
  circle: "well",
  polygon: "display",
};

state.background.addEventListener("load", () => {
  canvas.width = state.background.naturalWidth || 1280;
  canvas.height = state.background.naturalHeight || 860;
  updateCanvasScale();
  render();
});
state.background.src = state.backgroundSrc;

document.querySelectorAll(".tool-button").forEach((button) => {
  button.addEventListener("click", () => {
    setTool(button.dataset.tool);
  });
});

editModeButton.addEventListener("click", () => setMode("edit"));
simulateModeButton.addEventListener("click", () => setMode("simulate"));
zoomOutButton.addEventListener("click", () => stepZoom(-1));
zoomFitButton.addEventListener("click", () => setZoom("fit"));
zoomActualButton.addEventListener("click", () => setZoom(1));
zoomInButton.addEventListener("click", () => stepZoom(1));
resetSessionButton.addEventListener("click", resetSession);
deleteButton.addEventListener("click", deleteSelected);
undoButton.addEventListener("click", undoProjectChange);
redoButton.addEventListener("click", redoProjectChange);
exportButton.addEventListener("click", exportProject);
imageInput.addEventListener("change", importImage);
projectInput.addEventListener("change", importProject);
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointerleave", onPointerUp);
canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
canvas.addEventListener("contextmenu", onCanvasContextMenu);
canvas.addEventListener("dblclick", finishPolygon);
window.addEventListener("resize", updateCanvasScale);
window.addEventListener("keydown", onKeyDown);

manifestForm.addEventListener("input", () => {
  commitHistory();
  state.manifest.name = projectName.value.trim();
  state.manifest.author = projectAuthor.value.trim();
  state.manifest.version = projectVersion.value.trim();
  state.manifest.description = projectDescription.value.trim();
  renderValidation();
});

propertiesForm.addEventListener("input", (event) => {
  const selected = getSelectedElement();
  if (!selected) return;

  commitHistory();
  selected.id = sanitizeId(elementId.value);
  selected.label = elementLabel.value.trim();
  const previousType = selected.type;
  selected.type = elementType.value;
  if (selected.type !== previousType) {
    selected.runtime = createRuntimeState(selected.type);
    selected.behavior = createDefaultBehavior(selected.type, selected);
  } else {
    selected.behavior = selected.behavior || createDefaultBehavior(selected.type, selected);
    selected.behavior.action = behaviorAction.value;
    selected.behavior.providesPower = providesPower.checked;
    selected.behavior.requiresPower = requiresPower.checked;
    selected.behavior.requiresWell = requiresWell.checked;
    selected.behavior.rotateGraphics = rotateGraphics.checked;
    selected.behavior.transformGraphics = transformGraphics.checked;
    selected.behavior.transformVertical = transformVertical.checked;
    selected.behavior.showValue = showValue.checked;
    selected.behavior.step = clampNumber(Number(valueStep.value), 1, 100, selected.behavior.step || getDefaultStep(selected.type));
    if (usesRangeValue(selected.type)) {
      selected.behavior.min = Number(valueMin.value);
      selected.behavior.max = Number(valueMax.value);
      selected.behavior.arcMin = Number(arcMin.value);
      selected.behavior.arcMax = Number(arcMax.value);
      normalizeValueRange(selected.behavior);
      normalizeArcRange(selected.behavior);
      selected.runtime = clampRuntimeValue(selected);
    }
    if (event.target === providesPower && selected.behavior.providesPower) {
      selected.behavior.requiresPower = false;
    }
    if (event.target === requiresPower && selected.behavior.requiresPower) {
      selected.behavior.providesPower = false;
    }
  }
  state.selectedId = selected.id;
  render();
  renderProperties();
  renderElementList();
  renderValidation();
});

function setTool(tool) {
  state.tool = tool;
  state.draft = null;
  state.drag = null;
  state.resize = null;
  state.polygonDraft = null;
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  setStatus(tool === "polygon" ? "Click points to build a polygon. Double-click to finish it." : "Draw regions on the panel image.");
  render();
}

function setMode(mode) {
  state.mode = mode;
  state.tool = mode === "simulate" ? "select" : state.tool;
  editModeButton.classList.toggle("is-active", mode === "edit");
  simulateModeButton.classList.toggle("is-active", mode === "simulate");
  canvasHost.classList.toggle("is-simulating", mode === "simulate");
  setStatus(mode === "simulate" ? "Simulation mode: click marked regions to trigger them." : "Edit mode: create and configure regions.");
  render();
}

function onPointerDown(event) {
  event.preventDefault();
  const point = getCanvasPoint(event);
  state.lastCanvasPoint = point;
  const hit = findElementAt(point);

  if (state.mode === "simulate") {
    if (hit) {
      const scrollLeft = canvasHost.scrollLeft;
      const scrollTop = canvasHost.scrollTop;
      const direction = hit.type === "knob" && event.button === 0 ? -1 : 1;
      triggerElement(hit, { direction });
      canvasHost.scrollLeft = scrollLeft;
      canvasHost.scrollTop = scrollTop;
    }
    return;
  }

  if (state.tool === "select") {
    const handle = getHandleAt(point);
    state.selectedId = hit?.id ?? null;

    if (handle) {
      commitHistory();
      state.selectedId = handle.element.id;
      state.resize = {
        id: handle.element.id,
        handle: handle.name,
        start: point,
        original: structuredClone(handle.element.hitArea),
      };
      canvas.setPointerCapture(event.pointerId);
    } else if (hit) {
      commitHistory();
      state.drag = { id: hit.id, start: point, original: structuredClone(hit.hitArea) };
      canvas.setPointerCapture(event.pointerId);
    }

    render();
    renderProperties();
    renderElementList();
    return;
  }

  if (state.tool === "polygon") {
    if (!state.polygonDraft) {
      state.polygonDraft = { points: [point] };
    } else {
      state.polygonDraft.points.push(point);
    }
    render();
    return;
  }

  state.draft = { shape: state.tool, start: point, end: point };
}

function onPointerMove(event) {
  event.preventDefault();
  const point = getCanvasPoint(event);
  state.lastCanvasPoint = point;
  const hit = findElementAt(point);
  state.hoveredId = hit?.id || null;

  if (state.resize) {
    const element = state.elements.find((item) => item.id === state.resize.id);
    element.hitArea = resizeHitArea(state.resize.original, state.resize.handle, point);
    render();
    return;
  }

  if (state.drag) {
    const element = state.elements.find((item) => item.id === state.drag.id);
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    element.hitArea = moveHitArea(state.drag.original, dx, dy);
    render();
    return;
  }

  if (state.draft) {
    state.draft.end = point;
    render();
    return;
  }

  canvas.style.cursor = getCanvasCursor(point, hit);
}

function onPointerUp(event) {
  event.preventDefault();
  if (event.type === "pointerleave") {
    state.hoveredId = null;
  }
  if (state.resize) {
    state.resize = null;
    renderProperties();
    renderElementList();
    renderValidation();
    releasePointer(event);
    return;
  }

  if (state.drag) {
    state.drag = null;
    renderProperties();
    renderValidation();
    releasePointer(event);
    return;
  }

  if (!state.draft) return;

  const hitArea = draftToHitArea(state.draft);
  state.draft = null;

  if (isUsefulHitArea(hitArea)) {
    addElement(hitArea);
  } else {
    render();
  }
}

function onCanvasWheel(event) {
  if (state.mode !== "simulate") return;
  const hit = findElementAt(getCanvasPoint(event));
  if (!hit || hit.type !== "knob") return;

  event.preventDefault();
  state.hoveredId = hit.id;
  triggerElement(hit, { direction: event.deltaY < 0 ? 1 : -1 });
}

function onCanvasContextMenu(event) {
  if (state.mode !== "simulate") return;
  const hit = findElementAt(getCanvasPoint(event));
  if (!hit || hit.type !== "knob") return;

  event.preventDefault();
}

function addElement(hitArea) {
  commitHistory();
  const shape = hitArea.shape;
  const id = nextElementId(shape);
  const type = elementDefaults[shape] || "button";
  const element = {
    id,
    type,
    label: "",
    hitArea,
    states: shape === "rect" ? ["idle", "active"] : undefined,
    initial: shape === "rect" ? "idle" : undefined,
    runtime: createRuntimeState(type),
  };
  element.behavior = createDefaultBehavior(type, element);
  state.elements.push(element);
  state.selectedId = element.id;
  setTool("select");
  renderProperties();
  renderElementList();
  renderValidation();
}

function finishPolygon() {
  if (!state.polygonDraft || state.polygonDraft.points.length < 3) return;
  addElement({
    shape: "polygon",
    points: state.polygonDraft.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })),
  });
  state.polygonDraft = null;
}

function deleteSelected() {
  if (!state.selectedId) return;
  commitHistory();
  state.elements = state.elements.filter((element) => element.id !== state.selectedId);
  state.selectedId = null;
  render();
  renderProperties();
  renderElementList();
  renderValidation();
}

function copySelectedElement() {
  const selected = getSelectedElement();
  if (!selected || state.mode !== "edit") return false;

  state.copiedElement = serializeElement(selected);
  setStatus(`Copied ${selected.id}.`);
  return true;
}

function pasteCopiedElement() {
  if (!state.copiedElement || state.mode !== "edit") return false;

  commitHistory();
  const copy = structuredClone(state.copiedElement);
  copy.id = nextGroupedElementId(copy.id);
  copy.hitArea = moveHitAreaToPoint(copy.hitArea, state.lastCanvasPoint || getHitAreaCenter(copy.hitArea));
  copy.runtime = createRuntimeState(copy.type);
  delete copy.flashUntil;
  delete copy.flashKind;
  state.elements.push(copy);
  state.selectedId = copy.id;
  render();
  renderProperties();
  renderElementList();
  renderValidation();
  setStatus(`Pasted ${copy.id}.`);
  return true;
}

function importImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setStatus("Choose an image file for the panel background.");
    imageInput.value = "";
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const nextBackground = new Image();

  nextBackground.addEventListener(
    "load",
    () => {
      commitHistory();
      if (state.backgroundObjectUrl) {
        URL.revokeObjectURL(state.backgroundObjectUrl);
      }

      state.backgroundObjectUrl = objectUrl;
      state.backgroundSrc = objectUrl;
      state.background = nextBackground;
      canvas.width = nextBackground.naturalWidth || 1280;
      canvas.height = nextBackground.naturalHeight || 860;
      updateCanvasScale();
      render();
      imageInput.value = "";
      setStatus(`Imported image: ${file.name}`);
      state.backgroundExportPromise = persistImportedBackground(file);
    },
    { once: true },
  );

  nextBackground.addEventListener(
    "error",
    () => {
      URL.revokeObjectURL(objectUrl);
      imageInput.value = "";
      setStatus(`Could not import image: ${file.name}`);
    },
    { once: true },
  );

  setStatus(`Loading image: ${file.name}`);
  nextBackground.src = objectUrl;
}

function setBackgroundFromSource(src, statusMessage) {
  const nextBackground = new Image();

  nextBackground.addEventListener(
    "load",
    () => {
      if (state.backgroundObjectUrl) {
        URL.revokeObjectURL(state.backgroundObjectUrl);
        state.backgroundObjectUrl = null;
      }

      state.backgroundSrc = src;
      state.backgroundExportSrc = src;
      state.background = nextBackground;
      canvas.width = nextBackground.naturalWidth || 1280;
      canvas.height = nextBackground.naturalHeight || 860;
      updateCanvasScale();
      render();
      if (statusMessage) {
        setStatus(statusMessage);
      }
    },
    { once: true },
  );

  nextBackground.addEventListener(
    "error",
    () => {
      setStatus("Could not load the project background image.");
    },
    { once: true },
  );

  nextBackground.src = src;
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(file);
  });
}

async function persistImportedBackground(file) {
  try {
    state.backgroundExportSrc = await imageFileToDataUrl(file);
  } catch (error) {
    console.warn("Could not prepare imported image for project export.", error);
  } finally {
    state.backgroundExportPromise = null;
  }
}

async function exportProject() {
  if (state.backgroundExportPromise) {
    await state.backgroundExportPromise;
  }

  const payload = {
    manifest: normalizeManifest(state.manifest),
    exportedAt: new Date().toISOString(),
    app: {
      name: "AetherOne Studio",
      format: "aetherone-device-json",
      formatVersion: 1,
    },
    background: {
      src: state.backgroundExportSrc,
      width: canvas.width,
      height: canvas.height,
    },
    elements: state.elements.map(serializeElement),
  };
  payload.summary = buildProjectSummary(payload.elements, payload.background);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getProjectFileName(payload.manifest);
  link.click();
  URL.revokeObjectURL(url);
  state.history.dirty = false;
  updateHistoryControls();
  setStatus(`Exported ${payload.summary.elementCount} elements to ${link.download}.`);
}

function importProject(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const project = JSON.parse(reader.result);
      validateProjectPayload(project);
      commitHistory();
      state.manifest = normalizeManifest(project.manifest);
      state.elements = normalizeElements(project.elements);
      state.selectedId = null;
      state.nextElementNumber = state.elements.length + 1;
      resetSession();
      const summary = buildProjectSummary(state.elements, project.background);
      setBackgroundFromSource(project.background?.src || "src/docs/prototype.jpg", `Imported ${file.name}: ${summary.elementCount} elements, ${summary.operationCount} operations.`);
      renderManifest();
      renderProperties();
      renderElementList();
      renderValidation();
      updateHistoryControls();
    } catch (error) {
      setStatus(`Could not import project: ${error.message}`);
    }
  });
  reader.readAsText(file);
}

function validateProjectPayload(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("Project JSON must contain an object.");
  }

  if (!Array.isArray(project.elements)) {
    throw new Error("Project JSON must contain an elements array.");
  }

  project.elements.forEach((element, index) => {
    if (!element || typeof element !== "object") {
      throw new Error(`Element ${index + 1} is not an object.`);
    }

    if (!element.hitArea || !element.hitArea.shape) {
      throw new Error(`${element.id || `Element ${index + 1}`} is missing a hit area.`);
    }
  });
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.background.complete) {
    ctx.drawImage(state.background, 0, 0, canvas.width, canvas.height);
  }

  state.elements.forEach((element) => drawElement(element));
  drawSelectedHandles();

  if (state.draft) {
    drawHitArea(draftToHitArea(state.draft), {
      stroke: "#f2b84b",
      fill: "rgba(242, 184, 75, 0.16)",
      lineDash: [8, 6],
    });
  }

  if (state.polygonDraft) {
    drawPolygonDraft(state.polygonDraft.points);
  }
}

function drawElement(element) {
  const selected = element.id === state.selectedId;
  const active = element.flashUntil && element.flashUntil > performance.now();
  const typeStyle = getElementTypeStyle(element);
  drawRotatingGraphic(element);
  drawTransformedGraphic(element);
  drawHitArea(element.hitArea, {
    stroke: active ? getFlashStyle(element).stroke : selected ? "#f2b84b" : typeStyle.stroke,
    fill: active ? getFlashStyle(element).fill : selected ? "rgba(242, 184, 75, 0.18)" : typeStyle.fill,
    lineWidth: selected ? 3 : 2,
  });
  drawLabel(element);
  drawRuntimeState(element);
}

function drawHitArea(hitArea, style) {
  ctx.save();
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.fill;
  ctx.lineWidth = style.lineWidth || 2;
  ctx.setLineDash(style.lineDash || []);
  ctx.beginPath();

  if (hitArea.shape === "rect") {
    ctx.rect(hitArea.x, hitArea.y, hitArea.w, hitArea.h);
  }

  if (hitArea.shape === "circle") {
    ctx.arc(hitArea.x, hitArea.y, hitArea.radius, 0, Math.PI * 2);
  }

  if (hitArea.shape === "polygon") {
    hitArea.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
  }

  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRotatingGraphic(element) {
  if (element.type !== "knob" || !element.behavior?.rotateGraphics || !state.background.complete) return;

  const center = getHitAreaCenter(element.hitArea);
  const angle = getKnobRotationRadians(element);
  ctx.save();
  clipHitArea(element.hitArea);
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.drawImage(state.background, -center.x, -center.y, canvas.width, canvas.height);
  ctx.restore();
}

function drawTransformedGraphic(element) {
  if (state.mode !== "simulate" || element.type !== "toggle" || !element.behavior?.transformGraphics || !element.runtime?.on || !state.background.complete) return;

  const center = getHitAreaCenter(element.hitArea);
  const scaleX = element.behavior.transformVertical ? 1 : -1;
  const scaleY = element.behavior.transformVertical ? -1 : 1;
  ctx.save();
  clipHitArea(element.hitArea);
  ctx.translate(center.x, center.y);
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(state.background, -center.x, -center.y, canvas.width, canvas.height);
  ctx.restore();
}

function clipHitArea(hitArea) {
  ctx.beginPath();

  if (hitArea.shape === "rect") {
    ctx.rect(hitArea.x, hitArea.y, hitArea.w, hitArea.h);
  }

  if (hitArea.shape === "circle") {
    ctx.arc(hitArea.x, hitArea.y, hitArea.radius, 0, Math.PI * 2);
  }

  if (hitArea.shape === "polygon") {
    hitArea.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
  }

  ctx.clip();
}

function drawLabel(element) {
  const label = typeof element.label === "string" ? element.label.trim() : "";
  if (!label) return;

  const anchor = getHitAreaAnchor(element.hitArea);
  ctx.save();
  ctx.font = "600 14px Segoe UI, Arial, sans-serif";
  const width = ctx.measureText(label).width + 16;
  ctx.fillStyle = "rgba(7, 9, 11, 0.78)";
  ctx.fillRect(anchor.x - width / 2, anchor.y - 24, width, 24);
  ctx.fillStyle = "#eef2f4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, anchor.x, anchor.y - 12);
  ctx.restore();
}

function drawPolygonDraft(points) {
  ctx.save();
  ctx.strokeStyle = "#f2b84b";
  ctx.fillStyle = "rgba(242, 184, 75, 0.16)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
    ctx.moveTo(point.x, point.y);
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.moveTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawSelectedHandles() {
  if (state.mode !== "edit" || state.tool !== "select") return;

  const selected = getSelectedElement();
  if (!selected) return;

  ctx.save();
  ctx.fillStyle = "#f2b84b";
  ctx.strokeStyle = "#07090b";
  ctx.lineWidth = 2;
  getResizeHandles(selected).forEach((handle) => {
    ctx.beginPath();
    ctx.rect(handle.x - handle.size / 2, handle.y - handle.size / 2, handle.size, handle.size);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function renderProperties() {
  const selected = getSelectedElement();
  const disabled = !selected;
  [elementId, elementLabel, elementType].forEach((input) => {
    input.disabled = disabled;
  });
  [behaviorAction, providesPower, requiresPower, requiresWell, rotateGraphics, transformGraphics, transformVertical, showValue, valueStep, valueMin, valueMax, arcMin, arcMax].forEach((input) => {
    input.disabled = disabled;
  });
  deleteButton.disabled = disabled;

  elementId.value = selected?.id || "";
  elementLabel.value = selected?.label || "";
  elementType.value = selected?.type || "button";
  const behavior = selected?.behavior || createDefaultBehavior(selected?.type || "button", selected);
  behaviorAction.value = behavior.action || "default";
  providesPower.checked = Boolean(behavior.providesPower);
  requiresPower.checked = Boolean(behavior.requiresPower);
  requiresWell.checked = Boolean(behavior.requiresWell);
  rotateGraphics.checked = Boolean(behavior.rotateGraphics);
  transformGraphics.checked = Boolean(behavior.transformGraphics);
  transformVertical.checked = Boolean(behavior.transformVertical);
  showValue.checked = Boolean(behavior.showValue);
  valueStep.value = behavior.step || getDefaultStep(selected?.type || "button");
  valueStep.disabled = disabled || !usesStepValue(selected?.type);
  rotateGraphics.disabled = disabled || selected?.type !== "knob";
  transformGraphics.disabled = disabled || selected?.type !== "toggle";
  transformVertical.disabled = disabled || selected?.type !== "toggle" || !behavior.transformGraphics;
  valueMin.value = getBehaviorMin(selected || { type: "button", behavior });
  valueMax.value = getBehaviorMax(selected || { type: "button", behavior });
  arcMin.value = getBehaviorArcMin(selected || { type: "button", behavior });
  arcMax.value = getBehaviorArcMax(selected || { type: "button", behavior });
  valueMin.disabled = disabled || !usesRangeValue(selected?.type);
  valueMax.disabled = disabled || !usesRangeValue(selected?.type);
  arcMin.disabled = disabled || selected?.type !== "knob";
  arcMax.disabled = disabled || selected?.type !== "knob";
}

function renderManifest() {
  const manifest = normalizeManifest(state.manifest);
  projectName.value = manifest.name;
  projectAuthor.value = manifest.author;
  projectVersion.value = manifest.version;
  projectDescription.value = manifest.description;
}

function refreshEditor() {
  renderManifest();
  render();
  renderProperties();
  renderElementList();
  renderValidation();
  renderSession();
  updateHistoryControls();
}

function renderElementList() {
  elementList.replaceChildren();
  state.elements.forEach((element) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const action = getBehaviorAction(element);
    const operationLabel = action === "default" ? "" : ` - ${getActionLabel(action)}`;
    button.textContent = `${element.label || element.id} (${element.type}${operationLabel})`;
    button.classList.toggle("is-selected", element.id === state.selectedId);
    button.addEventListener("click", () => {
      state.selectedId = element.id;
      render();
      renderProperties();
      renderElementList();
    });
    item.append(button);
    elementList.append(item);
  });
}

function renderSession() {
  sessionMode.textContent = titleCase(state.session.mode);
  sessionEventCount.textContent = String(state.session.events.length);
  sessionBlockedCount.textContent = String(state.session.blockedCount);
  sessionCompleted.textContent = getCompletedSummary();
  eventLog.replaceChildren();

  state.session.events.slice(0, 12).forEach((event) => {
    const item = document.createElement("li");
    item.classList.toggle("is-blocked", event.kind === "blocked");
    const title = document.createElement("strong");
    title.textContent = event.label;
    const detail = document.createElement("span");
    detail.textContent = `${event.time} - ${event.detail}`;
    title.append(" ");
    item.append(title, detail);
    eventLog.append(item);
  });
}

function renderValidation() {
  const messages = validateDevice();
  validationList.replaceChildren();

  if (messages.length === 0) {
    const item = document.createElement("li");
    item.className = "is-ok";
    item.textContent = "Ready for simulation.";
    validationList.append(item);
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement("li");
    item.className = "is-warning";
    item.textContent = message;
    validationList.append(item);
  });
}

function validateDevice() {
  const messages = [];
  const ids = new Map();

  if (state.elements.length === 0) {
    messages.push("Add at least one interactive region.");
  }

  if (!state.manifest.name.trim()) {
    messages.push("Add a project name before export.");
  }

  if (!state.manifest.version.trim()) {
    messages.push("Add a project version before export.");
  }

  state.elements.forEach((element) => {
    const id = element.id.trim();
    ids.set(id, (ids.get(id) || 0) + 1);

    if (!id) {
      messages.push("Every element needs an ID.");
    }

    if (!isUsefulHitArea(element.hitArea)) {
      messages.push(`${element.id || "Unnamed element"} has a region that is too small.`);
    }

    if (element.type === "knob") {
      const min = getBehaviorMin(element);
      const max = getBehaviorMax(element);
      if (max <= min) {
        messages.push(`${element.id || "Unnamed knob"} needs a max value greater than min.`);
      }
    }
  });

  if (state.elements.length > 0 && state.elements.some((element) => element.behavior?.requiresPower) && !getPowerProvider()) {
    messages.push("Mark one toggle as a power provider before requiring power on other elements.");
  }

  if (state.elements.some((element) => element.behavior?.requiresWell) && !state.elements.some((element) => element.type === "well")) {
    messages.push("Add a well element for actions that require loaded well content.");
  }

  if (state.elements.some((element) => getBehaviorAction(element) !== "default") && !getPowerProvider()) {
    messages.push("Add a power provider for operation-oriented simulation.");
  }

  ids.forEach((count, id) => {
    if (id && count > 1) {
      messages.push(`Duplicate element ID: ${id}.`);
    }
  });

  return messages;
}

function flashElement(id, kind = "active") {
  const element = state.elements.find((item) => item.id === id);
  if (!element) return;
  element.flashUntil = performance.now() + 260;
  element.flashKind = kind;
  render();
  window.setTimeout(() => {
    delete element.flashKind;
    render();
  }, 280);
}

function triggerElement(element, options = {}) {
  state.selectedId = element.id;
  element.runtime = element.runtime || createRuntimeState(element.type);
  const ruleResult = evaluateRules(element);

  if (!ruleResult.allowed) {
    blockElement(element, ruleResult.reason);
    return;
  }

  const operationHandled = applyBehaviorAction(element);

  if (operationHandled) {
    // Operation elements can still show their type state, but the operation log is the primary event.
    if (element.type === "toggle" || element.type === "led") {
      element.runtime.on = !element.runtime.on;
    } else if (element.type === "display") {
      element.runtime.text = getRuntimeSummary(element).toUpperCase();
    } else if (typeof element.runtime.value === "number") {
      element.runtime = adjustValueRuntime(element, options.direction || 1);
    } else if (element.type === "button") {
      element.runtime.presses = (element.runtime.presses || 0) + 1;
    }
  } else if (element.type === "toggle") {
    element.runtime.on = !element.runtime.on;
    state.session.mode = element.runtime.on ? "powered" : "idle";
    logEvent(element, element.runtime.on ? "Switched on." : "Switched off.");
  } else if (element.type === "well") {
    element.runtime.hasContent = !element.runtime.hasContent;
    logEvent(element, element.runtime.hasContent ? "Virtual content placed." : "Virtual content removed.");
  } else if (element.type === "knob") {
    element.runtime = adjustValueRuntime(element, options.direction || 1);
    logEvent(element, `Value set to ${element.runtime.value}.`);
  } else if (element.type === "slider" || element.type === "meter" || element.type === "resonance") {
    element.runtime = adjustValueRuntime(element, options.direction || 1);
    logEvent(element, `Level set to ${element.runtime.value}.`);
  } else if (element.type === "led") {
    element.runtime.on = !element.runtime.on;
    logEvent(element, element.runtime.on ? "Indicator lit." : "Indicator cleared.");
  } else if (element.type === "display") {
    element.runtime.text = element.runtime.text === "READY" ? "ACTIVE" : "READY";
    logEvent(element, `Display changed to ${element.runtime.text}.`);
  } else {
    element.runtime.presses = (element.runtime.presses || 0) + 1;
    logEvent(element, "Momentary action triggered.");
  }

  setStatus(`${element.label || element.id}: ${getRuntimeSummary(element)}`);
  flashElement(element.id);
  renderElementList();
  renderSession();
}

function blockElement(element, reason) {
  state.session.blockedCount += 1;
  state.session.mode = "blocked";
  logEvent(element, reason, "blocked");
  setStatus(`${element.label || element.id}: blocked - ${reason}`);
  flashElement(element.id, "blocked");
  renderElementList();
  renderSession();
}

function evaluateRules(element) {
  const action = getBehaviorAction(element);
  const isPowerProvider = Boolean(element.behavior?.providesPower);
  if (isPowerProvider) {
    if (element.runtime?.on) {
      const activeOperation = getActiveOperation();
      if (activeOperation) {
        return { allowed: false, reason: `Complete ${getActionLabel(activeOperation)} before switching power off.` };
      }

      if (hasLoadedWell()) {
        return { allowed: false, reason: "Clear loaded wells before switching power off." };
      }
    }

    return { allowed: true };
  }

  if (state.elements.length === 1 && action === "default") {
    return { allowed: true };
  }

  const requiresPower = Boolean(element.behavior?.requiresPower);
  const powerToggle = getPowerProvider();
  if ((requiresPower || action !== "default") && !powerToggle) {
    return { allowed: false, reason: "No power source is configured." };
  }

  if ((requiresPower || action !== "default") && !powerToggle.runtime?.on) {
    return { allowed: false, reason: "Power is off." };
  }

  const requiresWell = Boolean(element.behavior?.requiresWell);
  if (requiresWell && hasAnyWell() && !hasLoadedWell()) {
    return { allowed: false, reason: "Load a well before this operation." };
  }

  const activeOperation = getActiveOperation();
  const completingOperation = action !== "default" && activeOperation === action;
  const interruptingOperation = action !== "default" && activeOperation && !completingOperation;
  if (interruptingOperation && !(activeOperation === "broadcast" && action === "neutralize")) {
    return { allowed: false, reason: `Complete ${getActionLabel(activeOperation)} before starting ${getActionLabel(action)}.` };
  }

  if (action === "broadcast" && state.session.mode === "diagnosis") {
    return { allowed: false, reason: "Broadcast is blocked during diagnosis." };
  }

  if (action === "neutralize" && state.session.mode !== "broadcasting" && !state.session.completed.broadcast) {
    return { allowed: false, reason: "Start or complete broadcast before neutralizing." };
  }

  if (state.session.mode === "blocked") {
    state.session.mode = powerToggle?.runtime?.on ? "powered" : "idle";
  }

  return { allowed: true };
}

function logEvent(element, detail, kind = "info") {
  const now = new Date();
  state.session.events.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    label: element.label || element.id,
    detail,
    kind,
  });
}

function resetSession() {
  state.session = { mode: "idle", activeOperation: null, events: [], blockedCount: 0, completed: {} };
  state.elements.forEach((element) => {
    element.runtime = createRuntimeState(element.type);
    delete element.flashUntil;
  });
  setStatus(state.mode === "simulate" ? "Simulation reset." : "Session reset.");
  render();
  renderElementList();
  renderSession();
}

function createRuntimeState(type) {
  if (type === "toggle" || type === "led") return { on: false };
  if (type === "well") return { hasContent: false };
  if (type === "display") return { text: "READY" };
  if (type === "knob" || type === "slider" || type === "meter" || type === "resonance") return { value: 0 };
  return { presses: 0 };
}

function normalizeManifest(manifest = {}) {
  return {
    name: manifest.name || "AetherOne Studio Device",
    author: manifest.author || "",
    version: manifest.version || "0.1.0",
    formatVersion: Number(manifest.formatVersion) || 1,
    description: manifest.description || "",
  };
}

function createDefaultBehavior(type, element = null, hasPowerProvider = Boolean(getPowerProvider(element))) {
  const providesPower = type === "toggle" && !hasPowerProvider;
  return {
    providesPower,
    requiresPower: !providesPower,
    requiresWell: type === "button" || type === "meter" || type === "resonance",
    rotateGraphics: false,
    transformGraphics: false,
    transformVertical: false,
    showValue: true,
    action: "default",
    min: getDefaultMin(type),
    max: getDefaultMax(type),
    arcMin: getDefaultArcMin(type),
    arcMax: getDefaultArcMax(type),
    step: getDefaultStep(type),
  };
}

function getBehaviorAction(element) {
  return element.behavior?.action || "default";
}

function getActiveOperation() {
  if (state.session.activeOperation) {
    return state.session.activeOperation;
  }

  const modes = {
    scanning: "scan",
    diagnosis: "diagnosis",
    broadcasting: "broadcast",
    neutralizing: "neutralize",
  };
  return modes[state.session.mode] || null;
}

function applyBehaviorAction(element) {
  const action = getBehaviorAction(element);
  if (action === "default") return false;

  if (action === "scan") {
    const completing = getActiveOperation() === action;
    state.session.mode = completing ? getPoweredSessionMode() : "scanning";
    state.session.activeOperation = completing ? null : action;
    state.session.completed.scan = completing || state.session.completed.scan;
    logEvent(element, completing ? "Scan completed." : "Scan started.");
    return true;
  }

  if (action === "diagnosis") {
    const completing = getActiveOperation() === action;
    state.session.mode = completing ? getPoweredSessionMode() : "diagnosis";
    state.session.activeOperation = completing ? null : action;
    state.session.completed.diagnosis = completing || state.session.completed.diagnosis;
    logEvent(element, completing ? "Diagnosis completed." : "Diagnosis mode active.");
    return true;
  }

  if (action === "broadcast") {
    const completing = getActiveOperation() === action;
    state.session.mode = completing ? getPoweredSessionMode() : "broadcasting";
    state.session.activeOperation = completing ? null : action;
    if (completing) {
      state.session.completed.broadcast = true;
      logEvent(element, "Broadcast completed.");
    } else {
      logEvent(element, "Broadcast started.");
    }
    return true;
  }

  if (action === "neutralize") {
    const completing = getActiveOperation() === action;
    state.session.mode = completing ? getPoweredSessionMode() : "neutralizing";
    state.session.activeOperation = completing ? null : action;
    state.session.completed.neutralize = completing || state.session.completed.neutralize;
    logEvent(element, completing ? "Neutralize completed." : "Neutralize sequence started.");
    return true;
  }

  if (action === "custom") {
    logEvent(element, "Custom event triggered.");
    return true;
  }

  return false;
}

function getPoweredSessionMode() {
  return getPowerProvider()?.runtime?.on ? "powered" : "idle";
}

function getCompletedSummary() {
  const completed = Object.entries(state.session.completed || {})
    .filter(([, isComplete]) => isComplete)
    .map(([action]) => getActionLabel(action));
  return completed.length > 0 ? completed.join(", ") : "None";
}

function getActionLabel(action) {
  const labels = {
    default: "Default",
    scan: "Scan",
    diagnosis: "Diagnosis",
    broadcast: "Broadcast",
    neutralize: "Neutralize",
    custom: "Custom",
  };
  return labels[action] || titleCase(action);
}

function getPowerProvider(except = null) {
  return state.elements.find((element) => element !== except && element.behavior?.providesPower);
}

function hasAnyWell() {
  return state.elements.some((element) => element.type === "well");
}

function hasLoadedWell() {
  return state.elements.some((element) => element.type === "well" && element.runtime?.hasContent);
}

function getDefaultStep(type) {
  if (type === "knob") return 10;
  if (type === "slider" || type === "meter" || type === "resonance") return 20;
  return 1;
}

function getDefaultMin(type) {
  return type === "knob" ? 0 : 0;
}

function getDefaultMax(type) {
  return type === "knob" ? 100 : 100;
}

function getDefaultArcMin(type) {
  return type === "knob" ? 0 : 0;
}

function getDefaultArcMax(type) {
  return type === "knob" ? 270 : 270;
}

function usesStepValue(type) {
  return type === "knob" || type === "slider" || type === "meter" || type === "resonance";
}

function usesRangeValue(type) {
  return type === "knob";
}

function getBehaviorStep(element) {
  const range = getBehaviorMax(element) - getBehaviorMin(element);
  return clampNumber(Number(element.behavior?.step), 1, Math.max(1, range), getDefaultStep(element.type));
}

function getBehaviorMin(element) {
  return Number.isFinite(Number(element?.behavior?.min)) ? Number(element.behavior.min) : getDefaultMin(element?.type);
}

function getBehaviorMax(element) {
  return Number.isFinite(Number(element?.behavior?.max)) ? Number(element.behavior.max) : getDefaultMax(element?.type);
}

function getBehaviorArcMin(element) {
  return Number.isFinite(Number(element?.behavior?.arcMin)) ? Number(element.behavior.arcMin) : getDefaultArcMin(element?.type);
}

function getBehaviorArcMax(element) {
  return Number.isFinite(Number(element?.behavior?.arcMax)) ? Number(element.behavior.arcMax) : getDefaultArcMax(element?.type);
}

function normalizeValueRange(behavior) {
  if (!Number.isFinite(Number(behavior.min))) {
    behavior.min = 0;
  }

  if (!Number.isFinite(Number(behavior.max))) {
    behavior.max = 100;
  }

  behavior.min = Math.round(Number(behavior.min));
  behavior.max = Math.round(Number(behavior.max));

  if (behavior.max <= behavior.min) {
    behavior.max = behavior.min + 1;
  }

  behavior.step = clampNumber(Number(behavior.step), 1, Math.max(1, behavior.max - behavior.min), getDefaultStep("knob"));
  return behavior;
}

function normalizeArcRange(behavior) {
  if (!Number.isFinite(Number(behavior.arcMin))) {
    behavior.arcMin = 0;
  }

  if (!Number.isFinite(Number(behavior.arcMax))) {
    behavior.arcMax = 270;
  }

  behavior.arcMin = Math.round(Number(behavior.arcMin));
  behavior.arcMax = Math.round(Number(behavior.arcMax));

  if (behavior.arcMax === behavior.arcMin) {
    behavior.arcMax = behavior.arcMin + 1;
  }

  return behavior;
}

function adjustValueRuntime(element, direction = 1) {
  const runtime = element.runtime || createRuntimeState(element.type);
  const min = getBehaviorMin(element);
  const max = getBehaviorMax(element);
  const nextValue = clampNumber(Number(runtime.value) + getBehaviorStep(element) * direction, min, max, min);
  return { ...runtime, value: nextValue };
}

function clampRuntimeValue(element) {
  const runtime = element.runtime || createRuntimeState(element.type);
  if (typeof runtime.value !== "number") return runtime;
  return { ...runtime, value: clampNumber(runtime.value, getBehaviorMin(element), getBehaviorMax(element), getBehaviorMin(element)) };
}

function normalizeElements(elements) {
  if (!Array.isArray(elements)) return [];

  let hasPowerProvider = false;
  return elements.map((element) => {
    const normalized = normalizeElement(element, hasPowerProvider);
    hasPowerProvider = hasPowerProvider || Boolean(normalized.behavior?.providesPower);
    return normalized;
  });
}

function normalizeElement(element, hasPowerProvider = Boolean(getPowerProvider())) {
  const type = element.type || "button";
  const rawBehavior = element.behavior || {};
  const hasExplicitPowerProvider = Object.hasOwn(rawBehavior, "providesPower");
  const behavior = { ...createDefaultBehavior(type, null, hasPowerProvider), ...rawBehavior };
  if (usesRangeValue(type)) {
    normalizeValueRange(behavior);
    normalizeArcRange(behavior);
  }

  if (type === "toggle" && !hasExplicitPowerProvider) {
    behavior.providesPower = !hasPowerProvider;
    behavior.requiresPower = hasPowerProvider;
  }

  return {
    ...element,
    label: typeof element.label === "string" ? element.label : "",
    type,
    behavior,
    runtime: createRuntimeState(type),
  };
}

function serializeElement(element) {
  const { flashUntil, runtime, ...projectElement } = element;
  return projectElement;
}

function buildProjectSummary(elements = state.elements, background = { width: canvas.width, height: canvas.height }) {
  const serializableElements = elements.map((element) => ("runtime" in element ? serializeElement(element) : element));
  const typeCounts = {};
  const operationCounts = {};
  const powerProviderIds = [];
  let requiresPowerCount = 0;
  let requiresWellCount = 0;

  serializableElements.forEach((element) => {
    const type = element.type || "unknown";
    const action = element.behavior?.action || "default";
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    if (action !== "default") {
      operationCounts[action] = (operationCounts[action] || 0) + 1;
    }

    if (element.behavior?.providesPower) {
      powerProviderIds.push(element.id);
    }

    if (element.behavior?.requiresPower) {
      requiresPowerCount += 1;
    }

    if (element.behavior?.requiresWell) {
      requiresWellCount += 1;
    }
  });

  return {
    elementCount: serializableElements.length,
    operationCount: Object.values(operationCounts).reduce((total, count) => total + count, 0),
    typeCounts,
    operationCounts,
    powerProviderIds,
    requiresPowerCount,
    requiresWellCount,
    canvas: {
      width: Number(background?.width) || canvas.width,
      height: Number(background?.height) || canvas.height,
    },
  };
}

function getProjectFileName(manifest) {
  const name = slugify(manifest.name || "aetherone-device");
  const version = slugify(manifest.version || "0.1.0");
  return `${name}-${version}.json`;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "aetherone-device";
}

function getRuntimeSummary(element) {
  const runtime = element.runtime || createRuntimeState(element.type);
  if (element.type === "toggle" || element.type === "led") return runtime.on ? "on" : "off";
  if (element.type === "well") return runtime.hasContent ? "occupied" : "empty";
  if (element.type === "display") return runtime.text || "READY";
  if (element.type === "knob") return String(clampNumber(Number(runtime.value), getBehaviorMin(element), getBehaviorMax(element), getBehaviorMin(element)));
  if (typeof runtime.value === "number") return `${runtime.value}%`;
  return "triggered";
}

function getKnobRotationRadians(element) {
  const runtime = element.runtime || createRuntimeState(element.type);
  const min = getBehaviorMin(element);
  const max = getBehaviorMax(element);
  const value = clampNumber(Number(runtime.value), min, max, min);
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const arcMin = getBehaviorArcMin(element);
  const arcMax = getBehaviorArcMax(element);
  return (arcMin + ratio * (arcMax - arcMin)) * (Math.PI / 180);
}

function getElementTypeStyle(element) {
  const runtime = element.runtime || {};
  if ((element.type === "toggle" || element.type === "led") && runtime.on) {
    return { stroke: "#9ee66e", fill: "rgba(158, 230, 110, 0.18)" };
  }

  if (element.type === "well" && runtime.hasContent) {
    return { stroke: "#76a9ff", fill: "rgba(118, 169, 255, 0.18)" };
  }

  if (element.type === "meter" || element.type === "resonance") {
    return { stroke: "#e7d46a", fill: "rgba(231, 212, 106, 0.15)" };
  }

  return { stroke: "#54c3b1", fill: "rgba(84, 195, 177, 0.14)" };
}

function getFlashStyle(element) {
  if (element.flashKind === "blocked") {
    return { stroke: "#e05f5f", fill: "rgba(224, 95, 95, 0.26)" };
  }

  return { stroke: "#fff4a3", fill: "rgba(255, 244, 163, 0.26)" };
}

function drawRuntimeState(element) {
  if (state.mode !== "simulate" || !element.behavior?.showValue) return;

  const anchor = getHitAreaAnchor(element.hitArea);
  const summary = getRuntimeSummary(element);
  ctx.save();
  ctx.font = "700 13px Segoe UI, Arial, sans-serif";
  const width = ctx.measureText(summary).width + 18;
  ctx.fillStyle = "rgba(7, 9, 11, 0.82)";
  ctx.fillRect(anchor.x - width / 2, anchor.y + 6, width, 24);
  ctx.fillStyle = "#c9fff7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(summary, anchor.x, anchor.y + 18);
  ctx.restore();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function getCanvasUnitsPerCssPixel() {
  const rect = canvas.getBoundingClientRect();
  return canvas.width / rect.width;
}

function getHandleAt(point) {
  const selected = getSelectedElement();
  if (!selected) return null;

  return getResizeHandles(selected).find((handle) => {
    const half = handle.size / 2;
    return point.x >= handle.x - half && point.x <= handle.x + half && point.y >= handle.y - half && point.y <= handle.y + half;
  });
}

function getResizeHandles(element) {
  const hitArea = element.hitArea;
  const size = Math.max(8, getCanvasUnitsPerCssPixel() * 10);

  if (hitArea.shape === "rect") {
    return [
      { element, name: "nw", x: hitArea.x, y: hitArea.y, size },
      { element, name: "ne", x: hitArea.x + hitArea.w, y: hitArea.y, size },
      { element, name: "sw", x: hitArea.x, y: hitArea.y + hitArea.h, size },
      { element, name: "se", x: hitArea.x + hitArea.w, y: hitArea.y + hitArea.h, size },
    ];
  }

  if (hitArea.shape === "circle") {
    return [{ element, name: "radius", x: hitArea.x + hitArea.radius, y: hitArea.y, size }];
  }

  return hitArea.points.map((point, index) => ({ element, name: `vertex:${index}`, x: point.x, y: point.y, size }));
}

function draftToHitArea(draft) {
  const x1 = Math.min(draft.start.x, draft.end.x);
  const y1 = Math.min(draft.start.y, draft.end.y);
  const x2 = Math.max(draft.start.x, draft.end.x);
  const y2 = Math.max(draft.start.y, draft.end.y);

  if (draft.shape === "rect") {
    return { shape: "rect", x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  }

  const radius = Math.max(x2 - x1, y2 - y1) / 2;
  return {
    shape: "circle",
    x: Math.round((x1 + x2) / 2),
    y: Math.round((y1 + y2) / 2),
    radius: Math.round(radius),
  };
}

function isUsefulHitArea(hitArea) {
  if (hitArea.shape === "rect") return hitArea.w > 8 && hitArea.h > 8;
  if (hitArea.shape === "circle") return hitArea.radius > 6;
  if (hitArea.shape === "polygon") return hitArea.points.length >= 3;
  return false;
}

function moveHitArea(hitArea, dx, dy) {
  if (hitArea.shape === "rect") {
    return { ...hitArea, x: Math.round(hitArea.x + dx), y: Math.round(hitArea.y + dy) };
  }

  if (hitArea.shape === "circle") {
    return { ...hitArea, x: Math.round(hitArea.x + dx), y: Math.round(hitArea.y + dy) };
  }

  return {
    ...hitArea,
    points: hitArea.points.map((point) => ({ x: Math.round(point.x + dx), y: Math.round(point.y + dy) })),
  };
}

function moveHitAreaToPoint(hitArea, point) {
  const center = getHitAreaCenter(hitArea);
  return moveHitArea(hitArea, point.x - center.x, point.y - center.y);
}

function resizeHitArea(hitArea, handle, point) {
  if (hitArea.shape === "rect") {
    let left = hitArea.x;
    let top = hitArea.y;
    let right = hitArea.x + hitArea.w;
    let bottom = hitArea.y + hitArea.h;

    if (handle.includes("n")) top = point.y;
    if (handle.includes("s")) bottom = point.y;
    if (handle.includes("w")) left = point.x;
    if (handle.includes("e")) right = point.x;

    if (right - left < 10) {
      handle.includes("w") ? (left = right - 10) : (right = left + 10);
    }

    if (bottom - top < 10) {
      handle.includes("n") ? (top = bottom - 10) : (bottom = top + 10);
    }

    return {
      shape: "rect",
      x: Math.round(left),
      y: Math.round(top),
      w: Math.round(right - left),
      h: Math.round(bottom - top),
    };
  }

  if (hitArea.shape === "circle") {
    return {
      ...hitArea,
      radius: Math.max(7, Math.round(Math.hypot(point.x - hitArea.x, point.y - hitArea.y))),
    };
  }

  const vertexIndex = Number(handle.split(":")[1]);
  return {
    ...hitArea,
    points: hitArea.points.map((vertex, index) => (index === vertexIndex ? { x: Math.round(point.x), y: Math.round(point.y) } : vertex)),
  };
}

function findElementAt(point) {
  return [...state.elements].reverse().find((element) => containsPoint(element.hitArea, point));
}

function containsPoint(hitArea, point) {
  if (hitArea.shape === "rect") {
    return point.x >= hitArea.x && point.x <= hitArea.x + hitArea.w && point.y >= hitArea.y && point.y <= hitArea.y + hitArea.h;
  }

  if (hitArea.shape === "circle") {
    return Math.hypot(point.x - hitArea.x, point.y - hitArea.y) <= hitArea.radius;
  }

  if (hitArea.shape === "polygon") {
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

  return false;
}

function getHitAreaAnchor(hitArea) {
  if (hitArea.shape === "rect") return { x: hitArea.x + hitArea.w / 2, y: hitArea.y };
  if (hitArea.shape === "circle") return { x: hitArea.x, y: hitArea.y - hitArea.radius };
  const sum = hitArea.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / hitArea.points.length, y: sum.y / hitArea.points.length };
}

function getHitAreaCenter(hitArea) {
  if (hitArea.shape === "rect") return { x: hitArea.x + hitArea.w / 2, y: hitArea.y + hitArea.h / 2 };
  if (hitArea.shape === "circle") return { x: hitArea.x, y: hitArea.y };
  const sum = hitArea.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / hitArea.points.length, y: sum.y / hitArea.points.length };
}

function getSelectedElement() {
  return state.elements.find((element) => element.id === state.selectedId);
}

function nextElementId(prefix) {
  let id;
  do {
    id = `${prefix}${state.nextElementNumber}`;
    state.nextElementNumber += 1;
  } while (state.elements.some((element) => element.id === id));
  return id;
}

function nextGroupedElementId(id) {
  const parsed = parseElementIdGroup(id);
  const highest = state.elements.reduce((max, element) => {
    const candidate = parseElementIdGroup(element.id);
    return candidate.prefix === parsed.prefix ? Math.max(max, candidate.number) : max;
  }, 0);
  return `${parsed.prefix}${highest + 1}`;
}

function parseElementIdGroup(id) {
  const match = String(id || "ELEMENT").match(/^(.*?)(\d+)$/);
  if (match) {
    return {
      prefix: match[1] || "ELEMENT",
      number: Number(match[2]),
    };
  }

  return {
    prefix: String(id || "ELEMENT"),
    number: 0,
  };
}

function sanitizeId(value) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "");
  return normalized || state.selectedId || nextElementId("element");
}

function wrapValue(value, min, max) {
  return value > max ? min : Math.max(min, value);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function titleCase(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function setStatus(message) {
  statusText.textContent = message;
}

function setZoom(zoom) {
  state.zoom = zoom;
  updateCanvasScale();
}

function stepZoom(direction) {
  const levels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  const current = state.zoom === "fit" ? 1 : state.zoom;
  const index = levels.reduce((nearest, level, candidateIndex) => {
    return Math.abs(level - current) < Math.abs(levels[nearest] - current) ? candidateIndex : nearest;
  }, 0);
  const nextIndex = Math.min(levels.length - 1, Math.max(0, index + direction));
  setZoom(levels[nextIndex]);
}

function updateCanvasScale() {
  if (state.zoom === "fit") {
    const hostStyle = getComputedStyle(canvasHost);
    const horizontalPadding = parseFloat(hostStyle.paddingLeft) + parseFloat(hostStyle.paddingRight);
    const verticalPadding = parseFloat(hostStyle.paddingTop) + parseFloat(hostStyle.paddingBottom);
    const availableWidth = Math.max(1, canvasHost.clientWidth - horizontalPadding);
    const availableHeight = Math.max(1, canvasHost.clientHeight - verticalPadding);
    const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
    canvas.style.width = `${Math.max(1, Math.floor(canvas.width * scale))}px`;
    canvas.style.height = "auto";
    zoomFitButton.classList.add("is-active");
    zoomActualButton.classList.remove("is-active");
    return;
  }

  canvas.style.width = `${Math.round(canvas.width * state.zoom)}px`;
  canvas.style.height = "auto";
  zoomFitButton.classList.remove("is-active");
  zoomActualButton.classList.toggle("is-active", state.zoom === 1);
}

function onKeyDown(event) {
  if (handleSimulationKey(event)) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;

  if (state.mode === "edit" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    if (copySelectedElement()) {
      event.preventDefault();
    }
    return;
  }

  if (state.mode === "edit" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    if (pasteCopiedElement()) {
      event.preventDefault();
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redoProjectChange();
    else undoProjectChange();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redoProjectChange();
    return;
  }

  if (event.key !== "Delete" && event.key !== "Backspace") return;
  deleteSelected();
}

function handleSimulationKey(event) {
  if (state.mode !== "simulate") return false;
  if (event.key !== "+" && event.key !== "=" && event.key !== "-" && event.key !== "_") return false;

  const hovered = state.elements.find((element) => element.id === state.hoveredId);
  if (!hovered || hovered.type !== "knob") return false;

  event.preventDefault();
  triggerElement(hovered, { direction: event.key === "-" || event.key === "_" ? -1 : 1 });
  return true;
}

function releasePointer(event) {
  if (!Number.isInteger(event?.pointerId) || !canvas.hasPointerCapture(event.pointerId)) return;
  canvas.releasePointerCapture(event.pointerId);
}

function getCanvasCursor(point, hit = findElementAt(point)) {
  if (state.mode === "simulate") {
    return hit?.type === "knob" ? "ew-resize" : hit ? "pointer" : "";
  }

  if (state.mode === "edit" && state.tool === "select" && getHandleAt(point)) {
    return "nwse-resize";
  }

  return "";
}

function getProjectSnapshot() {
  return {
    manifest: normalizeManifest(state.manifest),
    backgroundSrc: state.backgroundSrc,
    backgroundExportSrc: state.backgroundExportSrc,
    elements: state.elements.map(serializeElement),
    selectedId: state.selectedId,
    nextElementNumber: state.nextElementNumber,
  };
}

function commitHistory() {
  if (state.history.restoring) return;

  const snapshot = getProjectSnapshot();
  const previous = state.history.undo.at(-1);
  if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) {
    return;
  }

  state.history.undo.push(snapshot);
  if (state.history.undo.length > 80) {
    state.history.undo.shift();
  }

  state.history.redo = [];
  state.history.dirty = true;
  updateHistoryControls();
}

function undoProjectChange() {
  if (state.history.undo.length === 0) return;

  const current = getProjectSnapshot();
  const snapshot = state.history.undo.pop();
  state.history.redo.push(current);
  restoreProjectSnapshot(snapshot);
  state.history.dirty = true;
  setStatus("Undo applied.");
  updateHistoryControls();
}

function redoProjectChange() {
  if (state.history.redo.length === 0) return;

  const current = getProjectSnapshot();
  const snapshot = state.history.redo.pop();
  state.history.undo.push(current);
  restoreProjectSnapshot(snapshot);
  state.history.dirty = true;
  setStatus("Redo applied.");
  updateHistoryControls();
}

function restoreProjectSnapshot(snapshot) {
  state.history.restoring = true;
  state.manifest = normalizeManifest(snapshot.manifest);
  state.elements = normalizeElements(snapshot.elements);
  state.selectedId = snapshot.selectedId || null;
  state.nextElementNumber = snapshot.nextElementNumber || state.elements.length + 1;
  state.backgroundExportSrc = snapshot.backgroundExportSrc || snapshot.backgroundSrc || "src/docs/prototype.jpg";

  if (snapshot.backgroundSrc && snapshot.backgroundSrc !== state.backgroundSrc) {
    restoreBackgroundSource(snapshot.backgroundSrc, state.backgroundExportSrc);
  }

  resetSession();
  refreshEditor();
  state.history.restoring = false;
}

function restoreBackgroundSource(src, exportSrc) {
  const nextBackground = new Image();

  nextBackground.addEventListener(
    "load",
    () => {
      state.backgroundSrc = src;
      state.backgroundExportSrc = exportSrc;
      state.background = nextBackground;
      canvas.width = nextBackground.naturalWidth || 1280;
      canvas.height = nextBackground.naturalHeight || 860;
      updateCanvasScale();
      render();
    },
    { once: true },
  );

  nextBackground.addEventListener(
    "error",
    () => {
      setStatus("Could not restore the background image from history.");
    },
    { once: true },
  );

  nextBackground.src = src;
}

function updateHistoryControls() {
  undoButton.disabled = state.history.undo.length === 0;
  redoButton.disabled = state.history.redo.length === 0;
  dirtyBadge.textContent = state.history.dirty ? "Unsaved" : "Saved";
  dirtyBadge.classList.toggle("is-clean", !state.history.dirty);
}

renderProperties();
renderManifest();
renderElementList();
renderValidation();
renderSession();
updateHistoryControls();
