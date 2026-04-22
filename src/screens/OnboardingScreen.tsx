import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Eye, ChevronRight, Check } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';


import { Theme } from '../theme/theme';
import { useProfile } from '../components/ProfileContext';
import { StepIndicator } from '../components/StepIndicator';
import type { AppStackParamList } from '../navigation/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type OnboardingNavProp = StackNavigationProp<AppStackParamList, 'Onboarding'>;

export default function OnboardingScreen() {
  const navigation = useNavigation<OnboardingNavProp>();
  const { saveProfile } = useProfile();

  const [step, setStep] = useState(0); // 0, 1, 2
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Form state
  const [firstName, setFirstName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const [hasEyeCondition, setHasEyeCondition] = useState(false);
  const [conditionDescription, setConditionDescription] = useState('');

  const goToStep = (nextStep: number) => {
    Animated.timing(slideAnim, {
      toValue: -nextStep * SCREEN_WIDTH,
      duration: Theme.animation.normal,
      useNativeDriver: true,
    }).start(() => setStep(nextStep));
  };

  const handleNext = () => {
    if (step < 2) {
      goToStep(step + 1);
    } else {
      void handleFinish();
    }
  };

  const handleFinish = async () => {
    await saveProfile({
      firstName: firstName.trim() || 'Friend',
      dateOfBirth,
      hasEyeCondition,
      conditionDescription: hasEyeCondition ? conditionDescription.trim() : '',
    });
    navigation.replace('MainTabs');
  };

  const canContinue = step === 0
    ? true
    : step === 1
    ? firstName.trim().length > 0
    : true;

  const stepLabels = ['Welcome', 'About You', 'Your Eyes'];

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Eye size={20} color="#fff" />
            </View>
            <Text style={styles.logoText}>glance</Text>
          </View>
          <StepIndicator totalSteps={3} currentStep={step} />
        </View>

        {/* Slides */}
        <View style={styles.slidesWrapper}>
          <Animated.View
            style={[
              styles.slideContainer,
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            {/* Step 0 — Welcome */}
            <View style={styles.slide}>
            <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
              <View style={styles.illustrationCircle}>
                <Eye size={56} color={Theme.colors.primary} />
              </View>
              <Text style={styles.stepTitle}>Know your{'\n'}eye health.</Text>
              <Text style={styles.stepSubtitle}>
                A quick checkup, right from your phone. Private and on-device — your data never leaves.
              </Text>

              <View style={styles.featureList}>
                {[
                  'Retina scan in under 60 seconds',
                  'AI analysis on your device',
                  'Share reports with your doctor',
                ].map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <View style={styles.featureCheck}>
                      <Check size={14} color={Theme.colors.success} />
                    </View>
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Step 1 — About You */}
          <View style={styles.slide}>
            <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.stepTitle}>Let's get{'\n'}started.</Text>
              <Text style={styles.stepSubtitle}>
                We'll personalize your experience.
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>First name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Maria"
                  placeholderTextColor={Theme.colors.textTertiary}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  returnKeyType="done"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Date of birth</Text>
                <Pressable 
                  style={styles.input} 
                  onPress={() => setShowPicker(true)}
                >
                  <Text style={{ 
                    ...Theme.typography.body, 
                    color: dateOfBirth ? Theme.colors.textPrimary : Theme.colors.textTertiary 
                  }}>
                    {dateOfBirth 
                      ? new Date(dateOfBirth).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
                      : 'Select your birthday'
                    }
                  </Text>
                </Pressable>
                {showPicker && (
                  <DateTimePicker
                    value={dateOfBirth ? new Date(dateOfBirth) : new Date(2000, 0, 1)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event, selectedDate) => {
                      setShowPicker(Platform.OS === 'ios'); // On iOS keep open until dismissed or if using spinner, on Android close it
                      if (selectedDate) {
                        setDateOfBirth(selectedDate.toISOString().split('T')[0]);
                      }
                      if (Platform.OS === 'android') setShowPicker(false);
                    }}
                    maximumDate={new Date()}
                  />
                )}
                <Text style={styles.fieldHint}>Used to contextualize results. Not shared.</Text>
              </View>
            </ScrollView>
          </View>

          {/* Step 2 — Eye Health */}
          <View style={styles.slide}>
            <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.stepTitle}>Any known{'\n'}conditions?</Text>
              <Text style={styles.stepSubtitle}>
                This helps us give you more relevant feedback.
              </Text>

              <View style={styles.toggleRow}>
                <Text style={styles.fieldLabel}>I have a diagnosed eye condition</Text>
                <Switch
                  value={hasEyeCondition}
                  onValueChange={setHasEyeCondition}
                  trackColor={{ false: Theme.colors.borderLight, true: Theme.colors.primaryLight }}
                  thumbColor={hasEyeCondition ? Theme.colors.primary : Theme.colors.surface}
                />
              </View>

              {hasEyeCondition && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Condition</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Diabetic retinopathy"
                    placeholderTextColor={Theme.colors.textTertiary}
                    value={conditionDescription}
                    onChangeText={setConditionDescription}
                    autoCapitalize="sentences"
                    returnKeyType="done"
                  />
                </View>
              )}

              <View style={styles.consentBox}>
                <Text style={styles.consentText}>
                  Glance uses on-device AI only. Nothing is sent to external servers without your explicit action.
                </Text>
              </View>
            </ScrollView>
          </View>
        </Animated.View>
      </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              !canContinue && styles.ctaDisabled,
              pressed && styles.ctaPressed,
            ]}
            onPress={handleNext}
            disabled={!canContinue}
          >
            <Text style={styles.ctaText}>
              {step === 2 ? "Let's go" : 'Continue'}
            </Text>
            <ChevronRight size={20} color="#fff" />
          </Pressable>

          {step === 2 && (
            <Pressable onPress={handleFinish} style={styles.skipButton}>
              <Text style={styles.skipText}>Skip for now</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Theme.colors.surface,
  },
  header: {
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.lg,
    gap: Theme.spacing.lg,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 36,
    height: 36,
    borderRadius: Theme.borderRadius.sm,
    backgroundColor: Theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    ...Theme.typography.h3,
    color: Theme.colors.primary,
    letterSpacing: -0.5,
  },
  slidesWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  slideContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  slide: {
    width: SCREEN_WIDTH,
  },
  slideContent: {
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xl,
    gap: Theme.spacing.lg,
  },
  illustrationCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Theme.colors.backgroundAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  stepTitle: {
    ...Theme.typography.h1,
    color: Theme.colors.textPrimary,
  },
  stepSubtitle: {
    ...Theme.typography.body,
    color: Theme.colors.textSecondary,
    marginTop: -Theme.spacing.sm,
  },
  featureList: {
    gap: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  featureCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    ...Theme.typography.body,
    color: Theme.colors.textPrimary,
    flex: 1,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    ...Theme.typography.label,
    color: Theme.colors.textSecondary,
  },
  input: {
    ...Theme.typography.body,
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 14,
    backgroundColor: Theme.colors.surface,
    color: Theme.colors.textPrimary,
  },
  fieldHint: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textTertiary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm,
  },
  consentBox: {
    backgroundColor: Theme.colors.backgroundAlt,
    borderRadius: Theme.borderRadius.md,
    padding: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
  },
  consentText: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textTertiary,
    lineHeight: 18,
  },
  footer: {
    padding: Theme.spacing.lg,
    gap: Theme.spacing.sm,
  },
  ctaButton: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.md,
    paddingVertical: 16,
    paddingHorizontal: Theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...Theme.shadows.medium,
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  ctaText: {
    ...Theme.typography.bodyBold,
    color: '#fff',
    fontSize: 17,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  skipText: {
    ...Theme.typography.body,
    color: Theme.colors.textTertiary,
  },
});
