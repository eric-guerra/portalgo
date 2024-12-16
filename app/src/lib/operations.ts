import { gql } from '@apollo/client';

export const INVOICE_FIELDS = gql`
  fragment InvoiceFields on Invoice {
    id
    number
    dueOn
    status
    daysOverdue
    balance { cents formatted }
    total { cents formatted }
  }
`;

export const HOME = gql`
  ${INVOICE_FIELDS}
  query Home($after: String, $status: InvoiceStatus) {
    me { customerId name openBalance { formatted } overdueCount }
    invoices(first: 20, after: $after, status: $status) {
      totalBalance { formatted }
      edges { cursor node { ...InvoiceFields } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const INVOICE = gql`
  ${INVOICE_FIELDS}
  query Invoice($id: ID!) {
    invoice(id: $id) { ...InvoiceFields issuedOn order { number status trackingUrl } }
  }
`;

export const PAY = gql`
  ${INVOICE_FIELDS}
  mutation Pay($input: PayInvoicesInput!) {
    payInvoices(input: $input) { paymentId status invoices { ...InvoiceFields } }
  }
`;

export const DISPUTE = gql`
  ${INVOICE_FIELDS}
  mutation Dispute($input: DisputeInput!) { disputeInvoice(input: $input) { ...InvoiceFields } }
`;

export const REGISTER_PUSH = gql`
  mutation RegisterPush($token: String!, $platform: String!) { registerPushToken(token: $token, platform: $platform) }
`;
