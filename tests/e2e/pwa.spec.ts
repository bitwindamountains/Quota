import { expect, test } from '@playwright/test';

test('PWA manifest is installable and offline help never caches private API data', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone'); expect(manifest.start_url).toBe('/');
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src); expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  await page.evaluate(async () => {
    const headers = { 'X-Quota-Client': '1' };
    await fetch('/api/session', { headers }); await fetch('/api/state', { headers });
  });
  const paths = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(new URL(request.url).pathname);
    return result.sort();
  });
  expect(paths).toEqual(['/icons/quota-192.png', '/icons/quota-512.png', '/icons/quota-maskable.png', '/offline.css', '/offline.html']);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Local server is offline' })).toBeVisible();
  expect(await page.evaluate(() => fetch('/api/state').then(() => false).catch(() => true))).toBe(true);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Add source', exact: true })).toBeVisible();
});

test('installation help and Codex detection are available in the UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toBeVisible();
  await page.route('**/api/codex/detect', route => route.fulfill({ json: { detected: true, version: 'test-version', path: 'C:/test/codex.exe', method: 'automatic' } }));
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('button', { name: 'Detect Codex again' }).click();
  await expect(page.getByText(/Codex detected \(test-version/)).toBeVisible();
});
