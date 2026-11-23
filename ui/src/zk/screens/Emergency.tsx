import { useState } from 'react';
import { Asterisk, Pixel } from '../art';
import { Card, Headline, Meta } from '../ds';
import { date, type OpenedRecord, reason, until } from '../service';
import { useService, useSnap } from '../ctx';
import { Sections, TrailList } from './Patient';

export default function Emergency() {
  const s = useSnap();
  const svc = useService();
  const [as, setAs] = useState('unit7');
  const [recordId, setRecordId] = useState('');
  const [why, setWhy] = useState('Unconscious after a road accident. Need allergies and current medicines before surgery.');
  const [opened, setOpened] = useState<OpenedRecord | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const record = s.records.find((r) => r.id === recordId) ?? s.records[0];

  const breakGlass = async () => {
    if (!record) return;
    setOpened(null);
    setDenied(null);
    try {
      setOpened(await svc.breakGlass(record.id, why, as));
    } catch (e) {
      setDenied(reason(e));
    }
  };

  return (
    <div className="bento">
      <Card tone="tomato" className="s7 r2 glass">
        <Meta>
          <span>Emergency access</span>
          <span>Logged on-chain</span>
        </Meta>
        <p className="outline-text glass-big">
          Break
          <br />
          the glass
        </p>
        <Pixel art="siren" scale={8} className="glass-siren" />
        <div className="grid2">
          <label className="field">
            <span>Responder</span>
            <select value={as} onChange={(e) => setAs(e.target.value)}>
              {s.responders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.approved ? '' : ' (not approved)'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Patient record</span>
            <select value={record?.id ?? ''} onChange={(e) => setRecordId(e.target.value)} disabled={!record}>
              {s.records.length === 0 && <option>No records anchored yet</option>}
              {s.records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.patientName}: {r.hospitalName}, {date(r.createdAt)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Reason (goes on the record forever)</span>
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} />
        </label>
        <button className="btn big" disabled={!record || !why.trim() || !!s.busy} onClick={breakGlass}>
          Break the glass
        </button>
        <p className="small">Access lasts one hour. The patient sees this entry in red on their phone, with your name and reason.</p>
      </Card>

      <Card tone="ink" className="s5">
        {opened ? (
          <>
            <Meta>
              <span>Emergency view</span>
              <span>{until(opened.until, s.now)}</span>
            </Meta>
            <Headline size="m">{opened.title}</Headline>
            <Sections record={opened} visible={opened.visible} />
          </>
        ) : denied ? (
          <>
            <Meta>
              <span>Emergency view</span>
              <span>Nothing decrypted</span>
            </Meta>
            <div className="denied shake" role="alert">
              <strong>Glass stays shut</strong>
              <span className="data">{denied}</span>
              <span className="small">Only responders the insurer approved can break the glass.</span>
            </div>
          </>
        ) : (
          <>
            <Meta>
              <span>Emergency view</span>
              <span>Sealed</span>
            </Meta>
            <div className="empty">
              <Asterisk size={64} colour="tomato" />
              <p>Allergies, medicines and diagnosis appear here after you break the glass. Nothing else.</p>
            </div>
          </>
        )}
      </Card>

      <Card tone="paper" className="s5">
        <Meta>
          <span>Break-glass log</span>
          <span>{s.audit.filter((a) => a.kind === 'breakGlass').length === 1 ? '1 entry' : `${s.audit.filter((a) => a.kind === 'breakGlass').length} entries`}</span>
        </Meta>
        <TrailList entries={s.audit.filter((a) => a.kind === 'breakGlass')} empty="No emergency access yet." />
      </Card>
    </div>
  );
}
