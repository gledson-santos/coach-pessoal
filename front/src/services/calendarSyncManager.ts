import { CalendarAccount } from "../types/calendar";
import {
  updateCalendarAccountStatus,
  getCalendarAccounts,
} from "./calendarAccountsStore";
import { syncGoogleAccount } from "./providers/googleSync";
import { syncOutlookAccount } from "./providers/outlookSync";

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000;
const IMMEDIATE_SYNC_DELAY = 3_000;

type SyncRunner = {
  account: CalendarAccount;
  timer: ReturnType<typeof setInterval> | null;
  immediateTimer: ReturnType<typeof setTimeout> | null;
  syncing: boolean;
  pending: boolean;
};

const runners = new Map<string, SyncRunner>();

const isAutoSyncEnabled = (account: CalendarAccount) => account.autoSyncEnabled !== false;

const clearRunnerTimers = (runner: SyncRunner) => {
  if (runner.timer) {
    clearInterval(runner.timer);
    runner.timer = null;
  }
  if (runner.immediateTimer) {
    clearTimeout(runner.immediateTimer);
    runner.immediateTimer = null;
  }
};

const performProviderSync = async (account: CalendarAccount) => {
  if (account.provider === "google") {
    await syncGoogleAccount(account);
    return;
  }
  if (account.provider === "outlook") {
    await syncOutlookAccount(account);
    return;
  }
  throw new Error(`Provider "${account.provider}" nao suportado.`);
};

const triggerSync = async (accountId: string) => {
  const runner = runners.get(accountId);
  if (!runner) {
    return;
  }
  if (runner.syncing) {
    runner.pending = true;
    return;
  }

  runner.syncing = true;
  runner.pending = false;

  try {
    await performProviderSync(runner.account);
  } catch (error: any) {
    console.error(`[sync] falha ao sincronizar conta ${runner.account.email}`, error);
    await updateCalendarAccountStatus(runner.account.id, {
      status: "error",
      errorMessage: error?.message ?? "Falha ao sincronizar",
    });
  } finally {
    runner.syncing = false;
    if (runner.pending) {
      runner.pending = false;
      scheduleImmediateSync(runner.account.id);
    }
  }
};

const scheduleImmediateSync = (accountId: string, delay = IMMEDIATE_SYNC_DELAY) => {
  const runner = runners.get(accountId);
  if (!runner || !isAutoSyncEnabled(runner.account)) {
    return;
  }
  if (runner.immediateTimer) {
    clearTimeout(runner.immediateTimer);
  }
  runner.immediateTimer = setTimeout(() => {
    triggerSync(accountId).catch((error) => {
      console.error(`[sync] erro ao executar sincronizacao imediata`, error);
    });
  }, delay);
};

const startInterval = (accountId: string) => {
  const runner = runners.get(accountId);
  if (!runner) {
    return;
  }
  if (!isAutoSyncEnabled(runner.account)) {
    clearRunnerTimers(runner);
    return;
  }
  if (runner.timer) {
    clearInterval(runner.timer);
  }
  runner.timer = setInterval(() => {
    triggerSync(accountId).catch((error) => {
      console.error(`[sync] erro em sincronizacao agendada`, error);
    });
  }, AUTO_SYNC_INTERVAL);
};

export const registerCalendarAccount = (account: CalendarAccount) => {
  const existing = runners.get(account.id);
  if (existing) {
    const previousAccount = existing.account;
    existing.account = account;

    const wasAutoSyncEnabled = isAutoSyncEnabled(previousAccount);
    const isAutoSyncCurrentlyEnabled = isAutoSyncEnabled(account);

    if (!isAutoSyncCurrentlyEnabled) {
      clearRunnerTimers(existing);
      return;
    }

    if (!wasAutoSyncEnabled && isAutoSyncCurrentlyEnabled) {
      startInterval(account.id);
      scheduleImmediateSync(account.id, 1_000);
      return;
    }

    if (!existing.timer) {
      startInterval(account.id);
    }
    return;
  }

  const runner: SyncRunner = {
    account,
    timer: null,
    immediateTimer: null,
    syncing: false,
    pending: false,
  };

  runners.set(account.id, runner);
  if (isAutoSyncEnabled(account)) {
    startInterval(account.id);
    scheduleImmediateSync(account.id, 1_000);
  }
};

export const initializeCalendarSyncEngine = (accounts: CalendarAccount[] = getCalendarAccounts()) => {
  accounts.forEach((account) => registerCalendarAccount(account));
};

export const unregisterCalendarAccount = (accountId: string) => {
  const runner = runners.get(accountId);
  if (!runner) {
    return;
  }
  clearRunnerTimers(runner);
  runners.delete(accountId);
};

export const notifyAccountLocalChange = (accountId: string) => {
  scheduleImmediateSync(accountId, 2_000);
};

export const refreshAccountSnapshot = (account: CalendarAccount) => {
  const runner = runners.get(account.id);
  if (!runner) {
    registerCalendarAccount(account);
    return;
  }
  runner.account = account;
  if (!isAutoSyncEnabled(account)) {
    clearRunnerTimers(runner);
  } else {
    startInterval(account.id);
  }
};

export const triggerManualSync = async (accountId: string) => {
  await triggerSync(accountId);
};
