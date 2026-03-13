import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import Colors from '@/constants/Colors';
import { ScreenContainer, SectionHeader, Card, VibelyButton } from '@/components/ui';
import { spacing, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <ScreenContainer
      title="Home"
      headerRight={
        <VibelyButton
          label="Settings"
          onPress={() => router.push('/settings')}
          variant="ghost"
        />
      }
    >
      <SectionHeader
        title="Today"
        subtitle="Your upcoming Vibely moments"
      />

      <Card>
        <VibelyButton
          label="Browse events"
          onPress={() => router.push('/events')}
        />
        <VibelyButton
          label="View matches"
          onPress={() => router.push('/matches')}
          variant="secondary"
          style={{ marginTop: spacing.sm }}
        />
      </Card>

      <SectionHeader
        title="Account"
        subtitle="Profile and membership"
      />

      <Card>
        <VibelyButton
          label="View profile"
          onPress={() => router.push('/profile')}
          variant="secondary"
        />
        <VibelyButton
          label="Explore Premium"
          onPress={() => router.push('/premium')}
          variant="ghost"
          textStyle={{ color: theme.accent }}
        />
      </Card>

      <SectionHeader title="What’s coming" />
      <Card style={styles.placeholderCard}>
        <StyledTitle>Personalized lobby, daily drops, and more.</StyledTitle>
        <StyledBody>We’re bringing the full Vibely experience to mobile in upcoming sprints. For now, you can manage most details on web.</StyledBody>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  placeholderCard: {
    paddingVertical: spacing.md,
  },
});
const StyledTitle = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ ...typography.titleMD, marginBottom: spacing.xs }}>{children}</Text>
);

const StyledBody = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ ...typography.bodySecondary }}>{children}</Text>
);
