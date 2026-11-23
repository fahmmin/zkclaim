// The live demo with real 1AM transactions on the local Midnight devnet (recording contract 3f2b92ac…), cut from the
// UI session's capture: dapp.mp4 + wallet.mp4 (same clock, marks.json), plus receipt.mp4 (clean browser, no wallet).
//   $env:TIMELINE = './live-timeline.mjs'; node videos/edit/src/build.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
export const EDIT = path.resolve(SRC, '../../live'); // videos/live
export const RAW = path.resolve(EDIT, '..');
export const WORK = path.join(EDIT, 'work');
export const SFX_DIR = path.resolve(SRC, '../work/sfx');
export const OUT_NAME = 'zkclaim-live-demo';
export const FPS = 30;
export const W = 1920;
export const H = 1080;

const rec = (name) => path.join(WORK, 'rec', `${name}.mp4`);
const marks = JSON.parse(readFileSync(path.join(WORK, 'rec', 'marks.json'), 'utf8'));
const at = (re) => {
  const m = marks.find((x) => re.test(x.name));
  if (!m) throw new Error(`No live mark matching ${re}`);
  return m.at;
};
const receiptLen = JSON.parse(readFileSync(path.join(WORK, 'rec', 'receipt.json'), 'utf8')).duration;

// A: the app large, the wallet beside it. B: the wallet large while it asks to sign and proves, the app small.
export const GEO = {
  dappA: { x: 40, y: 168, w: 1296, h: 811, r: 14 },
  walletA: { x: 1376, y: 168, w: 504, h: 445, r: 14 },
  dappB: { x: 40, y: 168, w: 560, h: 350, r: 12 },
  walletB: { x: 700, y: 150, w: 1000, h: 883, r: 16 },
};
const LAYOUT = { A: ['dappA', 'walletA'], B: ['dappB', 'walletB'] };

export const PIECES = [];
let cursor = 0;
const add = (p) => ((p.start = cursor / FPS), (p.dur = p.frames / FPS), (cursor += p.frames), PIECES.push(p), p);
const card = (id, s) => add({ id, kind: 'card', frames: Math.round(s * FPS) });
const duo = (id, layout, from, to, speed = 1) =>
  add({ id, kind: 'duo', layout, from, speed, panes: [{ src: rec('dapp'), geo: LAYOUT[layout][0] }, { src: rec('wallet'), geo: LAYOUT[layout][1] }], frames: Math.round(((to - from) / speed) * FPS) });

const tapConsent = at(/click: consent D/);
const reqConsent = at(/1AM request/);
const consented = at(/D consented/);
const tapProve = at(/click: prove & submit D/);
const reqClaim = marks.filter((m) => /1AM request/.test(m.name))[1].at;
const checksD = at(/checks reveal D/);
const insurer = at(/insurer: settled claim/);
const navPatient = at(/nav: patient/);
const tapWithdraw = at(/click: withdraw E/);
const reqWithdraw = marks.filter((m) => /1AM request/.test(m.name))[2].at;
const withdrawn = at(/E withdrawn/);
const navHospitalE = marks.filter((m) => /nav: hospital/.test(m.name))[1].at;
const refused = at(/E refused/);
const getReceipt = at(/click: get receipt D/);
const receiptClosed = at(/receipt closed/);

card('title', 3);
duo('consent', 'A', 0, tapConsent + 2.0);
const ff1 = duo('consentWait', 'A', tapConsent + 2.0, reqConsent - 0.3, 6);
const ap1 = duo('consentSign', 'B', reqConsent - 0.3, reqConsent + 2.4);
const ff2 = duo('consentProve', 'B', reqConsent + 2.4, consented - 0.2, 7);
duo('consented', 'A', consented - 0.2, tapProve - 0.2);
duo('prove', 'A', tapProve - 0.2, tapProve + 3.4);
const ff3 = duo('proveWait', 'A', tapProve + 3.4, reqClaim - 0.3, 6);
const ap2 = duo('claimSign', 'B', reqClaim - 0.3, reqClaim + 2.4);
const ff4 = duo('claimProve', 'B', reqClaim + 2.4, checksD - 0.5, 6);
const paid = duo('paid', 'A', checksD - 0.5, insurer - 1.4);
duo('insurer', 'A', insurer - 1.4, navPatient);
duo('withdraw', 'A', navPatient, tapWithdraw + 0.7);
const ff5 = duo('withdrawWait', 'A', tapWithdraw + 0.7, reqWithdraw - 0.3, 5);
const ap3 = duo('withdrawSign', 'B', reqWithdraw - 0.3, reqWithdraw + 2.4);
const ff6 = duo('withdrawProve', 'B', reqWithdraw + 2.4, withdrawn - 0.3, 7);
duo('withdrawn', 'A', withdrawn - 0.3, navHospitalE);
const refuse = duo('refuse', 'A', navHospitalE, refused + 3.4);
duo('receipt', 'A', getReceipt - 0.4, receiptClosed + 0.1);
add({ id: 'verify', kind: 'screen', src: rec('receipt'), from: 0, speed: 1, frames: Math.round(receiptLen * FPS) });
card('end', 3);

export const TOTAL_FRAMES = cursor;
export const DURATION = cursor / FPS;
const piece = (id) => PIECES.find((p) => p.id === id);
const end = (id) => piece(id).start + piece(id).dur;
/** Film time of a moment in the capture, through whichever piece shows it. */
const filmOf = (t) => {
  const p = PIECES.find((x) => x.kind === 'duo' && t >= x.from && t < x.from + x.dur * x.speed);
  if (!p) throw new Error(`No piece shows capture time ${t}`);
  return p.start + (t - p.from) / p.speed;
};
export const CUES = [];

const step = (id1, id2, head, sub) => ({ type: 'sticker', in: piece(id1).start + 0.15, out: end(id2), x: 40, y: 34, rot: -1.5, tone: 'paper', lines: [head, sub] });
const frames = (id) => {
  const p = piece(id);
  const [d, w] = LAYOUT[p.layout];
  const wl = p.layout === 'B' ? { label: '1AM wallet · real transaction' } : { label: '1AM wallet', labelY: GEO.walletA.y + GEO.walletA.h + 22 };
  return [
    { type: 'window', in: p.start, out: end(id), ...GEO[d], label: '' },
    { type: 'window', in: p.start, out: end(id), ...GEO[w], ...wl },
  ];
};
const ff = (p, real) => {
  const left = p.layout === 'B';
  return { type: 'sticker', in: p.start + 0.1, out: p.start + p.dur, x: left ? 40 : 1376, y: left ? 560 : 760, rot: -2, tone: 'mustard', lines: [`${p.speed}× faster`, real] };
};
const note = (p, head, sub, tone = 'mustard') => {
  const left = p.layout === 'B';
  return { type: 'sticker', in: p.start + 0.2, out: p.start + p.dur, x: left ? 40 : 1376, y: left ? 560 : 760, rot: -2, tone, lines: [head, sub] };
};
const secs = (p) => `${Math.round(p.dur * p.speed)} s`;

export const GRAPHICS = [
  { type: 'title', in: 0, out: piece('title').dur, lines: ['Live on', 'Midnight'], metaL: 'Recorded live · local Midnight devnet', metaR: 'Real proofs · 1AM wallet', stickerHead: 'Every approval is real', stickerSub: 'a 1AM wallet transaction on this laptop', stickerX: 1180, stickerY: 800 },
  ...PIECES.filter((p) => p.kind === 'duo').flatMap((p) => frames(p.id)),
  { type: 'sticker', in: piece('consent').start, out: end('receipt'), x: 1530, y: 40, rot: 2, tone: 'tomato', lines: ['Live', 'local Midnight devnet'] },
  step('consent', 'consented', 'Rohan consents to bill D', 'Step 1 of 6'),
  step('prove', 'paid', 'The hospital proves the claim', 'Step 2 of 6'),
  step('insurer', 'insurer', 'The insurer sees a payment', 'Step 3 of 6: not the patient'),
  step('withdraw', 'withdrawn', 'Rohan withdraws bill E', 'Step 4 of 6'),
  step('refuse', 'refuse', 'The hospital tries bill E anyway', 'Step 5 of 6'),
  step('receipt', 'receipt', 'A receipt anyone can check', 'Step 6 of 6'),
  ff(ff1, `${secs(ff1)} while 1AM builds the proof`),
  ff(ff2, `${secs(ff2)} proving and submitting, on this laptop`),
  ff(ff3, `${secs(ff3)} proving the eight checks`),
  ff(ff4, `${secs(ff4)} proving and submitting`),
  ff(ff5, `${secs(ff5)} while 1AM builds the proof`),
  ff(ff6, `${secs(ff6)} proving and submitting`),
  note(ap1, 'Real 1AM request', 'Rohan’s wallet signs his consent'),
  note(ap2, 'submitClaim', 'The hospital signs: 1AM shows the contract and the operation'),
  note(ap3, 'Withdraw', 'Rohan signs; whichever lands on the ledger first wins'),
  { type: 'sticker', in: filmOf(checksD + 2.0), out: end('paid'), x: 1376, y: 760, rot: -2, tone: 'sky', lines: ['+400 NIGHT', 'paid by the contract, in the same transaction'] },
  { type: 'sticker', in: filmOf(refused), out: end('refuse'), x: 1376, y: 760, rot: -2, tone: 'tomato', lines: ['Refused', 'Patient has not consented to this claim'] },
  { type: 'sticker', in: piece('verify').start + 0.3, out: end('verify'), x: 1150, y: 880, rot: -2, tone: 'mustard', lines: ['A clean browser, no wallet', 'Matches, then one digit changed'] },
  { type: 'logo', in: piece('end').start, out: end('end') },
];

export const BEDS = [
  { file: 'pad', from: 0.2, to: piece('end').start + 0.3, gain: -22, fadeIn: 1.5, fadeOut: 0.8 },
  { file: 'outro', from: piece('end').start - 0.4, to: DURATION, gain: -15, fadeIn: 0.4, fadeOut: 1.2 },
];
export const SFX = [
  ...[tapConsent, tapProve, tapWithdraw, at(/click: prove & submit E/), getReceipt].map((t) => ({ file: 'tap', at: filmOf(t) - 0.02, gain: 6 })),
  ...[reqConsent, reqClaim, reqWithdraw].map((t) => ({ file: 'ping', at: filmOf(t), gain: -6 })),
  { file: 'success', at: filmOf(at(/PAID D/)), gain: -9 },
  { file: 'stamp', at: filmOf(refused), gain: -4 },
  { file: 'whoosh', at: piece('verify').start - 0.1, gain: -12 },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const p of PIECES) console.log(`${p.id.padEnd(14)} ${(p.layout ?? p.kind).padEnd(7)} ${p.start.toFixed(2).padStart(7)} +${p.dur.toFixed(2)}${p.speed && p.speed !== 1 ? `  (${p.speed}x)` : ''}`);
  console.log(`total ${DURATION.toFixed(2)} s`);
}
