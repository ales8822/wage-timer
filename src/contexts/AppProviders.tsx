"use client";

import type { ReactNode } from 'react';
import { SettingsProvider } from './SettingsContext';
import { WorkHistoryProvider } from './WorkHistoryContext';
import { TimerProvider } from './TimerContext';

export const AppProviders = ({ children }: { children: ReactNode }) => {
  return (
    <SettingsProvider>
      <WorkHistoryProvider>
        <TimerProvider>
          {children}
        </TimerProvider>
      </WorkHistoryProvider>
    </SettingsProvider>
  );
};
