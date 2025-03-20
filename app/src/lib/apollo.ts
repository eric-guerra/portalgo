import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { relayStylePagination } from '@apollo/client/utilities';
import { persistCache, AsyncStorageWrapper } from 'apollo3-cache-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const uri = (Constants.expoConfig?.extra?.graphqlUrl as string) ?? 'http://localhost:4000/graphql';

export const cache = new InMemoryCache({
  typePolicies: {
    // Merges pages of the invoices connection; separate lists per status filter.
    Query: { fields: { invoices: relayStylePagination(['status']) } },
    Money: { keyFields: false },
  },
});

// Access token lives in the iOS Keychain / Android Keystore, never AsyncStorage.
const auth = setContext(async (_, { headers }) => {
  const token = await SecureStore.getItemAsync('accessToken');
  return { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } };
});

let onUnauthenticated: () => void = () => {};
export const setUnauthenticatedHandler = (fn: () => void) => { onUnauthenticated = fn; };

const errors = onError(({ graphQLErrors }) => {
  if (graphQLErrors?.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) onUnauthenticated();
});

export async function createClient() {
  // Last-seen invoices render instantly on cold start and while offline (store floors have bad signal).
  await persistCache({ cache, storage: new AsyncStorageWrapper(AsyncStorage), maxSize: 2_000_000 });
  return new ApolloClient({
    link: from([errors, auth, new HttpLink({ uri })]),
    cache,
    defaultOptions: { watchQuery: { fetchPolicy: 'cache-and-network', nextFetchPolicy: 'cache-first' } },
  });
}
