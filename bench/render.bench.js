// Measures the processor (Node) and the <cssv-table> renderer (headless
// Chromium) on generated tables. Run with: npm run bench [-- 100 500 5000]
import { parse, toHtml } from '../src/core.js';
import { chromium } from 'playwright';
import { startServer } from '../test/browser/harness.js';

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
if (!SIZES.length) SIZES.push(100, 500, 5000);

// Deterministic data shaped like the spec's budget example: 6 columns,
// 3 of them numeric, a Total row at the end.
function data(records) {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const owners = ['Ana', 'Ben', 'Caro', 'Dev', 'Eli'];
  const statuses = ['paid', 'over', 'pending'];
  const lines = ['category,owner,planned,actual,diff,status'];
  for (let i = 1; i < records; i++) {
    const planned = Math.round(rand() * 5000);
    const actual = (planned * (0.8 + rand() * 0.4)).toFixed(2);
    lines.push(`Item ${i},${owners[i % 5]},${planned},${actual},${(actual - planned).toFixed(2)},${statuses[i % 3]}`);
  }
  lines.push('Total,,0,0,0,');
  return lines.join('\n') + '\n';
}

const STYLE = `thead th { background: #1f2937; color: #fff; }
[data-col="diff"].negative { color: #15803d; }
[data-col="diff"].positive { color: #b91c1c; }
tbody tr:nth-child(even) { background: #f4f4f5; }
td:empty::after { content: "—"; }`;

const SCENARIOS = {
  'plain CSV': '',
  'style block': `---\n${STYLE}\n---\n`,
  '+ --cssv-key': `---\n${STYLE}\ntable { --cssv-key: category; }\ntr[data-key="Total"] { font-weight: bold; }\n---\n`,
  '+ --cssv-format': `---\n${STYLE}\ntable { --cssv-key: category; --cssv-format: "minimumFractionDigits: 2, maximumFractionDigits: 2"; }\ntr[data-key="Total"] { font-weight: bold; }\n---\n`,
};

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p90: at(0.9) };
};
const ms = (x) => (x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : x.toFixed(0)).padStart(7);
const runsFor = (n) => (n <= 500 ? 25 : 7);

// --- Node: the processor alone ---------------------------------------------
console.log(`Node ${process.version}: core.js (median of runs)\n`);
console.log('records   parse()   toHtml()');
for (const n of SIZES) {
  const text = SCENARIOS['+ --cssv-format'] + data(n);
  const model = parse(text);
  const time = (fn) => {
    for (let i = 0; i < 5; i++) fn();
    const xs = [];
    for (let i = 0; i < runsFor(n) * 4; i++) { const t = performance.now(); fn(); xs.push(performance.now() - t); }
    return stats(xs).median;
  };
  console.log(`${String(n).padStart(7)}  ${ms(time(() => parse(text)))}ms ${ms(time(() => toHtml(model)))}ms`);
}

// --- Chromium: the renderer --------------------------------------------------
const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(server.page('<main id="host"></main>'));
await page.waitForFunction(() => customElements.get('cssv-table'));
console.log(`\nChromium ${browser.version()} (headless): <cssv-table> with inline text`);
console.log('ready = until el.ready resolves; painted = until the next frame after that (includes layout and paint)\n');

const results = [];
for (const n of SIZES) {
  for (const [name, style] of Object.entries(SCENARIOS)) {
    const r = await page.evaluate(async ({ text, runs }) => {
      const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
      const one = async () => {
        const el = document.createElement('cssv-table');
        const script = document.createElement('script');
        script.type = 'text/cssv';
        script.textContent = text;
        el.append(script);
        const t0 = performance.now();
        document.getElementById('host').append(el);
        await el.ready;
        const t1 = performance.now();
        await frame();
        const t2 = performance.now();
        const t3 = performance.now();
        el.toMarkdown();
        const t4 = performance.now();
        const ok = el.table?.tBodies[0].rows.length;
        el.remove();
        return { ready: t1 - t0, painted: t2 - t0, markdown: t4 - t3, ok };
      };
      for (let i = 0; i < 3; i++) await one(); // warm-up
      const out = [];
      for (let i = 0; i < runs; i++) out.push(await one());
      return out;
    }, { text: style + data(n), runs: runsFor(n) });
    if (r.some((x) => x.ok !== n)) throw new Error(`render failed for ${n} records, ${name}`);
    results.push({ n, name, ready: stats(r.map((x) => x.ready)), painted: stats(r.map((x) => x.painted)), markdown: stats(r.map((x) => x.markdown)) });
  }
}

// parse() alone in the browser, for comparison with the full render.
const parseTimes = {};
for (const n of SIZES) {
  parseTimes[n] = await page.evaluate(async ({ text, runs }) => {
    const { parse } = await import('/src/core.js');
    for (let i = 0; i < 5; i++) parse(text);
    const xs = [];
    for (let i = 0; i < runs; i++) { const t = performance.now(); parse(text); xs.push(performance.now() - t); }
    return xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  }, { text: SCENARIOS['+ --cssv-format'] + data(n), runs: runsFor(n) * 4 });
}

console.log('records  scenario           ready (median / p90)    painted (median / p90)   toMarkdown');
for (const r of results) {
  console.log(`${String(r.n).padStart(7)}  ${r.name.padEnd(17)} ${ms(r.ready.median)} / ${ms(r.ready.p90)} ms   ${ms(r.painted.median)} / ${ms(r.painted.p90)} ms  ${ms(r.markdown.median)} ms`);
}
console.log('\nparse() alone in Chromium: ' + SIZES.map((n) => `${n} records ${parseTimes[n].toFixed(2)} ms`).join(', '));

await browser.close();
await server.close();
