// Renders the PNG app icons from src/client/public/favicon.svg with the
// Playwright Chromium we already have for e2e tests. iOS ignores SVG icons
// for the Home Screen, and Android wants a full-bleed "maskable" variant.
//
//   node scripts/build-icons.ts        (CHROMIUM_PATH to use a preinstalled browser)

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve(import.meta.dirname, '../src/client/public');
const svg = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8');
// Full bleed: the platform applies its own mask (iOS rounds the corners; Android
// crops to a circle or squircle — the mark sits inside the 80% safe zone).
const fullBleed = svg.replace(/ rx="\d+"/, '');

const ICONS: { file: string; size: number; svg: string }[] = [
  { file: 'icons/icon-192.png', size: 192, svg },
  { file: 'icons/icon-512.png', size: 512, svg },
  { file: 'icons/icon-maskable-512.png', size: 512, svg: fullBleed },
  { file: 'icons/apple-touch-icon.png', size: 180, svg: fullBleed },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
fs.mkdirSync(path.join(PUBLIC, 'icons'), { recursive: true });
for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  const sized = icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `);
  await page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`);
  await page.screenshot({ path: path.join(PUBLIC, icon.file), omitBackground: true });
  console.log(`wrote ${icon.file}`);
}
await browser.close();
