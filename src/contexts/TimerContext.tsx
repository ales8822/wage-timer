
"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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

  const [toastInfo, setToastInfo] = useState<{ title: string; description: string; variant?: "default" | "destructive" } | null>(null);

  const currentShiftRef = useRef(currentShift);
  useEffect(() => {
    currentShiftRef.current = currentShift;
  }, [currentShift]);


  useEffect(() => {
    if (toastInfo) {
      toast(toastInfo);
      setToastInfo(null); 
    }
  }, [toastInfo, toast]);

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
        const activeBreakRecordInstance = persistedShift.breaks?.find(
          b => b.isScheduled && 
               b.scheduledBreakId === persistedShift.activeScheduledBreakInfo?.id && 
               !b.endTime 
        );
        if (activeBreakRecordInstance) {
            const nowMs = Date.now();
            const breakInstanceStartTimeMs = activeBreakRecordInstance.startTime;
            const originalDurationSec = persistedShift.activeScheduledBreakInfo.originalDurationSeconds;
            
            const expectedBreakEndTimeMs = breakInstanceStartTimeMs + (originalDurationSec * 1000);
            const remainingCountdownSec = Math.max(0, Math.floor((expectedBreakEndTimeMs - nowMs) / 1000));
            setScheduledBreakCountdown(remainingCountdownSec);
        } else {
            // Inconsistent state: status is on_scheduled_break, activeScheduledBreakInfo is set, 
            // but no matching active BreakRecord found. Revert to 'working'.
            setStatus('working');
            setCurrentShift(prev => prev ? ({ ...prev, activeScheduledBreakInfo: undefined }) : null);
            setScheduledBreakCountdown(null);
            console.warn("TimerContext: Restored 'on_scheduled_break' status but couldn't find active break record. Reverting to 'working'.");
        }
      }
    }
    setIsLoading(false);
  // Removing setCurrentShift, setStatus, setScheduledBreakCountdown from deps as they are updated inside.
  // setLastUnusedScheduledBreakTime is fine as it's initialized once here.
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
        // Keep UNUSED_BREAK_TIME_STORAGE_KEY if needed until next shift starts or explicitly cleared
      }
    }
  }, [currentShift, status, isLoading, settingsLoading, lastUnusedScheduledBreakTime]);

  const checkAndTriggerScheduledBreaks = useCallback(() => {
    if (currentShiftRef.current?.startTime && settings.scheduledBreaks.length && status === 'working') {
        const now = new Date();
        const currentDayName = ALL_DAYS[now.getDay()];
        const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

        for (const sb of settings.scheduledBreaks) {
            if (!sb.days.includes(currentDayName)) continue;

            const breakStartMinutes = parseInt(sb.startTime.split(':')[0]) * 60 + parseInt(sb.startTime.split(':')[1]);
            const breakEndMinutes = parseInt(sb.endTime.split(':')[0]) * 60 + parseInt(sb.endTime.split(':')[1]);

            if (currentTimeMinutes >= breakStartMinutes && currentTimeMinutes < breakEndMinutes) {
                // 1. Check if this specific scheduled break (by ID) is already the active one in context
                if (currentShiftRef.current.activeScheduledBreakInfo?.id === sb.id) continue;

                // 2. Check if there's an existing *active* (no endTime) BreakRecord for this scheduledBreakId
                const existingActiveRecordForThisBreak = currentShiftRef.current.breaks?.find(
                  b => b.isScheduled && b.scheduledBreakId === sb.id && !b.endTime
                );
                if (existingActiveRecordForThisBreak) continue;
                
                // 3. Check if a break record for this sb.id for the current day has already been fully completed.
                // This is to prevent re-triggering if user ended it early and is still within the original time window.
                // This check assumes a break ID is unique for its purpose within a day.
                const completedRecordForThisBreakToday = currentShiftRef.current.breaks?.find(
                    b => b.isScheduled && b.scheduledBreakId === sb.id && b.endTime &&
                         new Date(b.startTime).toDateString() === now.toDateString() // Ensure it's for today
                );
                if (completedRecordForThisBreakToday) continue;


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
                setLastUnusedScheduledBreakTime(0); 
                setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, 0); 
                setToastInfo({ title: "Scheduled Break Started", description: `${sb.name || 'Break'} has begun. Duration: ${formatTime(breakDurationSeconds)}` });
                return; 
            }
        }
    }
  }, [settings.scheduledBreaks, status, setToastInfo]);


  const calculateCurrentTimersAndEarnings = useCallback(() => {
    if (!currentShiftRef.current?.startTime) return;

    const nowMs = Date.now();
    let tempShiftForCalc: Shift = {
      id: currentShiftRef.current.id || 'temp_live_calc',
      startTime: currentShiftRef.current.startTime,
      endTime: nowMs,
      breaks: currentShiftRef.current.breaks || [],
      baseWageAtStart: currentShiftRef.current.baseWageAtStart || settings.baseWage,
    };
    
    const { totalEarnings, finalEffectiveRate } = calculateShiftEarnings(tempShiftForCalc, settings, true);
    setCurrentEarnings(totalEarnings);
    setEffectiveHourlyRate(finalEffectiveRate);

    let totalManualBreakDurationMs = 0;
    (currentShiftRef.current.breaks || []).forEach(br => {
      if (!br.isScheduled) { 
        const breakStartTime = br.startTime;
        const breakEndTime = br.endTime || (status === 'on_break' && currentShiftRef.current.breaks?.length && br.startTime === currentShiftRef.current.breaks[currentShiftRef.current.breaks.length - 1]?.startTime ? nowMs : 0);
        if (breakEndTime > breakStartTime) {
          totalManualBreakDurationMs += breakEndTime - breakStartTime;
        }
      }
    });
    const grossWorkTimeMs = nowMs - currentShiftRef.current.startTime;
    setElapsedWorkTime(Math.max(0, Math.floor((grossWorkTimeMs - totalManualBreakDurationMs) / 1000)));

    if (status === 'on_break') {
      const activeManualBreak = currentShiftRef.current.breaks?.find(b => !b.isScheduled && !b.endTime);
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
                const activeBreakInfo = currentShiftRef.current?.activeScheduledBreakInfo;
                const breakName = activeBreakInfo?.name || "Scheduled break";
                const breakEndTime = Date.now();
                
                setCurrentShift(prevCs => {
                    if (!prevCs || !activeBreakInfo) return null;
                    const updatedBreaks = (prevCs.breaks || []).map(b =>
                        (b.isScheduled && b.scheduledBreakId === activeBreakInfo.id && !b.endTime)
                        ? { ...b, endTime: breakEndTime } 
                        : b
                    );
                    return { ...prevCs, breaks: updatedBreaks, activeScheduledBreakInfo: undefined };
                });
                setStatus('working'); 
                setToastInfo({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
                return null; 
            }
            return newCountdown;
        });
    }
  }, [settings, status, setToastInfo ]);


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
      // Only reset these if currentShift is truly null (i.e., shift ended, not just loading)
      if (!currentShiftRef.current) {
        setElapsedWorkTime(0);
        setElapsedBreakTime(0);
        setCurrentEarnings(0);
        setEffectiveHourlyRate(0);
        setScheduledBreakCountdown(null);
      }
    }
  }, [status, isLoading, settingsLoading, calculateCurrentTimersAndEarnings, checkAndTriggerScheduledBreaks, currentShift]);


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
    setLastUnusedScheduledBreakTime(0); 
    setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, 0); 
    toast({ title: "Shift Started", description: "Your work shift has begun." });
  };

  const endShift = () => {
    if (status === 'idle' || !currentShiftRef.current?.startTime || isLoading || settingsLoading) return;

    let finalShiftProto = { ...currentShiftRef.current };
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
     // If ending shift while a scheduled break was active, clear its info
    if (status === 'on_scheduled_break' && finalShiftProto.activeScheduledBreakInfo) {
        finalShiftProto.activeScheduledBreakInfo = undefined;
    }
    
    const shiftForCalc: Shift = {
        id: finalShiftProto.id || `shift_${Date.now()}_err`,
        startTime: finalShiftProto.startTime!, 
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
    // Don't clear UNUSED_BREAK_TIME_STORAGE_KEY here, it's cleared on new shift start or new scheduled break start
    toast({ title: "Shift Ended", description: `Earnings: ${formatCurrency(totalEarnings)}.` });
  };

  const startManualBreak = () => {
    if (status !== 'working' || !currentShiftRef.current || isLoading || settingsLoading) return;
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
    if (status !== 'on_break' || !currentShiftRef.current || !currentShiftRef.current.breaks?.length || isLoading || settingsLoading) return;
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
    if (status !== 'on_scheduled_break' || !currentShiftRef.current?.activeScheduledBreakInfo || scheduledBreakCountdown === null || isLoading || settingsLoading) return;

    const breakName = currentShiftRef.current.activeScheduledBreakInfo.name || "Scheduled break";
    const remainingTime = scheduledBreakCountdown; 
    
    if (remainingTime > 0) {
      const newUnusedTime = lastUnusedScheduledBreakTime + remainingTime;
      setLastUnusedScheduledBreakTime(newUnusedTime);
      setToLocalStorage(UNUSED_BREAK_TIME_STORAGE_KEY, newUnusedTime); 
      setToastInfo({ title: "Scheduled Break Ended Early", description: `${breakName} ended. You have ${formatTime(remainingTime)} of unused time.` });
    } else {
      setToastInfo({ title: "Scheduled Break Ended", description: `${breakName} has finished.` });
    }

    const breakEndTime = Date.now();
    setCurrentShift(prev => {
      if (!prev || !prev.activeScheduledBreakInfo) return prev; 
      const activeBreakId = prev.activeScheduledBreakInfo.id;
      const updatedBreaks = (prev.breaks || []).map(b => 
        (b.isScheduled && b.scheduledBreakId === activeBreakId && !b.endTime) 
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

    