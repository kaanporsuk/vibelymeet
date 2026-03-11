import { StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { Text, View } from '@/components/Themed';

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>Sprint 1 placeholder — Home</Text>
      <Link href="/events" asChild>
        <Text style={styles.link}>Events</Text>
      </Link>
      <Link href="/matches" asChild>
        <Text style={styles.link}>Matches</Text>
      </Link>
      <Link href="/settings" asChild>
        <Text style={styles.link}>Settings</Text>
      </Link>
      <Link href="/premium" asChild>
        <Text style={styles.link}>Premium</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { opacity: 0.8, marginBottom: 24 },
  link: { color: '#2f95dc', marginVertical: 4 },
});
