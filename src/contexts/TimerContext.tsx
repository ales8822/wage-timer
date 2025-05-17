
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
        // localStorage.removeItem(UNUSED_BREAK_TIME_STORAGE_KEY); // Let's keep unused time until next shift starts
      }
    }
  }, [currentShift, status, isLoading, settingsLoading, lastUnusedScheduledBreakTime]);

  const checkAndTriggerScheduledBreaks = useCallback(() => {
    // Directly use `status` and `currentShift` from the outer scope
    // as they are updated and this useCallback will re-create if they change.
    // However, for actions that modify state, they should be stable or called carefully.
    if (status !== 'working' || !currentShift?.startTime || !settings.scheduledBreaks.length) return;

    const now = new Date();
    const currentDay = ALL_DAYS[now.getDay()] as DayOfWeek; // getDay returns 0 for Sunday
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    for (const sb of settings.scheduledBreaks) {
      if (!sb.days.includes(currentDay)) continue;

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
          if (!prev) return null; // Should not happen if status is 'working'
          return {
            ...prev,
            breaks: [...(prev.breaks || []), newBreakRecord],
            activeScheduledBreakInfo: activeBreakInfoPayload,
          };
        });
        
        setStatus('on_scheduled_break');
        setScheduledBreakCountdown(breakDurationSeconds);
        setLastUnusedScheduledBreakTime(0); // Reset unused time when a new scheduled break starts
        toast({ title: "Scheduled Break Started", description: `${sb.name || 'Break'} has begun. Duration: ${formatTime(breakDurationSeconds)}` });
        return; 
      }
    }
  }, [status, currentShift, settings.scheduledBreaks, toast]); // Dependencies updated for stability & correctness


  const calculateCurrentTimersAndEarnings = useCallback(() => {
    // `currentShift` and `settings` are dependencies for `useCallback`
    // `status` is not needed as a dependency if actions are based on it directly
    // but it's good to have if the logic branches heavily on it.
    // For `setScheduledBreakCountdown`, using functional update is key.

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
      if (!br.isScheduled) { // Only manual breaks
        const breakStartTime = br.startTime;
        // If the break is active and it's the last break, use nowMs, otherwise use its endTime or 0 if no endTime (completed break shouldn't lack endTime)
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
       setElapsedBreakTime(0); // Reset if not on manual break
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
                setStatus('working'); // Transition back to working
                toast({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
                return null; // Clear countdown
            }
            return newCountdown;
        });
    }
  }, [isLoading, settingsLoading, currentShift, settings, status, toast]); // `status` added here as logic inside branches based on it for countdown/break end.


  useEffect(() => {
    if (isLoading || settingsLoading) {
        if (timerInterval) {
            clearInterval(timerInterval);
            setTimerInterval(null);
        }
        return;
    }

    if (status === 'working' || status === 'on_break' || status === 'on_scheduled_break') {
      calculateCurrentTimersAndEarnings(); // Initial call
      if (status === 'working') {
        checkAndTriggerScheduledBreaks(); // Check immediately if working
      }
      const intervalId = setInterval(() => {
        calculateCurrentTimersAndEarnings();
        if (status === 'working') { // Check for scheduled breaks continuously only if working
            checkAndTriggerScheduledBreaks();
        }
      }, 1000);
      setTimerInterval(intervalId);
      return () => {
        clearInterval(intervalId);
        setTimerInterval(null); 
      };
    } else { // idle
      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }
      if (!currentShift) { // If truly idle (no shift data)
        setElapsedWorkTime(0);
        setElapsedBreakTime(0);
        setCurrentEarnings(0);
        setEffectiveHourlyRate(0);
        setScheduledBreakCountdown(null);
      }
    }
  // `checkAndTriggerScheduledBreaks` and `calculateCurrentTimersAndEarnings` are useCallback dependencies
  // `status`, `isLoading`, `settingsLoading`, `currentShift` are direct dependencies that control flow or data.
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
    // Reset unused time when a new shift starts
    // setLastUnusedScheduledBreakTime(0); // It's better to reset this when a scheduled break *actually starts*
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
    
    const finalShift: Shift = {
        ...shiftForCalc,
        totalEarnings: totalEarnings,
        rateSegments: rateSegments,
    };

    addShift(finalShift);
    setStatus('idle');
    setCurrentShift(null); 
    setLastUnusedScheduledBreakTime(0); // Clear unused time when shift truly ends
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
    const remainingTime = scheduledBreakCountdown; // This is in seconds
    
    if (remainingTime > 0) {
      setLastUnusedScheduledBreakTime(prev => prev + remainingTime);
      toast({ title: "Scheduled Break Ended Early", description: `${breakName} ended. You have ${formatTime(remainingTime)} of unused time.` });
    } else {
      toast({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
    }

    const breakEndTime = Date.now();
    setCurrentShift(prev => {
      if (!prev || !prev.activeScheduledBreakInfo) return prev; // Ensure activeScheduledBreakInfo exists
      const updatedBreaks = (prev.breaks || []).map(b => 
        (b.isScheduled && b.scheduledBreakId === prev.activeScheduledBreakInfo!.id && !b.endTime) 
        ? { ...b, endTime: breakEndTime } 
        : b
      );
      return { ...prev, breaks: updatedBreaks, activeScheduledBreakInfo: undefined };
    });
    setStatus('working');
    setScheduledBreakCountdown(null); // Clear countdown
  };

  const resetActiveShift = () => {
    if (isLoading || settingsLoading) return; // Allow reset even if no currentShift to clear status & localStorage
    
    setStatus('idle');
    setCurrentShift(null); 
    setLastUnusedScheduledBreakTime(0); 
    
    // Clear from localStorage explicitly
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

// Helper to get original scheduled end time in minutes from shift start
// This is a placeholder if needed, actual logic should use stored scheduledStartTime/EndTime
// function getScheduledBreakEndMinutesFromStart(shiftStartTime: number, sb: ScheduledBreak): number {
//     const shiftStartDate = new Date(shiftStartTime);
//     const breakStartHour = parseInt(sb.startTime.split(':')[0]);
//     const breakStartMinute = parseInt(sb.startTime.split(':')[1]);
//     // This simplistic approach assumes break starts on the same day as shift for duration calculation.
//     // A more robust method might need to create full Date objects for break start/end relative to shift day.
//     const breakEndHour = parseInt(sb.endTime.split(':')[0]);
//     const breakEndMinute = parseInt(sb.endTime.split(':')[1]);
    
//     let breakStartAbsMinutes = breakStartHour * 60 + breakStartMinute;
//     let breakEndAbsMinutes = breakEndHour * 60 + breakEndMinute;

//     if (breakEndAbsMinutes < breakStartAbsMinutes) { // Crosses midnight
//         breakEndAbsMinutes += 24 * 60;
//     }
//     // This is not directly minutes from shift start, but duration.
//     return breakEndAbsMinutes; // This is actually just the end time in minutes of its day.
// }

// Note: ALL_DAYS definition needed if used here, currently in /types
// import { ALL_DAYS } from '@/types';
