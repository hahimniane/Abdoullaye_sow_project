import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShadowMaterial,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

import {
  DEFAULT_ANGLES,
  FOV_DEG,
  PERSON_IN,
  SNEAKER_IN,
  boxHeightLabel,
  cameraDistance,
  clampLabel,
  clampTilt,
  dashSpans,
  frameOf,
  gridOf,
  labelsCollide,
  personLabel,
  poleHeightOf,
  poleTicks,
  sceneLayoutOf,
  sideAwayFrom,
  stepBelow,
  tapeWidthIn,
  tickLabel,
  type Angles,
  type Dims,
  type Frame,
  type LabelLang,
  type SceneLayout,
} from "@/lib/box-designer";

/**
 * The 3D box scene (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 4), shared by the
 * in-page designer and the standalone /box-3d/ page the mobile app embeds: a
 * cardboard box with a tape stripe, a real 5 ft 6 in person, a sneaker and a
 * measuring pole on a one-foot grid, drawn with three.js. This module is only
 * ever loaded with `import()` (see box-3d-mount.ts) so three.js stays out of
 * the main bundle.
 *
 * One unit is one inch; +y is up. The scene renders on demand (an angle or
 * size changed, a frame of easing is left), never in a hot loop; it pauses
 * off screen and in a hidden tab; `dispose()` frees the renderer, geometry,
 * materials, textures and DOM labels. The numbers (layout, framing, label
 * text) are the pure functions in lib/box-designer.ts.
 */

export type Box3dSceneOptions = {
  /** The element that gets the canvas and the labels (it should be positioned and sized by CSS). */
  container: HTMLElement;
  dims: Dims;
  lang: LabelLang;
  /** Where the .glb files are served from. */
  modelBase?: string;
  /** Jump instead of easing the zoom (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** The first frame with both models drawn. */
  onFirstFrame?: () => void;
  /** The GPU context was lost after the scene was up. */
  onContextLost?: () => void;
};

export type Box3dScene = {
  setDims: (dims: Dims) => void;
  setLang: (lang: LabelLang) => void;
  setAngles: (angles: Angles) => void;
  dispose: () => void;
};

const MODEL_BASE = "/box-3d/";
const RAD = Math.PI / 180;

type Label = {
  el: HTMLDivElement;
  anchor: Vector3;
  /** "away": beside the pole, on the side away from the person (worked out every frame). */
  place: "away" | "above" | "center";
  size: { w: number; h: number };
  kind: "tick" | "top" | "box";
};

// ---------------------------------------------------------------------------
// Materials and small helpers.
// ---------------------------------------------------------------------------

/** A faint cardboard grain, made once (no image to download). */
function cardboardTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#c9955c";
    ctx.fillRect(0, 0, size, size);
    // Corrugation: faint vertical bands.
    for (let x = 0; x < size; x += 4) {
      ctx.fillStyle = x % 8 === 0 ? "rgba(120, 78, 36, 0.10)" : "rgba(255, 226, 180, 0.07)";
      ctx.fillRect(x, 0, 2, size);
    }
    // Fibres: deterministic specks, so every box looks the same.
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 900; i += 1) {
      const dark = rand() > 0.5;
      ctx.fillStyle = dark ? "rgba(90, 56, 24, 0.12)" : "rgba(255, 235, 200, 0.12)";
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

function disposeObject(root: Object3D) {
  root.traverse((node) => {
    const mesh = node as Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose?.();
  });
}

function loadModel(loader: GLTFLoader, url: string) {
  return loader.loadAsync(url);
}

/** Puts a model's feet on y = 0 and the middle of its footprint on x = z = 0. */
function groundAndCenter(model: Object3D) {
  model.updateMatrixWorld(true);
  model.traverse((node) => {
    const skinned = node as SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.skeleton.update();
      skinned.computeBoundingBox();
      skinned.frustumCulled = false;
    }
  });
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  return box.getSize(new Vector3());
}

/**
 * Turns a model about the vertical axis so its long side runs along z, the
 * taller (heel and collar) end at the back (-z) and the toe toward +z, whatever
 * way the file was exported.
 */
function alignLongAxis(model: Object3D) {
  model.updateMatrixWorld(true);
  const points: Vector3[] = [];
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 3) points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  });
  if (points.length < 3) return;
  let mx = 0;
  let mz = 0;
  for (const p of points) {
    mx += p.x;
    mz += p.z;
  }
  mx /= points.length;
  mz /= points.length;
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (const p of points) {
    cxx += (p.x - mx) ** 2;
    czz += (p.z - mz) ** 2;
    cxz += (p.x - mx) * (p.z - mz);
  }
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  model.rotation.y = theta - Math.PI / 2;
  model.updateMatrixWorld(true);
  // Which end is the heel: the end whose points stand higher.
  let backTop = 0;
  let backCount = 0;
  let frontTop = 0;
  let frontCount = 0;
  const probe = new Vector3();
  const center = new Box3().setFromObject(model).getCenter(new Vector3());
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 3) {
      probe.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (probe.z < center.z) {
        backTop += probe.y;
        backCount += 1;
      } else {
        frontTop += probe.y;
        frontCount += 1;
      }
    }
  });
  if (backCount && frontCount && backTop / backCount < frontTop / frontCount) model.rotation.y += Math.PI;
}

function shadows(root: Object3D, cast = true) {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
    }
  });
}

// ---------------------------------------------------------------------------
// The scene.
// ---------------------------------------------------------------------------

export async function createBox3dScene(options: Box3dSceneOptions): Promise<Box3dScene> {
  const { container } = options;
  const base = options.modelBase ?? MODEL_BASE;
  let dims = options.dims;
  let lang = options.lang;
  let reduced = Boolean(options.reducedMotion);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "b3-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 1, 1, 1000);
  const world = new Group();
  scene.add(world);

  // Soft light: a sky/ground fill and one key light that casts the shadow.
  scene.add(new HemisphereLight(0xffffff, 0xd3dcd9, 1.25));
  const key = new DirectionalLight(0xfff4e5, 2.3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.35;
  key.shadow.radius = 5;
  scene.add(key);
  scene.add(key.target);

  // The floor: a shadow catcher under a one-foot grid.
  const floorGroup = new Group();
  world.add(floorGroup);
  const shadowFloor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.26 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.01;
  shadowFloor.receiveShadow = true;
  floorGroup.add(shadowFloor);
  let gridLines: LineSegments | null = null;

  // The box, rebuilt when its inches change.
  const boxTexture = cardboardTexture();
  const boxMaterial = new MeshStandardMaterial({ map: boxTexture, color: 0xffffff, roughness: 0.92, metalness: 0 });
  const tapeMaterial = new MeshStandardMaterial({ color: 0xf1dfb3, roughness: 0.55, metalness: 0 });
  const edgeMaterial = new LineBasicMaterial({ color: 0x6b4423, transparent: true, opacity: 0.55 });
  const boxGroup = new Group();
  world.add(boxGroup);

  // The pole, its marks and the dashed line at the box's height.
  const poleGroup = new Group();
  world.add(poleGroup);
  const poleMaterial = new MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.2 });
  const tickMaterial = new MeshStandardMaterial({ color: 0x0f766e, roughness: 0.5 });
  const markMaterial = new MeshStandardMaterial({ color: 0xea580c, roughness: 0.5 });
  const dashMaterial = new MeshBasicMaterial({ color: 0xea580c, depthTest: false, transparent: true, opacity: 0.95 });
  const dashGroup = new Group();
  world.add(dashGroup);

  // The people and the shoe.
  const personHolder = new Group();
  const sneakerHolder = new Group();
  world.add(personHolder);
  world.add(sneakerHolder);

  // Labels: DOM, projected every frame, always upright and readable.
  const labelLayer = document.createElement("div");
  labelLayer.className = "b3-labels";
  labelLayer.setAttribute("aria-hidden", "true");
  labelLayer.setAttribute("data-no-translate", "");
  container.appendChild(canvas);
  container.appendChild(labelLayer);
  let labels: Label[] = [];
  // A label's size follows its text and its fonts: let the browser say when it changes instead of measuring every frame.
  const labelByElement = new Map<Element, Label>();
  const labelObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const label = labelByElement.get(entry.target);
            if (!label) continue;
            const box = entry.borderBoxSize?.[0];
            label.size = box ? { w: box.inlineSize, h: box.blockSize } : { w: entry.contentRect.width, h: entry.contentRect.height };
          }
          requestDraw();
        })
      : null;

  // ---- models --------------------------------------------------------------
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [man, shoe] = await Promise.all([loadModel(loader, `${base}man.glb`), loadModel(loader, `${base}sneaker.glb`)]).catch((error) => {
    renderer.dispose();
    boxTexture.dispose();
    canvas.remove();
    labelLayer.remove();
    throw error;
  });

  // The person: one still frame of the standing pose, scaled to exactly 5 ft 6 in.
  const mixer = new AnimationMixer(man.scene);
  const clip = man.animations[0];
  if (clip) {
    mixer.clipAction(clip).play();
    mixer.update(0);
  }
  // Soften the facets a little, keeping the hard edges (collar, sleeves, hem).
  man.scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const smooth = toCreasedNormals(mesh.geometry, 50 * RAD);
    mesh.geometry.dispose();
    mesh.geometry = smooth;
  });
  const personSize = groundAndCenter(man.scene);
  const personScale = PERSON_IN.h / (personSize.y || PERSON_IN.h);
  man.scene.scale.multiplyScalar(personScale);
  man.scene.position.multiplyScalar(personScale);
  shadows(man.scene);
  man.scene.traverse((node) => {
    const mesh = node as Mesh;
    const material = mesh.material as MeshStandardMaterial | undefined;
    if (mesh.isMesh && material?.isMeshStandardMaterial) material.roughness = Math.max(material.roughness, 0.85);
  });
  personHolder.add(man.scene);

  // The sneaker: 12 in long, its toe toward +z.
  const shoeInner = new Group();
  shoeInner.add(shoe.scene);
  shoe.scene.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) mesh.geometry.computeVertexNormals();
  });
  alignLongAxis(shoe.scene);
  const shoeSize = groundAndCenter(shoeInner);
  const shoeScale = SNEAKER_IN.l / (shoeSize.z || SNEAKER_IN.l);
  shoeInner.scale.setScalar(shoeScale);
  shoeInner.position.multiplyScalar(shoeScale);
  shadows(shoeInner);
  sneakerHolder.add(shoeInner);

  // ---- state ---------------------------------------------------------------
  let angles: Angles = { ...DEFAULT_ANGLES };
  let layout: SceneLayout = sceneLayoutOf(dims);
  let frameNow: Pick<Frame, "viewHeight" | "targetY"> | null = null;
  let frameGoal: Frame = frameOf(layout, 1);
  let size = { w: 0, h: 0 };
  let visible = true;
  let pageVisible = !document.hidden;
  let raf = 0;
  let firstFrameSent = false;
  let disposed = false;
  let lastTime = 0;
  /** True once the container has a size, so a change of box eases the zoom but the very first look does not. */
  let sized = false;

  const worldPoint = new Vector3();
  // Mid-height points on the pole and the person: which side of the pole the labels go on.
  const poleMid = new Vector3();
  const personMid = new Vector3();

  function clearGroup(group: Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  }

  function buildBox() {
    clearGroup(boxGroup);
    const geometry = new BoxGeometry(dims.l, dims.h, dims.w);
    const mesh = new Mesh(geometry, boxMaterial);
    mesh.position.y = dims.h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    boxGroup.add(mesh);
    const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
    edges.position.copy(mesh.position);
    boxGroup.add(edges);
    // The tape stripe along the top, wrapping 3 in down each end.
    const tape = tapeWidthIn(dims);
    const top = new Mesh(new BoxGeometry(dims.l + 0.12, 0.1, tape), tapeMaterial);
    top.position.y = dims.h + 0.05;
    top.receiveShadow = true;
    boxGroup.add(top);
    const wrap = Math.min(3, dims.h / 2);
    for (const side of [-1, 1]) {
      const end = new Mesh(new BoxGeometry(0.1, wrap, tape), tapeMaterial);
      end.position.set(side * (dims.l / 2 + 0.05), dims.h - wrap / 2, 0);
      boxGroup.add(end);
    }
  }

  function buildGrid() {
    if (gridLines) {
      floorGroup.remove(gridLines);
      disposeObject(gridLines);
    }
    const { sizeIn, cells } = gridOf(layout);
    const half = sizeIn / 2;
    const points: number[] = [];
    for (let i = 0; i <= cells; i += 1) {
      const at = -half + (i * sizeIn) / cells;
      points.push(at, 0.02, -half, at, 0.02, half, -half, 0.02, at, half, 0.02, at);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    gridLines = new LineSegments(geometry, new LineBasicMaterial({ color: 0x0b3b38, transparent: true, opacity: 0.2 }));
    floorGroup.add(gridLines);
    shadowFloor.scale.set(sizeIn, sizeIn, 1);
  }

  function buildPole() {
    clearGroup(poleGroup);
    clearGroup(dashGroup);
    const poleH = poleHeightOf(dims);
    const { pole } = layout;
    const stick = new Mesh(new CylinderGeometry(0.5, 0.5, poleH, 14), poleMaterial);
    stick.position.set(pole.x, poleH / 2, pole.z);
    stick.castShadow = true;
    poleGroup.add(stick);
    const base = new Mesh(new CylinderGeometry(3.4, 3.6, 0.6, 24), poleMaterial);
    base.position.set(pole.x, 0.3, pole.z);
    base.receiveShadow = true;
    poleGroup.add(base);
    const cap = new Mesh(new SphereGeometry(0.9, 14, 10), poleMaterial);
    cap.position.set(pole.x, poleH + 0.4, pole.z);
    poleGroup.add(cap);
    for (const tick of poleTicks(poleH)) {
      const ring = new Mesh(new CylinderGeometry(1.7, 1.7, 0.4, 20), tickMaterial);
      ring.position.set(pole.x, tick.inches, pole.z);
      poleGroup.add(ring);
    }
    // The person's own height: a bigger orange mark.
    const head = new Mesh(new CylinderGeometry(2.4, 2.4, 0.5, 20), markMaterial);
    head.position.set(pole.x, PERSON_IN.h, pole.z);
    poleGroup.add(head);

    // The dashed line at the box's height, from the box's top corner to the pole: thin 3D dashes (a GL line
    // is one device pixel wide, too faint on a phone), drawn over everything so the person never hides it.
    const from = new Vector3(-dims.l / 2, dims.h, -dims.w / 2);
    const to = new Vector3(pole.x, dims.h, pole.z);
    const span = dashSpans(from.distanceTo(to));
    const dashes = new InstancedMesh(new BoxGeometry(1, 0.34, 0.34), dashMaterial, Math.max(1, span.length));
    const along = to.clone().sub(from).normalize();
    const turn = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), along);
    const m = new Matrix4();
    span.forEach((dash, index) => {
      const middle = from.clone().addScaledVector(along, dash.from + dash.length / 2);
      m.compose(middle, turn, new Vector3(dash.length, 1, 1));
      dashes.setMatrixAt(index, m);
    });
    dashes.count = span.length;
    dashes.renderOrder = 5;
    dashes.frustumCulled = false;
    dashGroup.add(dashes);
    for (const spot of [from, to]) {
      const dot = new Mesh(new SphereGeometry(0.7, 12, 8), markMaterial);
      dot.position.copy(spot);
      dashGroup.add(dot);
    }
    const mark = new Mesh(new CylinderGeometry(2, 2, 0.35, 20), markMaterial);
    mark.position.set(pole.x, dims.h, pole.z);
    dashGroup.add(mark);
  }

  function placePeople() {
    personHolder.position.set(layout.person.x, 0, layout.person.z);
    personHolder.rotation.y = layout.personYaw * RAD;
    sneakerHolder.position.set(layout.sneaker.x, 0, layout.sneaker.z);
    // The key light sits up and to the side; its shadow box covers everything that can spin.
    const reach = layout.radius + 12;
    key.position.set(-reach * 0.7, reach * 2.1, reach * 1.2);
    key.target.position.set(0, 0, 0);
    key.shadow.camera.left = -reach;
    key.shadow.camera.right = reach;
    key.shadow.camera.top = reach;
    key.shadow.camera.bottom = -reach;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = reach * 5;
    key.shadow.camera.updateProjectionMatrix();
  }

  // ---- labels --------------------------------------------------------------
  function labelText(label: Label): string {
    if (label.kind === "top") return personLabel(lang);
    if (label.kind === "box") return boxHeightLabel(dims.h, lang);
    return tickLabel(Number(label.el.dataset.feet), lang);
  }

  function addLabel(kind: Label["kind"], anchor: Vector3, place: Label["place"], feet = 0) {
    const el = document.createElement("div");
    el.className = `b3-label ${kind}`;
    if (feet) el.dataset.feet = String(feet);
    labelLayer.appendChild(el);
    const label: Label = { el, anchor, place, size: { w: 0, h: 0 }, kind };
    labels.push(label);
    labelByElement.set(el, label);
    labelObserver?.observe(el);
    return label;
  }

  function buildLabels() {
    for (const label of labels) {
      labelObserver?.unobserve(label.el);
      labelByElement.delete(label.el);
      label.el.remove();
    }
    labels = [];
    const poleH = poleHeightOf(dims);
    const { pole } = layout;
    for (const tick of poleTicks(poleH)) addLabel("tick", new Vector3(pole.x, tick.inches, pole.z), "away", tick.feet);
    addLabel("top", new Vector3(pole.x, PERSON_IN.h, pole.z), "above");
    addLabel("box", new Vector3(pole.x, dims.h, pole.z), "away");
    poleMid.set(pole.x, PERSON_IN.h * 0.6, pole.z);
    personMid.set(layout.person.x, PERSON_IN.h * 0.6, layout.person.z);
    writeLabelText();
  }

  function writeLabelText() {
    for (const label of labels) {
      label.el.textContent = labelText(label);
    }
  }

  function screenX(point: Vector3): number {
    worldPoint.copy(point).applyMatrix4(world.matrixWorld).project(camera);
    return (worldPoint.x * 0.5 + 0.5) * size.w;
  }

  function placeLabels() {
    const side = sideAwayFrom(screenX(poleMid), screenX(personMid));
    let boxY = Number.NaN;
    let boxH = 0;
    let topBox: { x: number; y: number; w: number; h: number } | null = null;
    const tickSpots: { label: Label; y: number }[] = [];
    for (const label of labels) {
      // The observer above keeps sizes current; the very first frame measures by hand so no label waits for it.
      if (!label.size.w) label.size = { w: label.el.offsetWidth, h: label.el.offsetHeight };
      if (!label.size.w) {
        label.el.style.visibility = "hidden";
        continue;
      }
      label.el.style.visibility = "";
      worldPoint.copy(label.anchor).applyMatrix4(world.matrixWorld).project(camera);
      let x = (worldPoint.x * 0.5 + 0.5) * size.w;
      let y = (-worldPoint.y * 0.5 + 0.5) * size.h;
      if (label.place === "away") x += (side === "right" ? 1 : -1) * (9 + label.size.w / 2);
      else if (label.place === "above") y -= 12 + label.size.h / 2;
      else y -= 8 + label.size.h / 2;
      let spot = clampLabel({ x, y }, label.size, size);
      if (label.kind === "box" && topBox) {
        const below = stepBelow(topBox, { x: spot.x, y: spot.y, ...label.size });
        if (below !== spot.y) spot = clampLabel({ x: spot.x, y: below }, label.size, size);
      }
      label.el.dataset.edge = spot.edge ?? "";
      label.el.style.transform = `translate(${Math.round(spot.x - label.size.w / 2)}px, ${Math.round(spot.y - label.size.h / 2)}px)`;
      if (label.kind === "top") topBox = { x: spot.x, y: spot.y, ...label.size };
      if (label.kind === "box") {
        boxY = spot.y;
        boxH = label.size.h;
      } else if (label.kind === "tick") tickSpots.push({ label, y: spot.y });
    }
    // The box's height wins: a foot mark right next to it steps aside.
    for (const { label, y } of tickSpots) {
      if (!Number.isNaN(boxY) && labelsCollide(y, label.size.h, boxY, boxH)) label.el.style.visibility = "hidden";
    }
  }

  // ---- camera and rendering -----------------------------------------------
  function aim() {
    const elevation = -clampTilt(angles.tilt) * RAD;
    const distance = cameraDistance(frameNow?.viewHeight ?? frameGoal.viewHeight);
    const targetY = frameNow?.targetY ?? frameGoal.targetY;
    camera.position.set(0, targetY + Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    camera.near = Math.max(1, distance * 0.2);
    camera.far = distance * 4 + layout.radius * 2;
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
    world.rotation.y = angles.spin * RAD;
    world.updateMatrixWorld(true);
  }

  /** The frame this size and box need. `animate` eases there (the box changed); a resize or the first look jumps. */
  function refit(animate: boolean) {
    frameGoal = frameOf(layout, size.h > 0 ? size.w / size.h : 1);
    if (!frameNow || reduced || !animate) frameNow = { viewHeight: frameGoal.viewHeight, targetY: frameGoal.targetY };
  }

  function draw(now: number) {
    raf = 0;
    if (disposed || !size.w || !size.h) return;
    // Ease the zoom toward its goal (one frame at a time; reduced motion jumps).
    let easing = false;
    if (frameNow) {
      const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0.016;
      const k = reduced ? 1 : 1 - Math.exp(-dt * 11);
      frameNow = {
        viewHeight: frameNow.viewHeight + (frameGoal.viewHeight - frameNow.viewHeight) * k,
        targetY: frameNow.targetY + (frameGoal.targetY - frameNow.targetY) * k,
      };
      if (Math.abs(frameGoal.viewHeight - frameNow.viewHeight) < 0.02 && Math.abs(frameGoal.targetY - frameNow.targetY) < 0.02) {
        frameNow = { viewHeight: frameGoal.viewHeight, targetY: frameGoal.targetY };
      } else {
        easing = true;
      }
    }
    lastTime = easing ? now : 0;
    aim();
    renderer.render(scene, camera);
    placeLabels();
    if (!firstFrameSent) {
      firstFrameSent = true;
      options.onFirstFrame?.();
    }
    if (easing) requestDraw();
  }

  function requestDraw() {
    // The very first frame is drawn even off screen, so "ready" always arrives.
    if (raf || disposed || (firstFrameSent && (!visible || !pageVisible))) return;
    raf = requestAnimationFrame(draw);
  }

  function measure() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === size.w && height === size.h) return;
    size = { w: width, h: height };
    if (!width || !height) return;
    sized = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    camera.aspect = width / height;
    refit(false);
    requestDraw();
  }

  function rebuild() {
    layout = sceneLayoutOf(dims);
    buildBox();
    buildGrid();
    buildPole();
    placePeople();
    buildLabels();
    refit(sized);
    requestDraw();
  }

  // ---- go ------------------------------------------------------------------
  rebuild();
  measure();

  const resizer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  resizer?.observe(container);
  const watcher =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          if (visible) requestDraw();
        })
      : null;
  watcher?.observe(container);
  const onPageVisibility = () => {
    pageVisible = !document.hidden;
    if (pageVisible) requestDraw();
  };
  document.addEventListener("visibilitychange", onPageVisibility);
  const onLost = (event: Event) => {
    event.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  const onMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const syncMotion = () => {
    reduced = Boolean(options.reducedMotion) || Boolean(onMotion?.matches);
  };
  syncMotion();
  onMotion?.addEventListener?.("change", syncMotion);
  return {
    setDims(next) {
      if (next.l === dims.l && next.w === dims.w && next.h === dims.h) return;
      dims = next;
      rebuild();
    },
    setLang(next) {
      if (next === lang) return;
      lang = next;
      writeLabelText();
      requestDraw();
    },
    setAngles(next) {
      angles = { spin: next.spin, tilt: clampTilt(next.tilt) };
      requestDraw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      resizer?.disconnect();
      labelObserver?.disconnect();
      watcher?.disconnect();
      document.removeEventListener("visibilitychange", onPageVisibility);
      onMotion?.removeEventListener?.("change", syncMotion);
      canvas.removeEventListener("webglcontextlost", onLost);
      mixer.stopAllAction();
      mixer.uncacheRoot(man.scene);
      disposeObject(scene);
      boxTexture.dispose();
      (boxMaterial.map as Texture | null)?.dispose();
      shadowFloor.geometry.dispose();
      (shadowFloor.material as Material).dispose();
      boxMaterial.dispose();
      tapeMaterial.dispose();
      edgeMaterial.dispose();
      poleMaterial.dispose();
      tickMaterial.dispose();
      markMaterial.dispose();
      dashMaterial.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labelLayer.remove();
    },
  };
}
