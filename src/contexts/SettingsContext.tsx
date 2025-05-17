
"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { AppSettings, DayOfWeek, HourlyAllowance, ScheduledBreak } from '@/types';
import { getFromLocalStorage, setToLocalStorage } from '@/lib/localStorage';
import { ALL_DAYS } from '@/types';

const SETTINGS_STORAGE_KEY = 'wageWiseSettings';

const defaultDayAllowances: Record<DayOfWeek, number> = ALL_DAYS.reduce((acc, day) => {
  acc[day] = 100; // Default to 100% for all days
  return acc;
}, {} as Record<DayOfWeek, number>);


const defaultSettings: AppSettings = {
  baseWage: 10.0,
  dayAllowances: defaultDayAllowances,
  hourlyAllowances: [],
  scheduledBreaks: [],
};

interface SettingsContextType {
  settings: AppSettings;
  updateBaseWage: (wage: number) => void;
  updateDayAllowances: (allowances: Record<DayOfWeek, number>) => void;
  addHourlyAllowance: (allowance: Omit<HourlyAllowance, 'id'>) => void;
  updateHourlyAllowance: (allowance: HourlyAllowance) => void;
  removeHourlyAllowance: (id: string) => void;
  replaceAllScheduledBreaks: (breaks: Array<Omit<ScheduledBreak, 'id'>>) => void; // New
  addScheduledBreak: (sBreak: Omit<ScheduledBreak, 'id'>) => void; // Kept for potential other uses, but BreakSettings will use replaceAll
  updateScheduledBreak: (sBreak: ScheduledBreak) => void; // Kept for potential other uses
  removeScheduledBreak: (id: string) => void; // Kept for potential other uses
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedSettings = getFromLocalStorage<AppSettings>(SETTINGS_STORAGE_KEY, defaultSettings);
    setSettings(storedSettings);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setToLocalStorage(SETTINGS_STORAGE_KEY, settings);
    }
  }, [settings, isLoading]);

  const updateBaseWage = (wage: number) => {
    setSettings(prev => ({ ...prev, baseWage: wage }));
  };

  const updateDayAllowances = (allowances: Record<DayOfWeek, number>) => {
    setSettings(prev => ({ ...prev, dayAllowances: allowances }));
  };

  const addHourlyAllowance = (allowance: Omit<HourlyAllowance, 'id'>) => {
    setSettings(prev => ({
      ...prev,
      hourlyAllowances: [...prev.hourlyAllowances, { ...allowance, id: Date.now().toString() }],
    }));
  };

  const updateHourlyAllowance = (updatedAllowance: HourlyAllowance) => {
    setSettings(prev => ({
      ...prev,
      hourlyAllowances: prev.hourlyAllowances.map(ha => ha.id === updatedAllowance.id ? updatedAllowance : ha),
    }));
  };

  const removeHourlyAllowance = (id: string) => {
    setSettings(prev => ({
      ...prev,
      hourlyAllowances: prev.hourlyAllowances.filter(ha => ha.id !== id),
    }));
  };
  
  const replaceAllScheduledBreaks = (newBreaksData: Array<Omit<ScheduledBreak, 'id'>>) => {
    const newScheduledBreaks = newBreaksData.map(b => ({
      ...b,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9), // More unique ID
    }));
    setSettings(prev => ({
      ...prev,
      scheduledBreaks: newScheduledBreaks,
    }));
  };

  // Kept for backward compatibility or other potential direct uses, though replaceAllScheduledBreaks is preferred from form.
  const addScheduledBreak = (sBreak: Omit<ScheduledBreak, 'id'>) => {
    setSettings(prev => ({
      ...prev,
      scheduledBreaks: [...prev.scheduledBreaks, { ...sBreak, id: Date.now().toString() }],
    }));
  };

  const updateScheduledBreak = (updatedBreak: ScheduledBreak) => {
    setSettings(prev => ({
      ...prev,
      scheduledBreaks: prev.scheduledBreaks.map(sb => sb.id === updatedBreak.id ? updatedBreak : sb),
    }));
  };

  const removeScheduledBreak = (id: string) => {
    setSettings(prev => ({
      ...prev,
      scheduledBreaks: prev.scheduledBreaks.filter(sb => sb.id !== id),
    }));
  };

  return (
    <SettingsContext.Provider value={{ 
      settings, 
      updateBaseWage, 
      updateDayAllowances,
      addHourlyAllowance,
      updateHourlyAllowance,
      removeHourlyAllowance,
      replaceAllScheduledBreaks,
      addScheduledBreak,
      updateScheduledBreak,
      removeScheduledBreak,
      isLoading 
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
