import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import * as Haptics from 'expo-haptics';
import { HOME, PAY } from '../lib/operations';
import { idempotencyKey, overdueIds, selectedTotal, toggle } from '../lib/selection';

type Props = { onOpen: (id: string) => void; paymentMethodId: string };

export function HomeScreen({ onOpen, paymentMethodId }: Props) {
  const { data, loading, error, refetch, fetchMore, networkStatus } = useQuery(HOME, { notifyOnNetworkStatusChange: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nonce] = useState(() => Math.random().toString(36).slice(2, 10));
  const [pay, payState] = useMutation(PAY);

  const invoices = useMemo(() => (data?.invoices.edges ?? []).map((e: any) => ({ ...e.node, balanceCents: e.node.balance.cents })), [data]);
  const today = new Date().toISOString().slice(0, 10);
  const total = selectedTotal(invoices, selected);

  if (loading && !data) return <ActivityIndicator style={{ flex: 1 }} />;
  if (error && !data) return <Text style={s.error}>Couldn't load invoices. Pull to retry.</Text>;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Text style={s.name}>{data.me.name}</Text>
        <Text style={s.balance}>{data.me.openBalance.formatted}</Text>
        <Text style={s.sub}>{data.me.overdueCount} overdue</Text>
        <Pressable onPress={() => setSelected(overdueIds(invoices, today))} accessibilityRole="button">
          <Text style={s.link}>Select all overdue</Text>
        </Pressable>
      </View>
      <FlatList
        data={invoices}
        keyExtractor={(i: any) => i.id}
        refreshControl={<RefreshControl refreshing={networkStatus === 4} onRefresh={() => refetch()} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => data.invoices.pageInfo.hasNextPage && fetchMore({ variables: { after: data.invoices.pageInfo.endCursor } })}
        renderItem={({ item }: any) => (
          <Pressable style={[s.row, selected.has(item.id) && s.rowSelected]} onPress={() => onOpen(item.id)}
            onLongPress={() => { Haptics.selectionAsync(); setSelected(toggle(selected, item.id)); }}
            accessibilityHint="Long press to select for payment">
            <View style={{ flex: 1 }}>
              <Text style={s.number}>{item.number}</Text>
              <Text style={[s.sub, item.daysOverdue > 0 && s.overdue]}>
                {item.daysOverdue > 0 ? `${item.daysOverdue} days overdue` : `Due ${item.dueOn}`}
              </Text>
            </View>
            <Text style={s.amount}>{item.balance.formatted}</Text>
          </Pressable>
        )}
      />
      {selected.size > 0 && (
        <Pressable style={s.payBar} disabled={payState.loading}
          onPress={async () => {
            await pay({ variables: { input: { invoiceIds: [...selected], amountCents: total, paymentMethodId, idempotencyKey: idempotencyKey(selected, total, nonce) } } });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setSelected(new Set());
            refetch();
          }}>
          <Text style={s.payText}>{payState.loading ? 'Paying…' : `Pay ${selected.size} invoice(s) · $${(total / 100).toFixed(2)}`}</Text>
        </Pressable>
      )}
      {payState.error && <Text style={s.error}>{payState.error.message}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  header: { padding: 16, backgroundColor: '#1f5fbf' },
  name: { color: '#d9e6ff', fontSize: 14 },
  balance: { color: '#fff', fontSize: 32, fontWeight: '700' },
  sub: { color: '#6b7280', fontSize: 13 },
  link: { color: '#fff', marginTop: 8, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#cfd4dc', backgroundColor: '#fff' },
  rowSelected: { backgroundColor: '#eef4ff' },
  number: { fontSize: 16, fontWeight: '600' },
  overdue: { color: '#c62828' },
  amount: { fontSize: 16, fontVariant: ['tabular-nums'] },
  payBar: { backgroundColor: '#1f5fbf', padding: 18, alignItems: 'center' },
  payText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#c62828', padding: 16 },
});
