// Writes the data section of examples/bitcoin.cssv from CoinGecko's Bitcoin
// price export, the CSV its chart's export button gives: one record a day,
// the price at midnight UTC in US dollars. It keeps the records the chart
// shows, copied as they are: the newest day's week and the 52 before it,
// from a Monday. A day without a price yet (today) is left out. The style
// block stays as it is, apart from the price axis, which fits the year.
//
// Run with: node tools/bitcoin-data.js
import { readFileSync, writeFileSync } from 'node:fs';

const EXPORT = 'https://www.coingecko.com/price_charts/export/1/usd.csv';
const HEADER = 'event_date,close_price_usd,market_cap_usd,volume_usd';
const FILE = new URL('../examples/bitcoin.cssv', import.meta.url);
const DAY = 864e5;

const res = await fetch(EXPORT, { headers: { 'user-agent': 'Mozilla/5.0 (cssv examples, tools/bitcoin-data.js)' } });
if (!res.ok) throw new Error(`Could not load the export (HTTP ${res.status}).`);
const [header, ...records] = (await res.text()).trim().split(/\r?\n/);
if (header !== HEADER) throw new Error(`The export's columns have changed: ${header}`);

const priced = records.filter((line) => /^\d{4}-\d\d-\d\d [^,]*,\d/.test(line));
const newest = Date.parse(`${priced.at(-1).slice(0, 10)}T00:00:00Z`);
const monday = newest - ((new Date(newest).getUTCDay() + 6) % 7) * DAY - 52 * 7 * DAY;
const from = new Date(monday).toISOString().slice(0, 10);
const days = priced.slice(priced.findIndex((line) => line.startsWith(from)));
if (!days[0]?.startsWith(from)) throw new Error(`The export has no price for ${from}.`);
// The chart counts weeks in records, so every day must be there.
days.forEach((line, i) => {
  const date = new Date(monday + i * DAY).toISOString().slice(0, 10);
  if (!line.startsWith(date)) throw new Error(`The export skips from ${days[i - 1].slice(0, 10)} to ${line.slice(0, 10)}.`);
});

// The price axis: grid lines a round number of thousands apart, no more than
// nine, and room above the highest price for the chart's legend.
const prices = days.map((line) => Number(line.split(',')[1]));
const min = Math.min(...prices);
const max = Math.max(...prices);
const span = max - min;
const step = [1000, 2000, 5000, 10000, 20000, 50000, 100000].find((s) =>
  (Math.ceil((max + span * 0.15) / s) - Math.floor((min - span * 0.05) / s)) <= 10);
const lo = Math.max(0, Math.floor((min - span * 0.05) / step) * step);
const hi = Math.ceil((max + span * 0.15) / step) * step;

const file = readFileSync(FILE, 'utf8');
const style = file.slice(0, file.indexOf('\n---\n') + 5)
  .replace(/--lo: \d+;/, `--lo: ${lo};`)
  .replace(/--hi: \d+;/, `--hi: ${hi};`)
  .replace(/--step: \d+;/, `--step: ${step};`);
writeFileSync(FILE, style + [header, ...days].join('\n') + '\n');

console.log(`${days.length} days, ${from} to ${days.at(-1).slice(0, 10)}; price axis ${lo} to ${hi}, a line every ${step}.`);
