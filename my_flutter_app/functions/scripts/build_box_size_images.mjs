#!/usr/bin/env node
/**
 * Rebuilds the box-size pictures from the hand-written SVGs.
 *
 *   node my_flutter_app/functions/scripts/build_box_size_images.mjs
 *
 * Source of truth: admin_web/public/box-sizes/{small,medium,large,xl}.svg
 * Writes:
 *   - 512x512 PNGs  -> admin_web/public/box-sizes/*.png
 *                      my_flutter_app/assets/box_sizes/*.png
 *   - 200x200 palette PNGs as base64 -> my_flutter_app/functions/box_size_images.js
 *     (WhatsApp Flow images; each must stay under 60 KB)
 *
 * Needs `sharp`, which is resolved from admin_web/node_modules
 * (run `npm install` in admin_web first).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const sharp = createRequire(path.join(repo, 'admin_web', 'package.json'))('sharp');

const IDS = ['small', 'medium', 'large', 'xl'];
const MAX_FLOW_BYTES = 60 * 1024;
const svgDir = path.join(repo, 'admin_web', 'public', 'box-sizes');
const appDir = path.join(repo, 'my_flutter_app', 'assets', 'box_sizes');
const outJs = path.join(repo, 'my_flutter_app', 'functions', 'box_size_images.js');

fs.mkdirSync(appDir, {recursive: true});
const images = {};
for (const id of IDS) {
  const svg = path.join(svgDir, `${id}.svg`);
  // 512 px for the web and the app.
  const big = await sharp(svg, {density: 384}).resize(512, 512).png({compressionLevel: 9}).toBuffer();
  fs.writeFileSync(path.join(svgDir, `${id}.png`), big);
  fs.writeFileSync(path.join(appDir, `${id}.png`), big);
  // 200 px base64 for the WhatsApp Flow.
  const small = await sharp(svg, {density: 192}).resize(200, 200).png({compressionLevel: 9}).toBuffer();
  if (small.length > MAX_FLOW_BYTES) {
    throw new Error(`${id}: ${small.length} bytes is over the ${MAX_FLOW_BYTES} byte limit`);
  }
  images[id] = small.toString('base64');
  console.log(`${id}: 512px ${big.length} B, flow 200px ${small.length} B`);
}

const lines = IDS.map((id) => `    ${id}: "${images[id]}",`).join('\n');
fs.writeFileSync(outJs, `/* eslint-disable max-len */
/**
 * Box-size pictures (small, medium, large, xl) as base64 PNGs, 200x200, for the
 * WhatsApp "Send a package" Flow, which takes images as base64 strings.
 * Every picture uses one scale (pixels per inch) with the same 12 in sneaker
 * beside the box, so the sizes read relative to it.
 *
 * GENERATED - do not edit by hand. Rebuild with:
 *   node my_flutter_app/functions/scripts/build_box_size_images.mjs
 * from the SVGs in admin_web/public/box-sizes/.
 */
module.exports = {
  BOX_SIZE_IMAGES: {
${lines}
  },
};
`);
console.log(`wrote ${path.relative(repo, outJs)}`);
