// Builds THE CLAIM from timeline.mjs. Stages run in order; name some to run only those:
//   node videos/edit/src/build.mjs                 everything
//   node videos/edit/src/build.mjs overlay final   just the graphics and the final render
// Raw clips in videos/ are never modified. Output: videos/edit/out/the-claim-v<V>.mp4 + .en.srt + .hi.srt
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, linkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { spans, VERMA } from './speakers.mjs';

// The film by default; TIMELINE=./demo-timeline.mjs builds the recorded product demo with the same stages.
const T = await import(process.env.TIMELINE ?? './timeline.mjs');
const { BEDS, CUES, DURATION, EDIT, FPS, GEO, GRAPHICS, H, PIECES, RAW, SFX, TOTAL_FRAMES, W, WORK } = T;

const V = process.env.V ?? '1';
const OUT = path.join(EDIT, 'out');
const NAME = T.OUT_NAME ?? 'the-claim';
const w = (...x) => path.join(WORK, ...x);
const sfx = (file) => path.join(T.SFX_DIR ?? w('sfx'), file);
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args.map(String)], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
/** Runs ffmpeg for its report (loudness, analysis), which it prints on stderr. */
const ffText = (...args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args.map(String)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-800)}`);
  return r.stderr + r.stdout;
};
const GRADE = 'eq=contrast=1.06:saturation=1.07:gamma=0.98';
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', FPS];
// Pads a short source with its last frame so every segment has exactly its planned frame count (sync depends on it).
const HOLD = 'tpad=stop_mode=clone:stop_duration=2';
const sec = (x) => x.toFixed(4);
const loop = (file) => ['-loop', 1, '-framerate', FPS, '-i', file];

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.goto(new URL('./overlay.html', import.meta.url).href);
    await page.evaluate(async () => {
      await Promise.all(['900 100px Archivo', '600 40px Archivo', '400 40px VT323'].map((f) => document.fonts.load(f)));
      await document.fonts.ready;
    });
    if (!(await page.evaluate(() => document.fonts.check('900 100px Archivo')))) throw new Error('Archivo did not load (needs network for Google Fonts)');
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const stages = {
  /** The ink-and-grain background the recorded screens sit on. */
  async bg() {
    await withPage(async (page) => {
      await page.evaluate(() => (document.body.innerHTML = '<div class="el full inkbg" style="display:block"></div>'));
      await page.screenshot({ path: w('bg.png') });
    });
  },

  /** Rounded-corner alpha masks for every composited screen. */
  masks() {
    mkdirSync(w('masks'), { recursive: true });
    for (const [name, g] of Object.entries(GEO)) {
      const cx = (g.w - 1) / 2, cy = (g.h - 1) / 2;
      const expr = `255*clip(${g.r}+0.5-hypot(max(0,abs(X-${cx})-${cx - g.r}),max(0,abs(Y-${cy})-${cy - g.r})),0,1)`;
      ff('-f', 'lavfi', '-i', `color=c=black:s=${g.w}x${g.h}`, '-vf', `format=gray,geq=lum='${expr}'`, '-frames:v', 1, w('masks', `${name}.png`));
    }
  },

  /** One video file per piece, then the list the final render reads them through. */
  base() {
    rmSync(w('seg'), { recursive: true, force: true });
    mkdirSync(w('seg'), { recursive: true });
    const list = ['ffconcat version 1.0'];
    PIECES.forEach((p, i) => {
      const out = w('seg', `${String(i).padStart(2, '0')}_${p.id}.mp4`);
      const n = ['-frames:v', p.frames];
      if (p.kind === 'card') {
        ff('-f', 'lavfi', '-i', `color=c=0x1d1c1a:s=${W}x${H}:r=${FPS}`, ...n, ...ENC, out);
      } else if (p.kind === 'clip') {
        const vf = [
          p.crop && `crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y}`,
          `scale=${W}:${H}:flags=lanczos`,
          'setsar=1',
          GRADE,
          `setpts=(PTS-STARTPTS)/${p.speed}`,
          `fps=${FPS}`,
          HOLD,
        ].filter(Boolean);
        ff('-ss', sec(p.a), '-t', sec(p.dur * p.speed + 0.4), '-i', path.join(RAW, `${p.n}.mp4`), '-vf', vf.join(','), '-an', ...n, ...ENC, out);
      } else if (p.kind === 'phoneWall') {
        const g = GEO.phoneSmall;
        const [a, b] = p.wall;
        const fc = [
          `[0:v]split=2[w0][w1]`,
          `[w0]trim=start=${a.a}:end=${a.b},setpts=(PTS-STARTPTS)/${a.speed}[a]`,
          `[w1]trim=start=${b.a}:end=${b.b},setpts=(PTS-STARTPTS)/${b.speed}[b]`,
          `[a][b]concat=n=2:v=1:a=0,scale=${W}:${H}:flags=lanczos,setsar=1,${GRADE},fps=${FPS},${HOLD}[bg]`,
          `[1:v]trim=start=0:end=${sec(p.dur * p.k + 0.3)},setpts=(PTS-STARTPTS)/${p.k},fps=${FPS},scale=${g.w}:${g.h}:flags=lanczos,format=rgba[s]`,
          `[2:v]format=gray[m]`,
          `[s][m]alphamerge[sa]`,
          `[bg][sa]overlay=${g.x}:${g.y}:format=auto[v]`,
        ];
        ff('-i', path.join(RAW, '5.mp4'), '-i', w('rec', 'phone.mp4'), ...loop(w('masks', 'phoneSmall.png')), '-filter_complex', fc.join(';'), '-map', '[v]', ...n, ...ENC, out);
      } else if (p.kind === 'duo') {
        // Two recordings of the same moment side by side on the ink background: the app and the 1AM wallet.
        const fc = [];
        const inputs = [...loop(w('bg.png'))];
        p.panes.forEach((pane, i) => {
          inputs.push('-i', pane.src, ...loop(w('masks', `${pane.geo}.png`)));
          const g = GEO[pane.geo];
          fc.push(`[${2 * i + 1}:v]trim=start=${sec(p.from)}:end=${sec(p.from + p.dur * p.speed + 0.3)},setpts=(PTS-STARTPTS)/${p.speed},fps=${FPS},${HOLD},scale=${g.w}:${g.h}:flags=lanczos,format=rgba[s${i}]`);
          fc.push(`[${2 * i + 2}:v]format=gray[m${i}]`, `[s${i}][m${i}]alphamerge[a${i}]`);
        });
        fc.push(`[0:v][a0]overlay=${GEO[p.panes[0].geo].x}:${GEO[p.panes[0].geo].y}:format=auto[t]`, `[t][a1]overlay=${GEO[p.panes[1].geo].x}:${GEO[p.panes[1].geo].y}:format=auto[v]`);
        ff(...inputs, '-filter_complex', fc.join(';'), '-map', '[v]', ...n, ...ENC, out);
      } else if (p.kind === 'screen') {
        // A full-screen recording (already 1920x1080), trimmed and retimed.
        const vf = `setpts=(PTS-STARTPTS)/${p.speed},fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,${HOLD}`;
        ff('-ss', sec(p.from), '-t', sec(p.dur * p.speed + 0.4), '-i', p.src, '-vf', vf, '-an', ...n, ...ENC, out);
      } else {
        // A recorded screen on the ink background: the phone close-up or a laptop window.
        const g = p.kind === 'phoneBig' ? GEO.phoneBig : GEO[p.view];
        const rate = p.kind === 'phoneBig' ? p.k : p.speed;
        const src = p.src ?? (p.kind === 'phoneBig' ? w('rec', 'phone.mp4') : w('rec', 'laptop.mp4'));
        const crop = g.crop ? `crop=${g.crop.w}:${g.crop.h}:${g.crop.x}:${g.crop.y},` : '';
        const fc = [
          `[1:v]trim=start=${sec(p.from)}:end=${sec(p.from + p.dur * rate + 0.3)},setpts=(PTS-STARTPTS)/${rate},fps=${FPS},${HOLD},${crop}scale=${g.w}:${g.h}:flags=lanczos,format=rgba[s]`,
          `[2:v]format=gray[m]`,
          `[s][m]alphamerge[sa]`,
          `[0:v][sa]overlay=${g.x}:${g.y}:format=auto[v]`,
        ];
        ff(...loop(w('bg.png')), '-i', src, ...loop(w('masks', `${p.kind === 'phoneBig' ? 'phoneBig' : p.view}.png`)), '-filter_complex', fc.join(';'), '-map', '[v]', ...n, ...ENC, out);
      }
      list.push(`file '${out.replace(/\\/g, '/')}'`);
      console.log(`  ${p.id.padEnd(5)} ${p.frames} frames`);
    });
    writeFileSync(w('seg', 'list.ffconcat'), list.join('\n') + '\n');
  },

  /**
   * Each dialogue clip's own recorded sound, cleaned: repair the clipped shouts, gentle denoise, every speaker
   * levelled to the same loudness (Mr. Verma was 3-5 dB hotter than Rohan and hit full scale), then de-mud,
   * presence, de-ess, compress and limit. Writes work/audio/clean<n>.wav, in sync with the clip's picture.
   */
  clean() {
    const TARGET = -18;
    const measure = (n, list) => {
      const sel = list.map((s) => `between(t,${s.start.toFixed(2)},${(s.end + 0.05).toFixed(2)})`).join('+');
      const s = ffText('-i', path.join(RAW, `${n}.mp4`), '-vn', '-af', `aselect='${sel}',asetpts=N/SR/TB,ebur128`, '-f', 'null', '-');
      return Number(/I:\s+(-?[\d.]+) LUFS/.exec(s.split('Summary:').pop())[1]);
    };
    for (const n of new Set(PIECES.filter((p) => p.audio).map((p) => p.n))) {
      const sp = spans(n);
      const gain = {};
      for (const who of new Set(sp.map((s) => s.speaker))) gain[who] = Math.max(-8, Math.min(8, TARGET - measure(n, sp.filter((s) => s.speaker === who))));
      // Each spoken span gets its speaker's gain, ramping in and out over the silence around it (never over a word).
      const terms = sp.map((s, i) => {
        const r1 = Math.max(0.01, Math.min(0.08, i ? (s.start - sp[i - 1].end) / 2 : 0.08));
        const r2 = Math.max(0.01, Math.min(0.08, i + 1 < sp.length ? (sp[i + 1].start - s.end) / 2 : 0.08));
        return `${gain[s.speaker].toFixed(2)}*clip((t-${(s.start - r1).toFixed(3)})/${r1.toFixed(3)},0,1)*clip((${(s.end + r2).toFixed(3)}-t)/${r2.toFixed(3)},0,1)`;
      });
      const level = terms.length ? `asetnsamples=n=64,volume='pow(10,(${terms.join('+')})/20)':eval=frame` : 'anull';
      const chain = [
        'aresample=48000',
        'adeclip',
        'highpass=f=80',
        'lowpass=f=14000',
        'afftdn=nr=10:nf=-45:tn=1',
        level,
        'equalizer=f=200:t=q:w=1:g=-2',
        'equalizer=f=3500:t=q:w=1.2:g=2.5',
        'deesser=i=0.25',
        'acompressor=threshold=-24dB:ratio=3:attack=5:release=120:makeup=1',
        'alimiter=limit=0.89:attack=3:release=60',
      ];
      ff('-i', path.join(RAW, `${n}.mp4`), '-vn', '-af', chain.join(','), '-ac', 2, '-c:a', 'pcm_s16le', w('audio', `clean${n}.wav`));
      console.log(`  clip ${n} speaker gains (dB): ${Object.entries(gain).map(([k, v]) => `${k === VERMA[n] ? 'Verma' : k} ${v.toFixed(1)}`).join(', ')}`);
    }
  },

  /**
   * The kept dialogue on the film timeline. Every cut is a short crossfade: each piece borrows up to 0.18 s of its
   * own room tone on either side and fades only within that room tone, so no word is ever faded or clipped.
   */
  dialogue() {
    if (!PIECES.some((p) => p.audio)) {
      ff('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', sec(DURATION), '-c:a', 'pcm_s16le', w('dialogue.wav'));
      return;
    }
    const inputs = [];
    const chains = [];
    PIECES.filter((p) => p.audio).forEach((p, i) => {
      const words = spans(p.n, 0);
      const end = p.a + p.dur;
      const before = Math.max(0, ...words.filter((x) => x.end <= p.a + 0.01).map((x) => x.end));
      const after = Math.min(1e9, ...words.filter((x) => x.start >= end - 0.01).map((x) => x.start));
      const first = Math.min(end, ...words.filter((x) => x.start >= p.a - 0.01).map((x) => x.start));
      const last = Math.max(p.a, ...words.filter((x) => x.end <= end + 0.01).map((x) => x.end));
      const pre = Math.max(0, Math.min(0.18, p.a - before - 0.03, p.start));
      const post = Math.max(0, Math.min(0.18, after - end - 0.03));
      const fadeIn = Math.max(0.02, Math.min(0.3, pre + first - p.a - 0.02));
      const fadeOut = Math.max(0.02, Math.min(0.3, post + end - last - 0.02));
      const len = p.dur + pre + post;
      inputs.push('-i', w('audio', `clean${p.n}.wav`));
      chains.push(
        `[${i}:a]atrim=start=${sec(p.a - pre)}:end=${sec(end + post)},asetpts=PTS-STARTPTS,afade=t=in:d=${sec(fadeIn)},afade=t=out:st=${sec(len - fadeOut)}:d=${sec(fadeOut)},adelay=${Math.round((p.start - pre) * 1000)}:all=1[v${i}]`,
      );
    });
    const n = inputs.length / 2;
    chains.push(`${Array.from({ length: n }, (_, i) => `[v${i}]`).join('')}amix=inputs=${n}:normalize=0:duration=longest,apad,atrim=0:${sec(DURATION)}[d]`);
    ff(...inputs, '-filter_complex', chains.join(';'), '-map', '[d]', '-ar', 48000, '-c:a', 'pcm_s16le', w('dialogue.wav'));
  },

  /** Graphics and subtitles as transparent frames; identical frames are hard links to the last drawn one. */
  async overlay() {
    rmSync(w('ov'), { recursive: true, force: true });
    mkdirSync(w('ov'), { recursive: true });
    let drawn = 0;
    await withPage(async (page) => {
      await page.evaluate((graphics) => window.setup({ graphics }), GRAPHICS);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20_000 });
      let lastKey = null;
      let lastFile = null;
      let links = 0;
      for (let f = 0; f < TOTAL_FRAMES; f++) {
        const key = await page.evaluate((t) => window.renderAt(t), f / FPS);
        const file = w('ov', `${String(f).padStart(5, '0')}.png`);
        if (key === lastKey && links < 1000) (linkSync(lastFile, file), links++);
        else if (key === lastKey) (copyFileSync(lastFile, file), (lastFile = file), (links = 0)); // NTFS allows 1023 links per file
        else {
          links = 0;
          await page.screenshot({ path: file, omitBackground: true });
          lastKey = key;
          lastFile = file;
          drawn++;
        }
        if (f % 600 === 0) console.log(`  frame ${f}/${TOTAL_FRAMES}`);
      }
    });
    console.log(`  ${drawn} frames drawn, ${TOTAL_FRAMES - drawn} reused`);
  },

  /** Dialogue + beds + effects, then loudness to -14 LUFS (YouTube), true peak -1 dB. */
  mix() {
    // Input 0 is the dialogue; each bed or effect is the next input, so chain k reads input k + 1.
    const inputs = ['-i', w('dialogue.wav')];
    const chains = [];
    const labels = ['[0:a]'];
    BEDS.forEach((b, i) => {
      inputs.push('-stream_loop', -1, '-i', sfx(`${b.file}.mp3`));
      const len = b.to - b.from;
      chains.push(`[${chains.length + 1}:a]atrim=0:${sec(len)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${b.gain}dB,afade=t=in:d=${b.fadeIn},afade=t=out:st=${sec(len - b.fadeOut)}:d=${b.fadeOut},adelay=${Math.round(b.from * 1000)}:all=1[b${i}]`);
      labels.push(`[b${i}]`);
    });
    SFX.forEach((s, i) => {
      inputs.push('-i', sfx(`${s.file}.mp3`));
      chains.push(`[${chains.length + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${s.gain}dB,adelay=${Math.round(Math.max(0, s.at) * 1000)}:all=1[s${i}]`);
      labels.push(`[s${i}]`);
    });
    const pre = `${chains.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad,atrim=0:${sec(DURATION)}`;
    const measure = ffText(...inputs, '-filter_complex', `${pre},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[o]`, '-map', '[o]', '-f', 'null', '-');
    const m = JSON.parse(measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1));
    const ln = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    ff(...inputs, '-filter_complex', `${pre},${ln},aresample=48000[o]`, '-map', '[o]', '-c:a', 'pcm_s16le', w('mix.wav'));
    console.log(`  mix: measured ${m.input_i} LUFS -> -14`);
  },

  final() {
    mkdirSync(OUT, { recursive: true });
    const out = path.join(OUT, `${NAME}-v${V}.mp4`);
    ff(
      '-f', 'concat', '-safe', 0, '-i', w('seg', 'list.ffconcat'),
      '-framerate', FPS, '-i', w('ov', '%05d.png'),
      '-i', w('mix.wav'),
      '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,noise=alls=3:allf=t,format=yuv420p[v]',
      '-map', '[v]', '-map', '2:a', '-frames:v', TOTAL_FRAMES,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', 17, '-pix_fmt', 'yuv420p', '-r', FPS,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
    );
    console.log(`  ${out}`);
  },

  srt() {
    if (!CUES.length) return;
    mkdirSync(OUT, { recursive: true });
    const ts = (s) => {
      const ms = Math.round(s * 1000);
      const p2 = (n, l = 2) => String(n).padStart(l, '0');
      return `${p2(Math.floor(ms / 3_600_000))}:${p2(Math.floor(ms / 60_000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${p2(ms % 1000, 3)}`;
    };
    for (const lang of ['en', 'hi']) {
      const body = CUES.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c[lang]}\n`).join('\n');
      writeFileSync(path.join(OUT, `${NAME}-v${V}.${lang}.srt`), body, 'utf8');
    }
    console.log(`  ${CUES.length} cues in English and Hindi`);
  },
};

const wanted = process.argv.slice(2);
for (const [name, run] of Object.entries(stages)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const t = Date.now();
  console.log(`${name}…`);
  await run();
  console.log(`${name} done (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
