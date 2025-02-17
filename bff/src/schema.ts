// Backend-for-frontend GraphQL schema for the PortalGo mobile app. It aggregates the invoice,
// payment and order services into exactly what the screens need, so the phone makes one round trip.

export const typeDefs = /* GraphQL */ `
  scalar DateTime

  enum InvoiceStatus { OPEN PARTIALLY_PAID PAID DISPUTED }
  enum OrderStatus { PLACED SHIPPED DELIVERED CANCELLED }

  type Money { cents: Int!, currency: String!, formatted: String! }

  type Invoice {
    id: ID!
    number: String!
    issuedOn: String!
    dueOn: String!
    total: Money!
    balance: Money!
    status: InvoiceStatus!
    daysOverdue: Int!
    order: Order
  }

  type Order {
    id: ID!
    number: String!
    status: OrderStatus!
    placedAt: DateTime!
    trackingUrl: String
  }

  type InvoiceEdge { cursor: String!, node: Invoice! }
  type PageInfo { endCursor: String, hasNextPage: Boolean! }
  type InvoiceConnection { edges: [InvoiceEdge!]!, pageInfo: PageInfo!, totalBalance: Money! }

  type Account { customerId: ID!, name: String!, openBalance: Money!, overdueCount: Int! }

  type Query {
    me: Account!
    invoices(first: Int = 20, after: String, status: InvoiceStatus): InvoiceConnection!
    invoice(id: ID!): Invoice
  }

  input PayInvoicesInput { invoiceIds: [ID!]!, amountCents: Int!, paymentMethodId: ID!, idempotencyKey: String! }
  type PaymentResult { paymentId: ID!, status: String!, invoices: [Invoice!]! }

  input DisputeInput { invoiceId: ID!, reason: String! }

  type Mutation {
    payInvoices(input: PayInvoicesInput!): PaymentResult!
    disputeInvoice(input: DisputeInput!): Invoice!
    registerPushToken(token: String!, platform: String!): Boolean!
  }
`;
