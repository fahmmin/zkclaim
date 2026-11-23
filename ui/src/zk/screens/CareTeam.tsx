import { useEffect, useState } from 'react';
import { Pixel, type Sprite } from '../art';
import { Card, Headline, Meta } from '../ds';
import { date, fingerprint, type GranteeRole, type OpenedRecord, reason, ROLE_SECTIONS, ROLE_TITLES, SECTION_TITLES, time, until } from '../service';
import { useService, useSnap } from '../ctx';
import { Sections } from './Patient';

const LOOK: Record<GranteeRole, { tone: 'tomato' | 'leaf' | 'orange'; art: Sprite }> = {
  doctor: { tone: 'tomato', art: 'heart' },
  lab: { tone: 'leaf', art: 'flask' },
  pharmacy: { tone: 'orange', art: 'pill' },
};

export default function CareTeam({ role }: { role: GranteeRole }) {
  const s = useSnap();
  const svc = useService();
  const [opened, setOpened] = useState<OpenedRecord | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  useEffect(() => {
    setOpened(null);
    setDenied(null);
  }, [role]);
  const shared = s.grants.filter((g) => g.role === role);
  const me = s.people[role];
  const look = LOOK[role];

  const open = async (recordId: string) => {
    setDenied(null);
    setOpened(null);
    try {
      setOpened(await svc.openShared(recordId, role));
    } catch (e) {
      setDenied(reason(e));
    }
  };

  return (
    <div className="bento">
      <Card tone="paper" className="s5">
        <Meta>
          <span>Care team</span>
          <span>{me}</span>
        </Meta>
        <div className="chips" role="group" aria-label="Role">
          {(['doctor', 'lab', 'pharmacy'] as GranteeRole[]).map((r) => (
            <a key={r} className={`chip ${r === role ? 'on' : ''}`} href={`#/care/${r}`} aria-current={r === role ? 'page' : undefined} style={{ textDecoration: 'none' }}>
              {ROLE_TITLES[r]}
            </a>
          ))}
        </div>
        <div className="row">
          <Headline size="m" className="grow">
            Shared with me
          </Headline>
          <Pixel art={look.art} scale={4} />
        </div>
        {shared.length === 0 ? (
          <p className="small">Nothing shared with {me} yet. Patients grant access from their phone, for as long as they choose.</p>
        ) : (
          <ul className="list">
            {shared.map((g) => {
              const state = g.revokedAt !== null ? 'Revoked' : (g.expiresAt ?? 0) <= s.now ? 'Expired' : until(g.expiresAt!, s.now);
              return (
                <li key={g.record}>
                  <div className="grow">
                    <b>Record {fingerprint(g.record)}</b>
                    <div className="small">
                      Shared {date(g.grantedAt)} at {time(g.grantedAt)}
                    </div>
                  </div>
                  <span className={`chip ${state === 'Revoked' || state === 'Expired' ? 'red' : 'ok'}`}>{state}</span>
                  <button className="btn sm" disabled={!!s.busy} onClick={() => open(g.record)}>
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="small">You see: {ROLE_SECTIONS[role].map((x) => SECTION_TITLES[x].toLowerCase()).join(', ')}. Opening writes your name to the patient's audit trail first.</p>
      </Card>

      <Card tone={look.tone} className="s7 viewer">
        {opened ? (
          <>
            <Meta>
              <span>Opened {time(s.now)}</span>
              <span>Logged on the audit trail</span>
            </Meta>
            <Headline size="m">{opened.title}</Headline>
            <p className="small">Access {until(opened.until, s.now)}. Only your part was decrypted; the rest of the record stays sealed.</p>
            <Sections record={opened} visible={opened.visible} />
          </>
        ) : denied ? (
          <>
            <Meta>
              <span>{ROLE_TITLES[role]}</span>
              <span>Nothing decrypted</span>
            </Meta>
            <div className="denied shake" role="alert">
              <strong>Access denied</strong>
              <span className="data">{denied}</span>
              <span className="small">Ask the patient for a new grant. Their phone is the only place it can come from.</span>
            </div>
          </>
        ) : (
          <>
            <Meta>
              <span>Viewer</span>
              <span>{ROLE_TITLES[role]}</span>
            </Meta>
            <div className="empty">
              <Pixel art={look.art} scale={8} />
              <p>Open a shared record. The view is logged first, then only the {ROLE_TITLES[role].toLowerCase()} sections are decrypted on this screen.</p>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

