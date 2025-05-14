"use client";

import { Header } from '@/components/shared/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useTimer } from '@/contexts/TimerContext';
import { useSettings } from '@/contexts/SettingsContext';
import { formatTime, formatCurrency, formatShortTime } from '@/lib/utils';
import { Play, Square, Pause, RotateCcw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function DashboardPage() {
  const { 
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
  } = useTimer();
  const { settings, isLoading: settingsLoading } = useSettings();

  const handleResetShift = () => {
    resetActiveShift();
  };

  if (settingsLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center">
          <p>Loading settings...</p>
        </main>
      </div>
    );
  }
  
  const baseWageDisplay = formatCurrency(settings.baseWage);
  const currentRateDisplay = formatCurrency(effectiveHourlyRate);
  const currentPercentageDisplay = calculateShiftEarnings(currentShift as any, settings, true).finalTotalPercentage;


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-secondary/30 dark:from-background dark:to-secondary/10">
      <Header />
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 flex flex-col items-center justify-center">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">
              {status === 'idle' && "Ready to Work?"}
              {status === 'working' && "Work in Progress"}
              {status === 'on_break' && "On Break"}
            </CardTitle>
            {currentShift?.startTime && (
              <CardDescription>
                Started at: {formatShortTime(currentShift.startTime)}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                {status === 'working' ? "Time Worked" : status === 'on_break' ? "Break Time" : "Session Timer"}
              </p>
              <p className="text-6xl font-bold tracking-tighter text-primary">
                {status === 'on_break' ? formatTime(elapsedBreakTime) : formatTime(elapsedWorkTime)}
              </p>
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">Earnings</p>
              <p className="text-4xl font-semibold text-accent">
                {formatCurrency(currentEarnings)}
              </p>
              <div className="text-xs text-muted-foreground mt-1 space-x-2">
                <span>Base: {baseWageDisplay}/hr</span>
                {status !== 'idle' && (
                  <span>Current: {currentPercentageDisplay}% ({currentRateDisplay}/hr)</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4">
              {status === 'idle' && (
                <Button size="lg" onClick={startShift} className="col-span-2 bg-green-500 hover:bg-green-600 text-white">
                  <Play className="mr-2 h-5 w-5" /> Start Shift
                </Button>
              )}

              {status === 'working' && (
                <>
                  <Button size="lg" variant="outline" onClick={startBreak}>
                    <Pause className="mr-2 h-5 w-5" /> Take a Break
                  </Button>
                  <Button size="lg" onClick={endShift} variant="destructive">
                    <Square className="mr-2 h-5 w-5" /> End Shift
                  </Button>
                </>
              )}

              {status === 'on_break' && (
                <>
                  <Button size="lg" onClick={endBreak} className="col-span-2 bg-blue-500 hover:bg-blue-600 text-white">
                    <Play className="mr-2 h-5 w-5" /> End Break
                  </Button>
                </>
              )}
            </div>
             {status !== 'idle' && (
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
