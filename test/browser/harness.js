// Shared setup for browser tests: a static server for the repository plus
// in-memory files (with optional delay or status), and a Chromium page.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after } from 'node:test';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.cssv': 'text/plain; charset=utf-8', '.csv': 'text/csv', '.png': 'image/png' };

/**
 * Chromium for the tests, the benchmark and the tools: the browser at
 * CHROME_PATH when it is set, otherwise the one `npx playwright install` adds.
 */
export function launchChromium() {
  const executablePath = process.env.CHROME_PATH;
  return chromium.launch(executablePath ? { executablePath } : {});
}

export function startServer() {
  const files = new Map();
  const requests = [];
  let pages = 0;
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    requests.push(path);
    const entry = files.get(path);
    if (entry) {
      if (entry.delay) await new Promise((r) => setTimeout(r, entry.delay));
      res.writeHead(entry.status ?? 200, {
        'content-type': entry.type ?? TYPES[extname(path)] ?? 'text/plain',
        ...entry.headers,
      });
      return res.end(entry.body);
    }
    try {
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT)) throw new Error('outside root');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    resolve({
      origin,
      requests,
      /** Serves `body` at `path`. Options: type, delay (ms), status, headers. */
      file(path, body, options = {}) {
        files.set(path, { body, ...options });
        return origin + path;
      },
      /** Serves an HTML page that loads the component; returns its URL. */
      page(body, { head = '', path } = {}) {
        const p = path ?? `/__pages/${++pages}.html`;
        files.set(p, {
          type: 'text/html',
          body: `<!doctype html><html lang="en-US"><head><meta charset="utf-8">${head}`
            + '<script type="module" src="/src/cssv-table.js"></script></head>'
            + `<body style="margin:0">${body}</body></html>`,
        });
        return origin + p;
      },
      close: () => new Promise((r) => server.close(r)),
    });
  }));
}

/** Registers before/after hooks and returns a context filled in by `before`. */
export function setup() {
  const ctx = {};
  before(async () => {
    ctx.server = await startServer();
    ctx.browser = await launchChromium();
    // Opens a page with `body`, waits for every <cssv-table> to finish
    // rendering (unless wait is false) and collects cssv-error events and
    // uncaught page errors.
    ctx.open = async (body, { wait = true, ...options } = {}) => {
      const page = await ctx.browser.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e));
      const head = '<script>window.__cssvErrors = []; document.addEventListener("cssv-error", (e) => '
        + '__cssvErrors.push({ id: e.target.id, ...e.detail }));</script>' + (options.head ?? '');
      await page.goto(ctx.server.page(body, { ...options, head }));
      await page.waitForFunction(() => customElements.get('cssv-table'));
      if (wait) await page.evaluate(() => Promise.all([...document.querySelectorAll('cssv-table')].map((t) => t.ready)));
      return page;
    };
  });
  after(async () => {
    await ctx.browser?.close();
    await ctx.server?.close();
  });
  return ctx;
}
