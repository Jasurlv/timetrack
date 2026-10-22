const MINUTE_MS = 60_000;
export const NORMAL_PAID_DAY_MS = 9 * 60 * 60_000;

export function shortfallFromNormalDay(workedMs) {
  if (!Number.isFinite(workedMs) || workedMs < 0) {
    throw new RangeError("workedMs must be a non-negative finite number");
  }
  return Math.max(0, NORMAL_PAID_DAY_MS - workedMs);
}

function timestamp(value, name) {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new TypeError(`${name} must be a valid date or ISO timestamp`);
  }
  return result;
}

export function getPaidStart(checkInAt, scheduledStartAt) {
  const checkIn = timestamp(checkInAt, "checkInAt");
  const scheduledStart = timestamp(scheduledStartAt, "scheduledStartAt");
  return new Date(
    checkIn <= scheduledStart ? scheduledStart : checkIn + 15 * MINUTE_MS,
  );
}

export function isCheckInWindowOpen(checkInAt, shiftDate, timeZone = "UTC") {
  const checkIn = timestamp(checkInAt, "checkInAt");
  const opening = zonedTimeToUtc(shiftDate, "07:45:00", timeZone);
  return checkIn >= opening;
}

export function checkoutRequiresReason(checkOutAt, scheduledEndAt) {
  const checkOut = timestamp(checkOutAt, "checkOutAt");
  const scheduledEnd = timestamp(scheduledEndAt, "scheduledEndAt");
  return Math.abs(checkOut - scheduledEnd) > 5 * MINUTE_MS;
}

export function calculateWorkedTime({
  checkInAt,
  checkOutAt,
  scheduledStartAt,
  unpaidIntervals = [],
}) {
  const paidStart = timestamp(
    getPaidStart(checkInAt, scheduledStartAt),
    "paidStart",
  );
  const checkOut = timestamp(checkOutAt, "checkOutAt");
  if (checkOut < paidStart) {
    throw new RangeError("checkOutAt cannot be before paidStart");
  }

  const totalElapsedMs = checkOut - paidStart;
  const unpaidMs = unpaidIntervals.reduce((total, interval) => {
    const start = timestamp(interval.startedAt, "unpaid interval startedAt");
    const end = timestamp(interval.endedAt, "unpaid interval endedAt");
    if (end < start || end > checkOut) {
      throw new RangeError(
        "Unpaid intervals must be ordered and contained within paid work time",
      );
    }
    return total + Math.max(0, end - Math.max(start, paidStart));
  }, 0);

  if (unpaidMs > totalElapsedMs) {
    throw new RangeError("Unpaid time cannot exceed elapsed work time");
  }

  return {
    paidStartAt: new Date(paidStart),
    workedMs: totalElapsedMs - unpaidMs,
    unpaidMs,
  };
}

function zonedTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(desiredUtc))
      .map(({ type, value }) => [type, value]),
  );
  const representedUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return desiredUtc - (representedUtc - desiredUtc);
}
