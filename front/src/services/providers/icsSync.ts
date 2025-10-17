import { buildApiUrl } from "../../config/api";
import { CalendarAccount } from "../../types/calendar";
import { Evento, substituirEventosIcs } from "../../database";
import { updateCalendarAccountStatus } from "../calendarAccountsStore";
import { triggerEventSync } from "../eventSync";
import { inferirTipoPelaCor } from "../../utils/taskTypes";

const DEFAULT_DIFFICULTY = "Media";

const fetchIcsContent = async (url: string): Promise<string> => {
  const response = await fetch(buildApiUrl("/ics/fetch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    let message = `Falha ao carregar o arquivo ICS (${response.status}).`;
    try {
      const data = await response.json();
      const errorMessage = typeof data?.message === "string" ? data.message.trim() : "";
      if (errorMessage) {
        message = errorMessage;
      } else if (typeof data?.error === "string" && data.error.trim()) {
        message = `${message} (${data.error.trim()})`;
      }
    } catch {
      // Ignora falhas ao analisar o corpo da resposta de erro.
    }
    throw new Error(message);
  }

  return await response.text();
};

type ParsedIcsEvent = {
  uid?: string;
  summary?: string;
  description?: string;
  start?: string | null;
  end?: string | null;
  lastModified?: string | null;
  status?: string | null;
  rrule?: string | null;
  rdate?: (string | null)[];
  exdate?: (string | null)[];
  recurrenceId?: string | null;
};

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

const unfoldIcsLines = (content: string): string[] => {
  const rawLines = content.split(/\r?\n/);
  const lines: string[] = [];

  for (const rawLine of rawLines) {
    if (!rawLine) {
      if (lines.length === 0) {
        continue;
      }
      lines.push("");
      continue;
    }

    if (rawLine.startsWith(" ") || rawLine.startsWith("\t")) {
      if (lines.length === 0) {
        lines.push(rawLine.trimStart());
        continue;
      }
      lines[lines.length - 1] += rawLine.slice(1);
      continue;
    }

    lines.push(rawLine);
  }

  return lines;
};

const parseProperty = (line: string): IcsProperty | null => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const namePart = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [rawName, ...rawParams] = namePart.split(";");
  const name = rawName.trim().toUpperCase();
  const params: Record<string, string> = {};

  rawParams.forEach((chunk) => {
    const [rawKey, rawValue] = chunk.split("=");
    if (!rawKey || !rawValue) {
      return;
    }
    const key = rawKey.trim().toUpperCase();
    const paramValue = rawValue.trim();
    if (key) {
      params[key] = paramValue;
    }
  });

  return { name, params, value };
};

const unescapeText = (value: string): string =>
  value
    .replace(/\\n/gi, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();

const parseDateValue = (value: string, params: Record<string, string>): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  const match = normalized.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);

    if (!match[4] || params.VALUE?.toUpperCase() === "DATE") {
      const date = new Date(Date.UTC(year, month, day, 0, 0, 0));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const hour = Number(match[5]);
    const minute = Number(match[6]);
    const second = Number(match[7]);
    const hasZ = match[8] === "Z";

    if (hasZ) {
      const date = new Date(Date.UTC(year, month, day, hour, minute, second));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const localDate = new Date(year, month, day, hour, minute, second);
    if (!Number.isNaN(localDate.getTime())) {
      return localDate.toISOString();
    }

    const utcFallback = new Date(Date.UTC(year, month, day, hour, minute, second));
    return Number.isNaN(utcFallback.getTime()) ? null : utcFallback.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const parseIcsEvents = (content: string): ParsedIcsEvent[] => {
  const lines = unfoldIcsLines(content);
  const events: ParsedIcsEvent[] = [];
  let current: ParsedIcsEvent | null = null;

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line.toUpperCase() === "END:VEVENT") {
      if (current && current.uid) {
        events.push(current);
      }
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const property = parseProperty(line);
    if (!property) {
      continue;
    }

    const { name, params, value } = property;
    switch (name) {
      case "UID":
        current.uid = value.trim();
        break;
      case "SUMMARY":
        current.summary = unescapeText(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value);
        break;
      case "DTSTART":
        current.start = parseDateValue(value, params);
        break;
      case "DTEND":
        current.end = parseDateValue(value, params);
        break;
      case "LAST-MODIFIED":
      case "DTSTAMP":
        current.lastModified = parseDateValue(value, params) ?? current.lastModified ?? null;
        break;
      case "STATUS":
        current.status = value.trim();
        break;
      case "RRULE":
        current.rrule = value.trim() || null;
        break;
      case "RDATE": {
        const values = value.split(",").map((chunk) => parseDateValue(chunk, params));
        current.rdate = [...(current.rdate ?? []), ...values];
        break;
      }
      case "EXDATE": {
        const values = value.split(",").map((chunk) => parseDateValue(chunk, params));
        current.exdate = [...(current.exdate ?? []), ...values];
        break;
      }
      case "RECURRENCE-ID":
        current.recurrenceId = parseDateValue(value, params);
        break;
      default:
        break;
    }
  }

  return events.filter((event) => {
    if (!event.uid) {
      return false;
    }
    const status = (event.status ?? "").toUpperCase();
    if (status !== "CANCELLED") {
      return true;
    }
    return Boolean(event.recurrenceId);
  });
};

type RecurrenceGroup = {
  master?: ParsedIcsEvent;
  overrides: Map<string, ParsedIcsEvent>;
  cancellations: Set<string>;
  additional: ParsedIcsEvent[];
};

const MAX_OCCURRENCES = 500;
const MS_IN_DAY = 24 * 60 * 60 * 1000;

type ParsedRecurrenceRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: string | null;
  byDay?: number[];
  byMonthDay?: number[];
};

const WEEKDAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const parseRRuleString = (rule: string): ParsedRecurrenceRule | null => {
  const normalized = rule.trim();
  if (!normalized) {
    return null;
  }

  const parts = normalized.split(";");
  const options: Record<string, string> = {};

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=");
    if (!rawKey || !rawValue) {
      continue;
    }
    options[rawKey.trim().toUpperCase()] = rawValue.trim();
  }

  const freq = options.FREQ?.toUpperCase();
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    return null;
  }

  const interval = Math.max(1, Number.parseInt(options.INTERVAL ?? "1", 10) || 1);
  const countValue = options.COUNT ? Number.parseInt(options.COUNT, 10) : undefined;
  const count = countValue && countValue > 0 ? countValue : undefined;
  const until = options.UNTIL ? parseDateValue(options.UNTIL, {}) : undefined;

  let byDay: number[] | undefined;
  if (options.BYDAY) {
    byDay = options.BYDAY.split(",")
      .map((chunk) => chunk.trim())
      .map((chunk) => WEEKDAY_MAP[chunk.slice(-2).toUpperCase()] ?? null)
      .filter((value): value is number => value !== null);
    if (byDay.length === 0) {
      byDay = undefined;
    }
  }

  let byMonthDay: number[] | undefined;
  if (options.BYMONTHDAY) {
    byMonthDay = options.BYMONTHDAY.split(",")
      .map((chunk) => Number.parseInt(chunk.trim(), 10))
      .filter((value) => Number.isFinite(value));
    if (byMonthDay.length === 0) {
      byMonthDay = undefined;
    }
  }

  return {
    freq: freq as ParsedRecurrenceRule["freq"],
    interval,
    count,
    until: until ?? null,
    byDay,
    byMonthDay,
  };
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const diffInDays = (start: Date, end: Date) => Math.floor((end.getTime() - start.getTime()) / MS_IN_DAY);

const matchesRule = (candidate: Date, start: Date, rule: ParsedRecurrenceRule): boolean => {
  const diffDays = diffInDays(start, candidate);
  if (diffDays <= 0) {
    return false;
  }

  switch (rule.freq) {
    case "DAILY": {
      if (diffDays % rule.interval !== 0) {
        return false;
      }
      if (rule.byDay && !rule.byDay.includes(candidate.getUTCDay())) {
        return false;
      }
      return true;
    }
    case "WEEKLY": {
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks % rule.interval !== 0) {
        return false;
      }
      const allowedDays = rule.byDay && rule.byDay.length > 0 ? rule.byDay : [start.getUTCDay()];
      return allowedDays.includes(candidate.getUTCDay());
    }
    case "MONTHLY": {
      const startMonthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth();
      const candidateMonthIndex = candidate.getUTCFullYear() * 12 + candidate.getUTCMonth();
      const diffMonths = candidateMonthIndex - startMonthIndex;
      if (diffMonths < 0 || diffMonths % rule.interval !== 0) {
        return false;
      }
      const days = rule.byMonthDay && rule.byMonthDay.length > 0 ? rule.byMonthDay : [start.getUTCDate()];
      return days.includes(candidate.getUTCDate());
    }
    case "YEARLY": {
      const diffYears = candidate.getUTCFullYear() - start.getUTCFullYear();
      if (diffYears <= 0 || diffYears % rule.interval !== 0) {
        return false;
      }
      return (
        candidate.getUTCMonth() === start.getUTCMonth() && candidate.getUTCDate() === start.getUTCDate()
      );
    }
    default:
      return false;
  }
};

const generateOccurrencesFromRule = (
  start: Date,
  rule: ParsedRecurrenceRule,
  occurrences: Set<string>,
) => {
  const targetCount = Math.min(MAX_OCCURRENCES, rule.count ?? MAX_OCCURRENCES);
  const untilDate = rule.until ? new Date(rule.until) : null;
  let candidate = new Date(start);
  let safety = 0;

  while (occurrences.size < targetCount) {
    candidate = addDays(candidate, 1);
    safety += 1;

    if (safety > MAX_OCCURRENCES * 366) {
      break;
    }

    if (untilDate && candidate > untilDate) {
      break;
    }

    if (!matchesRule(candidate, start, rule)) {
      continue;
    }

    const iso = candidate.toISOString();
    if (!occurrences.has(iso)) {
      occurrences.add(iso);
    }
  }
};

export const expandRecurringEvents = (events: ParsedIcsEvent[]): ParsedIcsEvent[] => {
  const result: ParsedIcsEvent[] = [];
  const groups = new Map<string, RecurrenceGroup>();

  const getGroup = (uid: string): RecurrenceGroup => {
    let group = groups.get(uid);
    if (!group) {
      group = { overrides: new Map(), cancellations: new Set(), additional: [] };
      groups.set(uid, group);
    }
    return group;
  };

  for (const event of events) {
    if (!event.uid) {
      continue;
    }

    const hasRecurrenceData = Boolean(event.rrule || (event.rdate && event.rdate.length > 0) || event.recurrenceId);
    if (!hasRecurrenceData) {
      result.push(event);
      continue;
    }

    const group = getGroup(event.uid);
    if (event.recurrenceId) {
      if ((event.status ?? "").toUpperCase() === "CANCELLED") {
        group.cancellations.add(event.recurrenceId);
      } else {
        group.overrides.set(event.recurrenceId, event);
      }
      continue;
    }

    if (event.rrule || (event.rdate && event.rdate.length > 0)) {
      if (!group.master) {
        group.master = event;
      } else {
        group.additional.push(event);
      }
      continue;
    }

    group.additional.push(event);
  }

  if (groups.size === 0) {
    return result;
  }

  groups.forEach((group) => {
    const { master, overrides, cancellations, additional } = group;
    if (!master) {
      result.push(...additional);
      overrides.forEach((override) => result.push(override));
      return;
    }

    const masterStart = master.start ? new Date(master.start) : null;
    const masterEnd = master.end ? new Date(master.end) : null;
    const baseDuration = masterStart && masterEnd ? Math.max(0, masterEnd.getTime() - masterStart.getTime()) : 0;

    if (!masterStart || Number.isNaN(masterStart.getTime())) {
      if ((master.status ?? "").toUpperCase() !== "CANCELLED") {
        result.push(master);
      }
      overrides.forEach((override) => {
        if ((override.status ?? "").toUpperCase() !== "CANCELLED") {
          result.push(override);
        }
      });
      result.push(...additional);
      return;
    }

    const occurrenceSet = new Set<string>();
    const addOccurrence = (date: Date | null | undefined) => {
      if (!date || Number.isNaN(date.getTime())) {
        return;
      }
      if (occurrenceSet.size >= MAX_OCCURRENCES) {
        return;
      }
      occurrenceSet.add(date.toISOString());
    };

    addOccurrence(masterStart);

    if (master.rrule) {
      const parsedRule = parseRRuleString(master.rrule);
      if (parsedRule) {
        generateOccurrencesFromRule(masterStart, parsedRule, occurrenceSet);
      } else {
        console.warn("[ics] invalid RRULE ignored", master.rrule);
      }
    }

    for (const rdate of master.rdate ?? []) {
      if (!rdate) {
        continue;
      }
      const date = new Date(rdate);
      addOccurrence(date);
    }

    overrides.forEach((_, recurrenceKey) => {
      if (occurrenceSet.size >= MAX_OCCURRENCES) {
        return;
      }
      if (!occurrenceSet.has(recurrenceKey)) {
        occurrenceSet.add(recurrenceKey);
      }
    });

    for (const exdate of master.exdate ?? []) {
      if (!exdate) {
        continue;
      }
      const date = new Date(exdate);
      if (!Number.isNaN(date.getTime())) {
        occurrenceSet.delete(date.toISOString());
      }
    }

    cancellations.forEach((recurrenceId) => {
      occurrenceSet.delete(recurrenceId);
    });

    const occurrences = Array.from(occurrenceSet).sort();

    for (const occurrenceIso of occurrences) {
      if (cancellations.has(occurrenceIso)) {
        continue;
      }

      const override = overrides.get(occurrenceIso);
      const startIso = override?.start ?? occurrenceIso;
      let endIso = override?.end ?? null;

      if (!endIso && baseDuration > 0) {
        const endDate = new Date(new Date(startIso).getTime() + baseDuration);
        endIso = endDate.toISOString();
      } else if (!endIso) {
        endIso = startIso;
      }

      const merged: ParsedIcsEvent = {
        ...master,
        start: startIso,
        end: endIso,
        rrule: null,
        rdate: undefined,
        exdate: undefined,
        recurrenceId: undefined,
        lastModified: override?.lastModified ?? master.lastModified ?? null,
      };

      if (override) {
        if (override.summary !== undefined) {
          merged.summary = override.summary;
        }
        if (override.description !== undefined) {
          merged.description = override.description;
        }
        if (override.status !== undefined) {
          merged.status = override.status;
        }
      }

      result.push(merged);
    }

    result.push(...additional);
  });

  return result;
};

const diferencaEmMinutos = (inicio?: string | null, fim?: string | null) => {
  if (!inicio || !fim) {
    return 0;
  }
  const inicioDate = new Date(inicio);
  const fimDate = new Date(fim);
  if (Number.isNaN(inicioDate.getTime()) || Number.isNaN(fimDate.getTime())) {
    return 0;
  }
  const diff = Math.max(0, fimDate.getTime() - inicioDate.getTime());
  return Math.round(diff / 60000);
};

export const mapIcsToEvento = (item: ParsedIcsEvent, account: CalendarAccount): Evento | null => {
  const inicioIso = item.start;
  if (!inicioIso) {
    return null;
  }

  const fimIso = item.end ?? inicioIso;
  const tempoExecucao = Math.max(1, diferencaEmMinutos(inicioIso, fimIso));

  return {
    titulo: item.summary?.trim() || "Evento sem titulo",
    observacao: item.description || undefined,
    data: inicioIso,
    tipo: inferirTipoPelaCor(account.color),
    dificuldade: DEFAULT_DIFFICULTY,
    tempoExecucao,
    inicio: inicioIso,
    fim: fimIso,
    cor: account.color,
    icsUid: item.uid && item.start ? `${item.uid}::${item.start}` : item.uid,
    updatedAt: item.lastModified ?? new Date().toISOString(),
    provider: "ics",
    accountId: account.id,
    status: "ativo",
  };
};

export const syncIcsAccount = async (account: CalendarAccount) => {
  await updateCalendarAccountStatus(account.id, {
    status: "syncing",
    errorMessage: null,
  });

  if (!account.icsUrl) {
    throw new Error("Conta ICS sem link configurado.");
  }

  const url = account.icsUrl.trim();
  if (!url) {
    throw new Error("Informe um link ICS válido para sincronizar.");
  }

  const content = await fetchIcsContent(url);
  if (!content.trim()) {
    throw new Error("O arquivo ICS está vazio.");
  }

  const parsedEvents = expandRecurringEvents(parseIcsEvents(content));
  const eventos: Evento[] = [];
  for (const item of parsedEvents) {
    const evento = mapIcsToEvento(item, account);
    if (evento) {
      eventos.push(evento);
    }
  }

  await substituirEventosIcs(account.id, eventos);

  try {
    await triggerEventSync({ force: true });
  } catch (error) {
    console.warn("[ics] failed to trigger sync after provider import", error);
  }

  await updateCalendarAccountStatus(account.id, {
    status: "idle",
    lastSync: new Date().toISOString(),
    errorMessage: null,
  });
};
