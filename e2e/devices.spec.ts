import { devices, expect, test, type Page } from '@playwright/test';

// Touch layouts and the installed-app (offline) path. Device descriptors are
// used for their viewport, user agent and touch settings; the browser is
// always Chromium, so their WebKit default is dropped.
const DEMO = '/demo/demo/main';
const device = (name: string) => {
  const { defaultBrowserType: _, ...rest } = devices[name]!;
  return rest;
};

async function open(page: Page, path = DEMO) {
  await page.goto(path);
  await expect(page.locator('article.now')).toBeVisible();
}

test.describe('iPad, landscape', () => {
  test.use(device('iPad Pro 11 landscape'));

  test('gets the tablet console: live pane, controls and workspace tabs', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'tablet');
    const controls = page.getByRole('region', { name: 'Timer controls' });
    await expect(controls.getByRole('button', { name: /^Next: / })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Workspace' });
    await tabs.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
    // The page itself never scrolls; the panes do.
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerHeight),
    );
  });

  test('switches to the floor view, and remembers it', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Floor' }).click();
    const deck = page.getByRole('region', { name: 'On deck' });
    await expect(deck).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Workspace' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'On deck' })).toBeVisible();

    // Opening a tool from the floor view goes back to the console.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Stream capture/ }).click();
    await expect(page.getByRole('tab', { name: 'Stream capture' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('checks runners in with one tap on the floor view', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sh.tabletMode', '"floor"'));
    await open(page);
    const deck = page.getByRole('region', { name: 'On deck' });
    // A run nobody has checked in yet, pinned by name (the filter stops matching once it's ready).
    const name = await deck
      .getByRole('group')
      .filter({ has: page.locator('button.ready[aria-pressed="false"]') })
      .filter({ has: page.locator('button.missing[aria-pressed="false"]') })
      .first()
      .getAttribute('aria-label');
    const ready = deck.getByRole('group', { name: name! }).getByRole('button', { name: 'Ready' });
    await ready.click();
    await expect(ready).toHaveAttribute('aria-pressed', 'true');
    // Tapping it again clears the check-in (and leaves the shared demo as it was).
    await ready.click();
    await expect(ready).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('iPad, rotating', () => {
  test.use(device('iPad Pro 11 landscape'));

  test('keeps a half-typed note when the iPad turns to portrait', async ({ page }) => {
    await open(page);
    await page.getByRole('tab', { name: /Event log/ }).click();
    const note = page.getByPlaceholder('Add a note for the team…');
    await note.fill('Runner mic is muted');
    const { width, height } = page.viewportSize()!;
    await page.setViewportSize({ width: height, height: width });
    await expect(page.getByRole('region', { name: 'Timer controls' })).toHaveCSS(
      'position',
      'fixed',
    );
    await expect(note).toHaveValue('Runner mic is muted');
    // The timeline stays a tab in portrait, too.
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  });
});

test.describe('iPad, portrait', () => {
  test.use(device('iPad Pro 11'));

  test('docks the controls along the bottom', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'tablet');
    const dock = page.getByRole('region', { name: 'Timer controls' });
    const box = (await dock.boundingBox())!;
    const height = page.viewportSize()!.height;
    expect(box.y + box.height).toBeGreaterThanOrEqual(height - 1);
    await expect(dock.getByRole('button', { name: 'Undo' })).toBeVisible();
  });
});

test.describe('iPhone, portrait', () => {
  test.use(device('iPhone 15'));

  test('checks runners in from Up next', async ({ page }) => {
    await open(page);
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Up next' })
      .click();
    const deck = page.getByRole('region', { name: 'On deck' });
    await expect(deck.getByRole('group').first()).toBeVisible();
    await expect(deck.getByRole('button', { name: 'Ready' }).first()).toBeEnabled();
  });
});

test.describe('iPhone', () => {
  test.use(device('iPhone 15 landscape'));

  test('stays on the phone layout in landscape, with a side rail', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'phone');
    const nav = page.getByRole('navigation', { name: 'Views' });
    const box = (await nav.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.height).toBeGreaterThan(box.width);
    await nav.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByPlaceholder('Filter by game, runner, platform…')).toBeVisible();
  });

  test('a layout chosen in More sticks to the device', async ({ page }) => {
    await open(page);
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'More' })
      .click();
    await page.getByLabel('Layout on this device').selectOption('desktop');
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'desktop');
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  });
});

test.describe('installed app', () => {
  test.use(device('iPad Pro 11 landscape'));

  test('opens with no signal, read-only, and recovers when back online', async ({
    page,
    context,
  }) => {
    await open(page);
    // Wait for the service worker to control the page and the snapshot to land.
    await page.waitForFunction(() => navigator.serviceWorker.controller != null);
    await page.waitForFunction(() => localStorage.getItem('sh.snap.demo/demo/main') != null);
    const title = await page.locator('article.now h1').innerText();

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('article.now h1')).toHaveText(title);
    await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
    const controls = page.getByRole('region', { name: 'Timer controls' });
    await expect(controls.getByRole('button', { name: /^Next: / })).toBeDisabled();

    await context.setOffline(false);
    await expect(controls.getByRole('button', { name: /^Next: / })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toHaveCount(0);
  });

  test('serves the manifest, icons and service worker', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    for (const icon of manifest.icons as { src: string }[]) {
      expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
    }
    const sw = await request.get('/sw.js');
    expect(sw.headers()['cache-control']).toBe('no-cache');
    expect(await sw.text()).toContain('__PRECACHE__');
    expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
  });
});
