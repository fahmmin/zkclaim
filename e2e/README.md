# 1AM end-to-end tests

Synpress-style tests that drive the zkClaim dApp **and the real 1AM wallet** on the local Midnight network. Playwright
attaches to a test browser you keep open; you create and unlock the wallet in it, the tests do everything else
(connect, fund, DUST, deploy, sign) and approve only 1AM requests whose requesting site is the dApp.

## One-time setup

1. Download the 1AM beta from <https://1am.xyz/install-beta> (`one-am-wallet-6.4.20-chrome.zip`), check its SHA-256
   against the one on that page, and unzip it to `e2e/.extensions/1am` (the folder holding `manifest.json`).
   Only the beta lists the Local network. `e2e/.extensions/` and `e2e/.profiles/` are gitignored.
2. Start the stack: `npm run env:up`, then `npm run ui`.
3. `npm run e2e:open -- insurer` opens the insurer's test browser: the dApp on the left, 1AM on the right.
4. In 1AM: **Create a new wallet** → network **Local** → save the recovery phrase privately → set a password →
   Settings → Proof Server → **Local** (`http://localhost:6300`), so proofs never leave the machine.

The tests fund the wallet from the local devnet (`npm run fund`) and turn on DUST generation themselves.

## Each session

- `npm run e2e:open -- insurer` if the test browser is closed, then unlock 1AM in it. Leave it open.
- `npm run e2e` runs the tests (about 2 minutes).

Other roles: `npm run e2e:open -- hospital` / `-- patient` open their own profiles (one wallet each).

## Why it is built this way

- Playwright's Chromium, not Google Chrome: branded Chrome ignores `--load-extension`.
- 1AM shows requests inside its own page, so that page must stay awake: Chromium freezes hidden tabs and, on Windows,
  every window while the screen is off. `e2e:open` gives 1AM its own window beside the dApp and passes the flags that
  stop backgrounding; without them a proving call hangs with no error.
- 1AM injects `window.midnight` only into pages loaded after it starts, so the dApp is reloaded after launch.
