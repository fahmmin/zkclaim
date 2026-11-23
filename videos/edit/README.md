# THE CLAIM: the edit

The film is built entirely by scripts, so after any note it can be re-rendered in a few minutes. The raw clips in `videos/*.mp4` are never modified.

| File | What it is |
|---|---|
| `transcript.md` | Hindi transcript (ElevenLabs Scribe) with the English subtitle for every line |
| `src/timeline.mjs` | **The edit itself**: every cut (raw-clip seconds), subtitle, graphic and sound cue, in film time |
| `src/overlay.html` | Graphics and subtitles in the app's design system, drawn frame by frame |
| `src/record.mjs` | Screen recordings of the hosted demo: `phone` (Rohan's app, 390×844) and `laptop` (autoplay, 1440×900) |
| `src/build.mjs` | Renders it all: base video, dialogue, overlay, mix, final, SRTs |
| `out/` | `the-claim-v<N>.mp4` plus `.en.srt` / `.hi.srt` |
| `work/` | Intermediates (recordings, cleaned audio, sound effects, segments, overlay frames); safe to delete and rebuild |

## Rebuild

```powershell
node videos/edit/src/build.mjs
```

Set `$env:V = '2'` first to write `the-claim-v2.mp4` without overwriting v1. To redo only part of it, name the stages:

```powershell
node videos/edit/src/build.mjs overlay final
```

- **A cut or a subtitle:** edit `src/timeline.mjs`, then run every stage. Changed timings move the graphics and the mix too.
- **Only a graphic's look:** edit `src/overlay.html`, then run `overlay final`.
- **New screen recordings** of the hosted demo: `node videos/edit/src/record.mjs phone videos/edit/work/rec` (or `laptop`), then rebuild.

## The recorded product demo

The same pipeline builds `videos/demo/out/zkclaim-demo-v<N>.mp4`, about 2 minutes of the hosted app with no wallet needed:
- the app's own caption bar narrating the story;
- the patient's phone withdrawing permission;
- the Tamper Lab;
- a real Preprod receipt check.

```powershell
foreach ($m in 'story','tamper','receipt','withdraw') { node videos/edit/src/record.mjs $m videos/demo/work/rec }
$env:TIMELINE = './demo-timeline.mjs'; node videos/edit/src/build.mjs
```

The cut is `src/demo-timeline.mjs`.

## Sound

- **Dialogue:** each clip's own recorded sound (`clean` stage → `work/audio/clean*.wav`), in sync with its picture.
  - Mr. Verma's clipped shouts are repaired, then a gentle denoise.
  - Every speaker is levelled to the same loudness. Speaker timings come from the transcript (`src/speakers.mjs`); Mr. Verma was 3–5 dB hotter than Rohan.
  - Then de-mud and presence EQ, de-ess, compression and a limiter.
  - Cuts crossfade in room tone only, never over a word.
  - The ElevenLabs Voice Isolator output is no longer used.
- **Effects and beds:** generated with ElevenLabs Sound Effects (`work/sfx`). ElevenLabs Music needs a paid plan.
- **A real music track:** to use one, add it to `BEDS` in `timeline.mjs`.
- **Loudness:** the mix is normalized to −14 LUFS, the YouTube standard.

Needs ffmpeg, Node and the repo's Playwright Chromium. The overlay loads the Archivo font from Google Fonts.
