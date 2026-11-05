"use client";

import { useEffect, useRef, useState } from "react";

import { DEFAULT_DIMS, modelCredit, parseBox3dQuery, readSetDims, sceneLabel, type Dims, type LabelLang } from "@/lib/box-designer";
import { LANGUAGE_PENDING_ATTRIBUTE } from "@/lib/language";

import { mountBox3d } from "./box-3d-mount";
import { createSpinController } from "./box-spin-controller";

/**
 * The page the mobile app opens in a web view: ONLY the 3D scene, full
 * viewport, white, no login. Contract:
 *
 *   /box-3d/?l=20&w=16&h=14&lang=en     inches; lang en|fr; anything invalid = the default box
 *   window.laawolBox3d.setDims({l,w,h})  change the box without reloading
 *   window.laawolBox3d.setLang("en"|"fr")
 *   window.Box3dChannel?.postMessage("ready")   first frame with both models drawn
 *   window.Box3dChannel?.postMessage("failed")  no WebGL, a model failed, or 8 s passed
 *
 * Drag or touch spins it (touch-action: none); it spins by itself until touched.
 */

type Box3dChannel = { postMessage: (message: string) => void };

declare global {
  interface Window {
    laawolBox3d?: { setDims: (dims: unknown) => void; setLang: (lang: unknown) => void };
    Box3dChannel?: Box3dChannel;
  }
}

function tell(message: "ready" | "failed") {
  try {
    window.Box3dChannel?.postMessage(message);
  } catch {
    // The app's channel is optional; a page opened in a browser has none.
  }
}

export function Box3dPage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDimsState] = useState<Dims>({ ...DEFAULT_DIMS });
  const [lang, setLangState] = useState<LabelLang>("en");

  useEffect(() => {
    const stage = stageRef.current;
    const holder = sceneRef.current;
    if (!stage || !holder) return undefined;

    // This page has no console around it, so nothing else reveals a French device's page.
    document.documentElement.removeAttribute(LANGUAGE_PENDING_ATTRIBUTE);
    const first = parseBox3dQuery(window.location.search);
    let currentDims = first.dims;
    let currentLang = first.lang;
    setDimsState(currentDims);
    setLangState(currentLang);
    document.documentElement.lang = currentLang;

    const handle = mountBox3d({
      container: holder,
      dims: currentDims,
      lang: currentLang,
      onReady: () => tell("ready"),
      onFail: () => tell("failed"),
    });
    const spin = createSpinController({ element: stage, onAngles: (angles) => handle.setAngles(angles) });

    window.laawolBox3d = {
      setDims: (raw) => {
        const next = readSetDims(raw);
        if (!next) return;
        currentDims = next;
        setDimsState(next);
        handle.setDims(next);
      },
      setLang: (raw) => {
        const next: LabelLang = String(raw).toLowerCase() === "fr" ? "fr" : "en";
        if (next === currentLang) return;
        currentLang = next;
        setLangState(next);
        document.documentElement.lang = next;
        handle.setLang(next);
      },
    };

    return () => {
      delete window.laawolBox3d;
      spin.dispose();
      handle.dispose();
    };
  }, []);

  return (
    <div
      aria-label={sceneLabel(dims, lang)}
      className="b3-page"
      data-no-translate
      ref={stageRef}
      role="img"
      tabIndex={0}
    >
      <div className="b3-scene" ref={sceneRef} />
      <p className="b3-credit">
        {modelCredit(lang)}
      </p>
    </div>
  );
}
