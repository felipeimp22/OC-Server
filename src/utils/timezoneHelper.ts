/**
 * @fileoverview Timezone-aware scheduling utility.
 *
 * All timer steps in the flow engine respect the restaurant's timezone.
 * This utility converts between UTC and restaurant-local time using
 * the `date-fns` and `date-fns-tz` compatible approach with native Intl.
 *
 * @module utils/timezoneHelper
 */

import { addHours, addMinutes, addDays, setHours, setMinutes, getDay } from 'date-fns';

/**
 * Calculate the next execution time based on a delay.
 *
 * @param duration - Delay amount
 * @param unit - Delay unit ('minutes' | 'hours' | 'days')
 * @param fromDate - Base date (defaults to now)
 * @returns The target execution time in UTC
 */
export function calculateDelayTarget(
  duration: number,
  unit: 'minutes' | 'hours' | 'days',
  fromDate: Date = new Date(),
): Date {
  switch (unit) {
    case 'minutes':
      return addMinutes(fromDate, duration);
    case 'hours':
      return addHours(fromDate, duration);
    case 'days':
      return addDays(fromDate, duration);
    default:
      throw new Error(`Unknown delay unit: ${unit}`);
  }
}

/**
 * Calculate the next valid execution time considering weekdays and time constraints.
 * Used by the "advanced" timer node type.
 *
 * @param options - Advanced timer configuration
 * @param options.delay - Initial delay amount
 * @param options.unit - Initial delay unit
 * @param options.weekdays - Allowed weekdays (0 = Sunday, 6 = Saturday)
 * @param options.time - Target time in "HH:mm" format (in restaurant timezone)
 * @param options.timezone - Restaurant timezone (e.g., "America/New_York")
 * @returns Next valid execution time in UTC
 */
export function calculateAdvancedTimerTarget(options: {
  delay: number;
  unit: 'minutes' | 'hours' | 'days';
  weekdays?: number[];
  time?: string;
  timezone?: string;
}): Date {
  const { delay, unit, weekdays, time, timezone } = options;

  // Start with the basic delay
  let target = calculateDelayTarget(delay, unit);

  // If specific time is set, adjust to that time in the restaurant's timezone
  if (time) {
    const [hours, minutes] = time.split(':').map(Number);
    if (hours !== undefined && minutes !== undefined) {
      // Convert target to restaurant timezone, set time, convert back
      target = adjustToTimezone(target, hours, minutes, timezone ?? 'UTC');
    }
  }

  // If weekdays are specified, advance to the next valid weekday
  if (weekdays && weekdays.length > 0) {
    let maxIterations = 7;
    while (!weekdays.includes(getDay(target)) && maxIterations > 0) {
      target = addDays(target, 1);
      maxIterations--;
    }
  }

  return target;
}

/**
 * Adjust a date to a specific hour/minute in a given timezone.
 * Uses the Intl API for timezone conversion.
 *
 * @param date - Base date
 * @param hours - Target hours (0-23)
 * @param minutes - Target minutes (0-59)
 * @param timezone - IANA timezone string
 * @returns Adjusted date in UTC
 */
function adjustToTimezone(date: Date, hours: number, minutes: number, timezone: string): Date {
  // Get the UTC offset for the target timezone at the given date
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMs = utcDate.getTime() - tzDate.getTime();

  // Set the time in local terms, then apply the offset to get UTC
  let adjusted = setHours(date, hours);
  adjusted = setMinutes(adjusted, minutes);

  return new Date(adjusted.getTime() + offsetMs);
}

/**
 * Calculate target date from a contact's date field + offset.
 * Used by the "date" timer node type (e.g., birthday - 1 day).
 *
 * @param dateFieldValue - The contact's date field value
 * @param offsetDays - Offset in days (negative = before, positive = after)
 * @returns Target date or null if dateFieldValue is invalid
 */
export function calculateDateFieldTarget(
  dateFieldValue: string | Date | null,
  offsetDays: number,
): Date | null {
  if (!dateFieldValue) return null;

  const date = typeof dateFieldValue === 'string' ? new Date(dateFieldValue) : dateFieldValue;
  if (isNaN(date.getTime())) return null;

  return addDays(date, offsetDays);
}

/**
 * Get the current date/time in a restaurant's timezone.
 *
 * @param timezone - IANA timezone string (e.g., "America/New_York")
 * @returns Object with current date components in the restaurant's timezone
 */
export function getNowInTimezone(timezone: string): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  dayOfWeek: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(new Date());
  const getValue = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: parseInt(getValue('year'), 10),
    month: parseInt(getValue('month'), 10),
    day: parseInt(getValue('day'), 10),
    hours: parseInt(getValue('hour'), 10),
    minutes: parseInt(getValue('minute'), 10),
    dayOfWeek: dayMap[getValue('weekday')] ?? 0,
  };
}
