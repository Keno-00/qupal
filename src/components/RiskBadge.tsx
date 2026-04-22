import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { CheckCircle2, AlertTriangle, Eye } from 'lucide-react-native';
import { Theme } from '../theme/theme';

type RiskLevel = 'low' | 'medium' | 'high';

interface RiskBadgeProps {
  level: RiskLevel;
  large?: boolean;
}

const RISK_CONFIG: Record<
  RiskLevel,
  { label: string; detail: string; bg: string; border: string; text: string; icon: React.ReactNode }
> = {
  low: {
    label: 'All Clear',
    detail: 'No signs of concern detected.',
    bg: '#f0fdf4',
    border: '#86efac',
    text: '#166534',
    icon: <CheckCircle2 size={32} color="#166534" />,
  },
  medium: {
    label: 'Keep Watch',
    detail: 'Some indicators found. Monitor closely.',
    bg: '#fffbeb',
    border: '#fcd34d',
    text: '#92400e',
    icon: <Eye size={32} color="#92400e" />,
  },
  high: {
    label: 'See a Doctor',
    detail: 'Significant indicators found.',
    bg: '#fff1f2',
    border: '#fca5a5',
    text: '#9f1239',
    icon: <AlertTriangle size={32} color="#9f1239" />,
  },
};

export function RiskBadge({ level, large = false }: RiskBadgeProps) {
  const config = RISK_CONFIG[level];
  const scale = useSharedValue(0.85);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: Theme.animation.normal });
    scale.value = withTiming(1, {
      duration: Theme.animation.slow,
      easing: Easing.out(Easing.back(1.2)),
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.badge,
        large && styles.badgeLarge,
        {
          backgroundColor: config.bg,
          borderColor: config.border,
        },
        animatedStyle,
      ]}
    >
      {config.icon}
      <Text style={[styles.label, large && styles.labelLarge, { color: config.text }]}>
        {config.label}
      </Text>
      {large && (
        <Text style={[styles.detail, { color: config.text }]}>{config.detail}</Text>
      )}
    </Animated.View>
  );
}

// Small inline chip version
export function RiskChip({ level }: { level: RiskLevel }) {
  const config = RISK_CONFIG[level];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: config.bg, borderColor: config.border },
      ]}
    >
      <Text style={[styles.chipText, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1.5,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.lg,
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  badgeLarge: {
    paddingVertical: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.xxl,
  },
  label: {
    ...Theme.typography.h3,
  },
  labelLarge: {
    ...Theme.typography.h2,
  },
  detail: {
    ...Theme.typography.body,
    textAlign: 'center',
    opacity: 0.85,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Theme.borderRadius.full,
    paddingVertical: 4,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  chipText: {
    ...Theme.typography.captionSmall,
    fontWeight: '700',
  },
});
