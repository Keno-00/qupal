import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, ChevronRight, Clock, Eye, FileText, Sparkles } from 'lucide-react-native';

import { Theme } from '../theme/theme';
import { useProfile } from '../components/ProfileContext';
import { RiskChip } from '../components/RiskBadge';
import { assistantService } from '../services/ai/assistant';
import type { AppNavigationProp } from '../navigation/types';

const STORAGE_KEY = 'glance_scans_v1';

const TIPS = [
  'Take a scan every 2–4 weeks to track changes over time.',
  'Good lighting behind you helps capture a clearer image.',
  'Remove glasses before scanning — contact lenses are fine.',
  'If your vision changes suddenly, see a doctor immediately.',
  'Regular monitoring can catch early signs before symptoms appear.',
];

type ScanRecord = {
  id: string;
  capturedAt: string;
  analysis: { riskLevel: 'low' | 'medium' | 'high' };
  eyeSide: 'left' | 'right';
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function daysSince(isoDate: string): number {
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diff / 86_400_000);
}

export default function HomeScreen() {
  const navigation = useNavigation<AppNavigationProp>();
  const { profile } = useProfile();
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setScans(JSON.parse(raw) as ScanRecord[]);
      } catch {}
    };
    load();
    // Refresh on focus
    const unsub = (navigation as any).addListener?.('focus', load);
    return unsub;
  }, [navigation]);

  const lastScan = scans[0] ?? null;
  const daysSinceLast = lastScan ? daysSince(lastScan.capturedAt) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <View style={styles.greeting}>
        <Text style={styles.greetingText}>
          {getGreeting()}{profile?.firstName ? `, ${profile.firstName}` : ''}
        </Text>
        <View style={styles.eyeIconBadge}>
          <Eye size={18} color={Theme.colors.primary} />
        </View>
      </View>

      {/* Hero CTA */}
      <Pressable
        style={({ pressed }) => [styles.heroCard, pressed && { opacity: 0.93 }]}
        onPress={() => navigation.navigate('ScanFlow', {})}
      >
        <View style={styles.heroContent}>
          <View style={styles.heroLeft}>
            <Text style={styles.heroLabel}>
              {daysSinceLast === null
                ? 'Ready for your first scan?'
                : daysSinceLast === 0
                ? 'You scanned today.'
                : `Last scan: ${daysSinceLast} day${daysSinceLast !== 1 ? 's' : ''} ago`}
            </Text>
            <Text style={styles.heroTitle}>Start Checkup</Text>
          </View>
          <View style={styles.heroButton}>
            <Camera size={26} color={Theme.colors.primary} />
          </View>
        </View>
      </Pressable>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{scans.length}</Text>
          <Text style={styles.statLabel}>Total scans</Text>
        </View>
        <View style={[styles.statCard, styles.statCardMid]}>
          <Text style={styles.statValue}>
            {scans.filter(s => s.analysis.riskLevel === 'low').length}
          </Text>
          <Text style={styles.statLabel}>All clear</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {daysSinceLast !== null ? `${daysSinceLast}d` : '—'}
          </Text>
          <Text style={styles.statLabel}>Since last</Text>
        </View>
      </View>

      {/* Last scan preview */}
      {lastScan && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Last Scan</Text>
            <Pressable onPress={() => navigation.navigate('History')}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.lastScanCard}
            onPress={() => navigation.navigate('History')}
          >
            <View style={styles.lastScanMeta}>
              <View style={styles.lastScanIconCircle}>
                <Eye size={18} color={Theme.colors.primary} />
              </View>
              <View>
                <Text style={styles.lastScanEye}>
                  {lastScan.eyeSide === 'left' ? 'Left Eye' : 'Right Eye'}
                </Text>
                <Text style={styles.lastScanDate}>
                  {new Date(lastScan.capturedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              </View>
            </View>
            <RiskChip level={lastScan.analysis.riskLevel} />
          </Pressable>
        </View>
      )}

      {/* Daily Check-in */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Wellness Check-in</Text>
        <Pressable
          style={styles.wellnessCard}
          onPress={() => navigation.navigate('GlanceHelper', { initialMessage: assistantService.getWellnessPrompt() })}
        >
          <View style={styles.wellnessContent}>
            <View style={styles.wellnessIcon}>
              <Sparkles size={22} color={Theme.colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.wellnessTitle}>How are your eyes today?</Text>
              <Text style={styles.wellnessSubtitle}>Tally your symptoms for your next doctor visit.</Text>
            </View>
            <ChevronRight size={18} color={Theme.colors.textTertiary} />
          </View>
        </Pressable>
      </View>

      {/* Daily Tip */}
      <View style={styles.tipCard}>
        <View style={styles.tipHeader}>
          <Sparkles size={16} color={Theme.colors.primaryLight} />
          <Text style={styles.tipLabel}>Today's Tip</Text>
        </View>
        <Text style={styles.tipText}>{tip}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  content: {
    padding: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    gap: Theme.spacing.lg,
    paddingBottom: 40,
  },
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.sm,
  },
  greetingText: {
    ...Theme.typography.h2,
    color: Theme.colors.textPrimary,
  },
  eyeIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.backgroundAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroCard: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.lg,
    ...Theme.shadows.medium,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: {
    flex: 1,
    gap: 4,
  },
  heroLabel: {
    ...Theme.typography.captionSmall,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroTitle: {
    ...Theme.typography.h2,
    color: '#fff',
  },
  heroButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Theme.spacing.md,
    ...Theme.shadows.soft,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    alignItems: 'center',
    gap: 4,
    ...Theme.shadows.soft,
  },
  statCardMid: {
    borderWidth: 1.5,
    borderColor: Theme.colors.borderLight,
  },
  statValue: {
    ...Theme.typography.h2,
    color: Theme.colors.textPrimary,
  },
  statLabel: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  section: {
    gap: Theme.spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...Theme.typography.bodyBold,
    color: Theme.colors.textPrimary,
  },
  seeAll: {
    ...Theme.typography.body,
    color: Theme.colors.primary,
  },
  lastScanCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Theme.shadows.soft,
  },
  lastScanMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  lastScanIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.backgroundAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lastScanEye: {
    ...Theme.typography.bodyBold,
    color: Theme.colors.textPrimary,
  },
  lastScanDate: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textTertiary,
  },
  wellnessCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    ...Theme.shadows.soft,
  },
  wellnessContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  wellnessIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wellnessTitle: {
    ...Theme.typography.bodyBold,
    color: Theme.colors.textPrimary,
  },
  wellnessSubtitle: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  tipCard: {
    backgroundColor: Theme.colors.primaryDark,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.lg,
    gap: Theme.spacing.sm,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipLabel: {
    ...Theme.typography.label,
    color: Theme.colors.primaryLight,
  },
  tipText: {
    ...Theme.typography.body,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 22,
  },
});
