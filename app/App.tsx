import { useEffect, useState } from 'react';
import { Platform, SafeAreaView, Text } from 'react-native';
import { ApolloClient, ApolloProvider, NormalizedCacheObject } from '@apollo/client';
import * as Notifications from 'expo-notifications';
import { createClient, setUnauthenticatedHandler } from './src/lib/apollo';
import { REGISTER_PUSH } from './src/lib/operations';
import { HomeScreen } from './src/screens/HomeScreen';
import { InvoiceScreen } from './src/screens/InvoiceScreen';

async function registerPush(client: ApolloClient<NormalizedCacheObject>) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const token = (await Notifications.getExpoPushTokenAsync()).data; // "payment due tomorrow" / "invoice issued"
  await client.mutate({ mutation: REGISTER_PUSH, variables: { token, platform: Platform.OS } });
}

export default function App() {
  const [client, setClient] = useState<ApolloClient<NormalizedCacheObject> | null>(null);
  const [route, setRoute] = useState<{ name: 'home' } | { name: 'invoice'; id: string }>({ name: 'home' });

  useEffect(() => {
    setUnauthenticatedHandler(() => { /* navigate to the OIDC sign-in screen (expo-auth-session) */ });
    createClient().then((c) => { setClient(c); registerPush(c).catch(() => undefined); });
    // Tapping a notification deep-links to the invoice.
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const id = r.notification.request.content.data?.invoiceId as string | undefined;
      if (id) setRoute({ name: 'invoice', id });
    });
    return () => sub.remove();
  }, []);

  if (!client) return <SafeAreaView><Text>Loading…</Text></SafeAreaView>;
  return (
    <ApolloProvider client={client}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7f9' }}>
        {route.name === 'home'
          ? <HomeScreen paymentMethodId="pm_default" onOpen={(id) => setRoute({ name: 'invoice', id })} />
          : <InvoiceScreen id={route.id} onBack={() => setRoute({ name: 'home' })} />}
      </SafeAreaView>
    </ApolloProvider>
  );
}
