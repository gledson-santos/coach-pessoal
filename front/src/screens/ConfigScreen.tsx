import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { buildApiUrl } from "../config/api";
import { GOOGLE_OAUTH_CONFIG } from "../config/googleOAuth";
import {
  getOutlookOAuthConfig,
  OutlookOAuthConfig,
} from "../config/outlookOAuth";
import { CalendarAccount, CalendarProvider } from "../types/calendar";
import {
  findCalendarAccount,
  getCalendarAccounts,
  initializeCalendarAccounts,
  removeCalendarAccount,
  setCalendarAccounts,
  subscribeCalendarAccounts,
  upsertCalendarAccount,
} from "../services/calendarAccountsStore";
import {
  initializeCalendarSyncEngine,
  registerCalendarAccount,
  unregisterCalendarAccount,
  refreshAccountSnapshot,
  triggerManualSync,
} from "../services/calendarSyncManager";
import { removerEventosSincronizados } from "../database";
import { triggerEventSync } from "../services/eventSync";
import { loadRemoteOAuthConfig } from "../services/oauthConfig";
import { CALENDAR_CATEGORIES, CalendarCategory, DEFAULT_CALENDAR_CATEGORY, getCalendarCategoryLabel } from "../constants/calendarCategories";

WebBrowser.maybeCompleteAuthSession();

type ProviderOption = {
  id: string;
  provider: CalendarProvider;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

type AccountDto = {
  id: string;
  provider: CalendarProvider;
  email: string;
  displayName: string | null;
  color: string;
  scope: string | null;
  tenantId: string | null;
  externalId: string | null;
  icsUrl: string | null;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiExchangeResponse = {
  account: AccountDto;
  tokens: {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    scope?: string;
    tokenType?: string;
    idToken?: string;
    tenantId?: string;
    storedUnder?: string;
  };
};

type AuthContext = {
  provider: CalendarProvider;
  color: string;
  tenantId?: string;
  clientId?: string;
};

const resolveGoogleClientId = () => {
  if (Platform.OS === "web") {
    return GOOGLE_OAUTH_CONFIG.webClientId || GOOGLE_OAUTH_CONFIG.expoClientId;
  }
  if (Platform.OS === "android") {
    return GOOGLE_OAUTH_CONFIG.androidClientId || GOOGLE_OAUTH_CONFIG.expoClientId;
  }
  if (Platform.OS === "ios") {
    return GOOGLE_OAUTH_CONFIG.iosClientId || GOOGLE_OAUTH_CONFIG.expoClientId;
  }
  return GOOGLE_OAUTH_CONFIG.expoClientId || GOOGLE_OAUTH_CONFIG.webClientId;
};

const mapAccountDtoToCalendarAccount = (dto: AccountDto): CalendarAccount => ({
  id: dto.id,
  provider: dto.provider,
  email: dto.email,
  displayName: dto.displayName,
  color: dto.color,
  scope: dto.scope,
  tenantId: dto.tenantId,
  externalId: dto.externalId,
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  clientId: null,
  calendarId: dto.provider === "google" ? "primary" : null,
  autoSyncEnabled: true,
  lastSync: null,
  status: "idle",
  errorMessage: null,
  icsUrl: dto.icsUrl ?? (dto.provider === "ics" ? dto.email : null),
  readOnly: dto.readOnly ?? (dto.provider === "ics"),
});

const sortAccounts = (list: CalendarAccount[]) =>
  [...list].sort((a, b) => {
    if (a.provider === b.provider) {
      return a.email.localeCompare(b.email);
    }
    return a.provider.localeCompare(b.provider);
  });

export default function ConfigScreen() {
  const useProxy = Platform.OS !== "web";
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CalendarCategory>(DEFAULT_CALENDAR_CATEGORY);
  const [selectedOption, setSelectedOption] = useState<ProviderOption | null>(null);
  const [outlookAccountType, setOutlookAccountType] = useState<"personal" | "business">("personal");
  const [authContext, setAuthContext] = useState<AuthContext | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<CalendarProvider | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [disconnectingAccount, setDisconnectingAccount] = useState<CalendarAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [outlookOAuthConfig, setOutlookOAuthConfig] = useState<OutlookOAuthConfig>(() =>
    getOutlookOAuthConfig()
  );
  const [icsUrlInput, setIcsUrlInput] = useState("");
  const [icsLabelInput, setIcsLabelInput] = useState("");

  const providerOptions = useMemo<ProviderOption[]>(
    () => [
      {
        id: "google",
        provider: "google",
        title: "Google Calendar",
        subtitle: "Conta Gmail",
        icon: "google",
      },
      {
        id: "outlook",
        provider: "outlook",
        title: "Outlook/Office 365",
        subtitle: "Conecte contas pessoais ou corporativas",
        icon: "microsoft",
      },
      {
        id: "ics",
        provider: "ics",
        title: "Calendário ICS",
        subtitle: "Importe usando um link .ics (somente leitura)",
        icon: "calendar-import",
      },
    ],
    []
  );

  useEffect(() => {
    if (!selectedOption) {
      return;
    }
    const updated = providerOptions.find((option) => option.id === selectedOption.id);
    if (updated && updated !== selectedOption) {
      setSelectedOption(updated);
    }
  }, [providerOptions, selectedOption]);

  const registeredIdsRef = useRef(new Set<string>());

  const fallbackRedirectUri = useMemo(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const { origin, pathname } = window.location;
      return `${origin}${pathname}`;
    }
    return AuthSession.makeRedirectUri({ useProxy });
  }, [useProxy]);

  const redirectUri = useMemo(() => {
    const candidates = (outlookOAuthConfig.redirectUris || [])
      .map((uri) => uri.trim())
      .filter(Boolean);

    if (!candidates.length) {
      return fallbackRedirectUri;
    }

    let selected: string | undefined;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const { origin } = window.location;
      selected =
        candidates.find((uri) => {
          try {
            const parsed = new URL(uri);
            return parsed.origin === origin;
          } catch (error) {
            return uri.startsWith(origin);
          }
        }) ?? candidates.find((uri) => uri === fallbackRedirectUri);
    } else {
      const scheme = fallbackRedirectUri.split("://")[0];
      if (scheme) {
        selected = candidates.find((uri) => uri.startsWith(`${scheme}://`));
      }
      if (!selected) {
        selected = candidates.find((uri) => uri === fallbackRedirectUri);
      }
    }

    return selected ?? candidates[0] ?? fallbackRedirectUri;
  }, [fallbackRedirectUri, outlookOAuthConfig.redirectUris]);

  useEffect(() => {
    let active = true;

    loadRemoteOAuthConfig()
      .then(({ microsoft }) => {
        if (!active || !microsoft) {
          return;
        }
        setOutlookOAuthConfig(microsoft);
      })
      .catch((error) => {
        console.warn("[config] Falha ao carregar configuracao OAuth remota", error);
      });

    return () => {
      active = false;
    };
  }, []);

  const googleRequestOptions = useMemo(
    () => ({
      clientId: resolveGoogleClientId(),
      iosClientId: GOOGLE_OAUTH_CONFIG.iosClientId || GOOGLE_OAUTH_CONFIG.expoClientId,
      androidClientId: GOOGLE_OAUTH_CONFIG.androidClientId || GOOGLE_OAUTH_CONFIG.expoClientId,
      webClientId: GOOGLE_OAUTH_CONFIG.webClientId || GOOGLE_OAUTH_CONFIG.expoClientId,
      scopes: GOOGLE_OAUTH_CONFIG.scopes,
      responseType: "code" as const,
      usePKCE: true,
      shouldAutoExchangeCode: false,
      extraParams: {
        access_type: "offline",
        prompt: "consent",
      },
      redirectUri,
    }),
    [redirectUri]
  );

  const defaultOutlookTenant = useMemo(
    () => (outlookOAuthConfig.defaultTenant || "consumers").trim() || "consumers",
    [outlookOAuthConfig.defaultTenant]
  );

  const organizationsOutlookTenant = useMemo(
    () => (outlookOAuthConfig.organizationsTenant || "organizations").trim() || "organizations",
    [outlookOAuthConfig.organizationsTenant]
  );

  const resolvedOutlookTenant = useMemo(
    () =>
      outlookAccountType === "business" ? organizationsOutlookTenant : defaultOutlookTenant,
    [outlookAccountType, organizationsOutlookTenant, defaultOutlookTenant]
  );

  const outlookRequestConfig = useMemo(
    () => ({
      clientId: outlookOAuthConfig.clientId,
      scopes: outlookOAuthConfig.scopes,
      redirectUri,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
      shouldAutoExchangeCode: false,
      extraParams: {
        prompt: "select_account",
        response_mode: "query",
        domain_hint: outlookAccountType === "business" ? "organizations" : "consumers",
      },
    }),
    [outlookOAuthConfig, redirectUri, outlookAccountType]
  );

  const outlookDiscovery = useMemo(
    () => ({
      authorizationEndpoint: `https://login.microsoftonline.com/${resolvedOutlookTenant}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${resolvedOutlookTenant}/oauth2/v2.0/token`,
    }),
    [resolvedOutlookTenant]
  );

  const [googleRequest, googleResponse, promptGoogleAsync] = Google.useAuthRequest(googleRequestOptions);
  const [outlookRequest, outlookResponse, promptOutlookAsync] = AuthSession.useAuthRequest(
    outlookRequestConfig,
    outlookDiscovery
  );

  const handleGoogleExchange = useCallback(
    async (code: string, codeVerifier: string | null) => {
      if (!authContext) {
        return;
      }

      setConnectingProvider("google");

      const payload: Record<string, unknown> = {
        code,
        redirectUri,
        color: authContext.color,
      };

      if (codeVerifier) {
        payload.codeVerifier = codeVerifier;
      }

      const response = await fetch(buildApiUrl("/oauth/google/exchange"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: ApiExchangeResponse = await response.json();
      if (!response.ok) {
        const message = (data as any)?.details?.message || (data as any)?.error || "Falha ao trocar o codigo.";
        throw new Error(message);
      }

      if (!data.tokens.refreshToken) {
        throw new Error("O backend nao retornou um refresh token do Google.");
      }

      const expiresAt = data.tokens.expiresIn ? Date.now() + data.tokens.expiresIn * 1000 : null;

      const account: CalendarAccount = {
        ...mapAccountDtoToCalendarAccount(data.account),
        refreshToken: data.tokens.refreshToken,
        accessToken: data.tokens.accessToken ?? null,
        accessTokenExpiresAt: expiresAt,
        scope: data.tokens.scope ?? data.account.scope ?? null,
        clientId: authContext.clientId ?? resolveGoogleClientId(),
      };

      await upsertCalendarAccount(account);
      registerCalendarAccount(account);
      await triggerManualSync(account.id);
      setFeedbackMessage("Conta Google importada com sucesso.");
      setAuthContext(null);
      setConnectingProvider(null);
      setColorModalVisible(false);
      setImportModalVisible(false);
    },
    [authContext, outlookOAuthConfig, redirectUri]
  );

  const handleOutlookExchange = useCallback(
    async (code: string, codeVerifier: string | null) => {
      if (!authContext) {
        return;
      }

      if (!outlookOAuthConfig.clientId) {
        throw new Error("Client ID da Microsoft nao configurado.");
      }

      setConnectingProvider("outlook");

      const tenantId = authContext.tenantId ?? resolvedOutlookTenant;

      const payload: Record<string, unknown> = {
        code,
        redirectUri,
        tenantId,
        scopes: outlookOAuthConfig.scopes,
        color: authContext.color,
      };

      if (codeVerifier) {
        payload.codeVerifier = codeVerifier;
      }

      const response = await fetch(buildApiUrl("/oauth/outlook/exchange"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: ApiExchangeResponse = await response.json();
      if (!response.ok) {
        const message = (data as any)?.details?.message || (data as any)?.error || "Falha ao trocar o codigo.";
        throw new Error(message);
      }

      if (!data.tokens.refreshToken) {
        throw new Error("O backend nao retornou um refresh token da Microsoft.");
      }

      const expiresAt = data.tokens.expiresIn ? Date.now() + data.tokens.expiresIn * 1000 : null;

      const account: CalendarAccount = {
        ...mapAccountDtoToCalendarAccount(data.account),
        refreshToken: data.tokens.refreshToken,
        accessToken: data.tokens.accessToken ?? null,
        accessTokenExpiresAt: expiresAt,
        scope: data.tokens.scope ?? data.account.scope ?? null,
        tenantId: data.tokens.tenantId ?? tenantId ?? data.account.tenantId ?? null,
        clientId: outlookOAuthConfig.clientId,
      };

      await upsertCalendarAccount(account);
      registerCalendarAccount(account);
      await triggerManualSync(account.id);
      setFeedbackMessage("Conta Outlook importada com sucesso.");
      setAuthContext(null);
      setConnectingProvider(null);
      setColorModalVisible(false);
      setImportModalVisible(false);
    },
    [authContext, outlookOAuthConfig, redirectUri, resolvedOutlookTenant]
  );


  useEffect(() => {
    let active = true;

    const loadRemoteAccounts = async () => {
      await initializeCalendarAccounts();
      try {
        const response = await fetch(buildApiUrl("/accounts"));
        if (!response.ok) {
          throw new Error("Falha ao carregar contas cadastradas");
        }
        const payload: AccountDto[] = await response.json();
        if (!active) {
          return;
        }

        const existing = getCalendarAccounts();
        const existingById = new Map(existing.map((item) => [item.id, item]));
        const mapped = payload.map((dto) => {
          const base = mapAccountDtoToCalendarAccount(dto);
          const local = existingById.get(base.id);
          if (!local) {
            return base;
          }
          return {
            ...base,
            color: base.color || local.color,
            refreshToken: local.refreshToken ?? base.refreshToken,
            accessToken: local.accessToken ?? base.accessToken,
            accessTokenExpiresAt: local.accessTokenExpiresAt ?? base.accessTokenExpiresAt,
            scope: local.scope ?? base.scope,
            clientId: local.clientId ?? base.clientId,
            calendarId: local.calendarId ?? base.calendarId,
            autoSyncEnabled: local.autoSyncEnabled ?? base.autoSyncEnabled,
            lastSync: local.lastSync ?? base.lastSync,
            status: local.status ?? base.status,
            errorMessage: local.errorMessage ?? base.errorMessage,
            tenantId: base.tenantId ?? local.tenantId ?? null,
            icsUrl: base.icsUrl ?? local.icsUrl ?? null,
            readOnly: base.readOnly ?? local.readOnly ?? false,
          };
        });

        await setCalendarAccounts(mapped);
        initializeCalendarSyncEngine(mapped);
      } catch (error: any) {
        if (active) {
          setErrorMessage(error?.message ?? "Nao foi possivel carregar as contas cadastradas.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadRemoteAccounts();

    const registered = registeredIdsRef.current;
    const unsubscribe = subscribeCalendarAccounts((list) => {
      setAccounts(sortAccounts(list));
      list.forEach((account) => {
        if (registered.has(account.id)) {
          refreshAccountSnapshot(account);
          return;
        }
        registerCalendarAccount(account);
        registered.add(account.id);
      });

      [...registered].forEach((id) => {
        if (!list.some((account) => account.id === id)) {
          void unregisterCalendarAccount(id);
          registered.delete(id);
        }
      });
    });

    return () => {
      active = false;
      unsubscribe();
      registered.clear();
    };
  }, []);

  useEffect(() => {
    if (!googleResponse || googleResponse.type !== "success" || !authContext || authContext.provider !== "google") {
      return;
    }
    const code = googleResponse.params?.code;
    if (!code) {
      setErrorMessage("Codigo de autorizacao do Google nao recebido.");
      setConnectingProvider(null);
      return;
    }
    handleGoogleExchange(code, googleRequest?.codeVerifier ?? null).catch((error) => {
      console.error("[google] exchange error", error);
      setErrorMessage(error?.message ?? "Falha ao concluir o login com o Google.");
      setConnectingProvider(null);
    });
  }, [googleResponse, googleRequest, authContext, handleGoogleExchange]);

  useEffect(() => {
    if (!outlookResponse || outlookResponse.type !== "success" || !authContext || authContext.provider !== "outlook") {
      return;
    }
    const code = outlookResponse.params?.code;
    if (!code) {
      setErrorMessage("Codigo de autorizacao da Microsoft nao recebido.");
      setConnectingProvider(null);
      return;
    }
    handleOutlookExchange(code, outlookRequest?.codeVerifier ?? null).catch((error) => {
      console.error("[outlook] exchange error", error);
      setErrorMessage(error?.message ?? "Falha ao concluir o login com a Microsoft.");
      setConnectingProvider(null);
    });
  }, [outlookResponse, outlookRequest, authContext, handleOutlookExchange]);

  const openProviderModal = useCallback(() => {
    setFeedbackMessage(null);
    setErrorMessage(null);
    setSelectedOption(null);
    setIcsUrlInput("");
    setIcsLabelInput("");
    setImportModalVisible(true);
  }, []);

  const handleSelectProvider = useCallback(
    (option: ProviderOption) => {
      setSelectedOption(option);
      setSelectedCategory(DEFAULT_CALENDAR_CATEGORY);
      if (option.provider === "outlook") {
        const inferredType =
          defaultOutlookTenant === organizationsOutlookTenant ? "business" : "personal";
        setOutlookAccountType(inferredType);
      }
      if (option.provider === "ics") {
        setIcsUrlInput("");
        setIcsLabelInput("");
      }
      setColorModalVisible(true);
    },
    [defaultOutlookTenant, organizationsOutlookTenant]
  );

  const beginAuth = useCallback(async () => {
    if (!selectedOption) {
      return;
    }

    setFeedbackMessage(null);
    setErrorMessage(null);

    if (selectedOption.provider === "ics") {
      let normalizedLink = icsUrlInput.trim();
      if (!normalizedLink) {
        setErrorMessage("Informe o link ICS para importar.");
        return;
      }

      if (normalizedLink.startsWith("webcal://")) {
        normalizedLink = `https://${normalizedLink.slice("webcal://".length)}`;
      }

      try {
        const parsed = new URL(normalizedLink);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error();
        }
      } catch {
        setErrorMessage("Informe um link ICS válido iniciando com http(s) ou webcal.");
        return;
      }

      const label = icsLabelInput.trim();
      setConnectingProvider("ics");

      try {
        const response = await fetch(buildApiUrl("/accounts/ics"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: normalizedLink,
            color: selectedCategory.color,
            label: label || null,
          }),
        });

        const data: { account?: AccountDto; error?: string; message?: string } = await response
          .json()
          .catch(() => ({}));

        if (!response.ok || !data.account) {
          const message =
            (data?.error as string | undefined) ||
            (data?.message as string | undefined) ||
            "Falha ao cadastrar o calendário ICS.";
          throw new Error(message);
        }

        const account: CalendarAccount = {
          ...mapAccountDtoToCalendarAccount(data.account),
          color: data.account.color || selectedCategory.color,
          icsUrl: data.account.icsUrl ?? normalizedLink,
          readOnly: true,
        };

        await upsertCalendarAccount(account);
        registerCalendarAccount(account);
        await triggerManualSync(account.id);
        setFeedbackMessage("Calendário ICS importado com sucesso.");
        setConnectingProvider(null);
        setColorModalVisible(false);
        setImportModalVisible(false);
        setSelectedOption(null);
        setIcsUrlInput("");
        setIcsLabelInput("");
        setAuthContext(null);
      } catch (error: any) {
        setConnectingProvider(null);
        setErrorMessage(error?.message ?? "Nao foi possivel importar o calendário ICS.");
      }
      return;
    }

    const context: AuthContext = {
      provider: selectedOption.provider,
      color: selectedCategory.color,
    };

    if (selectedOption.provider === "google") {
      const clientId = resolveGoogleClientId();
      if (!clientId) {
        setErrorMessage("Configure os client IDs do Google em src/config/googleOAuth.ts antes de conectar.");
        return;
      }
      context.clientId = clientId;
      setAuthContext(context);
      setConnectingProvider("google");
      try {
        const result = await promptGoogleAsync({
          useProxy,
          windowName: "coach-google-auth",
        });
        if (result?.type !== "success") {
          if (result?.type === "error" && typeof result.error === "string" && result.error.trim().length > 0) {
            setErrorMessage(result.error);
          }
          setConnectingProvider(null);
          setAuthContext(null);
        }
      } catch (error: any) {
        setConnectingProvider(null);
        setErrorMessage(error?.message ?? "Nao foi possivel iniciar o consentimento do Google.");
      }
      return;
    }

    if (!outlookOAuthConfig.clientId) {
      setErrorMessage("Client ID da Microsoft nao configurado.");
      return;
    }

    context.tenantId =
      outlookAccountType === "business" ? organizationsOutlookTenant : defaultOutlookTenant;

    setAuthContext(context);
    setConnectingProvider("outlook");
    try {
      const result = await promptOutlookAsync({
        useProxy,
        windowName: "coach-outlook-auth",
      });
      if (result?.type !== "success") {
        if (result?.type === "error" && typeof result.error === "string" && result.error.trim().length > 0) {
          setErrorMessage(result.error);
        }
        setConnectingProvider(null);
        setAuthContext(null);
      }
    } catch (error: any) {
      setConnectingProvider(null);
      setErrorMessage(error?.message ?? "Nao foi possivel iniciar o consentimento da Microsoft.");
    }
  }, [
    outlookAccountType,
    defaultOutlookTenant,
    organizationsOutlookTenant,
    outlookOAuthConfig.clientId,
    promptGoogleAsync,
    promptOutlookAsync,
    selectedCategory,
    selectedOption,
    icsUrlInput,
    icsLabelInput,
    useProxy,
  ]);

  const closeColorModal = useCallback(() => {
    if (connectingProvider) {
      return;
    }
    setColorModalVisible(false);
  }, [connectingProvider]);

  const handleDisconnectRequest = useCallback((account: CalendarAccount) => {
    setFeedbackMessage(null);
    setErrorMessage(null);
    setDisconnectingAccount(account);
  }, []);

  const cancelDisconnect = useCallback(() => {
    if (disconnecting) {
      return;
    }
    setDisconnectingAccount(null);
  }, [disconnecting]);

  const confirmDisconnect = useCallback(async () => {
    if (!disconnectingAccount) {
      return;
    }

    setDisconnecting(true);
    try {
      await fetch(buildApiUrl(`/accounts/${disconnectingAccount.id}`), {
        method: "DELETE",
      });
      await unregisterCalendarAccount(disconnectingAccount.id);
      await removerEventosSincronizados(disconnectingAccount.provider, {
        accountId: disconnectingAccount.id,
      });
      await removeCalendarAccount(disconnectingAccount.id);
      try {
        await triggerEventSync({ force: true });
      } catch (error) {
        console.warn("[config] failed to trigger sync after disconnect", error);
      }
      setFeedbackMessage("Conta desconectada e tarefas marcadas como removidas.");
    } catch (error: any) {
      console.error("[disconnect] erro", error);
      setErrorMessage(error?.message ?? "Nao foi possivel desconectar a conta.");
    } finally {
      setDisconnecting(false);
      setDisconnectingAccount(null);
    }
  }, [disconnectingAccount]);

  const sortedAccounts = useMemo(() => sortAccounts(accounts), [accounts]);

  const renderAccountCard = useCallback(
    (account: CalendarAccount) => {
      const iconName: keyof typeof Ionicons.glyphMap =
        account.provider === "google"
          ? "logo-google"
          : account.provider === "outlook"
          ? "logo-microsoft"
          : "calendar-outline";
      const statusLabel =
        account.status === "syncing"
          ? "Sincronizando"
          : account.status === "error"
          ? "Com erros"
          : "Conectado";
      const statusColor =
        account.status === "error"
          ? "#e53935"
          : account.status === "syncing"
          ? "#f4a261"
          : "#2a9d8f";
      const categoryLabel = getCalendarCategoryLabel(account.color);
      const accountLabel = account.displayName?.trim() || account.email;
      const providerLabel =
        account.provider === "google"
          ? "Google Calendar"
          : account.provider === "outlook"
          ? "Outlook/Office 365"
          : "Calendário ICS (somente leitura)";

      return (
        <View key={account.id} style={[styles.accountCard, { borderLeftColor: account.color }]}>
          <View style={styles.accountHeader}>
            <Ionicons name={iconName} size={26} color={account.color} />
            <View style={styles.accountInfo}>
              <View style={styles.accountTagsRow}>
                <View style={styles.accountCategoryBadge}>
                  <View style={[styles.accountCategoryDot, { backgroundColor: account.color }]} />
                  <Text style={styles.accountCategoryText}>{categoryLabel}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                  <Text style={styles.statusBadgeText}>{statusLabel}</Text>
                </View>
              </View>
              <Text style={styles.accountEmail}>{accountLabel}</Text>
              <Text style={styles.accountProvider}>{providerLabel}</Text>
              <Text style={styles.lastSyncLabel}>
                Sincronizado em: {account.lastSync ? new Date(account.lastSync).toLocaleString("pt-BR") : "Nunca"}
              </Text>
            </View>
          </View>

          <View style={styles.accountActions}>
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={() => handleDisconnectRequest(account)}
              disabled={disconnecting && disconnectingAccount?.id === account.id}
            >
              {disconnecting && disconnectingAccount?.id === account.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.disconnectButtonText}>Desconectar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [disconnecting, disconnectingAccount, handleDisconnectRequest, outlookOAuthConfig]
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity
        style={styles.importButton}
        onPress={openProviderModal}
        disabled={connectingProvider !== null}
      >
        <Text style={styles.importButtonText}>Importar Calendário</Text>
        <View style={styles.importIconsRow}>
          {providerOptions.map((option) => (
            <MaterialCommunityIcons
              key={option.id}
              name={option.icon}
              size={28}
              color="#1f2d3d"
              style={{ opacity: connectingProvider ? 0.4 : 1 }}
            />
          ))}
        </View>
      </TouchableOpacity>

      {feedbackMessage ? <Text style={styles.feedbackText}>{feedbackMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2a9d8f" />
        </View>
      ) : (
        sortedAccounts.map(renderAccountCard)
      )}

      <Modal
        visible={importModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.providerModalContent}>
            <Text style={styles.modalTitle}>Escolha o calendário</Text>
            <Text style={styles.modalMessage}>Selecione o provedor que deseja importar.</Text>
            <View style={styles.providerList}>
              {providerOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={styles.providerOption}
                  onPress={() => handleSelectProvider(option)}
                >
                  <MaterialCommunityIcons name={option.icon} size={28} color="#264653" />
                  <View style={styles.providerTexts}>
                    <Text style={styles.providerTitle}>{option.title}</Text>
                    <Text style={styles.providerSubtitle}>{option.subtitle}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.modalCancelButton} onPress={() => setImportModalVisible(false)}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={colorModalVisible} transparent animationType="fade" onRequestClose={closeColorModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Classifique sua agenda</Text>
            <Text style={styles.modalMessage}>
              Escolha se esta agenda será usada para compromissos pessoais ou de trabalho. A cor selecionada será aplicada em todos os cards relacionados.
            </Text>
            {selectedOption?.provider === "outlook" ? (
              <View style={styles.tenantSection}>
                <Text style={styles.sectionTitle}>Tipo de conta Microsoft</Text>
                <View style={styles.tenantOptions}>
                  <TouchableOpacity
                    style={[
                      styles.tenantOption,
                      outlookAccountType === "personal" && styles.tenantOptionSelected,
                    ]}
                    onPress={() => setOutlookAccountType("personal")}
                  >
                    <MaterialCommunityIcons
                      name="account-circle-outline"
                      size={26}
                      color={outlookAccountType === "personal" ? "#1f2d3d" : "#475569"}
                    />
                    <View style={styles.tenantTexts}>
                      <Text
                        style={[
                          styles.tenantOptionTitle,
                          outlookAccountType === "personal" && styles.tenantOptionTitleSelected,
                        ]}
                      >
                        Conta pessoal
                      </Text>
                      <Text style={styles.tenantOptionSubtitle}>Outlook.com, Hotmail, Live</Text>
                    </View>
                    {outlookAccountType === "personal" ? (
                      <Ionicons name="checkmark-circle" size={22} color="#2a9d8f" />
                    ) : null}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.tenantOption,
                      outlookAccountType === "business" && styles.tenantOptionSelected,
                    ]}
                    onPress={() => setOutlookAccountType("business")}
                  >
                    <MaterialCommunityIcons
                      name="briefcase-variant-outline"
                      size={26}
                      color={outlookAccountType === "business" ? "#1f2d3d" : "#475569"}
                    />
                    <View style={styles.tenantTexts}>
                      <Text
                        style={[
                          styles.tenantOptionTitle,
                          outlookAccountType === "business" && styles.tenantOptionTitleSelected,
                        ]}
                      >
                        Conta corporativa
                      </Text>
                      <Text style={styles.tenantOptionSubtitle}>Microsoft 365, Office 365</Text>
                    </View>
                    {outlookAccountType === "business" ? (
                      <Ionicons name="checkmark-circle" size={22} color="#2a9d8f" />
                    ) : null}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {selectedOption?.provider === "ics" ? (
              <View style={styles.icsSection}>
                <Text style={styles.sectionTitle}>Link ICS</Text>
                <TextInput
                  style={styles.icsInput}
                  placeholder="https://..."
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  value={icsUrlInput}
                  onChangeText={setIcsUrlInput}
                />
                <Text style={styles.icsHelperText}>
                  Informe o endereço público do arquivo .ics que deseja importar. Links iniciando
                  com webcal:// serão convertidos para https.
                </Text>
                <Text style={styles.sectionTitle}>Nome para exibição (opcional)</Text>
                <TextInput
                  style={styles.icsInput}
                  placeholder="Ex.: Agenda da empresa"
                  placeholderTextColor="#94a3b8"
                  value={icsLabelInput}
                  onChangeText={setIcsLabelInput}
                />
                <Text style={styles.icsHelperText}>
                  Os eventos serão importados em modo somente leitura e não serão enviados de volta
                  para sua agenda.
                </Text>
              </View>
            ) : null}
            <View style={styles.colorGrid}>
              {CALENDAR_CATEGORIES.map((category) => {
                const selected = category.key === selectedCategory.key;
                return (
                  <TouchableOpacity
                    key={category.key}
                    style={[styles.categoryOption, selected && styles.categoryOptionSelected]}
                    onPress={() => setSelectedCategory(category)}
                  >
                    <View
                      style={[styles.categoryColorDot, { backgroundColor: category.color }]}
                    />
                    <Text
                      style={[
                        styles.categoryOptionLabel,
                        selected && styles.categoryOptionLabelSelected,
                      ]}
                    >
                      {category.label}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={category.color} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryButton}
                onPress={closeColorModal}
                disabled={connectingProvider !== null}
              >
                <Text style={styles.modalSecondaryText}>Voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalPrimaryButton,
                  (connectingProvider !== null ||
                    (selectedOption?.provider === "ics" && !icsUrlInput.trim())) &&
                    styles.modalPrimaryButtonDisabled,
                ]}
                onPress={beginAuth}
                disabled={
                  connectingProvider !== null ||
                  (selectedOption?.provider === "ics" && !icsUrlInput.trim())
                }
              >
                {connectingProvider ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Continuar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(disconnectingAccount)}
        transparent
        animationType="fade"
        onRequestClose={cancelDisconnect}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Remover integração</Text>
            <Text style={styles.modalMessage}>
              Ao desconectar, todas as tarefas sincronizadas dessa conta serão removidas do aplicativo.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryButton}
                onPress={cancelDisconnect}
                disabled={disconnecting}
              >
                <Text style={styles.modalSecondaryText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalDangerButton}
                onPress={confirmDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Desconectar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
  },
  loadingContainer: {
    paddingVertical: 32,
    alignItems: "center",
  },
  importButton: {
    backgroundColor: "#f1f5f9",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#dbe4f0",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  importButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2d3d",
  },
  importIconsRow: {
    flexDirection: "row",
    gap: 16,
  },
  feedbackText: {
    color: "#2a9d8f",
    fontSize: 14,
  },
  errorText: {
    color: "#e53935",
    fontSize: 14,
  },
  accountCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  accountHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  accountInfo: {
    flex: 1,
    gap: 4,
  },
  accountTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  accountEmail: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2d3d",
  },
  accountProvider: {
    color: "#64748b",
    fontSize: 13,
  },
  accountCategoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#e2e8f0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  accountCategoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  accountCategoryText: {
    color: "#1f2937",
    fontWeight: "600",
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusBadgeText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  lastSyncLabel: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 2,
  },
  accountActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },

  disconnectButton: {
    backgroundColor: "#e53935",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  providerModalContent: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
  modalContent: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2d3d",
  },
  modalMessage: {
    fontSize: 14,
    color: "#475569",
  },
  providerList: {
    gap: 12,
  },
  providerOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  providerTexts: {
    flex: 1,
  },
  providerTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2d3d",
  },
  providerSubtitle: {
    fontSize: 13,
    color: "#64748b",
  },
  tenantSection: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2d3d",
  },
  tenantOptions: {
    gap: 10,
  },
  tenantOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
  },
  tenantOptionSelected: {
    borderColor: "#2a9d8f",
    backgroundColor: "#e0f7f4",
  },
  tenantTexts: {
    flex: 1,
    gap: 2,
  },
  tenantOptionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2937",
  },
  tenantOptionTitleSelected: {
    color: "#0f172a",
  },
  tenantOptionSubtitle: {
    fontSize: 12,
    color: "#64748b",
  },
  icsSection: {
    gap: 12,
  },
  icsInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
  },
  icsHelperText: {
    fontSize: 12,
    color: "#64748b",
  },
  colorGrid: {
    width: "100%",
    gap: 12,
  },
  categoryOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
  },
  categoryOptionSelected: {
    borderColor: "#264653",
    backgroundColor: "#e0f2f1",
  },
  categoryColorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  categoryOptionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2937",
  },
  categoryOptionLabelSelected: {
    color: "#0f172a",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalPrimaryButton: {
    backgroundColor: "#2a9d8f",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.7,
  },
  modalPrimaryText: {
    color: "#fff",
    fontWeight: "600",
  },
  modalSecondaryButton: {
    backgroundColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  modalSecondaryText: {
    color: "#1f2937",
    fontWeight: "600",
  },
  modalDangerButton: {
    backgroundColor: "#e53935",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  modalCancelButton: {
    alignSelf: "center",
    paddingVertical: 8,
  },
  modalCancelText: {
    color: "#1f2937",
    fontWeight: "600",
  },
});









