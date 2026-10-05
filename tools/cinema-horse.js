// Writes examples/cinema-horse.csv, the footage in examples/cinema.html:
// Eadweard Muybridge's "Sallie Gardner at a Gallop" (1878), public domain,
// from Wikimedia Commons:
// https://commons.wikimedia.org/wiki/File:Muybridge_race_horse_animated.gif
//
// Each of the GIF's 15 frames becomes 45 records of 80 fields, the shape of a
// frame in cinema.cssv: the scene's name, then one value per pixel. The
// picture keeps its proportions, with dark bars on both sides, and every
// pixel is one of five values, from dark to light: empty, -1, 0, 1 and x.
//
// Run with: node tools/cinema-horse.js [horse.gif]
// Without a file it downloads the GIF. ffmpeg comes from $FFMPEG, or the PATH.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_GIF = 'https://upload.wikimedia.org/wikipedia/commons/d/dd/Muybridge_race_horse_animated.gif';
const OUT = new URL('../examples/cinema-horse.csv', import.meta.url);
const W = 80, H = 45;
const PICTURE = 68; // the photograph's width in pixels at 45 rows; the rest is bars
const VALUES = ['', '-1', '0', '1', 'x'];

let gif = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'cinema-'));
try {
  if (!gif) {
    const res = await fetch(URL_GIF, { headers: { 'user-agent': 'cssv examples (tools/cinema-horse.js)' } });
    if (!res.ok) throw new Error(`Could not download the GIF (HTTP ${res.status}).`);
    gif = join(dir, 'horse.gif');
    writeFileSync(gif, Buffer.from(await res.arrayBuffer()));
  }
  // Grayscale bytes, one per pixel, frame after frame.
  const ffmpeg = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-v', 'error', '-i', gif,
    '-vf', `scale=${PICTURE}:${H}:flags=area,pad=${W}:${H}:(ow-iw)/2:0:black,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`);
  const pixels = ffmpeg.stdout;
  const frames = pixels.length / (W * H);

  // Five levels, split at the picture's own quantiles so the horse, the
  // jockey's silks and the track each get their shades.
  const picture = [];
  for (let i = 0; i < pixels.length; i++) {
    const x = i % W;
    if (x >= (W - PICTURE) / 2 && x < (W + PICTURE) / 2) picture.push(pixels[i]);
  }
  picture.sort((a, b) => a - b);
  const cuts = [0.2, 0.3, 0.42, 0.6].map((q) => picture[Math.floor(q * picture.length)]);
  const level = (g) => cuts.filter((cut) => g > cut).length;

  const lines = [['scene', ...Array.from({ length: W }, (_, x) => x + 1)].join(',')];
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < H; y++) {
      const row = ['horse'];
      for (let x = 0; x < W; x++) row.push(VALUES[level(pixels[(f * H + y) * W + x])]);
      lines.push(row.join(','));
    }
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`examples/cinema-horse.csv: ${frames} frames of ${W}×${H}, cuts at ${cuts.join(', ')}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
