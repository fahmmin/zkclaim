// "Get receipt": a QR code and a link to the wallet-free verifier (verify.html) for one settled claim. Live mode only:
// a demo settlement lives in this tab's simulator, so there is no chain for anyone else to check.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { receiptUrl } from '../verify/receipt';
import { useSnap } from './ctx';
import { Card, Headline, Meta, QR } from './ds';
import { copy } from './screens/Patient';
import { type Claim, night } from './service';

export function GetReceipt({ claim }: { claim: Claim }) {
  const s = useSnap();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);
  const url = s.mode === 'live' && s.contract ? receiptUrl({ network: s.network, contract: s.contract, nullifier: claim.nullifier, policy: claim.policy, amount: claim.amount, at: BigInt(claim.at) }, location.href) : '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Get receipt
      </button>
      {open &&
        // In a portal: the claim's card isolates z-index, which would put later cards over the overlay.
        createPortal(
          <div className="qr-overlay" role="dialog" aria-modal="true" aria-label="Settlement receipt" style={{ overflowY: 'auto' }} onClick={close}>
            <Card tone="paper" onClick={(e) => e.stopPropagation()}>
              <Meta>
                <span>Settlement receipt</span>
                <span>{night(claim.amount)}</span>
              </Meta>
              {url ? (
                <>
                  <Headline size="m">Check this payout without us</Headline>
                  <QR text={url} size={300} label="Receipt QR code" />
                  <p className="small">Any browser, no wallet: the verifier reads {s.network === 'preprod' ? 'Midnight Preprod' : 'the local devnet'} itself and compares the amount, policy and time with the contract’s ledger. The link holds public values only, no names, records or card codes.</p>
                  {local && <p className="small">This link points at this computer (localhost): open it in a second browser here. A phone can’t reach it.</p>}
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <a className="btn" href={url} target="_blank" rel="noreferrer" autoFocus>
                      Open the verifier
                    </a>
                    <button type="button" className="btn ghost" onClick={() => copy(url, 'Receipt link')}>
                      Copy link
                    </button>
                    <button type="button" className="btn ghost" onClick={close}>
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Headline size="m">No receipt in Demo mode</Headline>
                  <p className="small">This claim was settled by the contract’s circuits running in this tab, not on a chain, so a verifier would have nothing to check. A claim paid in Live mode gets a receipt that any browser can check against the network.</p>
                  <button type="button" className="btn" onClick={close} autoFocus>
                    Done
                  </button>
                </>
              )}
            </Card>
          </div>,
          document.querySelector('.zk') ?? document.body,
        )}
    </>
  );
}
