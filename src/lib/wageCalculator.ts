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
  const dayOfWeek = ALL_DAYS[dateTime.getDay()];
  
  // Day allowance percentage (e.g., 100 for 100%, 200 for 200%)
  const dayAllowancePercent = settings.dayAllowances[dayOfWeek] || 100;

  // Find applicable hourly allowance percentage (additive bonus)
  let hourlyBonusPercent = 0;
  const currentTime = `${dateTime.getHours().toString().padStart(2, '0')}:${dateTime.getMinutes().toString().padStart(2, '0')}`;

  for (const ha of settings.hourlyAllowances) {
    if (currentTime >= ha.startTime && currentTime <= ha.endTime) {
      hourlyBonusPercent = Math.max(hourlyBonusPercent, ha.percentage); // Take the highest applicable hourly bonus
    }
  }
  
  // Total percentage: Day's base rate + hourly bonus
  // E.g., Sunday 200% (dayAllowancePercent = 200) and Evening +25% (hourlyBonusPercent = 25)
  // Total = 200% (from day) + 25% (hourly bonus) = 225%
  const totalPercentage = dayAllowancePercent + hourlyBonusPercent;
  const effectiveRate = baseWage * (totalPercentage / 100);
  
  return { rate: effectiveRate, percentage: totalPercentage };
}


/**
 * Calculates total earnings for a given shift.
 * This version iterates minute by minute for accuracy with changing rates.
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

  // Iterate minute by minute from shift start to end
  for (let t = shift.startTime; t < endTime; t += 60000) { // 60000 ms = 1 minute
    const currentTime = new Date(t);
    
    // Check if current minute is within a break
    let onBreak = false;
    for (const br of shift.breaks) {
      const breakStartTime = br.startTime;
      const breakEndTime = isLiveCalculation && !br.endTime && br.startTime === shift.breaks[shift.breaks.length-1]?.startTime ? Date.now() : (br.endTime || Date.now());
      if (t >= breakStartTime && t < breakEndTime) {
        onBreak = true;
        break;
      }
    }

    if (!onBreak) {
      currentRateInfo = getEffectiveHourlyRate(currentTime, settings);
      totalEarnings += currentRateInfo.rate / 60; // Earnings for one minute
    }
  }
  
  // If it's a live calculation, the finalEffectiveRate is the rate right now.
  // Otherwise, if the shift is ended, it might be less relevant or could be an average.
  // For simplicity, let's use the rate at the very end of the calculation period (or now for live).
  const finalRateMoment = new Date(endTime - 1); // moment just before end
  const finalRateDetails = getEffectiveHourlyRate(finalRateMoment, settings);


  return { 
    totalEarnings: parseFloat(totalEarnings.toFixed(2)), 
    finalEffectiveRate: parseFloat(finalRateDetails.rate.toFixed(2)),
    finalTotalPercentage: finalRateDetails.percentage
  };
}
