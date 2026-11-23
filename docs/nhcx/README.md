# NHCX ClaimResponseBundle export

`buildNhcxClaimResponseBundle` in [`records/src/nhcx.ts`](../../records/src/nhcx.ts) turns one settled zkClaim claim into a FHIR R4 `Bundle` for India's National Health Claims Exchange (NHCX). The bundle claims the NRCeS [`ClaimResponseBundle`](https://nrces.in/ndhm/fhir/r4/6.5.0/StructureDefinition-ClaimResponseBundle.html) profile from the [FHIR Implementation Guide for ABDM v6.5.0](https://nrces.in/ndhm/fhir/r4/6.5.0/hcx-profile.html). It is a claim response: the insurer's adjudicated outcome, sent back to the hospital.

**Result:** with example.org identifier systems allowed (`-allow-example-urls true`), the sample `claimresponse-cardiac.json` validates against ClaimResponseBundle (NRCeS IG 6.5.0). The HL7 validator reports 0 errors, 0 warnings and 4 information messages. Without that flag, it rejects the deliberately fake example.org identifier systems. The deliberately invalid fixture fails with 2 errors. Details are in [Validation](#validation).

The export is an **access-controlled document for the hospital and the patient**. It names the patient (name, gender, birth date), so it is never part of the public settlement receipt, and `meta.security` marks it `V` (very restricted), as the IG's own settlement example does. It is not hashed or anchored on-chain. The content-hashed record bundles in [`records/src/fhir.ts`](../../records/src/fhir.ts) are unchanged.

## What goes where

| Input | FHIR element |
| --- | --- |
| Settlement nullifier (the key of `claims[nullifier]` on-chain) | `ClaimResponse.identifier`, system `https://example.org/fhir/sid/claim-nullifier` |
| Policy commitment | `Coverage.identifier`, system `https://example.org/fhir/sid/policy-commitment`, referenced from `ClaimResponse.insurance.coverage` |
| Settled-at (Unix seconds) | `ClaimResponse.created`, `ClaimResponse.payment.date`, `Bundle.timestamp` |
| Synthetic INR business amount, with its own `currency: 'INR'` field | Every `Money` in the bundle: `item.adjudication` (submitted, benefit), `total` and `payment.amount` |
| On-chain amount in NIGHT base units | One labelled `processNote` only, never a `Money` value. It must equal the claim's amount, or the builder refuses. |
| Hospital's claim: patient | `Patient`: `name.text`, `gender`, `birthDate`, plus a local medical record number |
| Hospital's claim: hospital name | `Organization` of type `prov`, as `ClaimResponse.requestor` |
| Insurer name | `Organization` of type `ins`, as `ClaimResponse.insurer` and `Coverage.payor` |
| Hospital's claim: procedure | Only `ClaimResponse.type`: inpatient or outpatient care management (SNOMED CT, from the IG's `ndhm-claim-type` value set), plus the base FHIR `institutional` code that the sealed record's `Claim` uses |

Each resource also carries a short generated narrative (`text`) restating those same fields, with every value XML-escaped.

The builder copies allow-listed fields only. The bundle carries no diagnosis, procedure code, medication, lab result, salt, key, record CID, card code or record commitment; the record commitment would link the claim to its anchored record. The unit tests check this with those secrets attached to the input.

The NIGHT payout is never relabelled as rupees. NIGHT is not an ISO 4217 currency, and the INR figure is a separate, synthetic business value: nothing converts one into the other.

## Files

| File | What it is |
| --- | --- |
| `claimresponse-cardiac.json` | The sample bundle |
| `claimresponse-cardiac-invalid-currency.json` | The same bundle with one deliberate defect: `payment.amount` is `{ "value": 400, "currency": "NIGHT" }`, the token relabelled as a currency, as the sealed record's `Claim` carries it |
| `claimresponse-cardiac.validation.txt` | Validator output for the sample, example URLs allowed |
| `claimresponse-cardiac-invalid-currency.validation.txt` | Validator output for the invalid fixture, example URLs allowed |
| `claimresponse-cardiac.default-flags.validation.txt` | Validator output for the sample with the validator's default flags |

The reports are the validator's console output. The only edit is that the local profile folder in the `Paths:` line reads `%USERPROFILE%`.

Regenerate both fixtures with `npm run nhcx:fixtures -w records`. They are file snapshots of the test in [`records/src/test/nhcx.test.ts`](../../records/src/test/nhcx.test.ts), so `npm test -w records` fails if they are stale. The tests need no Java or network. `.gitattributes` keeps the fixtures at LF line endings, because a CRLF checkout would fail the snapshot.

### Sample data

Every value is synthetic:

- **From the `cardiac` entry of `SAMPLE_CASES`:** gender, birth date, the procedure (an inpatient stent, hence inpatient care management) and the amount, 400 NIGHT, or 400000000 base units.
- **Names:** "Synthetic Test Patient", "Synthetic Test Hospital" and "Synthetic Test Insurer" replace the sample's names.
- **Identifiers:** `SYNTH-MRN-0001`, `SYNTH-HOSP-0001` and `SYNTH-INS-0001`, all under `https://example.org/fhir/sid/` systems. There is no ABHA or Aadhaar number.
- **Settlement:** nullifier `11…1` and policy commitment `22…2` (64 hex digits each), settled 2026-11-05T10:30:00Z.
- **Amount:** the INR 240000 is made up.
- **Resource ids:** renumbered `00000000-0000-4000-8000-00000000000N` in the fixtures. The builder itself issues random UUIDs.

## Validation

Run on 2026-11-23 from this folder:

```sh
java -jar validator_cli.jar claimresponse-cardiac.json -version 4.0.1 -ig ndhm.in#6.5.0 -profile https://nrces.in/ndhm/fhir/r4/StructureDefinition/ClaimResponseBundle -allow-example-urls true
java -jar validator_cli.jar claimresponse-cardiac-invalid-currency.json -version 4.0.1 -ig ndhm.in#6.5.0 -profile https://nrces.in/ndhm/fhir/r4/StructureDefinition/ClaimResponseBundle -allow-example-urls true
java -jar validator_cli.jar claimresponse-cardiac.json -version 4.0.1 -ig ndhm.in#6.5.0 -profile https://nrces.in/ndhm/fhir/r4/StructureDefinition/ClaimResponseBundle
```

### Versions

- **Validator:** HL7 FHIR Validator `validator_cli.jar` 7.0.6 (Git 86bf796ddc97, built 2026-11-13), the latest stable [release](https://github.com/hapifhir/org.hl7.fhir.core/releases/tag/7.0.6). SHA-256 `2686590539f0b3ba7683149b25d78249f6886c04e2c326e884c5049d8947df89`. It is kept outside the repository.
- **Java:** OpenJDK 21.0.10, the runtime bundled with Android Studio.
- **IG package:** `ndhm.in#6.5.0`, the package id and version given by the IG, for FHIR 4.0.1.
  - Its declared dependencies are `hl7.fhir.r4.core#4.0.1`, `hl7.terminology.r4#6.0.2` and `hl7.fhir.uv.extensions.r4#5.1.0`.
  - The validator also loaded `hl7.fhir.xver-extensions#0.1.0`, `hl7.terminology.r4#6.2.0`, `hl7.fhir.uv.extensions.r4#5.2.0`, `hl7.terminology#7.5.0`, `hl7.terminology.r5#7.5.0` and `hl7.fhir.uv.extensions#5.4.0`.
  - Packages came from packages.fhir.org; the `ndhm.in` tarball itself is served from packages.simplifier.net.
- **Terminology server:** https://tx.fhir.org, the validator's default, which checked the codes.

### Results

| Fixture | Flags | Errors | Warnings | Information | Exit code |
| --- | --- | --- | --- | --- | --- |
| `claimresponse-cardiac.json` | `-allow-example-urls true` | **0** | 0 | 4 | 0 (`Success`) |
| `claimresponse-cardiac-invalid-currency.json` | `-allow-example-urls true` | **2** | 0 | 4 | 1 (`*FAILURE*`) |
| `claimresponse-cardiac.json` | default | **11** | 0 | 16 | 1 (`*FAILURE*`) |

What the messages are:

- **There are no warnings.** Each resource's generated narrative satisfies the best-practice check `dom-6` ("A resource should have narrative for robust management"). Before the narratives were added, every run had 5 of these warnings and no others.
- **The 4 information messages say the Patient, both Organizations and the Coverage "do not match any known slice".** The profile defines only a `ClaimResponse` entry slice, and its slicing is open, so other resources are allowed.
- **The invalid fixture's 2 errors are both on `ClaimResponse.payment.amount.currency`.** `NIGHT` is not in `http://hl7.org/fhir/ValueSet/currencies` (ISO 4217), a required binding. The messages are "The System URI could not be determined for the code 'NIGHT'…" and "The value provided ('NIGHT') was not found in the value set 'CurrencyCode'…".
- **With the default flags, the sample gets 11 errors:**
  - 5 say "Example URLs are not allowed in this context", one per `Identifier.system`. Every system is on example.org on purpose, because the data is synthetic.
  - The other 6 say "Unable to find a profile match for urn:uuid:…", once for each reference to the Patient, the two Organizations and the Coverage. Those resources fail only on their example URLs, and all 11 errors go away with `-allow-example-urls true`, which is the only difference between the two runs.
  - The 12 extra information messages are the details of those reference matches.

## What this is not

- **There was no live NHCX submission.** Nothing was sent to the NHCX gateway or to any NHCX participant. The exchange protocol is not implemented: participant registry, encrypted payloads and protocol headers.
- **There is no government endorsement.** NRCeS publishes the implementation guide. This project has no endorsement from NRCeS, NHA or ABDM, and passing the HL7 validator is not NHCX certification.
- **There is no real ABHA identity.** No ABHA, Aadhaar, ROHINI or other real identifier is used; every name and identifier is synthetic.
- **There is no real rupee settlement.** The INR amount is made up. The contract pays NIGHT on a Midnight test chain, and no rupees moved.
