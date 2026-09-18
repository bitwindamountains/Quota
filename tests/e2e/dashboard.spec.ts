import { test, expect } from '@playwright/test';
test('manual workspace lifecycle, demo isolation, persistence, and keyboard dialog', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All your limits. One quiet place.' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore the demo', exact: true }).click();
  await expect(page.getByText('Demo workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(6);
  await page.screenshot({ path: 'docs/screenshots/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add your first source' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('AI tool').selectOption('claude');
  await dialog.getByLabel('Display name').fill('Claude test');
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  const card = page.getByRole('article', { name: 'Claude test source' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Add first reading' }).click();
  await dialog.getByLabel('Window or metric name').fill('Session window');
  await dialog.getByLabel('Used (%)').fill('70');
  await dialog.getByRole('button', { name: 'In 5h', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save reading' }).click();
  await expect(card.getByText('30%', { exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText('30%', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Update Claude test' }).click();
  await dialog.getByRole('button', { name: 'New metric' }).click();
  await dialog.getByLabel('Window or metric name').fill('Weekly');
  await dialog.getByLabel('What does the provider show?').selectOption('reset');
  await dialog.getByRole('button', { name: 'In 24h', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save reading' }).click();
  await expect(card.getByText('Capacity unknown')).toBeVisible();
  await expect(card.getByText('30%', { exact: true })).toBeVisible();
  await page.getByLabel('Search sources').fill('nonexistent');
  await expect(page.getByText('No sources match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await card.getByRole('button', { name: 'Settings for Claude test' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(card.getByRole('button', { name: 'Settings for Claude test' })).toBeFocused();
  await page.getByRole('button', { name: 'Sources', exact: false }).filter({ hasText: 'Sources' }).first().click();
  await page.getByRole('button', { name: 'Pause Claude test' }).click();
  await expect(page.getByText('Personal · Manual entry · Paused')).toBeVisible();
  await page.getByRole('button', { name: 'Enable Claude test' }).click();
  await page.getByRole('button', { name: 'Remove Claude test' }).click();
  await dialog.getByRole('button', { name: 'Keep source' }).click();
  await expect(page.getByText('Claude test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Claude test' }).click();
  await dialog.getByRole('button', { name: 'Remove source', exact: true }).click();
  await expect(page.getByText('Your toolkit starts here')).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile demo has no horizontal overflow and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Quick guide' }).click();
  await expect(page.getByRole('heading', { name: 'A clearer view of your limits.' })).toBeVisible();
});
test('automatic auth failure degrades to a working manual source', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('AI tool').selectOption('openrouter');
  await dialog.getByLabel('Display name').fill('Router auth test');
  await dialog.getByRole('radio', { name: 'Automatic', exact: false }).check();
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  const card = page.getByRole('article', { name: 'Router auth test source' });
  await page.reload();
  await expect(card.getByText('Configure a protected key or OPENROUTER_API_KEY in source settings, then retry.')).toBeVisible({ timeout: 20000 });
  await card.getByRole('button', { name: 'Settings for Router auth test' }).click();
  await dialog.getByRole('radio', { name: 'Manual entry', exact: false }).check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await card.getByRole('button', { name: 'Add first reading' }).click();
  await dialog.getByLabel('What does the provider show?').selectOption('balance');
  await dialog.getByLabel('Remaining', { exact: true }).fill('12.50');
  await dialog.getByRole('button', { name: 'Save reading' }).click();
  await expect(card.getByText('$12.5', { exact: true })).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveCount(0);
});
test('dark theme and effective 200% desktop layout remain usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 720, height: 550 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick guide' }).click();
  await page.getByRole('button', { name: 'Explore demo' }).click();
  await expect(page.getByRole('article')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(27, 28, 37)');
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(228, 227, 238)');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.screenshot({ path: 'docs/screenshots/dashboard-dark.png', fullPage: true });
});


test('protected credential entry stays write-only and can be disconnected', async ({ page }) => {
  test.skip(process.platform !== 'win32', 'Windows DPAPI only');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('AI tool').selectOption('openrouter');
  await dialog.getByLabel('Display name').fill('Protected key test');
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  const card = page.getByRole('article', { name: 'Protected key test source' });
  await expect(dialog.getByRole('heading', { name: 'OpenRouter credential', exact: true })).toBeVisible();
  await dialog.getByLabel('Credential storage').selectOption('protected');
  await dialog.getByLabel('New API key').fill('synthetic-browser-test-key-12345');
  await expect(dialog.getByLabel('New API key')).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Save credential settings' }).click();
  await expect(dialog.getByText('Credential settings saved.', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('New API key')).toHaveValue('');
  await page.screenshot({ path: 'docs/screenshots/credential-settings.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await card.getByRole('button', { name: 'Settings for Protected key test' }).click();
  await expect(dialog.getByLabel('Credential storage')).toHaveValue('protected');
  await expect(dialog.getByLabel('New API key')).toHaveValue('');
  await dialog.getByLabel('Credential storage').selectOption('none');
  await dialog.getByRole('button', { name: 'Save credential settings' }).click();
  await expect(dialog.getByText('Credential removed. Automatic collection needs a credential to resume.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
});


test('per-window reset alarms persist, fire once, and can be dismissed or disabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reset reminders', exact: true })).toBeVisible();
  const created = await page.evaluate(async () => {
    const headers = { 'X-Quota-Client': '1', 'Content-Type': 'application/json', 'X-CSRF-Token': (await (await fetch('/api/session', { headers: { 'X-Quota-Client': '1' } })).json()).csrf };
    const source = await (await fetch('/api/sources', { method: 'POST', headers, body: JSON.stringify({ provider: 'custom', name: 'Reminder lifecycle test' }) })).json();
    const now = Date.now();
    const metrics = [['five-hour', 'Five hour', now + 300000], ['weekly', 'Weekly', now + 7 * 86400000]].map(([key, label, reset]) => ({ key, label, kind: 'quota', unit: 'percent', usedPercent: '80', resetAt: new Date(Number(reset)).toISOString(), resetKind: 'fixed', resetBasis: 'user_entered', observedAt: new Date(now).toISOString(), provenance: 'user_entered', freshnessSeconds: 3600 }));
    return (await fetch('/api/sources/' + source.id + '/manual', { method: 'PUT', headers, body: JSON.stringify({ revision: source.revision, metrics }) })).json();
  });
  await page.reload();
  const card = page.getByRole('article', { name: 'Reminder lifecycle test source' }), dialog = page.getByRole('dialog');
  await card.getByRole('button', { name: 'Set alarm for Five hour', exact: true }).click();
  await expect(dialog.getByLabel('Email reminder', { exact: true })).toBeDisabled();
  await expect(dialog.getByText(/Email needs SMTP setup/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save alarm', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Edit alarm for Five hour', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Set alarm for Weekly', exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByRole('button', { name: 'Edit alarm for Five hour', exact: true })).toBeVisible();
  await page.evaluate(async id => {
    const headers = { 'X-Quota-Client': '1', 'Content-Type': 'application/json', 'X-CSRF-Token': (await (await fetch('/api/session', { headers: { 'X-Quota-Client': '1' } })).json()).csrf };
    const state = await (await fetch('/api/state', { headers })).json();
    const source = state.sources.find((s: { id: string }) => s.id === id);
    source.metrics[0].resetAt = new Date(Date.now() + 4000).toISOString();
    await fetch('/api/sources/' + id + '/manual', { method: 'PUT', headers, body: JSON.stringify({ revision: source.revision, metrics: source.metrics }) });
  }, created.id);
  await expect(page.getByText('1 reset reminder: check your provider for availability.')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'View reminders', exact: true }).click();
  await expect(dialog.getByText(/Reminder lifecycle test.*Five hour/)).toBeVisible();
  await expect(dialog.getByText('In-app reminder', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/reset-reminders.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Dismiss reminder', exact: true }).click();
  await expect(dialog.getByText('Dismissed', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByText('1 reset reminder: check your provider for availability.')).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit alarm for Five hour', exact: true }).click();
  await dialog.getByLabel('Alarm on this reset window').uncheck();
  await dialog.getByRole('button', { name: 'Save alarm', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Set alarm for Five hour', exact: true })).toBeVisible();
});


test('key-enabled sources open provider-specific credential setup immediately after adding', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  for (const [provider, name, variable] of [
    ['openai', 'OpenAI API', 'OPENAI_ADMIN_KEY'], ['anthropic', 'Anthropic API', 'ANTHROPIC_ADMIN_KEY'],
    ['cursor', 'Cursor', 'CURSOR_API_KEY'], ['mistral', 'Mistral', 'MISTRAL_ADMIN_KEY'], ['deepseek', 'DeepSeek API', 'DEEPSEEK_API_KEY'], ['copilot', 'GitHub Copilot', 'GITHUB_COPILOT_TOKEN']
  ]) {
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await dialog.getByLabel('AI tool').selectOption(provider);
    await dialog.getByLabel('Display name').fill(name + ' key setup test');
    await expect(dialog.getByRole('radio', { name: 'Automatic', exact: false })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: name + ' credential', exact: true })).toBeVisible();
    if (process.platform === 'win32') {
      await expect(dialog.getByLabel('Credential storage')).toHaveValue('protected');
      await expect(dialog.getByLabel('New API key')).toHaveAttribute('type', 'password');
    }
    await dialog.getByLabel('Credential storage').selectOption('environment');
    await expect(dialog.getByLabel('Environment variable name')).toHaveValue(variable);
    await dialog.getByRole('button', { name: 'Save credential settings', exact: true }).click();
    await expect(dialog.getByText('Credential settings saved.', { exact: true })).toBeVisible();
    if (provider === 'openai') await page.screenshot({ path: 'docs/screenshots/provider-key-settings.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await dialog.getByLabel('AI tool').selectOption('gemini-api');
  await expect(dialog.getByRole('radio', { name: 'Automatic', exact: false })).toBeDisabled();
  await expect(dialog.getByText(/model API key alone/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
