import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Theme } from '../theme/theme';

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  style?: ViewStyle;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  variant = 'neutral',
  style,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return {
          bg: Theme.colors.success + '20', // 12% opacity
          text: Theme.colors.success,
          dot: Theme.colors.success,
        };
      case 'warning':
        return {
          bg: Theme.colors.warning + '20',
          text: Theme.colors.warning,
          dot: Theme.colors.warning,
        };
      case 'error':
        return {
          bg: Theme.colors.error + '20',
          text: Theme.colors.error,
          dot: Theme.colors.error,
        };
      case 'info':
        return {
          bg: Theme.colors.info + '20',
          text: Theme.colors.info,
          dot: Theme.colors.info,
        };
      case 'neutral':
      default:
        return {
          bg: Theme.colors.borderLight,
          text: Theme.colors.textSecondary,
          dot: Theme.colors.textTertiary,
        };
    }
  };

  const colors = getVariantStyles();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }, style]}>
      <View style={[styles.dot, { backgroundColor: colors.dot }]} />
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Theme.borderRadius.full,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  label: {
    ...Theme.typography.label,
    fontSize: 11,
    textTransform: 'uppercase',
  },
});
