/**
 * The 3D view's engine (in the lazy 3D chunk): renderer, scene, an orthographic true-isometric
 * camera (corner b) with map controls, drawn only when something changes. One engine per mount;
 * dispose() frees every geometry, material, texture and render target, then the context itself.
 */
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ReviewState } from "../review";
import { clampTarget, orbitOffset } from "./camera";
import { BUILDERS, buildFitting, buildRun, COLORS, isPipe, type MaterialKey, type Part } from "./kit";
import type { PlantModel } from "./plantModel";
import { fitPlantView } from "./fit";

export interface Layers {
  cw: boolean;
  chw: boolean;
  valves: boolean;
  instruments: boolean;
  names: boolean;
}
export type ColourBy = "medium" | "review";
export interface EngineState {
  selectedId: string | null;
  traceIds: ReadonlySet<string>;
  findingIds: ReadonlySet<string>;
  layers: Layers;
  colourBy: ColourBy;
  reviewStates: Record<string, ReviewState>;
}
export interface Engine {
  update(state: EngineState): void;
  fit(): void;
  reset(): void;
  plan(): void;
  focus(id: string): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  orbitBy(azimuthDegrees: number, polarDegrees?: number): void;
  project(x: number, y: number, z: number): [number, number];
  dispose(): void;
}
export interface FitLabel {
  id: string;
  at: readonly [number, number, number];
  width: number;
  height: number;
  priority: number;
}
export interface EngineEvents {
  pick(owner: string): void;
  lost(): void;
  frame(): void;
  fitLabels?: () => FitLabel[];
}

const ELEVATION = Math.atan(Math.SQRT1_2);
const AZIMUTH = -Math.PI / 4;
const PAD = 32;
const CLICK_PX = { mouse: 5, touch: 10, pen: 6 } as Record<string, number>;
const REVIEW_COLOURS: Record<ReviewState, number> = { confirmed: 0x46d37e, review: 0xf6c343, unknown: 0x8c97aa };

export function createEngine(host: HTMLElement, model: PlantModel, events: EngineEvents, { software, initial }: { software: boolean; initial: EngineState }): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: !software, alpha: true });
  renderer.setPixelRatio(software ? 1 : Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.info.autoReset = false;
  host.dataset.software = String(software);
  host.dataset.equipment = String(model.equipment.length);
  host.dataset.runs = String(model.runs.length);
  host.dataset.fittings = String(model.fittings.length);
  const canvas = renderer.domElement;
  canvas.className = "cad-3d__canvas";
  host.prepend(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.5;

  const parts: Part[] = [];
  for (const e of model.equipment) BUILDERS[e.kind]?.(parts, e);
  for (const run of model.runs) buildRun(parts, run);
  for (const fitting of model.fittings) buildFitting(parts, fitting);
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const materialFor = (key: MaterialKey, dim: boolean, review?: ReviewState) => {
    const cacheKey = `${key}|${dim ? 1 : 0}|${review ?? ""}`;
    let material = materialCache.get(cacheKey);
    if (!material) {
      const pipe = isPipe(key);
      const color = new THREE.Color(COLORS[key]);
      if (review) color.lerpColors(color, new THREE.Color(REVIEW_COLOURS[review]), 0.58);
      if (dim) color.multiplyScalar(0.3);
      material = new THREE.MeshStandardMaterial({ color, roughness: pipe ? 0.42 : 0.62, metalness: pipe ? 0.05 : 0.1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      materialCache.set(cacheKey, material);
    }
    return material;
  };
  const group = (list: Part[], key: (p: Part) => string) => {
    const map = new Map<string, Part[]>();
    for (const p of list) map.set(key(p), [...(map.get(key(p)) ?? []), p]);
    return [...map.values()];
  };
  const content = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const edgeMeshes: THREE.LineSegments[] = [];
  const bounds = new THREE.Box3();
  for (const list of group(parts, (p) => `${p.owner}|${p.material}`)) {
    const geometry = list.length === 1 ? list[0].geometry : mergeGeometries(list.map((p) => p.geometry));
    const mesh = new THREE.Mesh(geometry, materialFor(list[0].material, false));
    mesh.userData = { owner: list[0].owner, equipment: !isPipe(list[0].material), layer: list[0].layer, material: list[0].material };
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    meshes.push(mesh);
    content.add(mesh);
  }
  if (!meshes.length) throw new Error("No supported 3D geometry in this view");
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1b1e22, transparent: true, opacity: 0.4 });
  for (const list of group(parts.filter((p) => p.edges), (p) => p.owner)) {
    const edges = new THREE.LineSegments(mergeGeometries(list.map((p) => new THREE.EdgesGeometry(p.geometry, 30))), edgeMaterial);
    edges.userData = { owner: list[0].owner, layer: list[0].layer };
    edgeMeshes.push(edges);
    content.add(edges);
  }
  for (const p of parts) if (!meshes.some((m) => m.geometry === p.geometry)) p.geometry.dispose();
  scene.add(content);
  const center = bounds.getCenter(new THREE.Vector3());

  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.copy(center).addScaledVector(new THREE.Vector3(-0.4, 2.2, 0.8).normalize(), 2000);
  key.target.position.copy(center);
  scene.add(key, key.target, new THREE.HemisphereLight(0xdde3ea, 0x1e2226, 0.3));

  const grid = (step: number, skip: number, opacity: number) => {
    const vertices: number[] = [];
    const x0 = Math.floor((bounds.min.x - 200) / 200) * 200, x1 = Math.ceil((bounds.max.x + 200) / 200) * 200;
    const z0 = Math.floor((bounds.min.z - 200) / 200) * 200, z1 = Math.ceil((bounds.max.z + 200) / 200) * 200;
    for (let x = x0; x <= x1; x += step) if (!skip || x % skip) vertices.push(x, 0.05, z0, x, 0.05, z1);
    for (let z = z0; z <= z1; z += step) if (!skip || z % skip) vertices.push(x0, 0.05, z, x1, 0.05, z);
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, toneMapped: false }),
    );
  };
  const shadows = (() => {
    const pad = 60, k = 0.75;
    const x0 = bounds.min.x - pad, z0 = bounds.min.z - pad, w = bounds.max.x - bounds.min.x + 2 * pad, d = bounds.max.z - bounds.min.z + 2 * pad;
    const image = Object.assign(document.createElement("canvas"), { width: Math.ceil(w * k), height: Math.ceil(d * k) });
    const g = image.getContext("2d");
    if (g) {
      g.filter = "blur(6px)";
      g.fillStyle = "#000";
      for (const e of model.equipment) g.fillRect((e.x - x0 + 2) * k, (e.z - z0 + 2) * k, (e.width - 4) * k, (e.depth - 4) * k);
    }
    const texture = new THREE.CanvasTexture(image);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x0 + w / 2, 0.1, z0 + d / 2);
    return plane;
  })();
  scene.add(grid(40, 200, 0.024), grid(200, 0, 0.05), shadows);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  const direction = new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION));
  const planDirection = new THREE.Vector3(0, 1, 0);
  let scale = 1;
  let preset = "isometric";
  let state = initial;
  let selected: string | null = initial.selectedId;
  const size = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) });
  const frustum = () => {
    const { w, h } = size();
    Object.assign(camera, { left: (-w * scale) / 2, right: (w * scale) / 2, top: (h * scale) / 2, bottom: (-h * scale) / 2 });
    camera.updateProjectionMatrix();
  };
  const controls = new MapControls(camera, canvas);
  controls.cursorStyle = "grab";
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = (80 * Math.PI) / 180;
  controls.minAzimuthAngle = Number.NEGATIVE_INFINITY;
  controls.maxAzimuthAngle = Number.POSITIVE_INFINITY;
  controls.minZoom = 0.5;
  controls.maxZoom = 8;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.addEventListener("start", () => {
    preset = "custom";
    host.dataset.focus = "";
  });

  const fitTo = (dir: THREE.Vector3, nextPreset = preset) => {
    const { w, h } = size();
    camera.up.copy(Math.abs(dir.y) > 0.999 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0));
    camera.position.copy(center).addScaledVector(dir, 5000);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    for (const mesh of meshes) {
      const b = mesh.geometry.boundingBox!;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) box.expandByPoint(corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    }
    const labels = (events.fitLabels?.() ?? []).map((label) => {
      const projected = corner.set(...label.at).applyMatrix4(camera.matrixWorldInverse);
      return { id: label.id, x: projected.x, y: projected.y, width: label.width, height: label.height, priority: label.priority };
    });
    const fit = fitPlantView({ minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y }, labels, w, h, PAD);
    scale = fit.scale;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const target = center.clone().addScaledVector(right, fit.rightOffset).addScaledVector(up, fit.upOffset);
    camera.position.copy(target).addScaledVector(dir, 5000);
    camera.lookAt(target);
    camera.zoom = 1;
    frustum();
    controls.target.copy(target);
    controls.update();
    camera.updateMatrixWorld();
    host.dataset.fitBounds = [fit.bounds.left, fit.bounds.top, fit.bounds.right, fit.bounds.bottom].map((value) => value.toFixed(2)).join(",");
    preset = nextPreset;
    host.dataset.focus = "";
  };

  let maskTarget: THREE.WebGLRenderTarget | null = null;
  const maskScene = new THREE.Scene();
  const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const outlineMaterial = new THREE.ShaderMaterial({
    uniforms: { mask: { value: null }, px: { value: new THREE.Vector2() } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform sampler2D mask; uniform vec2 px; varying vec2 vUv;
      void main() {
        float self = texture2D(mask, vUv).r, d = 9.0;
        for (int x = -5; x <= 5; x++) for (int y = -5; y <= 5; y++) {
          vec2 o = vec2(float(x), float(y));
          if (dot(o, o) <= 26.0 && abs(texture2D(mask, vUv + o * px).r - self) > 0.5) d = min(d, length(o));
        }
        vec4 ink = vec4(0.051, 0.059, 0.067, 0.9), laminate = vec4(0.914, 0.925, 0.937, 1.0);
        gl_FragColor = self > 0.5 ? (d <= 2.0 ? ink : vec4(0.0)) : (d <= 2.0 ? laminate : d <= 5.0 ? ink : vec4(0.0));
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  maskTarget = new THREE.WebGLRenderTarget(1, 1);
  outlineMaterial.uniforms.mask.value = maskTarget.texture;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outlineMaterial);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene().add(quad);
  const drawOutline = () => {
    const owned = meshes.filter((mesh) => mesh.userData.owner === selected && mesh.visible);
    if (!owned.length || !maskTarget) return;
    const { width, height } = canvas;
    maskTarget.setSize(width, height);
    maskScene.clear();
    for (const mesh of owned) maskScene.add(new THREE.Mesh(mesh.geometry, maskMaterial));
    renderer.setRenderTarget(maskTarget);
    renderer.render(maskScene, camera);
    renderer.setRenderTarget(null);
    outlineMaterial.uniforms.px.value.set(renderer.getPixelRatio() / width, renderer.getPixelRatio() / height);
    renderer.autoClear = false;
    renderer.render(quadScene, camera);
    renderer.autoClear = true;
  };

  const apply = () => {
    let dimmed = 0;
    const visible = { cw: 0, chw: 0, valves: 0, instruments: 0 };
    for (const mesh of meshes) {
      const owner = String(mesh.userData.owner);
      const layer = mesh.userData.layer as "cw" | "chw" | "valves" | "instruments" | undefined;
      mesh.visible = !layer || state.layers[layer];
      if (mesh.visible && layer) visible[layer]++;
      const dim = !!selected && !state.traceIds.has(owner) && !state.findingIds.has(owner);
      if (mesh.visible && dim) dimmed++;
      const review = state.colourBy === "review" ? state.reviewStates[owner] : undefined;
      mesh.material = materialFor(mesh.userData.material as MaterialKey, dim, review);
    }
    for (const edges of edgeMeshes) {
      const owner = String(edges.userData.owner);
      const layer = edges.userData.layer as "cw" | "chw" | "valves" | "instruments" | undefined;
      edges.visible = (!layer || state.layers[layer]) && (!selected || state.traceIds.has(owner) || state.findingIds.has(owner));
    }
    host.dataset.dimmed = String(dimmed);
    host.dataset.visibleCw = String(visible.cw);
    host.dataset.visibleChw = String(visible.chw);
    host.dataset.visibleValves = String(visible.valves);
    host.dataset.visibleInstruments = String(visible.instruments);
    host.dataset.colourBy = state.colourBy;
  };

  let frame = 0;
  const draw = () => {
    frame = 0;
    const target = clampTarget(controls.target, center, bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const dx = target.x - controls.target.x, dy = target.y - controls.target.y, dz = target.z - controls.target.z;
    if (dx || dy || dz) {
      controls.target.set(target.x, target.y, target.z);
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
    host.dataset.targetX = controls.target.x.toFixed(2);
    host.dataset.targetY = controls.target.y.toFixed(2);
    host.dataset.targetZ = controls.target.z.toFixed(2);
    camera.updateMatrixWorld();
    renderer.info.reset();
    renderer.render(scene, camera);
    if (selected) drawOutline();
    host.dataset.frames = String(Number(host.dataset.frames ?? 0) + 1);
    host.dataset.drawCalls = String(renderer.info.render.calls);
    host.dataset.triangles = String(renderer.info.render.triangles);
    host.dataset.zoom = camera.zoom.toFixed(4);
    const offset = camera.position.clone().sub(controls.target);
    host.dataset.azimuth = ((Math.atan2(offset.x, offset.z) * 180) / Math.PI).toFixed(2);
    host.dataset.polar = ((Math.acos(offset.y / offset.length()) * 180) / Math.PI).toFixed(2);
    host.dataset.view = preset;
    events.frame();
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  controls.addEventListener("change", request);

  const resize = () => {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    frustum();
    request();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  renderer.setSize(size().w, size().h, false);
  apply();
  fitTo(direction);
  request();

  const raycaster = new THREE.Raycaster();
  let down: { x: number; y: number; type: string } | null = null;
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY, type: event.pointerType };
    host.dataset.dragging = "true";
    canvas.style.cursor = "grabbing";
  };
  const onUp = (event: PointerEvent) => {
    const start = down;
    down = null;
    delete host.dataset.dragging;
    canvas.style.cursor = "grab";
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > (CLICK_PX[start.type] ?? 5) || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects(meshes.filter((mesh) => mesh.visible), false)[0];
    if (hit) events.pick(String(hit.object.userData.owner));
  };
  const onCancel = () => {
    down = null;
    delete host.dataset.dragging;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  const onLost = (event: Event) => {
    event.preventDefault();
    events.lost();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const toScreen = new THREE.Vector3();
  return {
    update(next) {
      const changed = next.selectedId !== selected || next.traceIds !== state.traceIds || next.findingIds !== state.findingIds || next.layers !== state.layers || next.colourBy !== state.colourBy || next.reviewStates !== state.reviewStates;
      if (!changed) return;
      state = next;
      selected = next.selectedId;
      apply();
      request();
    },
    fit: () => {
      fitTo(camera.position.clone().sub(controls.target).normalize());
      request();
    },
    reset: () => {
      fitTo(direction, "isometric");
      request();
    },
    plan: () => {
      fitTo(planDirection, "plan");
      request();
    },
    focus: (id) => {
      const equipment = model.equipment.find((candidate) => candidate.id === id);
      if (!equipment) return;
      const dir = camera.position.clone().sub(controls.target).normalize();
      const target = new THREE.Vector3(equipment.x + equipment.width / 2, 28, equipment.z + equipment.depth / 2);
      camera.position.copy(target).addScaledVector(dir, 5000);
      controls.target.copy(target);
      camera.zoom = 2;
      frustum();
      controls.update();
      preset = "custom";
      host.dataset.focus = id;
      request();
    },
    zoomBy(factor) {
      camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * factor));
      camera.updateProjectionMatrix();
      controls.update();
      request();
    },
    panBy(dx, dy) {
      const k = scale / camera.zoom;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dx * k);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(dy * k);
      camera.position.add(right).add(up);
      controls.target.add(right).add(up);
      controls.update();
      preset = "custom";
      request();
    },
    orbitBy(azimuthDegrees, polarDegrees = 0) {
      const next = orbitOffset(camera.position.clone().sub(controls.target), azimuthDegrees, polarDegrees);
      camera.position.copy(controls.target).add(new THREE.Vector3(next.x, next.y, next.z));
      camera.lookAt(controls.target);
      controls.update();
      preset = "custom";
      request();
    },
    project(x, y, z) {
      toScreen.set(x, y, z).project(camera);
      const { w, h } = size();
      return [((toScreen.x + 1) / 2) * w, ((1 - toScreen.y) / 2) * h];
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", request);
      controls.dispose();
      onCancel();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      maskScene.clear();
      quad.geometry.dispose();
      outlineMaterial.dispose();
      maskMaterial.dispose();
      maskTarget?.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
