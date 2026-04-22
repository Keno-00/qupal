import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, Shield, Trash2, ChevronRight } from 'lucide-react-native';

import { Theme } from '../theme/theme';
import { useProfile } from '../components/ProfileContext';

const STORAGE_KEY = 'glance_scans_v1';

export default function ProfileScreen() {
  const { profile, saveProfile, clearProfile } = useProfile();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth ?? '');
  const [hasCondition, setHasCondition] = useState(profile?.hasEyeCondition ?? false);
  const [conditionDesc, setConditionDesc] = useState(profile?.conditionDescription ?? '');
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [showPicker, setShowPicker] = useState(false);


  const saveEdits = async () => {
    await saveProfile({
      firstName: (firstName.trim() || profile?.firstName) ?? '',
      dateOfBirth,
      hasEyeCondition: hasCondition,
      conditionDescription: hasCondition ? conditionDesc.trim() : '',
    });
    setEditing(false);
  };

  const clearAllData = () => {
    Alert.alert('Clear all data', 'This will permanently delete all your scans and profile.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          await clearProfile();
        }
      },
    ]);
  };

  const initials = (profile?.firstName ?? '?').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{profile?.firstName ?? 'You'}</Text>
          {profile?.dateOfBirth ? (
            <Text style={styles.dob}>
              {new Date(profile.dateOfBirth).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          ) : null}

        </View>

        {/* Profile card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <User size={18} color={Theme.colors.primary} />
              <Text style={styles.cardTitle}>Your Profile</Text>
            </View>
            <Pressable onPress={() => editing ? saveEdits() : setEditing(true)}>
              <Text style={styles.editBtn}>{editing ? 'Save' : 'Edit'}</Text>
            </Pressable>
          </View>

          {editing ? (
            <View style={styles.fields}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>First name</Text>
                <TextInput style={styles.input} value={firstName} onChangeText={setFirstName}
                  placeholderTextColor={Theme.colors.textTertiary} />
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
                      setShowPicker(Platform.OS === 'ios');
                      if (selectedDate) {
                        setDateOfBirth(selectedDate.toISOString().split('T')[0]);
                      }
                      if (Platform.OS === 'android') setShowPicker(false);
                    }}
                    maximumDate={new Date()}
                  />
                )}
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.fieldLabel}>Eye condition</Text>
                <Switch value={hasCondition} onValueChange={setHasCondition}
                  trackColor={{ false: Theme.colors.borderLight, true: Theme.colors.primaryLight }}
                  thumbColor={hasCondition ? Theme.colors.primary : Theme.colors.surface} />
              </View>
              {hasCondition && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Condition</Text>
                  <TextInput style={styles.input} value={conditionDesc} onChangeText={setConditionDesc}
                    placeholderTextColor={Theme.colors.textTertiary} />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.fields}>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Name</Text>
                <Text style={styles.infoValue}>{profile?.firstName ?? '—'}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Date of birth</Text>
                <Text style={styles.infoValue}>
                  {profile?.dateOfBirth 
                    ? new Date(profile.dateOfBirth).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) 
                    : '—'}
                </Text>
              </View>

              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Eye condition</Text>
                <Text style={styles.infoValue}>
                  {profile?.hasEyeCondition ? (profile?.conditionDescription || 'Yes') : 'None'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Preferences */}
        <View style={styles.card}>
          <View style={styles.cardHeaderLeft}>
            <Shield size={18} color={Theme.colors.primary} />
            <Text style={styles.cardTitle}>Preferences</Text>
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>Animations</Text>
            <Switch value={motionEnabled} onValueChange={setMotionEnabled}
              trackColor={{ false: Theme.colors.borderLight, true: Theme.colors.primaryLight }}
              thumbColor={motionEnabled ? Theme.colors.primary : Theme.colors.surface} />
          </View>
        </View>

        {/* Danger */}
        <Pressable style={styles.dangerBtn} onPress={clearAllData}>
          <Trash2 size={18} color={Theme.colors.error} />
          <Text style={styles.dangerText}>Clear all data</Text>
        </Pressable>

        <Text style={styles.version}>Glance · On-device eye health monitoring</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.background },
  content: { padding: Theme.spacing.lg, gap: Theme.spacing.lg, paddingBottom: 48 },
  avatarSection: { alignItems: 'center', gap: Theme.spacing.sm, paddingVertical: Theme.spacing.lg },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: Theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
  avatarText: { ...Theme.typography.h2, color: '#fff' },
  name: { ...Theme.typography.h3, color: Theme.colors.textPrimary },
  dob: { ...Theme.typography.caption, color: Theme.colors.textTertiary },
  card: { backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.xl, padding: Theme.spacing.lg, gap: Theme.spacing.md, ...Theme.shadows.soft },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { ...Theme.typography.bodyBold, color: Theme.colors.textPrimary },
  editBtn: { ...Theme.typography.bodyBold, color: Theme.colors.primary },
  fields: { gap: Theme.spacing.sm },
  fieldGroup: { gap: 6 },
  fieldLabel: { ...Theme.typography.label, color: Theme.colors.textTertiary },
  input: { ...Theme.typography.body, borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: Theme.borderRadius.md, paddingHorizontal: Theme.spacing.md, paddingVertical: 12, color: Theme.colors.textPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  infoKey: { ...Theme.typography.caption, color: Theme.colors.textTertiary },
  infoValue: { ...Theme.typography.bodyBold, color: Theme.colors.textPrimary },
  divider: { height: 1, backgroundColor: Theme.colors.borderLight },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: Theme.spacing.md, borderWidth: 1.5, borderColor: '#fca5a5', borderRadius: Theme.borderRadius.lg, backgroundColor: '#fff1f2' },
  dangerText: { ...Theme.typography.bodyBold, color: Theme.colors.error },
  version: { ...Theme.typography.captionSmall, color: Theme.colors.textTertiary, textAlign: 'center', paddingBottom: Theme.spacing.md },
});
