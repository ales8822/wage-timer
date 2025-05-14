import type { Shift, AppSettings, DayOfWeek, HourlyAllowance, RateSegment } from '@/types';
import { ALL_DAYS } from '@/types';

const SECONDS_IN_HOUR = 3600;

/**
 * Calculates the effective hourly rate at a specific moment in time.
 * @param dateTime The specific date and time (timestamp or Date object).
 * @param settings The application settings.
 * @returns The effective hourly rate and the total percentage applied.
 */
export function getEffectiveHourlyRate(dateTime: Date, settings: AppSettings): { rate: number, percentage: number } {
  const baseWage = settings.baseWage;
  const dayIndex = dateTime.getDay(); // 0 = Sunday
  const dayOfWeek = ALL_DAYS[dayIndex];
  
  const dayAllowancePercent = settings.dayAllowances[dayOfWeek] || 100;

  let hourlyBonusPercent = 0;
  const currentHour = dateTime.getHours();
  const currentMinute = dateTime.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;

  for (const ha of settings.hourlyAllowances) {
    const allowanceStartMinutes = parseInt(ha.startTime.split(':')[0]) * 60 + parseInt(ha.startTime.split(':')[1]);
    let allowanceEndMinutes = parseInt(ha.endTime.split(':')[0]) * 60 + parseInt(ha.endTime.split(':')[1]);
    
    // Handle midnight crossing for end time (e.g., 22:00 - 02:00)
    // If end time is earlier than start time, it means it crosses midnight.
    // For calculations within a single day iteration, this means:
    // - If current time is >= start time, it's in the first part of the allowance.
    // - If current time is < end time (early morning), it's in the second part (after midnight).
    // However, our per-minute iteration handles this naturally by just checking if current time is within a slot.
    // The problem is when allowanceEndMinutes < allowanceStartMinutes due to crossing midnight.
    // For this function, which evaluates a *specific moment*, we just check if the time falls in the range.
    // The current schema has a refine check `endTime > startTime`, so midnight crossing isn't directly supported for a single entry.
    // We assume end time is on the same day or up to 23:59. For 24:00 it should be 00:00 of next day.
    // Standard representation: 17:00 - 18:00 (exclusive end).
    
    if (currentTimeInMinutes >= allowanceStartMinutes && currentTimeInMinutes < allowanceEndMinutes) {
      hourlyBonusPercent = Math.max(hourlyBonusPercent, ha.percentage); 
    }
  }
  
  const totalPercentage = dayAllowancePercent + hourlyBonusPercent;
  const effectiveRate = baseWage * (totalPercentage / 100);
  
  return { rate: effectiveRate, percentage: totalPercentage };
}


/**
 * Calculates total earnings and rate breakdown for a given shift.
 * Iterates minute by minute for accuracy with changing rates and breaks.
 * @param shift The shift details.
 * @param settings The application settings.
 * @param isLiveCalculation If true, calculates up to 'now' for an ongoing shift.
 * @returns Total earnings, final effective rate details, and rate segments.
 */
export function calculateShiftEarnings(
  shift: Shift, 
  settings: AppSettings, 
  isLiveCalculation: boolean = false
): { 
  totalEarnings: number; 
  finalEffectiveRate: number; 
  finalTotalPercentage: number;
  rateSegments: RateSegment[];
} {
  if (!shift.startTime) {
    return { totalEarnings: 0, finalEffectiveRate: 0, finalTotalPercentage: 0, rateSegments: [] };
  }

  const endTime = isLiveCalculation ? Date.now() : (shift.endTime || Date.now());
  let totalEarnings = 0;
  const rateWorkDurations: Map<number, number> = new Map(); // Map<percentage, durationSeconds>

  for (let t = shift.startTime; t < endTime; t += 60000) { // 60000 ms = 1 minute
    const currentTimeIter = new Date(t);
    
    let onBreak = false;
    
    // 1. Check manual breaks
    for (const br of shift.breaks) {
      const breakStartTime = br.startTime;
      const breakEndTime = (isLiveCalculation && !br.endTime && br.startTime === shift.breaks[shift.breaks.length - 1]?.startTime) 
                           ? Date.now() 
                           : (br.endTime || (isLiveCalculation ? Date.now() : t + 59999) ); // If no end time, and not live, assume break ends within current minute for safety, or if live, now.

      if (t >= breakStartTime && t < breakEndTime) {
        onBreak = true;
        break;
      }
    }

    // 2. If not on a manual break, check scheduled breaks
    if (!onBreak) {
      const currentDayIndex = currentTimeIter.getDay();
      const currentDayOfWeek = ALL_DAYS[currentDayIndex];
      const currentIterHour = currentTimeIter.getHours();
      const currentIterMinute = currentTimeIter.getMinutes();
      const currentIterTimeInMinutes = currentIterHour * 60 + currentIterMinute;

      for (const sb of settings.scheduledBreaks) {
        if (sb.days.includes(currentDayOfWeek)) {
          const scheduledStartMinutes = parseInt(sb.startTime.split(':')[0]) * 60 + parseInt(sb.startTime.split(':')[1]);
          const scheduledEndMinutes = parseInt(sb.endTime.split(':')[0]) * 60 + parseInt(sb.endTime.split(':')[1]);

          if (currentIterTimeInMinutes >= scheduledStartMinutes && currentIterTimeInMinutes < scheduledEndMinutes) {
            onBreak = true;
            break;
          }
        }
      }
    }

    if (!onBreak) {
      const minuteRateInfo = getEffectiveHourlyRate(currentTimeIter, settings);
      const currentPercentage = minuteRateInfo.percentage;
      
      rateWorkDurations.set(currentPercentage, (rateWorkDurations.get(currentPercentage) || 0) + 60); // Add 60 seconds
      totalEarnings += minuteRateInfo.rate / 60; // Earnings for one minute
    }
  }
  
  const finalRateMoment = new Date(Math.max(shift.startTime, endTime - (endTime > shift.startTime ? 1 : 0) )); // Ensure finalRateMoment is not before startTime
  const finalRateDetails = getEffectiveHourlyRate(finalRateMoment, settings);

  const rateSegmentsResult = Array.from(rateWorkDurations.entries())
    .map(([percentage, durationSeconds]) => ({ percentage, durationSeconds }))
    .sort((a, b) => a.percentage - b.percentage);

  return { 
    totalEarnings: parseFloat(totalEarnings.toFixed(2)), 
    finalEffectiveRate: parseFloat(finalRateDetails.rate.toFixed(2)),
    finalTotalPercentage: finalRateDetails.percentage,
    rateSegments: rateSegmentsResult,
  };
}
