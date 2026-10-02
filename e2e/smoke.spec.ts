import { expect, test, type Page } from '@playwright/test';

const DEMO = '/demo/demo/main';

async function openDemo(page: Page) {
  await page.goto(DEMO);
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
}

test('landing page opens the demo marathon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Schedule Helper' })).toBeVisible();
  await page.getByRole('button', { name: 'Try the demo marathon' }).click();
  await expect(page).toHaveURL(DEMO);
  await expect(page.getByRole('region', { name: 'Marathon status' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Timer controls' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('legacy hash links redirect to room paths', async ({ page }) => {
  await page.goto('/#horaro:esa/stream1');
  await expect(page).toHaveURL('/horaro/esa/stream1');
});

test('actions sync between operators and can be undone', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await openDemo(a);
  await openDemo(b);

  const panelA = a.getByRole('region', { name: 'Timer controls' });
  const panelB = b.getByRole('region', { name: 'Timer controls' });
  const next = panelA.getByRole('button', { name: /^Next: / });
  const nextTitle = (await next.innerText())
    .replace(/^Next:\s*/, '')
    .replace(/\s*N$/, '')
    .trim();

  await next.click();
  await expect(b.locator('article.now h1')).toHaveText(nextTitle);

  await panelB.getByRole('button', { name: /Undo: ↦ Advanced to/ }).click();
  await expect(a.locator('article.now h1')).not.toHaveText(nextTitle);
  await expect(b.getByRole('region', { name: 'Recent activity' })).toContainText('Undid');
});

test('command palette finds runs without triggering actions', async ({ page }) => {
  await openDemo(page);
  const before = await page.locator('article.now h1').innerText();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands and runs' }).fill('hades');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Hades' })).toBeVisible();
  await expect(page.locator('article.now h1')).toHaveText(before);
});

test('kiosk renders the panels named in its URL', async ({ page }) => {
  await page.goto(`${DEMO}?kiosk=1&layout=1x2&panels=clock,ondeck`);
  await expect(page.locator('[data-panel="clock"]')).toBeVisible();
  await expect(page.locator('[data-panel="ondeck"]')).toBeVisible();
  await expect(page.locator('[data-panel]')).toHaveCount(2);
});

test('phones get the mobile layout', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(DEMO);
  const nav = page.getByRole('navigation', { name: 'Views' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByPlaceholder('Filter by game, runner, platform…')).toBeVisible();
});

test('the event report compares the run with the plan and exports it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands and runs' }).fill('event report');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${DEMO}?report=1`);

  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Runs vs estimate');
  // The demo is seeded part-way through, so the chart has runs to step through.
  const chart = page.getByRole('slider', { name: 'Start against schedule, by run' });
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(chart).toHaveAttribute('aria-valuenow', '1');
  await expect(chart).toHaveAttribute('aria-valuetext', /^Run 1, .+: started .+/);
  await expect(page.getByRole('table')).toContainText('Live');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('demo-main-report.csv');

  await page.getByRole('button', { name: 'Back to the console' }).click();
  await expect(page).toHaveURL(DEMO);
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a runner checks in from their own link', async ({ browser }) => {
  const operator = await browser.newPage();
  await openDemo(operator);
  await operator.keyboard.press('Control+k');
  await operator.getByRole('combobox', { name: 'Search commands and runs' }).fill('hades');
  await operator.keyboard.press('Enter');
  const sheet = operator.getByRole('dialog', { name: 'Hades' });
  await sheet.getByRole('button', { name: 'Runner check-in link' }).click();
  await expect(sheet.getByRole('img', { name: 'QR code for the check-in link' })).toBeVisible();
  const url = await sheet.locator('code').innerText();
  // The token rides in the fragment, which never reaches the server's access log.
  expect(url).toMatch(/\/demo\/demo\/main\?checkin=[^#&]+#t=[\w-]{22}$/);

  const runner = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await runner.goto(url);
  await expect(runner.getByRole('region', { name: 'Your run' })).toContainText('Hades');
  await runner.getByRole('button', { name: 'Running late' }).click();
  await runner.getByRole('radio', { name: '10 min' }).click();
  await runner.getByLabel('Anything to add? (optional)').fill('Bus is slow');
  await runner.getByRole('button', { name: 'Tell the organisers' }).click();
  await expect(
    runner.getByRole('heading', { name: 'The organisers know you’re on your way' }),
  ).toBeVisible();

  await expect(sheet).toContainText('Running late');
  await expect(sheet).toContainText('“Bus is slow”');

  // A link can be used once a second at most.
  await runner.waitForTimeout(1_100);
  await runner.getByRole('button', { name: 'I’m here now' }).click();
  await expect(runner.getByRole('heading', { name: 'You’re checked in' })).toBeVisible();
  // Focus lands somewhere sensible, and the confirmation is read out.
  await expect(runner.getByRole('heading', { name: 'Hades' })).toBeFocused();
  await expect(runner.getByRole('status').first()).toHaveText('You’re checked in.');
  await expect(sheet.getByRole('radio', { name: 'Ready' })).toHaveAttribute('aria-checked', 'true');

  // Someone else's (or a mangled) link gets nowhere.
  await runner.goto(url.replace(/t=[\w-]+$/, 't=AAAAAAAAAAAAAAAAAAAAAA'));
  await expect(runner.getByText('This link isn’t valid')).toBeVisible();
});

test('an operator turns alerts on for this device', async ({ browser }) => {
  const context = await browser.newContext();
  await context.grantPermissions(['notifications']);
  // Headless Chromium has no push service: stand in for the browser's subscription.
  await context.addInitScript(() => {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device',
      toJSON: () => ({
        endpoint: sub.endpoint,
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
      }),
    };
    let current: typeof sub | null = null;
    PushManager.prototype.subscribe = async () => (current = sub) as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => current as unknown as PushSubscription;
  });
  const page = await context.newPage();
  await openDemo(page);
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.getByRole('button', { name: 'Alerts on this device' }).click();
  const toggle = page.getByRole('switch', { name: 'Alerts on this device' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Send a test' })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await context.close();
});

// Keep last: it wipes the shared demo room.
test('the whole marathon can be reset after typing to confirm', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Reset…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset the whole marathon?' });
  const confirm = dialog.getByRole('button', { name: 'Reset marathon' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type reset to confirm').fill('reset');
  await confirm.click();
  await expect(page.getByText('Marathon reset', { exact: true })).toBeVisible();
  const activity = page.getByRole('region', { name: 'Recent activity' });
  await expect(activity).toContainText('Reset the marathon');
  await expect(activity).not.toContainText('Started');
});
