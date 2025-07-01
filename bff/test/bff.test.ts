import { describe, it, expect, beforeEach } from 'vitest';
import { contextFor, createServer } from '../src/server.js';
import type { InvoiceRec, OrderRec, Services } from '../src/resolvers.js';

const inv = (id: string, customerId: string, dueOn: string, totalCents: number, paidCents = 0, orderId: string | null = null): InvoiceRec => ({
  id, customerId, number: `INV-${id}`, issuedOn: '2024-01-01', dueOn, totalCents, paidCents, currency: 'USD',
  status: paidCents >= totalCents ? 'PAID' : paidCents > 0 ? 'PARTIALLY_PAID' : 'OPEN', orderId,
});

function fakeServices() {
  const invoices: InvoiceRec[] = [
    inv('1', 'C1', '2024-03-01', 10000, 0, 'o1'),
    inv('2', 'C1', '2024-04-01', 5000, 2000, 'o2'),
    inv('3', 'C1', '2024-05-01', 7000, 0, 'o1'),
    inv('4', 'C1', '2024-02-01', 3000, 3000),
    inv('9', 'C2', '2024-03-01', 99900),
  ];
  const orders: OrderRec[] = [
    { id: 'o1', number: 'SO-1', status: 'SHIPPED', placedAt: '2024-02-01T10:00:00Z', trackingUrl: 'https://track/1' },
    { id: 'o2', number: 'SO-2', status: 'DELIVERED', placedAt: '2024-03-01T10:00:00Z', trackingUrl: null },
  ];
  const calls = { ordersByIds: [] as string[][], pay: [] as any[], push: [] as any[] };
  const services: Services = {
    async invoicesFor(cid) { return invoices.filter((i) => i.customerId === cid).map((i) => ({ ...i })); },
    async ordersByIds(ids) { calls.ordersByIds.push([...ids]); return orders.filter((o) => ids.includes(o.id)); },
    async pay(req) {
      calls.pay.push(req);
      let left = req.amountCents;
      for (const id of req.invoiceIds) {
        const i = invoices.find((x) => x.id === id)!;
        const take = Math.min(left, i.totalCents - i.paidCents);
        i.paidCents += take; left -= take;
        i.status = i.paidCents >= i.totalCents ? 'PAID' : 'PARTIALLY_PAID';
      }
      return { paymentId: 'pay_1', status: 'succeeded' };
    },
    async dispute(_c, id) { invoices.find((x) => x.id === id)!.status = 'DISPUTED'; },
    async registerPushToken(c, token, platform) { calls.push.push({ c, token, platform }); },
    async accountName(cid) { return cid === 'C1' ? 'Acme Retail' : 'Other'; },
  };
  return { services, calls };
}

const server = createServer();
let svc: ReturnType<typeof fakeServices>;
beforeEach(() => { svc = fakeServices(); });

async function run(query: string, variables: Record<string, unknown> = {}, customerId: string | null = 'C1') {
  const res = await server.executeOperation({ query, variables }, { contextValue: contextFor(customerId, svc.services, '2024-04-15') });
  if (res.body.kind !== 'single') throw new Error('incremental');
  return res.body.singleResult;
}

describe('PortalGo BFF', () => {
  it('home screen in one query: balance, overdue count, oldest-first invoices', async () => {
    const r = await run(`{ me { name openBalance { cents formatted } overdueCount }
      invoices(first: 2) { totalBalance { cents } edges { node { number balance { cents } daysOverdue } } pageInfo { hasNextPage endCursor } } }`);
    expect(r.errors).toBeUndefined();
    const d = r.data as any;
    expect(d.me).toEqual({ name: 'Acme Retail', openBalance: { cents: 20000, formatted: '$200.00' }, overdueCount: 2 });
    expect(d.invoices.edges.map((e: any) => e.node.number)).toEqual(['INV-4', 'INV-1']);
    expect(d.invoices.edges[1].node.daysOverdue).toBe(45);
    expect(d.invoices.pageInfo.hasNextPage).toBe(true);
  });

  it('cursor pagination walks every invoice exactly once', async () => {
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await run(`query($after: String) { invoices(first: 1, after: $after) { edges { node { id } } pageInfo { hasNextPage endCursor } } }`, { after });
      const c = (r.data as any).invoices;
      seen.push(...c.edges.map((e: any) => e.node.id));
      if (!c.pageInfo.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }
    expect(seen).toEqual(['4', '1', '2', '3']);
  });

  it('batches order lookups with DataLoader (no N+1)', async () => {
    await run(`{ invoices(first: 10) { edges { node { order { number trackingUrl } } } } }`);
    expect(svc.calls.ordersByIds).toEqual([['o1', 'o2']]);
  });

  it('isolates customers and requires auth', async () => {
    expect((await run(`{ invoice(id: "9") { id } }`)).data).toEqual({ invoice: null });
    const r = await run(`{ me { name } }`, {}, null);
    expect(r.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('pays selected invoices with validation', async () => {
    const m = `mutation($input: PayInvoicesInput!) { payInvoices(input: $input) { paymentId invoices { id status balance { cents } } } }`;
    const ok = await run(m, { input: { invoiceIds: ['1', '2'], amountCents: 11000, paymentMethodId: 'pm_1', idempotencyKey: 'abc12345' } });
    expect((ok.data as any).payInvoices.invoices).toEqual([
      { id: '1', status: 'PAID', balance: { cents: 0 } },
      { id: '2', status: 'PARTIALLY_PAID', balance: { cents: 2000 } },
    ]);
    const over = await run(m, { input: { invoiceIds: ['3'], amountCents: 999999, paymentMethodId: 'pm_1', idempotencyKey: 'abc12346' } });
    expect(over.errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
    const foreign = await run(m, { input: { invoiceIds: ['9'], amountCents: 100, paymentMethodId: 'pm_1', idempotencyKey: 'abc12347' } });
    expect(foreign.errors?.[0].extensions?.code).toBe('NOT_FOUND');
    expect(svc.calls.pay).toHaveLength(1);
  });

  it('disputes and push tokens validate input', async () => {
    const d = await run(`mutation { disputeInvoice(input: { invoiceId: "3", reason: "Pallet arrived damaged" }) { status } }`);
    expect((d.data as any).disputeInvoice.status).toBe('DISPUTED');
    expect((await run(`mutation { disputeInvoice(input: { invoiceId: "3", reason: "bad" }) { status } }`)).errors).toBeDefined();
    expect((await run(`mutation { registerPushToken(token: "ExponentPushToken[abc_123]", platform: "ios") }`)).data).toEqual({ registerPushToken: true });
    expect((await run(`mutation { registerPushToken(token: "nope", platform: "ios") }`)).errors).toBeDefined();
  });

  it("the app's deepest screen query stays within the depth limit", async () => {
    const deep = await run(`{ invoices { edges { node { order { number } total { cents } balance { currency } } } } invoice(id: "1") { order { number } } me { name } }`);
    expect(deep.errors).toBeUndefined(); // depth 5 is fine; the limit is 6
  });
});
