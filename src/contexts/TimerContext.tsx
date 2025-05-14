"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Shift, BreakRecord, AppSettings } from '@/types';
import { useSettings } from './SettingsContext';
import { useWorkHistory } from './WorkHistoryContext';
import { calculateShiftEarnings } from '@/lib/wageCalculator'; // Will create this later
import { useToast } from '@/hooks/use-toast';

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
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

export const TimerProvider = ({ children }: { children: ReactNode }) => {
  const { settings } = useSettings();
  const { addShift } = useWorkHistory();
  const { toast } = useToast();

  const [status, setStatus] = useState<TimerStatus>('idle');
  const [currentShift, setCurrentShift] = useState<Partial<Shift> | null>(null);
  const [elapsedWorkTime, setElapsedWorkTime] = useState(0); // in seconds
  const [elapsedBreakTime, setElapsedBreakTime] = useState(0); // in seconds
  const [currentEarnings, setCurrentEarnings] = useState(0);
  const [effectiveHourlyRate, setEffectiveHourlyRate] = useState(0);

  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);

  const calculateCurrentEarningsAndRate = useCallback(() => {
    if (status === 'working' && currentShift?.startTime && settings) {
      const tempShift: Shift = {
        id: currentShift.id || 'temp',
        startTime: currentShift.startTime,
        endTime: Date.now(),
        breaks: currentShift.breaks || [],
        baseWageAtStart: settings.baseWage,
      };
      const { totalEarnings, finalEffectiveRate } = calculateShiftEarnings(tempShift, settings, true);
      setCurrentEarnings(totalEarnings);
      setEffectiveHourlyRate(finalEffectiveRate);

      // Update elapsed work time considering breaks
      const now = Date.now();
      let totalBreakDurationMs = 0;
      (currentShift.breaks || []).forEach(br => {
        if (br.endTime) {
          totalBreakDurationMs += br.endTime - br.startTime;
        } else if (status === 'on_break' && br.startTime === currentShift.breaks?.[currentShift.breaks.length - 1]?.startTime) {
          // Current active break
          totalBreakDurationMs += now - br.startTime;
        }
      });
      const grossWorkTimeMs = now - currentShift.startTime;
      setElapsedWorkTime(Math.floor((grossWorkTimeMs - totalBreakDurationMs) / 1000));

    } else if (status === 'on_break' && currentShift?.startTime) {
        // Update elapsed break time
        const activeBreak = currentShift.breaks?.find(b => !b.endTime);
        if (activeBreak) {
            setElapsedBreakTime(Math.floor((Date.now() - activeBreak.startTime) / 1000));
        }
    }
  }, [status, currentShift, settings]);


  useEffect(() => {
    if (status === 'working' || status === 'on_break') {
      const interval = setInterval(() => {
        calculateCurrentEarningsAndRate();
      }, 1000);
      setTimerInterval(interval);
      return () => clearInterval(interval);
    } else {
      if (timerInterval) clearInterval(timerInterval);
      setTimerInterval(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, calculateCurrentEarningsAndRate]); // Dependencies carefully chosen

  const startShift = () => {
    if (status !== 'idle') return;
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
    toast({ title: "Shift Started", description: "Your work shift has begun." });
  };

  const endShift = () => {
    if (status !== 'working' && status !== 'on_break') return;
    if (!currentShift || !currentShift.startTime) return;

    let finalShift = { ...currentShift } as Shift;
    finalShift.endTime = Date.now();

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
    setCurrentShift(null);
    setElapsedWorkTime(0);
    setElapsedBreakTime(0);
    setCurrentEarnings(0);
    setEffectiveHourlyRate(0);
    toast({ title: "Shift Ended", description: `Earnings: €${totalEarnings.toFixed(2)}.` });
  };

  const startBreak = () => {
    if (status !== 'working' || !currentShift) return;
    const newBreak: BreakRecord = { startTime: Date.now(), isScheduled: false };
    setCurrentShift(prev => ({ ...prev, breaks: [...(prev?.breaks || []), newBreak] }));
    setStatus('on_break');
    setElapsedBreakTime(0);
    toast({ title: "Break Started", description: "Enjoy your break!" });
  };

  const endBreak = () => {
    if (status !== 'on_break' || !currentShift || !currentShift.breaks?.length) return;
    const updatedBreaks = currentShift.breaks.map((br, index) => 
      index === currentShift.breaks!.length - 1 ? { ...br, endTime: Date.now() } : br
    );
    setCurrentShift(prev => ({ ...prev, breaks: updatedBreaks }));
    setStatus('working');
    // Elapsed break time will stop updating automatically.
    // Recalculate earnings and rate for the working state.
    calculateCurrentEarningsAndRate(); 
    toast({ title: "Break Ended", description: "Back to work!" });
  };

  const resetActiveShift = () => {
    if (status === 'idle' || !currentShift) return;
    // Optional: Add confirmation dialog here
    setStatus('idle');
    setCurrentShift(null);
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
      resetActiveShift
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

