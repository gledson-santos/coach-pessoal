import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_CALENDAR_CATEGORY, normalizeCalendarColor } from "../constants/calendarCategories";
import { CalendarAccount } from "../types/calendar";

const STORAGE_KEY = "@coach/calendarAccounts";

let accounts: CalendarAccount[] = [];
let initialized = false;
const listeners = new Set<(value: CalendarAccount[]) => void>();

const persist = async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
};

const notify = () => {
  const snapshot = [...accounts];
  listeners.forEach((listener) => listener(snapshot));
};

const normalizeAccount = (account: CalendarAccount): CalendarAccount => ({
  ...account,
  color: normalizeCalendarColor(account.color ?? DEFAULT_CALENDAR_CATEGORY.color),
  autoSyncEnabled: account.autoSyncEnabled ?? true,
  lastSync: account.lastSync ?? null,
  status: account.status ?? "idle",
  errorMessage: account.errorMessage ?? null,
  accessToken: account.accessToken ?? null,
  refreshToken: account.refreshToken ?? null,
  accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
  scope: account.scope ?? null,
  clientId: account.clientId ?? null,
  calendarId: account.calendarId ?? (account.provider === "google" ? "primary" : null),
  tenantId: account.tenantId ?? null,
  externalId: account.externalId ?? null,
  icsUrl: account.icsUrl ?? null,
  readOnly: account.provider === "ics" ? true : account.readOnly ?? false,
});

export const initializeCalendarAccounts = async () => {
  if (initialized) {
    return accounts;
  }
  initialized = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: CalendarAccount[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        accounts = parsed.map((item) => normalizeAccount(item));
      }
    }
  } catch (error) {
    console.warn("Failed to load calendar accounts", error);
  }
  return accounts;
};

export const getCalendarAccounts = () => accounts;

export const setCalendarAccounts = async (list: CalendarAccount[]) => {
  accounts = list.map((item) => normalizeAccount(item));
  await persist();
  notify();
};

export const findCalendarAccount = (accountId: string) =>
  accounts.find((item) => item.id === accountId);

export const subscribeCalendarAccounts = (listener: (value: CalendarAccount[]) => void) => {
  listeners.add(listener);
  listener([...accounts]);
  return () => listeners.delete(listener);
};

export const upsertCalendarAccount = async (account: CalendarAccount) => {
  const normalized = normalizeAccount(account);
  const existingIndex = accounts.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    accounts[existingIndex] = { ...accounts[existingIndex], ...normalized };
  } else {
    accounts = [...accounts, normalized];
  }
  await persist();
  notify();
  return normalized;
};

export const removeCalendarAccount = async (accountId: string) => {
  const next = accounts.filter((item) => item.id !== accountId);
  if (next.length === accounts.length) {
    return;
  }
  accounts = next;
  await persist();
  notify();
};

export const updateCalendarAccountStatus = async (
  accountId: string,
  updates: Partial<Pick<CalendarAccount, "status" | "lastSync" | "errorMessage" | "accessToken" | "accessTokenExpiresAt">>
) => {
  const index = accounts.findIndex((item) => item.id === accountId);
  if (index < 0) {
    return;
  }
  accounts[index] = { ...accounts[index], ...updates };
  await persist();
  notify();
};

export const updateCalendarAccountTokens = async (
  accountId: string,
  updates: Partial<Pick<CalendarAccount, "accessToken" | "refreshToken" | "accessTokenExpiresAt" | "scope">>
) => {
  const index = accounts.findIndex((item) => item.id === accountId);
  if (index < 0) {
    return;
  }
  accounts[index] = { ...accounts[index], ...updates };
  await persist();
  notify();
};

export const updateCalendarAccountColor = async (accountId: string, color: string) => {
  const index = accounts.findIndex((item) => item.id === accountId);
  if (index < 0) {
    return;
  }
  const normalized = normalizeCalendarColor(color);
  accounts[index] = { ...accounts[index], color: normalized };
  await persist();
  notify();
};
