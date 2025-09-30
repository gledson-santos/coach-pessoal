import { Evento } from "../database";

const CANCELLED_STATUS_SET = new Set(
  [
    "removido",
    "removida",
    "cancelado",
    "cancelada",
    "canceled",
    "cancelled",
    "excluido",
    "excluida",
    "deleted",
  ].map((status) => status.toLowerCase())
);

const normalizeStatus = (status?: string | null) =>
  typeof status === "string" ? status.trim().toLowerCase() : "";

const normalizeTitle = (title?: string | null) =>
  typeof title === "string" ? title.trim().toLowerCase() : "";

const hasCancellationKeywordInTitle = (title?: string | null) => {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    return false;
  }

  return normalized.includes("cancelado");
};

const isCancelledStatus = (status?: string | null) => {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    return false;
  }

  if (CANCELLED_STATUS_SET.has(normalized)) {
    return true;
  }

  return normalized.includes("cancel");
};

const getEventStartDate = (event: Evento): Date | null => {
  const candidates = [event.inicio, event.data];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
};

const getVisibilityThreshold = (daysBack: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - daysBack);
  return today;
};

export const shouldDisplayEvent = (event: Evento, daysBack = 3) => {
  if (isCancelledStatus(event.status)) {
    return false;
  }

  if (hasCancellationKeywordInTitle(event.titulo)) {
    return false;
  }

  const startDate = getEventStartDate(event);
  if (!startDate) {
    return true;
  }

  const threshold = getVisibilityThreshold(daysBack);
  return startDate.getTime() >= threshold.getTime();
};

export const filterVisibleEvents = (events: Evento[], daysBack = 3) =>
  events.filter((event) => shouldDisplayEvent(event, daysBack));

