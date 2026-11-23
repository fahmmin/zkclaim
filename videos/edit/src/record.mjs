// Screen recordings of zkClaim's hosted demo for the film "THE CLAIM".
//   phone:  Rohan's patient app at 390x844 (2x pixels): card, QR, consent, the payment landing live, the audit trail.
//   laptop: the autoplay story at 1440x900, from the hospital's proof through the insurer view and the Tamper Lab.
// Frames come from Chromium's screencast (sent only when the screen changes), keep their own timestamps, and are
// encoded at a constant 30 fps. Stretches where the camera is off (setup) are left out. Writes <which>.mp4 + .json.
//   node videos/edit/src/record.mjs phone videos/edit/work/rec
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const URL = process.env.DAPP_URL ?? 'https://zkclaim.vercel.app/';
const [which = 'phone', outDir = 'videos/edit/work/rec'] = process.argv.slice(2);
// desk: 1600x900 CSS at 1.2x = exactly 1920x1080 frames, for full-screen shots in the recorded demo.
const PHONE = { width: 390, height: 844, dpr: 2, mobile: true };
const DESK = { width: 1600, height: 900, dpr: 1.2, mobile: false };
const SIZE = { phone: PHONE, withdraw: PHONE, laptop: { width: 1440, height: 900, dpr: 2, mobile: false }, story: DESK, tamper: DESK, receipt: DESK }[which];
if (!SIZE) throw new Error('usage: node record.mjs phone|laptop|story|tamper|receipt|withdraw <outDir>');
// A real Preprod settlement (claim A, 400 NIGHT), read from the chain through the site's own indexer proxy.
const RECEIPT_A =
  'verify.html#v=1&net=preprod&contract=1e8938d2a231357b02962058f15d1b236702564c8d98475d65e4f0020511e977&nullifier=730cdf5ac0362369fd86226e6bbc0eeaf82df81967a01f69b841a63ef0e61287&policy=cd834be2ecf2ec435bec914396d6f39d6b6490b9e72e70f10be310317f08ed26&amount=400000000&at=1795460759';
const framesDir = path.resolve(outDir, `${which}-frames`);
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: SIZE.width, height: SIZE.height },
  deviceScaleFactor: SIZE.dpr,
  isMobile: SIZE.mobile,
  hasTouch: SIZE.mobile,
});
// Taps show as a soft ink ripple, like a screen recorder's touch indicator.
await context.addInitScript(() => {
  addEventListener(
    'pointerdown',
    (e) => {
      const d = document.createElement('div');
      d.className = 'film-tap';
      d.style.left = `${e.clientX}px`;
      d.style.top = `${e.clientY}px`;
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 700);
    },
    true,
  );
  const style = document.createElement('style');
  style.textContent = `
    .film-tap { position: fixed; z-index: 99999; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%;
      background: rgb(29 28 26 / .2); border: 2px solid rgb(29 28 26 / .6); pointer-events: none; animation: film-tap .6s ease-out forwards; }
    @keyframes film-tap { from { transform: scale(.35); opacity: 1 } to { transform: scale(1.5); opacity: 0 } }
    html.film .democtl, html.film:not(.film-playbar) .playbar, html.film:not(.film-playbar) .play-end { opacity: 0 !important; pointer-events: none !important; }`;
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

// ---- Recorder ----
const cdp = await context.newCDPSession(page);
const frames = [];
let seq = 0;
let recording = false;
const save = (t, b64) => {
  const file = path.join(framesDir, `${String(++seq).padStart(6, '0')}.jpg`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  frames.push({ t, file });
};
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  if (recording) save(metadata.timestamp ?? now(), data);
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: SIZE.width * SIZE.dpr, maxHeight: SIZE.height * SIZE.dpr, everyNthFrame: 1 });

const segs = [];
const marks = [];
const mark = (name) => (marks.push({ name, t: now() }), console.log(`  mark: ${name}`));
/** Camera on. The screencast only sends changes, so the segment starts with a still of the screen as it is. */
async function roll({ playbar = false } = {}) {
  await page.evaluate((pb) => document.documentElement.classList.add('film', ...(pb ? ['film-playbar'] : [])), playbar);
  await sleep(120);
  const still = await page.screenshot({ type: 'jpeg', quality: 92 });
  const t = now();
  save(t, still.toString('base64'));
  segs.push({ start: t, end: 0 });
  recording = true;
}
async function cut() {
  recording = false;
  segs.at(-1).end = now();
  await page.evaluate(() => document.documentElement.classList.remove('film'));
}

function encode() {
  const lines = ['ffconcat version 1.0'];
  const outMarks = [];
  let offset = 0;
  for (const s of segs) {
    const fs = frames.filter((f) => f.t >= s.start && f.t <= s.end);
    fs.forEach((f, i) => {
      const next = i + 1 < fs.length ? fs[i + 1].t : s.end;
      lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    for (const m of marks) if (m.t >= s.start && m.t <= s.end) outMarks.push({ name: m.name, at: +(offset + m.t - s.start).toFixed(3) });
    offset += s.end - s.start;
  }
  lines.push(lines.at(-2)); // the concat demuxer drops the last frame's duration unless the file is repeated
  const list = path.resolve(outDir, `${which}.ffconcat`);
  writeFileSync(list, lines.join('\n') + '\n');
  const mp4 = path.resolve(outDir, `${which}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-crf', '12', '-preset', 'slow', '-pix_fmt', 'yuv420p', mp4]);
  writeFileSync(path.resolve(outDir, `${which}.json`), JSON.stringify({ duration: +offset.toFixed(3), frames: frames.length, marks: outMarks }, null, 2));
  console.log(`${mp4}: ${offset.toFixed(1)} s from ${frames.length} frames`);
}

// ---- Driving the app ----
async function controls(name) {
  await page.locator('.democtl .fab').click();
  await page.locator('.democtl .panel').getByRole('button', { name }).click();
}
async function tap(locator, before = 550, after = 650) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(before);
  await locator.click();
  await sleep(after);
}
/** A person's scroll, not a jump. */
async function glide(selector, wait = 1100) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), selector);
  await sleep(wait);
}
const textOf = (selector) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', selector);

/** The hospital settles the consented claim while the camera stays on the patient's phone (demo state lives in-page). */
const hospitalClaims = () =>
  page.evaluate(() => {
    const root = document.querySelector('.zk');
    const key = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
    for (let f = root[key]; f; f = f.return) {
      const svc = f.memoizedProps?.value;
      if (svc && typeof svc.snapshot === 'function' && typeof svc.submitClaim === 'function') {
        const r = svc.snapshot().records.find((x) => x.status === 'consented');
        if (!r) throw new Error('No consented claim to settle');
        void svc.submitClaim(r.id).catch((e) => console.error('claim failed', e));
        return r.id;
      }
    }
    throw new Error('zkClaim service not found');
  });

async function phone() {
  await controls('Reset everything');
  await sleep(1500);
  await controls('Seed the story');
  await page.waitForFunction(() => location.hash.startsWith('#/patient') && document.querySelector('.policy-card'), null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.toasts')?.children.length, null, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => scrollTo(0, 0));
  await sleep(600);

  await roll();
  mark('card');
  await sleep(1800);
  await tap(page.locator('.policy-card').getByRole('button', { name: 'Show to hospital' }));
  mark('qr');
  await page.locator('.qr-overlay').waitFor();
  await sleep(2300);
  await tap(page.locator('.qr-overlay').getByRole('button', { name: 'Done' }), 300, 500);
  await glide('.consent');
  mark('consent');
  await sleep(2800);
  await tap(page.locator('.consent').getByRole('button', { name: /^Consent to this claim/ }), 600, 300);
  mark('consented');
  await page.waitForFunction(() => !/Consent to this claim\?/.test(document.querySelector('.consent')?.textContent ?? ''), null, { timeout: 20_000 });
  await sleep(1600);
  mark('hospital proves');
  await hospitalClaims();
  await page.waitForFunction(() => /Paid/.test(document.querySelector('.consent')?.textContent ?? ''), null, { timeout: 90_000 });
  mark('paid');
  await sleep(3200);
  await tap(page.locator('.tabbar a[href="#/patient/trail"]'));
  mark('trail');
  await sleep(3000);
  await cut();
  console.log(`  consent card at the end: ${(await textOf('.consent')).slice(0, 120)}`);
}

async function laptop() {
  await controls('Reset everything');
  await sleep(1500);
  await controls('Play the story');
  let last = '';
  let rolling = false;
  for (const end = Date.now() + 240_000; Date.now() < end; ) {
    const s = await page.evaluate(() => ({
      title: document.querySelector('.playbar-title')?.textContent ?? '',
      doing: document.querySelector('.playbar-doing')?.textContent ?? '',
      failed: !!document.querySelector('.playbar.failed'),
    }));
    if (s.failed) throw new Error(`Autoplay failed: ${s.doing}`);
    if (!rolling && /Hospital proves the claim/.test(s.title)) {
      await roll();
      rolling = true;
    }
    const now_ = `${s.title} | ${s.doing}`;
    if (rolling && now_ !== last) mark(now_);
    last = now_;
    if (rolling && /Rohan shares his record/.test(s.title)) break;
    await sleep(120);
  }
  if (!rolling) throw new Error('The autoplay never reached the hospital proof');
  await cut();
  await page.keyboard.press('Escape');
}

/** The whole autoplay story with the app's own caption bar, through to its end card. */
async function story() {
  await controls('Reset everything');
  await sleep(1500);
  await controls('Play the story');
  await roll({ playbar: true });
  let last = '';
  for (const end = Date.now() + 300_000; Date.now() < end; ) {
    const s = await page.evaluate(() => ({
      title: document.querySelector('.playbar-title')?.textContent ?? '',
      failed: !!document.querySelector('.playbar.failed'),
      done: !!document.querySelector('.play-end'),
    }));
    if (s.failed) throw new Error('Autoplay failed');
    if (s.title && s.title !== last) mark((last = s.title));
    if (s.done) break;
    await sleep(150);
  }
  mark('end card');
  await sleep(4500);
  await cut();
}

/** Tamper Lab: every attack at once, each on its own copy of the contract. */
async function tamper() {
  await page.goto(URL + '#/tamper');
  await page.getByRole('button', { name: 'Run all attacks' }).waitFor();
  await sleep(800);
  await roll();
  mark('lab');
  await sleep(1400);
  await tap(page.getByRole('button', { name: 'Run all attacks' }), 300, 200);
  mark('run');
  await page.waitForFunction(() => /(\d+) of \1 rejected/i.test(document.body.innerText), null, { timeout: 120_000 });
  mark('all rejected');
  await sleep(1000);
  await page.mouse.wheel(0, 700);
  await sleep(2600);
  await cut();
}

/** The wallet-free receipt for a real Preprod payout: Matches, then one digit changed: Does not match. */
async function receipt() {
  await page.goto(process.env.RECEIPT_URL ?? URL + RECEIPT_A);
  await roll();
  mark('open');
  await page.getByText('Matches', { exact: true }).first().waitFor({ timeout: 60_000 });
  mark('matches');
  await sleep(3200);
  const amount = page.getByLabel(/Amount paid/);
  await amount.scrollIntoViewIfNeeded();
  await sleep(900);
  await amount.click({ clickCount: 3 });
  await sleep(300);
  await page.keyboard.type('500000000', { delay: 90 });
  mark('edited');
  await sleep(600);
  await tap(page.getByRole('button', { name: 'Check again' }), 300, 200);
  await page.getByText('Does not match', { exact: true }).first().waitFor({ timeout: 60_000 });
  mark('mismatch');
  await sleep(1200);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(3200);
  await cut();
}

/** The patient takes back permission on one of two unpaid bills. */
async function withdraw() {
  await controls('Reset everything');
  await sleep(1500);
  await controls('Seed two claims (withdraw demo)');
  await page.waitForFunction(() => location.hash.startsWith('#/patient') && document.querySelector('.consent'), null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.toasts')?.children.length, null, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.consent')?.scrollIntoView({ block: 'center' }));
  await sleep(700);
  await roll();
  mark('two bills');
  await sleep(2600);
  await tap(page.locator('.consent').getByRole('button', { name: 'Withdraw permission' }), 600, 200);
  mark('withdraw');
  await page.waitForFunction(() => /Permission withdrawn/.test(document.querySelector('.consent')?.textContent ?? ''), null, { timeout: 30_000 });
  mark('withdrawn');
  await sleep(3200);
  await cut();
}

try {
  await page.goto(URL + '#/');
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);
  await { phone, laptop, story, tamper, receipt, withdraw }[which]();
  encode();
} finally {
  await browser.close();
}
