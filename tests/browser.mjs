import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDir = process.env.QA_REPORT_DIR || resolve(root, 'test-results');
const captureDir = process.env.CAPTURE_README === '1' ? resolve(root, 'docs/images') : reportDir;
await mkdir(reportDir, { recursive: true });
await mkdir(captureDir, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep) || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--disable-gpu'] });
} catch (error) {
  await new Promise(resolve => server.close(resolve));
  throw error;
}
const results = [];
const errors = [];
const check = async (name, action) => { await action(); results.push({ name, pass: true }); };
const count = async (page, selector, expected) => {
  await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector, expected }, { timeout: 5000 });
  assert.equal(await page.locator(selector).count(), expected);
};
const add = async (page, title, author = 'Penulis contoh', complete = false) => {
  await page.locator('#title').fill(title);
  await page.locator('#author').fill(author);
  await page.locator('#year').fill('2024');
  await page.locator('#category').selectOption('Sejarah');
  await page.locator('#is-complete').setChecked(complete);
  await page.locator('#save-book').click();
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await check('empty state and required validation preserve empty shelf', async () => { await count(page, '.book', 0); await page.locator('#save-book').click(); await count(page, '.book', 0); assert.equal(await page.locator('#title').evaluate(el => el.validity.valueMissing), true); });
  await check('add/search/edit/status/reload/delete full flow, including XSS text', async () => {
    await add(page, 'Catatan membaca', 'Penulis contoh');
    await add(page, '<img src=x onerror=alert(1)>', 'Penulis uji');
    await count(page, '#unread-books .book', 2);
    assert.equal(await page.locator('.book h4').nth(1).textContent(), '<img src=x onerror=alert(1)>');
    await count(page, '.book h4 img', 0);
    await page.locator('#query').fill('PENULIS UJI');
    await page.locator('#search-form button[type=submit]').click();
    await count(page, '.book', 1);
    await page.locator('#clear-search').click();
    await page.getByRole('button', { name: 'Edit Catatan membaca', exact: true }).click();
    await page.locator('#title').fill('Catatan membaca edisi dua');
    await page.locator('#save-book').click();
    await page.locator('#unread-books .book').first().getByRole('button', { name: 'Tandai selesai' }).click();
    await count(page, '#read-books .book', 1);
    await page.reload();
    await count(page, '#read-books .book', 1);
    await page.getByRole('button', { name: 'Hapus <img src=x onerror=alert(1)>', exact: true }).click();
    await page.keyboard.press('Escape');
    await count(page, '.book', 2);
    await page.getByRole('button', { name: 'Hapus <img src=x onerror=alert(1)>', exact: true }).click();
    await page.locator('#confirm-action').click();
    await count(page, '.book', 1);
    await page.locator('#read-books .book').getByRole('button', { name: 'Baca kembali' }).click();
    await count(page, '#unread-books .book', 1);
    await page.getByRole('button', { name: 'Edit Catatan membaca edisi dua', exact: true }).click();
    await page.locator('#cancel-edit').click();
    assert.equal(await page.locator('#title').inputValue(), '');
  });
  await check('download exports exact current data', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-books').click()]);
    const data = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(data[0].title, 'Catatan membaca edisi dua');
  });
  await check('safe cover protocol validation and broken image fallback', async () => {
    await page.locator('#title').fill('Sampul uji');
    await page.locator('#author').fill('Contoh');
    await page.locator('#year').fill('2024');
    await page.locator('#category').selectOption('Lainnya');
    await page.locator('#image').fill('javascript:alert(1)');
    await page.locator('#save-book').click();
    await count(page, '.book', 1);
    await page.route('https://cover.invalid/**', route => route.abort());
    await page.locator('#image').fill('https://cover.invalid/image.jpg');
    await page.locator('#save-book').click();
    await page.getByText('Sampul tidak tersedia', { exact: true }).waitFor();
  });
  await check('cross-tab change preserves other tab data and exposes reload/export actions', async () => {
    const second = await context.newPage();
    await second.goto(url);
    await add(second, 'Buku dari tab lain');
    await page.getByText('Data browser berubah di tab lain.', { exact: false }).waitFor();
    await page.locator('#reload-storage').click();
    await page.locator('#confirm-action').click();
    await count(page, '.book', 3);
    await second.close();
  });
  await check('corrupt original data retained until explicitly replaced; download bytes exact', async () => {
    await page.evaluate(() => localStorage.setItem('BOOKSHELF', '{broken-data'));
    await page.reload();
    await page.locator('#replace-storage').waitFor();
    await add(page, 'Rak baru sementara');
    assert.equal(await page.evaluate(() => localStorage.getItem('BOOKSHELF')), '{broken-data');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-raw').click()]);
    assert.equal(await readFile(await download.path(), 'utf8'), '{broken-data');
    await page.locator('#replace-storage').click();
    await page.locator('#confirm-action').click();
    await page.locator('#storage-warning').waitFor({ state: 'hidden' });
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('BOOKSHELF')))[0].title, 'Rak baru sementara');
  });
  await check('blocked storage offers memory fallback, error message and export', async () => {
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }));
    const p = await blocked.newPage();
    p.on('pageerror', error => errors.push(error.message));
    await p.goto(url);
    await add(p, 'Hanya sementara');
    await count(p, '.book', 1);
    await p.locator('#retry-save').click();
    assert.equal(await p.locator('#storage-warning').isVisible(), true);
    await p.locator('#download-current').click();
    await blocked.close();
  });
  await page.evaluate(() => localStorage.removeItem('BOOKSHELF'));
  await page.reload();
  await add(page, 'Catatan perjalanan', 'Penulis contoh');
  await add(page, 'Sejarah yang dekat', 'Penulis contoh', true);
  await check('all responsive sizes, 200 percent text and short view have no horizontal overflow', async () => {
    for (const width of [360, 600, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      const targets = await page.locator('button:visible, input:visible:not([type=checkbox]), select:visible').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
      assert.equal(targets.every(height => height >= 44), true);
    }
    await page.setViewportSize({ width: 360, height: 480 });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(await page.locator('body *').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().right > innerWidth).map(n => ({ tag: n.tagName, id: n.id, className: n.className })))));
    await page.getByRole('button', { name: 'Hapus Catatan perjalanan', exact: true }).click();
    await page.locator('#confirm-action').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#confirm-action').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.reload();
  });
  await check('keyboard focus, skip link and form controls work', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shelves');
    await page.locator('#query').focus();
    assert.notEqual(await page.locator('#query').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.type('Tidak ada judul ini');
    await page.keyboard.press('Enter');
    await count(page, '.book', 0);
    await page.locator('#clear-search').click();
  });
  await page.screenshot({ path: resolve(captureDir, 'bookshelf-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 850 });
  await page.screenshot({ path: resolve(captureDir, 'bookshelf-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(resolve(reportDir, 'browser-results.json'), JSON.stringify({ status: 'PASS', checks: results, pageErrors: errors, screenshotData: 'Two synthetic books entered through actual UI; no preloaded user data.' }, null, 2));
  console.log(`PASS ${results.length} browser checks; page errors 0`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
