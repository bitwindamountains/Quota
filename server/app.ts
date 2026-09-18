import { keyCollector } from './key-collectors.js';
import { keyIntegrations } from '../shared/integrations.js';
import { Reminders } from './reminders.js';
import { alarmInput } from '../shared/reminders.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { Credentials, credentialInput } from './credentials.js';
import { codexCollector, openRouterCollector, type Collector } from './collectors.js';
import { dataDir } from './paths.js';
import { z, ZodError } from 'zod';
import { sourceInputSchema, manualSchema } from '../shared/model.js';
import { demoSources } from '../shared/demo.js';
import { Store, AppError } from './storage.js';
import { Scheduler } from './scheduler.js';

export async function createApp(store: Store, options: { port?: number; development?: boolean; schedule?: boolean; webRoot?: string } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 20000 });
  const credentials = new Credentials(store, join(store.path === ':memory:' ? dataDir() : dirname(store.path), 'credentials'));
  const adapters: Record<string, Collector> = {
    codex: codexCollector,
    openrouter: (source, signal) => openRouterCollector(source, signal, () => credentials.resolve(source.id))
  };
  for (const provider of Object.keys(keyIntegrations)) {
    if (provider !== 'openrouter') adapters[provider] = (source, signal) => keyCollector(source, signal, () => credentials.resolve(source.id));
  }
  const scheduler = new Scheduler(store, adapters), secret = randomBytes(32).toString('hex');
  const reminders = new Reminders(store);
  const port = options.port ?? 4317;
  const hosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
  if (options.development) { hosts.add('127.0.0.1:5173'); hosts.add('localhost:5173'); }
  const csrf = (session: string) => createHmac('sha256', secret).update(session).digest('hex');
  await app.register(cookie, { secret });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!hosts.has(req.headers.host ?? '')) return reply.code(403).send({ error: 'Unrecognized local host.' });
    const origin = req.headers.origin;
    if (origin && origin !== 'http://' + req.headers.host) return reply.code(403).send({ error: 'Cross-origin access is not allowed.' });
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return reply.code(403).send({ error: 'Open the dashboard directly on this computer.' });
    if (!req.url.startsWith('/api/') && !req.routeOptions.url?.startsWith('/api/')) return;
    if (req.url === '/api/health' && req.method === 'GET') return;
    if (req.headers['x-quota-client'] !== '1') return reply.code(403).send({ error: 'Dashboard request header required.' });
    if (req.url === '/api/session' && req.method === 'GET') return;
    const signed = req.unsignCookie(req.cookies.quota_session || '');
    const sid = signed.valid ? signed.value ?? '' : '';
    const issued = Number(sid.split('.')[0]);
    if (!/^\d+\.[a-f0-9]{48}$/.test(sid) || Date.now() - issued > 12 * 3600000 || issued > Date.now())
      return reply.code(401).send({ error: 'Local session expired. Reload the dashboard.' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!req.headers['content-type']?.startsWith('application/json')) return reply.code(415).send({ error: 'JSON required.' });
      const token = String(req.headers['x-csrf-token'] ?? ''), expected = csrf(sid);
      if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return reply.code(403).send({ error: 'Invalid local session token. Reload the dashboard.' });
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid input. Check the fields and try again.' });
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.message });
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'Local operation failed. Your saved data has been preserved.' : 'Invalid request.' });
  });
  app.get('/api/health', async () => ({ ready: true }));
  app.get('/api/session', async (req, reply) => {
    const signed = req.unsignCookie(req.cookies.quota_session || '');
    const previous = signed.valid ? signed.value ?? '' : '';
    const valid = /^\d+\.[a-f0-9]{48}$/.test(previous) && Date.now() - Number(previous.split('.')[0]) < 12 * 3600000;
    const sid = valid ? previous : Date.now() + '.' + randomBytes(24).toString('hex');
    reply.setCookie('quota_session', sid, { path: '/', httpOnly: true, sameSite: 'strict', signed: true, maxAge: 12 * 3600 });
    return { csrf: csrf(sid) };
  });
  app.get('/api/state', async () => ({
    sources: store.list(), serverTime: new Date().toISOString(), version: '1.3.0', demo: false
  }));
  app.get('/api/demo', async () => ({
    sources: demoSources(), serverTime: new Date().toISOString(), version: '1.3.0', demo: true
  }));
  app.post('/api/sources', async (req, reply) => {
    const source = store.add(sourceInputSchema.parse(req.body)); reply.code(201); return source;
  });
  app.get<{ Params: { id: string } }>('/api/sources/:id/credential', async req => credentials.status(req.params.id));
  let credentialWindow = 0, credentialWrites = 0;
  app.put<{ Params: { id: string } }>('/api/sources/:id/credential', async req => {
    const parsed = z.object({ revision: z.number().int().positive(), credential: credentialInput }).strict().parse(req.body);
    if (Date.now() - credentialWindow > 60000) { credentialWindow = Date.now(); credentialWrites = 0; }
    if (++credentialWrites > 12) throw new AppError(429, 'Too many credential changes. Wait a minute and try again.');
    const result = await credentials.save(req.params.id, parsed.revision, parsed.credential);
    scheduler.cancel(req.params.id);
    return result;
  });
  app.get('/api/reminders', async () => reminders.state());
  app.put<{ Params: { id: string } }>('/api/sources/:id/alarm', async req => reminders.save(req.params.id, alarmInput.parse(req.body)));
  app.post<{ Params: { id: string } }>('/api/reminders/:id/claim', async req => {
    z.object({}).strict().parse(req.body);
    return { claimed: reminders.claim(z.string().uuid().parse(req.params.id)) };
  });
  app.post<{ Params: { id: string } }>('/api/reminders/:id/dismiss', async req => {
    z.object({}).strict().parse(req.body);
    reminders.dismiss(z.string().uuid().parse(req.params.id)); return { dismissed: true };
  });
  app.put('/api/order', async req => {
    const order = z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict()).max(50).parse(req.body);
    store.reorder(order);
    for (const source of order) scheduler.cancel(source.id);
    return { saved: true };
  });
  app.patch<{ Params: { id: string } }>('/api/sources/:id', async req => {
    const parsed = z.object({ revision: z.number().int().positive(), source: sourceInputSchema, position: z.number().int().min(0).max(10000).optional() }).strict().parse(req.body);
    const updated = store.update(req.params.id, parsed.revision, parsed.source, parsed.position);
    scheduler.cancel(req.params.id); return updated;
  });
  app.delete<{ Params: { id: string } }>('/api/sources/:id', async req => {
    const parsed = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    const reference = credentials.reference(req.params.id);
    store.remove(req.params.id, parsed.revision); scheduler.cancel(req.params.id); await credentials.discard(reference); return { removed: true };
  });
  app.put<{ Params: { id: string } }>('/api/sources/:id/manual', async req => {
    const parsed = manualSchema.parse(req.body);
    return store.manual(req.params.id, parsed.revision, parsed.metrics);
  });
  app.post<{ Params: { id: string } }>('/api/sources/:id/refresh', async (req, reply) => {
    const result = scheduler.request(req.params.id); reply.code(202); return result;
  });
  const root = options.webRoot ?? resolve('dist/web');
  if (existsSync(root)) {
    await app.register(serveStatic, { root, index: ['index.html'], wildcard: true, dotfiles: 'deny', cacheControl: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'Not found.' });
      return reply.sendFile('index.html');
    });
  }
  if (options.schedule !== false) { reminders.start(); scheduler.start(); }
  app.addHook('onClose', async () => { await reminders.stop(); await scheduler.stop(); });
  return { app, scheduler };
}
