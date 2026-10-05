// Generates site/intro.svg, the intro video for social media, and records it
// as an MP4 with --mp4.
//
// The story: a plain CSV file ("This is a CSV."), then five files that are
// also CSV: a departures board, a resume, the periodic table, a WhatsApp chat and
// a seat map. Each starts as its raw text in the same plain window, and every
// line moves to the row it becomes. Then the turn: every one is a CSV with CSS
// on top, and deleting the CSS gives the plain CSV back.
//
// Nothing in the tables is drawn by hand. Each file is rendered by the real
// <cssv-table> in Chromium, and the SVG embeds the table model it built with
// the file's own stylesheets scoped to it (see svg-tables.js). Row positions
// come from that render, so each line knows where it lands.
//
// The SVG has no script and no external resources, so it also animates as an
// <img>. With reduced motion it shows the five files side by side. The video
// is the same SVG: Chromium pauses its animations, steps them frame by frame,
// and ffmpeg encodes the screenshots.
//
// Run with: node tools/intro.js [--mp4 intro.mp4] [--fps 60] [--blur 4]
//           node tools/intro.js --stills <dir> --at 3.5,12,20
// --blur averages that many sub-frames per video frame, for motion blur.
// ffmpeg comes from $FFMPEG, or the PATH.
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_CSS } from '../src/core.js';
import { launchChromium, startServer } from '../test/browser/harness.js';
import { scopeCss, snapshotTable } from './svg-tables.js';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('site/intro.svg', ROOT);
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const MP4 = option('mp4');
const FPS = Number(option('fps', 60));
const BLUR = Number(option('blur', 4));
const STILLS = option('stills');
const AT_TIMES = option('at', '').split(',').filter(Boolean).map(Number);

// --- The look ------------------------------------------------------------------
const W = 1920, H = 1080;
const CY = 455;    // the content's center line; captions sit in the band below
const BAR = 56;    // a window's title bar
const COLD = '#dfe0e2', PAPER = '#ece8df', DOTS = 'rgb(40 30 10 / 0.09)';
const INK = '#1c1a17', MUTED = '#625c52', MARK = '#ffe45c', SOFT = '#fcf3c4';
const LINE = '#4b4b4b'; // the plain window's text
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
// The captions' font is embedded, so they look the same in every viewer.
const font = (weight) => `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};font-display:block;`
  + `src:url(data:font/woff2;base64,${readFileSync(new URL(`tools/fonts/inter-latin-${weight}-normal.woff2`, ROOT)).toString('base64')}) format("woff2")}`;
const FONTS = font(500) + font(800);

const EASE = {
  fly: 'cubic-bezier(.7,0,.25,1)',
  out: 'cubic-bezier(.22,1,.36,1)',
  in: 'cubic-bezier(.55,0,1,.45)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  back: 'cubic-bezier(.34,1.56,.64,1)',
};

// --- The files -------------------------------------------------------------------
// Each is rendered at `width`, the width of the box the table sits in.
const FILES = [
  { id: 'dep', src: 'site/departures.cssv', name: 'departures.csv', width: 700 },
  { id: 'resume', src: 'examples/resume.cssv', name: 'resume.csv', width: 880 },
  { id: 'el', src: 'examples/elements.cssv', name: 'elements.csv', width: 1300 },
  { id: 'chat', src: 'examples/whatsapp-chat.cssv', name: 'whatsapp-chat.csv', width: 420 },
  { id: 'seats', src: 'examples/seats.cssv', name: 'seats.csv', width: 480 },
];

// The CSV part of a file as records, written as in the file: a quoted field
// can hold a line break, so a record can span lines.
function records(text) {
  const lines = text.split('\n');
  const start = lines[0] === '---' ? lines.indexOf('---', 1) + 1 : 0;
  const out = [];
  let cur = '', quoted = false;
  for (const ch of lines.slice(start).join('\n').replace(/\n+$/, '')) {
    if (ch === '"') quoted = !quoted;
    if (ch === '\n' && !quoted) out.push(cur), cur = '';
    else cur += ch;
  }
  return [...out, cur];
}
// A record's fields as [start, end) offsets.
function fields(record) {
  const out = [];
  let start = 0, quoted = false;
  for (let i = 0; i <= record.length; i++) {
    if (record[i] === '"') quoted = !quoted;
    if (i === record.length || (record[i] === ',' && !quoted)) out.push([start, i]), start = i + 1;
  }
  return out;
}
for (const f of FILES) {
  f.text = readFileSync(new URL(f.src, ROOT), 'utf8');
  f.records = records(f.text);
}
const [DEP, RESUME, EL, CHAT, SEATS] = FILES;

// --- Render and measure in Chromium -------------------------------------------
const server = await startServer();
let browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
await page.mouse.move(W - 1, H - 1); // no hover on the tables
await page.goto(server.page('<div id="host"></div>', { path: '/site/__intro.html' }));
await page.waitForFunction(() => customElements.get('cssv-table'));
await page.addScriptTag({ content: `window.snapshotTable = ${snapshotTable};` });
await page.addStyleTag({ content: FONTS });
const measured = await page.evaluate(async ({ files, source, sans, mono }) => {
  const host = document.getElementById('host');
  const tables = [];
  for (const { src, width } of files) {
    // A box like the page's, and the element inside it.
    const box = document.createElement('div');
    box.style.cssText = `width:${width}px;container-type:inline-size`;
    const el = document.createElement('cssv-table');
    el.setAttribute('src', `/${src}`);
    box.append(el);
    host.append(box);
    await el.ready;
    if (el.errors.length) throw new Error(`${src}: ${el.errors.map((e) => `§${e.section} ${e.message}`).join('\n')}`);
    const b = box.getBoundingClientRect();
    const rel = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x - b.x, y: r.y - b.y, w: r.width, h: r.height };
    };
    const { table } = el;
    const firstText = (row) => {
      const cell = row.cells[0];
      return rel(cell).x + parseFloat(getComputedStyle(cell).paddingLeft);
    };
    tables.push({
      ...snapshotTable(table),
      box: { w: b.width, h: b.height },
      table: rel(table),
      head: [...(table.tHead?.rows ?? [])].map(rel),
      headText: [...(table.tHead?.rows ?? [])].map(firstText),
      rows: [...table.tBodies[0].rows].map(rel),
      rowText: [...table.tBodies[0].rows].map(firstText),
      cells: [...table.tBodies[0].rows].map((row) => [...row.cells].map(rel)),
      font: parseFloat(getComputedStyle(table).fontSize),
    });
    box.remove();
  }

  // Text widths: monospace advance, and the word the first caption gains.
  const probe = (text, css) => {
    const s = document.createElement('span');
    s.style.cssText = `position:absolute;white-space:pre;${css}`;
    s.textContent = text;
    document.body.append(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  await document.fonts.load(`800 68px Inter`);
  await document.fonts.load(`500 22px Inter`);
  const advance = probe('0'.repeat(100), `font:100px ${mono}`) / 10000;
  const also = probe('also ', `font:800 68px/1 ${sans};letter-spacing:-0.025em`);

  // The departures file, highlighted as on the website, as lines of { cls, text } runs.
  const { highlightCssv } = await import('/site/highlight.js');
  const lines = [[]];
  for (const node of highlightCssv(source).childNodes) {
    const cls = node.nodeType === 1 ? node.className : '';
    node.textContent.split('\n').forEach((text, i) => {
      if (i) lines.push([]);
      if (text) lines.at(-1).push({ cls, text });
    });
  }
  return { tables, advance, also, source: lines.slice(0, -1) };
}, { files: FILES.map(({ src, width }) => ({ src, width })), source: DEP.text, sans: SANS, mono: MONO });
FILES.forEach((f, i) => Object.assign(f, measured.tables[i]));
const ADV = measured.advance;

// --- Timeline --------------------------------------------------------------------
// Every animation runs once per loop of T seconds, so they never drift apart.
// Each starts where it ends, so the loop has no seam.
const AT = {
  dep: 3.0,      // the first lines leave the window
  pan1: 9.3,     // camera to the resume
  resume: 10.1,
  pan2: 15.3,
  el: 16.1,
  pan3: 22.4,
  chat: 23.2,
  pan4: 28.0,
  seats: 28.8,
  turn: 34.0,    // pull back to all five
  push: 36.0,    // into the departures board
  flip: 37.0,    // the board turns over to its file
  proof: 38.7,
  del: 39.7,     // the style block is deleted
  pitch: 41.9,
  end: 45.9,
  loop: 49.4,    // the end card gives way to the opening frame
};
const T = 50;
const PAN = 0.8;
const STILL = 35.8; // the frame shown with reduced motion: all five, side by side
// From RESET until the loop, the stations are hidden, so everything in them
// goes back to how it starts.
const RESET = AT.pitch + 1;

const num = (x, d = 2) => +x.toFixed(d);
const px = (x) => `${num(x)}px`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// anim(selector, stops): stops are [time, { property: value }, easing], all
// with the same properties; the easing runs to the next stop. An element can
// have several animations, on different properties.
const anims = new Map(); // selector -> [{ stops, reset }]
function anim(sel, stops, { reset = true, sparse = false } = {}) {
  if (!anims.has(sel)) anims.set(sel, []);
  anims.get(sel).push({ stops, reset, sparse });
}
// Two stops: from `a` at t to `b` at t + d.
const tw = (t, d, a, b, ease) => [[t, a, ease], [t + d, b]];
const keyframes = new Map(); // body -> name
function emit(sel, { stops, reset, sparse }) {
  const s = stops.map(([t, css, ease]) => ({ t, css, ease })).sort((a, b) => a.t - b.t);
  for (let i = 1; i < s.length; i++) if (s[i].t <= s[i - 1].t) s[i].t = s[i - 1].t + 0.001;
  const props = Object.keys(s[0].css).sort().join();
  // Sparse stops (a replayed animation's keyframes) leave some properties to
  // the keyframes around them, as in CSS.
  if (!sparse) for (const k of s) if (Object.keys(k.css).sort().join() !== props) throw new Error(`${sel}: stops animate different properties`);
  const text = (css) => Object.entries(css).map(([p, v]) => `${p}:${v}`).join(';');
  if (reset && text(s[0].css) !== text(s.at(-1).css)) {
    if (s.at(-1).t >= RESET) throw new Error(`${sel} still changes after the reset`);
    s.push({ t: RESET, css: s.at(-1).css }, { t: RESET + 0.001, css: s[0].css });
  }
  if (s[0].t > 0) s.unshift({ t: 0, css: s[0].css });
  if (s.at(-1).t < T) s.push({ t: T, css: s.at(-1).css });
  if (s.at(-1).t > T) throw new Error(`${sel} runs past the loop`);
  if (text(s[0].css) !== text(s.at(-1).css)) throw new Error(`${sel} doesn't end where it starts`);
  const body = s.map(({ t, css, ease }) => `${num((t / T) * 100, 4)}%{${text(css)}${ease ? `;animation-timing-function:${ease}` : ''}}`).join('');
  if (!keyframes.has(body)) keyframes.set(body, `k${keyframes.size}`);
  return keyframes.get(body);
}
const run = (name) => `${name} ${T}s linear var(--delay,0s) infinite var(--play,running)`;
function animationCss() {
  let out = '';
  for (const [sel, list] of anims) {
    const props = list.flatMap(({ stops }) => Object.keys(stops[0][1]));
    if (new Set(props).size !== props.length) throw new Error(`${sel}: two animations on the same property`);
    out += `${sel}{animation:${list.map((a) => run(emit(sel, a))).join(',')}!important}\n`;
  }
  return out;
}

// Opacity and transform helpers.
const op = (v) => ({ opacity: v });
const tf = (x, y, s = 1) => ({ transform: `translate(${px(x)},${px(y)}) scale(${num(s, 4)})` });
const sc = (sx, sy = sx) => ({ transform: `scale(${num(sx, 4)},${num(sy, 4)})` });
const shown = { 'clip-path': 'inset(0 0 0 0)' };
const hiddenL = { 'clip-path': 'inset(0 100% 0 0)' }; // a mark not drawn yet
const hiddenR = { 'clip-path': 'inset(0 0 0 100%)' }; // a mark wiped away
// A highlighter stroke drawn left to right at t, and cleared at `until`.
const swipe = (t, d = 0.32, until) => [[0, hiddenL], ...tw(t, d, hiddenL, shown, EASE.out), ...(until ? [[until, shown], [until + 0.001, hiddenL]] : [])];
// A line flies from `from` (its box) to the point `to`, scaled by k, and fades
// as it lands. `align` is the point of the line that lands: its left edge's
// middle or its center. Over a dark table it turns to `color` on the way.
function fly(sel, from, to, t, d, k, { align = 'left', ease = EASE.fly, color } = {}) {
  const fx = align === 'left' ? from.x : from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  anim(sel, [[0, tf(0, 0)], ...tw(t, d, tf(0, 0), tf(to.x - fx, to.y - fy, k), ease)]);
  anim(sel, [[0, op(1)], ...tw(t + d - 0.08, 0.2, op(1), op(0))]);
  if (color) anim(sel, [[0, { color: LINE }], ...tw(t, d * 0.5, { color: LINE }, { color })]);
  return t + d;
}

// --- The camera --------------------------------------------------------------------
// A pose puts world point (x, y) at the screen's content center, at scale s.
// Station k's own pose is { x: 1920k + 960, y: CY, s: 1 }.
const home = (k) => ({ x: W * k + W / 2, y: CY, s: 1 });
// Moves are added scene by scene; each starts from the pose before it.
const moves = []; // { t0, t1, a, b, dip, ease }
function move(t0, d, to, { dip = 0, ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2) } = {}) {
  moves.push({ t0, t1: t0 + d, b: to, dip, ease });
}
function poseAt(t) {
  let p = home(0);
  for (const m of moves) {
    if (t >= m.t1) p = m.b;
    else if (t > m.t0) {
      const q = (t - m.t0) / (m.t1 - m.t0), e = m.ease(q);
      const lerp = (a, b) => a + (b - a) * e;
      // Geometric zoom, so zooming in and out feel the same speed.
      const s = m.a.s * (m.b.s / m.a.s) ** e * (1 - m.dip * Math.sin(Math.PI * q));
      return { x: lerp(m.a.x, m.b.x), y: lerp(m.a.y, m.b.y), s };
    }
  }
  return p;
}
function cameraAnims() {
  moves.sort((a, b) => a.t0 - b.t0);
  moves.forEach((m, i) => {
    m.a = i ? moves[i - 1].b : home(0);
    if (i && m.t0 < moves[i - 1].t1) throw new Error(`Camera moves overlap at ${m.t0}s`);
  });
  if (moves.length && JSON.stringify(moves.at(-1).b) !== JSON.stringify(home(0))) throw new Error('The camera must end at home');
  const times = new Set([0, T]);
  for (const m of moves) for (let t = m.t0; t < m.t1; t += 1 / 30) times.add(num(t, 4)), times.add(num(m.t1, 4));
  const ts = [...times].sort((a, b) => a - b);
  const world = ({ x, y, s }) => ({ transform: `translate(${px(W / 2 - x * s)},${px(CY - y * s)}) scale(${num(s, 5)})` });
  // The dots behind move slower, for depth.
  const dots = ({ x, y, s }) => {
    const d = s ** 0.4;
    return { transform: `translate(${px(W / 2 - x * 0.35 * d)},${px(CY - y * 0.35 * d)}) scale(${num(d, 5)})` };
  };
  anim('.world', ts.map((t) => [t, world(poseAt(t))]), { reset: false });
  anim('.dots', ts.map((t) => [t, dots(poseAt(t))]), { reset: false });
}

// --- Building blocks ---------------------------------------------------------------
// Markup per station: tables under the windows, so lines fly over them.
const html = { under: FILES.map(() => ''), st: FILES.map(() => '') };
const final = []; // each station's content at the end of its scene, for the overview
let uid = 0;
const id = (prefix) => `${prefix}${uid++}`;

// A table placed in a station, scaled by S. at(r) maps a rectangle measured
// in its box to station coordinates.
function place(f, { S, cx = W / 2, cy = CY, top }) {
  const t = f.table;
  const ox = cx - S * (t.x + t.w / 2);
  const oy = top !== undefined ? top - S * t.y : cy - S * (t.y + t.h / 2);
  const at = (r) => ({ x: ox + S * r.x, y: oy + S * r.y, w: S * r.w, h: S * r.h });
  return { S, ox, oy, at, rect: at(t) };
}
// The table model in its box, inside a wrapper the timeline animates. The
// box is like the element's .clip, and the class scopes the file's styles.
function tableHtml(f, k, p, cls) {
  const t = f.table;
  return `<div class="tp" style="left:${px(p.ox)};top:${px(p.oy)};transform:scale(${num(p.S, 4)})">`
    + `<div class="ta ${cls}" style="transform-origin:${px(t.x + t.w / 2)} ${px(t.y + t.h / 2)}">`
    + `<div class="tbox" style="width:${px(f.width)}"><div class="tb s${k}">${f.html}</div></div></div></div>`;
}

// A plain editor window. Lines are separate elements, so they can leave it.
function windowBox({ x, y, w, h, name, cls, extra = '' }) {
  return `<div class="win ${cls}" style="left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">`
    + `<div class="bar"><i></i><i></i><i></i>${extra || `<span>${esc(name)}</span>`}</div></div>`;
}
// Lays out records in a window centered on (cx, cy). Returns the window box
// and each record's line box.
function layout(recs, { size, lh, padX = 44, padY = 30, w, cx = W / 2, cy = CY }) {
  const textW = (rec) => Math.max(...rec.split('\n').map((l) => [...l].length)) * ADV * size;
  const width = w ?? Math.ceil(Math.max(...recs.map(textW)) + 2 * padX);
  const n = recs.reduce((sum, r) => sum + r.split('\n').length, 0);
  const height = BAR + 2 * padY + n * lh;
  const x = cx - width / 2, y = cy - height / 2;
  let row = 0;
  const lines = recs.map((rec) => {
    const rows = rec.split('\n').length;
    const box = { x: x + padX, y: y + BAR + padY + row * lh, w: Math.min(textW(rec), width - 2 * padX), h: rows * lh };
    row += rows;
    return box;
  });
  return { x, y, w: width, h: height, lines, size, lh, padX, padY };
}
const lineHtml = (cls, box, size, lh, inner, style = '') => `<div class="ln ${cls}" style="left:${px(box.x)};top:${px(box.y)};`
  + `width:${px(Math.ceil(box.w + ADV * size) + 2)};font-size:${px(size)};line-height:${px(lh)}${style}">${inner}</div>`;
const mark = (text, cls = '') => `<b class="hl">${text}<i class="mk ${cls}"></i></b>`;

// Replays a one-shot animation of a table from `from` to `to`, as a render
// does on the website: it holds its first frame until its delay has passed,
// plays, then holds its last frame until the table is hidden.
function replay(sel, a, from, to) {
  const frames = a.keyframes.map((k) => ({
    ...k,
    props: k.offset === 0 || k.offset === 1 ? { ...a.base, ...k.props } : k.props,
  }));
  const names = [...new Set(frames.flatMap((k) => Object.keys(k.props)))];
  const full = (props) => Object.fromEntries(names.map((n) => [n, props[n] ?? a.base[n]]));
  const before = full(['backwards', 'both'].includes(a.fill) ? frames[0].props : a.base);
  const after = full(['forwards', 'both'].includes(a.fill) ? frames.at(-1).props : a.base);
  const start = from + a.delay;
  if (start + a.duration > to) throw new Error(`${a.what} is still running when its table is hidden`);
  anim(sel, [
    [0, before], [start, before],
    ...frames.map((k) => [start + k.offset * a.duration, k.offset === 0 || k.offset === 1 ? full(k.props) : k.props, k.easing]),
    [to, after], [to + 0.001, before],
  ], { sparse: true });
}

// --- 0 and 1: a CSV, then a departures board -----------------------------------------
// The opening frame is the plain file; the same file comes back at the end.
const coldWin = layout(DEP.records, { size: 40, lh: 60, padX: 48, padY: 34 });
{
  const st = 0, f = DEP;
  html.st[st] += windowBox({ ...coldWin, name: f.name, cls: 'w0' });
  f.records.forEach((rec, i) => { html.st[st] += lineHtml(`l0-${i}`, coldWin.lines[i], 40, 60, esc(rec)); });
  const last = coldWin.lines.at(-1);
  html.st[st] += `<i class="caretw" style="left:${px(last.x + DEP.records.at(-1).length * ADV * 40 + 3)};top:${px(last.y + 8)}"><i class="caret"></i></i>`;

  const p = place(f, { S: Math.min(1240 / f.table.w, 800 / f.table.h) });
  html.under[st] += tableHtml(f, st, p, 'ta0');
  final[st] = p.rect;
  const k = (f.font * p.S) / 40;
  const t0 = AT.dep;
  // The header lands on the column labels, each record on its row.
  const targets = [
    { x: p.ox + p.S * f.headText[0], y: p.at(f.head[0]).y + p.at(f.head[0]).h / 2 },
    ...f.rows.map((r, i) => ({ x: p.ox + p.S * f.rowText[i], y: p.at(r).y + p.at(r).h / 2 })),
  ];
  const lands = f.records.map((_, i) => fly(`.l0-${i}`, coldWin.lines[i], targets[i], t0 + i * 0.085, 0.75, i ? k : k * 0.62, { color: '#f6f1e1' }));
  // The flaps of each row start as its line lands.
  for (const a of f.anims) replay(`.s0 > ${a.path}`, a, lands[1], AT.flip + 0.22);
  anim('.w0', [[0, { ...op(1), ...sc(1) }], ...tw(t0 + 0.05, 0.4, { ...op(1), ...sc(1) }, { ...op(0), ...sc(0.96) }, EASE.in)]);
  anim('.caretw', [[0, op(1)], [t0, op(1)], [t0 + 0.01, op(0)], [AT.del + 0.9, op(0)], [AT.del + 0.901, op(1)]]);
  // The board appears under the flying lines, and turns over at the flip.
  anim('.ta0', [[0, op(0)], ...tw(t0 + 0.15, 0.45, op(0), op(1), EASE.out), [AT.flip + 0.22, op(1)], [AT.flip + 0.221, op(0)]]);
  anim('.ta0', [[0, sc(0.94)], ...tw(t0 + 0.15, 0.6, sc(0.94), sc(1), EASE.out),
    ...tw(AT.flip, 0.22, sc(1), sc(0, 1), EASE.in), [RESET - 0.5, sc(0, 1)], [RESET - 0.499, sc(0.94)]]);
}

// --- 2: a resume ---------------------------------------------------------------------
{
  const st = 1, f = RESUME, n = 14;
  const recs = f.records.slice(0, n);
  const L = layout(recs, { size: 28, lh: 44, padX: 40, padY: 28, w: 1480 });
  html.st[st] += windowBox({ ...L, name: f.name, cls: 'w1' });
  recs.forEach((rec, i) => {
    // The first field is the key column: it says what each line is.
    const [[a, b]] = fields(rec);
    html.st[st] += lineHtml(`l1-${i}`, L.lines[i], 28, 44, `${mark(esc(rec.slice(a, b)), `m1-${i}`)}${esc(rec.slice(b))}`);
    anim(`.m1-${i}`, swipe(AT.resume + 0.3 + i * 0.035, 0.22));
  });
  const p = place(f, { S: 1.25, top: 64 });
  html.under[st] += tableHtml(f, st, p, 'ta1');
  final[st] = { ...p.rect, h: 1000 }; // a long page: its top is enough
  const t0 = AT.resume + 0.95;
  anim('.ta1', [[0, tf(0, 40)], ...tw(t0 - 0.1, 0.6, tf(0, 40), tf(0, 0), EASE.out)]);
  anim('.ta1', [[0, op(0)], ...tw(t0 - 0.1, 0.4, op(0), op(1))]);
  anim('.w1', [[0, op(1)], ...tw(t0, 0.35, op(1), op(0))]);
  recs.forEach((_, i) => {
    const t = t0 + i * 0.05;
    if (i === 0) {
      // The header names the columns and isn't shown: it fades on the way up.
      fly('.l1-0', L.lines[0], { x: p.rect.x + 60, y: p.rect.y + 20 }, t, 0.6, 0.5);
      return;
    }
    const r = p.at(f.rows[i - 1]);
    // The name is set large; every other line is body text.
    const k = f.records[i].startsWith('name,') ? 1.5 : (f.font * p.S * 1.15) / 28;
    const lh = Math.min(r.h, 44 * k);
    const land = fly(`.l1-${i}`, L.lines[i], { x: r.x, y: r.y + lh / 2 }, t, 0.7, k);
    anim(`.s1 > table > tbody > tr:nth-child(${i})`, [[0, op(0)], ...tw(land - 0.08, 0.3, op(0), op(1))]);
  });
  // The rest of the resume fills in below.
  for (let i = n; i <= f.rows.length; i++) {
    anim(`.s1 > table > tbody > tr:nth-child(${i})`, [[0, op(0)], ...tw(t0 + 0.75 + (i - n) * 0.012, 0.35, op(0), op(1))]);
  }
  // Down the timeline to the second job.
  const job2 = p.at(f.rows[f.records.slice(1).findIndex((r, i) => r.startsWith('job,') && i > 9)]);
  move(AT.resume + 2.5, AT.pan2 - AT.resume - 2.8, { x: home(st).x, y: CY + Math.max(0, job2.y - 330), s: 1 });
}

// --- 3: the periodic table ---------------------------------------------------------------
{
  const st = 2, f = EL;
  const lines = f.records; // header + 118 elements
  const shownLines = 12, size = 28, lh = 44, padX = 40, padY = 28;
  const L = layout(lines.slice(0, shownLines), { size, lh, padX, padY, w: 780 });
  const p = place(f, { S: Math.min(1500 / f.table.w, 840 / f.table.h) });
  // The window settles in the gap above the transition metals, where the title goes.
  const tile = (n) => p.at(f.rows[n - 1]);
  const gap = { x: tile(21).x, y: tile(1).y, r: tile(30).x + tile(30).w, b: tile(11).y + tile(11).h };
  const smallH = BAR + 2 * padY + 4 * lh;
  const gs = Math.min((gap.r - gap.x - 40) / L.w, (gap.b - gap.y - 24) / smallH);
  const gx = (gap.x + gap.r) / 2 - (L.w * gs) / 2 - L.x;
  const gy = (gap.y + gap.b) / 2 - (smallH * gs) / 2 - L.y;

  html.under[st] += tableHtml(f, st, p, 'ta2');
  final[st] = p.rect;
  const clip = { x: padX, y: BAR + padY, w: L.w - 2 * padX };
  html.st[st] += `<div class="wg wg2" style="left:${px(L.x)};top:${px(L.y)};width:${px(L.w)}">`
    + windowBox({ x: 0, y: 0, w: L.w, h: L.h, name: f.name, cls: 'w2' })
    + `<div class="clip2" style="left:${px(clip.x)};top:${px(clip.y)};width:${px(clip.w)};height:${px(shownLines * lh)}">`
    + `<div class="col2">${lines.map((rec) => `<div class="cl" style="font-size:${px(size)};line-height:${px(lh)}">${esc(rec)}</div>`).join('')}</div></div></div>`;

  const t1 = AT.el + 0.4;  // the window moves into the gap
  const s0 = AT.el + 1.15; // the stream starts
  const dt = 0.018;
  const sEnd = s0 + 118 * dt;
  anim('.wg2', [[0, tf(0, 0)], ...tw(t1, 0.65, tf(0, 0), tf(gx, gy, gs), EASE.inOut)]);
  anim('.wg2', [[0, op(1)], ...tw(sEnd + 0.4, 0.3, op(1), op(0))]);
  anim('.w2', [[0, { height: px(L.h) }], ...tw(t1, 0.65, { height: px(L.h) }, { height: px(smallH) }, EASE.inOut)]);
  anim('.clip2', [[0, { height: px(shownLines * lh) }], ...tw(t1, 0.65, { height: px(shownLines * lh) }, { height: px(4 * lh) }, EASE.inOut)]);
  anim('.col2', [[0, { transform: 'translateY(0px)' }], [s0, { transform: 'translateY(0px)' }], [sEnd, { transform: `translateY(${px(-118 * lh)})` }]]);
  // The scrolling text dims, so the lines leaving it stand out.
  anim('.col2', [[0, op(1)], ...tw(s0 - 0.2, 0.25, op(1), op(0.35))]);
  anim('.ta2', [[0, op(0)], ...tw(t1, 0.5, op(0), op(1))]);
  // The title and the f-block labels come last.
  for (const pseudo of ['after', 'before']) {
    anim(`.s2 > table > tbody::${pseudo}`, [[0, { ...op(0), ...sc(0.92) }], ...tw(sEnd + 0.45, 0.5, { ...op(0), ...sc(0.92) }, { ...op(1), ...sc(1) }, EASE.out)]);
  }
  // Each line leaves the window's top as it scrolls past, and lands on its tile.
  const topSlot = { x: L.x + gx + gs * clip.x, y: L.y + gy + gs * clip.y };
  for (let n = 1; n <= 118; n++) {
    const t = s0 + (n - 1) * dt;
    const w = Math.min([...lines[n]].length * ADV * size, clip.w) * gs;
    const from = { x: topSlot.x, y: topSlot.y, w, h: lh * gs };
    html.st[st] += lineHtml(`f2-${n}`, from, size * gs, lh * gs, esc(lines[n]), ';transform-origin:50% 50%');
    const r = tile(n);
    anim(`.f2-${n}`, [[0, op(0)], [t, op(0)], [t + 0.001, op(1)], ...tw(t + 0.5, 0.12, op(1), op(0))]);
    anim(`.f2-${n}`, [[0, { color: LINE }], ...tw(t + 0.04, 0.2, { color: LINE }, { color: '#e2e8f0' })]);
    anim(`.f2-${n}`, [[0, tf(0, 0)], ...tw(t, 0.58, tf(0, 0), tf(r.x + r.w / 2 - (from.x + w / 2), r.y + r.h / 2 - (from.y + from.h / 2), Math.min(1, (r.w * 0.9) / w)), 'cubic-bezier(.3,.6,.25,1)')]);
    const land = t + 0.52;
    anim(`.s2 > table > tbody > tr:nth-child(${n})`, [[0, op(0)], ...tw(land, 0.12, op(0), op(1))]);
    anim(`.s2 > table > tbody > tr:nth-child(${n})`, [[0, sc(0.2)], ...tw(land, 0.2, sc(0.2), sc(1.16), EASE.out), ...tw(land + 0.2, 0.25, sc(1.16), sc(1), EASE.inOut)]);
  }
  // A slow push in, keeping the table clear of the captions.
  const push = 1.06;
  move(sEnd + 0.7, AT.pan3 - sEnd - 0.8, { x: W * st + p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h - (872 - CY) / push, s: push }, { ease: (q) => 1 - (1 - q) ** 2 });
}

// --- 4: a WhatsApp chat ----------------------------------------------------------------
{
  const st = 3, f = CHAT;
  const L = layout(f.records, { size: 24, lh: 38, padX: 40, padY: 26, w: 1180 });
  const gs = 0.72, gcx = 500; // the window, moved aside
  const gx = gcx - (L.x + L.w / 2) + (L.w * (1 - gs)) / 2, gy = (L.h * (1 - gs)) / 2;
  html.st[st] += `<div class="wg wg3" style="left:${px(L.x)};top:${px(L.y)};width:${px(L.w)}">`
    + windowBox({ x: 0, y: 0, w: L.w, h: L.h, name: f.name, cls: 'w3' })
    + f.records.map((rec, i) => lineHtml(`l3-${i}`, { ...L.lines[i], x: L.lines[i].x - L.x, y: L.lines[i].y - L.y }, 24, 38, esc(rec))).join('')
    + '</div>';

  // A phone: the chat scrolls up inside it as messages arrive.
  const V = 800, bezel = 14;
  const phone = { w: f.box.w + 2 * bezel, h: V + 2 * bezel };
  const pcx = 1390;
  const ph = { x: pcx - phone.w / 2, y: CY - phone.h / 2 };
  final[st] = { x: W / 2 - phone.w / 2, y: ph.y, ...phone };
  html.under[st] += `<div class="phone" style="left:${px(ph.x)};top:${px(ph.y)};width:${px(phone.w)};height:${px(phone.h)}">`
    + `<div class="vp" style="left:${px(bezel)};top:${px(bezel)};width:${px(f.box.w)};height:${px(V)}">`
    + `<div class="col3"><div class="tbox" style="width:${px(f.width)}"><div class="tb s${st}">${f.html}</div></div></div></div></div>`;

  const t1 = AT.chat + 0.3;
  anim('.wg3', [[0, tf(0, 0)], ...tw(t1, 0.55, tf(0, 0), tf(gx, gy, gs), EASE.inOut)]);
  anim('.phone', [[0, op(0)], ...tw(t1 + 0.1, 0.4, op(0), op(1))]);
  anim('.phone', [[0, tf(0, 160)], ...tw(t1 + 0.1, 0.6, tf(0, 160), tf(0, 0), EASE.out), ...tw(AT.chat + 3.95, 0.6, tf(0, 0), tf(W / 2 - pcx, 0), EASE.inOut)]);
  // Before row i shows, the chat scrolls so that it ends at the phone's bottom.
  const offset = (i) => V - 12 - (f.rows[i - 1].y + f.rows[i - 1].h);
  const scroll = [[0, { transform: `translateY(${px(offset(1))})` }]];
  const lineAbs = (i) => ({ x: L.lines[i].x - L.x, y: L.lines[i].y - L.y, w: L.lines[i].w, h: L.lines[i].h });
  let last = 0;
  for (let i = 1; i < f.records.length; i++) {
    const t = AT.chat + 1.0 + (i - 1) * 0.15;
    const r = f.rows[i - 1];
    // Where the bubble ends up, in the window's own coordinates.
    const to = { x: ph.x + bezel + r.x, y: ph.y + bezel + offset(i) + r.y + Math.min(r.h, 40) / 2 };
    const local = { x: (to.x - L.x - gx) / gs, y: (to.y - L.y - gy) / gs };
    last = fly(`.l3-${i}`, lineAbs(i), local, t, 0.45, Math.min(0.5, r.w / L.lines[i].w) / gs);
    const sam = f.records[i].split(',')[2] === 'Sam';
    const system = f.records[i].split(',')[2] === '';
    const origin = system ? '50% 0' : sam ? '100% 0' : '0 0';
    const sel = `.s3 > table > tbody > tr:nth-child(${i})`;
    anim(sel, [[0, op(0)], ...tw(last - 0.06, 0.14, op(0), op(1))]);
    anim(sel, [[0, { ...sc(0.8), 'transform-origin': origin }], ...tw(last - 0.06, 0.32, { ...sc(0.8), 'transform-origin': origin }, { ...sc(1), 'transform-origin': origin }, EASE.back)]);
    if (i > 1) scroll.push(...tw(last - 0.08, 0.14, { transform: `translateY(${px(offset(i - 1))})` }, { transform: `translateY(${px(offset(i))})` }, EASE.out));
  }
  anim('.col3', scroll);
  anim('.l3-0', [[0, op(1)], ...tw(AT.chat + 1.0, 0.3, op(1), op(0))]);
  anim('.w3', [[0, op(1)], ...tw(last + 0.05, 0.35, op(1), op(0))]);
}

// --- 5: a seat map --------------------------------------------------------------------------
{
  const st = 4, f = SEATS;
  const size = 30, lh = 46;
  const L = layout(f.records, { size, lh, padX: 44, padY: 28, w: 470 });
  const gs = 0.8, gcx = 560;
  const gx = gcx - (L.x + L.w / 2) + (L.w * (1 - gs)) / 2, gy = (L.h * (1 - gs)) / 2;
  // Empty fields are free seats: each gets a highlighter dab between its commas.
  let dab = 0;
  const dabs = [];
  const recHtml = (rec, i) => {
    if (!i) return esc(rec);
    let out = '';
    for (const [a, b] of fields(rec)) {
      if (a) out += ',';
      if (a === b) { const c = `d4-${dab++}`; dabs.push(c); out += `<i class="gap"><i class="mk ${c}"></i></i>`; } else out += esc(rec.slice(a, b));
    }
    return out;
  };
  html.st[st] += `<div class="wg wg4" style="left:${px(L.x)};top:${px(L.y)};width:${px(L.w)}">`
    + windowBox({ x: 0, y: 0, w: L.w, h: L.h, name: f.name, cls: 'w4' })
    + f.records.map((rec, i) => lineHtml(`l4-${i}`, { ...L.lines[i], x: L.lines[i].x - L.x, y: L.lines[i].y - L.y }, size, lh, recHtml(rec, i), ';transform-origin:50% 50%')).join('')
    + '</div>';
  dabs.forEach((c, i) => anim(`.${c}`, [[0, { ...op(0), ...sc(0.2) }], ...tw(AT.seats + 0.3 + i * 0.014, 0.25, { ...op(0), ...sc(0.2) }, { ...op(1), ...sc(1) }, EASE.back)]));

  const p = place(f, { S: Math.min(1.08, 840 / f.table.h), cx: 1290 });
  html.under[st] += tableHtml(f, st, p, 'ta4');
  final[st] = p.rect;
  const t1 = AT.seats + 0.95;
  anim('.wg4', [[0, tf(0, 0)], ...tw(t1, 0.55, tf(0, 0), tf(gx, gy, gs), EASE.inOut)]);
  anim('.ta4', [[0, tf(0, 900)], ...tw(t1 + 0.05, 0.75, tf(0, 900), tf(0, 0), EASE.out)]);
  const rowsAt = [p.at(f.head[0]), ...f.rows.map(p.at)];
  let last = 0;
  f.records.forEach((rec, i) => {
    const r = rowsAt[i];
    const to = { x: (r.x + r.w / 2 - L.x - gx) / gs, y: (r.y + r.h / 2 - L.y - gy) / gs };
    const box = { x: L.lines[i].x - L.x, y: L.lines[i].y - L.y, w: L.lines[i].w, h: L.lines[i].h };
    last = fly(`.l4-${i}`, box, to, t1 + 0.45 + i * 0.05, 0.6, Math.min(1.2, (Math.min(r.h, 34) / lh) * 0.95) / gs, { align: 'center' });
    if (!i) return;
    anim(`.s4 > table > tbody > tr:nth-child(${i})`, [[0, op(0)], ...tw(last - 0.08, 0.2, op(0), op(1))]);
    // The free seats light up just after their row lands.
    fields(rec).forEach(([a, b], c) => {
      if (a !== b || c === 3) return;
      const sel = `.s4 > table > tbody > tr:nth-child(${i}) > td:nth-child(${c + 1})`;
      const t = last + 0.1 + c * 0.03;
      anim(sel, [[0, op(0)], ...tw(t, 0.12, op(0), op(1))]);
      anim(sel, [[0, sc(0.3)], ...tw(t, 0.22, sc(0.3), sc(1.15), EASE.out), ...tw(t + 0.22, 0.2, sc(1.15), sc(1), EASE.inOut)]);
    });
  });
  anim('.w4', [[0, op(1)], ...tw(last, 0.35, op(1), op(0))]);

  // Your seat: a taken seat like the others until the beat, then blue, with
  // the file's own ping (1.8s, the ring grows and fades by 70%).
  const row17 = f.records.slice(1).findIndex((r) => fields(r).some(([a, b]) => r.slice(a, b) === '17')) + 1;
  const seat17 = p.at(f.cells[row17 - 1][4]);
  const grey = { 'background-color': '#cbd5e1', color: '#475569', 'box-shadow': 'inset 0 4px 0 #94a3b8, 0 0 0 0px rgb(165 216 255 / 0)' };
  const blue = (ring, alpha) => ({ 'background-color': '#1c7ed6', color: '#fff', 'box-shadow': `inset 0 4px 0 #1864ab, 0 0 0 ${ring}px rgb(165 216 255 / ${alpha})` });
  const beat = AT.seats + 3.1;
  const stops = [[0, grey], ...tw(beat, 0.25, grey, blue(3, 1), EASE.out)];
  for (let t = beat + 0.25; t + 1.8 < RESET - 0.1; t += 1.8) stops.push(...tw(t, 1.26, blue(3, 1), blue(9, 0), 'ease-out'), [t + 1.261, blue(3, 1)]);
  stops.push([RESET - 0.1, blue(3, 1)]);
  anim(`.s4 > table > tbody > tr:nth-child(${row17}) > td:nth-child(5)`, stops);
  move(beat - 0.2, AT.turn - beat + 0.1, { x: W * st + seat17.x + seat17.w / 2, y: seat17.y + seat17.h / 2, s: 1.6 });
}

// --- 6 and 7: the turn, and the proof ------------------------------------------------------
// The departures file's source, in a window at station 0. Its CSV lines end
// where the opening window's lines are, so the proof ends on the first frame.
const SRC = measured.source;
const fence2 = SRC.findIndex((runs, i) => i > 0 && runs.map((r) => r.text).join('') === '---');
const srcWin = layout(SRC.map((runs) => runs.map((r) => r.text).join('')), { size: 40, lh: 60, padX: 48, padY: 34, cx: W / 2 - 230 });
{
  const st = 0;
  const L = srcWin;
  const titles = '<span class="t5a">departures.cssv</span><span class="t5b">departures.csv</span>';
  let inner = windowBox({ ...L, name: '', cls: 'w5', extra: titles });
  // The style block's tint, then each line (and its selection).
  const cssTop = L.lines[0].y, cssBottom = L.lines[fence2].y + L.lines[fence2].h;
  inner += `<div class="tint5" style="left:${px(L.x)};top:${px(cssTop - 6)};width:${px(L.w)};height:${px(cssBottom - cssTop + 12)}"></div>`;
  SRC.forEach((runs, i) => {
    const box = L.lines[i];
    const text = runs.map((r) => r.text).join('');
    const css = i <= fence2;
    if (css) inner += `<div class="sel5 v5-${i}" style="left:${px(box.x - 4)};top:${px(box.y + 4)};width:${px([...text].length * ADV * 40 + 8)};height:${px(box.h - 8)}"></div>`;
    const body = css ? runs.map((r) => (r.cls ? `<span class="${r.cls}">${esc(r.text)}</span>` : esc(r.text))).join('') : esc(text);
    inner += lineHtml(`l5-${i}${css ? ' c5' : ''}`, box, 40, 60, body);
  });
  // Labels beside the two parts.
  const lx = L.x + L.w + 60;
  const label = (cls, y0, y1, text) => `<div class="brk ${cls}b" style="left:${px(L.x + L.w + 28)};top:${px(y0)};height:${px(y1 - y0)}"></div>`
    + `<div class="lbl ${cls}" style="left:${px(lx)};top:${px((y0 + y1) / 2 - 80)}">${text}</div>`;
  const csvTop = L.lines[fence2 + 1].y, csvBottom = L.lines.at(-1).y + L.lines.at(-1).h;
  inner += label('lb1', cssTop, cssBottom, 'the look<small>CSS</small>') + label('lb2', csvTop, csvBottom, 'the data<small>CSV</small>');
  html.st[st] += `<div class="wg5">${inner}</div>`;

  const flipIn = AT.flip + 0.22;
  anim('.wg5', [[0, sc(0, 1)], [flipIn, sc(0, 1)], ...tw(flipIn, 0.3, sc(0, 1), sc(1, 1), EASE.out), [AT.del + 0.9, sc(1, 1)], [AT.del + 0.901, sc(0, 1)]]);
  anim('.wg5', [[0, op(0)], [flipIn, op(0)], [flipIn + 0.001, op(1)], [AT.del + 0.9, op(1)], [AT.del + 0.901, op(0)]]);
  for (const [cls, t] of [['.lb1', flipIn + 0.35], ['.lb2', flipIn + 0.55]]) {
    anim(cls, [[0, { ...op(0), ...tf(-30, 0) }], ...tw(t, 0.4, { ...op(0), ...tf(-30, 0) }, { ...op(1), ...tf(0, 0) }, EASE.out), ...tw(AT.del, 0.15, { ...op(1), ...tf(0, 0) }, { ...op(0), ...tf(0, 0) })]);
    anim(`${cls}b`, [[0, sc(1, 0)], ...tw(t - 0.05, 0.35, sc(1, 0), sc(1, 1), EASE.out), ...tw(AT.del, 0.15, sc(1, 1), sc(1, 0))]);
  }
  // Select the style block, then delete it.
  for (let i = 0; i <= fence2; i++) {
    anim(`.v5-${i}`, [[0, sc(0, 1)], ...tw(AT.proof + 0.4 + i * 0.022, 0.12, sc(0, 1), sc(1, 1)), [AT.del, sc(1, 1)], [AT.del + 0.001, sc(0, 1)]]);
    anim(`.l5-${i}`, [[0, op(1)], ...tw(AT.del, 0.1, op(1), op(0))]);
  }
  anim('.tint5', [[0, op(1)], ...tw(AT.del, 0.12, op(1), op(0))]);
  for (let i = fence2 + 1; i < SRC.length; i++) {
    const from = L.lines[i], to = coldWin.lines[i - fence2 - 1];
    anim(`.l5-${i}`, [[0, tf(0, 0)], ...tw(AT.del + 0.05, 0.55, tf(0, 0), tf(to.x - from.x, to.y - from.y), EASE.inOut)]);
  }
  const box = (b) => ({ left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
  anim('.w5', [[0, box(L)], ...tw(AT.del + 0.05, 0.55, box(L), box(coldWin), EASE.inOut)]);
  anim('.t5a', [[0, op(1)], ...tw(AT.del + 0.1, 0.2, op(1), op(0))]);
  anim('.t5b', [[0, op(0)], ...tw(AT.del + 0.1, 0.2, op(0), op(1))]);
  // At the swap the opening window takes over: same place, same pixels.
  coldWin.lines.forEach((_, i) => {
    const list = anims.get(`.l0-${i}`);
    list[0].stops.push([AT.del + 0.899, list[0].stops.at(-1)[1]], [AT.del + 0.9, tf(0, 0)]);
    list[1].stops.push([AT.del + 0.899, op(0)], [AT.del + 0.9, op(1)]);
    list[2].stops.push([AT.del + 0.899, { color: '#f6f1e1' }], [AT.del + 0.9, { color: LINE }]);
  });
  const w0 = anims.get('.w0')[0];
  w0.stops.push([AT.del + 0.899, { ...op(0), ...sc(0.96) }], [AT.del + 0.9, { ...op(1), ...sc(1) }]);
}

// --- The camera's path -------------------------------------------------------------------
// Moves inside a scene were added above; these are the pans between them.
for (const [t, k] of [[AT.pan1, 1], [AT.pan2, 2], [AT.pan3, 3], [AT.pan4, 4]]) move(t, PAN, home(k), { dip: 0.14 });
// For the overview the stations close ranks, an even gap apart, while the
// camera pulls back to show all five.
const GAP = 120;
const total = final.reduce((sum, r) => sum + r.w, 0) + GAP * (final.length - 1);
let packed = W * 2 + W / 2 - total / 2;
const shifts = final.map((r, k) => {
  const shift = packed - (W * k + r.x);
  packed += r.w + GAP;
  return shift;
});
move(AT.turn, 1.5, { x: W * 2 + W / 2, y: CY, s: 1780 / total });
// Then into the board, framed for the file it turns over to, while the rest fade.
const srcPose = { x: srcWin.x + (srcWin.w + 560) / 2, y: CY, s: Math.min(830 / srcWin.h, 1800 / (srcWin.w + 560)) };
move(AT.push, AT.flip + 0.2 - AT.push, srcPose);
move(AT.del + 0.05, 0.8, home(0));
shifts.forEach((x, k) => {
  anim(`.st${k}`, [[0, tf(0, 0)], ...tw(AT.turn, 1.5, tf(0, 0), tf(x, 0), EASE.inOut), ...tw(AT.push, AT.flip - AT.push, tf(x, 0), tf(0, 0), EASE.inOut)]);
  if (k) anim(`.st${k}`, [[0, op(1)], ...tw(AT.push + 0.3, 0.5, op(1), op(0))]);
});
cameraAnims();

// The background: cold grey for the plain file, warm paper and dots for the rest.
{
  const warm = { 'background-color': PAPER }, cold = { 'background-color': COLD };
  anim('.bg', [[0, cold], ...tw(AT.dep + 0.1, 0.6, cold, warm), ...tw(AT.del + 0.1, 0.5, warm, cold), ...tw(AT.pitch, 0.4, cold, warm), ...tw(AT.loop + 0.25, 0.34, warm, cold)], { reset: false });
  anim('.dotsfade', [[0, op(0)], ...tw(AT.dep + 0.1, 0.6, op(0), op(1)), ...tw(AT.del + 0.1, 0.5, op(1), op(0)), ...tw(AT.pitch, 0.4, op(0), op(1)), ...tw(AT.loop + 0.25, 0.34, op(1), op(0))], { reset: false });
  anim('.scrim', [[0, cold], ...tw(AT.dep + 0.1, 0.6, cold, warm), ...tw(AT.del + 0.1, 0.5, warm, cold), ...tw(AT.pitch, 0.4, cold, warm), ...tw(AT.loop + 0.25, 0.34, warm, cold)], { reset: false });
  anim('.wf', [[0, op(1)], ...tw(AT.pitch, 0.4, op(1), op(0)), ...tw(AT.loop + 0.25, 0.34, op(0), op(1))], { reset: false });
}

// --- Captions -------------------------------------------------------------------------------
// "This is a CSV." gains "also" at the first reveal, and its highlighter
// stroke is drawn again at each one after it.
const enter = (t) => tw(t, 0.45, { ...op(0), ...tf(0, 34) }, { ...op(1), ...tf(0, 0) }, EASE.out);
const leave = (t) => tw(t, 0.3, { ...op(1), ...tf(0, 0) }, { ...op(0), ...tf(0, -34) }, EASE.in);
const reveals = [AT.dep + 0.95, AT.resume + 1.5, AT.el + 1.4, AT.chat + 1.4, AT.seats + 2.1];
{
  anim('.c0', [[0, { ...op(1), ...tf(0, 0) }], ...leave(AT.turn + 0.7), [AT.loop + 0.25, { ...op(0), ...tf(0, 34) }], ...tw(AT.loop + 0.25, 0.34, { ...op(0), ...tf(0, 34) }, { ...op(1), ...tf(0, 0) }, EASE.out)], { reset: false });
  anim('.also', [[0, { width: '0px' }], ...tw(AT.dep + 0.7, 0.45, { width: '0px' }, { width: px(measured.also) }, EASE.out), [AT.turn + 1.1, { width: px(measured.also) }], [AT.turn + 1.101, { width: '0px' }]], { reset: false });
  anim('.also > b', [[0, { ...op(0), ...tf(0, -40) }], ...tw(AT.dep + 0.75, 0.4, { ...op(0), ...tf(0, -40) }, { ...op(1), ...tf(0, 0) }, EASE.back), [AT.turn + 1.1, { ...op(1), ...tf(0, 0) }], [AT.turn + 1.101, { ...op(0), ...tf(0, -40) }]], { reset: false });
  const stops = [[0, hiddenL]];
  reveals.forEach((t, i) => {
    if (i) stops.push(...tw(t - 0.22, 0.18, shown, hiddenR, EASE.in), [t - 0.039, hiddenL]);
    stops.push(...tw(t, 0.34, hiddenL, shown, EASE.out));
  });
  stops.push([AT.turn + 1.1, shown], [AT.turn + 1.101, hiddenL]);
  anim('.mk0', stops, { reset: false });
  anim('.c1', [[0, { ...op(0), ...tf(0, 34) }], ...enter(AT.turn + 0.9), ...leave(AT.proof), [AT.loop, { ...op(0), ...tf(0, 34) }]], { reset: false });
  anim('.mk1', swipe(AT.turn + 1.35, 0.32, AT.loop), { reset: false });
  anim('.c2', [[0, { ...op(0), ...tf(0, 34) }], ...enter(AT.proof + 0.2), ...leave(AT.pitch), [AT.loop, { ...op(0), ...tf(0, 34) }]], { reset: false });
  anim('.mk2', swipe(AT.proof + 0.6, 0.32, AT.loop), { reset: false });
}
const captions = `<div class="cap c0"><span>This is </span><span class="also"><b class="hl">also<i class="mk mk0"></i></b> </span><span>a CSV.</span></div>`
  + `<div class="cap c1"><span>Every one is a CSV with ${mark('CSS on top', 'mk1')}.</span></div>`
  + `<div class="cap c2"><span>Delete the CSS, and it’s a ${mark('plain CSV', 'mk2')} again.</span></div>`;

// --- The pitch --------------------------------------------------------------------------------
const PITCH = [
  [['The '], ['CSV', true], [' you'], [' already'], [' have.']],
  [['The '], ['CSS', true], [' you'], [' already'], [' know.']],
  [['One '], ['plain-text file', true], ['.']],
];
let pitch = '';
PITCH.forEach((words, row) => {
  const t0 = AT.pitch + 0.45 + row * 0.6;
  pitch += `<div class="row" style="top:${270 + row * 150}px">`;
  words.forEach(([text, marked], w) => {
    const cls = `p${row}-${w}`;
    pitch += `<span class="wd ${cls}">${marked ? mark(esc(text), `pm${row}`) : esc(text)}</span>`;
    const t = t0 + w * 0.06;
    anim(`.${cls}`, [[0, { ...op(0), ...tf(0, 60) }], ...tw(t, 0.5, { ...op(0), ...tf(0, 60) }, { ...op(1), ...tf(0, 0) }, EASE.out),
      ...tw(AT.end - 0.45 + row * 0.05, 0.3, { ...op(1), ...tf(0, 0) }, { ...op(0), ...tf(0, -40) }, EASE.in), [AT.loop, { ...op(0), ...tf(0, 60) }]], { reset: false });
  });
  anim(`.pm${row}`, swipe(t0 + 0.4, 0.4, AT.end), { reset: false });
  pitch += '</div>';
});

// --- The end card -------------------------------------------------------------------------------
// The favicon: CSS braces close around a CSV comma.
const ICON = readFileSync(new URL('site/favicon.svg', ROOT), 'utf8');
const [braceL, braceR] = [...ICON.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);
const comma = /<path fill="#ffe45c" transform="([^"]+)" d="([^"]+)"/.exec(ICON);
const end = `<div class="end">`
  + `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="190" height="190">`
  + `<rect class="i-sq" width="32" height="32" rx="8" fill="${INK}"/>`
  + `<g class="i-b" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path class="i-l" d="${braceL}"/><path class="i-r" d="${braceR}"/></g>`
  + `<g class="i-c"><path fill="${MARK}" transform="${comma[1]}" d="${comma[2]}"/></g></svg>`
  + '<div class="e1">CSSV</div>'
  + '<div class="e2">Comma-Separated Styled Values</div>'
  + '<div class="e3"><code>&lt;cssv-table src="departures.cssv"&gt;</code></div>'
  + '<div class="e4">One script tag. No build step.</div>'
  + `<div class="e5">${mark('cssv.dev', 'mk5')}<span> · npm i @rhpaiva/cssv</span></div>`
  + '<div class="e6">Every table here was rendered by the real &lt;cssv-table&gt;.</div>'
  + '</div>';
{
  const t = AT.end;
  const hold = (a, b, list) => [[0, a], ...list, [AT.loop + 0.5, b], [AT.loop + 0.501, a]];
  anim('.end', [[0, op(0)], [t, op(0)], [t + 0.001, op(1)], ...tw(AT.loop, 0.35, op(1), op(0))], { reset: false });
  anim('.i-sq', hold(sc(0.4), sc(1), tw(t, 0.45, sc(0.4), sc(1), EASE.back)), { reset: false });
  anim('.i-sq', hold(op(0), op(1), tw(t, 0.2, op(0), op(1))), { reset: false });
  anim('.i-c', hold(tf(0, -26), tf(0, 0), tw(t + 0.25, 0.45, tf(0, -26), tf(0, 0), 'cubic-bezier(.3,1.7,.6,1)')), { reset: false });
  anim('.i-c', hold(op(0), op(1), tw(t + 0.25, 0.15, op(0), op(1))), { reset: false });
  anim('.i-l', hold(tf(-9, 0), tf(0, 0), tw(t + 0.45, 0.4, tf(-9, 0), tf(0, 0), EASE.back)), { reset: false });
  anim('.i-r', hold(tf(9, 0), tf(0, 0), tw(t + 0.45, 0.4, tf(9, 0), tf(0, 0), EASE.back)), { reset: false });
  anim('.i-b', hold(op(0), op(1), tw(t + 0.45, 0.2, op(0), op(1))), { reset: false });
  ['.e1', '.e2', '.e3', '.e4', '.e5', '.e6'].forEach((sel, i) => {
    const t0 = t + 0.7 + i * 0.16;
    anim(sel, hold({ ...op(0), ...tf(0, 40) }, { ...op(1), ...tf(0, 0) }, tw(t0, 0.5, { ...op(0), ...tf(0, 40) }, { ...op(1), ...tf(0, 0) }, EASE.out)), { reset: false });
  });
  anim('.mk5', swipe(t + 1.9, 0.4, AT.loop + 0.5), { reset: false });
}

// --- Stylesheets ----------------------------------------------------------------------------------
const hoisted = new Map(); // @keyframes name -> rule
const RESERVED = /^(k\d+|caret-blink)$/;
const tableCss = scopeCss(DEFAULT_CSS, '.tb', ROOT, hoisted, RESERVED)
  + FILES.map((f, k) => scopeCss(f.text.split('\n---\n')[0].replace(/^---\n/, ''), `.s${k}`, new URL(f.src, ROOT), hoisted, RESERVED)).join('');
const CSS = `${FONTS}
.frame{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:${SANS};color:${INK}}
.bg{position:absolute;inset:0;background:${COLD}}
.dotsfade{position:absolute;inset:0;opacity:0}
.dots{position:absolute;left:-5000px;top:-4000px;width:16000px;height:12000px;transform-origin:5000px 4000px;background:radial-gradient(circle at 12px 12px,${DOTS} 1.7px,transparent 2.5px) 0 0/24px 24px}
.wf,.world,.st{position:absolute;left:0;top:0}
/* The captions' band covers what passes behind it, with the same paper and dots. */
.scrim{position:absolute;left:0;right:0;top:876px;bottom:0;overflow:hidden;background:${COLD};mask-image:linear-gradient(transparent,#000 56px)}
.scrim .dots{top:-4876px;transform-origin:5000px 4876px}
.world{transform-origin:0 0}
.st{width:${W}px;height:${H}px}
.tp,.ta,.win,.ln,.wg,.phone,.vp,.clip2,.caretw,.tint5,.sel5,.brk,.lbl{position:absolute}
.tp{transform-origin:0 0}
.tbox{container-type:inline-size}
.tb{display:block;contain:paint;width:max-content;min-width:100%}
.tb>table{color-scheme:light!important}
.win{box-sizing:border-box;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgb(0 0 0/.06),0 28px 60px -30px rgb(0 0 0/.4);transform-origin:50% 50%}
.bar{position:relative;height:${BAR}px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #ececec;background:#fafafa;font:500 22px/1 ${SANS};color:#8d8d8d}
.bar i{position:absolute;top:21px;width:14px;height:14px;border-radius:50%;background:#dadada}
.bar i:nth-child(1){left:22px}.bar i:nth-child(2){left:44px}.bar i:nth-child(3){left:66px}
.bar .t5b{position:absolute}
.ln,.cl{white-space:pre;font-family:${MONO};color:${LINE};overflow:hidden;transform-origin:0 50%}
.wg{top:0;transform-origin:0 0}
.wg5{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:${px(srcWin.x + srcWin.w / 2)} ${px(CY)}}
.clip2{overflow:hidden;mask-image:linear-gradient(transparent 0,#000 44px)}
.hl{position:relative;z-index:0;font-weight:inherit}
.mk{position:absolute;z-index:-1;left:-0.06em;right:-0.06em;top:0.52em;bottom:0.02em;background:${MARK};clip-path:inset(0 100% 0 0)}
.ln .mk{top:0.12em;bottom:0.08em;left:-0.12em;right:-0.12em;background:${MARK}}
.gap{position:relative;display:inline-block;width:0;height:1em;vertical-align:-0.15em}
.gap .mk{left:-0.3em;right:auto;width:0.6em;top:0;bottom:0;border-radius:0.2em;clip-path:none;opacity:0}
.caretw{width:3px;height:44px}
.caret{display:block;width:100%;height:100%;background:${INK};animation:caret-blink 1.06s steps(1) infinite var(--play,running)}
@keyframes caret-blink{50%{opacity:0}}
.phone{box-sizing:border-box;border-radius:58px;background:${INK};box-shadow:0 2px 3px rgb(0 0 0/.12),0 40px 70px -34px rgb(0 0 0/.55)}
.vp{overflow:hidden;border-radius:44px;background:#efeae2}
.tint5{background:${SOFT};border-radius:8px}
.sel5{background:#b8d6fb;transform-origin:0 50%;transform:scale(0,1)}
.brk{width:8px;border-radius:4px;transform-origin:50% 50%}
.lb1b{background:${MARK}}.lb2b{background:${INK}}
.lbl{font:800 112px/1 ${SANS};letter-spacing:-0.03em;white-space:nowrap}
.lbl small{display:block;margin-top:18px;font:500 52px/1 ${MONO};letter-spacing:0;color:${MUTED}}
.t-fence{color:#a16207;font-weight:700}.t-comment{color:#8a8478;font-style:italic}.t-at{color:#7c3aed}.t-atp,.t-sel,.t-var,.t-val{color:${INK}}
.t-hook{color:#c2410c;font-weight:700}.t-prop{color:#0369a1}.t-cssv{color:#a16207;font-weight:700}.t-str{color:#15803d}.t-punct{color:#8a8478}
.cap{position:absolute;left:0;right:0;top:902px;height:120px;display:flex;align-items:center;justify-content:center;font:800 68px/1.2 ${SANS};letter-spacing:-0.025em;white-space:pre}
.cap>span{display:block}
.also{overflow:hidden}
.also>b{display:inline-block}
.pitch{position:absolute;inset:0;pointer-events:none}
.pitch .row{position:absolute;left:0;right:0;display:flex;justify-content:center;font:800 108px/1.2 ${SANS};letter-spacing:-0.035em;white-space:pre}
.wd{display:block}
.end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:150px;opacity:0}
.icon{overflow:visible;margin-bottom:34px}
.i-sq,.i-b,.i-c,.i-l,.i-r{transform-box:fill-box;transform-origin:50% 50%}
.e1{font:800 150px/1 ${SANS};letter-spacing:-0.04em}
.e2{margin-top:18px;font:500 44px/1.2 ${SANS};color:${MUTED}}
.e3{margin-top:44px;padding:16px 30px;border-radius:14px;background:#fffdf9;box-shadow:0 1px 2px rgb(40 30 10/.06),0 16px 40px -22px rgb(40 30 10/.35);font:500 34px/1.2 ${MONO}}
.e4{margin-top:30px;font:500 38px/1.2 ${SANS}}
.e5{margin-top:56px;font:800 46px/1.2 ${SANS};letter-spacing:-0.02em}
.e5 span{font-weight:500;color:${MUTED}}
.e6{position:absolute;bottom:56px;font:500 26px/1.2 ${SANS};color:${MUTED}}
@media (prefers-reduced-motion:reduce){:root{--delay:-${STILL}s;--play:paused}}
${tableCss}
${[...hoisted.values()].join('\n')}
${animationCss()}
${[...keyframes].map(([body, name]) => `@keyframes ${name}{${body}}`).join('\n')}
`;

// --- The SVG --------------------------------------------------------------------------------------
const stations = html.st.map((over, k) => `<div class="st st${k}" style="left:${px(W * k)}">${html.under[k]}${over}</div>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
<title id="title">This is also a CSV</title>
<desc id="desc">A plain CSV file of flights, captioned "This is a CSV." Its lines fly into a split-flap departures board: "This is also a CSV." So are a resume, the periodic table, whose 118 lines land on their tiles in order, a WhatsApp group chat and an airplane seat map. Every one is a CSV with CSS on top: the departures board turns over to show its file, a style block above the CSV. Deleting the CSS gives the plain CSV back. The CSV you already have, the CSS you already know, one plain-text file. CSSV, Comma-Separated Styled Values: one script tag, no build step, cssv.dev.</desc>
<style>
${esc(CSS)}
</style>
<foreignObject width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" class="frame" lang="en-US">`
  + '<div class="bg"></div><div class="dotsfade"><div class="dots"></div></div>'
  + `<div class="wf"><div class="world">${stations}</div></div><div class="scrim"><div class="dotsfade"><div class="dots"></div></div></div>`
  + captions + `<div class="pitch">${pitch}</div>` + end
  + `</div></foreignObject>
</svg>
`;
await writeFile(OUT, svg);
console.log(`site/intro.svg: ${(svg.length / 1024).toFixed(0)} KB, ${T}s loop, ${keyframes.size} animations`);
await browser.close();

// --- Stills and the video -------------------------------------------------------------------------
// The SVG is opened as a document; every animation is paused and set to the
// frame's time. The page is the SVG itself, so the video shows what it shows.
async function open() {
  browser = await launchChromium();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  await p.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await p.goto(OUT.href);
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => { window.animations = document.getAnimations(); for (const a of animations) a.pause(); });
  const seek = (t) => p.evaluate((ms) => { for (const a of animations) a.currentTime = ms; }, t * 1000);
  // CDP's capture is about twice as fast as page.screenshot, and still lossless.
  const cdp = await p.context().newCDPSession(p);
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64');
  return { seek, shot };
}
if (STILLS) {
  mkdirSync(STILLS, { recursive: true });
  const { seek, shot } = await open();
  for (const t of AT_TIMES) {
    await seek(t);
    await writeFile(join(STILLS, `intro-${t.toFixed(2)}.png`), await shot());
  }
  await browser.close();
}
if (MP4) {
  const { seek, shot } = await open();
  const rate = FPS * BLUR;
  const vf = BLUR > 1 ? ['-vf', `tmix=frames=${BLUR},fps=${FPS}`] : [];
  const ffmpeg = spawn(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(rate), '-i', '-',
    ...vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', MP4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code ? reject(new Error(`ffmpeg exited with ${code}`)) : resolve())));
  const frames = Math.round(T * rate);
  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    await seek(i / rate);
    const png = await shot();
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (i % (rate * 5) === 0) process.stdout.write(`\r${MP4}: ${(i / rate).toFixed(0)}s of ${T}s`);
  }
  ffmpeg.stdin.end();
  await done;
  await browser.close();
  console.log(`\r${MP4}: ${T}s at ${FPS} fps in ${((Date.now() - started) / 60000).toFixed(1)} min`);
}
await server.close();
