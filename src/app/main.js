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
const valueStep = document.querySelector("#valueStep");
const validationList = document.querySelector("#validationList");
const resetSessionButton = document.querySelector("#resetSessionButton");
const sessionMode = document.querySelector("#sessionMode");
const sessionEventCount = document.querySelector("#sessionEventCount");
const sessionBlockedCount = document.querySelector("#sessionBlockedCount");
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
  draft: null,
  drag: null,
  resize: null,
  polygonDraft: null,
  nextElementNumber: 1,
  session: {
    mode: "idle",
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
    selected.behavior.step = clampNumber(Number(valueStep.value), 1, 100, selected.behavior.step || getDefaultStep(selected.type));
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
  const hit = findElementAt(point);

  if (state.mode === "simulate") {
    if (hit) {
      const scrollLeft = canvasHost.scrollLeft;
      const scrollTop = canvasHost.scrollTop;
      triggerElement(hit);
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

  canvas.style.cursor = state.mode === "edit" && state.tool === "select" && getHandleAt(point) ? "nwse-resize" : "";
}

function onPointerUp(event) {
  event.preventDefault();
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

function addElement(hitArea) {
  commitHistory();
  const shape = hitArea.shape;
  const id = nextElementId(shape);
  const type = elementDefaults[shape] || "button";
  const element = {
    id,
    type,
    label: id,
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
    background: {
      src: state.backgroundExportSrc,
      width: canvas.width,
      height: canvas.height,
    },
    elements: state.elements.map(serializeElement),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "aetherone-device.json";
  link.click();
  URL.revokeObjectURL(url);
  state.history.dirty = false;
  updateHistoryControls();
  setStatus("Project JSON exported.");
}

function importProject(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const project = JSON.parse(reader.result);
      commitHistory();
      state.manifest = normalizeManifest(project.manifest);
      state.elements = normalizeElements(project.elements);
      state.selectedId = null;
      state.nextElementNumber = state.elements.length + 1;
      resetSession();
      setBackgroundFromSource(project.background?.src || "src/docs/prototype.jpg", `Imported project: ${file.name}`);
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

function drawLabel(element) {
  const anchor = getHitAreaAnchor(element.hitArea);
  const label = element.label || element.id;
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
  [behaviorAction, providesPower, requiresPower, requiresWell, valueStep].forEach((input) => {
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
  valueStep.value = behavior.step || getDefaultStep(selected?.type || "button");
  valueStep.disabled = disabled || !usesStepValue(selected?.type);
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
    button.textContent = `${element.label || element.id} (${element.type})`;
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

    if (!element.label.trim()) {
      messages.push(`${element.id || "Unnamed element"} needs a label.`);
    }

    if (!isUsefulHitArea(element.hitArea)) {
      messages.push(`${element.id || "Unnamed element"} has a region that is too small.`);
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

function triggerElement(element) {
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
      element.runtime.value = wrapValue((element.runtime.value || 0) + getBehaviorStep(element), 0, 100);
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
    element.runtime.value = wrapValue((element.runtime.value || 0) + getBehaviorStep(element), 0, 100);
    logEvent(element, `Value set to ${element.runtime.value}.`);
  } else if (element.type === "slider" || element.type === "meter" || element.type === "resonance") {
    element.runtime.value = wrapValue((element.runtime.value || 0) + getBehaviorStep(element), 0, 100);
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
  if (element.behavior?.providesPower || (state.elements.length === 1 && action === "default")) {
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

  const hasAnyWell = state.elements.some((candidate) => candidate.type === "well");
  const hasLoadedWell = state.elements.some((candidate) => candidate.type === "well" && candidate.runtime?.hasContent);
  const requiresWell = Boolean(element.behavior?.requiresWell);
  if (requiresWell && hasAnyWell && !hasLoadedWell) {
    return { allowed: false, reason: "Load a well before this operation." };
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
  state.session = { mode: "idle", events: [], blockedCount: 0, completed: {} };
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
    action: "default",
    step: getDefaultStep(type),
  };
}

function getBehaviorAction(element) {
  return element.behavior?.action || "default";
}

function applyBehaviorAction(element) {
  const action = getBehaviorAction(element);
  if (action === "default") return false;

  if (action === "scan") {
    state.session.mode = "scanning";
    logEvent(element, "Scan started.");
    return true;
  }

  if (action === "diagnosis") {
    state.session.mode = "diagnosis";
    logEvent(element, "Diagnosis mode active.");
    return true;
  }

  if (action === "broadcast") {
    state.session.mode = state.session.mode === "broadcasting" ? "powered" : "broadcasting";
    if (state.session.mode === "powered") {
      state.session.completed.broadcast = true;
      logEvent(element, "Broadcast completed.");
    } else {
      logEvent(element, "Broadcast started.");
    }
    return true;
  }

  if (action === "neutralize") {
    state.session.mode = "neutralizing";
    state.session.completed.neutralize = true;
    logEvent(element, "Neutralize sequence started.");
    return true;
  }

  if (action === "custom") {
    logEvent(element, "Custom event triggered.");
    return true;
  }

  return false;
}

function getPowerProvider(except = null) {
  return state.elements.find((element) => element !== except && element.behavior?.providesPower);
}

function getDefaultStep(type) {
  if (type === "knob") return 10;
  if (type === "slider" || type === "meter" || type === "resonance") return 20;
  return 1;
}

function usesStepValue(type) {
  return type === "knob" || type === "slider" || type === "meter" || type === "resonance";
}

function getBehaviorStep(element) {
  return clampNumber(Number(element.behavior?.step), 1, 100, getDefaultStep(element.type));
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

  if (type === "toggle" && !hasExplicitPowerProvider) {
    behavior.providesPower = !hasPowerProvider;
    behavior.requiresPower = hasPowerProvider;
  }

  return {
    ...element,
    label: element.label || element.id || "Element",
    type,
    behavior,
    runtime: createRuntimeState(type),
  };
}

function serializeElement(element) {
  const { flashUntil, runtime, ...projectElement } = element;
  return projectElement;
}

function getRuntimeSummary(element) {
  const runtime = element.runtime || createRuntimeState(element.type);
  if (element.type === "toggle" || element.type === "led") return runtime.on ? "on" : "off";
  if (element.type === "well") return runtime.hasContent ? "occupied" : "empty";
  if (element.type === "display") return runtime.text || "READY";
  if (typeof runtime.value === "number") return `${runtime.value}%`;
  return "triggered";
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
  if (state.mode !== "simulate") return;

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
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
  deleteSelected();
}

function releasePointer(event) {
  if (!Number.isInteger(event?.pointerId) || !canvas.hasPointerCapture(event.pointerId)) return;
  canvas.releasePointerCapture(event.pointerId);
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
