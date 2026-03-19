import { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ListRenderItem,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  Vibration,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, LoadingState, ErrorState } from '@/components/ui';
import { spacing, radius, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useMessages,
  useSendMessage,
  useSendVoiceMessage,
  useSendChatVideoMessage,
  useRealtimeMessages,
  markMatchMessagesRead,
  useTypingBroadcast,
  useMatches,
  type ChatMessage,
  type ReactionEmoji,
} from '@/lib/chatApi';
import { useUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { useArchiveMatch } from '@/lib/useArchiveMatch';
import { useMuteMatch } from '@/lib/useMuteMatch';
import { MatchActionsSheet } from '@/components/match/MatchActionsSheet';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';
import { ProfileDetailSheet } from '@/components/match/ProfileDetailSheet';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageStatus } from '@/components/chat/MessageStatus';
import { ReactionPicker } from '@/components/chat/ReactionPicker';
import { DateSuggestionSheet } from '@/components/chat/DateSuggestionSheet';
import { IncomingCallOverlay } from '@/components/chat/IncomingCallOverlay';
import { ActiveCallOverlay } from '@/components/chat/ActiveCallOverlay';
import {
  useCreateDateProposal,
  useChatDateProposals,
  useRespondToDateProposal,
  getTimeBlockLabel,
  type TimeBlock,
} from '@/lib/dateProposalsApi';
import { useMatchCall } from '@/lib/useMatchCall';
import { useIsOffline } from '@/lib/useNetworkStatus';
import { avatarUrl } from '@/lib/imageUrl';
import { Linking } from 'react-native';

function VoiceMessageBubble({
  uri,
  duration,
  textColor,
  timeColor,
  time,
}: {
  uri: string;
  duration?: number | null;
  textColor: string;
  timeColor: string;
  time: string;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const onPress = () => {
    if (playing) player.pause();
    else player.play();
  };
  return (
    <View>
      <Pressable onPress={onPress} style={styles.voiceRow}>
        <Ionicons name={playing ? 'pause' : 'play'} size={24} color={textColor} />
        <Text style={[styles.voiceLabel, { color: textColor }]}>
          Voice {duration != null ? `· ${duration}s` : ''}
        </Text>
      </Pressable>
      <Text style={[styles.bubbleTime, { color: timeColor }]}>{time}</Text>
    </View>
  );
}

function ChatVideoPlayer({ uri, style }: { uri: string; style?: object }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView style={style} player={player} nativeControls contentFit="contain" />;
}

export default function ChatThreadScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useMessages(otherUserId ?? undefined, user?.id ?? null);
  const { data: matches = [] } = useMatches(user?.id);
  const { mutateAsync: sendMessage, isPending: sending } = useSendMessage();
  const { mutateAsync: sendVoiceMessage, isPending: sendingVoice } = useSendVoiceMessage();
  const { mutateAsync: sendChatVideoMessage, isPending: sendingVideo } = useSendChatVideoMessage();
  useRealtimeMessages(data?.matchId ?? null, !!data?.matchId);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { partnerTyping } = useTypingBroadcast(
    data?.matchId ?? null,
    user?.id ?? null,
    isTyping,
    !!data?.matchId && !!user?.id
  );
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [localReactions, setLocalReactions] = useState<Record<string, ReactionEmoji>>({});
  const [showDateSheet, setShowDateSheet] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const isSending = sending || sendingVoice || sendingVideo;
  const { mutateAsync: createDateProposal } = useCreateDateProposal();
  const { data: chatDateProposals = [] } = useChatDateProposals(data?.matchId ?? null, user?.id, !!data?.matchId && !!user?.id);
  const { mutateAsync: respondToProposal, isPending: respondingProposal } = useRespondToDateProposal();
  const pendingDateProposalsForMe = chatDateProposals.filter(
    (p) => p.recipient_id === user?.id && p.status === 'pending'
  );

  useEffect(() => {
    const mid = data?.matchId;
    if (!mid) return;
    const t = setTimeout(() => {
      markMatchMessagesRead(mid)
        .then(() => refetch())
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [data?.matchId, data?.messages?.length, refetch]);

  const {
    isRinging,
    isInCall,
    callType,
    callDuration,
    incomingCall,
    isMuted,
    isVideoOff,
    localParticipant,
    remoteParticipant,
    getTrack,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useMatchCall({
    matchId: data?.matchId ?? null,
    currentUserId: user?.id ?? null,
  });

  const isOffline = useIsOffline();

  const handleInputChange = useCallback((text: string) => {
    setInput(text);
    setIsTyping(!!text.trim());
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000);
  }, []);
  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }, []);

  const otherName = otherUserId ? (matches.find((m) => m.id === otherUserId)?.name ?? 'Chat') : 'Chat';
  const [showActions, setShowActions] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { mutateAsync: unmatch } = useUnmatch();
  const { blockUser } = useBlockUser(user?.id);
  const { archiveMatch, unarchiveMatch } = useArchiveMatch(user?.id);
  const { muteMatch, unmuteMatch, isMatchMuted } = useMuteMatch(user?.id);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const currentMatchRow = data?.matchId ? matches.find((m) => m.matchId === data.matchId) : null;
  const matchForActions =
    data?.matchId && otherUserId
      ? { matchId: data.matchId, id: otherUserId, name: otherName, archived_at: currentMatchRow?.archived_at ?? null }
      : null;

  useEffect(() => {
    if (data?.messages?.length) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [data?.messages?.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !data?.matchId || isSending) return;
    if (isOffline) {
      Alert.alert("Can't send", 'Check your connection.');
      return;
    }
    setInput('');
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    try {
      await sendMessage({ matchId: data.matchId, content: text });
    } catch {
      Alert.alert('Error', 'Could not send message');
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) throw new Error('Permission denied');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecording(true);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Could not start recording');
      Alert.alert('Recording', 'Microphone access is needed for voice messages.');
    }
  };

  const stopVoiceRecordingAndSend = async () => {
    if (!data?.matchId || !user?.id) {
      setRecording(false);
      return;
    }
    if (isOffline) {
      setRecording(false);
      Alert.alert("Can't send", 'Check your connection.');
      return;
    }
    setRecording(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('No recording file');
      const durationSec = audioRecorder.currentTime || 1;
      await sendVoiceMessage({
        matchId: data.matchId,
        audioUri: uri,
        durationSeconds: durationSec,
        currentUserId: user.id,
      });
    } catch (e) {
      Alert.alert('Voice message failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleVoicePress = () => {
    if (recording) {
      void stopVoiceRecordingAndSend();
    } else {
      void startVoiceRecording();
    }
  };

  const handleVideoPick = async () => {
    if (!data?.matchId || !user?.id || isSending) return;
    setVideoError(null);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your media library to send a video.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const durationSec = asset.duration ?? 0;
      await sendChatVideoMessage({
        matchId: data.matchId,
        videoUri: asset.uri,
        durationSeconds: durationSec > 0 ? Math.round(durationSec) : 1,
        currentUserId: user.id,
        mimeType: asset.mimeType ?? undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Video send failed';
      setVideoError(msg);
      Alert.alert('Video failed', msg);
    }
  };

  if (!otherUserId || !user?.id) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Invalid chat"
          message="This conversation could not be loaded."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  if (isLoading && !data) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading conversation…" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Could not load conversation"
          message="Check your connection and try again."
          actionLabel="Retry"
          onActionPress={() => refetch()}
        />
      </View>
    );
  }

  if (!data.matchId) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="No conversation found"
          message="This match may have been removed."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  const otherUser = data?.otherUser ?? null;
  const otherAvatarUri = otherUser
    ? (otherUser.photos?.[0] ?? otherUser.avatar_url) ? avatarUrl(otherUser.photos?.[0] ?? otherUser.avatar_url ?? null) : null
    : otherUserId
      ? (matches.find((m) => m.id === otherUserId)?.image ?? null)
      : null;
  const lastSeenAt = otherUser?.last_seen_at ? new Date(otherUser.last_seen_at).getTime() : null;
  const now = Date.now();
  const diffMinutes = lastSeenAt != null ? (now - lastSeenAt) / 60000 : Infinity;
  const isOnline = diffMinutes <= 5;
  const lastSeenText =
    isOnline ? undefined
      : diffMinutes <= 60 ? 'Recently active'
      : lastSeenAt != null ? `Active ${Math.round(diffMinutes / 60)}h ago`
      : undefined;

  const renderBubbleContent = (item: ChatMessage, textColor: string, timeColor: string, isMe: boolean) => {
    const reaction = localReactions[item.id] ?? item.reaction ?? null;
    const statusOrTime = isMe ? (
      <MessageStatus status={item.status ?? 'delivered'} time={item.time} isMyMessage />
    ) : (
      <Text style={[styles.bubbleTime, { color: timeColor }]}>{item.time}</Text>
    );
    if (item.audio_url) {
      return (
        <View>
          <VoiceMessageBubble uri={item.audio_url} duration={item.audio_duration_seconds} textColor={textColor} timeColor={timeColor} time={item.time} />
          {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
          {isMe ? statusOrTime : null}
        </View>
      );
    }
    if (item.video_url) {
      return (
        <View>
          <ChatVideoPlayer uri={item.video_url} style={styles.chatVideo} />
          <Text style={[styles.bubbleTime, { color: timeColor }]}>{item.time}</Text>
          {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
          {isMe ? statusOrTime : null}
        </View>
      );
    }
    return (
      <>
        <Text style={[styles.bubbleText, { color: textColor }]}>{item.text}</Text>
        {reaction ? <Text style={styles.reactionBadge}>{reaction}</Text> : null}
        {statusOrTime}
      </>
    );
  };

  const renderItem: ListRenderItem<ChatMessage> = ({ item, index }) => {
    const isMe = item.sender === 'me';
    const messages = data?.messages ?? [];
    const prev = index > 0 ? messages[index - 1] : null;
    const next = index < messages.length - 1 ? messages[index + 1] : null;
    const isFirstInGroup = !prev || prev.sender !== item.sender;
    const isLastInGroup = !next || next.sender !== item.sender;
    const bubbleMarginBottom = isLastInGroup ? spacing.sm : 2;
    const textColor = isMe ? theme.primaryForeground : theme.text;
    const timeColor = isMe ? 'rgba(255,255,255,0.85)' : theme.textSecondary;
    const content = renderBubbleContent(item, textColor, timeColor, isMe);
    const bubbleRadiusMe = {
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderBottomLeftRadius: radius.lg,
      borderBottomRightRadius: 4,
    };
    const bubbleRadiusThem = {
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderBottomLeftRadius: 4,
      borderBottomRightRadius: radius.lg,
    };

    const bubbleWrap = (
      <Pressable
        onLongPress={() => {
          Vibration.vibrate(30);
          setReactionPickerMessageId(item.id);
        }}
        delayLongPress={400}
        style={[
          styles.bubble,
          { marginBottom: bubbleMarginBottom },
          isMe
            ? [styles.bubbleMe, { backgroundColor: theme.tint }, bubbleRadiusMe]
            : [styles.bubbleThem, { backgroundColor: theme.surface }, bubbleRadiusThem],
        ]}
      >
        {content}
      </Pressable>
    );

    if (!isMe && isFirstInGroup) {
      return (
        <View style={[styles.themRow, { marginBottom: bubbleMarginBottom }]}>
          <View style={[styles.themAvatarWrap, { backgroundColor: theme.muted }]}>
            {otherAvatarUri ? (
              <Image source={{ uri: otherAvatarUri }} style={styles.themAvatar} />
            ) : (
              <Text style={[styles.themAvatarFallback, { color: theme.textSecondary }]}>{otherName?.[0] ?? '?'}</Text>
            )}
          </View>
          <Pressable
            onLongPress={() => { Vibration.vibrate(30); setReactionPickerMessageId(item.id); }}
            delayLongPress={400}
            style={[styles.bubble, styles.bubbleThem, { backgroundColor: theme.surface }, bubbleRadiusThem]}
          >
            {content}
          </Pressable>
        </View>
      );
    }

    return bubbleWrap;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets} style={styles.chatHeaderBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={() => setShowProfileSheet(true)}
          style={({ pressed }) => [styles.headerCenter, pressed && { opacity: 0.9 }]}
        >
          {otherAvatarUri ? (
            <Image source={{ uri: otherAvatarUri }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback, { backgroundColor: theme.muted }]}>
              <Text style={[styles.headerAvatarLetter, { color: theme.textSecondary }]}>{otherName?.[0] ?? '?'}</Text>
            </View>
          )}
          {isOnline && <View style={[styles.onlineDot, { backgroundColor: theme.success }]} />}
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{otherName}</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {partnerTyping ? 'Vibing...' : isOnline ? 'Online now' : lastSeenText ?? 'Offline'}
            </Text>
          </View>
        </Pressable>
        <View style={styles.headerRightRow}>
          <Pressable
            onPress={() => {
              if (isOffline) {
                Alert.alert("Can't start a call", 'Check your connection.');
                return;
              }
              if (data?.matchId) startCall('voice');
            }}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Voice call"
          >
            <Ionicons name="call" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (isOffline) {
                Alert.alert("Can't start a call", 'Check your connection.');
                return;
              }
              if (data?.matchId) startCall('video');
            }}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Video call"
          >
            <Ionicons name="videocam" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => setShowActions(true)}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Actions"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.text} />
          </Pressable>
        </View>
      </GlassHeaderBar>

      <ProfileDetailSheet
        visible={showProfileSheet}
        onClose={() => setShowProfileSheet(false)}
        match={
          otherUserId && (otherUser || matches.find((m) => m.id === otherUserId))
            ? {
                id: otherUserId,
                name: otherUser?.name ?? otherName,
                age: otherUser?.age ?? matches.find((m) => m.id === otherUserId)?.age ?? 0,
                image: otherAvatarUri ?? '',
              }
            : null
        }
      />

      {incomingCall && (
        <IncomingCallOverlay
          incomingCall={incomingCall}
          callerAvatarUri={incomingCall.callerId === otherUserId ? otherAvatarUri : null}
          onAnswer={acceptCall}
          onDecline={declineCall}
        />
      )}

      <ActiveCallOverlay
        visible={isRinging || isInCall}
        isRinging={isRinging}
        isInCall={isInCall}
        callType={callType}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        callDuration={callDuration}
        partnerName={otherName}
        partnerAvatarUri={otherAvatarUri}
        localParticipant={localParticipant}
        remoteParticipant={remoteParticipant}
        getTrack={getTrack}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onEndCall={endCall}
      />

      {matchForActions && (
        <>
          <MatchActionsSheet
            visible={showActions}
            onClose={() => setShowActions(false)}
            matchName={matchForActions.name}
            isArchived={!!matchForActions.archived_at}
            isMuted={isMatchMuted(matchForActions.matchId)}
            onUnarchive={async () => {
              setActionLoading('unarchive');
              try {
                await unarchiveMatch({ matchId: matchForActions.matchId });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onUnmatch={() => {
              Alert.alert('Unmatch?', `Remove ${matchForActions.name} from your matches? This cannot be undone.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Unmatch',
                  style: 'destructive',
                  onPress: async () => {
                    setActionLoading('unmatch');
                    try {
                      await unmatch({ matchId: matchForActions.matchId });
                      setShowActions(false);
                      router.back();
                    } finally {
                      setActionLoading(null);
                    }
                  },
                },
              ]);
            }}
            onArchive={async () => {
              setActionLoading('archive');
              try {
                await archiveMatch({ matchId: matchForActions.matchId });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onBlock={() => {
              Alert.alert('Block?', `Block ${matchForActions.name}? They won't be able to contact you.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    setActionLoading('block');
                    try {
                      await blockUser({ blockedId: matchForActions.id, matchId: matchForActions.matchId });
                      setShowActions(false);
                      router.back();
                    } finally {
                      setActionLoading(null);
                    }
                  },
                },
              ]);
            }}
            onMute={async () => {
              setActionLoading('mute');
              try {
                await muteMatch({ matchId: matchForActions.matchId, duration: '1day' });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onUnmute={async () => {
              setActionLoading('unmute');
              try {
                await unmuteMatch({ matchId: matchForActions.matchId });
                setShowActions(false);
              } finally {
                setActionLoading(null);
              }
            }}
            onReport={() => {
              setShowActions(false);
              setShowReport(true);
            }}
            loading={actionLoading}
          />
          <ReportFlowModal
            visible={showReport}
            onClose={() => setShowReport(false)}
            onSuccess={() => setShowReport(false)}
            reportedId={matchForActions.id}
            reportedName={matchForActions.name}
            reporterId={user?.id ?? ''}
          />
        </>
      )}

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={data.messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            (data.messages?.length ?? 0) === 0 ? styles.listContentEmpty : null,
          ]}
          ListHeaderComponent={
            pendingDateProposalsForMe.length > 0 ? (
              <View style={styles.proposalBanners}>
                {pendingDateProposalsForMe.map((p) => (
                  <View
                    key={p.id}
                    style={[styles.proposalBanner, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                  >
                    <Text style={[styles.proposalBannerTitle, { color: theme.text }]}>Date suggestion</Text>
                    <Text style={[styles.proposalBannerMeta, { color: theme.textSecondary }]}>
                      {new Date(p.proposed_date).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      · {getTimeBlockLabel(p.time_block as TimeBlock)} · {p.activity}
                    </Text>
                    <View style={styles.proposalBannerActions}>
                      <Pressable
                        onPress={() =>
                          respondToProposal({ proposalId: p.id, accept: true }).catch(() =>
                            Alert.alert('Error', 'Could not accept.')
                          )
                        }
                        disabled={respondingProposal}
                        style={({ pressed }) => [
                          styles.proposalBtn,
                          { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 },
                        ]}
                      >
                        <Text style={styles.proposalBtnLabelLight}>Accept</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          respondToProposal({ proposalId: p.id, accept: false }).catch(() =>
                            Alert.alert('Error', 'Could not decline.')
                          )
                        }
                        disabled={respondingProposal}
                        style={({ pressed }) => [
                          styles.proposalBtnOutline,
                          { borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                        ]}
                      >
                        <Text style={[styles.proposalBtnLabel, { color: theme.textSecondary }]}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.waveEmptyWrap}>
              <Text style={styles.waveEmptyEmoji}>👋</Text>
              <Text style={[styles.waveEmptyTitle, { color: theme.text }]}>{"It's a match!"}</Text>
              <Text style={[styles.waveEmptySub, { color: theme.mutedForeground }]}>
                Send a wave to start the conversation
              </Text>
            </View>
          }
          ListFooterComponent={
            partnerTyping ? (
              <View style={styles.typingWrap}>
                <TypingIndicator />
              </View>
            ) : null
          }
        />
        <View style={[styles.quickActions, { borderTopColor: theme.border }]}>
          <Pressable onPress={() => setShowDateSheet(true)} style={({ pressed }) => [styles.quickActionBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="calendar-outline" size={18} color={theme.tint} />
            <Text style={[styles.quickActionLabel, { color: theme.tint }]}>Suggest a date</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/matches')} style={({ pressed }) => [styles.quickActionBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="game-controller-outline" size={18} color={theme.textSecondary} />
            <Text style={[styles.quickActionLabel, { color: theme.textSecondary }]}>Games</Text>
          </Pressable>
        </View>
        <View
          style={[
            styles.footer,
            {
              borderTopColor: theme.border,
              backgroundColor: theme.background,
              paddingBottom: Platform.OS === 'ios' ? (insets.bottom || spacing.lg) + spacing.sm : spacing.lg,
            },
          ]}
        >
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surfaceSubtle }]}
            placeholder="Type a message..."
            placeholderTextColor={theme.textSecondary}
            value={input}
            onChangeText={handleInputChange}
            multiline
            maxLength={2000}
            editable={!isSending}
          />
          <Pressable
            style={[styles.footerIconBtn, { backgroundColor: theme.surfaceSubtle }]}
            onPress={() => Alert.alert('Coming soon', 'Photo messages will be available in a future update.')}
            disabled={isSending}
            accessibilityLabel="Attach photo"
          >
            <Ionicons name="camera-outline" size={22} color={theme.tint} />
          </Pressable>
          <Pressable
            style={[styles.footerIconBtn, { backgroundColor: theme.surfaceSubtle }]}
            onPress={handleVideoPick}
            disabled={isSending}
            accessibilityLabel="Send video"
          >
            {sendingVideo ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Ionicons name="videocam-outline" size={22} color={theme.tint} />
            )}
          </Pressable>
          <Pressable
            style={[styles.footerIconBtn, { backgroundColor: theme.surfaceSubtle }]}
            onPress={handleVoicePress}
            disabled={isSending}
            accessibilityLabel="Voice message"
          >
            {sendingVoice ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : recording ? (
              <Ionicons name="stop" size={22} color={theme.danger} />
            ) : (
              <Ionicons name="mic-outline" size={22} color={theme.tint} />
            )}
          </Pressable>
          <Pressable
            style={[
              styles.sendBtn,
              { backgroundColor: theme.tint },
              (!input.trim() || isSending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!input.trim() || isSending}
          >
            <Text style={[styles.sendBtnText, { color: theme.primaryForeground }]}>
              {isSending ? '…' : 'Send'}
            </Text>
          </Pressable>
        </View>
        {(voiceError || videoError) ? (
          <Text style={[styles.voiceError, { color: theme.danger }]}>{voiceError ?? videoError}</Text>
        ) : null}
        {recording ? (
          <Text style={[styles.recordingHint, { color: theme.textSecondary }]}>Recording… Tap mic to send</Text>
        ) : null}
      </KeyboardAvoidingView>

      <ReactionPicker
        visible={!!reactionPickerMessageId}
        onClose={() => setReactionPickerMessageId(null)}
        onSelect={(emoji) => {
          if (reactionPickerMessageId) {
            setLocalReactions((prev) => ({ ...prev, [reactionPickerMessageId]: emoji }));
            setReactionPickerMessageId(null);
          }
        }}
        anchorRight={!!reactionPickerMessageId && (data?.messages?.find((m) => m.id === reactionPickerMessageId)?.sender === 'me')}
      />

      <DateSuggestionSheet
        visible={showDateSheet}
        onClose={() => setShowDateSheet(false)}
        matchName={otherName}
        matchId={data?.matchId ?? ''}
        proposerId={user?.id ?? ''}
        recipientId={otherUserId ?? ''}
        onCreate={async (proposedDate, timeBlock, activity) => {
          if (!data?.matchId || !user?.id || !otherUserId) return;
          if (isOffline) {
            Alert.alert("Can't send", 'Check your connection.');
            return;
          }
          try {
            await createDateProposal({
              matchId: data.matchId,
              proposerId: user.id,
              recipientId: otherUserId,
              proposedDate,
              timeBlock,
              activity,
            });
            const timeLabel = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' }[timeBlock] ?? timeBlock;
            await sendMessage({
              matchId: data.matchId,
              content: `📅 Suggested ${proposedDate} (${timeLabel}): ${activity}`,
            });
          } catch {
            Alert.alert('Error', 'Could not send date proposal.');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  chatHeaderBar: { marginBottom: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerIconBtn: { padding: spacing.xs },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  headerAvatarLetter: { fontSize: 16, fontWeight: '600' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: 'hsl(240, 10%, 4%)' },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  typingWrap: { paddingVertical: spacing.sm },
  reactionBadge: { fontSize: 14, marginTop: 4 },
  proposalBanners: { marginBottom: spacing.md, gap: spacing.sm },
  proposalBanner: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  proposalBannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  proposalBannerMeta: { fontSize: 13, lineHeight: 18 },
  proposalBannerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  proposalBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center' },
  proposalBtnOutline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  proposalBtnLabelLight: { color: '#fff', fontWeight: '600', fontSize: 15 },
  proposalBtnLabel: { fontWeight: '600', fontSize: 15 },
  keyboard: { flex: 1 },
  list: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  waveEmptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    minHeight: 220,
  },
  waveEmptyEmoji: { fontSize: 48, marginBottom: 16 },
  waveEmptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  waveEmptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  empty: { padding: spacing.xl, textAlign: 'center', fontSize: 14 },
  themRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2, gap: spacing.xs },
  themAvatarWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themAvatar: { width: 28, height: 28 },
  themAvatarFallback: { fontSize: 12, fontWeight: '600' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  bubbleMe: { alignSelf: 'flex-end' },
  bubbleThem: { alignSelf: 'flex-start', flex: 0 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTime: { fontSize: 11, marginTop: 4, opacity: 0.9 },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    maxHeight: 100,
    minHeight: layout.inputHeight,
  },
  sendBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.button,
    justifyContent: 'center',
    minWidth: 60,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { fontWeight: '600' },
  footerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  voiceLabel: { fontSize: 15 },
  chatVideo: { width: 200, height: 120, borderRadius: radius.lg },
  voiceError: { fontSize: 12, marginTop: 4, marginHorizontal: 8 },
  recordingHint: { fontSize: 12, marginTop: 4, marginHorizontal: 8 },
  quickActions: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: layout.containerPadding, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  quickActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickActionLabel: { fontSize: 13, fontWeight: '500' },
});
