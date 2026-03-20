import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, VibelyText } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { PRIORITY_BY_TYPE, SUPPORT_CATEGORIES, type PrimaryType } from '@/lib/supportCategories';

function isPrimaryType(s: string | undefined): s is PrimaryType {
  return s === 'support' || s === 'feedback' || s === 'safety';
}

export default function SubmitTicketScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const params = useLocalSearchParams<{ primaryType?: string }>();

  const primaryType: PrimaryType = isPrimaryType(params.primaryType) ? params.primaryType : 'support';
  const cfg = SUPPORT_CATEGORIES[primaryType];

  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [userEmail, setUserEmail] = useState(user?.email ?? '');
  const [smartValues, setSmartValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const smartFields = cfg.smartFields ?? [];

  const canSubmit = useMemo(() => {
    return !!selectedSub && message.trim().length > 0 && !submitting;
  }, [selectedSub, message, submitting]);

  const onSubmit = async () => {
    if (!user?.id || !canSubmit || !selectedSub) return;
    setSubmitting(true);
    try {
      const diagnostics = {
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
        device_model: Device.modelName ?? Device.deviceName ?? 'unknown',
        os_version: Device.osVersion ?? '',
        app_version: Application.nativeApplicationVersion ?? '1.0.0',
      };

      const subjectLine = `${cfg.label} · ${selectedSub}`;

      const { data: ticket, error } = await supabase
        .from('support_tickets')
        .insert({
          user_id: user.id,
          primary_type: primaryType,
          subcategory: selectedSub,
          subject: subjectLine,
          message: message.trim(),
          user_email: userEmail.trim() || user.email || null,
          priority: PRIORITY_BY_TYPE[primaryType],
          platform: diagnostics.platform,
          app_version: diagnostics.app_version,
          device_model: diagnostics.device_model,
          os_version: diagnostics.os_version,
        })
        .select('id, reference_id')
        .single();

      if (error || !ticket) {
        Alert.alert('Could not submit', error?.message ?? 'Try again.');
        setSubmitting(false);
        return;
      }

      const filledSmart = Object.fromEntries(
        Object.entries(smartValues).filter(([, v]) => v && String(v).trim())
      );
      if (Object.keys(filledSmart).length > 0) {
        const body = Object.entries(filledSmart)
          .map(([k, v]) => {
            const label = k.replace(/_/g, ' ');
            return `**${label}:** ${v}`;
          })
          .join('\n');
        await supabase.from('support_ticket_replies').insert({
          ticket_id: ticket.id,
          sender_type: 'user',
          sender_id: user.id,
          message: body,
        });
      }

      router.replace({
        pathname: '/settings/ticket-submitted',
        params: {
          referenceId: ticket.reference_id,
          ticketId: ticket.id,
          primaryType,
          userEmail: userEmail.trim() || user.email || '',
        },
      });
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <VibelyText variant="titleMD" style={[styles.headerTitle, { color: theme.text }]}>
            New request
          </VibelyText>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab + 80 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {primaryType === 'safety' ? (
          <View style={[styles.warn, { borderColor: withAlpha('#F59E0B', 0.5), backgroundColor: withAlpha('#F59E0B', 0.1) }]}>
            <Ionicons name="warning-outline" size={20} color="#F59E0B" />
            <Text style={[styles.warnText, { color: theme.text }]}>
              Safety reports are reviewed by our team as a priority.{'\n'}
              If you are in immediate danger, contact local emergency services.
            </Text>
          </View>
        ) : null}

        <View style={[styles.catHeader, { borderLeftColor: cfg.color }]}>
          <View style={[styles.catIcon, { backgroundColor: withAlpha(cfg.color, 0.15) }]}>
            <Ionicons name={cfg.icon as never} size={28} color={cfg.color} />
          </View>
          <View>
            <Text style={[styles.catLabel, { color: theme.text }]}>{cfg.label}</Text>
            <Text style={[styles.catDesc, { color: theme.textSecondary }]}>{cfg.description}</Text>
          </View>
        </View>

        <Text style={[styles.fieldLabel, { color: theme.mutedForeground }]}>Subcategory</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {cfg.subcategories.map((s) => {
            const active = selectedSub === s;
            return (
              <Pressable
                key={s}
                onPress={() => setSelectedSub(s)}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? cfg.color : withAlpha(theme.border, 0.6),
                    backgroundColor: active ? withAlpha(cfg.color, 0.2) : withAlpha(theme.surface, 0.4),
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? theme.text : theme.textSecondary }]} numberOfLines={1}>
                  {s}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {smartFields.map((sf) => (
          <View key={sf.key} style={{ marginBottom: spacing.md }}>
            <Text style={[styles.fieldLabel, { color: theme.mutedForeground }]}>{sf.label}</Text>
            {sf.type === 'select' && sf.options ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {sf.options.map((opt) => {
                  const active = smartValues[sf.key] === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setSmartValues((prev) => ({ ...prev, [sf.key]: opt }))}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? cfg.color : withAlpha(theme.border, 0.6),
                          backgroundColor: active ? withAlpha(cfg.color, 0.15) : withAlpha(theme.surface, 0.4),
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: theme.text }]}>{opt}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <TextInput
                value={smartValues[sf.key] ?? ''}
                onChangeText={(t) => setSmartValues((prev) => ({ ...prev, [sf.key]: t }))}
                placeholder={sf.placeholder}
                placeholderTextColor={theme.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: withAlpha(theme.border, 0.5),
                    backgroundColor: withAlpha(theme.surface, 0.35),
                  },
                ]}
              />
            )}
          </View>
        ))}

        <Text style={[styles.fieldLabel, { color: theme.mutedForeground }]}>Tell us more</Text>
        <TextInput
          value={message}
          onChangeText={(t) => (t.length <= 2000 ? setMessage(t) : null)}
          placeholder="Describe in as much detail as possible..."
          placeholderTextColor={theme.mutedForeground}
          multiline
          textAlignVertical="top"
          style={[
            styles.textarea,
            {
              color: theme.text,
              borderColor: withAlpha(theme.border, 0.5),
              backgroundColor: withAlpha(theme.surface, 0.35),
            },
          ]}
        />
        <Text style={[styles.counter, { color: theme.mutedForeground }]}>{message.length} / 2000</Text>

        <Text style={[styles.fieldLabel, { color: theme.mutedForeground, marginTop: spacing.md }]}>
          Reply to (email)
        </Text>
        <TextInput
          value={userEmail}
          onChangeText={setUserEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
          placeholderTextColor={theme.mutedForeground}
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: withAlpha(theme.border, 0.5),
              backgroundColor: withAlpha(theme.surface, 0.35),
            },
          ]}
        />
        <Text style={[styles.hint, { color: theme.textSecondary }]}>We&apos;ll also send replies here</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, backgroundColor: theme.background }]}>
        <Pressable disabled={!canSubmit} onPress={onSubmit} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
          <LinearGradient
            colors={canSubmit ? [theme.tint, withAlpha(theme.tint, 0.85)] : [theme.muted, theme.muted]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: radius.lg, overflow: 'hidden' }}
          >
            <View style={styles.submitInner}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitLabel}>Submit request</Text>
              )}
            </View>
          </LinearGradient>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: layout.mainContentPaddingTop, paddingHorizontal: layout.containerPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backBtn: { padding: spacing.xs },
  headerTitle: { flex: 1 },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 18 },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    borderLeftWidth: 4,
    marginBottom: spacing.lg,
  },
  catIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 18, fontWeight: '800' },
  catDesc: { fontSize: 13, marginTop: 2 },
  fieldLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 280,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 140,
    fontSize: 15,
  },
  counter: { textAlign: 'right', fontSize: 12, marginTop: 4 },
  hint: { fontSize: 12, marginTop: 4 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.sm,
  },
  submitInner: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
