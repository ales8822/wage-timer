
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
import { formatTime } from '@/lib/utils';

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

const ACTIVE_SHIFT_STORAGE_KEY = 'wageWiseActiveShift_v2'; // Incremented version for new structure
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
      // Initial calculation will be triggered by the status/currentShift change in the main useEffect
      if (persistedStatus === 'on_scheduled_break' && persistedShift.activeScheduledBreakInfo) {
        const breakEndTime = persistedShift.startTime + 
          (
            (parseInt(persistedShift.activeScheduledBreakInfo.scheduledEndTime.split(':')[0]) * 60 + parseInt(persistedShift.activeScheduledBreakInfo.scheduledEndTime.split(':')[1])) -
            (parseInt(persistedShift.activeScheduledBreakInfo.scheduledStartTime.split(':')[0]) * 60 + parseInt(persistedShift.activeScheduledBreakInfo.scheduledStartTime.split(':')[1]))
          ) * 60000; // This calculation is simplified, assumes break starts on same day as shift for countdown restore.
          
        // More accurate: recalculate countdown based on when the break *actually* started in currentShift.breaks.
        const activeBreakRecord = persistedShift.breaks?.find(b => b.isScheduled && b.scheduledBreakId === persistedShift.activeScheduledBreakInfo?.id && !b.endTime);
        if (activeBreakRecord && persistedShift.activeScheduledBreakInfo) {
            const now = Date.now();
            const expectedBreakEndTime = activeBreakRecord.startTime + persistedShift.activeScheduledBreakInfo.originalDurationSeconds * 1000;
            const remainingCountdown = Math.max(0, Math.floor((expectedBreakEndTime - now) / 1000));
            setScheduledBreakCountdown(remainingCountdown);
        } else {
             setScheduledBreakCountdown(persistedShift.activeScheduledBreakInfo.originalDurationSeconds); // Fallback
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
        // Keep UNUSED_BREAK_TIME_STORAGE_KEY until next shift start or explicit clear?
        // For now, let's clear it if shift is idle. If it should persist across idle, this needs adjustment.
        localStorage.removeItem(UNUSED_BREAK_TIME_STORAGE_KEY); 
      }
    }
  }, [currentShift, status, isLoading, settingsLoading, lastUnusedScheduledBreakTime]);

  const checkAndTriggerScheduledBreaks = useCallback(() => {
    if (status !== 'working' || !currentShift?.startTime || !settings.scheduledBreaks.length) return;

    const now = new Date();
    const currentDay = ALL_DAYS[now.getDay()] as DayOfWeek;
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
        
        // Ensure we are not already in an active scheduled break (e.g. from persistence)
        if (currentShift.activeScheduledBreakInfo && currentShift.activeScheduledBreakInfo.id === sb.id) continue;


        const breakDurationSeconds = (breakEndMinutes - breakStartMinutes) * 60;
        if (breakDurationSeconds <= 0) continue;

        const newBreakRecord: BreakRecord = {
          startTime: Date.now(), // Break starts now
          isScheduled: true,
          scheduledBreakId: sb.id,
          scheduledBreakName: sb.name,
        };

        const activeBreakInfoPayload = {
          id: sb.id,
          name: sb.name,
          originalDurationSeconds: breakDurationSeconds,
          scheduledStartTime: sb.startTime, // Store original scheduled times
          scheduledEndTime: sb.endTime,
        };
        
        setCurrentShift(prev => ({
          ...prev,
          breaks: [...(prev?.breaks || []), newBreakRecord],
          activeScheduledBreakInfo: activeBreakInfoPayload,
        } as ActiveShift));
        
        setStatus('on_scheduled_break');
        setScheduledBreakCountdown(breakDurationSeconds);
        setLastUnusedScheduledBreakTime(0); // Reset any previous unused time
        toast({ title: "Scheduled Break Started", description: `${sb.name || 'Break'} has begun. Duration: ${formatTime(breakDurationSeconds)}` });
        return; // Only trigger one scheduled break at a time
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
    
    // If on a scheduled break, and its info exists, update its break record's end time for live calculation
    // This ensures earnings are paused during the scheduled break for live calculation
    let liveBreaks = [...(currentShift.breaks || [])];
    if (status === 'on_scheduled_break' && currentShift.activeScheduledBreakInfo) {
        const activeBreakIdx = liveBreaks.findIndex(b => b.isScheduled && b.scheduledBreakId === currentShift.activeScheduledBreakInfo?.id && !b.endTime);
        if (activeBreakIdx !== -1) {
            // Don't set endTime here permanently, just for the tempShiftForCalc or ensure it's handled
            // The actual end time is set when break ends. For calculation, use `nowMs`.
            // This part is tricky; calculateShiftEarnings handles breaks based on their actual start/end.
            // The *status* of 'on_scheduled_break' should primarily control UI and countdown.
            // Earnings calculation should naturally pause if 'on_scheduled_break' means no work is done.
            // `calculateShiftEarnings` iterates minute by minute and checks against *all* break types.
        }
    }
    tempShiftForCalc.breaks = liveBreaks;


    const { totalEarnings, finalEffectiveRate } = calculateShiftEarnings(tempShiftForCalc, settings, true);
    setCurrentEarnings(totalEarnings);
    setEffectiveHourlyRate(finalEffectiveRate);

    // Update elapsed work time (gross time - manual breaks currently active)
    // This is primarily for display, final paid time uses calculateShiftEarnings
    let totalManualBreakDurationMs = 0;
    (currentShift.breaks || []).forEach(br => {
      if (!br.isScheduled) {
        const breakStartTime = br.startTime;
        const breakEndTime = br.endTime || (status === 'on_break' && br.startTime === currentShift.breaks?.[currentShift.breaks.length - 1]?.startTime ? nowMs : 0);
        if (breakEndTime > breakStartTime) {
          totalManualBreakDurationMs += breakEndTime - breakStartTime;
        }
      }
    });
    const grossWorkTimeMs = nowMs - currentShift.startTime;
    setElapsedWorkTime(Math.max(0, Math.floor((grossWorkTimeMs - totalManualBreakDurationMs) / 1000)));

    if (status === 'on_break') { // Manual break
      const activeManualBreak = currentShift.breaks?.find(b => !b.isScheduled && !b.endTime);
      if (activeManualBreak) {
        setElapsedBreakTime(Math.floor((nowMs - activeManualBreak.startTime) / 1000));
      }
    } else {
       if (status !== 'on_break') setElapsedBreakTime(0); // Reset if not on manual break
    }

    if (status === 'on_scheduled_break' && scheduledBreakCountdown !== null) {
      const newCountdown = Math.max(0, scheduledBreakCountdown - 1);
      setScheduledBreakCountdown(newCountdown);

      if (newCountdown === 0) { // Scheduled break ended automatically
        const breakName = currentShift.activeScheduledBreakInfo?.name || "Scheduled break";
        setCurrentShift(prev => {
          if (!prev) return null;
          const updatedBreaks = (prev.breaks || []).map(b => 
            (b.isScheduled && b.scheduledBreakId === prev.activeScheduledBreakInfo?.id && !b.endTime) 
            ? { ...b, endTime: nowMs } 
            : b
          );
          return { ...prev, breaks: updatedBreaks, activeScheduledBreakInfo: undefined };
        });
        setStatus('working');
        setScheduledBreakCountdown(null);
        toast({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
      }
    }
  }, [isLoading, settingsLoading, currentShift, settings, status, scheduledBreakCountdown, toast]);


  useEffect(() => {
    if (isLoading || settingsLoading) return;

    if (status === 'working') {
      checkAndTriggerScheduledBreaks(); // Check if a scheduled break should start
    }

    if (status === 'working' || status === 'on_break' || status === 'on_scheduled_break') {
      calculateCurrentTimersAndEarnings(); // Initial call for immediate update
      const interval = setInterval(() => {
        calculateCurrentTimersAndEarnings();
        if (status === 'working') { // Re-check for scheduled breaks every second while working
            checkAndTriggerScheduledBreaks();
        }
      }, 1000);
      setTimerInterval(interval);
      return () => clearInterval(interval);
    } else { // idle
      if (timerInterval) clearInterval(timerInterval);
      setTimerInterval(null);
      if (!currentShift) { // Reset displayed values if truly idle and no lingering shift data
        setElapsedWorkTime(0);
        setElapsedBreakTime(0);
        setCurrentEarnings(0);
        setEffectiveHourlyRate(0);
        setScheduledBreakCountdown(null);
        // setLastUnusedScheduledBreakTime(0); // Decide if this should reset on idle or persist
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isLoading, settingsLoading, calculateCurrentTimersAndEarnings, checkAndTriggerScheduledBreaks]);


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
    setLastUnusedScheduledBreakTime(0); // Reset unused time for new shift
    toast({ title: "Shift Started", description: "Your work shift has begun." });
  };

  const endShift = () => {
    if (status === 'idle' || !currentShift?.startTime || isLoading || settingsLoading) return;

    let finalShiftProto = { ...currentShift };
    const now = Date.now();
    finalShiftProto.endTime = now;
    finalShiftProto.baseWageAtStart = finalShiftProto.baseWageAtStart || settings.baseWage;

    // Ensure any active break (manual or scheduled) is ended
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
    // Values reset by useEffect when status becomes 'idle' and currentShift is null
    toast({ title: "Shift Ended", description: `Earnings: ${formatCurrency(totalEarnings)}.` });
  };

  const startManualBreak = () => {
    if (status !== 'working' || !currentShift || isLoading || settingsLoading) return;
    const newBreak: BreakRecord = { startTime: Date.now(), isScheduled: false };
    setCurrentShift(prev => ({ ...prev, breaks: [...(prev?.breaks || []), newBreak] } as ActiveShift));
    setStatus('on_break');
    setElapsedBreakTime(0); 
    toast({ title: "Manual Break Started", description: "Enjoy your break!" });
  };

  const endManualBreak = () => {
    if (status !== 'on_break' || !currentShift || !currentShift.breaks?.length || isLoading || settingsLoading) return;
    const updatedBreaks = (currentShift.breaks || []).map((br, index) => 
      index === (currentShift.breaks || []).length - 1 && !br.endTime && !br.isScheduled ? { ...br, endTime: Date.now() } : br
    );
    setCurrentShift(prev => ({ ...prev, breaks: updatedBreaks } as ActiveShift));
    setStatus('working');
    toast({ title: "Manual Break Ended", description: "Back to work!" });
  };
  
  const endScheduledBreakEarly = () => {
    if (status !== 'on_scheduled_break' || !currentShift?.activeScheduledBreakInfo || scheduledBreakCountdown === null || isLoading || settingsLoading) return;

    const breakName = currentShift.activeScheduledBreakInfo.name || "Scheduled break";
    const remainingTime = scheduledBreakCountdown; // This is already in seconds
    
    if (remainingTime > 0) {
      setLastUnusedScheduledBreakTime(prev => prev + remainingTime);
      toast({ title: "Scheduled Break Ended Early", description: `${breakName} ended. You have ${formatTime(remainingTime)} of unused time.` });
    } else {
      toast({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
    }

    const now = Date.now();
    setCurrentShift(prev => {
      if (!prev) return null;
      const updatedBreaks = (prev.breaks || []).map(b => 
        (b.isScheduled && b.scheduledBreakId === prev.activeScheduledBreakInfo?.id && !b.endTime) 
        ? { ...b, endTime: now } 
        : b
      );
      return { ...prev, breaks: updatedBreaks, activeScheduledBreakInfo: undefined };
    });
    setStatus('working');
    setScheduledBreakCountdown(null);
  };

  const resetActiveShift = () => {
    if (status === 'idle' || !currentShift || isLoading || settingsLoading) return;
    setStatus('idle');
    setCurrentShift(null); 
    // Values reset by useEffect when status becomes 'idle' and currentShift is null
    toast({ title: "Shift Reset", description: "Current shift has been discarded." });
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
function getScheduledBreakEndMinutesFromStart(shiftStartTime: number, sb: ScheduledBreak): number {
    const shiftStartDate = new Date(shiftStartTime);
    const breakStartHour = parseInt(sb.startTime.split(':')[0]);
    const breakStartMinute = parseInt(sb.startTime.split(':')[1]);
    // This simplistic approach assumes break starts on the same day as shift for duration calculation.
    // A more robust method might need to create full Date objects for break start/end relative to shift day.
    const breakEndHour = parseInt(sb.endTime.split(':')[0]);
    const breakEndMinute = parseInt(sb.endTime.split(':')[1]);
    
    let breakStartAbsMinutes = breakStartHour * 60 + breakStartMinute;
    let breakEndAbsMinutes = breakEndHour * 60 + breakEndMinute;

    if (breakEndAbsMinutes < breakStartAbsMinutes) { // Crosses midnight
        breakEndAbsMinutes += 24 * 60;
    }
    // This is not directly minutes from shift start, but duration.
    return breakEndAbsMinutes; // This is actually just the end time in minutes of its day.
}

