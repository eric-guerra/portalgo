import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import { DISPUTE, INVOICE } from '../lib/operations';

export function InvoiceScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, loading } = useQuery(INVOICE, { variables: { id } });
  const [reason, setReason] = useState('');
  const [dispute, d] = useMutation(DISPUTE);
  if (loading && !data) return <Text style={s.p}>Loading…</Text>;
  const inv = data?.invoice;
  if (!inv) return <Text style={s.p}>Invoice not found.</Text>;

  return (
    <ScrollView contentContainerStyle={s.p}>
      <Pressable onPress={onBack}><Text style={s.link}>‹ Invoices</Text></Pressable>
      <Text style={s.title}>{inv.number}</Text>
      <Text>Issued {inv.issuedOn} · due {inv.dueOn}</Text>
      <Text style={s.big}>{inv.balance.formatted}</Text>
      <Text style={s.muted}>of {inv.total.formatted} · {inv.status.replace('_', ' ').toLowerCase()}</Text>
      {inv.order && (
        <View style={s.card}>
          <Text style={s.h}>Order {inv.order.number}</Text>
          <Text>{inv.order.status.toLowerCase()}</Text>
          {inv.order.trackingUrl && <Pressable onPress={() => Linking.openURL(inv.order.trackingUrl)}><Text style={s.link}>Track shipment</Text></Pressable>}
        </View>
      )}
      {inv.status !== 'DISPUTED' && inv.status !== 'PAID' && (
        <View style={s.card}>
          <Text style={s.h}>Something wrong with this invoice?</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="Describe the problem" multiline style={s.input} maxLength={2000} />
          <Pressable disabled={reason.trim().length < 10 || d.loading} onPress={() => dispute({ variables: { input: { invoiceId: id, reason } } })}>
            <Text style={[s.link, reason.trim().length < 10 && { opacity: 0.4 }]}>{d.loading ? 'Sending…' : 'Open a dispute'}</Text>
          </Pressable>
          {d.error && <Text style={{ color: '#c62828' }}>{d.error.message}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  p: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  big: { fontSize: 34, fontWeight: '700', marginTop: 12 },
  muted: { color: '#6b7280' },
  card: { marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: '#fff', gap: 6 },
  h: { fontWeight: '600' },
  link: { color: '#1f5fbf', fontWeight: '600', paddingVertical: 4 },
  input: { borderWidth: 1, borderColor: '#cfd4dc', borderRadius: 6, padding: 8, minHeight: 80 },
});
