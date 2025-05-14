export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export const ALL_DAYS: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface DayAllowanceInput {
  day: DayOfWeek;
  percentage: number;
}

export interface HourlyAllowance {
  id: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  percentage: number; // Percentage ADDED to the base rate e.g. 25 for +25%
}

export interface ScheduledBreak {
  id: string;
  name?: string; // Optional name for the break
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  days: DayOfWeek[];
}

export interface AppSettings {
  baseWage: number;
  dayAllowances: Record<DayOfWeek, number>; // e.g. { Sunday: 200, Monday: 100 } means 200% on Sunday, 100% on Monday
  hourlyAllowances: HourlyAllowance[];
  scheduledBreaks: ScheduledBreak[];
}

export interface BreakRecord {
  startTime: number; // timestamp
  endTime?: number; // timestamp
  isScheduled: boolean; // To differentiate manual vs scheduled breaks
}

export interface RateSegment {
  percentage: number;
  durationSeconds: number;
}

export interface Shift {
  id:string;
  startTime: number; // timestamp
  endTime?: number; // timestamp
  breaks: BreakRecord[];
  totalEarnings?: number;
  baseWageAtStart: number;
  rateSegments?: RateSegment[]; // Breakdown of work by rate
  // Optionally, store effective allowances for review, or recompute on display
}
