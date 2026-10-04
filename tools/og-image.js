// Generates site/og.png, the preview image that LinkedIn, Slack, X and others
// show for links to cssv.dev. They read it from the og:image tag; none of them
// uses the favicon, and most can't show SVG.
// Run with: node tools/og-image.js
//
// The card is drawn by Chromium from site/site.css, so it follows the hero's
// colors, dots and highlighter. Only the sans-serif font is pinned: the site's
// system-ui is DejaVu Sans on many Linux machines, which is too wide here.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from '../test/browser/harness.js';

const OUT = new URL('../site/og.png', import.meta.url);
const WIDTH = 1200; // 1.91:1, the ratio LinkedIn, Facebook and X crop to
const HEIGHT = 630;
// Inlined: the test server sends .svg files without an image type.
const ICON = readFileSync(new URL('../site/favicon.svg', import.meta.url), 'utf8');

const CARD = `
<style>
  :root { --sans: BlinkMacSystemFont, "Segoe UI", "Nimbus Sans", "Liberation Sans", Arial, sans-serif; }
  body { margin: 0; }
  .card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    padding: 72px 88px 64px;
    background-color: var(--bg);
    background-image: radial-gradient(var(--dots) 1.5px, transparent 2px);
    background-size: 30px 30px;
  }
  .brand { display: flex; align-items: center; gap: 22px; }
  .brand svg { width: 84px; height: 84px; }
  .brand b { font-size: 56px; letter-spacing: -0.03em; }
  .card h1 { margin: auto 0 26px; font-size: 92px; }
  .card .lede { font-size: 32px; }
  .url { margin-top: auto; font: 600 24px/1 var(--mono); letter-spacing: 0.04em; }
</style>
<div class="card">
  <div class="brand">${ICON}<b>CSSV</b></div>
  <h1>Plain text in, <span>styled tables</span> out.</h1>
  <p class="lede">CSV data with a CSS stylesheet on top, in one plain-text file.</p>
  <p class="url">cssv.dev</p>
</div>`;

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.emulateMedia({ colorScheme: 'light' });
// The page sits in site/, so site.css resolves as on the website.
await page.goto(server.page(CARD, { path: '/site/__og.html', head: '<link rel="stylesheet" href="site.css">' }));
await page.evaluate(() => document.fonts.ready);
await page.locator('.card').screenshot({ path: OUT.pathname });
await browser.close();
await server.close();
console.log(`wrote ${OUT.pathname}`);
