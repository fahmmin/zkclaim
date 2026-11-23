# zkClaim pitch: script, live demo and fallbacks

A 7–8 minute slot: about 4 minutes of slides, 3 minutes of live demo, and a close. The deck's speaker notes carry the same lines as this script.

| What | Where |
| --- | --- |
| Deck (14 slides, speaker notes) | [zkClaim pitch deck](https://claude.ai/artifact/XdnsZSya9eSmkWjSbZ6mX6). It is private until you share it from its Share menu, which also exports PPTX or PDF. |
| Film, 2:04, Hindi with English subtitles | `videos/edit/out/the-claim-v2.mp4`, plus `.en.srt` and `.hi.srt` |
| Recorded demo, 2:03, no wallet needed | `videos/demo/out/zkclaim-demo-v1.mp4` |
| Live demo | Local Midnight devnet on the stage laptop, with 1AM on **Local** (Preprod is blocked; see below) |
| Receipt for a real Preprod payout | [400 NIGHT, block 3,547,892](https://zkclaim.vercel.app/verify.html#v=1&net=preprod&contract=1e8938d2a231357b02962058f15d1b236702564c8d98475d65e4f0020511e977&nullifier=730cdf5ac0362369fd86226e6bbc0eeaf82df81967a01f69b841a63ef0e61287&policy=cd834be2ecf2ec435bec914396d6f39d6b6490b9e72e70f10be310317f08ed26&amount=400000000&at=1795460759): opens on any phone or browser |

**One line:** the hospital proves the claim follows the policy, the contract pays it, and the insurer never sees the diagnosis.

## The script

Times are cumulative. If you run long, cut slides 6 and 8 (the demo already shows them) and shorten 9.

| Time | Slide | Say |
| --- | --- | --- |
| 0:00 | 1 · Cover | "Every one of us will one day hand a hospital bill to an insurer. Today, to get that bill paid, you also hand over your diagnosis, your prescriptions, your reports. We built zkClaim so you never have to." |
| 0:20 | 2 · Problem | "To decide one bill, today's process reads a patient's whole file. In our film the officer keeps asking for more: Aadhaar, prescription, doctor's certificate, then a Class 12 mark sheet. It's satire, but only just. Every insurer ends up holding thousands of diagnoses, one breach away from exposing everyone." |
| 0:55 | 3 · The idea | "The insurer already wrote the rules when it sold the policy. So let the hospital prove the claim meets them, and let a contract pay. A zero-knowledge proof is a sealed envelope with a stamp anyone can check: the stamp says every rule was followed, and the envelope, your diagnosis, is never opened." |
| 1:25 | 4 · How it works | Walk the four cards, then the chips: "One proof covers all eight checks: an approved hospital, an issued and active policy, a real anchored record, a covered procedure, within the limit, the patient's consent, never claimed before. Break one rule and no proof can be made." |
| 2:05 | 5 · Live demo | Switch to the browsers. Run sheet below, 3 minutes. |
| 5:05 | 6 · Patient in charge | "Saying no is as easy as saying yes: withdraw until it's paid. Share with a doctor, lab or pharmacy, each seeing only their sections, for as long as you pick. Revoking re-encrypts. Emergency access is one hour, with a reason logged forever." |
| 5:30 | 7 · Tamper Lab | "Every way we could think of to cheat: replay, a forged policy card, an unlicensed clinic, claiming after the patient said no. Fifteen attacks, and the contract refuses every one." |
| 5:50 | 8 · Receipt | Skip if you did step 5 of the demo. "Don't trust our dashboard: the receipt reads the chain itself, with no wallet." |
| 6:05 | 9 · Records | "The record never goes on-chain. Each reader opens only their sections, and the insurer gets no key at all. We export the claim as an NHCX claim response, and it validates against the official profile." |
| 6:25 | 10 · Why Midnight | "On an ordinary chain, whatever you prove becomes public: you're exposed just for claiming. Midnight is private by default; a private value reaches the chain only if we write disclose(). As far as we know, we're the only team here building on Midnight." |
| 6:45 | 11 · Midnight vs. EVM | "On Ethereum or any EVM layer two, every input and event is public forever. Adding privacy means a separate Circom or Noir circuit plus a Solidity verifier, kept in sync by hand, with nothing stopping a leak into calldata. Here it's one program, the compiler blocks leaks, and the same transaction verifies and pays." |
| 7:05 | 12 · What's real | "This isn't a mock-up. Eight circuits, 45 contract tests, 46 records tests. On Midnight's Preprod network the first claim was proved and paid in 61 seconds, and a withdrawn claim was refused." |
| 7:20 | 13 · Scope and next | "Here's exactly where the prototype stops. The proof checks a claim against an approved hospital's record and the patient's consent; the treatment itself is vouched for by the licensed hospital, as today. With funding and a pilot partner: shielded payouts on mainnet, keys in the phone's secure hardware, an independent emergency-key custodian, NHCX and rupee settlement, and a pilot with one insurer." |
| 7:40 | 14 · Close | "Your claim is not your medical history. Why should proving one mean revealing the other? zkClaim: prove the claim, protect the patient." |

## Live demo run sheet (3 minutes)

### Pre-flight, 30 minutes before

- **Bring up the staged demo** exactly as [demo-day.md](demo-day.md) says:
  - Docker Desktop;
  - `npm run dev -w ui`;
  - `npm run e2e:open -- insurer`;
  - unlock 1AM on the Local network with the Local prover;
  - **Connect 1AM**, then **Join** contract `aab1fd59…`.

  Read its "Never, before judging" list: no `env:down`, no funding on stage.
- **Staged state** on that contract:
  - bill **A** paid (400 NIGHT): the warm-up and fallback receipt;
  - **B** consented (350 NIGHT): the hospital claims it live;
  - **C** consented (150 NIGHT): the patient withdraws it live.
- **1AM:** auto-lock at its longest, so it doesn't lock mid-demo.
- **Windows:**
  1. The app window from `e2e:open`. Switch roles with its nav: Patient, Hospital, Insurer.
  2. A **second, clean browser window** with no wallet, for the receipt.
- **Backups:** the recorded demo and the film open in a video player, paused at 0:00; the Preprod receipt link above in a phone browser.
- **Timing:** run one claim on this laptop and note the proof time; say that number on stage, not 61 s.
- **Hygiene:** Do Not Disturb on, charger in, mirroring tested, browser zoom checked from the back of the room.

### On stage

| # | Window | Do | Say while it works |
| --- | --- | --- | --- |
| 1 | Patient | Card tab, then the claim request for bill **B** ("Permission given"). Read the promise aloud. | "This is all Rohan does: he says yes to this bill only. Kestrel Mutual gets the fingerprint, the amount and the time. Never his diagnosis." |
| 2 | Hospital | **Prove & submit claim** on B, then **Approve** in 1AM. Proving takes about a minute. | "That proof is being made right here on this laptop. It checks all eight rules against the private record and the private policy. The insurer will get a yes, never the file." Point at each tick as it lands, then the PAID stamp. |
| 3 | Insurer | The new settled claim. Point at **Insurer never sees**, then the dashed "There is no reject button". | "This is everything the insurer gets: an amount, a policy fingerprint, a time, who was paid. And there is no reject button: a valid proof can't be stalled." |
| 4 | Patient, then Hospital | Bill **C**: **Withdraw permission**, approve in 1AM (about 50 s). Then try to claim C on the Hospital desk. | While it confirms: "Rohan changed his mind about the second bill. Whichever lands on the ledger first wins." Then read the refusal: "Patient has not consented to this claim." "The paid total didn't move." |
| 5 | Clean browser | **Get receipt** on B's PAID card, open the link: **Matches**. Change one digit of the amount, then **Check again**: **Does not match**. | "No wallet, no login, no trust in our screens: it reads the chain. Change one digit and it says so." |

**Short on time?** Withdraw C before you go on stage, and show only the instant refusal in step 4. That saves about 50 s.

### If something breaks

1. **No 1AM popup within 10 s.** Click the 1AM icon; requests also show in its own window.
2. **Proof stuck for more than 2 minutes, or an error.** Say so plainly: "Live chains have bad days; here's the same flow recorded an hour ago." Play the recorded demo from 0:39 (the payout) and keep talking over it.
3. **Devnet down.** Switch the app to **Demo**, then **Seed the story**, and run the same steps. Label it honestly: "the contract's own logic in the browser; live mode makes real proofs."
4. **Any time:** the Tamper Lab needs no wallet: **Run all attacks** shows 15 of 15 rejected in a second.
5. **Local receipt fails:** open the Preprod receipt link above on your phone. It's a real payout on Midnight Preprod, and it still says Matches.

### Why the live demo is on a local network

Midnight retired the Preprod node that this 1AM build uses (around 19:05 UTC on 23 Nov), so Preprod transactions from 1AM fail. Everything was proven on Preprod first:
- claim A was paid, 400 NIGHT, in 61 s;
- a withdrawal was confirmed, and the claim after it was refused;
- the receipt still verifies through our Blockfrost-backed indexer.

On stage the same contract runs on a local Midnight devnet on the laptop, which venue Wi-Fi can't break. Say this only if asked.

## The recorded demo (2:03)

Use it as the fallback, or play it when there's no time for the live run.

| Time | Shows |
| --- | --- |
| 0:00 | Title: "Demo mode, the contract's own logic run in the browser" |
| 0:03 | The insurer funds the pool, approves the hospital and issues Rohan's card; the hospital seals the record; Rohan consents. The app's own caption bar narrates each step. |
| 0:39 | The hospital proves eight checks and gets paid; the insurer sees a payment, not a patient |
| 0:57 | Rohan's phone: he withdraws permission on a second bill |
| 1:05 | Tamper Lab: 15 of 15 attacks rejected |
| 1:10 | Rohan shares his record with a doctor, then revokes; a paramedic breaks the glass, logged in red |
| 1:41 | The receipt for a **real Preprod payout**: Matches, then one digit changed: Does not match |
| 1:55 | The app's summary card, then the zkClaim logo |

## Q&A: the ten most likely questions

| Question | Answer |
| --- | --- |
| "What's a zero-knowledge proof?" | "A sealed envelope with a stamp anyone can check. The stamp says the claim follows every rule of the policy; the envelope, your diagnosis, is never opened." |
| "How does the insurer know the claim is real?" | "It writes every rule up front, and only hospitals it approved can make a proof. The proof can't confirm the operation happened; that's still the licensed hospital's word, as today." Then show the Tamper Lab. |
| "Why not just a database?" | "A database has an owner who can stall a claim or edit the access log. The chain pays automatically when the rules are met, never twice, and nobody can edit the log, the insurer included." |
| "What's public?" | "The amount, the date, the policy fingerprint, a one-time claim number and the access log. Never a name or medical data." If asked about the payout itself: "This build pays in test tokens; private payouts with Midnight's shielded tokens are on the mainnet plan." |
| "Is it HIPAA or DPDP compliant?" | "No. It's a prototype and nothing is certified. We followed DPDP's consent ideas: notice, a specific purpose, and withdrawal as easy as consent." |
| "How fast is it?" | "About a minute to prove and pay on the test network." Say the number you timed on the stage laptop. |
| "Who holds the emergency key?" | "In the prototype it's set at deploy. In production an independent custodian holds it and releases keys only after a logged break-glass." |
| "Patient–hospital collusion?" | "Out of scope, and we say so. The deterrents are the hospital's licence (delisting is one on-chain action) and the record's fingerprint, which an auditor can check later." |
| "Why Midnight?" | "Private by default: the compiler refuses to publish a private value without disclose(), proofs are made locally, and proof and payment are one transaction." |
| "Did AI write it?" | "I built it with Claude as a coding assistant. I made the design calls, and I can walk you through the claim circuit's eight checks." (Rehearse `submitClaim` first.) |

### Never say

| Never | Instead |
| --- | --- |
| "HIPAA / DPDP compliant" | "Designed around DPDP's consent ideas; nothing is certified." |
| "Bajaj Finserv / NHA / IRDAI approved it" | "No company or agency has reviewed it yet." |
| "We're the only team on Midnight." | "As far as we know, we're the only team on Midnight." |
| "Paid in rupees" | "Payouts are NIGHT test tokens." |
| "Fraud is impossible" | "The contract refuses the 15 cheats in the Tamper Lab; collusion is a stated limit." |
| "Your diagnosis never leaves your phone." | "Your diagnosis never goes to the insurer." |
| "It's anonymous." | "No names or medical data on-chain." |
| "Rejected in 30 ms" as proof speed | "About a minute on the network; the Tamper Lab runs the rules, not the proofs." |
| "Nothing leaves this laptop" while 1AM is on ProofStation | Switch 1AM to the Local prover first. |
