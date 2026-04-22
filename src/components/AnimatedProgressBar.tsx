import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Theme } from '../theme/theme';

interface AnimatedProgressBarProps {
  progress: number; // 0 to 1
  label?: string;
  color?: string;
  height?: number;
  showPercent?: boolean;
}

export function AnimatedProgressBar({
  progress,
  label,
  color = Theme.colors.primary,
  height = 8,
  showPercent = false,
}: AnimatedProgressBarProps) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(Math.min(Math.max(progress, 0), 1) * 100, {
      duration: Theme.animation.slow,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value}%` as any,
  }));

  return (
    <View style={styles.container}>
      {(label || showPercent) && (
        <View style={styles.header}>
          {label && <Text style={styles.label}>{label}</Text>}
          {showPercent && (
            <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
          )}
        </View>
      )}
      <View style={[styles.track, { height }]}>
        <Animated.View
          style={[
            styles.fill,
            { height, backgroundColor: color },
            animatedStyle,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    ...Theme.typography.caption,
    color: Theme.colors.textSecondary,
  },
  percent: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textTertiary,
    fontWeight: '700',
  },
  track: {
    borderRadius: Theme.borderRadius.full,
    backgroundColor: Theme.colors.borderLight,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: Theme.borderRadius.full,
  },
});
