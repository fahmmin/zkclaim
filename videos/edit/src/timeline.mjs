// THE CLAIM: every cut, subtitle, graphic and sound cue, in film time. build.mjs renders it; nothing else decides timing.
// Footage times are seconds into the raw clips in videos/; recordings come from record.mjs (marks in work/rec/*.json).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // videos/edit
export const RAW = path.resolve(EDIT, '..'); // videos/
export const WORK = path.join(EDIT, 'work');
export const FPS = 30;
export const W = 1920;
export const H = 1080;

const recJson = (name) => JSON.parse(readFileSync(path.join(WORK, 'rec', `${name}.json`), 'utf8'));
const markAt = (rec, re) => {
  const m = rec.marks.find((x) => re.test(x.name));
  if (!m) throw new Error(`No recording mark matching ${re}`);
  return m.at;
};
const phoneRec = recJson('phone');
const laptopRec = recJson('laptop');

// Screens composited into the frame: x, y, w, h of the visible screen; r = corner radius; crop = region of the 2x laptop recording.
export const GEO = {
  phoneSmall: { x: 500, y: 130, w: 370, h: 800, r: 44, bezel: 14 },
  phoneBig: { x: 520, y: 70, w: 434, h: 940, r: 52, bezel: 16 },
  insurer: { x: 260, y: 86, w: 1400, h: 964, r: 18, crop: { x: 80, y: 280, w: 1800, h: 1240 } },
  hospital: { x: 210, y: 236, w: 1500, h: 750, r: 18, crop: { x: 80, y: 300, w: 1800, h: 900 } },
  tamper: { x: 150, y: 236, w: 1620, h: 697, r: 18, crop: { x: 80, y: 280, w: 2720, h: 1170 } },
};

// Slight push-in on alternate office pieces, so the jump cuts read as edits (1280x720 source pixels).
const PUNCH = { x: 136, y: 19, w: 1085, h: 610 };

// ---------- Pieces, in order ----------
const frames = (s) => Math.round(s * FPS);
export const PIECES = [];
let cursor = 0;
const add = (p) => {
  p.start = cursor / FPS;
  p.dur = p.frames / FPS;
  cursor += p.frames;
  PIECES.push(p);
  return p;
};
const card = (id, seconds) => add({ id, kind: 'card', frames: frames(seconds) });
const clip = (id, n, a, b, { speed = 1, crop = null, audio = speed === 1 } = {}) => add({ id, kind: 'clip', n, a, speed, crop, audio, frames: frames((b - a) / speed) });

// The phone walkthrough: clip 5 runs a little slow so the payment lands on his fist pump; the recording plays at k.
const WALL = [
  { a: 0, b: 9.25, speed: 0.82 },
  { a: 9.25, b: 10.19, speed: 1 },
];
const wallSeconds = WALL.reduce((s, p) => s + (p.b - p.a) / p.speed, 0);
const PHONE_PAID = markAt(phoneRec, /^paid$/);
const PAID_IN_WALL = 11.4; // film seconds into the wall shot where the PAID stamp should land
const K = PHONE_PAID / PAID_IN_WALL;

const window_ = (id, view, from, to, seconds) => add({ id, kind: 'window', view, from, speed: (to - from) / seconds, frames: frames(seconds) });

card('title', 2.4);
clip('A', 1, 1.45, 7.8);
clip('B', 1, 9.05, 26.4, { crop: PUNCH });
clip('C', 1, 26.95, 29.98);
clip('D', 1, 32.28, 40.42, { crop: PUNCH });
clip('E', 1, 40.88, 48.68);
clip('F', 2, 6.25, 21.9);
clip('G', 3, 0.3, 9.8);
clip('H', 4, 0, 3.0, { audio: false });
const I = add({ id: 'I', kind: 'phoneWall', wall: WALL, k: K, frames: frames(wallSeconds) });
const jFrom = I.dur * K;
const J = add({ id: 'J', kind: 'phoneBig', from: jFrom, k: K, frames: frames((phoneRec.duration - jFrom) / K - 0.05) });
clip('K', 6, 0.35, 8.2);
const paidOnTheSpot = markAt(laptopRec, /Paid on the spot/);
const insurerSees = markAt(laptopRec, /Insurer sees:/);
const noReject = markAt(laptopRec, /no reject button/);
const replay = markAt(laptopRec, /Submitting the paid claim again/);
const rejected = markAt(laptopRec, /Rejected by the contract/);
window_('L', 'insurer', insurerSees - 0.2, noReject + 1.2, 3.45);
clip('M', 6, 0.85, 2.11, { speed: 0.42 });
card('N1', 2.4);
// The autoplay scrolls the hospital page until just after the payout, so the shot starts once it has settled.
window_('N2', 'hospital', paidOnTheSpot + 0.25, paidOnTheSpot + 2.55, 3.5);
window_('N3', 'insurer', insurerSees - 0.3, noReject + 2.0, 3.6);
window_('N4', 'tamper', replay - 0.7, Math.min(rejected + 2.4, laptopRec.duration - 0.05), 3.3);
card('N5', 5.6);

export const TOTAL_FRAMES = cursor;
export const DURATION = cursor / FPS;
const piece = (id) => PIECES.find((p) => p.id === id);

/** Film time of a moment in a raw clip, through whichever normal-speed piece kept it. */
export function filmOf(n, t) {
  const p = PIECES.find((x) => x.kind === 'clip' && x.n === n && x.speed === 1 && t >= x.a - 0.06 && t <= x.a + x.dur + 0.06);
  return p ? p.start + Math.min(Math.max(t - p.a, 0), p.dur) : null;
}
/** Film time of a moment in the phone recording. */
const phoneFilm = (r) => (r < jFrom ? I.start + r / K : J.start + (r - jFrom) / K);
const end = (id) => piece(id).start + piece(id).dur;

// ---------- Subtitles: raw clip, start, end, English, Hindi (as spoken) ----------
const LINES = [
  [1, 1.88, 3.14, "Oh, you're back again.", 'अरे आप फिर आ गए।'],
  [1, 3.16, 3.9, 'Hello, sir.', 'Hello sir।'],
  [1, 4.04, 4.7, 'Yes?', 'हां।'],
  [1, 4.82, 7.7, 'So... back then, I had cancer.', 'तो मेरा वो उस समय cancer हुआ था।'],
  [1, 9.16, 11.55, 'I came to you to file my insurance claim.', 'हम आपके साथ वो insurance claim करने के लिए आया था।'],
  [1, 11.58, 12.0, 'I see.', 'अच्छा।'],
  [1, 12.0, 14.92, 'You told me to bring more documents, so I did.', 'आपने बोला documents और लेकर आना, तो लेकर आया।'],
  [1, 14.94, 16.2, 'What did you bring?', 'क्या लेकर आए हो?'],
  [1, 16.32, 17.45, 'My Aadhaar card.', 'Aadhar card लेकर आया हूँ।'],
  [1, 17.62, 18.68, 'The prescription.', 'Prescription लेकर आया हूँ।'],
  [1, 18.7, 20.0, 'Fine, but you brought those last time.', 'ठीक है, ये तो पहले भी था।'],
  [1, 20.1, 21.42, 'I asked for more documents.', 'मैंने और भी documents मंगाए थे।'],
  [1, 21.46, 24.7, "Yes, the doctor's certificate. I brought that too, sir.", 'हां doctor का certificate वो, वो भी लेकर आया हूँ sir।'],
  [1, 25.22, 25.95, 'You brought that too?', 'वो भी लेकर आए हो?'],
  [1, 26.1, 26.4, 'Yes.', 'हां।'],
  [1, 27.1, 28.85, 'Did you bring your Class 12 mark sheet?', 'बारवी की mark sheet लाई है अपनी?'],
  [1, 29.0, 29.42, 'Why would you need that?', 'क्यों चाहिए?'],
  [1, 29.44, 29.98, 'PAN card?', 'पैन कार्ड?'],
  [1, 32.34, 34.5, "Sir, the hospital's policy doesn't...", 'Sir वो hospital का policy नहीं ले-'],
  [1, 34.56, 36.9, "I've t-told you. You don't understand.", 'बो-बो-बोला है मैंने आपको नहीं पता'],
  [1, 36.92, 40.4, "A claim doesn't just come through at the hospital like that.", 'और hospital में ऐसे नहीं मिल जाता है insurance claim.'],
  [1, 40.96, 44.1, 'What am I supposed to do about that, sir? You tell me.', 'मैं उसका क्या करूं sir? मैं उसका क्या करूं, आप बताओ।'],
  [1, 44.22, 46.5, "Look at it from my side. It's not that we don't want to pay.", 'आप मेरी तो ये देखो, ऐसा तो है नहीं हमें देना नहीं।'],
  [1, 46.54, 48.66, "Sir, I've been coming here for three years.", 'Sir आप तीन साल से यह आ रहा था।'],
  [2, 6.34, 8.4, "It doesn't work like that, sir.", 'नहीं होता सर ऐसे नहीं होता।'],
  [2, 8.98, 9.95, 'Just drop it. Drop it.', 'छोड़ो यार अब छोड़ो'],
  [2, 10.5, 10.98, 'Get out of here.', 'चलो यहां से।'],
  [2, 10.98, 12.62, 'Sir, my insurance claim...', 'सर मैंने insurance claim।'],
  [2, 12.66, 13.3, 'No!', 'नहीं!'],
  [2, 15.3, 16.0, 'Out.', 'बाहर।'],
  [2, 16.74, 19.3, "Don't come back until you bring every document.", 'जब तक सारे documents नहीं लाओ आपको आना नहीं है।'],
  [3, 1.35, 2.2, 'Hey.', 'अरे'],
  [3, 2.5, 4.3, 'Hey, mister, what happened to you?', 'अरे जनाब ये क्या हो गया आपको?'],
  [3, 4.46, 6.55, 'The insurance people are harassing me.', 'Insurance वाले परेशान कर रहे हैं मुझे।'],
  [3, 6.7, 8.7, 'Forget them, man. Here, take this.', 'अरे ये छोड़ दो यार, ये पकड़ो।'],
  [3, 9.28, 9.8, 'Oh!', 'ओह!'],
  [6, 1.14, 2.75, 'Hey, how did this payment go through?', 'अरे ये payment कैसे हो गया?'],
  [6, 4.18, 5.5, "Wait, this is that guy's!", 'अरे ये तो ये भैया का है।'],
  [6, 6.44, 8.2, 'Who settled his claim?', 'इनका claim किसने कर दिया?'],
];
export const CUES = LINES.map(([n, a, b, en, hi]) => {
  const start = filmOf(n, a);
  const stop = filmOf(n, b);
  if (start == null || stop == null) throw new Error(`Subtitle outside the cut: clip ${n} ${a}-${b} "${en}"`);
  return { start, end: stop, en, hi };
});

// ---------- Graphics (overlay.html draws these) ----------
const doorShut = filmOf(2, 20.3);
const tapShow = phoneFilm(markAt(phoneRec, /^qr$/) - 0.65);
const tapDone = phoneFilm(markAt(phoneRec, /^qr$/) + 2.62);
const tapConsent = phoneFilm(markAt(phoneRec, /^consented$/) - 0.3);
const tapTrail = phoneFilm(markAt(phoneRec, /^trail$/) - 0.65);
const paidAt = phoneFilm(PHONE_PAID);
const consentAt = phoneFilm(markAt(phoneRec, /^consent$/));
const trailAt = phoneFilm(markAt(phoneRec, /^trail$/));

export const GRAPHICS = [
  { type: 'title', in: 0, out: piece('title').dur },
  // The zkClaim mark as a corner watermark, from the first shot until the logo card takes over.
  { type: 'mark', in: piece('A').start, out: piece('N1').start, x: 1748, y: 978, w: 140 },
  { type: 'sticker', in: piece('A').start + 0.25, out: piece('A').start + 4.3, x: 64, y: 56, rot: -2, tone: 'paper', lines: ['Kestrel Mutual', 'Claims office'] },
  { type: 'sticker', in: filmOf(1, 1.95), out: filmOf(1, 4.9), x: 430, y: 560, rot: -3, tone: 'mustard', lines: ['Mr. Verma', 'Claims officer'] },
  { type: 'sticker', in: filmOf(1, 3.2), out: filmOf(1, 7.6), x: 1590, y: 300, rot: 3, tone: 'sky', lines: ['Rohan Iyer', 'Patient'] },
  {
    type: 'docs',
    in: filmOf(1, 16.15),
    out: end('E') - 0.05,
    x: 1452,
    y: 56,
    items: [
      { at: filmOf(1, 16.32), text: 'Aadhaar card', ok: true },
      { at: filmOf(1, 17.62), text: 'Prescription', ok: true },
      { at: filmOf(1, 21.72), text: "Doctor's certificate", ok: true },
      { at: filmOf(1, 27.5), text: 'Class 12 mark sheet', ok: false },
      { at: filmOf(1, 29.44), text: 'PAN card', ok: false },
    ],
  },
  { type: 'stamp', in: doorShut + 0.2, out: end('F'), x: 960, y: 470, rot: -8, tone: 'tomato', size: 128, text: 'Claim pending', sub: '3 years and counting' },
  { type: 'sticker', in: piece('H').start + 0.45, out: end('H'), x: 80, y: 860, rot: -2, tone: 'mustard', lines: ['His Kestrel Mutual policy card', 'Sealed to his phone. Only his key opens it.'] },
  { type: 'phone', in: I.start, out: end('I'), ...GEO.phoneSmall },
  {
    type: 'steps',
    in: I.start + 0.15,
    out: end('I'),
    x: 70,
    y: 250,
    items: [
      { at: I.start + 0.15, n: '01', text: 'Shows his card', sub: 'Terms on the QR, not his history' },
      { at: consentAt - 0.4, n: '02', text: 'Says yes to this bill only', sub: 'His diagnosis never leaves the phone' },
      { at: paidAt - 0.6, n: '03', text: 'The hospital proves it', sub: 'The contract pays. Nobody reads a file.' },
    ],
  },
  { type: 'phone', in: J.start, out: end('J'), ...GEO.phoneBig },
  { type: 'zero', in: trailAt + 0.35, out: end('J'), x: 1080, y: 250, label: 'Records seen by the insurer', value: '0' },
  { type: 'window', in: piece('L').start, out: end('L'), ...GEO.insurer, label: "On Mr. Verma's screen" },
  { type: 'sticker', in: piece('M').start + 0.05, out: end('M'), x: 64, y: 56, rot: -2, tone: 'tomato', lines: ['Replay', '0.4× speed'] },
  { type: 'stamp', in: piece('M').start + 0.55, out: end('M'), x: 1270, y: 420, rot: -7, tone: 'cobalt', size: 150, text: 'Paid', sub: 'No documents · No denial' },
  { type: 'logo', in: piece('N1').start, out: end('N1') },
  { type: 'window', in: piece('N2').start, out: end('N2'), ...GEO.hospital, label: 'One proof. Eight checks. Paid on the spot.' },
  { type: 'window', in: piece('N3').start, out: end('N3'), ...GEO.insurer, label: 'The insurer sees a payment, not a patient.' },
  { type: 'window', in: piece('N4').start, out: end('N4'), ...GEO.tamper, label: 'Replay a paid claim? Rejected by the contract.' },
  { type: 'end', in: piece('N5').start, out: end('N5') },
  ...CUES.map((c) => ({ type: 'sub', in: c.start, out: c.end, text: c.en })),
];

// ---------- Sound (build.mjs mixes these over the dialogue) ----------
// file in work/sfx, film time, gain in dB; beds loop and fade.
export const BEDS = [
  { file: 'clock', from: 0.3, to: doorShut - 0.02, gain: 2, fadeIn: 1.2, fadeOut: 0.05 },
  { file: 'pad', from: piece('H').start - 0.2, to: end('J'), gain: -17, fadeIn: 2.0, fadeOut: 0.6 },
  { file: 'outro', from: piece('M').start, to: DURATION, gain: -13, fadeIn: 0.3, fadeOut: 1.6 },
];
export const SFX = [
  ...GRAPHICS.find((g) => g.type === 'docs').items.map((it) => ({ file: it.ok ? 'pop' : 'sting', at: it.at - 0.02, gain: it.ok ? -10 : -12 })),
  { file: 'door', at: doorShut - 0.06, gain: -2 },
  { file: 'stamp', at: doorShut + 0.2, gain: -3 },
  { file: 'riser', at: piece('H').start - 2.6, gain: -14 },
  { file: 'whoosh', at: piece('H').start - 0.15, gain: -8 },
  { file: 'tap', at: tapShow, gain: 6 },
  { file: 'tap', at: tapDone, gain: 6 },
  { file: 'tap', at: tapConsent, gain: 6 },
  { file: 'hit', at: paidAt - 0.08, gain: -11 },
  { file: 'success', at: paidAt, gain: -9 },
  { file: 'tap', at: tapTrail, gain: 6 },
  { file: 'ping', at: piece('K').start + 0.05, gain: -2 },
  { file: 'whoosh', at: piece('L').start - 0.1, gain: -12 },
  { file: 'stamp', at: piece('M').start + 0.55, gain: -3 },
  { file: 'hit', at: piece('M').start + 0.5, gain: -12 },
  { file: 'whoosh', at: piece('N1').start - 0.15, gain: -9 },
  { file: 'whoosh', at: piece('N2').start - 0.1, gain: -14 },
  { file: 'whoosh', at: piece('N3').start - 0.1, gain: -14 },
  { file: 'whoosh', at: piece('N4').start - 0.1, gain: -14 },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const p of PIECES) console.log(`${p.id.padEnd(6)} ${p.kind.padEnd(10)} ${p.start.toFixed(2).padStart(7)} +${p.dur.toFixed(2)}`);
  console.log(`total ${DURATION.toFixed(2)} s, ${TOTAL_FRAMES} frames; ${CUES.length} subtitles; K=${K.toFixed(3)}; door ${doorShut.toFixed(2)}; paid ${paidAt.toFixed(2)}`);
}
