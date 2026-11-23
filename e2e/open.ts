// Opens a role's 1AM test browser: Playwright's Chromium with the 1AM beta loaded, the role's own profile, and a
// DevTools port the e2e tests attach to. You create or unlock the wallet in it (never automated: the password and
// recovery phrase stay with you); leave it open and the tests drive everything else.
// Usage: npm run e2e:open -- [insurer|hospital|patient]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { DAPP_URL, devtoolsPort, extensionDir, parseRole, profileDir } from './roles.ts';
import { attach } from './wallet.ts';

const role = parseRole(process.argv.slice(2).find((a) => a !== '--'));
if (!existsSync(`${extensionDir}/manifest.json`)) throw new Error(`1AM beta not found in ${extensionDir}. See e2e/README.md.`);

// Playwright's Chromium, not Google Chrome: branded Chrome ignores --load-extension.
spawn(
  chromium.executablePath(),
  [
    `--user-data-dir=${profileDir(role)}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    `--remote-debugging-port=${devtoolsPort(role)}`,
    // What Playwright passes when it launches Chromium itself. Built-in extensions (Gemini etc.) hang the CDP attach,
    // and a throttled or frozen background page never answers the dApp.
    '--disable-component-extensions-with-background-pages',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // Without this, Windows reports every window as covered while the screen is off or locked, and Chromium freezes them.
    '--disable-features=CalculateNativeWinOcclusion',
    '--no-first-run',
    '--no-default-browser-check',
    DAPP_URL,
  ],
  { detached: true, stdio: 'ignore' },
).unref();

const { browser, context } = await attach(role, 15_000); // also opens 1AM in its own window beside the dApp
// 1AM injects window.midnight only into pages loaded after it started, and the dApp tab can win that race.
for (const page of context.pages()) if (page.url().startsWith(DAPP_URL)) await page.reload();
await browser.close(); // disconnects only; the windows stay open

console.log(`Opened the ${role} test browser (DevTools port ${devtoolsPort(role)}).`);
console.log('In it: create or unlock the 1AM wallet on the Local network, then leave the windows open.');
