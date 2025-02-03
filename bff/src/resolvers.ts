import DataLoader from 'dataloader';
import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';

export interface InvoiceRec { id: string; customerId: string; number: string; issuedOn: string; dueOn: string; totalCents: number; paidCents: number; currency: string; status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'DISPUTED'; orderId: string | null }
export interface OrderRec { id: string; number: string; status: 'PLACED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'; placedAt: string; trackingUrl: string | null }

/** Downstream services (REST in production; in-memory in tests). */
export interface Services {
  invoicesFor(customerId: string): Promise<InvoiceRec[]>;
  ordersByIds(ids: readonly string[]): Promise<OrderRec[]>;
  pay(req: { customerId: string; invoiceIds: string[]; amountCents: number; paymentMethodId: string; idempotencyKey: string }): Promise<{ paymentId: string; status: string }>;
  dispute(customerId: string, invoiceId: string, reason: string): Promise<void>;
  registerPushToken(customerId: string, token: string, platform: string): Promise<void>;
  accountName(customerId: string): Promise<string>;
}

export interface Ctx {
  customerId: string | null;
  services: Services;
  today: string; // YYYY-MM-DD, injected for testability
  loaders: { order: DataLoader<string, OrderRec | null> };
}

export function makeLoaders(services: Services): Ctx['loaders'] {
  // Batches every Invoice.order lookup in one request into a single downstream call (no N+1).
  return {
    order: new DataLoader(async (ids) => {
      const rows = await services.ordersByIds(ids);
      const byId = new Map(rows.map((o) => [o.id, o]));
      return ids.map((id) => byId.get(id) ?? null);
    }),
  };
}

const auth = (ctx: Ctx) => {
  if (!ctx.customerId) throw new GraphQLError('sign in required', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.customerId;
};

const money = (cents: number, currency: string) => ({
  cents, currency, formatted: new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100),
});
const balanceOf = (i: InvoiceRec) => Math.max(0, i.totalCents - i.paidCents);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const encodeCursor = (i: InvoiceRec) => Buffer.from(`${i.dueOn}|${i.id}`).toString('base64url');
const decodeCursor = (c: string) => {
  const [dueOn, id] = Buffer.from(c, 'base64url').toString().split('|');
  if (!dueOn || !id) throw new GraphQLError('bad cursor', { extensions: { code: 'BAD_USER_INPUT' } });
  return { dueOn, id };
};

/** Oldest due first (what customers want to pay first); stable by id. */
const order = (a: InvoiceRec, b: InvoiceRec) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id);

export const resolvers = {
  DateTime: new GraphQLScalarType({
    name: 'DateTime',
    serialize: (v) => new Date(v as string).toISOString(),
    parseValue: (v) => new Date(v as string).toISOString(),
    parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value).toISOString() : null),
  }),

  Query: {
    async me(_: unknown, __: unknown, ctx: Ctx) {
      const cid = auth(ctx);
      const [name, invs] = await Promise.all([ctx.services.accountName(cid), ctx.services.invoicesFor(cid)]);
      const open = invs.filter((i) => i.status !== 'PAID');
      return {
        customerId: cid, name,
        openBalance: money(open.reduce((s, i) => s + balanceOf(i), 0), invs[0]?.currency ?? 'USD'),
        overdueCount: open.filter((i) => daysBetween(i.dueOn, ctx.today) > 0).length,
      };
    },

    async invoices(_: unknown, args: { first: number; after?: string; status?: InvoiceRec['status'] }, ctx: Ctx) {
      const cid = auth(ctx);
      const first = Math.min(Math.max(args.first, 1), 50);
      let rows = (await ctx.services.invoicesFor(cid)).filter((i) => !args.status || i.status === args.status).sort(order);
      const totalBalance = money(rows.reduce((s, i) => s + balanceOf(i), 0), rows[0]?.currency ?? 'USD');
      if (args.after) {
        const c = decodeCursor(args.after);
        rows = rows.filter((i) => i.dueOn > c.dueOn || (i.dueOn === c.dueOn && i.id > c.id));
      }
      const page = rows.slice(0, first);
      return {
        edges: page.map((node) => ({ cursor: encodeCursor(node), node })),
        pageInfo: { endCursor: page.length ? encodeCursor(page[page.length - 1]) : null, hasNextPage: rows.length > first },
        totalBalance,
      };
    },

    async invoice(_: unknown, { id }: { id: string }, ctx: Ctx) {
      const cid = auth(ctx);
      return (await ctx.services.invoicesFor(cid)).find((i) => i.id === id) ?? null; // other customers' ids → null
    },
  },

  Invoice: {
    total: (i: InvoiceRec) => money(i.totalCents, i.currency),
    balance: (i: InvoiceRec) => money(balanceOf(i), i.currency),
    daysOverdue: (i: InvoiceRec, _: unknown, ctx: Ctx) => (i.status === 'PAID' ? 0 : Math.max(0, daysBetween(i.dueOn, ctx.today))),
    order: (i: InvoiceRec, _: unknown, ctx: Ctx) => (i.orderId ? ctx.loaders.order.load(i.orderId) : null),
  },

  Mutation: {
    async payInvoices(_: unknown, { input }: { input: { invoiceIds: string[]; amountCents: number; paymentMethodId: string; idempotencyKey: string } }, ctx: Ctx) {
      const cid = auth(ctx);
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey)) throw new GraphQLError('invalid idempotency key', { extensions: { code: 'BAD_USER_INPUT' } });
      if (input.amountCents <= 0) throw new GraphQLError('amount must be positive', { extensions: { code: 'BAD_USER_INPUT' } });
      const mine = new Map((await ctx.services.invoicesFor(cid)).map((i) => [i.id, i]));
      const selected = input.invoiceIds.map((id) => mine.get(id));
      if (selected.some((i) => !i)) throw new GraphQLError('invoice not found', { extensions: { code: 'NOT_FOUND' } });
      const owed = selected.reduce((s, i) => s + balanceOf(i!), 0);
      if (input.amountCents > owed) throw new GraphQLError(`amount exceeds balance of selected invoices (${owed})`, { extensions: { code: 'BAD_USER_INPUT' } });
      const r = await ctx.services.pay({ customerId: cid, ...input });
      const fresh = new Map((await ctx.services.invoicesFor(cid)).map((i) => [i.id, i]));
      return { ...r, invoices: input.invoiceIds.map((id) => fresh.get(id)!) };
    },

    async disputeInvoice(_: unknown, { input }: { input: { invoiceId: string; reason: string } }, ctx: Ctx) {
      const cid = auth(ctx);
      const reason = input.reason.trim();
      if (reason.length < 10) throw new GraphQLError('please describe the problem (10+ characters)', { extensions: { code: 'BAD_USER_INPUT' } });
      if (!(await ctx.services.invoicesFor(cid)).some((i) => i.id === input.invoiceId)) throw new GraphQLError('invoice not found', { extensions: { code: 'NOT_FOUND' } });
      await ctx.services.dispute(cid, input.invoiceId, reason.slice(0, 2000));
      return (await ctx.services.invoicesFor(cid)).find((i) => i.id === input.invoiceId);
    },

    async registerPushToken(_: unknown, { token, platform }: { token: string; platform: string }, ctx: Ctx) {
      const cid = auth(ctx);
      if (!['ios', 'android'].includes(platform)) throw new GraphQLError('platform must be ios or android', { extensions: { code: 'BAD_USER_INPUT' } });
      if (!/^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token)) throw new GraphQLError('not an Expo push token', { extensions: { code: 'BAD_USER_INPUT' } });
      await ctx.services.registerPushToken(cid, token, platform);
      return true;
    },
  },
};
