// The recorded product demo (about 2 minutes): full-screen recordings of the hosted app, mostly in Demo mode with
// the app's own caption bar, plus the patient's phone, the Tamper Lab and a real Preprod receipt check.
//   $env:TIMELINE = './demo-timeline.mjs'; node videos/edit/src/build.mjs
// Recordings: node videos/edit/src/record.mjs story|tamper|receipt|withdraw videos/demo/work/rec
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
export const EDIT = path.resolve(SRC, '../../demo'); // videos/demo
export const RAW = path.resolve(EDIT, '..');
export const WORK = path.join(EDIT, 'work');
export const SFX_DIR = path.resolve(SRC, '../work/sfx'); // the film's generated beds and effects
export const OUT_NAME = 'zkclaim-demo';
export const FPS = 30;
export const W = 1920;
export const H = 1080;

const rec = (name) => path.join(WORK, 'rec', `${name}.mp4`);
const marks = (name) => JSON.parse(readFileSync(path.join(WORK, 'rec', `${name}.json`), 'utf8'));
const at = (name, re) => {
  const m = marks(name).marks.find((x) => re.test(x.name));
  if (!m) throw new Error(`No ${name} mark matching ${re}`);
  return m.at;
};

export const GEO = { phoneBig: { x: 743, y: 70, w: 434, h: 940, r: 52, bezel: 16 } };

export const PIECES = [];
let cursor = 0;
const add = (p) => ((p.start = cursor / FPS), (p.dur = p.frames / FPS), (cursor += p.frames), PIECES.push(p), p);
const card = (id, s) => add({ id, kind: 'card', frames: Math.round(s * FPS) });
const screen = (id, name, from, to, speed = 1) => add({ id, kind: 'screen', src: rec(name), from, speed, frames: Math.round(((to - from) / speed) * FPS) });

const step = (re) => at('story', re);
const storyEnd = marks('story').duration;
card('title', 3);
screen('setup', 'story', step(/Step 2 /), step(/Step 6 /), 1.2);
screen('paid', 'story', step(/Step 6 /), step(/Step 8 /));
const withdraw = add({ id: 'withdraw', kind: 'phoneBig', src: rec('withdraw'), from: 0, k: 0.85, frames: Math.round((marks('withdraw').duration / 0.85) * FPS) });
// The lab's page doesn't repaint while every attack runs, so the frozen stretch is cut out.
screen('tamperA', 'tamper', 0, at('tamper', /^run$/) - 5.6);
screen('tamperB', 'tamper', at('tamper', /^run$/) - 0.1, marks('tamper').duration);
screen('records', 'story', step(/Step 9 /), step(/end card/), 1.3);
screen('receipt', 'receipt', 0, marks('receipt').duration);
screen('summary', 'story', step(/end card/), storyEnd);
card('end', 3.5);

export const TOTAL_FRAMES = cursor;
export const DURATION = cursor / FPS;
const piece = (id) => PIECES.find((p) => p.id === id);
const end = (id) => piece(id).start + piece(id).dur;

export const CUES = [];
export const GRAPHICS = [
  { type: 'title', in: 0, out: piece('title').dur, lines: ['zkClaim', 'Demo'], metaL: 'Recorded product demo', metaR: 'Hackasol 5.0 · W3-01', stickerHead: 'Demo mode', stickerSub: 'the contract’s own logic, run in the browser' },
  { type: 'phone', in: withdraw.start, out: end('withdraw'), ...GEO.phoneBig },
  { type: 'sticker', in: withdraw.start + 0.2, out: end('withdraw'), x: 96, y: 380, rot: -2, tone: 'mustard', lines: ['A second bill', 'The patient withdraws permission.', 'The hospital can’t settle it now.'] },
  { type: 'sticker', in: piece('tamperA').start + 0.2, out: end('tamperB'), x: 1250, y: 880, rot: -2, tone: 'mustard', lines: ['Tamper Lab', '15 ways to cheat, all rejected'] },
  { type: 'sticker', in: piece('receipt').start + 0.3, out: end('receipt'), x: 1180, y: 860, rot: -2, tone: 'mustard', lines: ['A real Preprod payout', 'Checked with no wallet'] },
  { type: 'logo', in: piece('end').start, out: end('end') },
];

export const BEDS = [
  { file: 'pad', from: 0.2, to: piece('summary').start + 0.5, gain: -21, fadeIn: 1.5, fadeOut: 1.0 },
  { file: 'outro', from: piece('summary').start, to: DURATION, gain: -15, fadeIn: 0.6, fadeOut: 1.5 },
];
export const SFX = ['setup', 'withdraw', 'tamperA', 'records', 'receipt', 'end'].map((id) => ({ file: 'whoosh', at: Math.max(0, piece(id).start - 0.1), gain: -16 }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const p of PIECES) console.log(`${p.id.padEnd(9)} ${p.kind.padEnd(9)} ${p.start.toFixed(2).padStart(7)} +${p.dur.toFixed(2)}`);
  console.log(`total ${DURATION.toFixed(2)} s`);
}
