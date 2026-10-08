import { test, expect } from '@playwright/test';
import { demoSources } from '../../shared/demo';

test('search shortcut navigates from Sources and compact preference survives reload', async ({ page }) => {
  await page.route('**/api/state', route => route.fulfill({ json: { sources: demoSources(), demo: false, serverTime: new Date().toISOString() } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Compact view', exact: true }).click();
  await page.getByRole('button', { name: 'Sources', exact: false }).filter({ hasText: 'Sources' }).first().click();
  await page.keyboard.press('Control+k');
  await expect(page.getByLabel('Search sources')).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Compact view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/compact-mobile.png' });
});

test('detected environment credential connects a new source without re-entering a key', async ({ page }) => {
  await page.route('**/api/connections', route => route.fulfill({ json: { deepseek: ['QUOTA_DEEPSEEK_WORK'] } }));
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  const source = { ...demoSources()[0], provider: 'deepseek', name: 'DeepSeek API', mode: 'manual', revision: 1 };
  await page.route('**/api/sources', route => { writes.push({ method: route.request().method(), body: route.request().postDataJSON() }); return route.fulfill({ json: source }); });
  await page.route('**/api/sources/' + source.id + '/credential', route => {
    if (route.request().method() === 'PUT') writes.push({ method: 'PUT', body: route.request().postDataJSON() });
    return route.fulfill({ json: { method: 'environment', configured: true, variable: 'QUOTA_DEEPSEEK_WORK', revision: 2 } });
  });
  await page.route('**/api/sources/' + source.id, route => { writes.push({ method: route.request().method(), body: route.request().postDataJSON() }); return route.fulfill({ json: { ...source, mode: 'automatic', revision: 3 } }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('AI tool').selectOption('deepseek');
  await dialog.getByLabel('Use a configured server credential').selectOption('QUOTA_DEEPSEEK_WORK');
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.map(w => w.method)).toEqual(['POST', 'PUT', 'PATCH']);
  expect(writes[0].body.mode).toBe('manual');
  expect(writes[1].body.credential).toEqual({ method: 'environment', variable: 'QUOTA_DEEPSEEK_WORK' });
  expect(writes[2].body.source).toMatchObject({ mode: 'automatic' });
});

test('paused sources stay discoverable and source dialogs have accessible names', async ({ page }) => {
  let source = { ...demoSources()[0], name: 'Paused workspace test', enabled: false };
  await page.route('**/api/state', route => route.fulfill({ json: { sources: [source], demo: false, runningSources: [], serverTime: new Date().toISOString() } }));
  await page.route('**/api/sources/' + source.id, async route => {
    source = { ...source, ...route.request().postDataJSON().source };
    await route.fulfill({ json: source });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All sources are paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage paused sources' }).click();
  await page.getByRole('button', { name: 'Enable Paused workspace test' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const card = page.getByRole('article', { name: source.name + ' source' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Settings for ' + source.name }).click();
  const dialog = page.getByRole('dialog', { name: 'Source settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Source settings' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card.getByRole('button', { name: 'Settings for ' + source.name })).toBeFocused();
});

test('sorting, provider search, attention filter and running feedback work together', async ({ page }) => {
  const sources = demoSources().map(source => ({ ...source, name: source.provider === 'cursor' ? 'Studio' : source.name }));
  const first = sources[0]; first.mode = 'automatic';
  await page.route('**/api/state', route => route.fulfill({ json: { sources, demo: false, runningSources: [first.id], serverTime: new Date().toISOString() } }));
  await page.goto('/');
  await expect(page.getByRole('article', { name: first.name + ' source' })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Refresh ' + first.name, exact: true })).toBeDisabled();
  await page.getByLabel('Sort sources').selectOption('name');
  const labels = await page.getByRole('article').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
  expect(labels).toEqual(sources.map(source => source.name).sort((a, b) => a.localeCompare(b)).map(name => name + ' source'));
  await page.getByLabel('Search sources').fill('  cursor  ');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'Studio source' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'Show sources needing attention' }).click();
  await expect(page.getByRole('button', { name: 'Needs attention', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('refresh all reports one summary and reports queued sources without requiring retries', async ({ page }) => {
  const sources = demoSources().filter(source => ['codex', 'openrouter'].includes(source.provider)).map(source => ({ ...source, mode: 'automatic' }));
  await page.route('**/api/state', route => route.fulfill({ json: { sources, demo: false, runningSources: [], serverTime: new Date().toISOString() } }));
  for (let i = 0; i < sources.length; i++) await page.route('**/api/sources/' + sources[i].id + '/refresh', route => route.fulfill({ json: { status: i === 0 ? 'accepted' : 'queued' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('1 checking. 1 queued. Manual readings are unchanged.', { exact: true })).toBeVisible();
});

test('mobile navigation traps focus and narrow layouts retain readable controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const navigation = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', { name: 'Quick guide' }).focus();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: 'quota.' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a source' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.getByLabel('Display name').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: 'docs/screenshots/source-setup-mobile.png', fullPage: false });
});

test('key dashboard text meets contrast targets in light and dark themes', async ({ page }) => {
  await page.route('**/api/state', route => route.fulfill({ json: { sources: demoSources(), demo: false, serverTime: new Date().toISOString() } }));
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('article')).toHaveCount(6);
    const ratios = await page.evaluate(() => {
      const luminance = (color: string) => {
        const canvas = document.createElement('canvas').getContext('2d')!;
        canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
        const channels = Array.from(canvas.getImageData(0, 0, 1, 1).data).slice(0, 3).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return ['.card-title p', '.metric-top', '.used-label', '.timestamp', '.page-heading p', '.filter.active', '.button.primary'].map(selector => {
        const element = document.querySelector(selector)!;
        let parent: Element | null = element, background = '';
        while (parent) { background = getComputedStyle(parent).backgroundColor; if (background !== 'rgba(0, 0, 0, 0)') break; parent = parent.parentElement; }
        const foreground = luminance(getComputedStyle(element).color), back = luminance(background);
        return { selector, ratio: (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05) };
      });
    });
    for (const result of ratios) expect(result.ratio, colorScheme + ' ' + result.selector).toBeGreaterThanOrEqual(4.5);
  }
});

test('unreachable workspace is not mistaken for an empty account', async ({ page }) => {
  await page.route('**/api/state', route => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connect to your local workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All your limits. One quiet place.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add source', exact: true })).toBeDisabled();
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add source', exact: true })).toBeEnabled();
});

test('a lost local session is renewed before saving a new source', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a source' });
  await dialog.getByLabel('AI tool').selectOption('custom');
  await dialog.getByLabel('Display name').fill('Session recovery test');
  await context.clearCookies();
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Session recovery test source' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('scan results can be reviewed and added in one step', async ({ page }) => {
  await page.route('**/api/scan', route => route.fulfill({ json: { candidates: [{ provider: 'gemini', name: 'Gemini', mode: 'manual', found: 'Gemini CLI installed' }] } }));
  await page.goto('/');
  await expect(page.getByText('Found 1 tool on this computer:')).toBeVisible();
  await page.getByRole('button', { name: 'Review and add' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scan this computer' });
  await expect(dialog.getByText('Gemini CLI installed')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add 1 tool' }).click();
  await expect(dialog.getByLabel('Added')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Gemini source' })).toBeVisible();
});
test('pasting a usage page records a manual source and clears it from catch-up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add source' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add a source' });
  await add.getByLabel('AI tool').selectOption('cline');
  await add.getByLabel('Display name').fill('Cline paste');
  await add.getByRole('button', { name: 'Add source' }).click();
  const card = page.getByRole('article', { name: 'Cline paste source' });
  await expect(page.getByText(/need(s)? an update:.*Cline paste/)).toBeVisible();
  await card.getByRole('button', { name: 'Record reading for Cline paste' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Cline paste reading' });
  await dialog.getByLabel('Paste the usage page').fill('Monthly credits\nResets in 5 days\n30% used');
  await expect(dialog.getByText('Filled 1 of 1 windows found.', { exact: false })).toBeVisible();
  await expect(dialog.getByLabel('Used (%)')).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Save reading' }).click();
  await expect(card.getByText('70%', { exact: true })).toBeVisible();
  await expect(card.getByText('Monthly credits')).toBeVisible();
});
