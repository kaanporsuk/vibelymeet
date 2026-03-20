/**
 * Privacy — profile & discovery toggles, blocked users, legal (in-app browser). Native-first; no web redirects.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { GlassHeaderBar, SettingsRow } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

const DEBOUNCE_MS = 400;

type PrivacyFields = {
  discoverable: boolean;
  show_distance: boolean;
  show_online_status: boolean;
};

const DEFAULT_PRIVACY: PrivacyFields = {
  discoverable: true,
  show_distance: true,
  show_online_status: true,
};

const PROFILE_DISCOVERY_ROWS: {
  key: keyof PrivacyFields;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
}[] = [
  {
    key: 'discoverable',
    icon: 'eye-outline',
    label: 'Show me in Discovery',
    description: 'Turn off to pause all discovery and matching',
  },
  {
    key: 'show_distance',
    icon: 'location-outline',
    label: 'Show my distance',
    description: 'Let others see approximately how far away you are',
  },
  {
    key: 'show_online_status',
    icon: 'radio-button-on',
    label: 'Show my active status',
    description: "Let matches see when you're active",
  },
];

export default function PrivacySettingsScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: row, isLoading: isProfileLoading } = useQuery({
    queryKey: ['profile-privacy', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('discoverable, show_distance, show_online_status')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as Partial<PrivacyFields> | null;
    },
    enabled: !!user?.id,
  });

  const [prefs, setPrefs] = useState<PrivacyFields>(DEFAULT_PRIVACY);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<PrivacyFields | null>(null);

  useEffect(() => {
    if (!row) return;
    setPrefs({
      discoverable: row.discoverable ?? true,
      show_distance: row.show_distance ?? true,
      show_online_status: row.show_online_status ?? true,
    });
  }, [row]);

  const flushSave = useCallback(async () => {
    if (!user?.id || !pendingSave.current) return;
    const payload = pendingSave.current;
    pendingSave.current = null;
    const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
    if (!error) {
      await qc.invalidateQueries({ queryKey: ['profile-privacy', user.id] });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
    }
  }, [user?.id, qc]);

  const scheduleSave = useCallback(
    (next: PrivacyFields) => {
      pendingSave.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        flushSave();
      }, DEBOUNCE_MS);
    },
    [flushSave]
  );

  const setField = (key: keyof PrivacyFields, value: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  };

  const openLegal = (url: string) => {
    WebBrowser.openBrowserAsync(url).catch(() => {});
  };

  const switchesDisabled = !user?.id || isProfileLoading;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Privacy</Text>
            <Text style={[styles.headerSubtitle, { color: theme.mutedForeground }]}>Discovery & visibility</Text>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={[styles.scrollInner, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: theme.mutedForeground }]}>PROFILE & DISCOVERY</Text>
        <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          {isProfileLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : (
            <>
              {PROFILE_DISCOVERY_ROWS.map((row, idx) => (
                <PrivacyToggleRow
                  key={row.key}
                  theme={theme}
                  icon={row.icon}
                  label={row.label}
                  description={row.description}
                  value={prefs[row.key]}
                  onValueChange={(v) => setField(row.key, v)}
                  disabled={switchesDisabled}
                  showDivider={idx < PROFILE_DISCOVERY_ROWS.length - 1}
                />
              ))}
            </>
          )}
        </View>

        <Text style={[styles.sectionLabel, { color: theme.mutedForeground }]}>BLOCKED USERS</Text>
        <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder, overflow: 'hidden' }]}>
          <SettingsRow
            icon={<Ionicons name="person-remove-outline" size={20} color={theme.tint} />}
            title="Blocked users"
            onPress={() => router.push('/settings/blocked-users')}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: theme.mutedForeground }]}>LEGAL</Text>
        <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder, overflow: 'hidden' }]}>
          <SettingsRow
            icon={<Ionicons name="document-text-outline" size={20} color={theme.textSecondary} />}
            title="Privacy Policy"
            onPress={() => openLegal('https://vibelymeet.com/privacy')}
          />
          <View style={[styles.settingsHairline, { backgroundColor: withAlpha(theme.border, 0.35) }]} />
          <SettingsRow
            icon={<Ionicons name="document-text-outline" size={20} color={theme.textSecondary} />}
            title="Community Guidelines"
            onPress={() => openLegal('https://vibelymeet.com/community-guidelines')}
          />
          <View style={[styles.settingsHairline, { backgroundColor: withAlpha(theme.border, 0.35) }]} />
          <SettingsRow
            icon={<Ionicons name="document-text-outline" size={20} color={theme.textSecondary} />}
            title="Terms of Service"
            onPress={() => openLegal('https://vibelymeet.com/terms')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function PrivacyToggleRow({
  theme,
  icon,
  label,
  description,
  value,
  onValueChange,
  disabled,
  showDivider,
}: {
  theme: (typeof Colors)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  showDivider?: boolean;
}) {
  return (
    <View
      style={[
        styles.toggleRow,
        showDivider && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: withAlpha(theme.border, 0.35),
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.mutedForeground} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.toggleLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.toggleDesc, { color: theme.mutedForeground }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.muted, true: theme.tint }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  scrollInner: {
    padding: 16,
    gap: 20,
    paddingTop: layout.mainContentPaddingTop,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingLeft: 4,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsHairline: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  toggleLabel: { fontSize: 15, fontWeight: '500' },
  toggleDesc: { fontSize: 12, marginTop: 1 },
});
