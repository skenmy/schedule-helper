import { devices, expect, test, type Page } from '@playwright/test';

// Touch layouts must fit whatever a marathon's schedule says. Every run title,
// category and runner on screen is swapped for something long (and some of it
// unbreakable), then nothing may stick out of its pane or the screen, or spill
// out of its own button. Real titles like "Lemmings TAS and Speedrun Community
// Showcase" once pushed the iPad's run controls into the next pane and made
// phones zoom out.
const DEMO = '/demo/demo/main';
const device = (name: string) => {
  const { defaultBrowserType: _, ...rest } = devices[name]!;
  return rest;
};

interface Row {
  title: string;
  category: string;
  runners: string[];
}

async function stress(page: Page, rows: Row[]) {
  const swaps: [string, string][] = [];
  for (const r of rows) {
    swaps.push([r.title, `${r.title}: The Extended Community Showcase Edition (Genesis)`]);
    if (r.category.length > 2)
      swaps.push([r.category, `${r.category.replace(/\s+/g, '')}NoMajorGlitches%Illegal%`]);
    for (const name of r.runners) swaps.push([name, `${name}_TheLongestHandleEverRegistered`]);
  }
  // Longest first, so "Portal 2" isn't half-replaced as "Portal".
  swaps.sort((a, b) => b[0].length - a[0].length);
  await page.evaluate((swaps) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    for (const node of nodes) {
      let text = node.data;
      for (const [from, to] of swaps) if (text.includes(from)) text = text.split(from).join(to);
      if (text !== node.data) node.data = text;
    }
  }, swaps);
}

interface Offender {
  kind: string;
  el: string;
}

/** Everything that sticks out of where it belongs, outermost only. */
function overflowing(): Offender[] {
  const label = (el: Element) => {
    const parts: string[] = [];
    for (
      let e: Element | null = el;
      e && e !== document.body && parts.length < 4;
      e = e.parentElement
    ) {
      const cls = [...e.classList].filter((c) => !c.startsWith('svelte-')).slice(0, 3);
      const name = e.getAttribute('aria-label');
      parts.unshift(
        e.tagName.toLowerCase() +
          (cls.length ? `.${cls.join('.')}` : '') +
          (name ? `[${name.slice(0, 30)}]` : ''),
      );
    }
    return parts.join(' > ');
  };
  /** The nearest ancestor that clips or scrolls sideways. */
  const clipper = (el: Element) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).overflowX !== 'visible') return e;
    }
    return null;
  };
  const found = new Map<Element, Offender>();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('dialog:not([open]), [popover]:not(:popover-open), [hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const clip = clipper(el);
    // Meant to scroll sideways: tab strips, the timeline.
    if (clip?.closest('[role="tablist"], .pannable')) continue;
    const pane = el.closest('section.pane');
    const box = (clip ?? pane)?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth };
    if (r.right > box.right + 1.5 || r.left < box.left - 1.5) {
      found.set(el, {
        kind: `outside its ${clip ? 'container' : pane ? 'pane' : 'screen'}`,
        el: label(el),
      });
    } else if (
      cs.overflowX === 'visible' &&
      el.clientWidth > 0 &&
      el.scrollWidth > el.clientWidth + 1 &&
      !el.querySelector(':scope > *:is([role="tablist"], .pannable)')
    ) {
      // Its box fits, but what's inside doesn't: text running out of a button or cell.
      found.set(el, { kind: 'content spills out of it', el: label(el) });
    }
  }
  // Report where it starts: the outermost box that sticks out, the innermost one spilling.
  const spills = (o: Offender) => o.kind === 'content spills out of it';
  return [...found]
    .filter(([el, o]) => {
      if (spills(o)) {
        return ![...found].some(([other, x]) => other !== el && spills(x) && el.contains(other));
      }
      for (let p = el.parentElement; p; p = p.parentElement) if (found.has(p)) return false;
      return true;
    })
    .map(([, o]) => o);
}

async function expectFits(page: Page, rows: Row[], where: string) {
  await page.waitForTimeout(250);
  await stress(page, rows);
  // The page is laid out at the device's width: a phone isn't zoomed out to fit.
  expect(await page.evaluate(() => window.innerWidth), `${where}: page width`).toBe(
    page.viewportSize()!.width,
  );
  expect(await page.evaluate(overflowing), where).toEqual([]);
}

async function rowsOf(page: Page): Promise<Row[]> {
  const res = await page.request.get(`/api/rooms${DEMO}/report.json`);
  return ((await res.json()) as { rows: Row[] }).rows;
}

async function open(page: Page, mode?: 'floor' | 'console') {
  if (mode)
    await page.addInitScript((m) => localStorage.setItem('sh.tabletMode', JSON.stringify(m)), mode);
  await page.goto(DEMO);
  await expect(page.locator('article.now')).toBeVisible();
}

for (const [name, wide] of [
  ['iPad Mini landscape', true],
  ['iPad Pro 11 landscape', true],
  ['iPad Pro 11', false],
] as const) {
  test.describe(name, () => {
    test.use(device(name));

    test('the floor view fits long titles', async ({ page }) => {
      await open(page, 'floor');
      await expectFits(page, await rowsOf(page), `${name} floor`);
    });

    test('the console and its tabs fit long titles', async ({ page }) => {
      await open(page, 'console');
      const rows = await rowsOf(page);
      await expectFits(page, rows, `${name} console`);
      if (!wide) return;
      const tabs = page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab');
      for (const tab of ['Schedule', 'Event log', 'Progress']) {
        await tabs.filter({ hasText: tab }).click();
        await expectFits(page, rows, `${name} console, ${tab}`);
      }
    });
  });
}

for (const name of ['iPhone SE (3rd gen)', 'iPhone 15 Pro Max', 'iPhone 15 landscape']) {
  test.describe(name, () => {
    test.use(device(name));

    test('every view fits long titles', async ({ page }) => {
      await open(page);
      const rows = await rowsOf(page);
      await expectFits(page, rows, `${name} now`);
      const views = page.getByRole('navigation', { name: 'Views' });
      for (const view of ['Up next', 'Schedule', 'Log']) {
        await views.getByRole('button', { name: view }).click();
        await expectFits(page, rows, `${name} ${view}`);
      }
    });
  });
}
