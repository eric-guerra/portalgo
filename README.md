# PortalGo

Portfolio reference implementation of a 2024 project, built to show the mobile companion to the B2B invoice portal. Buyers at customer accounts check balances, pay several invoices at once, track the order behind an invoice, and dispute problems from their phone.

**Stack:** React Native 0.73 + Expo SDK 50, TypeScript, Apollo Client 3 (persisted cache), GraphQL BFF on Apollo Server 4 with DataLoader, Expo Notifications, expo-secure-store.

## Layout
```
app/   Expo app: Home (balance, overdue, infinite invoice list, multi-select pay), Invoice (order tracking, dispute)
bff/   GraphQL backend-for-frontend aggregating the invoice, payment and order services
```

## BFF (`bff/`)
- **One round trip per screen.** The home screen gets the account summary plus the first page of invoices in a single query.
- **Pagination:** Relay-style, with opaque cursors that sort oldest-due first, plus the total balance.
- **No N+1:** `Invoice.order` goes through a per-request DataLoader, so twenty invoices mean one orders call. A test asserts it.
- **Customer isolation:** the customer comes from the gateway-verified identity. Another customer's invoice id returns `null`, and pay or dispute returns `NOT_FOUND`.
- **Mutations validate before calling downstream:** the amount can't exceed the selected balance, an idempotency key is required, a dispute needs a reason, and push tokens must be Expo push tokens.
- **Hardening:** a query depth limit; no stack traces in errors; introspection off in production.

## App (`app/`)
- **Apollo cache:** `relayStylePagination` merges pages per status filter. The cache is persisted to AsyncStorage, so the last-seen invoices render instantly on cold start and offline. Queries use cache-and-network.
- **Token storage:** the access token is kept in the Keychain/Keystore (`expo-secure-store`), never AsyncStorage. An `UNAUTHENTICATED` error routes to sign-in.
- **Paying:**
  - Long-press selects invoices, and "select all overdue" is one tap.
  - The pay bar shows the running total.
  - The idempotency key is derived from the selection, the amount and a per-session nonce, so a retried tap can't charge twice.
- **Push notifications:** the token is registered with the BFF, and tapping a notification deep-links to the invoice.
- `src/lib/selection.ts` holds the pure logic (selection, totals, idempotency key, optimistic oldest-first allocation) with no React Native imports, so it's unit-tested.

## Test
```bash
cd bff && npm install && npm test && npm run typecheck   # 7 tests via executeOperation: home query, pagination, DataLoader batching, isolation, mutations
cd app && npm test                                       # 4 tests (node --experimental-strip-types)
cd app && npx expo start                                 # run on a device or simulator
```
The app's GraphQL operations are also validated against the BFF schema with `graphql.validate`, and all 5 pass.
