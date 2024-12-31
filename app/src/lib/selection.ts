// Pure logic behind the "pay invoices" screen, kept free of React Native imports so it's unit-testable.

export interface PayableInvoice { id: string; dueOn: string; balanceCents: number; status: string }

export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** "Select all overdue": the most common action on the screen. */
export function overdueIds(invoices: PayableInvoice[], today: string): Set<string> {
  return new Set(invoices.filter((i) => i.status !== 'PAID' && i.status !== 'DISPUTED' && i.dueOn < today && i.balanceCents > 0).map((i) => i.id));
}

export function selectedTotal(invoices: PayableInvoice[], selected: ReadonlySet<string>): number {
  return invoices.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.balanceCents, 0);
}

/** One key per payment *intent*: retries of the same tap reuse it; a new selection gets a new one. */
export function idempotencyKey(selected: ReadonlySet<string>, amountCents: number, nonce: string): string {
  const base = [...selected].sort().join('.') + ':' + amountCents + ':' + nonce;
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) h = Math.imul(h ^ base.charCodeAt(i), 16777619) >>> 0;
  return `m_${h.toString(36)}_${nonce}`.slice(0, 64);
}

/** Optimistic list update after paying: balances shrink oldest-first, mirroring the server's allocation. */
export function applyPaymentOptimistically<T extends PayableInvoice>(invoices: T[], selected: ReadonlySet<string>, amountCents: number): T[] {
  let left = amountCents;
  const order = invoices.filter((i) => selected.has(i.id)).sort((a, b) => a.dueOn.localeCompare(b.dueOn)).map((i) => i.id);
  const paid = new Map<string, number>();
  for (const id of order) {
    const inv = invoices.find((i) => i.id === id)!;
    const take = Math.min(left, inv.balanceCents);
    paid.set(id, take);
    left -= take;
  }
  return invoices.map((i) => {
    const p = paid.get(i.id);
    if (!p) return i;
    const balanceCents = i.balanceCents - p;
    return { ...i, balanceCents, status: balanceCents === 0 ? 'PAID' : 'PARTIALLY_PAID' };
  });
}
