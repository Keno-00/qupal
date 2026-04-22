import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import { Home, Camera, Clock, User, Sparkles } from 'lucide-react-native';

import { Theme } from './src/theme/theme';
import { ProfileProvider, useProfile } from './src/components/ProfileContext';

import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import ScanFlowScreen from './src/screens/ScanFlowScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import RecordDetailScreen from './src/screens/RecordDetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import GlanceHelperScreen from './src/screens/GlanceHelperScreen';

import type { AppStackParamList, AppTabParamList } from './src/navigation/types';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createStackNavigator<AppStackParamList>();

const NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Theme.colors.background,
    primary: Theme.colors.primary,
    card: Theme.colors.surface,
    text: Theme.colors.textPrimary,
    border: Theme.colors.borderLight,
  },
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        headerStyle: {
          backgroundColor: Theme.colors.surface,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: Theme.colors.borderLight,
        },
        headerTitleStyle: {
          ...Theme.typography.bodyBold,
          color: Theme.colors.textPrimary,
          fontSize: 17,
        },
        tabBarStyle: {
          backgroundColor: Theme.colors.surface,
          borderTopWidth: 1,
          borderTopColor: Theme.colors.borderLight,
          height: 68,
          paddingBottom: 12,
          paddingTop: 10,
        },
        tabBarActiveTintColor: Theme.colors.primary,
        tabBarInactiveTintColor: Theme.colors.textTertiary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          headerTitle: 'glance',
          headerTitleStyle: {
            ...Theme.typography.h3,
            color: Theme.colors.primary,
            letterSpacing: -0.5,
          },
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
          tabBarLabel: 'Home',
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanFlowScreen}
        options={{
          headerTitle: 'New Scan',
          tabBarIcon: ({ color, size }) => <Camera color={color} size={size} />,
          tabBarLabel: 'Scan',
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          headerTitle: 'My Scans',
          tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
          tabBarLabel: 'History',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          headerTitle: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          tabBarLabel: 'Profile',
        }}
      />
      <Tab.Screen
        name="GlanceHelper"
        component={GlanceHelperScreen}
        options={{
          headerTitle: 'Glance Assistant',
          tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
          tabBarLabel: 'Assistant',
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { profile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashLogo}>glance</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!profile ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : null}
      <Stack.Screen name="MainTabs" component={TabNavigator} />
      <Stack.Screen
        name="ScanFlow"
        component={ScanFlowScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RecordDetail"
        component={RecordDetailScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ProfileProvider>
          <NavigationContainer theme={NAV_THEME}>
            <StatusBar style="dark" />
            <AppNavigator />
          </NavigationContainer>
        </ProfileProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: Theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    ...Theme.typography.h1,
    color: Theme.colors.primary,
    letterSpacing: -1,
  },
});
