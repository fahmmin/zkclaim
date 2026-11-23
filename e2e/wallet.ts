// Synpress-style helpers for 1AM: attach to a role's open test browser and approve 1AM's requests for the dApp.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import { DAPP_URL, devtoolsPort, extensionDir, profileDir, type Role } from './roles.ts';

/**
 * Attaches to a role's open 1AM test browser (started with `npm run e2e:open -- <role>`) and lays out its windows.
 * `waitMs` keeps retrying while a just-started browser opens its DevTools port.
 */
export async function attach(role: Role, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  let browser: Browser | undefined;
  while (!browser) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${devtoolsPort(role)}`, { timeout: 15_000 }).catch((e) => {
      if (Date.now() > deadline) throw new Error(`No ${role} test browser is open. Run \`npm run e2e:open -- ${role}\`, unlock 1AM in it, and rerun. (${e})`);
      return new Promise<undefined>((r) => setTimeout(r, 500));
    });
  }
  const [context] = browser.contexts();
  const worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  const extensionId = worker ? new URL(worker.url()).host : extensionIdOf(role);
  await arrangeWindows(browser, context, extensionId);
  return { browser, context, extensionId };
}

/** 1AM's extension id as Chromium recorded it for this profile: its MV3 worker sleeps when idle, so it can't be asked. */
function extensionIdOf(role: Role): string {
  const prefs = JSON.parse(readFileSync(path.join(profileDir(role), 'Default', 'Secure Preferences'), 'utf8'));
  const entry = Object.entries(prefs.extensions?.settings ?? {}).find(([, v]) => (v as { path?: string }).path === extensionDir);
  if (!entry) throw new Error(`1AM is not installed in the ${role} test browser profile`);
  return entry[0];
}

/**
 * Gives the dApp and 1AM's own page a window each, side by side. Chromium freezes hidden tabs, and a frozen 1AM page
 * never shows the dApp's requests (the fund-pool call hung exactly like that), so neither page may sit behind the other.
 */
async function arrangeWindows(browser: Browser, context: BrowserContext, extensionId: string): Promise<void> {
  const home = `chrome-extension://${extensionId}/fullpage.html`;
  const dapp = context.pages().find((p) => p.url().startsWith(DAPP_URL)) ?? (await context.newPage());
  if (!dapp.url().startsWith(DAPP_URL)) await dapp.goto(DAPP_URL);
  const cdp = await browser.newBrowserCDPSession();
  const windowOf = async (targetId: string) => (await cdp.send('Browser.getWindowForTarget', { targetId })).windowId;
  const pages = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
  const dappWindow = await windowOf(pages.find((t) => t.url.startsWith(DAPP_URL))!.targetId);

  let walletTarget = pages.find((t) => t.url.startsWith(home))?.targetId;
  if (walletTarget && (await windowOf(walletTarget)) === dappWindow) {
    await cdp.send('Target.closeTarget', { targetId: walletTarget });
    walletTarget = undefined;
  }
  walletTarget ??= (await cdp.send('Target.createTarget', { url: home, newWindow: true })).targetId;
  const walletWindow = await windowOf(walletTarget);

  const screen = await dapp.evaluate(() => {
    const s = window.screen as Screen & { availLeft?: number; availTop?: number }; // Chromium-only fields
    return { x: s.availLeft ?? 0, y: s.availTop ?? 0, w: s.availWidth, h: s.availHeight };
  });
  const half = Math.floor(screen.w / 2);
  for (const [windowId, left] of [[dappWindow, screen.x], [walletWindow, screen.x + half]] as const) {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); // can't move a maximized window
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left, top: screen.y, width: half, height: screen.h } });
  }
  await cdp.detach();
}

/** The dApp's wallet-check page, freshly loaded so 1AM's injected `window.midnight` is in place. */
export async function openDapp(context: BrowserContext, route = '#/wallet-check'): Promise<Page> {
  const page = context.pages().find((p) => p.url().startsWith(DAPP_URL)) ?? (await context.newPage());
  await page.goto(`${DAPP_URL}/${route}`);
  await page.waitForFunction(() => Boolean((globalThis as { midnight?: Record<string, unknown> }).midnight?.['1am']), null, { timeout: 15_000 });
  return page;
}

/** 1AM's own page (in its own window), where it shows requests. */
export async function walletPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = context.pages().find((p) => p.url().startsWith(`chrome-extension://${extensionId}/fullpage.html`));
  if (!page) throw new Error('1AM page missing; attach() opens it');
  return page;
}

/** Turns on DUST generation for the wallet's NIGHT in 1AM's own UI (a registration transaction on the devnet). */
export async function generateDust(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await walletPage(context, extensionId);
  await page.getByText(/^your dust$/i).first().click();
  await page.getByRole('button', { name: /^generate dust$/i }).click();
}

/**
 * Approves 1AM requests from the dApp. 1AM shows each request inline in its open tab ("REQUESTING SITE <origin>",
 * Reject / Approve); every second this clicks Approve on any whose requesting site is exactly the dApp's origin.
 * It never types anything: a locked wallet or a request from another site is left alone and reported once.
 * Returns a function that stops approving.
 */
export function autoApprove(context: BrowserContext, extensionId: string, log: (line: string) => void): () => void {
  const origin = new URL(DAPP_URL).origin;
  const reported = new Set<string>();
  const once = (key: string, line: string) => reported.has(key) || (reported.add(key), log(line));
  let count = 0;
  let stopped = false;

  const tick = async (page: Page) => {
    // First use of the local prover: 1AM asks once to confirm proofs stay on this device.
    const keepLocal = page.getByRole('dialog').filter({ hasText: /local proving/i }).getByRole('button', { name: /^continue$/i });
    if (await keepLocal.isVisible()) {
      log('confirming 1AM local proving (proofs stay on this device)');
      await keepLocal.click();
    }
    const approve = page.getByRole('button', { name: /^approve$/i }).first();
    if (!(await approve.isVisible())) {
      if (await page.locator('input[type=password]').first().isVisible()) once('locked', '1AM is locked: unlock it in the test browser and rerun');
      return;
    }
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const start = text.indexOf('REQUESTING SITE');
    const site = /REQUESTING SITE\s+(\S+)/.exec(text)?.[1];
    const request = text.slice(Math.max(0, start - 40), start + 260);
    if (site !== origin) return once(request, `left a request alone (site ${site ?? 'not shown'}, expected ${origin}): ${request}`);
    const n = ++count;
    await page.screenshot({ path: `e2e/test-results/approval-${n}.png` });
    log(`approving request ${n}: ${request}`);
    await approve.click();
    await approve.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
  };

  void (async () => {
    while (!stopped) {
      for (const page of context.pages()) {
        if (page.url().startsWith(`chrome-extension://${extensionId}/`)) await tick(page).catch(() => undefined);
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  })();
  return () => {
    stopped = true;
  };
}
