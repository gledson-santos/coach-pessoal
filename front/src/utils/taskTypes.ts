import {
  DEFAULT_CALENDAR_CATEGORY,
  findCalendarCategoryByColor,
} from "../constants/calendarCategories";

const removeDiacritics = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const matchesKeywords = (value: string, keywords: string[]) => {
  if (!value) {
    return false;
  }

  const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);

  return keywords.some((keyword) => {
    if (!keyword) {
      return false;
    }

    if (value === keyword) {
      return true;
    }

    if (value.startsWith(keyword)) {
      return true;
    }

    return tokens.some((token) => token === keyword || token.startsWith(keyword));
  });
};

const PERSONAL_KEYWORDS = [
  "pessoal",
  "pessoais",
  "personal",
  "famil",
  "family",
  "home",
  "casa",
  "vida",
];
const WORK_KEYWORDS = [
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
];

export const normalizarTipoTarefa = (valor?: string | null): string => {
  if (typeof valor !== "string") {
    return "";
  }

  const trimmed = valor.trim();
  if (!trimmed) {
    return "";
  }

  const sanitized = removeDiacritics(trimmed);
  if (!sanitized) {
    return "";
  }

  if (matchesKeywords(sanitized, PERSONAL_KEYWORDS)) {
    return "Pessoal";
  }

  if (matchesKeywords(sanitized, WORK_KEYWORDS)) {
    return "Trabalho";
  }

  return trimmed;
};

export const inferirTipoPelaCor = (cor?: string | null): string => {
  const categoria = findCalendarCategoryByColor(cor) ?? DEFAULT_CALENDAR_CATEGORY;
  return categoria.label;
};

