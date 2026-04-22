import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SymptomLog {
  id: string;
  date: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  painLevel: number; // 0-10
  description: string;
  symptoms: string[];
}

const STORAGE_KEY = 'glance_symptoms_v1';

class SymptomService {
  async saveLog(log: Omit<SymptomLog, 'id'>): Promise<SymptomLog> {
    const newLog: SymptomLog = {
      ...log,
      id: Date.now().toString(),
    };

    const existingLogs = await this.getLogs();
    const updatedLogs = [newLog, ...existingLogs];
    
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
    return newLog;
  }

  async getLogs(): Promise<SymptomLog[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as SymptomLog[];
      }
    } catch (e) {
      console.error('Failed to load symptom logs', e);
    }
    return [];
  }

  async getLatestLog(): Promise<SymptomLog | null> {
    const logs = await this.getLogs();
    return logs.length > 0 ? logs[0] : null;
  }

  /**
   * Helper to extract symptoms from text using basic keywords
   * (The LFM model will do the heavy lifting in the assistant service)
   */
  extractBasicSymptoms(text: string): string[] {
    const keywords = ['pain', 'blurry', 'blurriness', 'redness', 'itchy', 'burning', 'dry', 'floaters', 'flashes', 'shadows'];
    const lower = text.toLowerCase();
    return keywords.filter(k => lower.includes(k));
  }
}

export const symptomService = new SymptomService();
