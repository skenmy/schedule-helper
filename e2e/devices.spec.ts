import { devices, expect, test, type Page } from '@playwright/test';
import { IPHONE_DUO, onDuo } from './duo.ts';

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

  test('sets the timer from the floor view', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sh.tabletMode', '"floor"'));
    await open(page);
    await page
      .getByRole('region', { name: 'Timer controls' })
      .getByRole('button', { name: /^Elapsed / })
      .click();
    await expectTimerDialog(page);
  });
});

/** The Set the timer dialog is open with its field on screen, then closed untouched. */
async function expectTimerDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Set the timer' });
  const field = dialog.getByRole('textbox', { name: 'Elapsed time' });
  await expect(field).toBeVisible();
  await expect(field).toBeInViewport({ ratio: 1 });
  expect((await field.boundingBox())!.height).toBeGreaterThan(40);
  await expect(dialog.getByRole('button', { name: 'Set timer' })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

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

  test('sets the timer from the dock', async ({ page }) => {
    await open(page);
    const dock = page.getByRole('region', { name: 'Timer controls' });
    await dock.getByRole('button', { name: 'More timer actions' }).click();
    await dock.getByRole('button', { name: 'Set the timer…' }).click();
    await expectTimerDialog(page);
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

/** Where each page of the foldable layout sits: information, then controls. */
async function halves(page: Page) {
  const info = (await page.getByRole('region', { name: 'Information' }).boundingBox())!;
  const controls = (await page
    .getByRole('region', { name: 'Controls', exact: true })
    .boundingBox())!;
  return { info, controls };
}

/** Chromium's foldable emulation: a fold the page sees through the Viewport Segments API. */
async function fold(
  page: Page,
  feature: { orientation: 'vertical' | 'horizontal'; offset: number; maskLength: number },
) {
  const { width, height } = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 3,
    mobile: true,
    displayFeature: feature,
  });
}

test.describe('iPhone Duo, open like a book', () => {
  test.use(IPHONE_DUO.book);
  test.beforeEach(({ page }) => onDuo(page, 'book'));

  test('reads on the left page and runs the show from the right', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'fold');
    const { info, controls } = await halves(page);
    // Nothing on the crease: the pages meet in the middle of the screen.
    const middle = page.viewportSize()!.width / 2;
    expect(info.x + info.width).toBeCloseTo(middle, 0);
    expect(controls.x).toBeCloseTo(middle, 0);
    // The run controls and the check-ins under the right thumb.
    const transport = page.getByRole('region', { name: 'Timer controls' });
    const next = (await transport.getByRole('button', { name: /^Next: / }).boundingBox())!;
    expect(next.x).toBeGreaterThanOrEqual(middle);
    const deck = (await page.getByRole('region', { name: 'On deck' }).boundingBox())!;
    expect(deck.x).toBeGreaterThanOrEqual(middle);
    // The status and the tabs on the left, Live first. No console and floor modes.
    const status = (await page.getByRole('region', { name: 'Marathon status' }).boundingBox())!;
    expect(status.x + status.width).toBeLessThanOrEqual(middle + 1);
    const tabs = page.getByRole('tablist', { name: 'Workspace' });
    await expect(tabs.getByRole('tab').first()).toHaveText('Live');
    await expect(tabs.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').locator('article.now')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Interface mode' })).toHaveCount(0);
    await tabs.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
    // The page itself never scrolls; the panes do.
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerHeight),
    );
  });

  test('shows the tabs chosen on this device, and a tool opened from More', async ({ page }) => {
    await open(page);
    const tabs = page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab');
    await page.getByRole('button', { name: 'More' }).click();
    const chosen = page.getByRole('group', { name: 'Tabs on this device' });
    await chosen.getByRole('button', { name: 'Progress' }).click();
    await chosen.getByRole('button', { name: 'Timeline' }).click();
    await expect(chosen.getByRole('button', { name: 'Progress' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(tabs).toHaveText(['Live', /^Schedule/, /^Event log/, 'Progress']);
    await page.reload();
    await expect(tabs).toHaveText(['Live', /^Schedule/, /^Event log/, 'Progress']);

    // A tool that isn't one of them still opens from More, for as long as it's open.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /^Broadcast Announcement/ }).click();
    await expect(tabs.last()).toHaveText('Broadcast');
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await tabs.first().click();
    await expect(tabs).toHaveCount(4);
  });

  test('meets on the fold the browser reports, either side of a hinge', async ({ page }) => {
    await fold(page, { orientation: 'vertical', offset: 440, maskLength: 20 });
    await open(page);
    const { info, controls } = await halves(page);
    expect(info.x + info.width).toBeCloseTo(440, 0);
    expect(controls.x).toBeCloseTo(460, 0);
  });

  test('keeps a half-typed note when the phone turns', async ({ page }) => {
    await open(page);
    await page.getByRole('tab', { name: /Event log/ }).click();
    const note = page.getByPlaceholder('Add a note for the team…');
    await note.fill('Runner mic is muted');
    await page.setViewportSize(IPHONE_DUO.tabletop.viewport);
    await expect(page.getByRole('region', { name: 'Timer controls' })).toHaveCSS(
      'position',
      'fixed',
    );
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'fold');
    await expect(note).toHaveValue('Runner mic is muted');
  });
});

test.describe('iPhone Duo, installed, open like a book', () => {
  test.use(IPHONE_DUO.bookInstalled);
  test.beforeEach(({ page }) => onDuo(page, 'bookInstalled'));

  test('keeps the pages on the crease, with the status bar off the window', async ({ page }) => {
    await open(page);
    const { info, controls } = await halves(page);
    // The middle of the screen (951 wide), not of the window: the controls get
    // the narrower page.
    expect(info.x + info.width).toBeCloseTo(951 / 2, 0);
    expect(controls.x).toBeCloseTo(951 / 2, 0);
    expect(controls.width).toBeLessThan(info.width);
    expect(info.y + info.height).toBe(669);
    // `screen` says it's the outer display: picked as a foldable all the same.
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'fold');
  });

  test('follows the window when the phone turns', async ({ page }) => {
    await open(page);
    const shell = page.locator('[data-shell]');
    await expect(shell).toHaveCSS('height', '669px');
    await page.setViewportSize({ width: 669, height: 867 });
    await expect(shell).toHaveCSS('height', '867px');
    await page.setViewportSize({ width: 867, height: 669 });
    await expect(shell).toHaveCSS('height', '669px');
  });
});

test.describe('iPhone Duo, installed, unfolded with the app open', () => {
  test.use(IPHONE_DUO.bookUnfolded);
  test.beforeEach(({ page }) => onDuo(page, 'bookUnfolded'));

  test('fits the window iOS leaves it, so no control is cut off', async ({ page }) => {
    // On the Duo, after an app switch or a turn, iOS shows only the window (587 of
    // the screen's 669, though 100lvh says 669): the layout must stay inside it.
    await open(page);
    const { info, controls } = await halves(page);
    expect(info.y + info.height).toBe(587);
    expect(controls.y + controls.height).toBe(587);
    const transport = (await page.getByRole('region', { name: 'Timer controls' }).boundingBox())!;
    expect(transport.y + transport.height).toBeLessThanOrEqual(587);
    expect(info.x + info.width).toBeCloseTo(951 / 2, 0);
  });
});

test.describe('iPhone Duo, tabletop', () => {
  test.use(IPHONE_DUO.tabletop);
  test.beforeEach(({ page }) => onDuo(page, 'tabletop'));

  test('stands the information up top and the controls on the flat half', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'fold');
    const { info, controls } = await halves(page);
    const { height } = page.viewportSize()!;
    expect(info.y + info.height).toBeCloseTo(height / 2, 0);
    expect(controls.y).toBeCloseTo(height / 2, 0);
    const dock = (await page.getByRole('region', { name: 'Timer controls' }).boundingBox())!;
    expect(dock.y).toBeGreaterThan(height / 2);
    expect(dock.y + dock.height).toBeGreaterThanOrEqual(height - 1);
    // The runners on deck scroll above the dock, not under it.
    const deck = (await page.locator('section.controls .scroll').boundingBox())!;
    expect(deck.y).toBeGreaterThanOrEqual(height / 2);
    expect(deck.y + deck.height).toBeLessThanOrEqual(dock.y + 1);
  });

  test('meets on the fold the browser reports', async ({ page }) => {
    await fold(page, { orientation: 'horizontal', offset: 400, maskLength: 0 });
    await open(page);
    const { info, controls } = await halves(page);
    expect(info.y + info.height).toBeCloseTo(400, 0);
    expect(controls.y).toBeCloseTo(400, 0);
  });

  test('checks runners in and sets the timer from the flat half', async ({ page }) => {
    await open(page);
    const deck = page.getByRole('region', { name: 'On deck' });
    await expect(deck.getByRole('button', { name: 'Ready' }).first()).toBeEnabled();
    await page
      .getByRole('region', { name: 'Timer controls' })
      .getByRole('button', { name: /^Elapsed / })
      .click();
    await expectTimerDialog(page);
  });
});

test.describe('iPhone Duo, closed', () => {
  test.use(IPHONE_DUO.closed);
  test.beforeEach(({ page }) => onDuo(page, 'closed'));

  test('gets the phone layout on the outer screen', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'phone');
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
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
