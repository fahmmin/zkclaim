import { Asterisk, Clover, Daisy, FlowerBadge, Pixel } from '../art';
import { PlayButton } from '../autoplay';
import { Card, Headline, Meta } from '../ds';
import { useSnap } from '../ctx';
import { night } from '../service';
import { ATTACKS } from '../tamper';

export default function Landing() {
  const s = useSnap();
  return (
    <div className="bento landing">
      <Card tone="cobalt" className="s7 r2 hero">
        <Meta>
          <Pixel art="lock" scale={3} label="Private" />
          <span>zkClaim × Midnight</span>
        </Meta>
        <div className="halftone" style={{ right: -60, bottom: -60, width: 460, height: 460 }} />
        <Headline size="xl" className="up hero-hl" as="h1">
          Paid without peeking
        </Headline>
        <div className="hero-foot">
          <div className="stack" style={{ gap: 16 }}>
            <p className="lede">
              A hospital proves the claim is valid. The contract pays it on the spot. The insurer never sees the diagnosis, the procedure or the prescriptions.
            </p>
            <p className="hero-time">
              {s.claims.length} claim{s.claims.length === 1 ? '' : 's'} settled
              <br />
              {night(s.paid)} paid out
            </p>
            <div className="stack play-cta" style={{ gap: 8 }}>
              <PlayButton className="big light" />
              <p className="small">{s.mode === 'live' ? 'Autoplay runs in Demo mode: in Live mode every action waits for a 1AM approval.' : 'Hands-free, start to finish: every role, every screen.'}</p>
            </div>
          </div>
          <div className="hero-art">
            <Pixel art="computer" scale={12} className="hero-pix" />
            <Daisy face="happy" size={86} style={{ position: 'absolute', left: -34, top: -30 }} />
          </div>
        </div>
        <FlowerBadge size={128} style={{ right: -34, bottom: -30 }} />
      </Card>

      <Card tone="tomato" className="s5 role-card">
        <Meta>
          <Asterisk size={26} />
          <span>
            Claims desk
            <br />
            Kestrel Mutual
          </span>
        </Meta>
        <div className="row role-row">
          <Headline size="l" className="up grow">
            Insurer
          </Headline>
          <Pixel art="shield" scale={6} />
        </div>
        <p className="small">Funds the pool, approves hospitals, issues policy cards. Watches claims settle and cannot reject a valid one.</p>
        <a className="btn" href="#/insurer">
          Open the insurer desk
        </a>
      </Card>

      <Card tone="mustard" className="s5 r2 patient-card">
        <Meta>
          <Headline size="l" className="up">
            Patient
          </Headline>
          <span>
            Card, records, consent
            <span className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 8 }}>
              <Clover size={22} />
              <Clover size={22} />
              <Clover size={22} />
            </span>
          </span>
        </Meta>
        <p className="ask">
          Show
          <br />
          or tell?
        </p>
        <div className="daisies" aria-hidden="true">
          <Daisy face="smile" size={150} style={{ right: 70, bottom: 54 }} />
          <Daisy face="happy" size={116} style={{ right: -6, bottom: 150 }} />
          <Daisy face="wink" size={92} style={{ right: 160, bottom: 4 }} />
        </div>
        <p className="shout">
          Your diagnosis
          <br />
          never leaves your phone
        </p>
        <a className="btn" href="#/patient">
          Open the patient app
        </a>
        <FlowerBadge size={96} bg="paper" ring="ink" petal="ink" style={{ right: -26, bottom: -24 }} />
      </Card>

      <Card tone="teal" className="s4 split">
        <div>
          <Headline size="m" className="low">
            hospital desk
          </Headline>
          <p className="small">Admit by card, seal the record, prove the claim, get paid in seconds.</p>
          <a className="btn" href="#/hospital">
            Open the desk
          </a>
        </div>
        <div className="split-art">
          <Asterisk size={30} style={{ position: 'absolute', right: 16, top: 16 }} />
          <Pixel art="hospital" scale={7} />
        </div>
      </Card>

      <Card tone="paper" className="s3">
        <Meta>
          <span>Care team</span>
          <span>Shared slices only</span>
        </Meta>
        <Headline size="s">Doctor, lab, pharmacy</Headline>
        <p className="small">Each sees only the part the patient shared, and every look lands in the audit trail.</p>
        <div className="row">
          <a className="btn sm" href="#/care/doctor">
            <Pixel art="heart" scale={2} /> Doctor
          </a>
          <a className="btn sm" href="#/care/lab">
            <Pixel art="flask" scale={1.5} /> Lab
          </a>
          <a className="btn sm" href="#/care/pharmacy">
            <Pixel art="pill" scale={1.5} /> Pharmacy
          </a>
        </div>
      </Card>

      <Card tone="paper" className="s4 glass-card">
        <p className="outline-text glass-title">
          Break <Asterisk size={34} colour="purple" style={{ display: 'inline-block', position: 'relative', verticalAlign: 'middle' }} /> glass
          <br />
          one hour
        </p>
        <p className="small">An approved responder opens allergies and medicines in an emergency. The patient sees it in red, forever.</p>
        <div className="row">
          <a className="btn" href="#/emergency">
            Emergency access
          </a>
          <Pixel art="siren" scale={4} />
        </div>
      </Card>

      <Card tone="purple" className="s8 tamper-card">
        <Meta>
          <span />
          <span>{ATTACKS.length} attacks, 0 payouts</span>
        </Meta>
        <Headline size="l" className="up tamper-title">
          <span className="ring-word">Tamper</span> Lab
        </Headline>
        <div className="tamper-cols small">
          <p>
            Replay a paid claim
            <br />
            Borrow a hospital's proof
          </p>
          <p>
            Pad the bill
            <br />
            Skip the patient
          </p>
          <p>
            Each one runs against the contract
            <br />
            and is rejected by it
          </p>
        </div>
        <a className="btn light" href="#/tamper">
          Try to cheat
        </a>
      </Card>

      <Card tone="orange" className="s12">
        <Meta>
          <span>How it works</span>
          <span>Five steps, one proof</span>
        </Meta>
        <ol className="steps">
          <li>
            <b>Insurer issues a card</b>
            The terms ride on the patient's card. The chain only keeps a fingerprint.
          </li>
          <li>
            <b>Hospital treats</b>
            The record is encrypted for the patient, pinned to IPFS and anchored by its commitment.
          </li>
          <li>
            <b>Patient consents</b>
            One tap on the phone. The diagnosis stays there.
          </li>
          <li>
            <b>Hospital proves</b>
            Approved hospital, active policy, covered, within limit, consented, never claimed before.
          </li>
          <li>
            <b>Contract pays</b>
            Settled on the spot from the pool. No adjuster, no appeal, no peeking.
          </li>
        </ol>
      </Card>
    </div>
  );
}
