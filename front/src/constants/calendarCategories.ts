export type CalendarCategoryKey = "personal" | "work";

export type CalendarCategory = {
  key: CalendarCategoryKey;
  color: string;
  label: string;
};

export const CALENDAR_CATEGORIES: CalendarCategory[] = [
  {
    key: "personal",
    color: "#2a9d8f",
    label: "Agenda pessoal",
  },
  {
    key: "work",
    color: "#264653",
    label: "Agenda de trabalho",
  },
];

export const DEFAULT_CALENDAR_CATEGORY = CALENDAR_CATEGORIES[0];

export const normalizeCalendarColor = (color?: string | null) => {
  if (typeof color === "string" && color.trim().length > 0) {
    return color.trim().toLowerCase();
  }
  return DEFAULT_CALENDAR_CATEGORY.color;
};

export const findCalendarCategoryByColor = (color?: string | null) => {
  if (typeof color !== "string" || color.trim().length === 0) {
    return DEFAULT_CALENDAR_CATEGORY;
  }
  const normalized = color.trim().toLowerCase();
  return (
    CALENDAR_CATEGORIES.find(
      (category) => category.color.toLowerCase() === normalized
    ) ?? null
  );
};

export const getCalendarCategoryLabel = (color?: string | null) => {
  const category = findCalendarCategoryByColor(color);
  return category ? category.label : "Agenda";
};
