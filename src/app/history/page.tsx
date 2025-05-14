"use client";

import { useWorkHistory } from '@/contexts/WorkHistoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime, formatShortTime, formatTime } from '@/lib/utils';
import type { Shift } from '@/types';
import { getWeek, format, startOfWeek, endOfWeek } from 'date-fns';
import { Trash2, Edit3, Briefcase } from 'lucide-react'; // Edit3 for edit icon
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';

// Group shifts by week
const groupShiftsByWeek = (shifts: Shift[]) => {
  const grouped: Record<string, { weekNumber: number; year: number; dateRange: string; shifts: Shift[]; totalHours: number; totalEarnings: number }> = {};
  
  shifts.forEach(shift => {
    const startDate = new Date(shift.startTime);
    const year = startDate.getFullYear();
    const weekNumber = getWeek(startDate, { weekStartsOn: 1 /* Monday */ });
    const weekKey = `${year}-W${weekNumber.toString().padStart(2, '0')}`;

    if (!grouped[weekKey]) {
      const firstDayOfWeek = startOfWeek(startDate, { weekStartsOn: 1 });
      const lastDayOfWeek = endOfWeek(startDate, { weekStartsOn: 1 });
      grouped[weekKey] = {
        weekNumber,
        year,
        dateRange: `${format(firstDayOfWeek, 'MMM d')} - ${format(lastDayOfWeek, 'MMM d, yyyy')}`,
        shifts: [],
        totalHours: 0,
        totalEarnings: 0,
      };
    }
    grouped[weekKey].shifts.push(shift);
    
    const durationMs = (shift.endTime || Date.now()) - shift.startTime - (shift.breaks.reduce((acc, b) => acc + ((b.endTime || Date.now()) - b.startTime), 0));
    grouped[weekKey].totalHours += durationMs / (1000 * 60 * 60);
    grouped[weekKey].totalEarnings += shift.totalEarnings || 0;
  });

  return Object.values(grouped).sort((a,b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.weekNumber - a.weekNumber;
  });
};


export default function WorkHistoryPage() {
  const { workHistory, deleteShift, isLoading } = useWorkHistory();
  const { toast } = useToast();

  if (isLoading) {
    return <p>Loading work history...</p>;
  }

  if (workHistory.length === 0) {
    return (
      <div className="text-center py-10">
        <Briefcase className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-2 text-xl font-semibold">No Work History</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Start tracking your shifts to see your work history here.
        </p>
      </div>
    );
  }

  const groupedShifts = groupShiftsByWeek(workHistory);

  const handleDeleteShift = (shiftId: string) => {
    deleteShift(shiftId);
    toast({ title: "Shift Deleted", description: "The shift has been removed from your history." });
  };

  return (
    <Accordion type="multiple" className="w-full space-y-4">
      {groupedShifts.map((weekData, index) => (
        <AccordionItem value={`week-${weekData.year}-${weekData.weekNumber}`} key={weekData.weekKey || index} className="border rounded-lg shadow-sm bg-card">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex justify-between items-center w-full">
              <div>
                <h3 className="text-lg font-semibold">Week {weekData.weekNumber} <span className="text-sm text-muted-foreground">({weekData.year})</span></h3>
                <p className="text-sm text-muted-foreground">{weekData.dateRange}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatCurrency(weekData.totalEarnings)}</p>
                <p className="text-xs text-muted-foreground">{weekData.totalHours.toFixed(2)} hours</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-4 pt-0">
            <div className="space-y-3">
              {weekData.shifts.sort((a,b) => b.startTime - a.startTime).map(shift => {
                const shiftDurationMs = (shift.endTime || shift.startTime) - shift.startTime;
                const totalBreakDurationMs = shift.breaks.reduce((acc, b) => acc + ((b.endTime || b.startTime) - b.startTime), 0);
                const netWorkDurationSeconds = Math.max(0, (shiftDurationMs - totalBreakDurationMs) / 1000);
                
                return (
                  <Card key={shift.id} className="bg-background/50 dark:bg-background/20">
                    <CardHeader className="pb-2 pt-3 px-4">
                       <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-md">{format(new Date(shift.startTime), 'EEEE, MMM d, yyyy')}</CardTitle>
                          <CardDescription className="text-xs">
                            {formatShortTime(shift.startTime)} - {shift.endTime ? formatShortTime(shift.endTime) : 'Ongoing'}
                          </CardDescription>
                        </div>
                        <div className="flex space-x-1">
                          {/* Edit button placeholder - functionality not implemented in this iteration */}
                          {/* <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
                            <Edit3 className="h-4 w-4" />
                          </Button> */}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Shift?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete this shift? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteShift(shift.id)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm px-4 pb-3">
                      <p>Duration: {formatTime(netWorkDurationSeconds)}</p>
                      <p>Earnings: <span className="font-medium">{formatCurrency(shift.totalEarnings || 0)}</span></p>
                       {shift.breaks.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Breaks: {shift.breaks.length} ({formatTime(totalBreakDurationMs / 1000)} total)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
