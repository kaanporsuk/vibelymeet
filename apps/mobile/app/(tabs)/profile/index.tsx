import { useState, useEffect } from 'react';
import {
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile, updateMyProfile } from '@/lib/profileApi';
import { avatarUrl } from '@/lib/imageUrl';

export default function ProfileScreen() {
  const { user, signOut, refreshOnboarding } = useAuth();
  const qc = useQueryClient();
  const { data: profile, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: !!user?.id,
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [job, setJob] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? '');
      setTagline(profile.tagline ?? '');
      setJob(profile.job ?? '');
      setAboutMe(profile.about_me ?? '');
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMyProfile({ name: name.trim() || undefined, tagline: tagline.trim() || undefined, job: job.trim() || undefined, about_me: aboutMe.trim() || undefined });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      await refreshOnboarding();
      setEditing(false);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !profile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const photoUrl = profile?.avatar_url || profile?.photos?.[0];
  const displayUrl = photoUrl ? avatarUrl(photoUrl) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching && !isLoading} onRefresh={refetch} />}
    >
      <Text style={styles.title}>Profile</Text>
      {displayUrl ? (
        <Image source={{ uri: displayUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarPlaceholderText}>No photo</Text>
          <Text style={styles.deferral}>Add photos on web or in a future update.</Text>
        </View>
      )}

      {editing ? (
        <>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} editable={!saving} />
          <Text style={styles.label}>Tagline</Text>
          <TextInput style={styles.input} value={tagline} onChangeText={setTagline} editable={!saving} />
          <Text style={styles.label}>Job</Text>
          <TextInput style={styles.input} value={job} onChangeText={setJob} editable={!saving} />
          <Text style={styles.label}>About you</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={aboutMe}
            onChangeText={setAboutMe}
            multiline
            numberOfLines={3}
            editable={!saving}
          />
          <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => setEditing(false)} disabled={saving}>
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.name}>{profile?.name || '—'}</Text>
          {profile?.tagline ? <Text style={styles.tagline}>{profile.tagline}</Text> : null}
          {profile?.job ? <Text style={styles.meta}>{profile.job}</Text> : null}
          {profile?.about_me ? <Text style={styles.bio}>{profile.about_me}</Text> : null}
          <Text style={styles.meta}>Matches: {profile?.total_matches ?? 0} · Conversations: {profile?.total_conversations ?? 0}</Text>
          <Pressable style={styles.button} onPress={() => setEditing(true)}>
            <Text style={styles.buttonText}>Edit profile</Text>
          </Pressable>
        </>
      )}

      <Link href="/settings" asChild>
        <Pressable style={styles.textButton}>
          <Text style={styles.link}>Settings</Text>
        </Pressable>
      </Link>
      <Pressable style={styles.textButton} onPress={() => signOut()}>
        <Text style={styles.link}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  avatar: { width: 120, height: 120, borderRadius: 60, marginBottom: 16 },
  avatarPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  avatarPlaceholderText: { fontSize: 12, opacity: 0.8 },
  deferral: { fontSize: 10, marginTop: 4, opacity: 0.7 },
  name: { fontSize: 20, fontWeight: '600', marginBottom: 4 },
  tagline: { fontSize: 14, opacity: 0.9, marginBottom: 8 },
  meta: { fontSize: 12, opacity: 0.8, marginBottom: 4 },
  bio: { fontSize: 14, marginTop: 8, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 8 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: '#2f95dc', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  textButton: { marginTop: 12 },
  link: { color: '#2f95dc' },
});
