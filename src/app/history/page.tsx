
"use client";

import { useWorkHistory } from '@/contexts/WorkHistoryContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDateTime, formatShortTime, formatTime } from '@/lib/utils';
import type { Shift } from '@/types';
import { getWeek, format, startOfWeek, endOfWeek } from 'date-fns';
import { Trash2, Briefcase, Info, Coffee, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';

// Group shifts by week
const groupShiftsByWeek = (shifts: Shift[]) => {
  const grouped: Record<string, { weekNumber: number; year: number; dateRange: string; shifts: Shift[]; totalHours: number; totalEarnings: number, weekKey: string }> = {};
  
  shifts.forEach(shift => {
    if (!shift.startTime) return; 
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
        weekKey,
        dateRange: `${format(firstDayOfWeek, 'MMM d')} - ${format(lastDayOfWeek, 'MMM d, yyyy')}`,
        shifts: [],
        totalHours: 0, 
        totalEarnings: 0,
      };
    }
    grouped[weekKey].shifts.push(shift);
    
    const netWorkDurationSeconds = shift.rateSegments 
      ? shift.rateSegments.reduce((sum, seg) => sum + seg.durationSeconds, 0)
      : 0;

    grouped[weekKey].totalHours += netWorkDurationSeconds / 3600;
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
      {groupedShifts.map((weekData) => (
        <AccordionItem value={weekData.weekKey} key={weekData.weekKey} className="border rounded-lg shadow-sm bg-card">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex justify-between items-center w-full">
              <div>
                <h3 className="text-lg font-semibold">Week {weekData.weekNumber} <span className="text-sm text-muted-foreground">({weekData.year})</span></h3>
                <p className="text-sm text-muted-foreground">{weekData.dateRange}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatCurrency(weekData.totalEarnings)}</p>
                <p className="text-xs text-muted-foreground">{weekData.totalHours.toFixed(2)} paid hours</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-4 pt-0">
            <div className="space-y-3">
              {weekData.shifts.sort((a,b) => b.startTime - a.startTime).map(shift => {
                if (!shift.startTime || !shift.endTime) return null; 

                const totalShiftDurationMs = shift.endTime - shift.startTime;
                const totalShiftDurationSeconds = Math.max(0, totalShiftDurationMs / 1000);
                
                const netPaidDurationSeconds = shift.rateSegments 
                  ? shift.rateSegments.reduce((sum, seg) => sum + seg.durationSeconds, 0)
                  : 0;

                const manualBreaks = shift.breaks.filter(b => !b.isScheduled);
                const totalManualBreakDurationMs = manualBreaks.reduce((acc, b) => {
                    const breakEndTime = b.endTime || shift.endTime!; 
                    return acc + Math.max(0, breakEndTime - b.startTime);
                }, 0);

                const scheduledBreaksTaken = shift.breaks.filter(b => b.isScheduled);
                const totalScheduledBreakDurationMs = scheduledBreaksTaken.reduce((acc, b) => {
                    const breakEndTime = b.endTime || shift.endTime!;
                    return acc + Math.max(0, breakEndTime - b.startTime);
                }, 0);
                
                return (
                  <Card key={shift.id} className="bg-background/50 dark:bg-background/20">
                    <CardHeader className="pb-2 pt-3 px-4">
                       <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-md">{format(new Date(shift.startTime), 'EEEE, MMM d, yyyy')}</CardTitle>
                          <CardDescription className="text-xs">
                            {formatShortTime(shift.startTime)} - {formatShortTime(shift.endTime)}
                          </CardDescription>
                        </div>
                        <div className="flex space-x-1">
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
                    <CardContent className="text-sm px-4 pb-3 space-y-1">
                      <p>Total Shift Duration: {formatTime(totalShiftDurationSeconds)}</p>
                      <p>Net Paid Duration: {formatTime(netPaidDurationSeconds)}</p>
                      <p>Earnings: <span className="font-medium">{formatCurrency(shift.totalEarnings || 0)}</span></p>
                      
                      {manualBreaks.length > 0 && (
                        <p className="text-xs text-muted-foreground flex items-center">
                           <User className="mr-1 h-3 w-3"/> Manual Breaks: {manualBreaks.length} ({formatTime(totalManualBreakDurationMs / 1000)} total)
                        </p>
                      )}
                      {scheduledBreaksTaken.length > 0 && (
                         <p className="text-xs text-muted-foreground flex items-center">
                           <Coffee className="mr-1 h-3 w-3"/> Scheduled Breaks Taken: {scheduledBreaksTaken.length} ({formatTime(totalScheduledBreakDurationMs / 1000)} total)
                         </p>
                      )}
                      {shift.unusedScheduledBreakSeconds && shift.unusedScheduledBreakSeconds > 0 && (
                        <p className="text-xs text-muted-foreground">
                           Unused Scheduled Break: {formatTime(shift.unusedScheduledBreakSeconds)}
                        </p>
                      )}

                      {shift.rateSegments && shift.rateSegments.length > 0 && (
                        <Accordion type="single" collapsible className="w-full mt-2 text-xs">
                          <AccordionItem value={`rate-breakdown-${shift.id}`} className="border-none">
                            <AccordionTrigger className="py-1 px-2 text-muted-foreground hover:no-underline hover:bg-muted/50 rounded-md flex items-center justify-start text-left">
                              <Info className="mr-2 h-3 w-3" /> View Earnings Breakdown
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 pb-1 px-0">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="h-8 px-2">Percentage</TableHead>
                                    <TableHead className="h-8 px-2">Duration</TableHead>
                                    <TableHead className="h-8 px-2 text-right">Rate (/hr)</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {shift.rateSegments.map((segment, idx) => (
                                    <TableRow key={idx}>
                                      <TableCell className="py-1 px-2">{segment.percentage}%</TableCell>
                                      <TableCell className="py-1 px-2">{formatTime(segment.durationSeconds)}</TableCell>
                                      <TableCell className="py-1 px-2 text-right">
                                        {formatCurrency((shift.baseWageAtStart * segment.percentage) / 100)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
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
