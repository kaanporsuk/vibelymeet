import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';

export default function ResetPasswordScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset password</Text>
      <Text style={styles.placeholder}>Sprint 1 placeholder. Web flow: /reset-password.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  placeholder: { opacity: 0.8 },
});
