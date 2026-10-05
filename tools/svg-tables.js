// Shared by the tools that draw rendered tables into an animated SVG
// (demo-svg.js and intro.js). The SVG embeds each table model in a
// <foreignObject>, so it needs the table's markup, its stylesheets scoped to
// a wrapper, and the one-shot animations those stylesheets start on it.
import { readFileSync } from 'node:fs';

/**
 * Runs in the page, on a rendered <cssv-table>'s table: its markup, and the
 * one-shot CSS animations its stylesheets start on it (the board's flaps), so
 * the SVG can replay them. Endless animations run the same in the SVG and are
 * left out. Self-contained, because the tools inject it with addScriptTag.
 */
export function snapshotTable(table) {
  const kebab = (p) => (p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  const html = new XMLSerializer().serializeToString(table);
  const path = (node) => {
    const steps = [];
    for (; node !== table; node = node.parentElement) steps.unshift(`:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`);
    return ['table', ...steps].join(' > ');
  };
  const anims = [];
  for (const anim of table.getAnimations({ subtree: true })) {
    if (!(anim instanceof CSSAnimation)) continue; // a transition, say from a hover
    const { target, pseudoElement } = anim.effect;
    const timing = anim.effect.getTiming();
    if (timing.iterations === Infinity) continue; // runs the same in the SVG
    const what = `${anim.animationName} on ${path(target)}${pseudoElement ?? ''}`;
    if (pseudoElement || timing.iterations !== 1 || timing.direction !== 'normal' || timing.easing !== 'linear') {
      throw new Error(`Can't replay ${what}: only single runs on elements are supported.`);
    }
    if (target.getAnimations().some((a) => a.effect.getTiming().iterations === Infinity)) {
      throw new Error(`Can't replay ${what}: the element also has an endless animation.`);
    }
    const keyframes = anim.effect.getKeyframes().map(({ offset, computedOffset, easing, composite, ...props }) => ({
      offset: computedOffset,
      easing,
      props: Object.fromEntries(Object.entries(props).map(([p, v]) => [kebab(p), v])),
    }));
    // The value without the animation, for properties a 0% or 100% keyframe leaves out.
    const names = [...new Set(keyframes.flatMap((k) => Object.keys(k.props)))];
    target.style.animation = 'none';
    const cs = getComputedStyle(target);
    const base = Object.fromEntries(names.map((p) => [p, cs.getPropertyValue(p)]));
    target.style.animation = '';
    anims.push({ path: path(target), what, delay: timing.delay / 1000, duration: timing.duration / 1000, fill: timing.fill, keyframes, base });
  }
  return { html, anims };
}

// Top-level rules as { prelude, block }, or { prelude } for a statement.
function rules(css) {
  const out = [];
  let prelude = '', block = '', depth = 0, quote = null;
  const put = (s) => { if (depth) block += s; else prelude += s; };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      put(ch === '\\' ? ch + css[++i] : ch);
      if (ch === quote) quote = null;
    } else if (ch === '/' && css[i + 1] === '*') {
      i = css.indexOf('*/', i + 2) + 1;
      if (!i) throw new Error('Unclosed CSS comment');
    } else if (ch === '{') {
      if (depth++) block += ch;
    } else if (ch === '}') {
      if (--depth) block += ch;
      else out.push({ prelude: prelude.trim(), block: block.trim() }), prelude = block = '';
    } else if (ch === ';' && !depth) {
      if (prelude.trim()) out.push({ prelude: prelude.trim() });
      prelude = '';
    } else {
      if (ch === '"' || ch === "'") quote = ch;
      put(ch);
    }
  }
  if (depth || prelude.trim()) throw new Error('Unbalanced CSS');
  return out;
}

// A selector list split at its top-level commas.
function selectors(list) {
  const out = [];
  let cur = '', depth = 0, quote = null;
  for (const ch of list) {
    if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return [...out, cur.trim()];
}

/**
 * Scopes a stylesheet to one wrapper, because one SVG document holds every
 * table: every selector gets `prefix` as an ancestor, imports are inlined
 * relative to `base`, and @keyframes move into `hoisted` (name -> rule) to be
 * written at the top level. Names matching `reserved` clash with the tool's
 * own animations. This works on the source text, because the CSSOM
 * serializes a shorthand that uses var() as empty values once a longhand
 * follows it.
 */
export function scopeCss(css, prefix, base, hoisted, reserved) {
  let out = '';
  for (const { prelude, block } of rules(css)) {
    const at = /^@([\w-]+)/.exec(prelude)?.[1].toLowerCase();
    if (at === 'import') {
      const href = /^@import\s+(?:url\(\s*)?(["'])(.*?)\1\s*\)?$/i.exec(prelude);
      if (!href) throw new Error(`Only plain imports are supported: ${prelude}`);
      const url = new URL(href[2], base);
      out += scopeCss(readFileSync(url, 'utf8'), prefix, url, hoisted, reserved);
    } else if (at === 'charset') {
      // The file is UTF-8 anyway (SPEC 4.1).
    } else if (at === 'layer' && block === undefined) {
      out += `${prelude};`;
    } else if (['media', 'supports', 'layer', 'container'].includes(at)) {
      out += `${prelude}{${scopeCss(block, prefix, base, hoisted, reserved)}}`;
    } else if (at === 'keyframes') {
      const name = prelude.slice(10).trim();
      const rule = `${prelude}{${block}}`;
      if (reserved.test(name)) throw new Error(`@keyframes ${name} clashes with the tool's own animations`);
      if (hoisted.has(name) && hoisted.get(name) !== rule) throw new Error(`Two different @keyframes ${name}`);
      hoisted.set(name, rule);
    } else if (at) {
      throw new Error(`Unsupported rule: ${prelude}`);
    } else if (block.includes('{')) {
      throw new Error(`Nested rules are not supported: ${prelude}`);
    } else {
      if (/url\(\s*(?!["']?data:)/i.test(block)) throw new Error(`An SVG image can't load ${prelude}'s url()`);
      out += `${selectors(prelude).map((s) => `${prefix} ${s}`).join(',')}{${block}}`;
    }
  }
  return out;
}
