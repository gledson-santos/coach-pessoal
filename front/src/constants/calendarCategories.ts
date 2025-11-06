export type CalendarCategoryKey = "personal" | "work";

export type CalendarCategory = {
  key: CalendarCategoryKey;
  color: string;
  label: string;
  aliases?: string[];
};

const normalizeCategoryText = (value?: string | null) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
};

export const CALENDAR_CATEGORIES: CalendarCategory[] = [
  {
    key: "personal",
    color: "#2a9d8f",
    label: "Pessoal",
    aliases: [
      "pessoal",
      "pessoais",
      "personal",
      "famil",
      "familia",
      "family",
      "home",
      "casa",
      "vida",
    ],
  },
  {
    key: "work",
    color: "#264653",
    label: "Trabalho",
    aliases: [
      "trabalho",
      "trabalh",
      "work",
      "profiss",
      "profes",
      "profissional",
      "professional",
      "empresa",
      "empres",
      "business",
      "job",
      "career",
      "carreir",
    ],
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
    return null;
  }
  const normalized = color.trim().toLowerCase();
  return (
    CALENDAR_CATEGORIES.find(
      (category) => category.color.toLowerCase() === normalized
    ) ?? null
  );
};

export const findCalendarCategoryByType = (type?: string | null) => {
  const normalized = normalizeCategoryText(type);
  if (!normalized) {
    return null;
  }

  return (
    CALENDAR_CATEGORIES.find((category) => {
      const labelNormalized = normalizeCategoryText(category.label);
      if (labelNormalized === normalized) {
        return true;
      }

      const keyNormalized = normalizeCategoryText(category.key);
      if (keyNormalized === normalized) {
        return true;
      }

      if (category.aliases?.length) {
        return category.aliases.some(
          (alias) => normalizeCategoryText(alias) === normalized
        );
      }

      return false;
    }) ?? null
  );
};

export const resolveCalendarCategory = (
  type?: string | null,
  fallbackColor?: string | null
): CalendarCategory => {
  const byType = findCalendarCategoryByType(type);
  if (byType) {
    return byType;
  }

  if (typeof fallbackColor === "string" && fallbackColor.trim().length > 0) {
    const byColor = findCalendarCategoryByColor(fallbackColor);
    if (byColor) {
      return byColor;
    }
  }

  return DEFAULT_CALENDAR_CATEGORY;
};

export const getCalendarColorByType = (
  type?: string | null,
  fallbackColor?: string | null
) => normalizeCalendarColor(resolveCalendarCategory(type, fallbackColor).color);

export const getCalendarCategoryLabel = (color?: string | null) => {
  const category = findCalendarCategoryByColor(color);
  return category ? category.label : "Agenda";
};
