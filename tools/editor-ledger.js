// Writes site/editor/ledger.cssv, the file the editor opens with:
// ledger-theme.css as the style block, then 1,000 body rows of deterministic
// data. Run: node tools/editor-ledger.js
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../src/core.js';

const here = new URL('../site/editor/', import.meta.url);
const theme = readFileSync(new URL('ledger-theme.css', here), 'utf8').trimEnd();
if (theme.split('\n').some((line) => /^---[ \t]*$/.test(line))) throw new Error('The theme contains a fence line (3.4).');

let seed = 1683;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

const ADEPTS = ['Fr. Ambrosius Vell', 'Mag. Isolde Kettering', 'Dr. Cornelius Haast', 'Sr. Perpetua Lom',
  'Tobias Wrenfield', 'Dame Agnes Morrow', 'Lorenz Stahl', 'Fabrizio Neri', 'Héloïse Ducasse',
  'Yusuf al-Haddad', 'Keziah Blackwood', 'Ottoline Brae'];
const SUBSTANCES = ['Mercurius', 'Sulphur', 'Sal', 'Aurum', 'Argentum', 'Plumbum', 'Stannum', 'Ferrum',
  'Cuprum', 'Stibium', 'Arsenicum', 'Vitriolum'];
const WORTH = { Aurum: 9, Argentum: 4, Mercurius: 3, Stibium: 2.5, Cuprum: 1.5, Vitriolum: 1.2 }; // guineas per ounce
const OPERATIONS = ['Calcinatio', 'Solutio', 'Separatio', 'Coniunctio', 'Fermentatio', 'Distillatio', 'Coagulatio'];
const MONTHS = ['Ianuarius', 'Februarius', 'Martius', 'Aprilis', 'Maius', 'Iunius', 'Iulius', 'Augustus',
  'September', 'October', 'November', 'December'];
const NOTES = [
  'Vapours most noxious; windows opened.',
  'The Raven appeared at the third hour.',
  'Cauda pavonis observed, all colours at once.',
  'Vessel cracked, work recommenced.',
  'Witnessed by Sir R. and his clerk.',
  'He calls it "the green lion" and will say no more.',
  'Salt, sulphur, mercury: the tria prima, in that order.',
  'Fire too fierce. Lost the work.',
  'Night of the comet.',
  "Sealed with Hermes' seal until Lent.",
  'Residue kept in the blue jar.\nDo not open before Michaelmas.',
  'Sold to the apothecary at Cheapside.',
  'Dissolved in aqua regia; much fuming.',
  'Repeated thrice, thrice the same.',
];

// Amounts are kept in tenths (ounces) and hundredths (guineas), so the sums are exact.
const dec = (n, places) => {
  const s = Math.abs(n).toString().padStart(places + 1, '0');
  return (n < 0 ? '-' : '') + s.slice(0, -places) + '.' + s.slice(-places);
};
const field = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

const header = ['folio', 'anno', 'dies', 'adeptus', 'substantia', 'opus', 'unciae in', 'unciae ex', 'lucrum', 'sumptus', 'nota'];
const lines = [header.map(field).join(',')];
const ENTRIES = 979;
const YEARS = 20;
let folio = 0;
const grand = { in: 0, ex: 0, lucrum: 0, sumptus: 0 };

for (let y = 0; y < YEARS; y++) {
  const year = 1683 + y;
  const count = Math.floor(ENTRIES / YEARS) + (y < ENTRIES % YEARS ? 1 : 0);
  const sum = { in: 0, ex: 0, lucrum: 0, sumptus: 0 };
  const days = Array.from({ length: count }, () => Math.floor(rand() * 365)).sort((a, b) => a - b);
  for (const d of days) {
    const substance = pick(SUBSTANCES);
    const ouncesIn = 5 + Math.floor(rand() * 600); // tenths: 0.5 to 60.4
    const roll = rand();
    const ouncesOut = roll < 0.06 ? ouncesIn : Math.max(0, Math.round(ouncesIn * (0.15 + rand() * 1.3)));
    const worth = WORTH[substance] ?? 0.6;
    let lucrum = Math.round((ouncesOut - ouncesIn) * worth * 10); // hundredths
    if (roll < 0.06) lucrum = 0;
    const sumptus = 12 + Math.floor(rand() * 3800);
    const note = rand() < 0.36 ? pick(NOTES) : '';
    const date = new Date(Date.UTC(year, 0, 1 + d));
    lines.push([
      String(++folio), String(year), `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`, pick(ADEPTS), substance,
      pick(OPERATIONS), dec(ouncesIn, 1), dec(ouncesOut, 1), dec(lucrum, 2), String(sumptus), note,
    ].map(field).join(','));
    sum.in += ouncesIn; sum.ex += ouncesOut; sum.lucrum += lucrum; sum.sumptus += sumptus;
  }
  lines.push(['', String(year), '', '', 'Summa Anni', '', dec(sum.in, 1), dec(sum.ex, 1), dec(sum.lucrum, 2),
    String(sum.sumptus), `Probatum est, anno ${year}.`].map(field).join(','));
  for (const k in sum) grand[k] += sum[k];
}
lines.push(['', '', '', '', 'Summa Totalis', '', dec(grand.in, 1), dec(grand.ex, 1), dec(grand.lucrum, 2),
  String(grand.sumptus), 'Finis.'].map(field).join(','));

const text = `---\n${theme}\n---\n${lines.join('\n')}\n`;
const model = parse(text);
if (model.rows.length !== 1000) throw new Error(`Expected 1000 body rows, got ${model.rows.length}.`);
writeFileSync(new URL('ledger.cssv', here), text);
console.log(`site/editor/ledger.cssv: ${model.rows.length} rows, ${model.columns.length} columns, ${text.length} characters`);
