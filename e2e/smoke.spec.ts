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
