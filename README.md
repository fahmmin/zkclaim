# zkClaim

**Private insurance claims on Midnight.** Hackasol 5.0, Track 4 (Web3), problem W3-01.

zkClaim lets a hospital get an insurance claim paid without showing the insurer the patient's medical details. The hospital proves with a zero-knowledge proof that the claim comes from an approved hospital, under an active policy, for a covered procedure, within the limit, with the patient's consent. A Midnight contract checks the proof and pays the hospital in the same transaction. The insurer sees the amount and the policy it is paid from, never the diagnosis, the procedure or the prescriptions. Patients keep their records as encrypted FHIR bundles on IPFS, grant and revoke access by role, and see every view in an on-chain audit trail. Emergency responders can break the glass, and that is logged too.

The chain, the proof server and the IPFS node all run locally in Docker, so the demo does not rely on venue wi-fi.

**Docs:** [architecture](docs/architecture.md) · [threat model](docs/threat-model.md) · [demo-video script](docs/demo-video.md) · [pitch and live-demo run sheet](docs/pitch.md)

## W3-01 checklist

| Requirement | Status | Where |
|---|---|---|
| ZK proof: claim from a licensed hospital on an approved list (Merkle membership) | Done, tested | `approvedHospitalPk` in [`contract/src/zkclaim.compact`](contract/src/zkclaim.compact) |
| ZK proof: active policy (expiry later than the claim date) | Done, tested | `submitClaim` step 3 |
| ZK proof: procedure in the covered set, amount within the limit | Done, tested | `submitClaim` step 5 |
| Diagnosis, procedure and prescriptions never revealed | Done, tested | witnesses and encrypted records; privacy test in [`contract/src/test/zkclaim.test.ts`](contract/src/test/zkclaim.test.ts) |
| Contract verifies the proof, rejects replays (nullifier), pays automatically | Done, tested on the devnet | `submitClaim`; `npm run demo` |
| Records encrypted off-chain (IPFS), only hashes on-chain | Done | `anchorRecord`; [`records/`](records/); `npm run demo:access` |
| Patient grants and revokes a doctor's access | Done, tested | `setAccess` (named actions `grantAccess`, `revokeAccess`) |
| Three-role interface: Patient → Hospital → Insurer | See [status](#status) | [`ui/`](ui/) |
| Public inputs: claim amount, policy commitment, nullifier, hospital-list root | Done | disclosed in `submitClaim` |
| Bonus: time-bound and role-based access with an on-chain audit trail | Done, tested | `Grant`, `logView`, `audit` |
| Bonus: emergency break-glass, fully logged | Done, tested | `logView` with a reason, responders approved through `admin`, emergency key fixed at deploy |
| Bonus: lab and pharmacy sharing with HL7 FHIR records | Done | FHIR R4 bundles, one key per section, roles doctor/lab/pharmacy |
| Deliverable: contracts on a local chain | Done | [`docker-compose.yml`](docker-compose.yml) |
| Deliverable: architecture and threat-model diagrams | Done | [`docs/`](docs/) |

The contract has 39 simulator tests covering the happy path, every claim rejection, roles, records and access, break-glass and a privacy scan of the whole public state. The records library has 40 tests of its own.

## Status

As of 23 November 2026:

- **Contract:** claim proof, payout, records, grants, audit trail and break-glass are done, with 39 tests, in 8 circuits. Drafts with 12 and 15 circuits were too big for the node to accept in a block; see the [deploy-size note](docs/architecture.md#engineering-note-deploy-size-and-block-limits).
- **CLI:** `npm run demo` runs a claim with real proofs on the local devnet; `npm run demo:access` does the same for records, grants, revoke and break-glass.
- **Records library:** done: FHIR R4 bundles, per-section AES-256-GCM, X25519 key wrapping (ECIES on WebCrypto), sealed policy cards, Kubo and in-memory stores.
- **App:** in progress: demo mode first (insurer, hospital, patient, care team, emergency responder, tamper lab), then live mode on 1AM.
- **Not built:** shielded payout (the payee is public today), public testnet deployment.

## Quick start

You need:

- Docker Desktop, running.
- Node.js 22 or newer.
- The Compact compiler 0.36.1 (`compact update 0.36.1`). Compact has no Windows build: on Windows install it inside WSL, and `npm run compile` calls it through `wsl` for you.

Then:

```sh
npm install
npm run compile      # contract + proving keys into contract/src/managed (Compact runs in WSL on Windows)
npm run env:up       # on 127.0.0.1: node :9944, indexer :8088, proof server :6300, Kubo IPFS :5001 (offline)
npm test             # contract simulator tests and records-library tests
npm run demo         # headless claim with real proofs: deploy, fund, approve, issue, anchor, consent, claim, replay
npm run demo:access  # headless records flow: seal to IPFS, grant, view, revoke, break-glass
npm run ui           # the app on http://localhost:5173
```

`npm run env:down` stops the devnet. `npm test` and `npm run ui` in demo mode do not need the devnet (the Kubo store tests are skipped when Kubo is not running).

## Demo mode and live mode

The app has a Demo/Live switch.

- **Demo mode** runs the contract's real compiled circuit logic inside the page (`ClaimSimulator` in [`contract/src/simulator.ts`](contract/src/simulator.ts)) with an in-memory store instead of IPFS. No wallet, no chain, no proofs. Every check and every rejection message comes from the same contract code. Use it for rehearsals, video takes and the tamper lab.
- **Live mode** (in progress) uses the 1AM wallet on the local devnet: real proofs from the local proof server, real transactions, real NIGHT payouts, records on the local Kubo node.

For real proofs without a browser wallet, and as the stage fallback, `npm run demo` runs the same claim headless.

## 1AM wallet setup (live mode)

Full steps are in [`e2e/README.md`](e2e/README.md). In short:

1. Download the 1AM beta (it lists the Local network), check its SHA-256, unzip it to `e2e/.extensions/1am`.
2. `npm run env:up` and `npm run ui`, then `npm run e2e:open -- insurer` (or `hospital`, `patient`). Each role gets its own browser profile and wallet.
3. In 1AM: create a wallet on **Local**, then Settings → Proof Server → **Local** (`http://localhost:6300`), so private inputs never leave the machine.
4. Fund it from the devnet's genesis wallet: `npm run fund -- <mn_addr_undeployed1…>`. Turn on DUST generation in 1AM and wait for DUST before sending transactions.

`npm run e2e` then drives the real wallet: connect, fund, deploy zkClaim, sign a call.

## Repository layout

```
contract/            Compact contract, witnesses, in-memory simulator, tests
  src/zkclaim.compact
  src/test/zkclaim.test.ts
records/             FHIR R4 bundles, per-section AES-256-GCM, X25519 key wrapping, IPFS store
cli/                 headless demos and the local faucet
  src/demo.ts          claim flow with real proofs (the stage fallback)
  src/demo-access.ts   records, grants, revoke, break-glass with real proofs
  src/fund.ts          sends devnet NIGHT to browser wallets
ui/                  React app: insurer, hospital, patient, doctor/lab/pharmacy, responder, tamper lab
e2e/                 Playwright tests that drive the real 1AM wallet
docs/                architecture, threat model, demo-video script, pitch
docker-compose.yml   local devnet: node, indexer, proof server, IPFS
```

## Tech and versions

Midnight packages and Docker images are pinned to exact versions.

| Component | Version |
|---|---|
| Compact compiler | 0.36.1 |
| Compact language | 0.28 |
| Compact runtime | 0.21.0 |
| Midnight.js | 5.0.1 |
| Ledger | v9 (`@midnightntwrk/ledger-v9` 1.0.2) |
| Wallet SDK | 2.0.1 |
| DApp connector API | 4.1.0 |
| Proof server | 9.0.2 (`midnightntwrk/proof-server`) |
| Midnight node | 2.1.101 (`midnightntwrk/midnight-node`) |
| Indexer | 4.4.101 (`midnightntwrk/indexer-standalone`) |
| IPFS | Kubo v0.43.1 (`ipfs/kubo`), run offline |
| 1AM wallet | 6.4.20 beta |
| App | React 19, Vite 6.4.5, TypeScript 5.9.3 |
| Tests | Vitest 5.0.4, Playwright 1.65.1 |
| Node.js | 22 or newer |

## Credits

Parts of `cli/` and `ui/` are adapted from the Midnight Foundation's [midnight-examples](https://github.com/midnightntwrk/midnight-examples) (Apache-2.0). Each file keeps its notice:

- `cli/src/config.ts`, `cli/src/providers.ts`: from `examples/token-transfers`
- `cli/src/wallet.ts`: from `examples/private-tip-jar`
- `ui/vite.config.ts`, `ui/src/in-memory-private-state-provider.ts`: from `examples/leaderboard/ui`

zkClaim is released under Apache-2.0. All people, hospitals and insurers in the code, the app and the docs are fictional; no real health data is used.
