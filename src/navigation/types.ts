import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

export type ScanStep = 'prepare' | 'capture' | 'review' | 'results';

export type AppStackParamList = {
  Onboarding: undefined;
  MainTabs: undefined;
  ScanFlow: { initialStep?: ScanStep };
  RecordDetail: { id: string };
};

export type AppTabParamList = {
  Home: undefined;
  Scan: undefined;
  History: undefined;
  Profile: undefined;
  GlanceHelper: { initialMessage?: string };
};

export type AppNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList>,
  StackNavigationProp<AppStackParamList>
>;