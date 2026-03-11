import { StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';

export default function SettingsScreen() {
  const { signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.placeholder}>Sprint 1 placeholder. Notifications, privacy, account (Sprint 2+).</Text>
      <Link href="/premium" asChild>
        <Text style={styles.link}>Premium</Text>
      </Link>
      <Text style={styles.link} onPress={() => signOut()}>
        Sign out
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  placeholder: { opacity: 0.8, marginBottom: 16 },
  link: { color: '#2f95dc', marginVertical: 4 },
});
