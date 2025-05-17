
"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Shift, BreakRecord, AppSettings, ScheduledBreak, RateSegment, DayOfWeek, ActiveShift } from '@/types';
import { useSettings } from './SettingsContext';
import { useWorkHistory } from './WorkHistoryContext';
import { calculateShiftEarnings } from '@/lib/wageCalculator';
import { useToast } from '@/hooks/use-toast';
import { getFromLocalStorage, setToLocalStorage } from '@/lib/localStorage';
import { ALL_DAYS } from '@/types';
import { formatCurrency, formatTime } from '@/lib/utils';

type TimerStatus = 'idle' | 'working' | 'on_break' | 'on_scheduled_break';

interface TimerContextType {
  status: TimerStatus;
  currentShift: ActiveShift | null;
  elapsedWorkTime: number; // in seconds (net of manual breaks, before scheduled breaks are finalized for this)
  elapsedBreakTime: number; // in seconds (for active manual break)
  scheduledBreakCountdown: number | null; // in seconds, for active scheduled break
  lastUnusedScheduledBreakTime: number; // in seconds
  currentEarnings: number;
  effectiveHourlyRate: number;
  startShift: () => void;
  endShift: () => void;
  startManualBreak: () => void;
  endManualBreak: () => void;
  endScheduledBreakEarly: () => void;
  resetActiveShift: () => void;
  isLoading: boolean;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

const ACTIVE_SHIFT_STORAGE_KEY = 'wageWiseActiveShift_v2';
const ACTIVE_STATUS_STORAGE_KEY = 'wageWiseActiveStatus_v2';
const UNUSED_BREAK_TIME_STORAGE_KEY = 'wageWiseUnusedBreakTime';

export const TimerProvider = ({ children }: { children: ReactNode }) => {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { addShift } = useWorkHistory();
  const { toast } = useToast();

  const [status, setStatus] = useState<TimerStatus>('idle');
  const [currentShift, setCurrentShift] = useState<ActiveShift | null>(null);
  const [elapsedWorkTime, setElapsedWorkTime] = useState(0);
  const [elapsedBreakTime, setElapsedBreakTime] = useState(0);
  const [scheduledBreakCountdown, setScheduledBreakCountdown] = useState<number | null>(null);
  const [lastUnusedScheduledBreakTime, setLastUnusedScheduledBreakTime] = useState(0);

  const [currentEarnings, setCurrentEarnings] = useState(0);
  const [effectiveHourlyRate, setEffectiveHourlyRate] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (settingsLoading) return;

    const persistedShift = getFromLocalStorage<ActiveShift | null>(ACTIVE_SHIFT_STORAGE_KEY, null);
    const persistedStatus = getFromLocalStorage<TimerStatus | null>(ACTIVE_STATUS_STORAGE_KEY, null);
    const persistedUnusedTime = getFromLocalStorage<number>(UNUSED_BREAK_TIME_STORAGE_KEY, 0);
    
    setLastUnusedScheduledBreakTime(persistedUnusedTime);

    if (persistedShift?.startTime && persistedStatus && persistedStatus !== 'idle') {
      setCurrentShift(persistedShift);
      setStatus(persistedStatus);
      if (persistedStatus === 'on_scheduled_break' && persistedShift.activeScheduledBreakInfo) {
        const activeBreakRecord = persistedShift.breaks?.find(b => b.isScheduled && b.scheduledBreakId === persistedShift.activeScheduledBreakInfo?.id && !b.endTime);
        if (activeBreakRecord && persistedShift.activeScheduledBreakInfo) {
            const now = Date.now();
            const expectedBreakEndTime = activeBreakRecord.startTime + persistedShift.activeScheduledBreakInfo.originalDurationSeconds * 1000;
            const remainingCountdown = Math.max(0, Math.floor((expectedBreakEndTime - now) / 1000));
            setScheduledBreakCountdown(remainingCountdown);
        } else if (persistedShift.activeScheduledBreakInfo) { // Fallback if break record not found but info exists
             setScheduledBreakCountdown(persistedShift.activeScheduledBreakInfo.originalDurationSeconds);
        }
      }
    }
    setIsLoading(false);
  }, [settingsLoading]);

  useEffect(() => {
    if (!isLoading && !settingsLoading) {
      if (status !== 'idle' && currentShift) {
        setToLocalStorage(ACTIVE_SHIFT_STORAGE_KEY, currentShift);
        setToLocalStorage(ACTIVE_STATUS_STORAGE_KEY, status);
        setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, lastUnusedScheduledBreakTime);
      } else {
        localStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
        localStorage.removeItem(ACTIVE_STATUS_STORAGE_KEY);
        // Don't remove UNUSED_BREAK_TIME_STORAGE_KEY here if shift just ended,
        // it will be cleared by endShift or when a new shift/break starts
      }
    }
  }, [currentShift, status, isLoading, settingsLoading, lastUnusedScheduledBreakTime]);

  const checkAndTriggerScheduledBreaks = useCallback(() => {
    if (status !== 'working' || !currentShift?.startTime || !settings.scheduledBreaks.length) return;

    const now = new Date();
    const currentDay = ALL_DAYS[now.getDay() === 0 ? 6 : now.getDay() -1 ] as DayOfWeek; // Corrected: getDay() is Sun=0..Sat=6. Our ALL_DAYS is Sun..Sat.
                                                                                          // Let's keep ALL_DAYS as 0=Sunday .. 6=Saturday
                                                                                          // const currentDay = ALL_DAYS[now.getDay()] as DayOfWeek;
                                                                                          // No, the original definition of ALL_DAYS starts with Sunday.
                                                                                          // And settings.scheduledBreaks[x].days contains "Sunday", "Monday" etc.
                                                                                          // So ALL_DAYS[now.getDay()] is correct.
    
    const currentDayName = ALL_DAYS[now.getDay()];
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    for (const sb of settings.scheduledBreaks) {
      if (!sb.days.includes(currentDayName)) continue;

      const breakStartMinutes = parseInt(sb.startTime.split(':')[0]) * 60 + parseInt(sb.startTime.split(':')[1]);
      const breakEndMinutes = parseInt(sb.endTime.split(':')[0]) * 60 + parseInt(sb.endTime.split(':')[1]);

      if (currentTimeMinutes >= breakStartMinutes && currentTimeMinutes < breakEndMinutes) {
        const alreadyTookThisBreak = currentShift.breaks?.some(
          b => b.isScheduled && b.scheduledBreakId === sb.id
        );
        if (alreadyTookThisBreak) continue;
        
        if (currentShift.activeScheduledBreakInfo && currentShift.activeScheduledBreakInfo.id === sb.id) continue;

        const breakDurationSeconds = (breakEndMinutes - breakStartMinutes) * 60;
        if (breakDurationSeconds <= 0) continue;

        const newBreakRecord: BreakRecord = {
          startTime: Date.now(),
          isScheduled: true,
          scheduledBreakId: sb.id,
          scheduledBreakName: sb.name,
        };

        const activeBreakInfoPayload = {
          id: sb.id,
          name: sb.name,
          originalDurationSeconds: breakDurationSeconds,
          scheduledStartTime: sb.startTime,
          scheduledEndTime: sb.endTime,
        };
        
        setCurrentShift(prev => {
          if (!prev) return null;
          return {
            ...prev,
            breaks: [...(prev.breaks || []), newBreakRecord],
            activeScheduledBreakInfo: activeBreakInfoPayload,
          };
        });
        
        setStatus('on_scheduled_break');
        setScheduledBreakCountdown(breakDurationSeconds);
        setLastUnusedScheduledBreakTime(0); // Reset any previous unused time when a new scheduled break starts
        setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, 0); // also clear from storage
        toast({ title: "Scheduled Break Started", description: `${sb.name || 'Break'} has begun. Duration: ${formatTime(breakDurationSeconds)}` });
        return; 
      }
    }
  }, [status, currentShift, settings.scheduledBreaks, toast]); 


  const calculateCurrentTimersAndEarnings = useCallback(() => {
    if (isLoading || settingsLoading || !currentShift?.startTime) return;

    const nowMs = Date.now();
    let tempShiftForCalc: Shift = {
      id: currentShift.id || 'temp_live_calc',
      startTime: currentShift.startTime,
      endTime: nowMs,
      breaks: currentShift.breaks || [],
      baseWageAtStart: currentShift.baseWageAtStart || settings.baseWage,
    };
    
    const { totalEarnings, finalEffectiveRate } = calculateShiftEarnings(tempShiftForCalc, settings, true);
    setCurrentEarnings(totalEarnings);
    setEffectiveHourlyRate(finalEffectiveRate);

    let totalManualBreakDurationMs = 0;
    (currentShift.breaks || []).forEach(br => {
      if (!br.isScheduled) { 
        const breakStartTime = br.startTime;
        const breakEndTime = br.endTime || (status === 'on_break' && currentShift.breaks?.length && br.startTime === currentShift.breaks[currentShift.breaks.length - 1]?.startTime ? nowMs : 0);
        if (breakEndTime > breakStartTime) {
          totalManualBreakDurationMs += breakEndTime - breakStartTime;
        }
      }
    });
    const grossWorkTimeMs = nowMs - currentShift.startTime;
    setElapsedWorkTime(Math.max(0, Math.floor((grossWorkTimeMs - totalManualBreakDurationMs) / 1000)));

    if (status === 'on_break') {
      const activeManualBreak = currentShift.breaks?.find(b => !b.isScheduled && !b.endTime);
      if (activeManualBreak) {
        setElapsedBreakTime(Math.floor((nowMs - activeManualBreak.startTime) / 1000));
      }
    } else {
       setElapsedBreakTime(0); 
    }

    if (status === 'on_scheduled_break') {
        setScheduledBreakCountdown(prevCountdown => {
            if (prevCountdown === null) return null; 
            const newCountdown = Math.max(0, prevCountdown - 1);

            if (newCountdown === 0) { 
                const breakName = currentShift.activeScheduledBreakInfo?.name || "Scheduled break";
                const breakEndTime = Date.now();
                setCurrentShift(prevShift => {
                    if (!prevShift) return null;
                    const updatedBreaks = (prevShift.breaks || []).map(b =>
                        (b.isScheduled && b.scheduledBreakId === prevShift.activeScheduledBreakInfo?.id && !b.endTime)
                        ? { ...b, endTime: breakEndTime } 
                        : b
                    );
                    return { ...prevShift, breaks: updatedBreaks, activeScheduledBreakInfo: undefined };
                });
                setStatus('working'); 
                toast({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
                return null; 
            }
            return newCountdown;
        });
    }
  }, [isLoading, settingsLoading, currentShift, settings, status, toast]); 


  useEffect(() => {
    if (isLoading || settingsLoading) {
        if (timerInterval) {
            clearInterval(timerInterval);
            setTimerInterval(null);
        }
        return;
    }

    if (status === 'working' || status === 'on_break' || status === 'on_scheduled_break') {
      calculateCurrentTimersAndEarnings(); 
      if (status === 'working') {
        checkAndTriggerScheduledBreaks(); 
      }
      const intervalId = setInterval(() => {
        calculateCurrentTimersAndEarnings();
        if (status === 'working') { 
            checkAndTriggerScheduledBreaks();
        }
      }, 1000);
      setTimerInterval(intervalId);
      return () => {
        clearInterval(intervalId);
        setTimerInterval(null); 
      };
    } else { 
      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }
      if (!currentShift) { 
        setElapsedWorkTime(0);
        setElapsedBreakTime(0);
        setCurrentEarnings(0);
        setEffectiveHourlyRate(0);
        setScheduledBreakCountdown(null);
        // Do not clear lastUnusedScheduledBreakTime here, allow it to persist until endShift or new break.
      }
    }
  }, [status, isLoading, settingsLoading, currentShift, calculateCurrentTimersAndEarnings, checkAndTriggerScheduledBreaks]);


  const startShift = () => {
    if (status !== 'idle' || isLoading || settingsLoading) return;
    const newShift: ActiveShift = {
      id: `shift_${Date.now()}`,
      startTime: Date.now(),
      breaks: [],
      baseWageAtStart: settings.baseWage,
      activeScheduledBreakInfo: undefined,
    };
    setCurrentShift(newShift);
    setStatus('working');
    setElapsedWorkTime(0);
    setElapsedBreakTime(0);
    setCurrentEarnings(0);
    setScheduledBreakCountdown(null);
    setLastUnusedScheduledBreakTime(0); // Clear any previous unused time
    setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, 0); // also clear from storage
    toast({ title: "Shift Started", description: "Your work shift has begun." });
  };

  const endShift = () => {
    if (status === 'idle' || !currentShift?.startTime || isLoading || settingsLoading) return;

    let finalShiftProto = { ...currentShift };
    const now = Date.now();
    finalShiftProto.endTime = now;
    finalShiftProto.baseWageAtStart = finalShiftProto.baseWageAtStart || settings.baseWage;

    if ((status === 'on_break' || status === 'on_scheduled_break') && finalShiftProto.breaks && finalShiftProto.breaks.length > 0) {
      const lastBreakIndex = finalShiftProto.breaks.length - 1;
      if (!finalShiftProto.breaks[lastBreakIndex].endTime) {
        finalShiftProto.breaks[lastBreakIndex].endTime = now;
      }
    }
    
    const shiftForCalc: Shift = {
        id: finalShiftProto.id || `shift_${Date.now()}_err`,
        startTime: finalShiftProto.startTime,
        endTime: finalShiftProto.endTime,
        breaks: finalShiftProto.breaks || [],
        baseWageAtStart: finalShiftProto.baseWageAtStart,
    };

    const { totalEarnings, rateSegments } = calculateShiftEarnings(shiftForCalc, settings, false);
    
    const unusedTimeForThisShift = lastUnusedScheduledBreakTime;

    const finalShift: Shift = {
        ...shiftForCalc,
        totalEarnings: totalEarnings,
        rateSegments: rateSegments,
        unusedScheduledBreakSeconds: unusedTimeForThisShift > 0 ? unusedTimeForThisShift : undefined,
    };

    addShift(finalShift);
    setStatus('idle');
    setCurrentShift(null); 
    setLastUnusedScheduledBreakTime(0); 
    setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, 0); // Clear from storage
    toast({ title: "Shift Ended", description: `Earnings: ${formatCurrency(totalEarnings)}.` });
  };

  const startManualBreak = () => {
    if (status !== 'working' || !currentShift || isLoading || settingsLoading) return;
    const newBreak: BreakRecord = { startTime: Date.now(), isScheduled: false };
    setCurrentShift(prev => {
      if (!prev) return null;
      return { ...prev, breaks: [...(prev.breaks || []), newBreak] };
    });
    setStatus('on_break');
    setElapsedBreakTime(0); 
    toast({ title: "Manual Break Started", description: "Enjoy your break!" });
  };

  const endManualBreak = () => {
    if (status !== 'on_break' || !currentShift || !currentShift.breaks?.length || isLoading || settingsLoading) return;
    const breakEndTime = Date.now();
    setCurrentShift(prev => {
      if (!prev || !prev.breaks) return prev;
      const updatedBreaks = prev.breaks.map((br, index) => 
        index === prev.breaks!.length - 1 && !br.isScheduled && !br.endTime ? { ...br, endTime: breakEndTime } : br
      );
      return { ...prev, breaks: updatedBreaks };
    });
    setStatus('working');
    toast({ title: "Manual Break Ended", description: "Back to work!" });
  };
  
  const endScheduledBreakEarly = () => {
    if (status !== 'on_scheduled_break' || !currentShift?.activeScheduledBreakInfo || scheduledBreakCountdown === null || isLoading || settingsLoading) return;

    const breakName = currentShift.activeScheduledBreakInfo.name || "Scheduled break";
    const remainingTime = scheduledBreakCountdown; 
    
    if (remainingTime > 0) {
      setLastUnusedScheduledBreakTime(prev => prev + remainingTime);
      setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, lastUnusedScheduledBreakTime + remainingTime); // Update storage
      toast({ title: "Scheduled Break Ended Early", description: `${breakName} ended. You have ${formatTime(remainingTime)} of unused time.` });
    } else {
      toast({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
    }

    const breakEndTime = Date.now();
    setCurrentShift(prev => {
      if (!prev || !prev.activeScheduledBreakInfo) return prev; 
      const updatedBreaks = (prev.breaks || []).map(b => 
        (b.isScheduled && b.scheduledBreakId === prev.activeScheduledBreakInfo!.id && !b.endTime) 
        ? { ...b, endTime: breakEndTime } 
        : b
      );
      return { ...prev, breaks: updatedBreaks, activeScheduledBreakInfo: undefined };
    });
    setStatus('working');
    setScheduledBreakCountdown(null); 
  };

  const resetActiveShift = () => {
    if (isLoading || settingsLoading) return; 
    
    setStatus('idle');
    setCurrentShift(null); 
    setLastUnusedScheduledBreakTime(0); 
    
    localStorage.removeItem(ACTIVE_SHIFT_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_STATUS_STORAGE_KEY);
    localStorage.removeItem(UNUSED_BREAK_TIME_STORAGE_KEY);

    toast({ title: "Shift Reset", description: "Current shift progress has been discarded." });
  };
  
  return (
    <TimerContext.Provider value={{ 
      status, 
      currentShift, 
      elapsedWorkTime, 
      elapsedBreakTime, 
      scheduledBreakCountdown,
      lastUnusedScheduledBreakTime,
      currentEarnings,
      effectiveHourlyRate,
      startShift, 
      endShift, 
      startManualBreak, 
      endManualBreak,
      endScheduledBreakEarly,
      resetActiveShift,
      isLoading: isLoading || settingsLoading, 
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
