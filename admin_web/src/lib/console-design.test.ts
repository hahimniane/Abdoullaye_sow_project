// The consoles share the public site's design (public_site/assets/theme.css):
// one typeface, a 400-700 weight scale, nothing smaller than 12px, the logo
// navy as the only brand color. These checks keep new styles on that system.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

type Rule = { selector: string; body: string };

function rules(): Rule[] {
  const out: Rule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: match[1].split("*/").pop()!.trim(), body: match[2] });
  }
  return out;
}

describe("console design follows the public site", () => {
  it("uses the site's typeface, hosted with the console", () => {
    assert.match(css, /font-family:\s*"Plus Jakarta Sans";/);
    assert.match(css, /body\s*\{[^}]*"Plus Jakarta Sans"[^}]*-webkit-font-smoothing: antialiased/);
    for (const file of ["plus-jakarta-sans-latin.woff2", "plus-jakarta-sans-latin-ext.woff2"]) {
      assert.ok(css.includes(`/fonts/${file}`), `${file} is not referenced`);
      assert.ok(existsSync(new URL(`../../public/fonts/${file}`, import.meta.url)), `${file} is missing`);
    }
  });

  it("textareas use the same typeface as every other field", () => {
    assert.match(css, /button,\s*input,\s*select,\s*textarea\s*\{\s*font: inherit;/);
  });

  it("keeps font weights on the site's scale (400, 500, 600, 700)", () => {
    const off = rules().flatMap((rule) =>
      rule.selector.includes("@font-face")
        ? []
        : [...rule.body.matchAll(/font-weight:\s*(\d+)/g)]
            .filter((m) => !["400", "500", "600", "700"].includes(m[1]))
            .map((m) => `${rule.selector}: ${m[1]}`),
    );
    assert.deepEqual(off, []);
  });

  it("has no text smaller than 12px, apart from status tags, code fields and the 3D box credit", () => {
    const small = rules().flatMap((rule) => {
      const exempt = rule.body.includes("text-transform: uppercase") || rule.body.includes("monospace") || rule.selector.includes(".b3-");
      if (exempt) return [];
      return [...rule.body.matchAll(/font-size:\s*([\d.]+)px/g)]
        .filter((m) => Number(m[1]) < 12)
        .map((m) => `${rule.selector}: ${m[1]}px`);
    });
    assert.deepEqual(small, []);
  });

  it("keeps the logo navy as the brand color and the old teal out", () => {
    assert.match(css, /--brand:\s*#032346;/);
    assert.match(css, /--ink:\s*#222222;/);
    for (const teal of ["#0f766e", "#0d9488", "#14b8a6", "#115e59", "#134e4a", "#5eead4"]) {
      assert.ok(!css.toLowerCase().includes(teal), `${teal} is back in the stylesheet`);
    }
  });

  it("keeps the header and the side menu white, like the site's header", () => {
    assert.match(css, /\.topbar \{\s*background: #ffffff;\s*border-bottom: 1px solid #ebebeb;/);
    assert.match(css, /\.sidebar \{\s*background: #ffffff;\s*border-right: 1px solid #ebebeb;/);
  });
});
