// Writes examples/season-results.csv, a season of the invented league in the
// gallery's examples/league.cssv: 18 matchdays, each club playing every other
// club home and away, with results that end exactly at the table in that
// file. Then it rewrites season.cssv's data section from the results, with
// the clubs in alphabetical order. The gallery's League table card plays the
// season from these two files.
//
// The results come from a seeded search: the outcomes are found first (wins,
// draws and losses per club), then the scores (goals for and against), then
// each side's xG. Of the seasons it finds, it keeps the one with the closest
// title race.
//
// Run with: node tools/season.js
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../src/core.js';
import { dataSection, readResults, standings } from '../examples/season.js';

const EXAMPLES = new URL('../examples/', import.meta.url);
const LEAGUE = new URL('league.cssv', EXAMPLES);
const SEASON = new URL('season.cssv', EXAMPLES);
const RESULTS = new URL('season-results.csv', EXAMPLES);

// --- The target: the table in league.cssv ------------------------------------------
const model = parse(readFileSync(LEAGUE, 'utf8'));
const col = (name) => model.columns.indexOf(name);
const target = model.rows.map(({ fields }) => {
  const field = (name) => Number(fields[col(name)]);
  return { club: fields[col('club')], W: field('W'), D: field('D'), L: field('L'), GF: field('GF'), GA: field('GA'), xg: Math.round(field('xG') * 10) };
});
const clubs = target.map((t) => t.club).sort();
const N = clubs.length;
const goal = Object.fromEntries(target.map((t) => [t.club, t]));
const strength = (club) => 3 * goal[club].W + goal[club].D;
const sum = (key) => target.reduce((s, t) => s + t[key], 0);
if (sum('W') !== sum('L') || sum('D') % 2 || sum('GF') !== sum('GA') || target.some((t) => t.W + t.D + t.L !== 2 * (N - 1))) {
  throw new Error('league.cssv is not the end of a double round-robin season.');
}

// --- The search -------------------------------------------------------------------
function season(seed) {
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(rand() * n);

  // The fixtures: the circle method gives 9 rounds; the second half swaps home and away.
  const order = [...clubs].sort(() => rand() - 0.5);
  const rounds = [];
  for (let r = 0; r < N - 1; r++) {
    const ring = [order[0], ...order.slice(1).slice(r), ...order.slice(1).slice(0, r)];
    rounds.push(Array.from({ length: N / 2 }, (_, i) => (r % 2 === i % 2 ? [ring[i], ring[N - 1 - i]] : [ring[N - 1 - i], ring[i]])));
  }
  const matches = [...rounds, ...rounds.map((round) => round.map(([h, a]) => [a, h]))]
    .flatMap((round, i) => round.map(([home, away]) => ({ matchday: i + 1, home, away })));

  // Simulated annealing, one match at a time: `change` returns the cost of a
  // random change, or null, and `undo` takes the last one back.
  function anneal(change, undo, steps) {
    for (let i = 0; i < steps; i++) {
      const d = change();
      if (d === null || d <= 0) continue;
      if (rand() >= Math.exp(-d / Math.max(0.02, 2 * (1 - i / steps)))) undo();
    }
  }
  const at = new Map(clubs.map((club, i) => [club, i]));
  for (const m of matches) [m.h, m.a] = [at.get(m.home), at.get(m.away)];
  const want = (key) => clubs.map((club) => goal[club][key]);
  const off = (have, wanted, c) => Math.abs(have[c] - wanted[c]);
  const S = clubs.map(strength);

  // Outcomes, 1 a home win, 0 a draw, -1 an away win, so that each club ends
  // with its wins, draws and losses. Upsets and away wins cost a little.
  const tally = { W: new Int32Array(N), D: new Int32Array(N), L: new Int32Array(N) };
  const goalOf = { W: want('W'), D: want('D'), L: want('L') };
  const count = (m, sign) => {
    const [h, a] = m.o > 0 ? ['W', 'L'] : m.o < 0 ? ['L', 'W'] : ['D', 'D'];
    tally[h][m.h] += sign;
    tally[a][m.a] += sign;
  };
  const record = (c) => off(tally.W, goalOf.W, c) + off(tally.D, goalOf.D, c) + off(tally.L, goalOf.L, c);
  const outcomeCost = (m) => 4 * (record(m.h) + record(m.a)) + Math.max(0, (S[m.a] - S[m.h]) * m.o) / 400 + (m.o < 0 ? 0.01 : 0);
  for (const m of matches) { m.o = Math.sign(S[m.h] + 4 - S[m.a]); count(m, 1); }
  let last = null;
  anneal(() => {
    const m = matches[int(matches.length)];
    const before = outcomeCost(m);
    last = [m, m.o];
    count(m, -1);
    m.o = [1, 0, -1].filter((o) => o !== last[1])[int(2)];
    count(m, 1);
    return outcomeCost(m) - before;
  }, () => { const [m, o] = last; count(m, -1); m.o = o; count(m, 1); }, 60000);
  if (clubs.some((_, c) => record(c))) return null;

  // Scores that keep each outcome, so that each club ends with its goals for
  // and against. Big totals and big margins cost a little, as they're rare.
  const GF = new Int32Array(N), GA = new Int32Array(N);
  const goalsFor = want('GF'), goalsAgainst = want('GA');
  const score = (m, sign) => { GF[m.h] += sign * m.hg; GA[m.h] += sign * m.ag; GF[m.a] += sign * m.ag; GA[m.a] += sign * m.hg; };
  const goals = (c) => off(GF, goalsFor, c) + off(GA, goalsAgainst, c);
  const scoreCost = (m) => goals(m.h) + goals(m.a) + 0.3 * Math.max(0, m.hg + m.ag - 4) + 0.2 * Math.max(0, Math.abs(m.hg - m.ag) - 1);
  for (const m of matches) {
    const low = int(2), margin = m.o === 0 ? 0 : 1;
    [m.hg, m.ag] = m.o >= 0 ? [low + margin, low] : [low, low + margin];
    score(m, 1);
  }
  anneal(() => {
    const m = matches[int(matches.length)];
    const d = rand() < 0.5 ? 1 : -1;
    let [hg, ag] = [m.hg, m.ag];
    if (m.o === 0) { hg += d; ag += d; } else if (rand() < 0.5) hg += d; else ag += d;
    if (Math.min(hg, ag) < 0 || Math.max(hg, ag) > 6 || Math.sign(hg - ag) !== m.o) return null;
    const before = scoreCost(m);
    last = [m, m.hg, m.ag];
    score(m, -1);
    [m.hg, m.ag] = [hg, ag];
    score(m, 1);
    return scoreCost(m) - before;
  }, () => { const [m, hg, ag] = last; score(m, -1); [m.hg, m.ag] = [hg, ag]; score(m, 1); }, 200000);
  if (clubs.some((_, c) => goals(c))) return null;

  // xG: each club's total, in tenths, shared out by goals scored plus noise.
  for (const club of clubs) {
    const sides = matches.flatMap((m) => (m.home === club ? [[m, 'hxg', m.hg]] : m.away === club ? [[m, 'axg', m.ag]] : []));
    const weights = sides.map(([, , goals]) => 0.6 + goals * 0.8 + rand() * 1.4);
    const total = weights.reduce((s, w) => s + w, 0);
    const shares = weights.map((w) => (w / total) * goal[club].xg);
    const whole = shares.map(Math.floor);
    let rest = goal[club].xg - whole.reduce((s, x) => s + x, 0);
    for (const i of shares.map((s, i) => [s - whole[i], i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
      if (rest-- <= 0) break;
      whole[i]++;
    }
    sides.forEach(([m, key], i) => { m[key] = whole[i]; });
  }
  return matches;
}

// The closest title race: lead changes, and a title still open on the last day.
function drama(matches) {
  const tables = Array.from({ length: 2 * (N - 1) }, (_, i) => standings(matches, clubs, i + 1));
  const top = tables.map((table) => table.find((line) => line.Pos === 1).club);
  const changes = top.filter((club, i) => i > 0 && club !== top[i - 1]).length;
  const before = tables.at(-2);
  const gap = before.find((l) => l.Pos === 1).Pts - before.find((l) => l.Pos === 2).Pts;
  const late = top.at(-2) !== top.at(-1) ? 6 : gap <= 1 ? 3 : 0;
  const leads = new Set(top.slice(4)).size;
  return Math.min(changes, 7) + late + leads;
}

const DATES = ['2025-08-16', '2025-08-30', '2025-09-13', '2025-09-27', '2025-10-11', '2025-10-25', '2025-11-08', '2025-11-22', '2025-12-06',
  '2026-01-24', '2026-02-07', '2026-02-21', '2026-03-07', '2026-03-21', '2026-04-04', '2026-04-18', '2026-05-02', '2026-05-16'];
let best = null;
for (let seed = 1; seed <= 120; seed++) {
  const matches = season(seed * 7919);
  if (!matches) continue;
  const score = drama(matches);
  if (!best || score > best.score) best = { seed, score, matches };
}
if (!best) throw new Error('No season found.');
const line = (m) => [m.matchday, DATES[m.matchday - 1], m.home, m.away, m.hg, m.ag, (m.hxg / 10).toFixed(1), (m.axg / 10).toFixed(1)].join(',');
const csv = ['matchday,date,home,away,home goals,away goals,home xG,away xG', ...best.matches.map(line)].join('\n') + '\n';
const matches = readResults(csv);
const final = standings(matches, clubs, 2 * (N - 1));
for (const l of final) {
  const t = goal[l.club];
  if (['W', 'D', 'L', 'GF', 'GA', 'xg'].some((key) => l[key] !== t[key])) throw new Error(`${l.club} does not end at its line in league.cssv.`);
}
writeFileSync(RESULTS, csv);
const file = readFileSync(SEASON, 'utf8');
writeFileSync(SEASON, file.slice(0, file.indexOf('\n---\n') + 5) + dataSection(final));
console.log(`examples/season-results.csv: ${matches.length} matches, seed ${best.seed}, drama ${best.score}`);
