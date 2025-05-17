
"use client";

import { Header } from '@/components/shared/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useTimer } from '@/contexts/TimerContext';
import { useSettings } from '@/contexts/SettingsContext';
import { formatTime, formatCurrency, formatShortTime } from '@/lib/utils';
import { Play, Square, Pause, RotateCcw, AlertCircle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { Shift } from '@/types'; 
import { calculateShiftEarnings } from '@/lib/wageCalculator';


export default function DashboardPage() {
  const { 
    status, 
    currentShift, 
    elapsedWorkTime, 
    elapsedBreakTime, // This is for manual breaks
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
    isLoading: timerLoading,
  } = useTimer();
  const { settings, isLoading: settingsLoading } = useSettings();

  const handleResetShift = () => {
    resetActiveShift();
  };

  if (settingsLoading || timerLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center">
          <p>Loading timer and settings...</p>
        </main>
      </div>
    );
  }
  
  const baseWageDisplay = formatCurrency(settings.baseWage);
  let currentRateDisplay = formatCurrency(effectiveHourlyRate);
  let currentPercentageDisplay = 0;

  if (status !== 'idle' && currentShift && currentShift.startTime && settings) {
    const tempShiftForPercentage: Shift = {
      id: currentShift.id || 'temp',
      startTime: currentShift.startTime,
      endTime: Date.now(), 
      breaks: currentShift.breaks || [],
      baseWageAtStart: currentShift.baseWageAtStart || settings.baseWage,
      activeScheduledBreakInfo: currentShift.activeScheduledBreakInfo,
    };
    const earningsDetails = calculateShiftEarnings(tempShiftForPercentage, settings, true);
    currentPercentageDisplay = earningsDetails.finalTotalPercentage;
    // Re-calculate effectiveHourlyRate for display based on the latest percentage
    currentRateDisplay = formatCurrency(settings.baseWage * (currentPercentageDisplay / 100));

  }


  let cardTitleText = "Ready to Work?";
  let timerLabelText = "Session Timer";
  let timerDisplayValue = status === 'idle' ? 0 : elapsedWorkTime;

  if (status === 'working') {
    cardTitleText = "Work in Progress";
    timerLabelText = "Time Worked";
    timerDisplayValue = elapsedWorkTime;
  } else if (status === 'on_break') { // Manual break
    cardTitleText = "On Manual Break";
    timerLabelText = "Manual Break Time";
    timerDisplayValue = elapsedBreakTime;
  } else if (status === 'on_scheduled_break') {
    cardTitleText = `Scheduled Break: ${currentShift?.activeScheduledBreakInfo?.name || 'Active'}`;
    timerLabelText = `${currentShift?.activeScheduledBreakInfo?.name || 'Scheduled Break'} Remaining`;
    timerDisplayValue = scheduledBreakCountdown ?? 0;
  } else if (status === 'idle' && currentShift) { // Ended shift, show final stats briefly if needed or just reset view
    cardTitleText = "Shift Ended";
    timerLabelText = "Last Session";
  }


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-secondary/30 dark:from-background dark:to-secondary/10">
      <Header />
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 flex flex-col items-center justify-center">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">
              {cardTitleText}
            </CardTitle>
            {currentShift?.startTime && (
              <CardDescription>
                Started at: {formatShortTime(currentShift.startTime)}
                {status === 'on_break' && currentShift.breaks?.find(b => !b.endTime && !b.isScheduled) && 
                  ` (Break started: ${formatShortTime(currentShift.breaks[currentShift.breaks.length-1].startTime)})`
                }
                {status === 'on_scheduled_break' && currentShift.activeScheduledBreakInfo && 
                  ` (Scheduled break started: ${formatShortTime(currentShift.breaks.find(b => b.isScheduled && b.scheduledBreakId === currentShift.activeScheduledBreakInfo?.id && !b.endTime)?.startTime || Date.now())})`
                }
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                {timerLabelText}
              </p>
              <p className="text-6xl font-bold tracking-tighter text-primary">
                {formatTime(timerDisplayValue)}
              </p>
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">Earnings</p>
              <p className="text-4xl font-semibold text-accent">
                {formatCurrency(currentEarnings)}
              </p>
              <div className="text-xs text-muted-foreground mt-1 space-x-2">
                <span>Base: {baseWageDisplay}/hr</span>
                {(status === 'working' || status === 'on_break' || status === 'on_scheduled_break') && currentShift?.startTime && (
                  <span>Current Rate: {currentPercentageDisplay}% ({currentRateDisplay}/hr)</span>
                )}
              </div>
            </div>
            
            {lastUnusedScheduledBreakTime > 0 && status !== 'on_scheduled_break' && (
              <div className="p-3 mt-2 rounded-md border border-yellow-500 bg-yellow-50 dark:bg-yellow-900/30 text-center">
                <div className="flex items-center justify-center text-sm text-yellow-700 dark:text-yellow-300">
                  <AlertCircle className="h-4 w-4 mr-2" />
                  <span>You have {formatTime(lastUnusedScheduledBreakTime)} of unused scheduled break time.</span>
                </div>
              </div>
            )}


            <div className="grid grid-cols-2 gap-4 pt-4">
              {status === 'idle' && (
                <Button size="lg" onClick={startShift} className="col-span-2 bg-green-500 hover:bg-green-600 text-white">
                  <Play className="mr-2 h-5 w-5" /> Start Shift
                </Button>
              )}

              {status === 'working' && (
                <>
                  <Button size="lg" variant="outline" onClick={startManualBreak}>
                    <Pause className="mr-2 h-5 w-5" /> Take Manual Break
                  </Button>
                  <Button size="lg" onClick={endShift} variant="destructive">
                    <Square className="mr-2 h-5 w-5" /> End Shift
                  </Button>
                </>
              )}

              {status === 'on_break' && ( // Manual break
                <>
                  <Button size="lg" onClick={endManualBreak} className="bg-blue-500 hover:bg-blue-600 text-white">
                    <Play className="mr-2 h-5 w-5" /> End Manual Break
                  </Button>
                  <Button size="lg" onClick={endShift} variant="destructive">
                    <Square className="mr-2 h-5 w-5" /> End Shift
                  </Button>
                </>
              )}

              {status === 'on_scheduled_break' && (
                 <>
                  <Button size="lg" onClick={endScheduledBreakEarly} className="bg-orange-500 hover:bg-orange-600 text-white">
                    <Play className="mr-2 h-5 w-5" /> End Scheduled Break Early
                  </Button>
                   <Button size="lg" onClick={endShift} variant="destructive">
                    <Square className="mr-2 h-5 w-5" /> End Shift
                  </Button>
                </>
              )}
            </div>
             {(status !== 'idle' && currentShift?.startTime) && (
               <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full mt-2 text-muted-foreground">
                      <RotateCcw className="mr-2 h-4 w-4" /> Reset Current Shift
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will discard the current active shift and all its data. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleResetShift} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Reset Shift
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
    
