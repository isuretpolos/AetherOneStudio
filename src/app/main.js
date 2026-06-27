const canvas = document.querySelector("#deviceCanvas");
const ctx = canvas.getContext("2d");
const canvasHost = document.querySelector("#canvasHost");
const imageInput = document.querySelector("#imageInput");
const projectInput = document.querySelector("#projectInput");
const exportButton = document.querySelector("#exportButton");
const deleteButton = document.querySelector("#deleteButton");
const statusText = document.querySelector("#statusText");
const elementList = document.querySelector("#elementList");
const propertiesForm = document.querySelector("#propertiesForm");
const elementId = document.querySelector("#elementId");
const elementLabel = document.querySelector("#elementLabel");
const elementType = document.querySelector("#elementType");
const editModeButton = document.querySelector("#editModeButton");
const simulateModeButton = document.querySelector("#simulateModeButton");

const state = {
  mode: "edit",
  tool: "select",
  backgroundSrc: "src/docs/prototype.jpg",
  backgroundExportSrc: "src/docs/prototype.jpg",
  background: new Image(),
  backgroundObjectUrl: null,
  elements: [],
  selectedId: null,
  draft: null,
  drag: null,
  polygonDraft: null,
  nextElementNumber: 1,
};

const elementDefaults = {
  rect: "button",
  circle: "well",
  polygon: "display",
};

state.background.addEventListener("load", () => {
  canvas.width = state.background.naturalWidth || 1280;
  canvas.height = state.background.naturalHeight || 860;
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
deleteButton.addEventListener("click", deleteSelected);
exportButton.addEventListener("click", exportProject);
imageInput.addEventListener("change", importImage);
projectInput.addEventListener("change", importProject);
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointerleave", onPointerUp);
canvas.addEventListener("dblclick", finishPolygon);

propertiesForm.addEventListener("input", () => {
  const selected = getSelectedElement();
  if (!selected) return;

  selected.id = sanitizeId(elementId.value);
  selected.label = elementLabel.value.trim();
  selected.type = elementType.value;
  state.selectedId = selected.id;
  render();
  renderProperties();
  renderElementList();
});

function setTool(tool) {
  state.tool = tool;
  state.draft = null;
  state.drag = null;
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
  const point = getCanvasPoint(event);
  const hit = findElementAt(point);

  if (state.mode === "simulate") {
    if (hit) {
      state.selectedId = hit.id;
      setStatus(`${hit.label || hit.id} triggered.`);
      flashElement(hit.id);
    }
    return;
  }

  if (state.tool === "select") {
    state.selectedId = hit?.id ?? null;
    if (hit) {
      state.drag = { id: hit.id, start: point, original: structuredClone(hit.hitArea) };
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
  const point = getCanvasPoint(event);

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
  }
}

function onPointerUp() {
  if (state.drag) {
    state.drag = null;
    renderProperties();
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
  const shape = hitArea.shape;
  const id = nextElementId(shape);
  const element = {
    id,
    type: elementDefaults[shape] || "button",
    label: id,
    hitArea,
    states: shape === "rect" ? ["idle", "active"] : undefined,
    initial: shape === "rect" ? "idle" : undefined,
  };
  state.elements.push(element);
  state.selectedId = element.id;
  setTool("select");
  renderProperties();
  renderElementList();
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
  state.elements = state.elements.filter((element) => element.id !== state.selectedId);
  state.selectedId = null;
  render();
  renderProperties();
  renderElementList();
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
      if (state.backgroundObjectUrl) {
        URL.revokeObjectURL(state.backgroundObjectUrl);
      }

      state.backgroundObjectUrl = objectUrl;
      state.backgroundSrc = objectUrl;
      state.background = nextBackground;
      canvas.width = nextBackground.naturalWidth || 1280;
      canvas.height = nextBackground.naturalHeight || 860;
      render();
      imageInput.value = "";
      setStatus(`Imported image: ${file.name}`);
      persistImportedBackground(file);
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
  }
}

function exportProject() {
  const payload = {
    manifest: {
      name: "AetherOne Studio Device",
      version: "0.1.0",
      formatVersion: 1,
    },
    background: {
      src: state.backgroundExportSrc,
      width: canvas.width,
      height: canvas.height,
    },
    elements: state.elements,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "aetherone-device.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importProject(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const project = JSON.parse(reader.result);
      state.elements = Array.isArray(project.elements) ? project.elements : [];
      state.selectedId = null;
      state.nextElementNumber = state.elements.length + 1;
      setBackgroundFromSource(project.background?.src || "src/docs/prototype.jpg", `Imported project: ${file.name}`);
      renderProperties();
      renderElementList();
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
  drawHitArea(element.hitArea, {
    stroke: active ? "#fff4a3" : selected ? "#f2b84b" : "#54c3b1",
    fill: active ? "rgba(255, 244, 163, 0.26)" : selected ? "rgba(242, 184, 75, 0.18)" : "rgba(84, 195, 177, 0.14)",
    lineWidth: selected ? 3 : 2,
  });
  drawLabel(element);
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

function renderProperties() {
  const selected = getSelectedElement();
  const disabled = !selected;
  [elementId, elementLabel, elementType].forEach((input) => {
    input.disabled = disabled;
  });
  deleteButton.disabled = disabled;

  elementId.value = selected?.id || "";
  elementLabel.value = selected?.label || "";
  elementType.value = selected?.type || "button";
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

function flashElement(id) {
  const element = state.elements.find((item) => item.id === id);
  if (!element) return;
  element.flashUntil = performance.now() + 260;
  render();
  window.setTimeout(render, 280);
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
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

function setStatus(message) {
  statusText.textContent = message;
}

renderProperties();
renderElementList();
