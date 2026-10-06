// Writes the data section of examples/skyline.cssv: every building on
// Wikipedia's "List of tallest buildings" that reaches 400 m, tallest first,
// with its city, country, height in metres, floors and the year it was
// completed. The style block stays as it is, apart from its source line,
// which gets the revision and the date.
//
// Run with: node tools/skyline-data.js
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../examples/skyline.cssv', import.meta.url);
const API = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_tallest_buildings&prop=text|revid&format=json&formatversion=2';

const res = await fetch(API, { headers: { 'user-agent': 'cssv examples (tools/skyline-data.js)' } });
if (!res.ok) throw new Error(`Could not load the list (HTTP ${res.status}).`);
const { parse } = await res.json();

const text = (html) => html
  .replace(/<sup[\s\S]*?<\/sup>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&#160;|&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/†/g, '')
  .trim();

// The list is the first table whose header starts Rank, Building, City.
const table = parse.text.match(/<table class="wikitable[^"]*"[\s\S]*?<\/table>/g)
  .find((t) => /^Rank\s+Building\s+City\s+Country\s+Height/.test(text(t.slice(0, 2000)).replace(/\s+/g, ' ')));
if (!table) throw new Error('The list of tallest buildings has moved.');

const quote = (field) => (/[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);
const records = [];
for (const row of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
  const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => text(m[1]));
  const [, building, city, country, height, , floors, built] = cells;
  const metres = Number(height.replace(/[^\d.]/g, ''));
  if (!building || !(metres >= 400)) continue;
  records.push([building, city, country, metres, Number(floors), Number(built)]);
}
if (records.length < 30) throw new Error(`Only ${records.length} buildings found.`);
records.sort((a, b) => b[3] - a[3]);
// The style block's fallback for engines without typed attr() knows heights
// from 400 to 829 m.
if (records[0][3] >= 830) console.warn(`${records[0][0]} is ${records[0][3]} m: add its height to the fallback in the style block.`);

const source = readFileSync(FILE, 'utf8');
const fence = source.indexOf('\n---\n') + 5;
const date = new Date().toISOString().slice(0, 10);
const style = source.slice(0, fence).replace(/revision \d+, retrieved \d{4}-\d\d-\d\d/, `revision ${parse.revid}, retrieved ${date}`);
const data = ['building,city,country,height (m),floors,built', ...records.map((r) => r.map((f) => quote(String(f))).join(','))];
writeFileSync(FILE, style + data.join('\n') + '\n');
console.log(`examples/skyline.cssv: ${records.length} buildings from revision ${parse.revid}`);
