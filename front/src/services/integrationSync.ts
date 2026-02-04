import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildApiUrl } from "../config/api";

const INTEGRATION_LOG_KEY = "@coach/integrationLog";
const MAX_LOG_ENTRIES = 200;

export type IntegrationEvent = {
  id: string;
  title: string;
  notes: string | null;
  date: string | null;
  type: string;
  difficulty: string;
  duration: number;
  start: string | null;
  end: string | null;
  color: string | null;
  status: string | null;
  provider: string | null;
  accountId: string | null;
  googleId: string | null;
  outlookId: string | null;
  icsUid: string | null;
  updatedAt: string;
  createdAt: string | null;
  integrationDate: string | null;
};

export type IntegrationPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasMore: boolean;
};

export type IntegrationListResponse = {
  events: IntegrationEvent[];
  pagination: IntegrationPagination;
};

export type IntegrationLogEntry = {
  id: string;
  title: string;
  integratedAt: string;
  date: string | null;
  start: string | null;
  provider: string | null;
};

export type IntegrationProcessor = (
  event: IntegrationEvent
) => Promise<boolean> | boolean;

const sanitizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isActiveStatus = (status: string | null): boolean => {
  if (!status) {
    return true;
  }
  const normalized = status.trim().toLowerCase();
  return normalized !== "removido" && normalized !== "cancelado";
};

const shouldIntegrateEvent = (event: IntegrationEvent): boolean => {
  if (!sanitizeString(event.id)) {
    return false;
  }
  if (!sanitizeString(event.title)) {
    return false;
  }
  if (!isActiveStatus(event.status)) {
    return false;
  }
  return Boolean(event.date || event.start);
};

const appendIntegrationLog = async (event: IntegrationEvent) => {
  const entry: IntegrationLogEntry = {
    id: event.id,
    title: event.title,
    integratedAt: new Date().toISOString(),
    date: event.date ?? null,
    start: event.start ?? null,
    provider: event.provider ?? null,
  };

  try {
    const raw = await AsyncStorage.getItem(INTEGRATION_LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as IntegrationLogEntry[]) : [];
    const updated = [entry, ...(Array.isArray(parsed) ? parsed : [])];
    await AsyncStorage.setItem(
      INTEGRATION_LOG_KEY,
      JSON.stringify(updated.slice(0, MAX_LOG_ENTRIES))
    );
  } catch (error) {
    console.warn("[integrationSync] falha ao salvar log", error);
  }
};

export const fetchPendingIntegrationEvents = async (
  page: number,
  pageSize: number
): Promise<IntegrationListResponse> => {
  const response = await fetch(
    buildApiUrl(`/integration/events?page=${page}&pageSize=${pageSize}`)
  );

  if (!response.ok) {
    throw new Error(`integration_list_failed:${response.status}`);
  }

  return (await response.json()) as IntegrationListResponse;
};

export const markIntegrationEvents = async (
  ids: string[],
  integrationDate?: string | Date | null
) => {
  if (ids.length === 0) {
    return;
  }

  let integrationDateValue: string | null | undefined = undefined;
  if (integrationDate === null) {
    integrationDateValue = null;
  } else if (integrationDate instanceof Date) {
    if (!Number.isNaN(integrationDate.getTime())) {
      integrationDateValue = integrationDate.toISOString();
    }
  } else if (typeof integrationDate === "string" && integrationDate.trim()) {
    const parsed = new Date(integrationDate);
    if (!Number.isNaN(parsed.getTime())) {
      integrationDateValue = parsed.toISOString();
    }
  }

  const body: { ids: string[]; integrationDate?: string | null } = { ids };
  if (integrationDateValue !== undefined) {
    body.integrationDate = integrationDateValue;
  }

  const response = await fetch(buildApiUrl("/integration/events/mark"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`integration_mark_failed:${response.status}`);
  }
};

export const integratePendingEvents = async (
  options: {
    pageSize?: number;
    processor?: IntegrationProcessor;
    maxPages?: number;
  } = {}
) => {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 50;
  const processor: IntegrationProcessor =
    options.processor ?? (async (event) => {
      if (!shouldIntegrateEvent(event)) {
        return false;
      }
      await appendIntegrationLog(event);
      return true;
    });

  let page = 1;
  let hasMore = true;
  let processed = 0;
  let marked = 0;

  while (hasMore && page <= maxPages) {
    const { events, pagination } = await fetchPendingIntegrationEvents(
      page,
      pageSize
    );
    const idsToMark: string[] = [];

    for (const event of events) {
      try {
        const handled = await processor(event);
        if (handled) {
          idsToMark.push(event.id);
        }
      } catch (error) {
        console.warn("[integrationSync] falha ao integrar evento", error);
      }
      processed += 1;
    }

    if (idsToMark.length > 0) {
      await markIntegrationEvents(idsToMark);
      marked += idsToMark.length;
    }

    hasMore = pagination.hasMore;
    page += 1;
  }

  return { processed, marked };
};
