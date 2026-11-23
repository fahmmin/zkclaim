// Who speaks when, from the ElevenLabs transcripts (work/stt/stt<n>.json): merged spans per speaker per clip.
// Mr. Verma is the officer: speaker_0 in clips 1, 2 and 6 (checked against the transcript lines).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WORK } from './timeline.mjs';

export const VERMA = { 1: 'speaker_0', 2: 'speaker_0', 6: 'speaker_0' };

/** Speech spans [{ start, end, speaker }] for raw clip n, words closer than `gap` merged. */
export function spans(n, gap = 0.35) {
  const file = path.join(WORK, 'stt', `stt${n}.json`);
  if (!existsSync(file)) return [];
  const words = JSON.parse(readFileSync(file, 'utf8')).words.filter((w) => w.type === 'word');
  const out = [];
  for (const w of words) {
    const last = out.at(-1);
    if (last && last.speaker === w.speaker_id && w.start - last.end < gap) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end, speaker: w.speaker_id });
  }
  return out;
}

/** Spans spoken by Mr. Verma in clip n. */
export const vermaSpans = (n) => spans(n).filter((s) => s.speaker === VERMA[n]);
