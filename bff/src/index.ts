import { startStandaloneServer } from '@apollo/server/standalone';
import { contextFor, createServer } from './server.js';
import type { Services } from './resolvers.js';

const API = process.env.CORE_API ?? 'http://localhost:8080';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

const services: Services = {
  invoicesFor: (cid) => call(`/internal/customers/${cid}/invoices`),
  ordersByIds: (ids) => call(`/internal/orders?ids=${ids.map(encodeURIComponent).join(',')}`),
  pay: (req) => call('/internal/payments', { method: 'POST', headers: { 'Idempotency-Key': req.idempotencyKey }, body: JSON.stringify(req) }),
  dispute: (cid, id, reason) => call(`/internal/customers/${cid}/invoices/${id}/disputes`, { method: 'POST', body: JSON.stringify({ reason }) }),
  registerPushToken: (cid, token, platform) => call(`/internal/customers/${cid}/push-tokens`, { method: 'POST', body: JSON.stringify({ token, platform }) }),
  accountName: async (cid) => (await call<{ name: string }>(`/internal/customers/${cid}`)).name,
};

/** The API gateway validates the JWT and forwards the customer id; the BFF never parses tokens itself. */
const { url } = await startStandaloneServer(createServer(), {
  listen: { port: Number(process.env.PORT ?? 4000) },
  context: async ({ req }) => contextFor((req.headers['x-customer-id'] as string) ?? null, services),
});
console.log(`PortalGo BFF at ${url}`);
