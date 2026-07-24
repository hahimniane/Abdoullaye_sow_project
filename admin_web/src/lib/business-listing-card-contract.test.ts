import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("business vehicle cards crop every source image inside one bounded frame", () => {
  assert.match(
    operationsSource,
    /<div className="lst-card-media">[\s\S]*?<img src=\{image\}[\s\S]*?\/>[\s\S]*?<\/div>/,
    "listing images must remain inside the shared card-media frame",
  );

  assert.match(
    stylesSource,
    /\.lst-card-media\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*10[^}]*flex:\s*0\s+0\s+auto[^}]*min-height:\s*0[^}]*overflow:\s*hidden[^}]*\}/,
    "the shared frame must have a fixed ratio, must not grow, and must clip portrait images",
  );

  assert.match(
    stylesSource,
    /\.lst-card-media img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover[^}]*object-position:\s*center[^}]*display:\s*block[^}]*\}/,
    "images must fill and crop within the frame instead of using intrinsic dimensions",
  );
});
