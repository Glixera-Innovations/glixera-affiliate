function calendarDateInTimeZone(value: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number.parseInt(
      parts.find((candidate) => candidate.type === type)?.value ?? "",
      10,
    );

    if (!Number.isInteger(parsed)) {
      throw new Error(
        `Unable to calculate the current ${type} in ${timeZone}.`,
      );
    }

    return parsed;
  };

  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

function formatWeekRange(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone: "UTC",
  });
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  const year = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    timeZone: "UTC",
  });

  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${day.format(start)}–${day.format(end)} ${month.format(end)} ${year.format(end)}`;
  }

  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${day.format(start)} ${month.format(start)}–${day.format(end)} ${month.format(end)} ${year.format(end)}`;
  }

  return `${day.format(start)} ${month.format(start)} ${year.format(start)}–${day.format(end)} ${month.format(end)} ${year.format(end)}`;
}

export function defaultPeriod(
  timeZone: string,
  now: Date = new Date(),
): string {
  const localDate = calendarDateInTimeZone(now, timeZone);
  const dayOfWeek = localDate.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const start = new Date(localDate);
  start.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return `Week of ${formatWeekRange(start, end)}`;
}
