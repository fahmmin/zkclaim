// Makes every logo asset from ui/src/zk/assets/zkclaim-logo-source.webp (the mark on a navy background):
//   videos/edit/work/logo.png       the mark on transparency, glow kept (film watermark and end cards)
//   ui/src/zk/assets/logo-mark.png  the same, smaller, for the site header
//   ui/src/zk/assets/icon-*.png     square app icons on the navy background (favicon, Apple touch, 192/512)
// The mark is un-blended from the background: alpha is how far each pixel rises above the navy, per channel.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(ROOT, 'ui/src/zk/assets/zkclaim-logo-source.webp');
const ASSETS = path.join(ROOT, 'ui/src/zk/assets');
const WORK = path.join(ROOT, 'videos/edit/work');
mkdirSync(WORK, { recursive: true });

const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', SRC], { encoding: 'utf8' }).trim().split(',').map(Number);
const [W, H] = probe;
const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
const at = (x, y, c) => rgb[(y * W + x) * 3 + c];

// Background: the median of each corner region (the image has a soft vignette, so take the brightest corner as the floor).
const corner = (x0, y0) => {
  const v = [[], [], []];
  for (let y = y0; y < y0 + 60; y++) for (let x = x0; x < x0 + 60; x++) for (let c = 0; c < 3; c++) v[c].push(at(x, y, c));
  return v.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
};
const corners = [corner(10, 10), corner(W - 70, 10), corner(10, H - 70), corner(W - 70, H - 70), corner(W / 2 - 30, 40), corner(W / 2 - 30, H - 100)];
const B = [0, 1, 2].map((c) => Math.max(...corners.map((k) => k[c])) + 3);
console.log('background', B, 'corners', JSON.stringify(corners));

// Un-blend.
const rgba = Buffer.alloc(W * H * 4);
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const C = [at(x, y, 0), at(x, y, 1), at(x, y, 2)];
    const a = Math.max(0, ...C.map((v, c) => (v - B[c]) / (255 - B[c])));
    const alpha = Math.min(1, Math.max(0, (a - 0.05) / 0.95));
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = a > 0 ? Math.min(255, Math.round(B[c] + (C[c] - B[c]) / a)) : 0;
    rgba[i + 3] = Math.round(alpha * 255);
    if (alpha > 0.06) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  }
const pad = 16;
[x0, y0] = [Math.max(0, x0 - pad), Math.max(0, y0 - pad)];
[x1, y1] = [Math.min(W - 1, x1 + pad), Math.min(H - 1, y1 + pad)];
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
console.log(`mark bounds ${x0},${y0} ${cw}x${ch}`);

const raw = path.join(WORK, 'logo.rgba');
writeFileSync(raw, rgba);
const rawIn = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', raw];
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
ff(...rawIn, '-vf', `crop=${cw}:${ch}:${x0}:${y0}`, '-frames:v', 1, path.join(WORK, 'logo.png'));
ff(...rawIn, '-vf', `crop=${cw}:${ch}:${x0}:${y0},scale=-1:96:flags=lanczos`, '-frames:v', 1, path.join(ASSETS, 'logo-mark.png'));
rmSync(raw);

// App icons: a square around the mark on its own navy background, the way icons are meant to sit.
const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
const side = Math.round(Math.min(W, H, Math.max(cw, ch) * 1.18) / 2) * 2;
const sq = `crop=${side}:${side}:${Math.round(cx - side / 2)}:${Math.round(cy - side / 2)}`;
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['favicon-16.png', 16]])
  ff('-i', SRC, '-vf', `${sq},scale=${size}:${size}:flags=lanczos`, '-frames:v', 1, path.join(ASSETS, name));
console.log(`icons: square ${side}px around (${cx}, ${cy})`);
