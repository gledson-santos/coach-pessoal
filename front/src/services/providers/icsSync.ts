import { buildApiUrl } from "../../config/api";
import { CalendarAccount } from "../../types/calendar";
import { Evento, substituirEventosIcs } from "../../database";
import { updateCalendarAccountStatus } from "../calendarAccountsStore";
import { triggerEventSync } from "../eventSync";

const DEFAULT_DIFFICULTY = "Media";
const DEFAULT_TYPE = "Calendário ICS";

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

const parseIcsEvents = (content: string): ParsedIcsEvent[] => {
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
        if ((current.status ?? "").toUpperCase() !== "CANCELLED") {
          events.push(current);
        }
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
      default:
        break;
    }
  }

  return events;
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

const mapIcsToEvento = (item: ParsedIcsEvent, account: CalendarAccount): Evento | null => {
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
    tipo: DEFAULT_TYPE,
    dificuldade: DEFAULT_DIFFICULTY,
    tempoExecucao,
    inicio: inicioIso,
    fim: fimIso,
    cor: account.color,
    icsUid: item.uid,
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

  const parsedEvents = parseIcsEvents(content);
  const eventos: Evento[] = [];
  for (const item of parsedEvents) {
    const evento = mapIcsToEvento(item, account);
    if (evento) {
      eventos.push(evento);
    }
  }

  await substituirEventosIcs(account.id, eventos);

  try {
    await triggerEventSync();
  } catch (error) {
    console.warn("[ics] failed to trigger sync after provider import", error);
  }

  await updateCalendarAccountStatus(account.id, {
    status: "idle",
    lastSync: new Date().toISOString(),
    errorMessage: null,
  });
};
