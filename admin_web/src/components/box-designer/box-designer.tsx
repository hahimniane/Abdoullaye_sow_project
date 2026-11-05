"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  DEFAULT_ANGLES,
  DIM_KEYS,
  DIM_MIN_IN,
  DIM_SLIDER_MAX_IN,
  PERSON_IN,
  clampDim,
  modelCredit,
  dimText,
  dimsText,
  fitScale,
  gridOf,
  layoutOf,
  placeTransform,
  prismFaces,
  readDim,
  sceneLabel,
  sliderValue,
  sneakerParts,
  tapeWidthPx,
  withDim,
  type Angles,
  type DimKey,
  type Dims,
  type Face,
} from "@/lib/box-designer";
import { boxBadge, sizeForDims, type BoxPrices, type BoxSizeId } from "@/lib/package-box";
import type { Lang } from "@/lib/package-requests";

import { mountBox3d, type Box3dHandle } from "./box-3d-mount";
import { createSpinController, type SpinController } from "./box-spin-controller";

type BoxDesignerProps = {
  dims: Dims;
  /** Called with the new inches when a slider or number changes. Leave out for the read-only box staff see. */
  onChange?: (dims: Dims) => void;
  lang: Lang;
  /** The chosen business's prices (the badge says "Medium · $35"); leave out for no price. */
  prices?: BoxPrices | null;
  /** Comparing businesses: the badge says "from $X". */
  comparing?: boolean;
  /** The size to name; defaults to the one the inches fall in. */
  size?: BoxSizeId | null;
};

const DIM_LABEL: Record<DimKey, string> = { l: "Length", w: "Width", h: "Height" };
const DEFAULT_VIEWPORT = { w: 320, h: 300 };
function sameSize(a: { w: number; h: number }, b: { width: number; height: number }): boolean {
  return Math.abs(a.w - b.width) < 1 && Math.abs(a.h - b.height) < 1;
}

function personPath() {
  // One piece of art: head, torso, arms and legs of a 20 x 66 in person.
  return (
    <svg aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMax meet" viewBox="0 0 40 132">
      <circle cx="20" cy="11" r="9" />
      <rect height="52" rx="7" width="24" x="8" y="23" />
      <rect height="44" rx="3" width="6" x="1" y="25" />
      <rect height="44" rx="3" width="6" x="33" y="25" />
      <rect height="58" rx="3" width="10" x="9" y="73" />
      <rect height="58" rx="3" width="10" x="21" y="73" />
    </svg>
  );
}

function Prism({ faces, transform, className, tape }: { faces: Face[]; transform: string; className: string; tape?: number }) {
  return (
    <div className={`bd-prism ${className}`} style={{ transform }}>
      {faces.map((face) => (
        <div
          className={`bd-face ${face.id}`}
          key={face.id}
          style={{ width: face.width, height: face.height, transform: `translate(-50%, -50%) ${face.transform}` }}
        >
          {tape && face.id === "top" ? <span className="bd-tape" style={{ height: tape }} /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The 3D box (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 4): a cardboard box the
 * customer resizes with sliders or typed inches, next to a sneaker and a
 * 5 ft 6 in person for scale, on a one-foot floor grid. Drag to spin; the tilt
 * is clamped above the floor, and the arrow keys turn it too. Without
 * `onChange` it is the read-only box staff see on a request (still spinnable).
 *
 * CSS 3D transforms only. The geometry is computed once per change of inches
 * or stage size (`useMemo`); spinning writes two CSS variables and renders
 * nothing. The idle spin and every transition stop for
 * `prefers-reduced-motion`.
 */
export function BoxDesigner({ dims, onChange, lang, prices, comparing = false, size }: BoxDesignerProps) {
  const readOnly = !onChange;
  const fieldId = useId();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const angles = useRef<Angles>({ ...DEFAULT_ANGLES });
  const glRef = useRef<HTMLDivElement | null>(null);
  const spin = useRef<SpinController | null>(null);
  const box3d = useRef<Box3dHandle | null>(null);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  // "css" until the three.js scene has drawn its first frame; back to "css" if it fails or its GPU context is lost.
  const [mode, setMode] = useState<"css" | "3d">("css");

  const layout = useMemo(() => layoutOf(dims), [dims]);
  const scale = useMemo(() => fitScale(layout, viewport, 22), [layout, viewport]);
  const boxFaces = useMemo(() => prismFaces(dims, scale), [dims, scale]);
  const grid = useMemo(() => gridOf(layout), [layout]);
  const parts = useMemo(
    () =>
      sneakerParts().map((part) => ({
        ...part,
        faces: prismFaces(part.dims, scale),
        transform: placeTransform({ x: layout.sneaker.x + part.spot.x, z: layout.sneaker.z + part.spot.z }, part.dims, scale, part.lift),
      })),
    [layout, scale],
  );
  const boxTransform = useMemo(() => placeTransform({ x: 0, z: 0 }, dims, scale), [dims, scale]);
  const tape = useMemo(() => tapeWidthPx(dims, scale), [dims, scale]);
  const personHeight = PERSON_IN.h * scale;
  const personWidth = PERSON_IN.w * scale;
  const badge = useMemo(() => boxBadge({ size: size ?? sizeForDims(dims), prices, comparing, lang }), [size, dims, prices, comparing, lang]);
  const label = sceneLabel(dims, lang);
  // The badge sits over the top: the scene is pushed down a little.
  const lift = Math.round((layout.height * scale) / 2) + 16;

  const apply = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.style.setProperty("--bd-spin", `${angles.current.spin}deg`);
    world.style.setProperty("--bd-tilt", `${angles.current.tilt}deg`);
    box3d.current?.setAngles(angles.current);
  }, []);
  useLayoutEffect(apply, [apply]);

  // The stage's size: the zoom follows it (a phone is narrower than a desktop).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport((current) => (sameSize(current, rect) ? current : { w: rect.width, h: rect.height }));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Drag, arrow keys and the idle spin (one implementation, shared with the standalone /box-3d/ page).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const controller = createSpinController({
      element: stage,
      onAngles: (next) => {
        angles.current = next;
        apply();
      },
    });
    spin.current = controller;
    return () => {
      controller.dispose();
      spin.current = null;
    };
  }, [apply]);

  // The real 3D scene: loaded lazily, never in the main bundle. The CSS box above stays until its first frame
  // is drawn and comes back if WebGL, a model, the 8 second limit or the GPU context fails.
  const first = useRef({ dims, lang });
  useEffect(() => {
    const holder = glRef.current;
    if (!holder) return undefined;
    const handle = mountBox3d({
      container: holder,
      dims: first.current.dims,
      lang: first.current.lang,
      onReady: () => setMode("3d"),
      onFail: () => {
        setMode("css");
        handle.dispose();
      },
    });
    handle.setAngles(angles.current);
    box3d.current = handle;
    return () => {
      box3d.current = null;
      handle.dispose();
      setMode("css");
    };
  }, []);
  useEffect(() => {
    box3d.current?.setDims(dims);
  }, [dims]);
  useEffect(() => {
    box3d.current?.setLang(lang);
  }, [lang]);

  // The typed text of each field: it may be half-typed ("1") while the box keeps its last good size.
  const [texts, setTexts] = useState<Record<DimKey, string>>(() => ({ l: dimText(dims.l), w: dimText(dims.w), h: dimText(dims.h) }));
  const editing = useRef<DimKey | null>(null);
  useEffect(() => {
    setTexts((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of DIM_KEYS) {
        if (editing.current !== key && readDim(current[key]) !== dims[key]) {
          next[key] = dimText(dims[key]);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [dims]);

  const stageStyle = {
    "--bd-lift": `${lift}px`,
  } as CSSProperties;
  const worldVars = { "--bd-spin": `${DEFAULT_ANGLES.spin}deg`, "--bd-tilt": `${DEFAULT_ANGLES.tilt}deg` } as CSSProperties;

  return (
    <section aria-label="Box designer" className={`bd${readOnly ? " read-only" : ""}`}>
      <div
        aria-label={label}
        className="bd-stage"
        data-mode={mode}
        ref={stageRef}
        role="img"
        style={stageStyle}
        tabIndex={0}
      >
        {badge && (
          <p className={`bd-badge ${badge.kind}`} data-no-translate role="status">
            {badge.text}
          </p>
        )}
        <div className="bd-gl" ref={glRef} />
        <div className="bd-origin">
          <div className="bd-world" ref={worldRef} style={worldVars}>
            <div
              className="bd-floor"
              style={{
                width: grid.sizeIn * scale,
                height: grid.sizeIn * scale,
                backgroundSize: `${12 * scale}px ${12 * scale}px`,
                transform: "translate(-50%, -50%) rotateX(90deg)",
              }}
            />
            <Prism className="bd-box" faces={boxFaces} tape={tape} transform={boxTransform} />
            {parts.map((part) => (
              <Prism className="bd-sneaker" faces={part.faces} key={part.id} transform={part.transform} />
            ))}
            <div
              className="bd-person"
              style={{
                width: personWidth,
                height: personHeight,
                transform: `translate3d(${layout.person.x * scale}px, 0, ${layout.person.z * scale}px) translate(-50%, -100%) rotateY(calc(var(--bd-spin) * -1))`,
              }}
            >
              {personPath()}
            </div>
          </div>
        </div>
        <p className="bd-hint" data-no-translate>
          <span>{lang === "fr" ? "Faites glisser pour tourner" : "Drag to spin"}</span>
        </p>
      </div>

      <ul className="bd-legend">
        <li><span aria-hidden="true" className="bd-key sneaker" /> <span>Sneaker (12 in)</span></li>
        <li><span aria-hidden="true" className="bd-key person" /> <span>Person (5 ft 6 in)</span></li>
        <li><span aria-hidden="true" className="bd-key grid" /> <span>Grid squares are 1 ft</span></li>
        <li><span aria-hidden="true" className="bd-key ruler" /> <span>Ruler: a mark every foot</span></li>
      </ul>
      <p className="bd-credit" data-no-translate>
        {modelCredit(lang)}
      </p>

      {readOnly ? (
        <p className="bd-dims" data-no-translate>{dimsText(dims, lang)}</p>
      ) : (
        <div className="bd-controls">
          {DIM_KEYS.map((key) => {
            const typed = texts[key];
            const invalid = readDim(typed) === null;
            return (
              <div className="bd-control" key={key}>
                <label htmlFor={`${fieldId}-${key}`}><span>{DIM_LABEL[key]}</span></label>
                <input
                  aria-label={`${DIM_LABEL[key]} slider, inches`}
                  className="bd-slider"
                  max={DIM_SLIDER_MAX_IN}
                  min={DIM_MIN_IN}
                  onChange={(event) => {
                    spin.current?.markTouched();
                    onChange?.(withDim(dims, key, Number(event.target.value)));
                  }}
                  step={1}
                  type="range"
                  value={sliderValue(dims[key])}
                />
                <span className="bd-number">
                  <input
                    aria-invalid={invalid}
                    id={`${fieldId}-${key}`}
                    inputMode="decimal"
                    maxLength={5}
                    onBlur={() => {
                      editing.current = null;
                      setTexts((current) => ({ ...current, [key]: dimText(dims[key]) }));
                    }}
                    onChange={(event) => {
                      const text = event.target.value;
                      setTexts((current) => ({ ...current, [key]: text }));
                      const value = readDim(text);
                      if (value !== null) onChange?.(withDim(dims, key, clampDim(value)));
                    }}
                    onFocus={() => {
                      editing.current = key;
                    }}
                    value={typed}
                  />
                  <span aria-hidden="true">{lang === "fr" ? "po" : "in"}</span>
                </span>
              </div>
            );
          })}
          <p className="bd-help">Slide up to 60 in, or type up to 120 in.</p>
        </div>
      )}
    </section>
  );
}
