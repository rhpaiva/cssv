// The film in cinema.html: six scenes, each a function from the time into the
// scene to a frame. A frame is the data section of cinema.cssv: the header,
// 45 records of 80 pixels, and the subtitle record. A pixel is a level from
// 0 (dark) to 4 (light), written as one of the five kinds of field that the
// projector, cinema.cssv's style block, tells apart.
export const W = 80, H = 45, FPS = 24;
const VALUES = ['', '-1', '0', '1', 'x'];
const HEADER = ['scene', ...Array.from({ length: W }, (_, x) => x + 1)].join(',');

/** The film: `reel` is the text of cinema-horse.csv. */
export function film(reel) {
  const horse = reel.trimEnd().split('\n').slice(1).map((line) => line.slice(line.indexOf(',') + 1));
  const scenes = [
    { name: 'leader', length: 3, draw: leader },
    { name: 'title', length: 4, draw: title, subtitles: [[0, 'presents'], [2, 'a film in a spreadsheet']] },
    {
      name: 'horse', length: 6,
      rows: (t) => { const f = Math.floor(t * 10) % (horse.length / H); return horse.slice(f * H, f * H + H); },
      subtitles: [[0.4, 'Sallie Gardner at a Gallop, by Eadweard Muybridge, 1878'], [3, 'Every frame is 45 records of a CSV file']],
    },
    { name: 'fire', length: 5, draw: fire(), subtitles: [[0.3, 'Every pixel is a field: empty, -1, 0, 1 or x'], [2.6, 'and the style block colors each kind']] },
    { name: 'plasma', length: 5, draw: plasma, subtitles: [[0.3, 'update() gets the next frame 24 times a second'], [2.6, 'and changes only the cells that changed']] },
    { name: 'end', length: 4, draw: end },
  ];
  let start = 0;
  for (const scene of scenes) [scene.start, start] = [start, start + scene.length];
  const length = start;
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });

  return {
    length,
    frames: Math.round(length * FPS),
    /** The scene and the data section at `t` seconds, looping. */
    at(t) {
      t %= length;
      const scene = scenes.findLast((s) => s.start <= t);
      const local = t - scene.start;
      let rows = scene.rows?.(local);
      if (!rows) {
        const level = scene.draw(local, ctx);
        rows = Array.from({ length: H }, (_, y) => Array.from(level.subarray(y * W, y * W + W), (l) => VALUES[l]).join(','));
      }
      const subtitle = scene.subtitles?.findLast(([from]) => from <= local)?.[1];
      const data = [HEADER, ...rows.map((row) => `${scene.name},${row}`), subtitle ? `subtitle,"${subtitle.replaceAll('"', '""')}"` : 'subtitle'];
      return { scene: scene.name, data: data.join('\n') + '\n' };
    },
  };
}

// --- Drawn scenes: shapes and text on a canvas the size of the screen, read back as levels.
const gray = (level) => `rgb(${(level * 255) / 4} ${(level * 255) / 4} ${(level * 255) / 4})`;
function read(ctx) {
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = Math.round((rgba[i * 4] / 255) * 4);
  return out;
}
function text(ctx, string, x, y, font, level) {
  ctx.font = font;
  ctx.fillStyle = gray(level);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(string, x, y);
}

// The countdown leader: 3, 2, 1, with the sweep going round once a second.
function leader(t, ctx) {
  const cx = W / 2, cy = H / 2;
  ctx.fillStyle = gray(3);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = gray(2);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, W, -Math.PI / 2, -Math.PI / 2 + (t % 1) * 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = gray(1);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, 0); ctx.lineTo(cx + 0.5, H);
  ctx.moveTo(0, cy + 0.5); ctx.lineTo(W, cy + 0.5);
  ctx.stroke();
  ctx.strokeStyle = gray(4);
  ctx.lineWidth = 1.5;
  for (const r of [19, 15]) { ctx.beginPath(); ctx.arc(cx + 0.5, cy + 0.5, r, 0, 2 * Math.PI); ctx.stroke(); }
  text(ctx, String(3 - Math.floor(t)), cx + 0.5, cy + 2, '700 26px system-ui, sans-serif', 0);
  return read(ctx);
}

function title(t, ctx) {
  ctx.fillStyle = gray(0);
  ctx.fillRect(0, 0, W, H);
  ctx.letterSpacing = '1px';
  text(ctx, 'CSSV', W / 2, 17, '800 21px system-ui, sans-serif', 4);
  ctx.letterSpacing = '0.5px';
  text(ctx, 'PICTURES', W / 2, 33, '700 9px system-ui, sans-serif', 3);
  ctx.letterSpacing = '0px';
  return read(ctx);
}

function end(t, ctx) {
  ctx.fillStyle = gray(0);
  ctx.fillRect(0, 0, W, H);
  ctx.letterSpacing = '0.5px';
  text(ctx, 'THE END', W / 2, H / 2 - 2, '800 11px system-ui, sans-serif', 4);
  ctx.letterSpacing = '0px';
  return read(ctx);
}

// --- Computed scenes

// Fire, the old way: heat rises from the bottom row and cools as it goes.
// It runs at 24 steps a second, from the scene's start.
function fire() {
  const heat = new Float32Array(W * (H + 2));
  let steps = 0;
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  return (t) => {
    const want = Math.floor(t * FPS);
    if (want < steps) { heat.fill(0); steps = 0; seed = 7; }
    for (; steps <= want; steps++) {
      const fuel = Math.min(1, steps / 12);
      for (let x = 0; x < W; x++) {
        heat[(H + 1) * W + x] = rand() < 0.55 ? fuel * (0.85 + rand() * 0.6) : 0;
        heat[H * W + x] = heat[(H + 1) * W + x] * 0.9 + heat[H * W + x] * 0.1;
      }
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const below = (y + 1) * W;
          const sum = heat[below + Math.max(0, x - 1)] + heat[below + x] + heat[below + Math.min(W - 1, x + 1)] + heat[(y + 2) * W + x];
          heat[y * W + x] = Math.max(0, sum / 4.12 - 0.008);
        }
      }
    }
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++) out[i] = Math.min(4, Math.floor(heat[i] * 6));
    return out;
  };
}

function plasma(t) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.sin(x / 7 + t * 1.3) + Math.sin(y / 5 - t * 0.9) + Math.sin((x + y) / 10 + t * 0.7)
        + Math.sin(Math.hypot(x - 40 - 15 * Math.sin(t * 0.5), y - 22) / 5 - t * 2);
      out[y * W + x] = Math.min(4, Math.floor(((v + 4) / 8) * 5));
    }
  }
  return out;
}
