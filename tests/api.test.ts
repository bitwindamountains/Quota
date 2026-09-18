import { afterEach, describe, it, expect } from 'vitest';
import { Store } from '../server/storage.js';
import { createApp } from '../server/app.js';
const resources: { app: Awaited<ReturnType<typeof createApp>>['app']; store: Store }[] = [];
async function setup() {
  const store = new Store(':memory:');
  const { app } = await createApp(store, { schedule: false, webRoot: 'does-not-exist' });
  resources.push({ app, store });
  const base = { host: '127.0.0.1:4317', 'x-quota-client': '1' };
  const session = await app.inject({ url: '/api/session', headers: base });
  const headers = { ...base, cookie: session.cookies.map(c => c.name + '=' + c.value).join('; '), 'x-csrf-token': session.json().csrf, 'content-type': 'application/json' };
  return { app, store, headers };
}
afterEach(async () => { for (const { app, store } of resources) { await app.close(); store.close(); } resources.length = 0; });
describe('local API security and mutations', () => {
  it('blocks DNS-rebinding hosts, cross-site origins, simple requests, and absent sessions', async () => {
    const { app, headers } = await setup();
    expect((await app.inject({ url: '/api/state', headers: { ...headers, host: 'attacker.example:4317' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { ...headers, origin: 'https://attacker.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { ...headers, origin: 'null' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { host: headers.host } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { host: headers.host, 'x-quota-client': '1' } })).statusCode).toBe(401);
  });
  it('requires session-bound CSRF and JSON mutations', async () => {
    const { app, headers } = await setup(), payload = { provider: 'custom', name: 'Test' };
    expect((await app.inject({ method: 'POST', url: '/api/sources', headers: { ...headers, 'x-csrf-token': 'x'.repeat(64) }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/sources', headers: { ...headers, 'content-type': 'text/plain' }, payload: 'test' })).statusCode).toBe(415);
  });
  it('creates, reads, updates, and deletes with optimistic concurrency', async () => {
    const { app, headers } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/sources', headers, payload: { provider: 'custom', name: 'Test' } });
    expect(created.statusCode).toBe(201);
    const s = created.json();
    const updated = await app.inject({ method: 'PATCH', url: '/api/sources/' + s.id, headers, payload: { revision: 1, source: { provider: 'custom', name: 'Renamed', enabled: false } } });
    expect(updated.statusCode).toBe(200); expect(updated.json().revision).toBe(2);
    const stale = await app.inject({ method: 'DELETE', url: '/api/sources/' + s.id, headers, payload: { revision: 1 } });
    expect(stale.statusCode).toBe(409);
    const removed = await app.inject({ method: 'DELETE', url: '/api/sources/' + s.id, headers, payload: { revision: 2 } });
    expect(removed.statusCode).toBe(200);
  });
  it('rejects arbitrary URLs, secrets, commands, and unsupported automatic sources', async () => {
    const { app, headers } = await setup();
    for (const extra of [{ url: 'http://internal' }, { apiKey: 'SENTINEL_SECRET' }, { command: 'whoami' }, { mode: 'automatic' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/sources', headers, payload: { provider: 'custom', name: 'Test', ...extra } });
      expect(response.statusCode).toBe(400); expect(response.body).not.toContain('SENTINEL_SECRET');
    }
  });
  it('demo reads never seed the real workspace or start providers', async () => {
    const { app, headers } = await setup();
    const demo = await app.inject({ url: '/api/demo', headers }); expect(demo.json().sources).toHaveLength(6);
    const state = await app.inject({ url: '/api/state', headers }); expect(state.json().sources).toEqual([]);
    expect(state.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('keeps credential settings write-only, scoped, CSRF protected, and revision checked', async () => {
    const { app, headers } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/sources', headers, payload: { provider: 'openrouter', name: 'Credential test' } });
    const url = '/api/sources/' + created.json().id + '/credential';
    const payload = { revision: 1, credential: { method: 'environment', variable: 'QUOTA_OPENROUTER_API_TEST' } };
    process.env.QUOTA_OPENROUTER_API_TEST = 'synthetic-secret-canary';
    try {
      expect((await app.inject({ method: 'PUT', url, headers: { ...headers, 'x-csrf-token': '' }, payload })).statusCode).toBe(403);
      const saved = await app.inject({ method: 'PUT', url, headers, payload });
      expect(saved.statusCode).toBe(200); expect(saved.json().configured).toBe(true);
      expect(saved.body).not.toContain('synthetic-secret-canary');
      const status = await app.inject({ url, headers });
      expect(status.body).not.toContain('synthetic-secret-canary');
      expect(status.json()).not.toHaveProperty('reference');
      expect((await app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(409);
      const invalid = await app.inject({ method: 'PUT', url, headers, payload: { revision: 2, credential: { method: 'environment', variable: 'AWS_SECRET_ACCESS_KEY', 'synthetic-secret-canary': true } } });
      expect(invalid.statusCode).toBe(400); expect(invalid.body).not.toContain('synthetic-secret-canary');
      expect((await app.inject({ url: '/api/state', headers })).body).not.toContain('synthetic-secret-canary');
    } finally { delete process.env.QUOTA_OPENROUTER_API_TEST; }
  });

  it('protects per-window alarm settings and rejects invalid recipients', async () => {
    const { app, store, headers } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/sources', headers, payload: { provider: 'custom', name: 'Reminder' } });
    const source = created.json();
    const reading = await app.inject({ method: 'PUT', url: '/api/sources/' + source.id + '/manual', headers, payload: { revision: source.revision, metrics: [{ key: 'weekly', label: 'Weekly', kind: 'quota', unit: 'percent', resetAt: new Date(Date.now() + 60000).toISOString(), observedAt: new Date().toISOString(), provenance: 'user_entered', freshnessSeconds: 3600 }] } });
    expect(reading.statusCode).toBe(200);
    const url = '/api/sources/' + source.id + '/alarm';
    const payload = { revision: 0, sourceRevision: store.get(source.id).revision, metricKey: 'weekly', enabled: true, email: null };
    expect((await app.inject({ method: 'PUT', url, headers: { ...headers, 'x-csrf-token': '' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url, headers, payload: { ...payload, email: 'one@example.com,two@example.com' } })).statusCode).toBe(400);
    const saved = await app.inject({ method: 'PUT', url, headers, payload }); expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(409);
    const state = await app.inject({ url: '/api/reminders', headers }); expect(state.json().alarms).toHaveLength(1);
    expect((await app.inject({ url: '/api/reminders', headers: { host: headers.host } })).statusCode).toBe(403);
  });

});
