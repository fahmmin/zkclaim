// Spike C, automated: 1AM on the local devnet connects, gets funded, deploys zkClaim and signs a call.
// Needs: `npm run env:up`, `npm run ui`, and `npm run e2e:open -- insurer` with the 1AM wallet created and unlocked.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { attach, autoApprove, generateDust, openDapp } from './wallet.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Clicks a dApp button and returns the log line it produces; fails on a "failed" line. */
async function act(page: Page, button: RegExp | string, timeout: number): Promise<string> {
  const lines = page.locator('.log li');
  const before = await lines.count();
  await page.getByRole('button', { name: button }).click();
  await expect(lines).toHaveCount(before + 1, { timeout });
  const line = await lines.first().innerText();
  console.log(`  ${line}`);
  expect(line).not.toContain('failed');
  return line;
}

const field = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`).innerText();
const amount = (text: string) => BigInt(text.replace(/[^0-9]/g, '') || '0');

test('1AM on the local network: connect, fund, deploy zkClaim, sign a call', async () => {
  const { browser, context, extensionId } = await attach('insurer');
  const stopApproving = autoApprove(context, extensionId, (line) => console.log(`  [1AM] ${line}`));
  try {
    const page = await openDapp(context);
    await page.evaluate(() => localStorage.removeItem('zkclaim-contract')); // deploy fresh every run
    await page.reload();

    await test.step('connect 1AM', () => act(page, 'Connect 1AM', 90_000));

    await test.step('fund the wallet with NIGHT', async () => {
      if (amount(await field(page, 'NIGHT')) > 0n) return;
      const address = await field(page, 'Address');
      expect(address).toMatch(/^mn_addr_undeployed1[02-9ac-hj-np-z]+$/); // bech32, so safe to put in a command line
      execSync(`npm run fund -- ${address}`, { cwd: repoRoot, stdio: 'inherit' });
      await expect(async () => {
        await act(page, 'Refresh balances', 30_000);
        expect(amount(await field(page, 'NIGHT'))).toBeGreaterThan(0n);
      }).toPass({ timeout: 120_000, intervals: [5_000] });
    });

    await test.step('wallet has DUST for fees', async () => {
      if (Number(await field(page, 'DUST')) === 0) {
        await generateDust(context, extensionId);
        await page.bringToFront();
      }
      await expect(async () => {
        await act(page, 'Refresh balances', 30_000);
        expect(Number(await field(page, 'DUST').then((d) => d.replace(/,/g, '')))).toBeGreaterThan(0);
      }).toPass({ timeout: 120_000, intervals: [10_000] });
    });

    const deployed = await test.step('deploy zkClaim', () => act(page, /^Deploy zkClaim/, 5 * 60_000));
    expect(deployed).toMatch(/deployed at [0-9a-f]{64}/);

    await test.step('sign a call: fund the claims pool', () => act(page, /^Fund pool/, 5 * 60_000));
  } finally {
    stopApproving();
    await browser.close(); // disconnects; the test browser stays open and unlocked
  }
});
