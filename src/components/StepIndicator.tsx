import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Theme } from '../theme/theme';

interface StepIndicatorProps {
  totalSteps: number;
  currentStep: number; // 0-indexed
}

export function StepIndicator({ totalSteps, currentStep }: StepIndicatorProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: totalSteps }).map((_, i) => (
        <StepDot key={i} active={i === currentStep} completed={i < currentStep} />
      ))}
    </View>
  );
}

function StepDot({ active, completed }: { active: boolean; completed: boolean }) {
  const width = useSharedValue(completed || active ? (active ? 24 : 8) : 8);
  const opacity = useSharedValue(completed || active ? 1 : 0.3);

  React.useEffect(() => {
    width.value = withSpring(active ? 24 : 8, Theme.animation.spring);
    opacity.value = withTiming(active || completed ? 1 : 0.3, { duration: Theme.animation.normal });
  }, [active, completed]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: width.value,
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        animatedStyle,
        {
          backgroundColor: completed
            ? Theme.colors.success
            : active
            ? Theme.colors.primary
            : Theme.colors.border,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: Theme.borderRadius.full,
  },
});
