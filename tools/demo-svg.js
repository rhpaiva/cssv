// Generates site/demo.svg, the animated demo in the README: a .cssv file is
// typed into an editor on the left, and the table on the right follows it.
// The story builds the website's departures board one rule at a time.
//
// Nothing in the table is drawn by hand. Each state of the file is rendered by
// the real <cssv-table> in Chromium, and the SVG embeds the table model it
// built in a <foreignObject>, with the default and author stylesheets scoped
// to it. The viewer's browser draws the board from the same CSS as the
// website. Code colors come from site/highlight.js and site/site.css.
// Run with: node tools/demo-svg.js
//
// The SVG has no script and no external resources, so it also animates as an
// <img> on GitHub and npm. With reduced motion it shows scene STILL.
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { DEFAULT_CSS } from '../src/core.js';
import { startServer } from '../test/browser/harness.js';

const OUT = new URL('../site/demo.svg', import.meta.url);
const BASE = new URL('../site/', import.meta.url); // the story's file sits next to departures.cssv

// --- The story ---------------------------------------------------------------
// The departures board from the website's hero, built up one rule at a time.
const NAME = 'departures.cssv';
const CSV = [
  'time,flight,destination,gate,delay',
  '08:15,LH 441,Frankfurt,B07,0',
  '08:30,BA 117,London,A12,25',
  '08:45,AF 1023,Paris,C03,0',
  '09:05,KL 1786,Amsterdam,B11,',
  '09:20,IB 3171,Madrid,A04,-5',
];
const STYLE = [
  '@import url("split-flap.css");',
  '.zero::before     { content: "On time"; }',
  '.positive::before { content: "Delayed +"; }',
  '.negative::before { content: "Early"; }',
  'td:empty::before  { content: "Cancelled"; }',
  'table { --cssv-key: flight; }',
  '[data-key="LH 441"] .zero::before { content: "Boarding"; }',
];
// Each scene keeps the first `lines` style rules. A scene with `edit` types
// `text` at the end of CSV line `row`, then deletes it again, so the loop
// ends where it started. In a caption, a string is prose and an array is code.
const SCENES = [
  { lines: 0, caption: ['Any CSV file is already a CSSV file.'] },
  { lines: 1, caption: ['Put CSS on top, between ', ['---'], ' lines. This file imports a board style.'] },
  { lines: 5, caption: ['The sign of each delay picks its remark: ', ['.zero'], ', ', ['.positive'], ', ', ['.negative'], ', ', [':empty'], '.'] },
  { lines: 7, caption: [['--cssv-key'], ' names each row, so CSS can pick out one flight.'] },
  { lines: 7, edit: { row: 4, text: '40' }, caption: ['Change the data and the board follows. The CSS stays the same.'] },
  { lines: 0, caption: ['Delete the style block and it’s plain CSV again.'] },
];
const STILL = 3;
const EDIT = SCENES.find((s) => s.edit)?.edit;
const fileOf = ({ lines }, edit) => {
  const csv = CSV.map((line, i) => (edit && i === edit.row ? line + edit.text : line));
  return (lines ? ['---', ...STYLE.slice(0, lines), '---', ...csv] : csv).join('\n') + '\n';
};

// Every distinct file the story shows is a state, rendered once.
const states = [];
const stateOf = (scene, edited = false) => {
  const text = fileOf(scene, edited && scene.edit);
  let i = states.findIndex((s) => s.text === text);
  if (i < 0) i = states.push({ text, style: STYLE.slice(0, scene.lines).join('\n') }) - 1;
  return i;
};
SCENES.forEach((scene) => { stateOf(scene); if (scene.edit) stateOf(scene, true); });

// --- Read everything from the real renderer and the website ------------------
const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.emulateMedia({ colorScheme: 'light' });
// The page sits in site/, so the story's relative @import finds split-flap.css.
await page.goto(server.page('<main id="host"></main>', { path: '/site/__demo.html', head: '<link rel="stylesheet" href="site.css">' }));
await page.waitForFunction(() => customElements.get('cssv-table'));
const { theme, code, rendered } = await page.evaluate(async ({ texts, full }) => {
  const ctx = document.createElement('canvas').getContext('2d');
  const color = (c) => { ctx.fillStyle = '#000'; ctx.fillStyle = c; return ctx.fillStyle; };
  const root = getComputedStyle(document.documentElement);
  const theme = {};
  for (const name of ['surface', 'stage', 'dots', 'text', 'muted', 'border', 'accent', 'accent-soft', 'accent-text', 'code-bg', 'code-bar', 'code-text', 'code-muted']) {
    theme[name] = color(root.getPropertyValue(`--${name}`).trim());
  }
  theme.mono = root.getPropertyValue('--mono').trim();
  theme.sans = root.getPropertyValue('--sans').trim();

  // Highlighted lines of the longest file, as runs of { text, color, weight }.
  const { highlightCssv } = await import('/site/highlight.js');
  const pre = document.createElement('pre');
  pre.append(highlightCssv(full));
  document.body.append(pre);
  const code = [[]];
  for (const node of pre.childNodes) {
    const cs = node.nodeType === 1 ? getComputedStyle(node) : null;
    const run = { color: cs ? color(cs.color) : theme['code-text'], weight: cs ? cs.fontWeight : '400' };
    node.textContent.split('\n').forEach((text, i) => {
      if (i) code.push([]);
      if (text) code.at(-1).push({ text, ...run });
    });
  }
  pre.remove();

  // Each state's table model, and the one-shot CSS animations its stylesheets
  // start on it (the board's flaps), so the SVG can replay them.
  const host = document.getElementById('host');
  const kebab = (p) => (p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  const rendered = [];
  for (const text of texts) {
    const el = document.createElement('cssv-table');
    const script = document.createElement('script');
    script.type = 'text/cssv';
    script.textContent = text;
    el.append(script);
    host.append(el);
    await el.ready;
    if (el.errors.length) throw new Error(el.errors.map((e) => `§${e.section} ${e.message}`).join('\n'));
    const { table } = el;
    const html = new XMLSerializer().serializeToString(table);
    const path = (node) => {
      const steps = [];
      for (; node !== table; node = node.parentElement) steps.unshift(`:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`);
      return ['table', ...steps].join(' > ');
    };
    const anims = [];
    for (const anim of table.getAnimations({ subtree: true })) {
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
    rendered.push({ html, anims });
    el.remove();
  }
  return { theme, code: code.filter((line) => line.length), rendered };
}, { texts: states.map((s) => s.text), full: fileOf({ lines: STYLE.length }, EDIT) });
await browser.close();
await server.close();

// --- Timeline ----------------------------------------------------------------
const CPS = 35;      // typing speed, characters per second
const BACK = 0.12;   // seconds per Backspace
const GAP = 0.2;     // from Enter to the first keystroke of a line
const RENDER = 0.3;  // last keystroke to the new table
const HOLD = 2.2;    // a finished scene stays this long
const MOVE = 0.25;   // lines sliding to make room
const FADE = 0.15;   // any other change

// Editor slots: 0 is the opening fence, 1 to STYLE.length the style rules.
// The closing fence and the CSV move together as the "tail"; the closing
// fence sits in slot lines + 1, and without a style block the CSV starts at
// slot 0.
const tailSlot = (lines) => (lines ? lines + 1 : -1);
const typed = new Map();         // editor line ('open', 0..n, 'close') -> { t0, t1 }
const tail = [[0, tailSlot(0)]]; // [time, slot]
const caret = [[0, 0, 0]];       // [time, slot, column] the caret jumps to
const caretRuns = [];            // [t0, t1, slot, from, to] while typing or deleting
const renders = [[0, stateOf(SCENES[0])]]; // [time, state shown]
const captions = [];
let selectAt, deleteAt, edited;
let t = 0;
// Enter opens a line at `slot` and pushes the tail down to `tailTo`, then
// the line is typed.
const type = (id, slot, text, tailTo) => {
  tail.push([t, tailTo]);
  caret.push([t, slot, 0]);
  t += GAP;
  const t1 = t + text.length / CPS;
  typed.set(id, { t0: t, t1 });
  caretRuns.push([t, t1, slot, 0, text.length]);
  t = t1;
};
SCENES.forEach((scene, i) => {
  captions.push(t);
  const prev = SCENES[i - 1];
  if (!prev) {
    t += HOLD + 0.4;
    return;
  }
  if (scene.edit) {
    // Type at the end of a CSV line, then delete what was typed.
    const { row, text } = scene.edit;
    const slot = tailSlot(scene.lines) + 1 + row;
    const col = CSV[row].length;
    caret.push([t, slot, col]);
    t += GAP;
    edited = { t0: t, t1: t + text.length / CPS };
    caretRuns.push([t, edited.t1, slot, col, col + text.length]);
    t = edited.t1 + RENDER;
    renders.push([t, stateOf(scene, true)]);
    t += HOLD;
    edited.b0 = t;
    edited.b1 = t + text.length * BACK;
    caretRuns.push([edited.b0, edited.b1, slot, col + text.length, col]);
    t = edited.b1 + RENDER;
    renders.push([t, stateOf(scene)]);
    t += HOLD;
  } else if (scene.lines > prev.lines) {
    // Until the closing fence is typed, the CSV sits right below the new line.
    if (!prev.lines) type('open', 0, '---', 0);
    for (let k = prev.lines; k < scene.lines; k++) type(k, k + 1, STYLE[k], prev.lines ? k + 2 : k + 1);
    if (!prev.lines) type('close', tailSlot(scene.lines), '---', tailSlot(scene.lines));
    t += RENDER;
    renders.push([t, stateOf(scene)]);
    t += HOLD;
  } else if (scene.lines < prev.lines) {
    // Select the style block and delete it.
    selectAt = t + 0.3;
    deleteAt = selectAt + 0.8;
    tail.push([deleteAt, tailSlot(scene.lines)]);
    caret.push([deleteAt, 0, 0]);
    renders.push([deleteAt + RENDER, stateOf(scene)]);
    t = deleteAt + RENDER + HOLD;
  } else {
    throw new Error(`Scene ${i + 1} must add style rules, delete the style block or edit the data.`);
  }
});
const T = Math.round(t * 100) / 100;

// --- Keyframes ---------------------------------------------------------------
// Every animation runs once per loop of T seconds, so they never drift apart.
// Identical keyframes share one animation.
const keyframes = [];
const animated = [];
const names = new Map(); // keyframes body -> animation name
function animate(stops) {
  const s = [...stops];
  if (s[0].t > 0) s.unshift({ t: 0, css: s[0].css });
  if (s.at(-1).t < T) s.push({ t: T, css: s.at(-1).css });
  let last = -1;
  const body = s.map(({ t, css, ease }) => {
    const p = Math.round((t / T) * 1e5) / 1e3;
    if (!(p > last && p <= 100)) throw new Error(`Keyframe at ${t}s is out of order`);
    last = p;
    return `${p}%{${css}${ease ? `;animation-timing-function:${ease}` : ''}}`;
  }).join('');
  if (names.has(body)) return names.get(body);
  const name = `k${animated.length}`;
  keyframes.push(`@keyframes ${name}{${body}}`);
  animated.push(name);
  names.set(body, name);
  return name;
}
// A value that changes at the given times, fading over `fade` seconds.
function changes(list, css, fade = FADE) {
  const stops = [];
  let prev;
  for (const [t, v] of list) {
    if (v === prev) continue;
    if (prev !== undefined) stops.push({ t, css: css(prev) });
    stops.push({ t: prev === undefined ? t : t + fade, css: css(v) });
    prev = v;
  }
  return stops.length > 1 ? animate(stops) : null;
}
const at = (list, time) => list.filter(([t]) => t <= time).at(-1)[1];
const still = renders.find(([, s]) => s === stateOf(SCENES[STILL]))[0] + 0.5;

// --- Stylesheets -------------------------------------------------------------
// One document holds every state's table, so each state's stylesheets are
// scoped to its wrapper (.s0, .s1, ...): every selector gets the wrapper as an
// ancestor, imports are inlined and @keyframes move to the top level. This
// works on the source text, because the CSSOM serializes a shorthand that
// uses var() as empty values once a longhand follows it.

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
const hoisted = new Map(); // @keyframes name -> rule
function scope(css, prefix, base) {
  let out = '';
  for (const { prelude, block } of rules(css)) {
    const at = /^@([\w-]+)/.exec(prelude)?.[1].toLowerCase();
    if (at === 'import') {
      const href = /^@import\s+(?:url\(\s*)?(["'])(.*?)\1\s*\)?$/i.exec(prelude);
      if (!href) throw new Error(`Only plain imports are supported: ${prelude}`);
      const url = new URL(href[2], base);
      out += scope(readFileSync(url, 'utf8'), prefix, url);
    } else if (at === 'charset') {
      // The file is UTF-8 anyway (SPEC 4.1).
    } else if (at === 'layer' && block === undefined) {
      out += `${prelude};`;
    } else if (['media', 'supports', 'layer', 'container'].includes(at)) {
      out += `${prelude}{${scope(block, prefix, base)}}`;
    } else if (at === 'keyframes') {
      const name = prelude.slice(10).trim();
      const rule = `${prelude}{${block}}`;
      if (/^(k\d+|caret)$/.test(name)) throw new Error(`@keyframes ${name} clashes with the demo's own animations`);
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

// --- Drawing -------------------------------------------------------------------
const W = 960, H = 440, HEAD = 44, FOOT = 52, SPLIT = 450;
const BODY = H - HEAD - FOOT;
const C = { size: 12, lh: 21, cw: 7.2, x: 22, top: HEAD + 16 }; // the editor
const PAD = 24; // around the table, like the website's stage
const slotY = (slot) => C.top + slot * C.lh;
const num = (x) => +x.toFixed(2);
const baseline = (center, size) => num(center + size * 0.35);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cls = (name) => (name ? ` class="${name}"` : '');
const opacity = (v) => `opacity:${v}`;
const maxLines = Math.max(...SCENES.map((s) => s.lines));
if (C.top + (maxLines + 2 + CSV.length) * C.lh > HEAD + BODY) throw new Error('The longest file is taller than the editor');
for (const line of [...STYLE, ...CSV.map((line, i) => (EDIT && i === EDIT.row ? line + EDIT.text : line))]) {
  if (C.x + line.length * C.cw > SPLIT - 6) throw new Error(`Too wide for the editor: ${line}`);
}

// One line of code on a fixed character grid, so typing uncovers whole
// letters whatever monospace font the viewer has.
function codeText(runs, slot) {
  let col = 0, out = '';
  for (const run of runs) {
    for (const m of run.text.matchAll(/\S+/g)) {
      const xs = [...m[0]].map((_, i) => num(C.x + (col + m.index + i) * C.cw)).join(' ');
      out += `<tspan x="${xs}" fill="${run.color}"${run.weight >= 600 ? ` font-weight="${run.weight}"` : ''}>${esc(m[0])}</tspan>`;
    }
    col += run.text.length;
  }
  return `<text y="${num(slotY(slot) + 15)}">${out}</text>`;
}

// A typed line: hidden until typed, uncovered letter by letter, gone when
// deleted. The cover is a rect in the editor's background color; once the
// line is typed it moves out of the editor, so its edges never show.
const length = (runs) => runs.reduce((n, r) => n + r.text.length, 0);
function typedLine(id, slot, runs) {
  const { t0, t1 } = typed.get(id);
  const len = length(runs);
  const shown = changes([[0, 0], [t0, 1], [deleteAt, 0]], opacity, 0.01);
  const cover = animate([
    { t: t0, css: 'transform:translateX(0px)', ease: `steps(${len},end)` },
    { t: t1, css: `transform:translateX(${num(len * C.cw)}px)` },
    { t: t1 + 0.01, css: `transform:translateX(${SPLIT}px)` },
  ]);
  return `<g${cls(shown)}>${codeText(runs, slot)}`
    + `<rect${cls(cover)} x="${C.x - 1}" y="${slotY(slot)}" width="${SPLIT}" height="${C.lh}" fill="${theme['code-bg']}" transform="translate(${SPLIT} 0)"/></g>`;
}

// The edited CSV line: the typed text is uncovered while it's there.
function editedLine(runs, slot) {
  const len = EDIT.text.length;
  const cover = animate([
    { t: edited.t0, css: 'transform:translateX(0px)', ease: `steps(${len},end)` },
    { t: edited.t1, css: `transform:translateX(${num(len * C.cw)}px)` },
    { t: edited.b0, css: `transform:translateX(${num(len * C.cw)}px)`, ease: `steps(${len},end)` },
    { t: edited.b1, css: 'transform:translateX(0px)' },
  ]);
  return codeText(runs, slot)
    + `<rect${cls(cover)} x="${num(C.x + CSV[EDIT.row].length * C.cw)}" y="${slotY(slot)}" width="${SPLIT}" height="${C.lh}" fill="${theme['code-bg']}"/>`;
}

function editor() {
  const [open, ...rest] = code;
  const style = rest.slice(0, STYLE.length);
  const [close, ...csv] = rest.slice(STYLE.length);

  // The selection is one shape, so no seams show between its lines.
  const selection = changes([[0, 0], [selectAt, 1], [deleteAt, 0]], opacity, 0.01);
  const selected = [open, ...style.slice(0, maxLines), close];
  const outline = selected.map((runs, i) => `H${num(C.x + length(runs) * C.cw + 2)}V${slotY(i + 1)}`).join('');
  const tailMoves = animate(tail.flatMap(([t, slot], i) => {
    const y = (s) => `transform:translateY(${num(s * C.lh)}px)`;
    return i ? [{ t, css: y(tail[i - 1][1]), ease: 'cubic-bezier(.2,.7,.3,1)' }, { t: t + MOVE, css: y(slot) }] : [{ t, css: y(slot) }];
  }));

  // The caret jumps between lines and steps along while typing or deleting.
  const pos = (slot, col) => `transform:translate(${num(C.x - 1 + col * C.cw)}px,${num(slotY(slot) + 2.5)}px)`;
  const events = [
    ...caret.map(([t, slot, col]) => ({ t, slot, col })),
    ...caretRuns.map(([t, t1, slot, from, to]) => ({ t, t1, slot, from, to })),
  ].sort((a, b) => a.t - b.t);
  let cur = events[0];
  const stops = [{ t: 0, css: pos(cur.slot, cur.col) }];
  for (const e of events.slice(1)) {
    if (e.t1 !== undefined) {
      stops.push({ t: e.t, css: pos(e.slot, e.from), ease: `steps(${Math.abs(e.to - e.from)},end)` }, { t: e.t1, css: pos(e.slot, e.to) });
      cur = { slot: e.slot, col: e.to };
    } else if (e.slot !== cur.slot || e.col !== cur.col) {
      if (stops.at(-1).t < e.t) stops.push({ t: e.t, css: pos(cur.slot, cur.col) });
      stops.push({ t: e.t + 0.01, css: pos(e.slot, e.col) });
      cur = e;
    }
  }
  const caretMoves = animate(stops);
  const caretShown = changes([[0, 1], [selectAt, 0], [deleteAt, 1]], opacity, 0.01);
  const [, , stillSlot, , stillCol] = caretRuns.filter(([, t1]) => t1 <= still).at(-1);

  return `<g clip-path="url(#editor)" class="m" font-size="${C.size}">`
    + `<path${cls(selection)} d="M${C.x - 3} ${slotY(0)}${outline}H${C.x - 3}Z" fill="#a78bfa" fill-opacity="0.35" opacity="0"/>`
    + typedLine('open', 0, open)
    + style.map((runs, k) => typedLine(k, k + 1, runs)).join('')
    + `<g${cls(tailMoves)} transform="translate(0 ${num(at(tail, still) * C.lh)})">`
    + typedLine('close', 0, close)
    + csv.map((runs, i) => (EDIT && i === EDIT.row ? editedLine(runs, i + 1) : codeText(runs, i + 1))).join('')
    + '</g>'
    + `<g${cls(caretShown)}><g${cls(caretMoves)} transform="translate(${num(C.x - 1 + stillCol * C.cw)} ${num(slotY(stillSlot) + 2.5)})">`
    + '<rect class="caret" width="2" height="16" fill="#f8fafc"/></g></g>'
    + '</g>';
}

// Replays a one-shot animation of the table each time its state is shown, as
// a new render does on the website: it holds its first frame until its delay
// has passed, plays, then holds its last frame until the state is hidden.
function replay(anim, shows) {
  const css = (props) => Object.entries(props).map(([p, v]) => `${p}:${v}`).join(';');
  const frames = anim.keyframes.map((k) => ({
    ...k,
    props: k.offset === 0 || k.offset === 1 ? { ...anim.base, ...k.props } : k.props,
  }));
  const before = ['backwards', 'both'].includes(anim.fill) ? frames[0].props : anim.base;
  const after = ['forwards', 'both'].includes(anim.fill) ? frames.at(-1).props : anim.base;
  const stops = [];
  for (const [from, to] of shows) {
    const start = from + anim.delay;
    if (start + anim.duration > to) throw new Error(`${anim.what} is still running when its table is replaced`);
    if (start > from) stops.push({ t: from, css: css(before) });
    for (const k of frames) stops.push({ t: start + k.offset * anim.duration, css: css(k.props), ease: k.easing });
    stops.push({ t: to + FADE, css: css(after) }, { t: to + FADE + 0.01, css: css(before) });
  }
  return animate(stops.filter(({ t }) => t < T));
}

function board() {
  // Each state is a wrapper like the component's .clip, stacked in one grid
  // cell; only the state being shown is opaque.
  const replays = [];
  const shown = at(renders, still);
  const scenes = rendered.map(({ html, anims }, s) => {
    const shows = renders.flatMap(([t, v], i) => (v === s ? [[t, renders[i + 1]?.[0] ?? T]] : []));
    for (const anim of anims) replays.push(`.s${s} > ${anim.path}{animation:${replay(anim, shows)} ${T}s linear infinite!important}`);
    const fade = changes(renders.map(([t, v]) => [t, v === s ? 1 : 0]), opacity);
    return `<div class="scene s${s}${fade ? ` ${fade}` : ''}" style="grid-area:1/1;contain:paint;width:max-content;opacity:${s === shown ? 1 : 0}">${html}</div>`;
  }).join('');
  const css = scope(DEFAULT_CSS, '.scene', BASE)
    + states.map(({ style }, s) => scope(style, `.s${s}`, new URL(NAME, BASE))).join('');
  // The foreignObject covers the whole image from 0,0, because WebKit has
  // misplaced transformed content in an offset foreignObject; the stage's
  // margin puts it over the right pane.
  const stage = `box-sizing:border-box;width:${W - SPLIT}px;height:${BODY}px;margin:${HEAD}px 0 0 ${SPLIT}px;padding:${PAD}px;`
    + `display:grid;place-items:center;overflow:hidden;container-type:inline-size;font:17px/1.6 ${theme.sans};color:${theme.text}`;
  return {
    css,
    replays,
    svg: `<foreignObject width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" lang="en-US" style="${esc(stage)}">${scenes}</div></foreignObject>`,
  };
}

function head() {
  // Left, an editor tab. Right, the element that renders the file.
  const mid = HEAD / 2;
  const dots = [18, 34, 50].map((cx) => `<circle cx="${cx}" cy="${mid}" r="5" fill="#fff" fill-opacity="0.12"/>`).join('');
  const tabW = NAME.length * 7.2 + 20;
  const tab = `<rect x="66.5" y="11.5" width="${tabW}" height="21" rx="7" fill="#fff" fill-opacity="0.07" stroke="#fff" stroke-opacity="0.12"/>`
    + `<text class="m" x="${num(66.5 + tabW / 2)}" y="${baseline(mid, 12)}" font-size="12" text-anchor="middle" fill="${theme['code-text']}">${NAME}</text>`;
  const cw = 7.2;
  const parts = [['<cssv-table', 'accent'], [' '], ['src', 'muted'], [`="${NAME}"`, 'text'], ['>', 'accent']];
  let col = 0, tag = '';
  for (const [text, color] of parts) {
    if (color) tag += `<tspan x="${num(SPLIT + 18 + col * cw)}" fill="${theme[color]}">${esc(text)}</tspan>`;
    col += text.length;
  }
  return `<rect width="${SPLIT}" height="${HEAD}" fill="${theme['code-bar']}"/>${dots}${tab}`
    + `<rect x="${SPLIT}" width="${W - SPLIT}" height="${HEAD}" fill="${theme.surface}"/>`
    + `<g class="m" font-size="12"><text y="${baseline(mid, 12)}">${tag}</text></g>`
    + `<path d="M0 ${HEAD - 0.5}H${SPLIT}" stroke="#fff" stroke-opacity="0.06"/><path d="M${SPLIT} ${HEAD - 0.5}H${W}" stroke="${theme.border}"/>`;
}

function footer() {
  // Captions cross-fade; the first fades in and the last fades out at the
  // loop's seam.
  const mid = H - FOOT / 2;
  const items = SCENES.map((scene, i) => {
    const t0 = i ? captions[i] : 0.01;
    const t1 = captions[i + 1] ?? T - 0.26;
    const shown = changes([[0, 0], [t0, 1], [t1, 0]], opacity, 0.25);
    const words = scene.caption.map((part) => (Array.isArray(part)
      ? `<tspan class="m" font-size="14" fill="${theme['accent-text']}">${esc(part[0])}</tspan>`
      : esc(part))).join('');
    return `<g${cls(shown)} opacity="${i === STILL ? 1 : 0}">`
      + `<circle cx="34" cy="${mid}" r="12" fill="${theme['accent-soft']}"/>`
      + `<text x="34" y="${baseline(mid, 13)}" text-anchor="middle" font-size="13" font-weight="700" fill="${theme['accent-text']}">${i + 1}</text>`
      + `<text x="58" y="${baseline(mid, 15)}" font-size="15" fill="${theme.text}">${words}</text></g>`;
  }).join('');
  return `<rect y="${H - FOOT}" width="${W}" height="${FOOT}" fill="${theme.surface}"/><path d="M0 ${H - FOOT + 0.5}H${W}" stroke="${theme.border}"/>`
    + `<g class="s">${items}`
    + `<text x="${W - 22}" y="${baseline(mid, 14)}" text-anchor="end" font-size="14" font-weight="600" fill="${theme.accent}">cssv.dev</text></g>`;
}

const table = board();
const body = head()
  + `<rect y="${HEAD}" width="${SPLIT}" height="${BODY}" fill="${theme['code-bg']}"/>`
  + `<rect x="${SPLIT}" y="${HEAD}" width="${W - SPLIT}" height="${BODY}" fill="${theme.stage}"/>`
  + `<rect x="${SPLIT}" y="${HEAD}" width="${W - SPLIT}" height="${BODY}" fill="url(#dots)"/>`
  + `<path d="M${SPLIT + 0.5} ${HEAD}V${H - FOOT}" stroke="${theme.border}"/>`
  + editor() + table.svg + footer();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
<title id="title">CSSV demo</title>
<desc id="desc">A CSSV file is typed into an editor, and the table rendered from it follows each change. The file starts as plain CSV. An imported stylesheet turns the table into a split-flap departures board. Rules on the sign classes give each delay a remark: on time, delayed, early or cancelled. --cssv-key names the rows, and one rule shows Boarding for flight LH 441. Typing a delay for the cancelled flight changes its remark, and deleting it cancels the flight again. Deleting the style block returns the plain table.</desc>
<style>
.m{font-family:${theme.mono}}
.s{font-family:${theme.sans}}
@media (prefers-reduced-motion:no-preference){
${animated.map((name) => `.${name}{animation:${name} ${T}s linear infinite}`).join('\n')}
${table.replays.join('\n')}
.caret{animation:caret 1.1s steps(1) infinite}
}
@keyframes caret{50%{opacity:0}}
${keyframes.join('\n')}
${esc([...hoisted.values()].join('\n'))}
${esc(table.css)}
</style>
<defs>
<clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath>
<clipPath id="editor"><rect y="${HEAD}" width="${SPLIT}" height="${BODY}"/></clipPath>
<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="1.1" fill="${theme.dots}"/></pattern>
</defs>
<g clip-path="url(#card)">
${body}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="15.5" fill="none" stroke="${theme.border}"/>
</svg>
`;
await writeFile(OUT, svg);
console.log(`site/demo.svg: ${(svg.length / 1024).toFixed(1)} KB, ${T}s loop, ${animated.length} animations`);
