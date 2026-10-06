// The music in experiments.html, 06: visualizer-song.csv played by Web Audio
// oscillators, and the song's spectrum as a data section for visualizer.cssv.
// The song is one record per note: the beat it starts on, the instrument,
// the note and how many beats it lasts. It loops at 100 beats a minute.
import { parse } from '../src/core.js';

export const BANDS = 32;
const BPM = 100;
const LOW = 40, HIGH = 16000; // the bands split this range evenly by pitch
const EDGES = Array.from({ length: BANDS + 1 }, (_, k) => LOW * (HIGH / LOW) ** (k / BANDS));
/** Each band's center frequency, in Hz. */
export const CENTERS = EDGES.slice(0, -1).map((low, k) => Math.round(Math.sqrt(low * EDGES[k + 1])));

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function hz(note) {
  const [, name, sharp, octave] = /^([A-G])(#?)(-?\d)$/.exec(note);
  return 440 * 2 ** ((12 * (Number(octave) + 1) + SEMITONES[name] + (sharp ? 1 : 0) - 69) / 12);
}

/** The notes in a song file: { beat, instrument, note, beats }. */
export function readSong(text) {
  const { columns, rows } = parse(text);
  const at = (name) => columns.indexOf(name);
  return rows.map(({ fields }) => ({
    beat: Number(fields[at('beat')]),
    instrument: fields[at('instrument')],
    note: fields[at('note')],
    beats: Number(fields[at('beats')]),
  }));
}

/**
 * Starts the song, looping. Returns the analyser that reads its spectrum,
 * the beat it is on, and stop(). Must be called from a click: browsers only
 * let audio start on one.
 */
export function play(notes) {
  const ctx = new AudioContext();
  const beat = 60 / BPM;
  const loop = Math.ceil(Math.max(...notes.map((n) => n.beat + n.beats)) / 4) * 4;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.minDecibels = -95;
  analyser.maxDecibels = -34;
  analyser.smoothingTimeConstant = 0.55;
  const master = ctx.createGain();
  master.gain.value = 0.3;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor).connect(analyser).connect(ctx.destination);

  // An echo on the lead, a dotted eighth late.
  const echo = ctx.createDelay(1);
  echo.delayTime.value = beat * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.34;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  // An envelope: up to `peak` in `attack` seconds, then down to silence at `end`.
  function envelope(at, peak, attack, end) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    return gain;
  }
  function tone(type, frequency, at, end, out, detune = 0) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    osc.connect(out);
    osc.start(at);
    osc.stop(end + 0.05);
    return osc;
  }
  function hiss(at, end, filter, frequency, out) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = frequency;
    src.connect(f).connect(out);
    src.start(at);
    src.stop(end + 0.05);
  }
  function lowpass(frequency, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  const instruments = {
    kick(at) {
      const out = envelope(at, 1, 0.004, at + 0.4);
      out.connect(master);
      const osc = tone('sine', 140, at, at + 0.4, out);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.14);
    },
    snare(at) {
      const out = envelope(at, 0.45, 0.002, at + 0.2);
      out.connect(master);
      hiss(at, at + 0.2, 'bandpass', 1900, out);
      const body = envelope(at, 0.3, 0.002, at + 0.1);
      body.connect(master);
      tone('triangle', 185, at, at + 0.1, body);
    },
    hat(at) {
      const out = envelope(at, 0.16, 0.001, at + 0.05);
      out.connect(master);
      hiss(at, at + 0.05, 'highpass', 7500, out);
    },
    bass(at, f, length) {
      const out = envelope(at, 0.3, 0.006, at + length);
      const filter = lowpass(220, 7);
      filter.frequency.setValueAtTime(220, at);
      filter.frequency.exponentialRampToValueAtTime(900, at + 0.03);
      filter.frequency.exponentialRampToValueAtTime(240, at + length);
      filter.connect(out).connect(master);
      tone('sawtooth', f, at, at + length, filter);
    },
    pad(at, f, length) {
      const out = envelope(at, 0.045, 0.35, at + length + 0.5);
      const filter = lowpass(1400);
      filter.connect(out).connect(master);
      for (const detune of [-8, 8]) tone('sawtooth', f, at, at + length + 0.5, filter, detune);
    },
    lead(at, f, length) {
      const out = envelope(at, 0.1, 0.008, at + length);
      const filter = lowpass(2600);
      filter.connect(out);
      out.connect(master);
      out.connect(echo);
      tone('square', f, at, at + length, filter);
    },
  };

  // Notes are scheduled a little ahead, loop after loop.
  const start = ctx.currentTime + 0.1;
  let scheduled = 0; // in beats from the start
  function schedule() {
    const until = (ctx.currentTime - start + 0.25) / beat;
    while (scheduled < until) {
      const lap = Math.floor(scheduled / loop);
      const from = scheduled - lap * loop;
      const to = Math.min(loop, from + 0.25);
      for (const n of notes) {
        if (n.beat < from || n.beat >= to) continue;
        const at = start + (lap * loop + n.beat) * beat;
        instruments[n.instrument]?.(at, n.note ? hz(n.note) : 0, n.beats * beat);
      }
      scheduled = lap * loop + to;
    }
  }
  schedule();
  const timer = setInterval(schedule, 40);

  return {
    analyser,
    loop,
    /** The beat the song is on, within the loop. */
    beat: () => Math.max(0, ((ctx.currentTime - start) / beat) % loop),
    stop() {
      clearInterval(timer);
      ctx.close();
    },
  };
}

/** The data section for the analyser's spectrum now: band, Hz and level from 0 to 100. */
export function spectrum(analyser) {
  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const perBin = analyser.context.sampleRate / analyser.fftSize;
  const lines = ['band,Hz,level'];
  for (let k = 0; k < BANDS; k++) {
    const first = Math.floor(EDGES[k] / perBin);
    const last = Math.max(first, Math.ceil(EDGES[k + 1] / perBin) - 1);
    let peak = 0;
    for (let i = first; i <= last; i++) peak = Math.max(peak, bins[i]);
    // Music is quieter the higher it goes; lift the top a little.
    const level = Math.min(100, Math.round((peak / 255) * 100 * (1 + (0.4 * k) / BANDS)));
    lines.push(`${k + 1},${CENTERS[k]},${level}`);
  }
  return lines.join('\n') + '\n';
}
