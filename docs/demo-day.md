# Demo day: bringing up the staged judge demo

The judges' live transactions run on the **local devnet**, staged on 24 Nov 2026. Preprod can't take new transactions from 1AM: Midnight shut down `rpc.preprod.midnight.network` on 23 Nov 2026, and this 1AM build hard-codes that node.

| | Local devnet (live demo) | Preprod (receipt only) |
|---|---|---|
| Contract | `aab1fd59a08c09e6570be02c0dc5f7bf2d5eca3c0682f5471971e23a3626320a` | `1e8938d2a231357b02962058f15d1b236702564c8d98475d65e4f0020511e977` |
| A, angioplasty, 400 NIGHT | paid: the warm-up and the fallback receipt | paid |
| B, knee replacement, 350 NIGHT | consented, unpaid: **the hospital claims it live** | consented |
| C, emergency visit, 150 NIGHT | consented, unpaid: **the patient withdraws it live** | withdrawn |

## Bring-up (about 5 minutes)

1. Start Docker Desktop and wait for "Engine running". The four containers restart by themselves (`unless-stopped`). If they don't, run `npm run env:up`.
2. Check that the node is producing blocks: its height should be above 4555 and climbing.
3. Start the app with `npm run dev -w ui`, leaving `VITE_NETWORK_ID` unset, and open http://localhost:5173. Keep `ui/.env.development.local`: it pins the verifier to the local contract.
4. Open the wallet browser with `npm run e2e:open -- insurer`. Unlock 1AM yourself and check it shows the **Local** network (UNDEPLOYED) and the **Local** prover.
5. Reload the localhost tab, click **Connect 1AM**, then **Join**. The address is pre-filled with `aab1fd59…`.

## On stage

1. **Hospital** claims B. It takes about 55 s to prove, then pays 350.
2. **Patient** withdraws C. It takes about 50 s.
3. **Hospital** tries to claim C. The refusal is immediate: "Patient has not consented to this claim". The paid total does not move.
4. Click **Get receipt** on a paid claim and open it in a second browser window. It shows **Matches**. Change one digit of the amount, click **Check again**, and it shows **Does not match**.
5. **Public-chain receipt, from any phone, with no wallet.** Receipt A on Preprod:
   https://zkclaim.vercel.app/verify.html#v=1&net=preprod&contract=1e8938d2a231357b02962058f15d1b236702564c8d98475d65e4f0020511e977&nullifier=730cdf5ac0362369fd86226e6bbc0eeaf82df81967a01f69b841a63ef0e61287&policy=cd834be2ecf2ec435bec914396d6f39d6b6490b9e72e70f10be310317f08ed26&amount=400000000&at=1795460759

If proving runs past your slot, show A's receipt instead and say plainly that it is an earlier settlement from the same chain.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "1AM has no DUST coin ready to pay the fee" | Top up 1AM's local wallet, then retry: `npm run fund -- mn_addr_undeployed1kkvkz5hkwxex78cv6mfsf6d2c4xjy83x2f3s2pm74khzxrhn9h4qmeq6fr` |
| Indexer "Failed to fetch", or the node stopped | Docker restarts the containers. Wait for blocks, then reload the tab, **Connect** and **Join**. |
| The app tab is stuck on a step | Reload the tab, then **Connect** and **Join**. Nothing is lost: the cast and the contract are saved in the browser. |
| CLI fallback, no browser wallet | `npm run demo`: real proofs on the same devnet, using a new contract |

## Never, before judging

- **Don't run `npm run env:down` or `docker compose down`, don't use `--force-recreate`, and don't edit `docker-compose.yml`.** The containers have no volumes, so recreating them erases the chain, the indexer and the IPFS blobs, and with them the staged contract.
- **Don't fund the pool on stage.** It spends the NIGHT behind 1AM's only DUST coin.
- **Don't clear site data for localhost:5173 in the wallet browser.** It holds the cast and the contract.
