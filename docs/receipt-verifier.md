# Settlement receipt: check a payout without a wallet

A paid claim gets a **receipt**: a link that holds only the claim's public ledger values. Anyone can open it in a clean browser, with no wallet. The page reads the contract's public state from an indexer fixed when the page was built, and says whether the ledger agrees.

It shows that the contract's public state records this settlement. It does not re-check the zero-knowledge proof offline.

## How a judge uses it

1. In **Live mode**, click **Get receipt**. It is on two cards:
   - the hospital's PAID card, right after **Prove & submit claim**;
   - any settled claim in the insurer's **Claims** feed.

   The dialog shows a QR code, **Open the verifier** and **Copy link**. In Demo mode, the button explains that a demo settlement lives only in that tab's simulator, so there is nothing on a chain to check.
2. Open the link in a browser that has never seen the app:
   - **Local devnet:** use a second browser on the demo laptop. A QR code that points at `localhost` can't reach the laptop from a phone.
   - **Hosted Preprod site:** any browser or phone works.
3. The page reads the ledger and stamps one of three results:

   | Result | Card | When |
   | --- | --- | --- |
   | **Matches** | green | The trusted indexer answered, and `claims.lookup(nullifier)` equals the receipt's policy, amount and time, in the receipt's contract. |
   | **Does not match** | red | The indexer answered, and it disagrees. The page lists each field that differs and the ledger's value. Also shown when no contract exists at that address, or none holds that nullifier, or the build pins another deployment. |
   | **Cannot verify** | yellow | Nothing was confirmed. The cause is one of: the indexer can't be reached or gives a bad answer; the state won't decode as a zkClaim ledger; the receipt is malformed; or the receipt is for another network. This result is never green. |

4. Change one digit of **Amount paid** and press **Check again**. The result is **Does not match**, with the ledger's real amount. **Back to the receipt** restores the original.
5. Scroll to **On the wire**. It shows the exact request, the raw response, and the values decoded with the contract's own `ledger()`.

### What the response contains

The response is the contract's whole public state: the same bytes anyone on the network can read. That covers commitments, hashes, public keys, the audit trail, and the IPFS addresses of sealed (encrypted) cards and records.

It holds no name, diagnosis, procedure, prescription, card code, secret key or witness.

The indexer has no query for a single map entry, so the record and card CIDs can't be left out of the response.

## The receipt

```
verify.html#v=1&net=undeployed&contract=<64 hex>&nullifier=<64 hex>&policy=<64 hex>&amount=<base units>&at=<unix seconds>
```

- The receipt lives in the URL **hash**. Browsers never send the hash to the server, so hosting logs never see it.
- The fields are:
  - `v`: the receipt format version, now `1`;
  - `net`: the Midnight network id;
  - `contract`: the contract address;
  - `nullifier`: the claim's key in `claims`;
  - `policy`: the policy commitment stored with the settlement;
  - `amount`: integer base units, where 1 NIGHT = 1,000,000;
  - `at`: `Settlement.at`.
- Decoding is strict. A receipt must have exactly these keys, once each, so a link that adds `indexer=` is refused.
- The receipt never reuses the policy card's QR payload, which carries the holder, the terms and the salt.
- The receipt has no block hash or height. The live adapter returns only the circuit's private result, not the block it landed in. Instead, the verifier shows the block height and hash of the contract state it read.

Code:
- `ui/src/verify/receipt.ts`: the format and the match rules, with no imports.
- `ui/src/verify/ledger.ts`: the read.
- `ui/src/verify/Verify.tsx`: the page.
- `ui/src/zk/receipt.tsx`: the **Get receipt** dialog.
- `npm run demo` also prints a receipt link for its own payout.

## What the page trusts (fixed per build)

| Build | `VITE_NETWORK_ID` | Indexer |
| --- | --- | --- |
| Local devnet (default) | unset or `undeployed` | `http://127.0.0.1:8088/api/v4/graphql` |
| Preprod | `preprod` | `/api/indexer`, this site's own Vercel function, which forwards to Blockfrost |

- **Deployment pin.** Set `VITE_VERIFY_CONTRACT=<address>` at build time to pin one deployment. Every receipt for another contract then shows **Does not match**. Without a pin, the page accepts any contract on its network and says so. In that case, compare the contract in the receipt with the deployment you published.
- **Rebuild with the contract.** The page decodes state with this build's `ledger()`. Rebuild it whenever the contract changes. A layout it can't decode shows **Cannot verify**.
- **Imports.** The verifier imports nothing from the role app: no identities, wallet, private state, IPFS or browser storage. Only the design system (`ui/src/zk/ds.tsx`, `ds.css`) is shared.

## Hosted Preprod: Blockfrost key and Vercel function

Midnight's own Preprod indexer is gone; Blockfrost serves Preprod data, and every request needs a project key.

The browser never sees the key. The page POSTs to `/api/indexer` on its own origin. The function there adds the key on the server and forwards the request.

The function forwards only the verifier's one query, for a 64-hex address. Anything else gets HTTP 400, so nobody can spend the quota on other queries.

### Steps for the user (once)

1. **Create the Blockfrost project.**
   1. Sign in at https://blockfrost.io and click **Add project**.
   2. Pick the network **Midnight Preprod**. Each network needs its own project, and a key for another network gets 403 "Network token mismatch".
   3. Copy the project ID. It starts with `nightpreprod`. The free plan allows 50,000 requests a day.
2. **Give the key to Vercel**, without putting it in any file. Use either way:
   - **Dashboard:** open project **zkclaim**, then **Settings → Environment Variables**. Name it `BLOCKFROST_PROJECT_ID`, paste the value, tick **Production**, and **Save**.
   - **CLI:** run the command below. It prompts for the value; don't pipe the key in with `echo`, which leaves it in shell history.

     ```powershell
     vercel env add BLOCKFROST_PROJECT_ID production --project zkclaim
     ```

   A variable applies only to deployments made after it is set, so deploy again.
3. **Check the project's build settings.** The deploy uploads `ui/dist` as it is, so Vercel must not try to build it. Under **Settings → Build and Deployment**, set:
   - **Framework Preset**: Other;
   - **Build Command**: override on, left empty;
   - **Output Directory**: default;
   - **Root Directory**: empty.

   A Vite preset or a build command would fail, because `ui/dist` has no `package.json`.

### Build and deploy (the lead)

Build with the Preprod network, and pin the deployment the judges will check:

```powershell
$env:VITE_NETWORK_ID = 'preprod'; $env:VITE_VERIFY_CONTRACT = '<preprod contract address>'; npm run build -w ui
```

Then deploy:

```powershell
vercel deploy ui/dist --prod --project zkclaim
```

`VITE_NETWORK_ID=preprod` also makes Preprod the live gate's default network.

Check the deploy in three places:
- `https://zkclaim.vercel.app/verify.html` lists `/api/indexer` under **What this page trusts**.
- A receipt from a Preprod claim shows **Matches**.
- A bare POST to `https://zkclaim.vercel.app/api/indexer` returns 400 "Only the zkClaim receipt query is forwarded", and 500 if the key is missing.

### File layout Vercel needs

```
ui/api/indexer.mjs            source of the function (Web-standard handler: export default { fetch })
  └─ vite build copies it to
ui/dist/api/indexer.mjs       Vercel runs every file in the deployment's api/ folder as a function -> /api/indexer
ui/dist/verify.html           the verifier page (a second Vite input), served as is
ui/dist/index.html            the role app
```

- **Copying.** A small plugin in `ui/vite.config.ts` copies the function into `dist` on every build.
- **`.mjs`.** The extension makes it ES module code without a `package.json`.
- **No `vercel.json`.** The function needs no dependencies, and the defaults serve `/verify.html` as is (`cleanUrls` is off).

## Tests

```powershell
node --test ui/src/verify/receipt.test.mjs
```

The tests cover:
- the receipt round trip and its allowlist;
- the hash-only link;
- strict decoding;
- the match rules: one changed digit, another contract, a missing claim, another network, a pinned build;
- an unreachable indexer, which gives **Cannot verify** and never a match;
- the proxy: the forwarded query equals the page's query, the key goes only in the upstream header, other queries are refused before reaching Blockfrost, and no error text contains the key.

## Limits

- **A recorded settlement, not a proof check.** A match means the contract's public state records this settlement. It is not an offline verification of the zero-knowledge proof.
- **Payee and transaction.** The settlement map stores no payee, so the receipt doesn't vouch for who was paid or for a specific transaction.
- **Indexer lag.** A claim paid seconds ago may not be indexed yet. Preprod's indexer trails confirmed transactions. The page then shows **Does not match** and suggests checking again in a minute.
- **Shared rate limit on Preprod.** Every visitor's check goes through the one Blockfrost key, so all checks share its daily quota and the per-IP rate of Vercel's servers.
