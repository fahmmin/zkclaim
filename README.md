<p align="center"><img src="ui/src/zk/assets/icon-192.png" width="96" alt="zkClaim logo"></p>

<h1 align="center">zkClaim</h1>

<p align="center"><b>Prove the claim. Protect the patient.</b><br>Private health-insurance claims on Midnight · Hackasol 5.0, Track 4 (Web3), W3-01</p>

zkClaim lets a hospital get an insurance claim paid without the insurer ever seeing the patient's medical details.

1. **The proof.** The hospital proves with one zero-knowledge proof that the claim follows every rule of the policy: approved hospital, active policy, covered procedure, within the limit, patient consent, and never claimed before.
2. **The payout.** A Midnight contract verifies the proof and pays the hospital in the same transaction. The insurer sees an amount, a policy fingerprint and a time, never the diagnosis, the procedure or the prescriptions.
3. **The records.** Patients keep their records as encrypted FHIR bundles. They can grant and revoke access by role, withdraw consent before payment, and see every view in an on-chain audit trail.

**Try it:** [zkclaim.vercel.app](https://zkclaim.vercel.app). Demo mode needs no wallet: press **Play the story**, or open the Tamper Lab.

## Highlights

| | What it does | Where |
| --- | --- | --- |
| **One proof, eight checks** | Approved hospital (private Merkle membership), policy issued, policy active, record anchored, procedure covered, within the limit across claims, patient consent, never claimed | `submitClaim` in [`contract/src/zkclaim.compact`](contract/src/zkclaim.compact) |
| **Automatic settlement** | The contract verifies and pays in one transaction. A nullifier stops replays. There is no reject button. | same |
| **Consent the patient controls** | Yes to one bill only; withdraw any time before it's paid. Whichever lands on the ledger first wins. | `consentToClaim(withdraw)` |
| **Wallet-free receipt** | Anyone checks a payout against the chain in a clean browser. Change one digit and it says Does not match. | [`ui/verify.html`](ui/verify.html), [docs/receipt-verifier.md](docs/receipt-verifier.md) |
| **Tamper Lab** | 15 ways to cheat a claim, each rejected by the contract's own logic | [`ui/src/zk/tamper.ts`](ui/src/zk/tamper.ts) |
| **Records by section** | FHIR R4 bundles with one AES-256-GCM key per section, wrapped with X25519 to each reader. Doctor, lab and pharmacy grants have an expiry, revoking re-encrypts, and every view is logged on-chain first. | [`records/`](records/), `setAccess`, `logView` |
| **Break-glass** | An approved responder gets one hour, with a written reason logged forever and shown to the patient | `logView` with a reason |
| **NHCX export** | A synthetic ClaimResponseBundle shows 0 errors against NRCeS IG 6.5.0 (with example.org identifiers allowed) | [docs/nhcx](docs/nhcx/README.md) |
| **Privacy scan** | After a full run, a test searches all public state for the patient's ID, salts and keys | [`contract/src/test/zkclaim.test.ts`](contract/src/test/zkclaim.test.ts) |

## What's verified

As of 24 November 2026:

- **Tests:**
  - 45 contract tests: every claim rejection, withdrawal races, roles, records, break-glass, and a privacy scan.
  - 46 records tests, including NHCX.
  - The UI typechecks and builds.
- **Real proofs on Midnight Preprod**, contract `1e8938d2…e977`, through the 1AM wallet:
  - the first claim was proved and paid: 400 NIGHT in 61 s;
  - a withdrawn claim was refused;
  - the receipt still verifies through the site's Blockfrost-backed indexer.
- **Local devnet:** the same contract runs with real proofs through `npm run demo` and in the app with 1AM. The judge demo is staged there; see [docs/demo-day.md](docs/demo-day.md).
- **Preprod:** Midnight retired the Preprod node that this 1AM build uses on 23 Nov 2026, so new Preprod transactions from 1AM wait on a wallet update.

## W3-01 checklist

| Requirement | Status |
| --- | --- |
| ZK proof: licensed hospital on an approved list (Merkle membership) | Done, tested |
| ZK proof: active policy, covered procedure, amount within the limit | Done, tested |
| Diagnosis, procedure and prescriptions never revealed | Done, tested (privacy scan) |
| Contract verifies the proof, rejects replays (nullifier), pays automatically | Done, real proofs on the devnet and Preprod |
| Records encrypted off-chain (IPFS), only commitments on-chain | Done |
| Patient grants and revokes access | Done, tested |
| Three-role interface: Patient → Hospital → Insurer | Done: Demo and Live modes, laptop and phone |
| Bonus: time-bound and role-based access with an on-chain audit trail | Done, tested |
| Bonus: emergency break-glass, fully logged | Done, tested |
| Bonus: lab and pharmacy sharing with HL7 FHIR | Done |
| Extra: patient withdraws consent before payment | Done, tested, live on Preprod |
| Extra: wallet-free settlement receipt | Done |
| Extra: NHCX ClaimResponse export | Done (synthetic sample) |
| Deliverables: contracts on a local chain and a testnet, front end, architecture and threat-model diagrams | Done |

## Quick start

You need Docker Desktop (running), Node.js 22 or newer, and the Compact compiler 0.36.1 (`compact update 0.36.1`). Compact has no Windows build: on Windows install it in WSL, and `npm run compile` calls it through `wsl` for you.

```sh
npm install
npm run compile      # contract + proving keys into contract/src/managed
npm run env:up       # 127.0.0.1: node :9944, indexer :8088, proof server :6300, Kubo IPFS :5001 (offline)
npm test             # contract simulator tests and records tests
npm run demo         # headless claim with real proofs: deploy, fund, approve, issue, anchor, consent, claim, withdraw, replay
npm run demo:access  # headless records flow: seal to IPFS, grant, view, revoke, break-glass
npm run ui           # the app on http://localhost:5173
```

`npm test`, and `npm run ui` in Demo mode, don't need the devnet.

## Demo mode and Live mode

- **Demo mode** runs the contract's compiled circuit logic inside the page ([`contract/src/simulator.ts`](contract/src/simulator.ts)). No wallet and no chain, but every check and rejection message is the contract's own. Use it for rehearsals and the Tamper Lab.
- **Live mode** uses the 1AM wallet: real proofs from the local proof server, real transactions and NIGHT payouts, and records on IPFS. 1AM setup and the Synpress-style browser harness are in [`e2e/README.md`](e2e/README.md).

## Docs

| | |
| --- | --- |
| [Architecture](docs/architecture.md) | Components, the claim sequence, on-chain versus off-chain data, the deploy-size note |
| [Threat model](docs/threat-model.md) | Assets, attackers, mitigations and residual risks |
| [Pitch](docs/pitch.md) | Timed pitch script, live-demo run sheet, fallbacks, Q&A |
| [Demo day](docs/demo-day.md) | Bringing up the staged judge demo on the local devnet |
| [Receipt verifier](docs/receipt-verifier.md) | How a judge checks a payout with no wallet |
| [NHCX export](docs/nhcx/README.md) | The ClaimResponseBundle mapping and its validator reports |
| [Film script](docs/demo-video.md) | "The Claim", the 2-minute film |

The film and the recorded product demo are built by the scripts in [`videos/edit`](videos/edit/README.md). The footage and renders aren't in the repository.

## Repository layout

```
contract/            Compact contract (8 circuits), witnesses, simulator, actions, tests
records/             FHIR R4 bundles, per-section encryption, key wrapping, policy cards, IPFS store, NHCX export
cli/                 headless demos with real proofs, and the local faucet
ui/                  React app: insurer, hospital, patient, care team, responder, Tamper Lab, receipt verifier
  api/indexer.mjs      Vercel function: Preprod indexer proxy (the Blockfrost key stays server-side)
e2e/                 Playwright harness that drives the real 1AM wallet
docs/                architecture, threat model, pitch, demo day, receipt verifier, NHCX
videos/edit/         scripts that record the app and build the film and the demo video
docker-compose.yml   local devnet: node, indexer, proof server, IPFS
```

## Tech and versions

All pinned to exact versions:

| Component | Version |
| --- | --- |
| Compact compiler | 0.36.1 |
| Compact language | 0.28 |
| Compact runtime | 0.21.0 |
| Midnight.js | 5.0.1 |
| Ledger | v9 (`@midnightntwrk/ledger-v9` 1.0.2) |
| Wallet SDK | 2.0.1 |
| DApp connector API | 4.1.0 |
| Proof server | 9.0.2 |
| Midnight node | 2.1.101 |
| Indexer | 4.4.101 |
| IPFS | Kubo v0.43.1, offline |
| 1AM wallet | 6.4.20 beta |
| App | React 19, Vite 6.4.5, TypeScript 5.9.3 |
| Tests | Vitest 5.0.4, Playwright 1.65.1 |

## Credits

Parts of `cli/` and `ui/` are adapted from the Midnight Foundation's [midnight-examples](https://github.com/midnightntwrk/midnight-examples) (Apache-2.0), and each file keeps its notice:
- `cli/src/config.ts`, `cli/src/providers.ts`: from `examples/token-transfers`;
- `cli/src/wallet.ts`: from `examples/private-tip-jar`;
- `ui/vite.config.ts`, `ui/src/in-memory-private-state-provider.ts`: from `examples/leaderboard/ui`.

All people, hospitals and insurers in the code, the app and the docs are fictional, and no real health data is used. There is no license file yet; add one before making the repository public.
