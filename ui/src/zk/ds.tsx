// Design system: Card, Meta, Headline, Stamp, QR, Data, Redact, toasts.
import QRCode from 'qrcode';
import { type CSSProperties, type HTMLAttributes, type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';

export type Tone = 'cobalt' | 'tomato' | 'mustard' | 'teal' | 'paper' | 'purple' | 'orange' | 'leaf' | 'ink';

export function Card({ tone = 'paper', className = '', children, ...rest }: { tone?: Tone } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card t-${tone} ${className}`} {...rest}>
      {children}
    </section>
  );
}

/** Tiny bold uppercase line in a card corner; children are spread left to right. */
export const Meta = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`meta ${className}`}>{children}</div>;

export function Headline({ size = 'l', className = '', children, as: Tag = 'h2', id }: { size?: 'xl' | 'l' | 'm' | 's'; className?: string; children: ReactNode; as?: 'h1' | 'h2' | 'h3' | 'p'; id?: string }) {
  return (
    <Tag className={`hl ${size} ${className}`} id={id}>
      {children}
    </Tag>
  );
}

/** Inked rubber stamp. `slam` plays the one-shot stamping motion. */
export function Stamp({
  children,
  sub,
  tone = 'cobalt',
  rot = -9,
  size,
  slam = false,
  className = '',
  style,
}: {
  children: ReactNode;
  sub?: ReactNode;
  tone?: 'cobalt' | 'red' | 'ink' | 'paper' | 'leaf';
  rot?: number;
  size?: number;
  slam?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`stamp ${tone === 'cobalt' ? '' : tone} ${slam ? 'slam' : ''} ${className}`} style={{ ...(size ? { fontSize: size } : {}), ['--rot' as string]: `${rot}deg`, ...style }}>
      <span>{children}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function QR({ text, size = 200, className = '', label = 'QR code' }: { text: string; size?: number; className?: string; label?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#1d1c1aff', light: '#f1e6d0ff' } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(''));
    return () => {
      live = false;
    };
  }, [text, size]);
  return src ? <img className={`qr ${className}`} src={src} width={size} height={size} alt={label} /> : <div style={{ width: size, height: size }} />;
}

export const Data = ({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) => (
  <span className={`data ${className}`} title={title}>
    {children}
  </span>
);

export const Redact = ({ w = 8 }: { w?: number }) => <span className="redact" style={{ ['--w' as string]: `${w}ch` }} role="img" aria-label="hidden from the insurer" />;

// ---------- Toasts ----------

type Toast = { id: number; text: string; bad: boolean };
let toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
const ping = () => toastSubs.forEach((f) => f());

export function toast(text: string, bad = false) {
  const t = { id: Math.random(), text, bad };
  toasts = [...toasts.slice(-2), t];
  ping();
  setTimeout(
    () => {
      toasts = toasts.filter((x) => x !== t);
      ping();
    },
    bad ? 6000 : 3200,
  );
}

const subscribeToasts = (fn: () => void) => {
  toastSubs.add(fn);
  return () => void toastSubs.delete(fn);
};

export function Toasts() {
  const list = useSyncExternalStore(subscribeToasts, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Runs a service call, toasting the contract's message on failure. Returns undefined when it failed. */
export async function attempt<T>(task: () => Promise<T>, done?: string): Promise<T | undefined> {
  try {
    const result = await task();
    if (done) toast(done);
    return result;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
    return undefined;
  }
}
