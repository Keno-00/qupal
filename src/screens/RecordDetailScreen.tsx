import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { ChevronLeft, Share2, Eye } from 'lucide-react-native';

import { Theme } from '../theme/theme';
import { RiskBadge } from '../components/RiskBadge';
import { AnimatedProgressBar } from '../components/AnimatedProgressBar';
import type { AppStackParamList } from '../navigation/types';

const STORAGE_KEY = 'glance_scans_v1';

type NavProp = StackNavigationProp<AppStackParamList, 'RecordDetail'>;
type RoutePropType = RouteProp<AppStackParamList, 'RecordDetail'>;

type ScanRecord = {
  id: string;
  eyeSide: 'left' | 'right';
  capturedAt: string;
  rawUri: string;
  aiProcessedUri: string;
  analysis: {
    riskLevel: 'low' | 'medium' | 'high';
    diabeticRetinopathy: number;
    glaucomaSigns: number;
    hypertensionRetinopathy: number | null;
  };
};

async function uriToDataUri(uri: string): Promise<string | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/jpeg;base64,${b64}`;
  } catch { return null; }
}

export default function RecordDetailScreen() {
  const navigation = useNavigation<NavProp>();
  const { params } = useRoute<RoutePropType>();
  const [record, setRecord] = useState<ScanRecord | null>(null);

  useEffect(() => {
    const load = async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const all: ScanRecord[] = JSON.parse(raw);
        setRecord(all.find(r => r.id === params.id) ?? null);
      }
    };
    void load();
  }, [params.id]);

  const exportPdf = async () => {
    if (!record) return;
    const imgData = await uriToDataUri(record.aiProcessedUri);
    const html = `<html><body style="font-family:sans-serif;padding:20px;color:#0f172a">
      <h2>Eye Health Report</h2>
      <p><b>Date:</b> ${new Date(record.capturedAt).toLocaleString()}</p>
      <p><b>Eye:</b> ${record.eyeSide === 'left' ? 'Left' : 'Right'}</p>
      <p><b>Result:</b> ${record.analysis.riskLevel === 'low' ? 'All Clear' : record.analysis.riskLevel === 'medium' ? 'Keep Watch' : 'See a Doctor'}</p>
      ${imgData ? `<img src="${imgData}" style="width:100%;max-height:340px;object-fit:contain;margin-top:16px;border-radius:8px"/>` : ''}
      <hr/><p style="font-size:12px;color:#64748b">Informational only. Not a medical diagnosis.</p>
    </body></html>`;
    try {
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share report' });
      }
    } catch { Alert.alert('Error', 'Could not generate report.'); }
  };

  if (!record) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.topBar}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ChevronLeft size={22} color={Theme.colors.textPrimary} />
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: Theme.colors.textSecondary }}>Scan not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { analysis } = record;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={22} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>Scan Details</Text>
        <Pressable onPress={exportPdf} style={styles.shareBtn}>
          <Share2 size={18} color={Theme.colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Meta */}
        <View style={styles.metaRow}>
          <View style={styles.eyeCircle}>
            <Eye size={20} color={Theme.colors.primary} />
          </View>
          <View>
            <Text style={styles.eyeLabel}>{record.eyeSide === 'left' ? 'Left Eye' : 'Right Eye'}</Text>
            <Text style={styles.dateLabel}>
              {new Date(record.capturedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              {' · '}
              {new Date(record.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>

        {/* Result */}
        <RiskBadge level={analysis.riskLevel} large />

        {/* Image */}
        {record.aiProcessedUri ? (
          <View style={styles.imageWrap}>
            <Image source={{ uri: record.aiProcessedUri }} style={styles.image} resizeMode="cover" />
          </View>
        ) : null}

        {/* Indicators */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Indicators</Text>
          <View style={styles.bars}>
            <AnimatedProgressBar
              label="Diabetic Retinopathy"
              progress={analysis.diabeticRetinopathy}
              showPercent
              color={analysis.diabeticRetinopathy > 0.5 ? Theme.colors.error : Theme.colors.success}
            />
            <AnimatedProgressBar
              label="Glaucoma"
              progress={analysis.glaucomaSigns}
              showPercent
              color={analysis.glaucomaSigns > 0.5 ? Theme.colors.error : Theme.colors.success}
            />
            {analysis.hypertensionRetinopathy !== null && (
              <AnimatedProgressBar
                label="Hypertensive Changes"
                progress={analysis.hypertensionRetinopathy}
                showPercent
                color={analysis.hypertensionRetinopathy > 0.5 ? Theme.colors.warning : Theme.colors.success}
              />
            )}
          </View>
          <Text style={styles.disclaimer}>
            These are probability scores, not diagnoses. Always consult a doctor.
          </Text>
        </View>

        <Pressable style={styles.exportBtn} onPress={exportPdf}>
          <Share2 size={18} color="#fff" />
          <Text style={styles.exportBtnText}>Share with Doctor</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Theme.spacing.lg, paddingVertical: Theme.spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.colors.surface, justifyContent: 'center', alignItems: 'center', ...Theme.shadows.soft },
  topTitle: { ...Theme.typography.bodyBold, color: Theme.colors.textPrimary },
  shareBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.colors.surface, justifyContent: 'center', alignItems: 'center', ...Theme.shadows.soft },
  content: { padding: Theme.spacing.lg, gap: Theme.spacing.lg, paddingBottom: 48 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  eyeCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Theme.colors.backgroundAlt, justifyContent: 'center', alignItems: 'center' },
  eyeLabel: { ...Theme.typography.bodyBold, color: Theme.colors.textPrimary },
  dateLabel: { ...Theme.typography.captionSmall, color: Theme.colors.textTertiary },
  imageWrap: { borderRadius: Theme.borderRadius.xl, overflow: 'hidden', aspectRatio: 1, backgroundColor: '#000' },
  image: { width: '100%', height: '100%' },
  card: { backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.xl, padding: Theme.spacing.lg, gap: Theme.spacing.md, ...Theme.shadows.soft },
  cardTitle: { ...Theme.typography.bodyBold, color: Theme.colors.textPrimary },
  bars: { gap: Theme.spacing.md },
  disclaimer: { ...Theme.typography.captionSmall, color: Theme.colors.textTertiary, lineHeight: 18 },
  exportBtn: { backgroundColor: Theme.colors.primary, borderRadius: Theme.borderRadius.md, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...Theme.shadows.medium },
  exportBtnText: { ...Theme.typography.bodyBold, color: '#fff' },
});
