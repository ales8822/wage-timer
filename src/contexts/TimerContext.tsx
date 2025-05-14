
"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Shift, BreakRecord, AppSettings } from '@/types'; // AppSettings might not be directly used here but good for context
import { useSettings } from './SettingsContext';
import { useWorkHistory } from './WorkHistoryContext';
import { calculateShiftEarnings } from '@/lib/wageCalculator';
import { useToast } from '@/hooks/use-toast';
import { getFromLocalStorage, setToLocalStorage } from '@/lib/localStorage';

type TimerStatus = 'idle' | 'working' | 'on_break';

interface TimerContextType {
  status: TimerStatus;
  currentShift: Partial<Shift> | null;
  elapsedWorkTime: number; // in seconds
  elapsedBreakTime: number; // in seconds
  currentEarnings: number;
  effectiveHourlyRate: number;
  startShift: () => void;
  endShift: () => void;
  startBreak: () => void;
  endBreak: () => void;
  resetActiveShift: () => void;
  isLoading: boolean; // To indicate if restoring state
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

const ACTIVE_SHIFT_STORAGE_KEY = 'wageWiseActiveShift';
const ACTIVE_STATUS_STORAGE_KEY = 'wageWiseActiveStatus';

export const TimerProvider = ({ children }: { children: ReactNode }) => {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { addShift } = useWorkHistory();
  const { toast } = useToast();

  const [status, setStatus] = useState<TimerStatus>('idle');
  const [currentShift, setCurrentShift] = useState<Partial<Shift> | null>(null);
  const [elapsedWorkTime, setElapsedWorkTime] = useState(0); // in seconds
  const [elapsedBreakTime, setElapsedBreakTime] = useState(0); // in seconds
  const [currentEarnings, setCurrentEarnings] = useState(0);
  const [effectiveHourlyRate, setEffectiveHourlyRate] = useState(0);
  const [isLoading, setIsLoading] = useState(true); // For restoring state

  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);

  // Effect to load persisted state on mount
  useEffect(() => {
    if (settingsLoading) return; // Wait for settings to load

    const persistedShift = getFromLocalStorage<Partial<Shift> | null>(ACTIVE_SHIFT_STORAGE_KEY, null);
    const persistedStatus = getFromLocalStorage<TimerStatus | null>(ACTIVE_STATUS_STORAGE_KEY, null);

    if (persistedShift && persistedShift.startTime && persistedStatus && persistedStatus !== 'idle') {
      setCurrentShift(persistedShift);
      setStatus(persistedStatus);
      // Initial calculation will be triggered by the status/currentShift change in the other useEffect
    }
    setIsLoading(false);
  }, [settingsLoading]);

  // Effect to save state to localStorage
  useEffect(() => {
    if (!isLoading && !settingsLoading) { // Only save after initial load and settings are ready
      if (status !== 'idle' && currentShift) {
        setToLocalStorage(ACTIVE_SHIFT_STORAGE_KEY, currentShift);
        setToLocalStorage(ACTIVE_STATUS_STORAGE_KEY, status);
      } else {
        localStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
        localStorage.removeItem(ACTIVE_STATUS_STORAGE_KEY);
      }
    }
  }, [currentShift, status, isLoading, settingsLoading]);


  const calculateCurrentEarningsAndRate = useCallback(() => {
    if (isLoading || settingsLoading) return; // Don't calculate if still loading

    if (currentShift?.startTime && settings) {
      const now = Date.now();
      let tempShift: Shift = {
        id: currentShift.id || 'temp',
        startTime: currentShift.startTime,
        endTime: now, // Use current time for live calculation
        breaks: currentShift.breaks || [],
        baseWageAtStart: currentShift.baseWageAtStart || settings.baseWage,
      };

      if (status === 'working' || status === 'on_break') { // Ensure calculation happens if there's an active shift
        const { totalEarnings, finalEffectiveRate } = calculateShiftEarnings(tempShift, settings, true);
        setCurrentEarnings(totalEarnings);
        setEffectiveHourlyRate(finalEffectiveRate);
      }


      // Update elapsed work time considering breaks
      let totalBreakDurationMs = 0;
      (currentShift.breaks || []).forEach(br => {
        const breakStartTime = br.startTime;
        const breakEndTime = br.endTime || ( (status === 'on_break' && br.startTime === currentShift.breaks?.[currentShift.breaks.length - 1]?.startTime) ? now : 0 );
        if (breakEndTime > breakStartTime) {
             totalBreakDurationMs += breakEndTime - breakStartTime;
        }
      });

      const grossWorkTimeMs = now - currentShift.startTime;
      setElapsedWorkTime(Math.max(0, Math.floor((grossWorkTimeMs - totalBreakDurationMs) / 1000)));
      
      // Update elapsed break time if currently on break
      if (status === 'on_break') {
        const activeBreak = currentShift.breaks?.find(b => !b.endTime);
        if (activeBreak) {
          setElapsedBreakTime(Math.floor((now - activeBreak.startTime) / 1000));
        }
      } else {
        // If not on break, sum up completed break durations for display or ensure it's 0 if no active break
         const currentTotalBreakTimeSeconds = Math.floor(totalBreakDurationMs / 1000);
         // setElapsedBreakTime(currentTotalBreakTimeSeconds); // This could show total break time for the shift
         // Or keep it focused on the *current* break's elapsed time, which is 0 if not on break.
         // For now, if not 'on_break', elapsedBreakTime should represent the current segment, which is 0.
         // If we want to show total break time for the shift, that's a different state variable.
         // Let's ensure it resets if not actively on break.
         if (status !== 'on_break') setElapsedBreakTime(0);
      }
    }
  }, [status, currentShift, settings, isLoading, settingsLoading]);


  useEffect(() => {
    if (isLoading || settingsLoading) return; // Don't start interval if loading

    if (status === 'working' || status === 'on_break') {
      // Call immediately to update state correctly after restoration or status change
      calculateCurrentEarningsAndRate();
      const interval = setInterval(() => {
        calculateCurrentEarningsAndRate();
      }, 1000);
      setTimerInterval(interval);
      return () => clearInterval(interval);
    } else {
      if (timerInterval) clearInterval(timerInterval);
      setTimerInterval(null);
      // If idle, ensure times and earnings are reset if no shift was restored or if it just ended
      if (!currentShift) {
        setElapsedWorkTime(0);
        setElapsedBreakTime(0);
        setCurrentEarnings(0);
        setEffectiveHourlyRate(0);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isLoading, settingsLoading, calculateCurrentEarningsAndRate]); // currentShift removed to avoid re-triggering interval on every earnings update

  const startShift = () => {
    if (status !== 'idle' || isLoading || settingsLoading) return;
    const newShift: Partial<Shift> = {
      id: `shift_${Date.now()}`,
      startTime: Date.now(),
      breaks: [],
      baseWageAtStart: settings.baseWage,
    };
    setCurrentShift(newShift);
    setStatus('working');
    setElapsedWorkTime(0);
    setElapsedBreakTime(0);
    setCurrentEarnings(0);
    // Effective rate will be calculated by the interval
    toast({ title: "Shift Started", description: "Your work shift has begun." });
  };

  const endShift = () => {
    if ((status !== 'working' && status !== 'on_break') || !currentShift || !currentShift.startTime || isLoading || settingsLoading) return;

    let finalShift = { ...currentShift } as Shift;
    finalShift.endTime = Date.now();
    finalShift.baseWageAtStart = finalShift.baseWageAtStart || settings.baseWage; // Ensure base wage is set

    if (status === 'on_break' && finalShift.breaks.length > 0) {
      const lastBreak = finalShift.breaks[finalShift.breaks.length - 1];
      if (!lastBreak.endTime) {
        lastBreak.endTime = Date.now();
      }
    }
    
    const { totalEarnings } = calculateShiftEarnings(finalShift, settings, false);
    finalShift.totalEarnings = totalEarnings;

    addShift(finalShift);
    setStatus('idle');
    setCurrentShift(null); // This will trigger localStorage removal
    // Resetting values immediately, though interval clear also handles some
    setElapsedWorkTime(0);
    setElapsedBreakTime(0);
    setCurrentEarnings(0);
    setEffectiveHourlyRate(0);
    toast({ title: "Shift Ended", description: `Earnings: €${totalEarnings.toFixed(2)}.` });
  };

  const startBreak = () => {
    if (status !== 'working' || !currentShift || isLoading || settingsLoading) return;
    const newBreak: BreakRecord = { startTime: Date.now(), isScheduled: false };
    setCurrentShift(prev => ({ ...prev, breaks: [...(prev?.breaks || []), newBreak] }));
    setStatus('on_break');
    setElapsedBreakTime(0); // Reset current break timer
    toast({ title: "Break Started", description: "Enjoy your break!" });
  };

  const endBreak = () => {
    if (status !== 'on_break' || !currentShift || !currentShift.breaks?.length || isLoading || settingsLoading) return;
    const updatedBreaks = currentShift.breaks.map((br, index) => 
      index === currentShift.breaks!.length - 1 ? { ...br, endTime: Date.now() } : br
    );
    setCurrentShift(prev => ({ ...prev, breaks: updatedBreaks }));
    setStatus('working');
    // Elapsed break time will stop updating for the current segment.
    // calculateCurrentEarningsAndRate will be called by the main interval effect.
    toast({ title: "Break Ended", description: "Back to work!" });
  };

  const resetActiveShift = () => {
    if (status === 'idle' || !currentShift || isLoading || settingsLoading) return;
    setStatus('idle');
    setCurrentShift(null); // This will trigger localStorage removal
    setElapsedWorkTime(0);
    setElapsedBreakTime(0);
    setCurrentEarnings(0);
    setEffectiveHourlyRate(0);
    toast({ title: "Shift Reset", description: "Current shift has been discarded." });
  };
  
  return (
    <TimerContext.Provider value={{ 
      status, 
      currentShift, 
      elapsedWorkTime, 
      elapsedBreakTime, 
      currentEarnings,
      effectiveHourlyRate,
      startShift, 
      endShift, 
      startBreak, 
      endBreak,
      resetActiveShift,
      isLoading: isLoading || settingsLoading, // Overall loading state
    }}>
      {children}
    </TimerContext.Provider>
  );
};

export const useTimer = (): TimerContextType => {
  const context = useContext(TimerContext);
  if (context === undefined) {
    throw new Error('useTimer must be used within a TimerProvider');
  }
  return context;
};

    