import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { Eye, Send, AlertTriangle, ChevronRight, Share2, TrendingUp } from 'lucide-react-native';
import { Theme } from '../theme/theme';
import { assistantService, AIInsightCard } from '../services/ai/assistant';
import { Card } from '../components/Card';

import { RouteProp, useRoute } from '@react-navigation/native';
import { AppTabParamList } from '../navigation/types';

interface Message {
  id: string;
  type: 'bot' | 'user';
  text: string;
  cards?: AIInsightCard[];
}

export default function GlanceHelperScreen() {
  const route = useRoute<RouteProp<AppTabParamList, 'GlanceHelper'>>();
  const initialMessage = route.params?.initialMessage;

  const [messages, setMessages] = useState<Message[]>(() => {
    const msgs: Message[] = [{
      id: '0',
      type: 'bot',
      text: "Hi! I'm your Glance clinical assistant. Ask me anything about your eye health or your scan results.",
    }];
    if (initialMessage) {
      msgs.push({ id: 'initial', type: 'user', text: initialMessage });
    }
    return msgs;
  });

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (initialMessage && messages.length === 2 && messages[1].id === 'initial') {
      void processInitial();
    }
  }, []);

  const processInitial = async () => {
    setIsTyping(true);
    try {
      const res = await assistantService.processQuery(initialMessage!);
      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        type: 'bot', 
        text: res.text,
        cards: res.cards
      }]);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', text: 'Something went wrong.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    const userMsg: Message = { id: Date.now().toString(), type: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    try {
      const res = await assistantService.processQuery(text);
      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        type: 'bot', 
        text: res.text,
        cards: res.cards
      }]);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [messages]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
      style={styles.root}
    >
      <View style={styles.disclaimerBar}>
        <AlertTriangle size={14} color={Theme.colors.warning} />
        <Text style={styles.disclaimerText}>
          {assistantService.getDisclaimer()}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.modelNote}>Powered by LFM 2.5 · On-device reasoning</Text>
        
        {messages.map(msg => (
          <View key={msg.id} style={[styles.msgWrap, msg.type === 'user' ? styles.userWrap : styles.botWrap]}>
            {msg.type === 'bot' && (
              <View style={styles.botAvatar}>
                <Eye size={14} color="#fff" />
              </View>
            )}
            <View style={styles.bubbleContainer}>
              <Card variant={msg.type === 'bot' ? 'glass' : 'elevated'} style={[styles.bubble, msg.type === 'user' ? styles.userBubble : styles.botBubble]}>
                <Text style={[styles.bubbleText, msg.type === 'user' && { color: '#fff' }]}>{msg.text}</Text>
              </Card>

              {msg.cards?.map((card, idx) => (
                <Card key={idx} variant="elevated" style={styles.insightCard}>
                  <View style={styles.cardHeader}>
                    {card.type === 'alert' ? <AlertTriangle size={16} color={Theme.colors.error} /> : 
                     card.type === 'trend' ? <TrendingUp size={16} color={Theme.colors.info} /> :
                     <Share2 size={16} color={Theme.colors.primary} />}
                    <Text style={styles.cardTitle}>{card.title}</Text>
                  </View>
                  <Text style={styles.cardContent}>{card.content}</Text>
                  {card.actionLabel && (
                    <Pressable style={styles.cardAction}>
                      <Text style={styles.cardActionText}>{card.actionLabel}</Text>
                      <ChevronRight size={14} color={Theme.colors.primary} />
                    </Pressable>
                  )}
                </Card>
              ))}
            </View>
          </View>
        ))}
        
        {isTyping && (
          <View style={[styles.msgWrap, styles.botWrap]}>
            <View style={styles.botAvatar}><Eye size={14} color="#fff" /></View>
            <Card variant="glass" style={[styles.bubble, styles.botBubble]}>
              <Text style={[styles.bubbleText, { color: Theme.colors.textTertiary, fontStyle: 'italic' }]}>Analyzing markers…</Text>
            </Card>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your scan results…"
          placeholderTextColor={Theme.colors.textTertiary}
          multiline
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <Pressable style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]} onPress={send} disabled={!input.trim()}>
          <Send size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.background },
  disclaimerBar: {
    flexDirection: 'row', gap: 10,
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
    padding: Theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: 'rgba(217, 119, 6, 0.1)',
  },
  disclaimerText: { ...Theme.typography.captionSmall, color: Theme.colors.warning, flex: 1, lineHeight: 16 },
  chat: { flex: 1 },
  chatContent: { padding: Theme.spacing.lg, gap: Theme.spacing.lg, paddingBottom: 24 },
  modelNote: { ...Theme.typography.captionSmall, color: Theme.colors.textTertiary, textAlign: 'center', marginBottom: Theme.spacing.sm },
  msgWrap: { flexDirection: 'row', gap: 10, maxWidth: '90%' },
  userWrap: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  botWrap: { alignSelf: 'flex-start' },
  botAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: Theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  bubbleContainer: { gap: 8, flex: 1 },
  bubble: { borderRadius: Theme.borderRadius.lg, padding: Theme.spacing.md },
  userBubble: { backgroundColor: Theme.colors.primary, borderBottomRightRadius: 4 },
  botBubble: { borderBottomLeftRadius: 4 },
  bubbleText: { ...Theme.typography.body, fontSize: 15, color: Theme.colors.textPrimary },
  
  insightCard: { marginTop: 4, padding: Theme.spacing.md, gap: 8, ...Theme.shadows.soft },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { ...Theme.typography.bodyBold, fontSize: 14, color: Theme.colors.textPrimary },
  cardContent: { ...Theme.typography.caption, color: Theme.colors.textSecondary, lineHeight: 18 },
  cardAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardActionText: { ...Theme.typography.label, color: Theme.colors.primary, fontSize: 11 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
    backgroundColor: Theme.colors.surface,
    borderTopWidth: 1, borderTopColor: Theme.colors.borderLight,
    paddingBottom: Platform.OS === 'ios' ? 28 : Theme.spacing.md,
  },
  input: {
    flex: 1, ...Theme.typography.body, maxHeight: 100,
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.borderRadius.xl,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 10,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    color: Theme.colors.textPrimary,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: Theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
