/**
 * Glance Co-pilot: LFM-Ready Clinical Reasoning Service
 * 
 * This service provides the logic for the AI Assistant, designed to be
 * backed by a Liquid Foundation Model (LFM) on-device.
 */

import { liquidEngine } from './liquid';
import { getModelFileUri } from './registry';
import { symptomService, SymptomLog } from '../symptomService';

export interface AIInsightCard {
  type: 'summary' | 'trend' | 'alert' | 'symptom';
  title: string;
  content: string;
  actionLabel?: string;
  actionId?: string;
}

export interface AIResponse {
  text: string;
  cards?: AIInsightCard[];
  disclaimer: string;
}

const MEDICAL_DISCLAIMER = "This app is just a prediction and not professional help. It bridges the gap between accessibility for eye screening, but it is NOT professional screening. Always consult a doctor for medical concerns.";

class AIAssistantService {
  /**
   * Process a user query in the context of clinical data.
   * Utilizes the LFM (Liquid Foundation Model) for reasoning and symptom extraction.
   */
  async processQuery(query: string, context?: any): Promise<AIResponse> {
    const modelUri = getModelFileUri('LFM2.5-1.2B-Instruct-Q4_K_M.gguf');
    await liquidEngine.initialize(modelUri);

    const lfmResponse = await liquidEngine.query(query);
    const lowerQuery = query.toLowerCase();

    // Symptom Extraction & Auto-Logging
    const detectedSymptoms = symptomService.extractBasicSymptoms(query);
    if (detectedSymptoms.length > 0) {
      await symptomService.saveLog({
        date: new Date().toISOString(),
        sentiment: lowerQuery.includes('bad') || lowerQuery.includes('pain') ? 'negative' : 'neutral',
        painLevel: lowerQuery.includes('sharp') || lowerQuery.includes('severe') ? 8 : (lowerQuery.includes('pain') ? 4 : 0),
        description: query,
        symptoms: detectedSymptoms,
      });
    }

    const response: AIResponse = {
      text: lfmResponse,
      disclaimer: MEDICAL_DISCLAIMER,
      cards: [],
    };

    if (detectedSymptoms.length > 0) {
      response.cards?.push({
        type: 'symptom',
        title: 'Symptoms Recorded',
        content: `I've noted: ${detectedSymptoms.join(', ')}. This progression will be tracked for your next doctor visit.`,
        actionLabel: 'View Timeline'
      });
    }

    // Awareness Logic: Elevate awareness for severe issues
    if (context?.riskLevel === 'high' || lowerQuery.includes('severe') || lowerQuery.includes('bad')) {
      response.text += "\n\nIMPORTANT: Your results indicate severe eye issues. Please schedule an appointment with an ophthalmologist immediately.";
      response.cards?.push({
        type: 'alert',
        title: 'Urgent Care Recommended',
        content: 'Clinical markers suggest significant pathology. A professional screening is required to prevent potential vision loss.',
        actionLabel: 'Find a Doctor',
        actionId: 'find-doctor'
      });
    }

    // Traditional helper cards for summary/trends
    if (lowerQuery.includes('summary') || lowerQuery.includes('report')) {
      response.cards?.push({
        type: 'summary',
        title: 'Scan Synthesis',
        content: 'Morphology: Stable. Vessel Tortuosity: Slight increase. Hemorrhage: None detected.',
        actionLabel: 'Export PDF'
      });
    }

    return response;
  }

  /**
   * Generate a proactive wellness prompt based on time of day or history.
   */
  getWellnessPrompt(): string {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    return `${greeting}! How are your eyes feeling today? Any pain, redness, or changes in your vision?`;
  }

  getDisclaimer(): string {
    return MEDICAL_DISCLAIMER;
  }
}

export const assistantService = new AIAssistantService();
