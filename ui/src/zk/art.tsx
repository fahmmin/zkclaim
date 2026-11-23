// Original artwork: stickers drawn as SVG and pixel sprites drawn as character grids.
import type { CSSProperties, ReactElement } from 'react';

const C = {
  ink: '#1d1c1a',
  paper: '#f1e6d0',
  white: '#fffaf0',
  cobalt: '#2150d6',
  tomato: '#e1432f',
  mustard: '#f3cf35',
  teal: '#3ba38d',
  purple: '#7b4bef',
  orange: '#f08b2c',
  leaf: '#7fba5e',
};

export type Colour = keyof typeof C;
type Place = { size?: number; style?: CSSProperties; className?: string };

const wrap = (size: number, style: CSSProperties | undefined, className = '') => ({
  className: `sticker ${className}`,
  style: { width: size, ...style },
  'aria-hidden': true as const,
});

/** Round badge with an eight-petal flower, like a pin on a jacket. */
export function FlowerBadge({ bg = 'purple', ring = 'paper', petal = 'paper', size = 120, style, className }: Place & { bg?: Colour; ring?: Colour; petal?: Colour }) {
  return (
    <span {...wrap(size, style, className)}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="58" fill={C[bg]} />
        <circle cx="60" cy="60" r="46" fill="none" stroke={C[ring]} strokeWidth="6" />
        <g fill={C[petal]}>
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x="52" y="21" width="16" height="35" rx="8" transform={`rotate(${i * 45} 60 60)`} />
          ))}
        </g>
        <circle cx="60" cy="60" r="7" fill={C[bg]} />
      </svg>
    </span>
  );
}

export type Face = 'smile' | 'happy' | 'dizzy' | 'worried' | 'wink';

const FACES: Record<Face, ReactElement> = {
  smile: (
    <>
      <ellipse cx="62" cy="64" rx="3.2" ry="4.6" />
      <ellipse cx="78" cy="64" rx="3.2" ry="4.6" />
      <path d="M58 75 Q70 88 82 75" />
    </>
  ),
  happy: (
    <>
      <path d="M56 67 Q61 59 66 67" />
      <path d="M74 67 Q79 59 84 67" />
      <path d="M58 75 Q70 88 82 75" />
    </>
  ),
  dizzy: (
    <>
      <path d="M56 59 L65 68 M65 59 L56 68" />
      <path d="M75 59 L84 68 M84 59 L75 68" />
      <path d="M57 80 Q61 75 65 80 T73 80 T81 80" />
    </>
  ),
  worried: (
    <>
      <ellipse cx="62" cy="65" rx="3.2" ry="4.6" />
      <ellipse cx="78" cy="65" rx="3.2" ry="4.6" />
      <path d="M58 57 L66 54 M82 57 L74 54" />
      <path d="M60 82 Q70 74 80 82" />
    </>
  ),
  wink: (
    <>
      <ellipse cx="62" cy="64" rx="3.2" ry="4.6" />
      <path d="M73 65 Q78 59 84 65" />
      <path d="M58 75 Q70 88 82 75" />
    </>
  ),
};

/** Smiley daisy: outlined white petals around a mustard face. */
export function Daisy({ face = 'smile', size = 140, style, className, center = 'mustard' }: Place & { face?: Face; center?: Colour }) {
  return (
    <span {...wrap(size, style, className)}>
      <svg viewBox="0 0 140 140">
        <g stroke={C.ink} strokeWidth="4.5" fill={C.white} strokeLinejoin="round">
          {Array.from({ length: 9 }, (_, i) => (
            <ellipse key={i} cx="70" cy="33" rx="14" ry="27" transform={`rotate(${i * 40} 70 70)`} />
          ))}
        </g>
        <circle cx="70" cy="70" r="25" fill={C[center]} stroke={C.ink} strokeWidth="4.5" />
        <g fill={C.ink} stroke={C.ink} strokeWidth="4" strokeLinecap="round">
          {FACES[face]}
        </g>
      </svg>
    </span>
  );
}

/** Chunky eight-arm asterisk. */
export function Asterisk({ colour = 'ink', size = 40, style, className }: Place & { colour?: Colour }) {
  return (
    <span {...wrap(size, style, className)}>
      <svg viewBox="0 0 100 100">
        <g fill={C[colour]}>
          {[0, 45, 90, 135].map((a) => (
            <rect key={a} x="40" y="4" width="20" height="92" rx="10" transform={`rotate(${a} 50 50)`} />
          ))}
        </g>
      </svg>
    </span>
  );
}

/** Four-lobed clover. */
export function Clover({ colour = 'ink', size = 40, style, className }: Place & { colour?: Colour }) {
  return (
    <span {...wrap(size, style, className)}>
      <svg viewBox="0 0 100 100">
        <g fill={C[colour]}>
          <circle cx="50" cy="26" r="22" />
          <circle cx="74" cy="50" r="22" />
          <circle cx="50" cy="74" r="22" />
          <circle cx="26" cy="50" r="22" />
          <rect x="36" y="36" width="28" height="28" />
        </g>
      </svg>
    </span>
  );
}

/** Medical cross with soft corners. */
export function Cross({ colour = 'tomato', size = 28, style, className }: Place & { colour?: Colour }) {
  return (
    <span {...wrap(size, style, className)}>
      <svg viewBox="0 0 100 100">
        <path d="M38 10h24v28h28v24H62v28H38V62H10V38h28z" fill={C[colour]} stroke={C[colour]} strokeWidth="8" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// ---------- Pixel sprites ----------

const PAL: Record<string, string> = {
  k: C.ink,
  w: C.paper,
  W: C.white,
  g: '#d6c6a4',
  G: '#8d8475',
  b: C.cobalt,
  B: '#163a9e',
  c: '#9cc0ff',
  r: C.tomato,
  R: '#a3291a',
  y: C.mustard,
  Y: '#c99f17',
  t: C.teal,
  l: C.leaf,
  L: '#4d8a33',
  p: C.purple,
  o: C.orange,
};

export const SPRITES = {
  computer: [
    '.kkkkkkkkkkkkkkkk.',
    'kwwwwwwwwwwwwwwwgk',
    'kwkkkkkkkkkkkkkwgk',
    'kwkbbbbbbbbbbbkwgk',
    'kwkbccbbbbbbbbkwgk',
    'kwkbcbbbbbbbbbkwgk',
    'kwkbbbbbbbbbbbkwgk',
    'kwkbbbbbbbbbbbkwgk',
    'kwkbbbbbbbbbbbkwgk',
    'kwkkkkkkkkkkkkkwgk',
    'kwwwwwwwwwwwrrwwgk',
    'kggggggggggggggggk',
    '.kkkkkkkkkkkkkkkk.',
    '......kwwwwk......',
    '...kkkkkkkkkkkk...',
    '..kwkwkwkwkwkwwk..',
    '..kwwwwwwwwwwwwk..',
    '..kkkkkkkkkkkkkk..',
  ],
  hospital: [
    '......kkkk......',
    '......krrk......',
    '....kkkrrkkk....',
    '....krrrrrrk....',
    '....kkkrrkkk....',
    '......krrk......',
    '.kkkkkkkkkkkkkk.',
    '.kwwwwwwwwwwwwk.',
    '.kwbbwwbbwwbbwk.',
    '.kwbbwwbbwwbbwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwbbwkkkkwbbwk.',
    '.kwbbwkwwkwbbwk.',
    '.kwwwwkwwkwwwwk.',
    '.kwwwwkwwkwwwwk.',
    'kkkkkkkkkkkkkkkk',
  ],
  shield: [
    '..kkkkkkkkkkkk..',
    '.kbbbbbbbbbbbbk.',
    '.kbccbbbbbbbbbk.',
    '.kbcbbbbbbbbwbk.',
    '.kbbbbbbbbbwwbk.',
    '.kbbbbbbbbwwbbk.',
    '.kbbwbbbbwwbbbk.',
    '.kbbwwbbwwbbbbk.',
    '..kbbwwwwbbbbk..',
    '..kbbbwwbbbbbk..',
    '...kbbbbbbbbk...',
    '....kbbbbbbk....',
    '.....kbbbbk.....',
    '......kbbk......',
    '.......kk.......',
  ],
  pill: [
    '.........kkkk...',
    '........kwwwwk..',
    '.......kwWwwwwk.',
    '......kwwwwwwwk.',
    '.....kkwwwwwwk..',
    '....krrkwwwwk...',
    '...krrrrkwwk....',
    '..krrrrrrkk.....',
    '.krWrrrrrk......',
    '.krrrrrrk.......',
    '.krrrrrk........',
    '..kRRRk.........',
    '...kkk..........',
  ],
  flask: [
    '....kkkkkkkk....',
    '.....kwwwwk.....',
    '.....kwwwwk.....',
    '.....kwwwwk.....',
    '....kwwwwwwk....',
    '....kwwwwwwk....',
    '...kwwwwwwwwk...',
    '...kllllllllk...',
    '..kllWllllllLk..',
    '..klllllWlllLk..',
    '.klllllllllllLk.',
    '.kllWllllllllLk.',
    'kllllllllllllLLk',
    'kLLLLLLLLLLLLLLk',
    '.kkkkkkkkkkkkkk.',
  ],
  heart: [
    '.kkk...kkk.',
    'krrrk.krrrk',
    'krWrrkrrrrk',
    'krrrrrrrrrk',
    'krrrrrrrrrk',
    '.krrrrrrrk.',
    '..krrrrrk..',
    '...krrrk...',
    '....krk....',
    '.....k.....',
  ],
  siren: [
    '...k...kk...k...',
    '....k..kk..k....',
    '................',
    '.....kkkkkk.....',
    '....krrWrrrk....',
    '...krrWrrrrrk...',
    '...krWrrrrrrk...',
    'kk.krrrrrrrrk.kk',
    '...krrrrrrrrk...',
    '...krrrrrrrrk...',
    '..kkkkkkkkkkkk..',
    '..kGGGGGGGGGGk..',
    '..kkkkkkkkkkkk..',
  ],
  lock: [
    '....kkkkkk....',
    '...kGGGGGGk...',
    '..kGk....kGk..',
    '..kGk....kGk..',
    '..kGk....kGk..',
    'kkkkkkkkkkkkkk',
    'kyyyyyyyyyyyYk',
    'kyWyyyyyyyyyYk',
    'kyyyyykkyyyyYk',
    'kyyyyykkyyyyYk',
    'kyyyyyykyyyyYk',
    'kyyyyyykyyyyYk',
    'kyyyyyyyyyyyYk',
    'kYYYYYYYYYYYYk',
    'kkkkkkkkkkkkkk',
  ],
  floppy: [
    'kkkkkkkkkkkkkkk.',
    'kbbkwwwwwwwkbbbk',
    'kbbkwwwwkkwkbbbk',
    'kbbkwwwwkkwkbbbk',
    'kbbkwwwwwwwkbbbk',
    'kbbbkkkkkkkbbbbk',
    'kbbbbbbbbbbbbbbk',
    'kbbwwwwwwwwwwbbk',
    'kbbwkkkkkkkkwbbk',
    'kbbwwwwwwwwwwbbk',
    'kbbwkkkkkkkkwbbk',
    'kbbwwwwwwwwwwbbk',
    'kbbwwwwwwwwwwbbk',
    'kkkkkkkkkkkkkkkk',
  ],
  key: [
    '.kkkkk..........',
    'kyyyyyk.........',
    'kykkkyykkkkkkkk.',
    'kyk.kyyyyyyyyyyk',
    'kykkkyykkkyykyyk',
    'kyyyyyk..kyk.kk.',
    '.kkkkk...kk.....',
  ],
} satisfies Record<string, string[]>;

export type Sprite = keyof typeof SPRITES;

/** A pixel sprite; horizontal runs are merged into one rect each to keep the DOM small. */
export function Pixel({ art, scale = 6, className = '', label, style }: { art: Sprite; scale?: number; className?: string; label?: string; style?: CSSProperties }) {
  const rows = SPRITES[art];
  const w = Math.max(...rows.map((r) => r.length));
  const rects: ReactElement[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') rects.push(<rect key={`${x}.${y}`} x={x} y={y} width={end - x} height={1} fill={PAL[ch]} />);
      x = end;
    }
  });
  return (
    <svg
      className={`pix ${className}`}
      viewBox={`0 0 ${w} ${rows.length}`}
      width={w * scale}
      height={rows.length * scale}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rects}
    </svg>
  );
}
