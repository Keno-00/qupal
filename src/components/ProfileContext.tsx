import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILE_KEY = 'glance_profile_v1';

export interface UserProfile {
  firstName: string;
  dateOfBirth: string;       // ISO date string, e.g. "1990-05-14"
  hasEyeCondition: boolean;
  conditionDescription: string;
}

interface ProfileContextValue {
  profile: UserProfile | null;
  isLoading: boolean;
  saveProfile: (p: UserProfile) => Promise<void>;
  clearProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  isLoading: true,
  saveProfile: async () => {},
  clearProfile: async () => {},
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(PROFILE_KEY);
        if (raw) {
          setProfile(JSON.parse(raw) as UserProfile);
        }
      } catch {
        // No profile yet
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const saveProfile = async (p: UserProfile) => {
    setProfile(p);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  };

  const clearProfile = async () => {
    setProfile(null);
    await AsyncStorage.removeItem(PROFILE_KEY);
  };

  return (
    <ProfileContext.Provider value={{ profile, isLoading, saveProfile, clearProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
