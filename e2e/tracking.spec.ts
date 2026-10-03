import { expect, test } from '@playwright/test';
import fs from 'node:fs';

// Works from whatever state the shared demo marathon is in (smoke.spec.ts resets it).
const DEMO = '/demo/demo/main';
const STREAMS = process.env.E2E_STREAM_FILE!;

test.afterAll(() => fs.rmSync(STREAMS, { force: true }));

test('follows the stream to the next run when Twitch says it moved on', async ({ page }) => {
  // The channel starts offline: nothing to detect yet.
  fs.writeFileSync(STREAMS, '{}');
  await page.goto(DEMO);
  const next = page.getByRole('region', { name: 'Timer controls' }).getByRole('button', {
    name: /^Next: /,
  });
  const nextTitle = (await next.innerText())
    .replace(/^Next:\s*/, '')
    .replace(/\s*N$/, '')
    .trim();

  await page.getByRole('tab', { name: 'Stream capture' }).click();
  await page.getByPlaceholder(/channel or twitch/).fill('e2echannel');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByLabel(/Watch the Twitch category and title/).check();
  await expect(page.getByText('e2echannel is offline')).toBeVisible();

  fs.writeFileSync(
    STREAMS,
    JSON.stringify({ e2echannel: { game: nextTitle, title: `UKSG Demo | ${nextTitle}` } }),
  );
  const banner = page.getByRole('region', { name: 'Run change detected' });
  await expect(banner).toContainText(`${nextTitle} is on stream`);
  await expect(banner).toContainText(`category “${nextTitle}”`);
  await banner.getByRole('button', { name: 'Advance' }).click();

  await expect(page.locator('article.now h1')).toHaveText(nextTitle);
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Recent activity' })).toContainText(
    `Followed the stream (twitch) to ${nextTitle}`,
  );
});

/**
 * Stands in for NodeCG's socket.io client: speedcontrol has `game` up, and its
 * timer is `window.timerValue` (stopped unless a test changes it).
 */
const fakeNodecg = (game: string, elapsedMs = 0, state = 'stopped') => `
  window.timerValue = { state: ${JSON.stringify(state)}, milliseconds: ${elapsedMs}, timestamp: Date.now() };
  window.io = () => {
    const socket = {
      connected: true,
      on(event, fn) { if (event === 'connect') setTimeout(fn, 0); },
      emit(event, payload, ack) {
        const values = {
          runDataActiveRun: { game: ${JSON.stringify(game)}, teams: [] },
          timer: window.timerValue,
        };
        setTimeout(() => ack(null, { value: values[payload.name] }), 0);
      },
    };
    return socket;
  };`;

test('follows NodeCG speedcontrol through the bridge page', async ({ page, context }) => {
  await page.goto(DEMO);
  const next = page.getByRole('region', { name: 'Timer controls' }).getByRole('button', {
    name: /^Next: /,
  });
  const nextTitle = (await next.innerText())
    .replace(/^Next:\s*/, '')
    .replace(/\s*N$/, '')
    .trim();

  await page.getByRole('tab', { name: 'Stream capture' }).click();
  await page.getByRole('button', { name: 'Set up the stream PC' }).click();
  const address = await page
    .getByRole('region', { name: 'Bridge page' })
    .locator('code.url')
    .innerText();
  expect(address).toMatch(/\/bridge\.html\?room=demo%2Fdemo%2Fmain&nodecg=.+#t=[\w-]{22}$/);

  const bridge = await context.newPage();
  await bridge.route('http://localhost:9090/socket.io/socket.io.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fakeNodecg(nextTitle) }),
  );
  const response = await bridge.goto(address);
  // Sandboxed: whatever NodeCG's script does, it runs with no origin and no cookies here.
  expect(response?.headers()['content-security-policy']).toBe('sandbox allow-scripts');
  await expect(bridge.locator('#nodecg')).toHaveText(/Connected/);
  await expect(bridge.locator('#report')).toHaveText(/Reported at/);

  const banner = page.getByRole('region', { name: 'Run change detected' });
  await expect(banner).toContainText(`${nextTitle} is on stream`);
  await expect(page.getByText(/Speedcontrol \(bridge\)/)).toBeVisible();
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
});

test('stops our timer when speedcontrol’s finishes, at the moment it did', async ({
  page,
  context,
}) => {
  await page.goto(DEMO);
  const title = (await page.locator('article.now h1').innerText()).trim();
  const timer = page.getByRole('region', { name: 'Timer controls' });
  // Our timer running for ten minutes, whatever earlier tests left behind.
  const resume = timer.getByRole('button', { name: /^Resume/ });
  if (await resume.isVisible()) await resume.click();
  await timer.getByRole('button', { name: 'Set time' }).click();
  await page.getByLabel('Elapsed time').fill('10:00');
  await page.getByRole('button', { name: 'Set timer' }).click();
  await expect(timer.getByRole('button', { name: /^Stop/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Stream capture' }).click();
  await page.getByRole('button', { name: 'Set up the stream PC' }).click();
  const address = await page
    .getByRole('region', { name: 'Bridge page' })
    .locator('code.url')
    .innerText();
  const bridge = await context.newPage();
  // Speedcontrol's timer started five minutes ago, after ours…
  await bridge.route('http://localhost:9090/socket.io/socket.io.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: fakeNodecg(title, 5 * 60_000, 'running'),
    }),
  );
  await bridge.goto(address);
  await expect(bridge.locator('#report')).toHaveText(/Reported at/);
  // …and finished at 4:00, so a minute ago.
  await bridge.evaluate(() => {
    (window as unknown as { timerValue: object }).timerValue = {
      state: 'finished',
      milliseconds: 4 * 60_000,
      timestamp: Date.now(),
    };
  });

  const banner = page.getByRole('region', { name: 'Run change detected' });
  await expect(banner).toContainText(`${title} has finished on stream`);
  await banner.getByRole('button', { name: 'Stop timer' }).click();
  await expect(banner).toHaveCount(0);
  await expect(timer.getByRole('button', { name: /^Resume/ })).toBeVisible();
  // Ours ran from ten minutes ago to the stream's finish a minute ago: about nine minutes.
  await expect(page.getByRole('region', { name: 'Recent activity' })).toContainText(
    new RegExp(
      `Finished ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} in 00:0[89]:\\d\\d, when the stream \\(nodecg\\) did`,
    ),
  );
});

test('a bridge address pointing at a hostile "NodeCG" gets nothing of the app’s', async ({
  context,
}) => {
  const page = await context.newPage();
  // Whatever answers as NodeCG runs in the bridge page. Here it tries to act as an operator.
  await page.route('http://localhost:9091/socket.io/socket.io.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.stolen = {};
        try { localStorage.setItem('x', '1'); window.stolen.storage = true; }
        catch { window.stolen.storage = false; }
        window.stolen.origin = self.origin;
        fetch('/api/rooms/demo/demo/main/checkin-links')
          .then((r) => r.json()).then(() => (window.stolen.links = true))
          .catch(() => (window.stolen.links = false));`,
    }),
  );
  await page.goto(
    `/bridge.html?room=demo/demo/main&nodecg=http://localhost:9091#t=${'A'.repeat(22)}`,
  );
  type Stolen = { stolen?: { storage?: boolean; origin?: string; links?: boolean } };
  const stolen = () => page.evaluate(() => (window as unknown as Stolen).stolen);
  await expect.poll(async () => (await stolen())?.links).toBe(false);
  expect(await stolen()).toEqual({
    storage: false,
    origin: 'null',
    links: false,
  });
});
