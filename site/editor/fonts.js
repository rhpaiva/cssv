// Chromium ignores @font-face inside shadow roots, so web fonts that a style
// block imports never reach the table. hoistFonts() copies the @font-face
// rules to the document, where the shadow tree can use them. It reads only
// this site's stylesheets: the editor loads nothing from other services.
import { rewriteCssUrls } from '../../src/core.js';

const IMPORT = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;/g;
const hoisted = new Set();

/** `base` is the URL the style block's relative @imports resolve against: the file's. */
export async function hoistFonts(model, base = document.baseURI) {
  if (!model?.style) return;
  const sources = [];
  for (const m of model.style.matchAll(IMPORT)) {
    const url = new URL(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5], base);
    if (url.origin !== location.origin || hoisted.has(url.href)) continue;
    hoisted.add(url.href);
    try {
      const res = await fetch(url);
      // A copied rule keeps its url() text, so make it absolute against the stylesheet first.
      if (res.ok) sources.push(rewriteCssUrls(await res.text(), res.url));
    } catch {
      // the table falls back to the next font in its stack
    }
  }
  const inline = model.style.replace(IMPORT, '');
  if (!hoisted.has(inline)) {
    hoisted.add(inline);
    sources.push(rewriteCssUrls(inline, base));
  }
  const faces = [];
  for (const css of sources) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replace(IMPORT, ''));
    for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText);
  }
  if (!faces.length) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(faces.join('\n'));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
