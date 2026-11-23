// App shell: picks the service (demo or live), the three-part header, role nav, footer row and demo controls.
import { useEffect, useState } from 'react';
import { Cross, FlowerBadge } from './art';
import logoMark from './assets/logo-mark.png';
import { PlayBar, PlayButton, usePlay } from './autoplay';
import { ServiceContext, useService, useSnap } from './ctx';
import { DemoService } from './demo';
import { Data, Toasts, attempt } from './ds';
import { type Mode, night, short } from './service';
import CareTeam from './screens/CareTeam';
import Emergency from './screens/Emergency';
import Hospital from './screens/Hospital';
import Insurer from './screens/Insurer';
import Landing from './screens/Landing';
import LiveGate, { LiveBar } from './screens/LiveGate';
import { LiveService } from './live';
import Patient from './screens/Patient';
import TamperLab from './screens/TamperLab';

let demo: DemoService | null = null;
let live: LiveService | null = null;
const serviceFor = (mode: Mode) => (mode === 'live' ? (live ??= new LiveService()) : (demo ??= new DemoService()));

const ROLES = [
  { path: 'insurer', label: 'Insurer', key: '1', title: 'Insurer desk' },
  { path: 'patient', label: 'Patient', key: '2', title: 'Patient app' },
  { path: 'hospital', label: 'Hospital', key: '3', title: 'Hospital desk' },
  { path: 'care', label: 'Care team', key: '4', title: 'Care team' },
  { path: 'emergency', label: 'Emergency', key: '5', title: 'Emergency' },
  { path: 'tamper', label: 'Tamper Lab', key: '6', title: 'Tamper Lab' },
];

const go = (path: string) => (location.hash = `#/${path}`);

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('.zk.is-playing')) return; // the story is steering the screens
      if (e.key === '0') go('');
      const role = ROLES.find((r) => r.key === e.key);
      if (role) go(role.path);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

export default function ZkApp({ path }: { path: string }) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('zkclaim-mode') === 'live' ? 'live' : 'demo'));
  useShortcuts();
  const switchMode = (m: Mode) => {
    localStorage.setItem('zkclaim-mode', m);
    setMode(m);
  };
  const section = path.split('/')[0];
  const role = ROLES.find((r) => r.path === section);
  const playing = usePlay().status === 'playing';
  useEffect(() => {
    document.title = role ? `${role.title} | zkClaim` : 'zkClaim';
    scrollTo({ top: 0 });
  }, [role]);

  return (
    <ServiceContext.Provider value={serviceFor(mode)}>
      <div className={`zk ${section === 'patient' ? 'is-patient' : ''} ${playing ? 'is-playing' : ''}`}>
        <header className="top">
          <a className="brand" href="#/">
            <img className="brand-mark" src={logoMark} alt="" />
            ZKCLAIM
          </a>
          <span className="center">Private claims on Midnight</span>
          <div className="right">
            <ModeSwitch mode={mode} onSwitch={switchMode} />
            <span className="hide-sm">{role ? role.title : 'Presents'}</span>
          </div>
        </header>
        <nav className="rolenav" aria-label="Roles">
          {ROLES.map((r) => (
            <a key={r.path} href={`#/${r.path}`} aria-current={section === r.path ? 'page' : undefined}>
              {r.label}
              <kbd>{r.key}</kbd>
            </a>
          ))}
        </nav>
        <main className="page">{mode === 'live' ? <Live path={path} onDemo={() => switchMode('demo')} /> : <Screen path={path} />}</main>
        <Footer />
        {mode === 'demo' && <DemoControls />}
        <Toasts />
        <PlayBar />
      </div>
    </ServiceContext.Provider>
  );
}

/**
 * Demo/Live. Only a click here (or the live gate's "Back to demo mode") changes the mode, which is kept in
 * localStorage, so a reload or a crash recovery comes back in the same mode. Locked while a live transaction is in
 * flight: leaving would strand its request in 1AM.
 */
function ModeSwitch({ mode, onSwitch }: { mode: Mode; onSwitch: (m: Mode) => void }) {
  const s = useSnap();
  const locked = s.mode === 'live' && !!s.busy;
  return (
    <div className="modeswitch" role="group" aria-label="Mode" title={locked ? `Waiting for 1AM: ${s.busy}` : undefined}>
      <button aria-pressed={mode === 'demo'} disabled={locked} onClick={() => onSwitch('demo')}>
        Demo
      </button>
      <button aria-pressed={mode === 'live'} disabled={locked} onClick={() => onSwitch('live')}>
        Live
      </button>
    </div>
  );
}

/** Live mode: connect and pick a contract first, then the same screens as demo mode. */
function Live({ path, onDemo }: { path: string; onDemo: () => void }) {
  const s = useSnap();
  if (!s.ready) return <LiveGate onDemo={onDemo} />;
  return (
    <>
      <LiveBar />
      <Screen path={path} />
    </>
  );
}

function Screen({ path }: { path: string }) {
  const [section, sub = ''] = path.split('/');
  switch (section) {
    case 'insurer':
      return <Insurer />;
    case 'patient':
      return <Patient tab={sub} />;
    case 'hospital':
      return <Hospital />;
    case 'care':
      return <CareTeam role={sub === 'lab' || sub === 'pharmacy' ? sub : 'doctor'} />;
    case 'emergency':
      return <Emergency />;
    case 'tamper':
      return <TamperLab />;
    default:
      return <Landing />;
  }
}

function Footer() {
  const s = useSnap();
  return (
    <footer className="foot">
      <span className="row" style={{ gap: 6 }}>
        <Cross size={22} />
        <Cross size={22} />
        <Cross size={22} />
      </span>
      <span>
        Network: <Data>{s.network}</Data>
      </span>
      <span>
        Contract: <Data title={s.contract}>{s.contract ? short(s.contract, 8, 6) : s.mode === 'live' ? 'none yet' : 'starting…'}</Data>
      </span>
      <span className="grow" />
      <span>Paid out: {night(s.paid)}</span>
      <span>Mode: {s.mode}</span>
    </footer>
  );
}

function DemoControls() {
  const svc = useService();
  const s = useSnap();
  const [open, setOpen] = useState(false);
  return (
    <div className="democtl">
      {open && (
        <div className="panel" role="dialog" aria-label="Demo controls">
          <div className="meta">
            <span>Demo controls</span>
            <span>{s.busy ? <span className="busy-dot" aria-label="working" /> : 'Ready'}</span>
          </div>
          <PlayButton className="big block" onPlay={() => setOpen(false)} />
          <button className="btn block" disabled={!!s.busy} onClick={() => (setOpen(false), attempt(() => svc.seedStory(), 'Story seeded: card issued, record anchored, consent waiting').then(() => go('patient')))}>
            Seed the story
          </button>
          <button className="btn block" disabled={!!s.busy} onClick={() => (setOpen(false), attempt(() => svc.seedStory(true), 'Two claims, both consented: withdraw one, then claim both').then(() => go('patient')))}>
            Seed two claims (withdraw demo)
          </button>
          <button className="btn ghost block" disabled={!!s.busy} onClick={() => (setOpen(false), attempt(() => svc.reset(), 'Fresh chain, nothing on it'))}>
            Reset everything
          </button>
          <div className="row">
            <button className="btn ghost sm grow" onClick={() => svc.skipAhead(3600)}>
              Skip 1 hour
            </button>
            <button className="btn ghost sm grow" onClick={() => svc.skipAhead(86_400)}>
              Skip 1 day
            </button>
          </div>
          <div className="chips">
            {ROLES.map((r) => (
              <a key={r.path} className="chip" href={`#/${r.path}`} onClick={() => setOpen(false)} style={{ textDecoration: 'none' }}>
                {r.label}
              </a>
            ))}
          </div>
          <p className="small muted">Keys 1 to 6 switch roles, 0 goes home. Esc stops autoplay.</p>
        </div>
      )}
      <button className="fab" aria-expanded={open} aria-label="Demo controls" onClick={() => setOpen((o) => !o)}>
        <FlowerBadge size={64} bg={open ? 'tomato' : 'purple'} style={{ filter: 'none' }} />
      </button>
    </div>
  );
}
