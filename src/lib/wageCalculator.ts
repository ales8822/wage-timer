import type { Shift, AppSettings, DayOfWeek, HourlyAllowance } from '@/types';
import { ALL_DAYS } from '@/types';

const SECONDS_IN_HOUR = 3600;

/**
 * Calculates the effective hourly rate at a specific moment in time.
 * @param dateTime The specific date and time (timestamp or Date object).
 * @param settings The application settings.
 * @returns The effective hourly rate.
 */
export function getEffectiveHourlyRate(dateTime: Date, settings: AppSettings): { rate: number, percentage: number } {
  const baseWage = settings.baseWage;
  const dayOfWeek = ALL_DAYS[dateTime.getDay()]; // 0 = Sunday, 1 = Monday, etc.
  
  // Day allowance percentage (e.g., 100 for 100%, 200 for 200%)
  const dayAllowancePercent = settings.dayAllowances[dayOfWeek] || 100;

  // Find applicable hourly allowance percentage (additive bonus)
  let hourlyBonusPercent = 0;
  const currentHour = dateTime.getHours();
  const currentMinute = dateTime.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;

  for (const ha of settings.hourlyAllowances) {
    const allowanceStartMinutes = parseInt(ha.startTime.split(':')[0]) * 60 + parseInt(ha.startTime.split(':')[1]);
    const allowanceEndMinutes = parseInt(ha.endTime.split(':')[0]) * 60 + parseInt(ha.endTime.split(':')[1]);
    
    // Assuming allowances do not cross midnight (startTime < endTime as per schema)
    // The end time for allowances is exclusive (e.g., 17:00-18:00 means up to 17:59)
    if (currentTimeInMinutes >= allowanceStartMinutes && currentTimeInMinutes < allowanceEndMinutes) {
      hourlyBonusPercent = Math.max(hourlyBonusPercent, ha.percentage); 
    }
  }
  
  const totalPercentage = dayAllowancePercent + hourlyBonusPercent;
  const effectiveRate = baseWage * (totalPercentage / 100);
  
  return { rate: effectiveRate, percentage: totalPercentage };
}


/**
 * Calculates total earnings for a given shift.
 * This version iterates minute by minute for accuracy with changing rates and scheduled breaks.
 * @param shift The shift details.
 * @param settings The application settings.
 * @param isLiveCalculation If true, calculates up to 'now' for an ongoing shift.
 * @returns Total earnings for the shift and the final effective rate if live.
 */
export function calculateShiftEarnings(shift: Shift, settings: AppSettings, isLiveCalculation: boolean = false): { totalEarnings: number; finalEffectiveRate: number, finalTotalPercentage: number } {
  if (!shift.startTime) return { totalEarnings: 0, finalEffectiveRate: 0, finalTotalPercentage: 0 };

  const endTime = isLiveCalculation ? Date.now() : (shift.endTime || Date.now());
  let totalEarnings = 0;
  let currentRateInfo = { rate: 0, percentage: 0 };

  for (let t = shift.startTime; t < endTime; t += 60000) { // 60000 ms = 1 minute
    const currentTimeIter = new Date(t);
    
    let onBreak = false;
    
    // 1. Check manual breaks from shift.breaks
    for (const br of shift.breaks) {
      const breakStartTime = br.startTime;
      const breakEndTime = (isLiveCalculation && !br.endTime && br.startTime === shift.breaks[shift.breaks.length-1]?.startTime) 
                           ? Date.now() 
                           : (br.endTime || t); // Use 't' if endTime is missing and not live, to cap at current iteration

      if (t >= breakStartTime && t < breakEndTime) {
        onBreak = true;
        break;
      }
    }

    // 2. If not on a manual break, check applicable scheduled breaks from settings
    if (!onBreak) {
      const currentDayOfWeek = ALL_DAYS[currentTimeIter.getDay()];
      const currentIterHour = currentTimeIter.getHours();
      const currentIterMinute = currentTimeIter.getMinutes();
      const currentIterTimeInMinutes = currentIterHour * 60 + currentIterMinute;

      for (const sb of settings.scheduledBreaks) {
        if (sb.days.includes(currentDayOfWeek)) {
          const scheduledStartMinutes = parseInt(sb.startTime.split(':')[0]) * 60 + parseInt(sb.startTime.split(':')[1]);
          const scheduledEndMinutes = parseInt(sb.endTime.split(':')[0]) * 60 + parseInt(sb.endTime.split(':')[1]);

          // Assuming scheduled breaks do not cross midnight (startTime < endTime as per schema)
          // The end time for scheduled breaks is exclusive
          if (currentIterTimeInMinutes >= scheduledStartMinutes && currentIterTimeInMinutes < scheduledEndMinutes) {
            onBreak = true;
            break;
          }
        }
      }
    }

    if (!onBreak) {
      currentRateInfo = getEffectiveHourlyRate(currentTimeIter, settings);
      totalEarnings += currentRateInfo.rate / 60; // Earnings for one minute
    }
  }
  
  const finalRateMoment = new Date(Math.max(shift.startTime, endTime - 1)); // Ensure finalRateMoment is not before startTime
  const finalRateDetails = getEffectiveHourlyRate(finalRateMoment, settings);

  return { 
    totalEarnings: parseFloat(totalEarnings.toFixed(2)), 
    finalEffectiveRate: parseFloat(finalRateDetails.rate.toFixed(2)),
    finalTotalPercentage: finalRateDetails.percentage
  };
}
