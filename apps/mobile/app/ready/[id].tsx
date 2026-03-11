import { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useReadyGate } from '@/lib/readyGateApi';
import { avatarUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';

const GATE_TIMEOUT_SEC = 30;

export default function ReadyGateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const {
    status,
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    snoozeExpiresAt,
    markReady,
    forfeit,
    snooze,
    isBothReady,
    isForfeited,
    isSnoozed,
    refetch,
  } = useReadyGate(sessionId ?? null, user?.id ?? null);

  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [snoozeTimeLeft, setSnoozeTimeLeft] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    const load = async () => {
      const { data: session } = await supabase
        .from('video_sessions')
        .select('participant_1_id, participant_2_id, event_id')
        .eq('id', sessionId)
        .maybeSingle();
      if (!session) return;
      if (session.event_id) setEventId(session.event_id);
      const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
      const { data: profile } = await supabase.from('profiles').select('avatar_url, photos').eq('id', partnerId).maybeSingle();
      if (profile) {
        const photo = (profile.photos as string[])?.[0] ?? profile.avatar_url ?? null;
        setPartnerAvatar(photo);
      }
    };
    load();
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (isBothReady) {
      setTransitioning(true);
      setTimeout(() => router.replace(`/date/${sessionId}`), 1500);
    }
  }, [isBothReady, sessionId]);

  useEffect(() => {
    if (isForfeited) {
      if (eventId) router.replace(`/event/${eventId}/lobby`);
      else router.replace('/(tabs)');
    }
  }, [isForfeited, eventId]);

  useEffect(() => {
    if (transitioning || iAmReady) return;
    if (isSnoozed && snoozeExpiresAt) {
      const remaining = Math.max(0, Math.floor((new Date(snoozeExpiresAt).getTime() - Date.now()) / 1000));
      setSnoozeTimeLeft(remaining);
      return;
    }
    const t = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          forfeit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [transitioning, iAmReady, isSnoozed, snoozeExpiresAt, forfeit]);

  useEffect(() => {
    if (!isSnoozed) return;
    const t = setInterval(() => {
      setSnoozeTimeLeft((prev) => {
        if (prev <= 1) {
          forfeit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isSnoozed, forfeit]);

  const handleSkip = () => {
    Alert.alert('Step away?', 'You’ll go back to the lobby.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Step away', style: 'destructive', onPress: () => forfeit() },
    ]);
  };

  if (!sessionId || !user?.id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Invalid session</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ready for your date?</Text>
      <Text style={styles.subtitle}>{partnerName ?? 'Your match'}</Text>

      {partnerAvatar ? (
        <Image source={{ uri: avatarUrl(partnerAvatar) }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder} />
      )}

      {transitioning ? (
        <Text style={styles.status}>Connecting...</Text>
      ) : isSnoozed ? (
        <Text style={styles.status}>Partner stepped away. Back in {snoozeTimeLeft}s</Text>
      ) : (
        <>
          <Text style={styles.status}>
            {iAmReady && partnerReady ? "Both ready! Starting date..." : iAmReady ? "Waiting for partner..." : partnerReady ? "Partner is ready — tap when you're ready" : `Time to join: ${timeLeft}s`}
          </Text>
          {!iAmReady && (
            <Pressable style={styles.primaryBtn} onPress={() => markReady()}>
              <Text style={styles.primaryBtnText}>I'm ready</Text>
            </Pressable>
          )}
          <Pressable style={styles.secondaryBtn} onPress={() => snooze()}>
            <Text style={styles.secondaryBtnText}>Snooze (2 min)</Text>
          </Pressable>
          <Pressable style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Step away</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 16, opacity: 0.9, marginBottom: 24 },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#eee', marginBottom: 24 },
  avatarPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#eee', marginBottom: 24 },
  status: { fontSize: 16, textAlign: 'center', marginBottom: 24 },
  error: { color: '#dc2626' },
  primaryBtn: { backgroundColor: '#2f95dc', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, marginBottom: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 24, marginBottom: 8 },
  secondaryBtnText: { color: '#2f95dc', fontSize: 15 },
  skipBtn: { paddingVertical: 12 },
  skipBtnText: { color: '#6b7280', fontSize: 14 },
});
