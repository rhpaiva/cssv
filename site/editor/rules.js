// The rules that style a cell, for the inspector. They come from the table's
// own stylesheets as the browser parsed them (the CSSOM of the inner shadow
// root: the §8.2 defaults, then the style block and what it imports), so a
// rule the browser dropped isn't listed and a rule the editor just wrote is.
// Each rule from the style block is matched to its line in the file.

const PSEUDO_ELEMENT = /::?(before|after|first-line|first-letter|marker|selection|placeholder|backdrop|file-selector-button)(\([^)]*\))?$/i;
const GROUP = /^@(media|supports|layer|container|scope|document|starting-style)\b/i;

/** Splits a selector list at its top-level commas. */
export function splitSelectors(text) {
  const out = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

// The text inside the parentheses that open at `i`, and the index after them.
function group(text, i) {
  let depth = 0;
  let quote = '';
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && --depth === 0) return [text.slice(i + 1, j), j + 1];
  }
  return [text.slice(i + 1), text.length];
}

const IDENT = /^-?(?:[\w-]|\\.|[^\x00-\x7f])+/;
const add = (x, y) => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
const greater = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
const most = (list) => splitSelectors(list).map(specificity).reduce((m, s) => (greater(s, m) > 0 ? s : m), [0, 0, 0]);

/** Selectors Level 4 specificity of one complex selector, as [ids, classes, types]. */
export function specificity(selector) {
  let s = [0, 0, 0];
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    const ident = (from) => IDENT.exec(selector.slice(from))?.[0] ?? '';
    if (ch === '#') {
      s = add(s, [1, 0, 0]);
      i += 1 + ident(i + 1).length;
    } else if (ch === '.') {
      s = add(s, [0, 1, 0]);
      i += 1 + ident(i + 1).length;
    } else if (ch === '[') {
      s = add(s, [0, 1, 0]);
      i = group(selector, i)[1];
    } else if (ch === ':' && selector[i + 1] === ':') {
      s = add(s, [0, 0, 1]);
      i += 2 + ident(i + 2).length;
      if (selector[i] === '(') i = group(selector, i)[1];
    } else if (ch === ':') {
      const name = ident(i + 1).toLowerCase();
      i += 1 + name.length;
      let arg = null;
      if (selector[i] === '(') [arg, i] = group(selector, i);
      if (arg !== null && ['is', 'not', 'has', 'matches', '-webkit-any'].includes(name)) s = add(s, most(arg));
      else if (name === 'where') { /* zero */ } else if (arg !== null && /^nth-(last-)?child$/.test(name) && / of /i.test(arg)) {
        s = add(add(s, [0, 1, 0]), most(arg.slice(arg.search(/ of /i) + 4)));
      } else if (['before', 'after', 'first-line', 'first-letter'].includes(name)) s = add(s, [0, 0, 1]);
      else s = add(s, [0, 1, 0]);
    } else if (/[a-zA-Z_\\]/.test(ch) || ch > '\x7f') {
      s = add(s, [0, 0, 1]);
      i += Math.max(1, ident(i).length);
    } else i++; // *, &, combinators, whitespace, namespaces
  }
  return s;
}

/** Every style rule that applies at the moment, in cascade order, with where it comes from. */
export function styleRules(root) {
  const out = [];
  const walk = (rules, ctx) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        out.push({ rule, order: out.length, ...ctx });
      } else if (rule instanceof CSSImportRule) {
        let sheet = null;
        try {
          sheet = rule.styleSheet;
          if (!sheet?.cssRules) continue;
        } catch {
          continue; // blocked, failed or from another origin
        }
        if (rule.media.length && !matchMedia(rule.media.mediaText).matches) continue;
        walk(sheet.cssRules, { ...ctx, origin: 'import', href: rule.href });
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText).matches) walk(rule.cssRules, ctx);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) walk(rule.cssRules, ctx);
      } else if (window.CSSLayerBlockRule && rule instanceof CSSLayerBlockRule) {
        walk(rule.cssRules, { ...ctx, layer: rule.name });
      } else if (window.CSSContainerRule && rule instanceof CSSContainerRule) {
        walk(rule.cssRules, { ...ctx, condition: `@container ${rule.conditionText}` });
      }
    }
  };
  const sheets = Array.from(root.styleSheets);
  sheets.forEach((sheet, i) => {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      return;
    }
    walk(rules, { origin: i === 0 ? 'defaults' : 'author', layer: null, href: null, condition: null });
  });
  return out;
}

/**
 * The rules that match `el`, most specific first, as the cascade orders
 * them: unlayered rules over layered ones (the defaults are layered), then
 * specificity, then source order. Rules for ::before and ::after of `el`
 * are included, with `pseudo` set.
 */
export function matchingRules(el, rules) {
  const found = [];
  for (const entry of rules) {
    let best = null;
    for (const selector of splitSelectors(entry.rule.selectorText)) {
      const pseudo = PSEUDO_ELEMENT.exec(selector);
      const base = pseudo ? selector.slice(0, pseudo.index) || '*' : selector;
      let hit = false;
      try {
        hit = el.matches(base);
      } catch {
        // a selector this browser parses but can't match outside a stylesheet
      }
      if (!hit) continue;
      const spec = specificity(selector);
      if (!best || greater(spec, best.spec) > 0) best = { selector, spec, pseudo: pseudo ? `::${pseudo[1].toLowerCase()}` : null };
    }
    if (best) found.push({ ...entry, ...best });
  }
  return found.sort((a, b) => (!!a.layer - !!b.layer) || greater(b.spec, a.spec) || b.order - a.order);
}

/** The declarations of a rule, as written by the CSSOM: [{ name, value, important }]. */
export function declarations(rule) {
  const text = rule.style.cssText;
  const out = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (part) => {
    const colon = part.indexOf(':');
    if (colon < 0) return;
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/\s*!\s*important$/i, '');
    out.push({ name: part.slice(0, colon).trim(), value, important });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      push(text.slice(start, i));
      start = i + 1;
    }
  }
  push(text.slice(start));
  return out;
}

// --- Lines in the style block ------------------------------------------------

/** Selector text compared loosely: no comments, spaces or quote differences. */
export function normalizeSelector(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'/g, '"')
    .replace(/(^|[^:]):(before|after|first-line|first-letter)\b/gi, '$1::$2')
    .replace(/\(\s*even\s*\)/gi, '(2n)')
    .replace(/\(\s*odd\s*\)/gi, '(2n+1)')
    .replace(/(\[[^\]="]+[~|^$*]?=)\s*"((?:[^"\\]|\\.)*)"\s*([is])?\s*\]/g, '$1$2$3]')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * The style rules of a style block in source order: [{ text, offset, line }],
 * where `offset` is where the selector starts in `css` and `line` counts from 1.
 * Rules inside @media, @supports, @layer and the like are included; the
 * insides of @font-face, @keyframes and other at-rules are not.
 */
export function rulePreludes(css) {
  const out = [];
  const stack = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') {
      const raw = css.slice(start, i);
      const blanked = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
      const lead = blanked.search(/\S/);
      const text = blanked.trim();
      const top = stack.at(-1);
      if (top === 'other' || top === 'rule') stack.push(top === 'rule' ? 'rule' : 'other');
      else if (text.startsWith('@')) stack.push(GROUP.test(text) ? 'group' : 'other');
      else {
        const offset = start + Math.max(0, lead);
        out.push({ text, offset });
        stack.push('rule');
      }
      start = i + 1;
    } else if (ch === '}') {
      stack.pop();
      start = i + 1;
    } else if (ch === ';') start = i + 1;
  }
  let line = 1;
  let at = 0;
  for (const p of out) {
    for (; at < p.offset; at++) if (css.charCodeAt(at) === 10) line++;
    p.line = line;
  }
  return out;
}

/**
 * Pairs the author rules from styleRules() with their place in the style
 * block, in order: each CSSOM rule takes the next prelude with the same
 * selector text, so rules the browser dropped don't shift the rest.
 */
export function locateRules(rules, preludes) {
  const where = new Map();
  let p = 0;
  for (const entry of rules) {
    if (entry.origin !== 'author') continue;
    const want = normalizeSelector(entry.rule.selectorText);
    for (let j = p; j < preludes.length; j++) {
      if (normalizeSelector(preludes[j].text) === want) {
        where.set(entry.rule, preludes[j]);
        p = j + 1;
        break;
      }
    }
  }
  return where;
}
