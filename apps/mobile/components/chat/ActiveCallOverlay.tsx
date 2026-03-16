/**
 * Active call overlay: ringing (caller waiting), voice call (photo + duration + controls), video call (remote + PIP + controls).
 * Reference: src/components/chat/ActiveCallOverlay.tsx
 */
import React from 'react';
import { View, Text, Modal, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Daily, { DailyMediaView } from '@daily-co/react-native-daily-js';
import type { DailyParticipant } from '@daily-co/react-native-daily-js';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { VibelyText } from '@/components/ui';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

type ActiveCallOverlayProps = {
  visible: boolean;
  isRinging: boolean;
  isInCall: boolean;
  callType: 'voice' | 'video';
  isMuted: boolean;
  isVideoOff: boolean;
  callDuration: number;
  partnerName: string;
  partnerAvatarUri?: string | null;
  localParticipant: DailyParticipant | null;
  remoteParticipant: DailyParticipant | null;
  getTrack: (p: DailyParticipant | undefined, kind: 'video' | 'audio') => import('@daily-co/react-native-webrtc').MediaStreamTrack | null;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
};

export function ActiveCallOverlay({
  visible,
  isRinging,
  isInCall,
  callType,
  isMuted,
  isVideoOff,
  callDuration,
  partnerName,
  partnerAvatarUri,
  localParticipant,
  remoteParticipant,
  getTrack,
  onToggleMute,
  onToggleVideo,
  onEndCall,
}: ActiveCallOverlayProps) {
  const theme = Colors[useColorScheme()];

  if (!visible) return null;

  // Ringing state (caller waiting for answer)
  if (isRinging && !isInCall) {
    return (
      <Modal transparent visible animationType="fade">
        <View style={[styles.backdrop, { backgroundColor: theme.background }]}>
          <View style={[styles.avatarWrap, { backgroundColor: theme.surfaceSubtle }]}>
            {partnerAvatarUri ? (
              <Image source={{ uri: partnerAvatarUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <VibelyText variant="titleLG" style={[styles.avatarLetter, { color: theme.textSecondary }]}>{partnerName?.[0] ?? '?'}</VibelyText>
            )}
          </View>
          <VibelyText variant="titleMD" style={{ color: theme.text }}>Calling {partnerName}...</VibelyText>
          <VibelyText variant="body" style={{ color: theme.textSecondary }}>{callType === 'video' ? 'Video call' : 'Voice call'}</VibelyText>
          <Pressable onPress={onEndCall} style={[styles.endBtn, { backgroundColor: theme.danger }]}>
            <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        </View>
      </Modal>
    );
  }

  // Voice call (active)
  if (callType === 'voice') {
    return (
      <Modal transparent visible animationType="fade">
        <View style={[styles.backdrop, { backgroundColor: theme.background }]}>
          <View style={[styles.avatarWrap, { backgroundColor: theme.surfaceSubtle }]}>
            {partnerAvatarUri ? (
              <Image source={{ uri: partnerAvatarUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <VibelyText variant="titleLG" style={[styles.avatarLetter, { color: theme.textSecondary }]}>{partnerName?.[0] ?? '?'}</VibelyText>
            )}
          </View>
          <VibelyText variant="titleMD" style={{ color: theme.text }}>{partnerName}</VibelyText>
          <VibelyText variant="body" style={[styles.duration, { color: theme.textSecondary }]}>{formatDuration(callDuration)}</VibelyText>
          <View style={styles.controlsRow}>
            <Pressable onPress={onToggleMute} style={[styles.controlBtn, { backgroundColor: isMuted ? withAlpha(theme.danger, 0.19) : theme.surfaceSubtle }]}>
              <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={24} color={theme.text} />
            </Pressable>
            <Pressable onPress={onEndCall} style={[styles.endBtn, { backgroundColor: theme.danger }]}>
              <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // Video call (active)
  return (
    <Modal transparent visible animationType="fade">
      <View style={styles.videoBackdrop}>
        {/* Remote video */}
        <View style={StyleSheet.absoluteFill}>
          {remoteParticipant ? (
            <DailyMediaView
              videoTrack={getTrack(remoteParticipant, 'video')}
              audioTrack={getTrack(remoteParticipant, 'audio')}
              mirror={false}
              zOrder={0}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholderRemote, { backgroundColor: theme.muted }]}>
              <VibelyText variant="body" style={{ color: theme.textSecondary }}>{partnerName} will appear here</VibelyText>
            </View>
          )}
        </View>

        {/* Duration pill */}
        <View style={[styles.durationPill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Text style={styles.durationPillText}>{formatDuration(callDuration)}</Text>
        </View>

        {/* Local PIP */}
        <View style={[styles.pip, { borderColor: theme.tint }]}>
          {localParticipant ? (
            <DailyMediaView
              videoTrack={getTrack(localParticipant, 'video')}
              audioTrack={null}
              mirror
              zOrder={1}
              style={styles.pipVideo}
            />
          ) : (
            <View style={[styles.pipVideo, styles.pipPlaceholder, { backgroundColor: theme.surface }]}>
              <Text style={[styles.pipPlaceholderText, { color: theme.textSecondary }]}>You</Text>
            </View>
          )}
          {isMuted && (
            <View style={[styles.muteBadge, { backgroundColor: theme.danger }]}>
              <Ionicons name="mic-off" size={12} color="#fff" />
            </View>
          )}
        </View>

        {/* Controls */}
        <View style={styles.controlsBar}>
          <Pressable onPress={onToggleMute} style={[styles.controlCircle, isMuted && styles.controlCircleMuted]}>
            <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={24} color="#fff" />
          </Pressable>
          <Pressable onPress={onToggleVideo} style={[styles.controlCircle, isVideoOff && styles.controlCircleMuted]}>
            <Ionicons name={isVideoOff ? 'videocam-off' : 'videocam'} size={24} color="#fff" />
          </Pressable>
          <Pressable onPress={onEndCall} style={[styles.endBtnLarge, { backgroundColor: theme.danger }]}>
            <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  avatarWrap: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  avatarLetter: { fontSize: 36 },
  duration: { marginBottom: spacing.xl },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  controlBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  endBtn: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: spacing.xl },
  videoBackdrop: { flex: 1, backgroundColor: '#000' },
  placeholderRemote: { justifyContent: 'center', alignItems: 'center' },
  durationPill: { position: 'absolute', top: 50, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, zIndex: 10 },
  durationPillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pip: { position: 'absolute', bottom: 100, right: spacing.lg, width: 100, height: 140, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 2, zIndex: 10 },
  pipVideo: { width: '100%', height: '100%' },
  pipPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  pipPlaceholderText: { fontSize: 12 },
  muteBadge: { position: 'absolute', bottom: 4, right: 4, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  controlsBar: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.lg, zIndex: 10 },
  controlCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  controlCircleMuted: { backgroundColor: 'rgba(239,68,68,0.8)' },
  endBtnLarge: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
});