import { ApolloServer } from '@apollo/server';
import depthLimit from 'graphql-depth-limit';
import { typeDefs } from './schema.js';
import { Ctx, makeLoaders, resolvers, Services } from './resolvers.js';

export function createServer() {
  return new ApolloServer<Ctx>({
    typeDefs,
    resolvers,
    // Mobile clients only send persisted, known-shape queries; still cap depth against abuse.
    validationRules: [depthLimit(6)],
    introspection: process.env.NODE_ENV !== 'production',
    includeStacktraceInErrorResponses: false,
  });
}

export function contextFor(customerId: string | null, services: Services, today = new Date().toISOString().slice(0, 10)): Ctx {
  return { customerId, services, today, loaders: makeLoaders(services) }; // fresh loaders per request: no cross-user cache
}
