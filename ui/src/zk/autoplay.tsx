// "Play the story": runs the whole demo by itself, through the real screens. It finds the app's own fields and
// buttons by their labels, types and clicks like a person, and moves on only when the service says the action
// finished (busy back to idle, plus its result in the snapshot or on screen). Demo mode only: in Live mode every
// action waits for a 1AM approval.
import { useEffect, useSyncExternalStore } from 'react';
import { useService } from './ctx';
import { Card, Headline, Meta, toast } from './ds';
import { night, type ZkClaimService } from './service';
import './autoplay.css';

// ---------- State the strip and buttons render ----------

type End = { paid: bigint; hospital: string; trail: number; replay: string; ms: number; speed: number };
type State = { status: 'idle' | 'playing' | 'done' | 'failed'; paused: boolean; speed: number; step: number; title: string; doing: string; error: string; end: End | null };

let state: State = { status: 'idle', paused: false, speed: 1, step: 0, title: '', doing: '', error: '', end: null };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const usePlay = () => useSyncExternalStore(subscribe, () => state);

// ---------- DOM helpers ----------

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const shown = (el: Element) => el.getClientRects().length > 0;
const all = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLElement>(sel)].filter(shown);
const words = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** A visible card whose corner meta or headline mentions `name`. */
const cardOf = (name: string) => all('.card').find((c) => words(c.querySelector('.meta')).includes(name) || words(c.querySelector('.hl')).includes(name));
/** Pinned on screen (QR overlay, phone tab bar): scrolling can't move it and the strip can't cover it. */
const pinned = (el: Element) => !!el.closest('.qr-overlay, .tabbar');

/** The part of the viewport the caption strip and the phone tab bar leave free. */
function freeBand() {
  let top = 12;
  let bottom = innerHeight - 12;
  for (const bar of all('.playbar, .tabbar')) {
    const r = bar.getBoundingClientRect();
    if (r.top > innerHeight / 2) bottom = Math.min(bottom, r.top - 12);
    else top = Math.max(top, r.bottom + 12);
  }
  return { top, bottom };
}

/** Sets a React-controlled field the way typing does: the prototype's value setter, then the events React listens for. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The mustard ring around whatever is about to be clicked or read. Fixed-position, so card overflow can't clip it. */
class Ring {
  private el = document.createElement('div');
  private target: HTMLElement | null = null;
  private raf = 0;
  constructor() {
    this.el.className = 'play-ring';
    this.el.setAttribute('aria-hidden', 'true');
  }
  on(target: HTMLElement) {
    this.off();
    this.target = target;
    this.el.style.borderRadius = `${Math.min((parseFloat(getComputedStyle(target).borderTopLeftRadius) || 6) + 7, 999)}px`;
    document.body.append(this.el); // re-inserting restarts the pop-in animation
    this.track();
  }
  private track = () => {
    const t = this.target;
    if (!t) return;
    const r = t.getBoundingClientRect();
    let top = r.top - 7;
    let bottom = r.bottom + 7;
    if (!pinned(t)) {
      // a card taller than the free area gets a ring around its visible part, not one drawn over the strip
      const band = freeBand();
      top = Math.max(top, band.top - 6);
      bottom = Math.min(bottom, band.bottom + 6);
    }
    Object.assign(this.el.style, { left: `${r.left - 7}px`, top: `${top}px`, width: `${r.width + 14}px`, height: `${Math.max(0, bottom - top)}px`, opacity: t.isConnected && bottom > top ? '' : '0' });
    this.raf = requestAnimationFrame(this.track);
  };
  tap() {
    this.el.classList.add('tap');
  }
  off() {
    cancelAnimationFrame(this.raf);
    this.target = null;
    this.el.classList.remove('tap');
    this.el.remove();
  }
}

// ---------- The director: one per run ----------

type Fail = () => string | null | undefined;

class Director {
  stopped = false;
  replay = '';
  private runs = 0;
  private busy: boolean;
  private pausedMs = 0;
  private readonly t0 = performance.now();
  private seen = new WeakSet<Element>();
  private ring = new Ring();
  private unsub: () => void;

  constructor(readonly svc: ZkClaimService) {
    this.busy = !!svc.snapshot().busy;
    // Every service call turns busy on, then off; counting the offs tells when a clicked action really finished.
    this.unsub = svc.subscribe(() => {
      const b = !!svc.snapshot().busy;
      if (this.busy && !b) this.runs++;
      this.busy = b;
    });
    document.querySelectorAll('.toast.bad').forEach((t) => this.seen.add(t));
  }

  snap = () => this.svc.snapshot();
  say = (doing: string) => set({ doing });
  elapsed = () => performance.now() - this.t0 - this.pausedMs;
  dispose() {
    this.unsub();
    this.ring.off();
  }

  /** Holds while paused; throws once stopped. */
  private async gate() {
    for (;;) {
      if (this.stopped) throw new Error('stopped');
      if (!state.paused) return;
      const t = performance.now();
      await wait(80);
      this.pausedMs += performance.now() - t;
    }
  }

  /** A pause for the viewer: `ms` at 1×, half that at 2×. */
  async sleep(ms: number) {
    for (let left = ms; left > 0; ) {
      await this.gate();
      const slice = Math.min(50, left / state.speed);
      await wait(slice);
      left -= slice * state.speed;
    }
    await this.gate();
  }

  /** Waits for real state. Fails on a new error toast (how the screens report a rejected call) or on `fail()`. */
  async until<T>(cond: () => T | null | undefined | false, what: string, { timeout = 30_000, fail }: { timeout?: number; fail?: Fail } = {}): Promise<T> {
    for (let left = timeout; ; left -= 40) {
      await this.gate();
      const bad = [...document.querySelectorAll('.toast.bad')].find((t) => !this.seen.has(t));
      if (bad) throw new Error(words(bad));
      const failed = fail?.();
      if (failed) throw new Error(failed);
      const v = cond();
      if (v) return v;
      if (left <= 0) throw new Error(`Gave up waiting for ${what}`);
      await wait(40);
    }
  }

  // Finders: wait for the element, then hand it over.
  card = (name: string) => this.until(() => cardOf(name), `the "${name}" card`, { timeout: 10_000 });
  find = (scope: ParentNode, sel: string, what = sel) => this.until(() => all(sel, scope)[0], what, { timeout: 10_000 });
  button = (scope: ParentNode, label: string) =>
    this.until(() => all('button, a.btn, a.chip', scope).find((b) => words(b).startsWith(label)), `the "${label}" button`, { timeout: 10_000 });
  row = (scope: ParentNode, name: string) => this.until(() => all('li', scope).find((li) => words(li).includes(name)), `the row for ${name}`, { timeout: 10_000 });
  group = (scope: ParentNode, label: string) =>
    this.until(() => all('.field', scope).find((f) => words(f.firstElementChild).startsWith(label)), `the "${label}" field`, { timeout: 10_000 });
  async field(scope: ParentNode, label: string) {
    const el = (await this.group(scope, label)).querySelector<HTMLInputElement>('input, select, textarea');
    if (!el) throw new Error(`The "${label}" field has no input`);
    return el;
  }

  /** Scrolls `el` into the part of the screen the caption strip and the tab bar leave free. */
  private async reveal(el: HTMLElement) {
    if (pinned(el)) return;
    const { top, bottom } = freeBand();
    const r = el.getBoundingClientRect();
    if (r.left < 0 || r.right > innerWidth) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); // the role nav scrolls sideways on phones
    else if (r.top < top || r.bottom > bottom) scrollTo({ top: scrollY + r.top - top - Math.max(0, (bottom - top - r.height) / 2), behavior: 'smooth' });
    else return;
    // Smooth scrolling: go on once the element stops moving.
    let last = '';
    for (let i = 0, still = 0; still < 3 && i < 90; i++) {
      await wait(16);
      const n = el.getBoundingClientRect();
      const pos = `${Math.round(n.top)},${Math.round(n.left)}`;
      still = pos === last ? still + 1 : 0;
      last = pos;
    }
  }

  /** Rings `el` for a moment, then clicks it. */
  async press(el: HTMLElement) {
    await this.reveal(el);
    this.ring.on(el);
    await this.sleep(520);
    await this.until(() => !(el as HTMLButtonElement).disabled, `"${words(el)}" to be enabled`, { timeout: 8000 });
    this.ring.tap();
    await this.sleep(140);
    el.click();
    await this.sleep(220);
    this.ring.off();
  }

  /** Clicks a button that calls the service; resolves once that call finished and `done()` holds. */
  async act(el: HTMLElement, done: () => unknown, what: string, fail?: Fail) {
    const before = this.runs;
    await this.press(el);
    await this.until(() => this.runs > before && !this.busy && done(), what, { timeout: 60_000, fail });
  }

  /** Rings `el` without clicking: where the viewer should look. */
  async point(el: HTMLElement | null | undefined, ms: number) {
    if (!el) return;
    await this.reveal(el);
    this.ring.on(el);
    await this.sleep(ms);
    this.ring.off();
  }

  /** Rings `el` until `cond` holds, e.g. the proof checklist while it ticks. */
  async watch<T>(el: HTMLElement, cond: () => T | null | undefined | false, what: string, fail?: Fail) {
    await this.reveal(el);
    this.ring.on(el);
    const v = await this.until(cond, what, { fail });
    this.ring.off();
    return v;
  }

  /** Clears a field and types `text` one character at a time. */
  async type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
    await this.reveal(el);
    this.ring.on(el);
    await this.sleep(300);
    setValue(el, '');
    const per = text.length > 40 ? 24 : 55;
    for (let i = 1; i <= text.length; i++) {
      await this.sleep(per);
      setValue(el, text.slice(0, i));
    }
    await this.sleep(350);
    this.ring.off();
  }

  /** Picks a select option (or sets a date) with the field ringed. */
  async choose(el: HTMLInputElement | HTMLSelectElement, value: string) {
    if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === value)) throw new Error(`No "${value}" option to pick`);
    await this.reveal(el);
    this.ring.on(el);
    await this.sleep(450);
    setValue(el, value);
    await this.sleep(600);
    this.ring.off();
  }

  /** Opens a screen as a person would: the role nav, then (on phones) the patient app's tab bar. */
  async go(path: string) {
    const [section, tab = ''] = path.split('/');
    if (location.hash.replace(/^#\/?/, '').split('/')[0] !== section) {
      const link = all(`.rolenav a[href="#/${section}"]`)[0];
      if (link) await this.press(link);
      else location.hash = `#/${section}`; // phones hide the role nav inside the patient app
      await this.until(() => document.querySelector(`.rolenav a[href="#/${section}"][aria-current="page"]`), `the ${section} screen`);
      await wait(60); // the shell scrolls a new screen to the top; let that land before scrolling ourselves
    }
    const tabLink = all(`.tabbar a[href="#/patient${tab ? '/' + tab : ''}"]`)[0];
    if (tabLink && tabLink.getAttribute('aria-current') !== 'page') {
      await this.press(tabLink);
      await this.until(() => tabLink.getAttribute('aria-current') === 'page', `the ${tab || 'card'} tab`);
    }
  }
}

// ---------- The story, in the order of the problem statement and docs/demo-video.md ----------

const REASON = 'Unconscious after a road accident. Need allergies and current medicines before surgery.';

const STEPS: { title: string; run: (d: Director) => Promise<void> }[] = [
  {
    title: 'A fresh chain',
    async run(d) {
      d.say('New contract, new keys, an empty pool');
      await d.svc.reset();
      toast('Fresh chain, nothing on it');
      await d.sleep(900);
    },
  },
  {
    title: 'The insurer sets up',
    async run(d) {
      await d.go('insurer');
      d.say('Funding the payout pool with 1,000 NIGHT');
      const pool = await d.card('Payout pool');
      await d.type(await d.field(pool, 'Amount in NIGHT'), '1,000');
      const funded = d.snap().funded;
      await d.act(await d.button(pool, 'Fund pool'), () => d.snap().funded > funded, 'the pool to be funded');

      d.say('Approving St. Juniper General: it joins the private hospital list');
      const list = await d.card('Approved hospitals');
      await d.act(await d.button(await d.row(list, 'St. Juniper General'), 'Approve'), () => d.snap().hospitals.find((h) => h.id === 'juniper')?.approved, 'the approval');

      d.say("Writing Rohan Iyer's policy");
      const form = await d.card('New policy');
      await d.type(await d.field(form, 'Policy holder'), 'Rohan Iyer');
      await d.choose(await d.field(form, 'Plan'), 'Gold Family');
      await d.type(await d.field(form, 'Limit in NIGHT'), '5,000');
      await d.press(await d.button(await d.group(form, 'Valid for'), '1 year'));
      d.say('Covered procedures, Angioplasty & stent among them');
      const covered = await d.group(form, 'Covered procedures');
      for (const chip of all('button.chip', covered)) {
        const want = !['Cosmetic dermabrasion', 'Maternity'].includes(words(chip));
        if ((chip.getAttribute('aria-pressed') === 'true') !== want) await d.press(chip);
      }
      await d.point(await d.button(covered, 'Angioplasty & stent'), 1000);
      d.say("Issuing the card: sealed to Rohan's phone, only its fingerprint goes on-chain");
      await d.act(await d.button(form, 'Issue card to'), () => d.snap().card?.holderName === 'Rohan Iyer', 'the card to reach the phone');
    },
  },
  {
    title: "Rohan's card lands on his phone",
    async run(d) {
      await d.go('patient');
      const card = await d.find(document, '.policy-card', "Rohan's card");
      d.say('Sealed to his phone: only his key opens it');
      await d.point(card.querySelector<HTMLElement>('.idcard'), 1700);
      d.say('Show to hospital: the QR carries his policy terms, not his medical history');
      await d.press(await d.button(card, 'Show to hospital'));
      const qr = await d.find(document, '.qr-overlay', 'the QR code');
      await d.sleep(1900);
      await d.press(await d.button(qr, 'Done'));
      await d.until(() => !document.querySelector('.qr-overlay'), 'the QR code to close');
    },
  },
  {
    title: 'Hospital seals the record',
    async run(d) {
      await d.go('hospital');
      const admit = await d.card('Admission');
      d.say("Scanning Rohan's phone at the admission desk");
      await d.act(await d.button(admit, 'Scan '), () => admit.querySelector('.admitted'), 'the admission');
      d.say('Admit: the card checks out against the chain');
      await d.act(await d.button(admit, 'Admit'), () => admit.querySelector('.admitted'), 'the admission');
      await d.point(admit.querySelector<HTMLElement>('.admitted'), 1300);

      const treat = await d.card('Treat & seal');
      d.say('Treatment: a heart attack, treated with a coronary stent');
      await d.press(await d.button(treat, 'Heart attack treated with a coronary stent'));
      await d.press(await d.button(await d.group(treat, 'Sex'), 'Male'));
      await d.choose(await d.field(treat, 'Born'), '1979-04-12');
      d.say('Diagnosis ICD-10 I21.4, procedure CPT 92928');
      await d.choose(await d.field(treat, 'Diagnosis'), 'I21.4');
      await d.choose(await d.field(treat, 'Procedure'), '92928');
      d.say('Medications and lab results go into the same encrypted record');
      await d.point(await d.group(treat, 'Medications'), 1100);
      await d.point(await d.group(treat, 'Lab results'), 1100);
      d.say('The bill: 400 NIGHT');
      await d.type(await d.field(treat, 'Bill in NIGHT'), '400');
      d.say('Seal, upload & anchor: encrypted for Rohan, stored on IPFS, only a commitment goes on-chain');
      const made = d.snap().records.length;
      await d.act(await d.button(treat, 'Seal, upload'), () => d.snap().records.length > made && treat.querySelector('.ticks'), 'the record to be anchored');
      await d.point(treat.querySelector<HTMLElement>('.ticks'), 1700);
    },
  },
  {
    title: 'Rohan consents on his phone',
    async run(d) {
      await d.go('patient/records');
      const ask = await d.find(document, '.consent', 'the consent request');
      const yes = await d.button(ask, 'Consent to this claim');
      d.say('St. Juniper General asks to claim 400 NIGHT. His diagnosis never leaves the phone.');
      await d.point(ask.querySelector<HTMLElement>('.promise'), 2200);
      const id = d.snap().records[0]?.id;
      await d.act(yes, () => d.snap().records.find((r) => r.id === id)?.status === 'consented', 'the consent');
      await d.sleep(800);
    },
  },
  {
    title: 'Hospital proves the claim and gets paid',
    async run(d) {
      await d.go('hospital');
      const prove = await d.find(document, '.prove', 'the claim desk');
      const rejected = () => (prove.querySelector('.payout.shake') ? words(prove.querySelector('.payout .err')) || 'The claim was rejected' : null);
      d.say('Prove & submit claim: one zero-knowledge proof covers all eight checks');
      await d.press(await d.button(prove, 'Prove & submit claim'));
      const checks = await d.until(() => all('.checks', prove)[0], 'the proof', { timeout: 60_000, fail: rejected });
      d.say('Approved hospital, active policy, anchored record, covered, within limit, consented, never claimed');
      const payout = await d.watch(checks, () => all('.payout', prove)[0], 'the payout', rejected);
      if (rejected()) throw new Error(rejected()!);
      d.say('Paid on the spot from the pool. No adjuster, no appeal.');
      await d.point(payout, 2300);
    },
  },
  {
    title: 'The insurer sees a payment, not a patient',
    async run(d) {
      await d.go('insurer');
      const tile = await d.find(document, 'article.claim', 'the settled claim');
      d.say('Insurer sees: the amount, a policy fingerprint, a nullifier, the hospital list root, the payee, the time');
      await d.point(tile.querySelector<HTMLElement>('section'), 2800);
      d.say('Insurer never sees: diagnosis, procedure, prescriptions, lab results, the medical record');
      await d.point(tile.querySelector<HTMLElement>('.never'), 2800);
      d.say("There is no reject button: a valid proof can't be denied");
      await d.point(await d.find(document, '.no-reject'), 2400);
    },
  },
  {
    title: 'Tamper Lab: replay a paid claim',
    async run(d) {
      await d.go('tamper');
      const attack = await d.card('Replay a paid claim');
      d.say('Submitting the paid claim again, on a copy of the contract');
      await d.press(await d.button(attack, 'Run attack'));
      const msg = await d.until(() => all('.msg', attack)[0], 'the replay result');
      if (!attack.querySelector('.stamp')) throw new Error(`The replay was not rejected: ${words(msg)}`);
      d.replay = words(msg);
      d.say(`Rejected by the contract: "${d.replay}"`);
      await d.point(attack, 2400);
    },
  },
  {
    title: 'Rohan shares his record, then takes it back',
    async run(d) {
      const doctor = d.snap().people.doctor;
      const grant = () => d.snap().grants.find((g) => g.role === 'doctor');
      const viewer = () => all('.viewer')[0];
      await d.go('patient/access');
      const access = await d.card('Who can see what');
      d.say(`Rohan shares the doctor's view with ${doctor} for 1 day`);
      await d.press(await d.button(await d.group(access, 'Share with'), doctor));
      await d.press(await d.button(await d.group(access, 'For'), '1 day'));
      await d.act(await d.button(access, 'Grant access'), () => grant()?.revokedAt === null, 'the grant');

      await d.go('care');
      d.say(`${doctor} opens it: the view is logged on-chain first, then decrypted`);
      await d.act(await d.button(await d.card('Shared with me'), 'Open'), () => viewer()?.querySelector('.sections'), 'the record to open', () => words(viewer()?.querySelector('.denied .data')));
      await d.point(viewer(), 2600);

      await d.go('patient/access');
      d.say('Rohan revokes: the record is re-encrypted under new keys');
      await d.act(await d.button(await d.row(await d.card('Who can see what'), doctor), 'Revoke'), () => grant()?.revokedAt != null, 'the revoke');

      await d.go('care');
      d.say(`${doctor} tries again`);
      await d.act(await d.button(await d.card('Shared with me'), 'Open'), () => viewer()?.querySelector('.denied'), 'the refusal');
      d.say('Access denied by the contract: the grant is gone');
      await d.point(viewer(), 2400);
    },
  },
  {
    title: 'Emergency: break the glass',
    async run(d) {
      await d.go('insurer');
      d.say('The insurer approves Paramedic Tara Joseph as a responder');
      const team = await d.card('Responders');
      await d.act(await d.button(await d.row(team, 'Paramedic Tara Joseph'), 'Approve'), () => d.snap().responders.find((r) => r.id === 'unit7')?.approved, 'the responder approval');

      await d.go('emergency');
      const glass = await d.find(document, '.glass', 'the emergency form');
      const view = () => cardOf('Emergency view');
      d.say('Rohan comes in unconscious. The paramedic gives a reason, kept on the record forever.');
      await d.choose(await d.field(glass, 'Responder'), 'unit7');
      await d.choose(await d.field(glass, 'Patient record'), d.snap().records[0]?.id ?? '');
      await d.type(await d.field(glass, 'Reason'), REASON);
      await d.act(await d.button(glass, 'Break the glass'), () => view()?.querySelector('.sections'), 'the emergency view', () => words(view()?.querySelector('.denied .data')));
      d.say('Opened for one hour, and logged in red with her name and reason');
      await d.point(view(), 1800);
      await d.point(await d.find(await d.card('Break-glass log'), 'li.alarm', 'the red log entry'), 1800);

      await d.go('patient/trail');
      d.say("Rohan's audit trail: the grant, the view, the revoke and the break-glass, all on-chain");
      await d.point(await d.find(await d.card('Audit trail'), '.trail', 'the audit trail'), 3400);
    },
  },
];

const TOTAL = STEPS.length + 1; // the end card is the last step

// ---------- Controls ----------

let current: Director | null = null;

export async function play(svc: ZkClaimService) {
  if (svc.mode !== 'demo') return;
  if (current) current.stopped = true;
  const d = (current = new Director(svc));
  set({ status: 'playing', paused: false, step: 0, title: '', doing: '', error: '', end: null });
  try {
    for (const [i, step] of STEPS.entries()) {
      set({ step: i + 1, title: step.title, doing: '' });
      await d.until(() => d.snap().ready && !d.snap().busy, 'the chain', { timeout: 60_000 });
      await step.run(d);
    }
    const s = d.snap();
    const hospital = s.hospitals.find((h) => h.id === s.claims[0]?.hospitalId)?.name ?? 'the hospital';
    set({ status: 'done', step: TOTAL, title: "That's the story", doing: '', end: { paid: s.paid, hospital, trail: s.audit.length, replay: d.replay, ms: d.elapsed(), speed: state.speed } });
  } catch (e) {
    if (d.stopped) return;
    console.warn('[autoplay]', e);
    set({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
  } finally {
    d.dispose();
    if (current === d) current = null;
  }
}

export function stop() {
  if (!current) return;
  current.stopped = true;
  current = null;
  set({ status: 'idle', paused: false });
  toast('Autoplay stopped');
}

const close = () => set({ status: 'idle', error: '', end: null });

/** "Play the story", on the landing poster and in the demo controls. Disabled in Live mode. */
export function PlayButton({ className = '', onPlay }: { className?: string; onPlay?: () => void }) {
  const svc = useService();
  const p = usePlay();
  return (
    <button className={`btn ${className}`} disabled={svc.mode !== 'demo' || p.status === 'playing'} onClick={() => (onPlay?.(), void play(svc))}>
      <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
        <path d="M0 0 12 7 0 14z" fill="currentColor" />
      </svg>
      Play the story
    </button>
  );
}

/** The caption strip while playing (or after a failure), and the end card. */
export function PlayBar() {
  const svc = useService();
  const p = usePlay();
  useEffect(() => {
    if (svc.mode !== 'demo') stop();
  }, [svc]);
  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (p.status === 'idle') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (state.status === 'playing' ? stop() : close());
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [p.status]);

  if (p.status === 'idle') return null;
  if (p.status === 'done' && p.end) return <TheEnd end={p.end} />;
  const failed = p.status === 'failed';
  return (
    <>
    {!failed && <div className="play-shield" aria-hidden="true" />}
    <div className={`playbar ${failed ? 'failed' : ''}`} role="status" aria-live="polite">
      <div className="playbar-text">
        <span className="playbar-meta">{failed ? 'Autoplay stopped' : p.paused ? 'Paused' : `Playing the story · ${p.speed}×`}</span>
        <b className="playbar-title">
          Step {p.step} · {p.title}
        </b>
        <span className="playbar-doing">{failed ? p.error : p.doing}</span>
      </div>
      <div className="playbar-ctl">
        {failed ? (
          <>
            <button className="btn sm" onClick={() => void play(svc)}>
              Play again
            </button>
            <button className="btn sm ghost" onClick={close}>
              Close
            </button>
          </>
        ) : (
          <>
            <button className="btn sm light" onClick={() => set({ paused: !p.paused })}>
              {p.paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn sm ghost" onClick={stop}>
              Stop
            </button>
            <div className="modeswitch" role="group" aria-label="Speed">
              {[1, 2].map((x) => (
                <button key={x} aria-pressed={p.speed === x} onClick={() => set({ speed: x })}>
                  {x}×
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <i className="playbar-progress" style={{ width: `${(p.step / TOTAL) * 100}%` }} aria-hidden="true" />
    </div>
    </>
  );
}

function TheEnd({ end }: { end: End }) {
  const svc = useService();
  const secs = Math.round(end.ms / 1000);
  return (
    <div className="play-end" role="dialog" aria-label="The story in short" onClick={close}>
      <Card tone="mustard" onClick={(e) => e.stopPropagation()}>
        <Meta>
          <span>Step {TOTAL} · That's the story</span>
          <span>
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} at {end.speed}×
          </span>
        </Meta>
        <Headline size="l" className="up">
          Paid without peeking
        </Headline>
        <ul className="play-facts">
          <li>
            <b>{night(end.paid)}</b> paid to {end.hospital} by the contract, the moment the proof checked out.
          </li>
          <li>
            <b>Kestrel Mutual saw no medical data:</b> no diagnosis, procedure, prescriptions or lab results.
          </li>
          <li>
            <b>The replay was rejected:</b> {end.replay}.
          </li>
          <li>
            <b>{end.trail} entries</b> on Rohan's on-chain audit trail, the break-glass in red.
          </li>
        </ul>
        <div className="row">
          <button className="btn big" onClick={() => void play(svc)}>
            Play again
          </button>
          <button className="btn ghost" onClick={close}>
            Close
          </button>
        </div>
      </Card>
    </div>
  );
}
