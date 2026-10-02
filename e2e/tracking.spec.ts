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

/** Stands in for NodeCG's socket.io client: speedcontrol has `game` up, timer stopped. */
const fakeNodecg = (game: string) => `
  window.io = () => {
    const socket = {
      connected: true,
      on(event, fn) { if (event === 'connect') setTimeout(fn, 0); },
      emit(event, payload, ack) {
        const values = {
          runDataActiveRun: { game: ${JSON.stringify(game)}, teams: [] },
          timer: { state: 'stopped', milliseconds: 0, timestamp: Date.now() },
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
    .locator('code')
    .innerText();
  expect(address).toMatch(/\/bridge\.html\?room=demo%2Fdemo%2Fmain&nodecg=.+#t=[\w-]{22}$/);

  const bridge = await context.newPage();
  await bridge.route('http://localhost:9090/socket.io/socket.io.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fakeNodecg(nextTitle) }),
  );
  await bridge.goto(address);
  await expect(bridge.locator('#nodecg')).toHaveText(/Connected/);
  await expect(bridge.locator('#report')).toHaveText(/Reported at/);

  const banner = page.getByRole('region', { name: 'Run change detected' });
  await expect(banner).toContainText(`${nextTitle} is on stream`);
  await expect(page.getByText(/Speedcontrol \(bridge\)/)).toBeVisible();
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
});
