// Chromium ignores @font-face inside shadow roots, so web fonts that a style
// block imports never reach the table. hoistFonts() copies the @font-face
// rules to the document, where the shadow tree can use them. It reads only
// this site's stylesheets: the editor loads nothing from other services.
//
// A copied face applies to the whole page, so it must not take the place of a
// font the editor's own interface uses: a file could otherwise restyle the
// source pane, or make it show other text than the file holds. Those faces
// are left out, and each file's faces replace the last file's.
import { rewriteCssUrls } from '../../src/core.js';

const IMPORT = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;/g;
const fetched = new Map(); // URL → its stylesheet text with absolute url()s, '' when it can't load
const slots = new Map(); // slot → { sheet, faces, run }

const unquote = (name) => name.trim().replace(/^(["'])(.*)\1$/, '$2').toLowerCase();

// Every family the editor's stylesheets name, and its --mono and --sans
// stacks. Kept once sheet.css has applied.
let ownFamilies = null;
function interfaceFamilies() {
  if (ownFamilies) return ownFamilies;
  const names = new Set();
  const add = (list) => { for (const name of list.split(',')) if (name.trim()) names.add(unquote(name)); };
  const root = getComputedStyle(document.documentElement);
  add(root.getPropertyValue('--mono'));
  add(root.getPropertyValue('--sans'));
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.style?.fontFamily) add(rule.style.fontFamily);
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // a stylesheet from another origin; the editor has none
    }
  }
  if (names.size) ownFamilies = names;
  return names;
}

function load(href) {
  if (!fetched.has(href)) {
    fetched.set(href, fetch(href)
      // A copied rule keeps its url() text, so make it absolute against the stylesheet first.
      .then(async (res) => (res.ok ? rewriteCssUrls(await res.text(), res.url) : ''))
      .catch(() => '')); // the table falls back to the next font in its stack
  }
  return fetched.get(href);
}

/**
 * Copies the file's @font-face rules to the page, in place of what the last
 * call with the same `slot` copied. `base` is the URL the style block's
 * relative @imports resolve against: the file's.
 */
export async function hoistFonts(model, base = document.baseURI, slot = 'file') {
  let state = slots.get(slot);
  if (!state) {
    state = { sheet: new CSSStyleSheet(), faces: '', run: 0 };
    slots.set(slot, state);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, state.sheet];
  }
  const run = ++state.run;
  const style = model?.style ?? '';
  const sources = [];
  for (const m of style.matchAll(IMPORT)) {
    const url = new URL(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5], base);
    if (url.origin === location.origin) sources.push(load(url.href));
  }
  sources.push(rewriteCssUrls(style.replace(IMPORT, ''), base));
  const texts = await Promise.all(sources);
  if (run !== state.run) return; // a later call for this slot wins
  const own = interfaceFamilies();
  const faces = [];
  for (const css of texts) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replace(IMPORT, ''));
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSFontFaceRule && !own.has(unquote(rule.style.getPropertyValue('font-family')))) faces.push(rule.cssText);
    }
  }
  const text = faces.join('\n');
  if (text === state.faces) return;
  state.faces = text;
  state.sheet.replaceSync(text);
}
