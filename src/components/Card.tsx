import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Theme } from '../theme/theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'elevated' | 'flat' | 'outline' | 'glass';
}

export const Card: React.FC<CardProps> = ({ children, style, variant = 'elevated' }) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'glass':
        return {
          backgroundColor: Theme.colors.glass,
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.5)',
        };
      case 'outline':
        return {
          backgroundColor: Theme.colors.surface,
          borderWidth: 1,
          borderColor: Theme.colors.border,
        };
      case 'flat':
        return {
          backgroundColor: Theme.colors.borderLight,
        };
      case 'elevated':
      default:
        return {
          backgroundColor: Theme.colors.surface,
          ...Theme.shadows.soft,
        };
    }
  };

  return (
    <View style={[styles.base, getVariantStyles(), style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
  },
});
