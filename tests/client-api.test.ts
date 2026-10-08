import { afterEach, expect, it, vi } from 'vitest';
import { api, session } from '../web/src/api';
afterEach(() => vi.unstubAllGlobals());
it('renews a rejected session once before retrying a mutation', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(Response.json({ csrf: 'new-session-token' }))
    .mockResolvedValueOnce(Response.json({ saved: true }));
  vi.stubGlobal('fetch', fetch);
  expect(await api('/sources', 'POST', { name: 'test' })).toEqual({ saved: true });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[2][1].headers['X-CSRF-Token']).toBe('new-session-token');
});
it('does not replay ambiguous writes or bypass CSRF rejection', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('network failed'));
  vi.stubGlobal('fetch', fetch);
  await expect(api('/sources', 'POST', {})).rejects.toThrow('could not be confirmed');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockResolvedValue(Response.json({ error: 'Invalid token' }, { status: 403 }));
  await expect(api('/sources', 'POST', {})).rejects.toThrow('Invalid token');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('coalesces simultaneous session renewals', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ csrf: 'shared' }));
  vi.stubGlobal('fetch', fetch);
  await Promise.all([session(), session(), session()]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
