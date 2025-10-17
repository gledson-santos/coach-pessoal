export const normalizeToIsoString = (value: unknown): string | null => {
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isNaN(time)) {
      return new Date(time).toISOString();
    }
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};
