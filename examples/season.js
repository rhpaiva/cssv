// The league table after any matchday of season-results.csv, for the season
// on experiments.html and tools/season.js. The table keeps one order, the
// clubs' order in season.cssv; Pos says where each club stands.
import { parse } from '../src/core.js';

export const HEADER = ['Pos', 'club', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'xG'];

/** The matches in a results file: { matchday, date, home, away, hg, ag, hxg, axg }, xG in tenths. */
export function readResults(text) {
  const { columns, rows } = parse(text);
  const at = Object.fromEntries(columns.map((name, i) => [name, i]));
  return rows.map(({ fields }) => ({
    matchday: Number(fields[at.matchday]),
    date: fields[at.date],
    home: fields[at.home],
    away: fields[at.away],
    hg: Number(fields[at['home goals']]),
    ag: Number(fields[at['away goals']]),
    hxg: Math.round(Number(fields[at['home xG']]) * 10),
    axg: Math.round(Number(fields[at['away xG']]) * 10),
  }));
}

/**
 * Each club's line after `matchday` (0 is before the first one), in `clubs`
 * order. Pos ranks by points, then goal difference, goals scored and name,
 * so no two clubs share a place.
 */
export function standings(matches, clubs, matchday) {
  const lines = new Map(clubs.map((club) => [club, { club, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, xg: 0 }]));
  for (const m of matches) {
    if (m.matchday > matchday) continue;
    for (const [club, gf, ga, xg] of [[m.home, m.hg, m.ag, m.hxg], [m.away, m.ag, m.hg, m.axg]]) {
      const line = lines.get(club);
      line.P++;
      line.GF += gf;
      line.GA += ga;
      line.xg += xg;
      line[gf > ga ? 'W' : gf < ga ? 'L' : 'D']++;
    }
  }
  const table = [...lines.values()].map((line) => ({ ...line, GD: line.GF - line.GA, Pts: 3 * line.W + line.D }));
  [...table]
    .sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || (a.club < b.club ? -1 : 1))
    .forEach((line, i) => { line.Pos = i + 1; });
  return table;
}

/** The data section for a table from standings(): the header and one record per club. */
export function dataSection(table) {
  const record = (line) => HEADER.map((name) => (name === 'xG' ? (line.xg / 10).toFixed(1) : line[name])).join(';');
  return [HEADER.join(';'), ...table.map(record)].join('\n') + '\n';
}
