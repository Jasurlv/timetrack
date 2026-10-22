export function localDateAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function localTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const represented = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return new Date(target - (represented - target));
}

export function localClockAt(instant, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}
