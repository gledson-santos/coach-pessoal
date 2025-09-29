export type CalendarProvider = "google" | "outlook" | "ics";

export type CalendarAccount = {
  id: string;
  provider: CalendarProvider;
  email: string;
  displayName: string | null;
  color: string;
  tenantId?: string | null;
  externalId?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: number | null;
  scope?: string | null;
  clientId?: string | null;
  calendarId?: string | null;
  autoSyncEnabled?: boolean;
  lastSync?: string | null;
  status?: "idle" | "syncing" | "error";
  errorMessage?: string | null;
  icsUrl?: string | null;
  readOnly?: boolean;
};
