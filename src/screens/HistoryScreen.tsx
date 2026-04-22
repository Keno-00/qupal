import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Eye, Calendar, ChevronRight } from 'lucide-react-native';

import { Theme } from '../theme/theme';
import { RiskChip } from '../components/RiskBadge';
import { symptomService, SymptomLog } from '../services/symptomService';
import type { AppStackParamList } from '../navigation/types';

const STORAGE_KEY = 'glance_scans_v1';

type ScanRecord = {
  id: string;
  capturedAt: string;
  eyeSide: 'left' | 'right';
  analysis: { riskLevel: 'low' | 'medium' | 'high' };
};

function groupByDate(scans: ScanRecord[]): { date: string; scans: ScanRecord[] }[] {
  const map = new Map<string, ScanRecord[]>();
  for (const s of scans) {
    const key = new Date(s.capturedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([date, scans]) => ({ date, scans }));
}

export default function HistoryScreen() {
  const navigation = useNavigation<StackNavigationProp<AppStackParamList>>();
  const [activeTab, setActiveTab] = useState<'scans' | 'symptoms'>('scans');
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [symptoms, setSymptoms] = useState<SymptomLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    try {
      const [rawScans, logs] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        symptomService.getLogs()
      ]);
      if (rawScans) setScans(JSON.parse(rawScans) as ScanRecord[]);
      setSymptoms(logs);
    } catch {}
    finally { setIsLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  // Refresh on tab focus
  useEffect(() => {
    const unsub = (navigation as any).addListener?.('focus', load);
    return unsub;
  }, [navigation]);

  const groups = groupByDate(scans);

  if (isLoading) return <SafeAreaView style={styles.root} />;

  if (scans.length === 0) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Eye size={40} color={Theme.colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No scans yet</Text>
          <Text style={styles.emptyBody}>Your scan history will appear here.</Text>
          <Pressable style={styles.btn} onPress={() => navigation.navigate('ScanFlow', {})}>
            <Text style={styles.btnText}>Take First Scan</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <Pressable 
          style={[styles.tab, activeTab === 'scans' && styles.tabActive]} 
          onPress={() => setActiveTab('scans')}
        >
          <Text style={[styles.tabText, activeTab === 'scans' && styles.tabTextActive]}>Scans</Text>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'symptoms' && styles.tabActive]} 
          onPress={() => setActiveTab('symptoms')}
        >
          <Text style={[styles.tabText, activeTab === 'symptoms' && styles.tabTextActive]}>Symptoms</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'scans' ? (
          groups.map(group => (
            <View key={group.date} style={styles.group}>
              <View style={styles.dateHeader}>
                <Calendar size={14} color={Theme.colors.textTertiary} />
                <Text style={styles.dateText}>{group.date}</Text>
              </View>
              {group.scans.map((scan, i) => (
                <Pressable
                  key={scan.id}
                  style={({ pressed }) => [styles.scanCard, pressed && { opacity: 0.9 }]}
                  onPress={() => navigation.navigate('RecordDetail', { id: scan.id })}
                >
                  <View style={styles.scanLeft}>
                    <View style={styles.eyeCircle}>
                      <Eye size={18} color={Theme.colors.primary} />
                    </View>
                    <View>
                      <Text style={styles.scanEye}>
                        {scan.eyeSide === 'left' ? 'Left Eye' : 'Right Eye'}
                      </Text>
                      <Text style={styles.scanTime}>
                        {new Date(scan.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.scanRight}>
                    <RiskChip level={scan.analysis.riskLevel} />
                    <ChevronRight size={16} color={Theme.colors.textTertiary} />
                  </View>
                </Pressable>
              ))}
            </View>
          ))
        ) : (
          symptoms.map(log => (
            <View key={log.id} style={styles.symptomCard}>
              <View style={styles.symptomHeader}>
                <View style={[styles.sentimentDot, { backgroundColor: log.sentiment === 'negative' ? Theme.colors.error : Theme.colors.success }]} />
                <Text style={styles.symptomDate}>
                  {new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </Text>
                {log.painLevel > 0 && (
                  <View style={styles.painBadge}>
                    <Text style={styles.painText}>Pain {log.painLevel}/10</Text>
                  </View>
                )}
              </View>
              <Text style={styles.symptomDesc}>{log.description}</Text>
              <View style={styles.tagRow}>
                {log.symptoms.map(s => (
                  <View key={s} style={styles.tag}>
                    <Text style={styles.tagText}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.background },
  content: { padding: Theme.spacing.lg, gap: Theme.spacing.lg, paddingBottom: 40 },
  group: { gap: Theme.spacing.sm },
  dateHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 4 },
  dateText: { ...Theme.typography.label, color: Theme.colors.textTertiary },
  scanCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Theme.shadows.soft,
  },
  scanLeft: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  eyeCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.backgroundAlt,
    justifyContent: 'center', alignItems: 'center',
  },
  scanEye: { ...Theme.typography.bodyBold, color: Theme.colors.textPrimary },
  scanTime: { ...Theme.typography.captionSmall, color: Theme.colors.textTertiary },
  scanRight: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Theme.spacing.xl, gap: Theme.spacing.md },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Theme.colors.backgroundAlt, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { ...Theme.typography.h3, color: Theme.colors.textPrimary },
  emptyBody: { ...Theme.typography.body, color: Theme.colors.textSecondary, textAlign: 'center' },
  btn: { backgroundColor: Theme.colors.primary, borderRadius: Theme.borderRadius.md, paddingVertical: 14, paddingHorizontal: Theme.spacing.xl, marginTop: Theme.spacing.sm },
  btnText: { ...Theme.typography.bodyBold, color: '#fff' },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    gap: Theme.spacing.md,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: Theme.borderRadius.full,
    backgroundColor: Theme.colors.surfaceDim,
  },
  tabActive: {
    backgroundColor: Theme.colors.primary,
  },
  tabText: {
    ...Theme.typography.label,
    color: Theme.colors.textTertiary,
  },
  tabTextActive: {
    color: '#fff',
  },
  symptomCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    gap: Theme.spacing.sm,
    ...Theme.shadows.soft,
    marginBottom: Theme.spacing.md,
  },
  symptomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sentimentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  symptomDate: {
    ...Theme.typography.captionSmall,
    color: Theme.colors.textTertiary,
  },
  painBadge: {
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  painText: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.error,
  },
  symptomDesc: {
    ...Theme.typography.body,
    fontSize: 14,
    color: Theme.colors.textPrimary,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: Theme.colors.backgroundAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    color: Theme.colors.primary,
    fontWeight: '600',
  },
});
