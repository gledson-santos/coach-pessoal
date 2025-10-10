import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Vibration,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import {
  Evento,
  atualizarEvento,
  atualizarPomodoroEstado,
  listarEventos,
  salvarEvento,
  subscribeEventoChanges,
} from "../database";
import { triggerEventSync } from "../services/eventSync";
import { filterVisibleEvents } from "../utils/eventFilters";

type PomodoroStage = "focus" | "break" | "finished";

type PomodoroState = {
  task: Evento;
  sentimentoInicio: number;
  cycleDurations: number[];
  currentCycle: number;
  stage: PomodoroStage;
  remainingMs: number;
  paused: boolean;
  breakDuration: number;
  awaitingAction: boolean;
  targetTimestamp: number | null;
};

type FinalizeContext = {
  task: Evento;
  sentimentoInicio: number;
  autoCompleted: boolean;
};

const BREAK_DURATION_MINUTES = 5;
const TIMER_TOP_PADDING = Platform.select({ ios: 60, android: 40, default: 32 });

const formatCountdown = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const calcularDuracaoBase = (sentimento: number, tempoTotal: number) => {
  const base = sentimento <= 2 ? 15 : 15 + (sentimento - 2) * 5;
  if (tempoTotal <= 0) {
    return base;
  }
  return Math.min(base, tempoTotal);
};

const gerarCiclos = (tempoTotal: number, base: number) => {
  const ciclos: number[] = [];
  const total = tempoTotal > 0 ? tempoTotal : base;
  const duracaoBase = Math.max(1, Math.round(base));
  let restante = Math.max(1, Math.round(total));

  while (restante > 0) {
    const atual = Math.min(duracaoBase, restante);
    ciclos.push(atual);
    restante -= atual;
  }

  return ciclos.length > 0 ? ciclos : [duracaoBase];
};

const formatarDataCurta = (valor?: string | null) => {
  if (!valor) {
    return "Selecione quando retomar";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "Selecione quando retomar";
  }
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatarDataParaInput = (valor?: string | null) => {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "";
  }
  const semOffset = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return semOffset.toISOString().slice(0, 16);
};

const PomodoroContext = createContext<{
  state: PomodoroState | null;
  startTask: (task: Evento, options: { sentimentoInicio: number }) => Promise<void>;
  getActiveTaskId: () => number | null;
} | null>(null);

export const usePomodoro = () => {
  const context = useContext(PomodoroContext);
  if (!context) {
    throw new Error("usePomodoro deve ser usado dentro de PomodoroProvider");
  }
  return context;
};

const sanitizeCycleDurations = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const sanitized = value
    .map((item) => (typeof item === "number" ? Math.max(1, Math.round(item)) : null))
    .filter((item): item is number => item !== null);
  return sanitized.length > 0 ? sanitized : null;
};

const sanitizePomodoroStage = (value: unknown): PomodoroStage | null => {
  if (value === "focus" || value === "break" || value === "finished") {
    return value;
  }
  return null;
};

const PomodoroOverlay: React.FC<{
  state: PomodoroState | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onPauseToggle: () => void;
  onFinalize: () => void;
  onJumpToTest: () => void;
  stageLabel: string;
  actionLabel: string;
  statusMessage: string | null;
  breakReminder: string | null;
}> = ({
  state,
  expanded,
  onToggleExpanded,
  onPauseToggle,
  onFinalize,
  onJumpToTest,
  stageLabel,
  actionLabel,
  statusMessage,
  breakReminder,
}) => {
  if (!state) {
    return null;
  }

  const timerBannerStatus = state.awaitingAction
    ? state.stage === "break"
      ? "Pronto para pausa"
      : "Pronto para novo ciclo"
    : state.paused
    ? "Pausado"
    : "Em andamento";

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.timerOverlay} pointerEvents="box-none">
        {expanded && (
          <TouchableOpacity
            style={styles.timerBackdrop}
            activeOpacity={1}
            onPress={onToggleExpanded}
          />
        )}
        <View style={styles.timerContainer} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.timerBanner}
            activeOpacity={0.9}
            onPress={onToggleExpanded}
          >
            <View style={styles.timerBannerTexts}>
              <Text style={styles.timerBannerTitle} numberOfLines={1}>
                {state.task.titulo}
              </Text>
              <Text style={styles.timerBannerSubtitle} numberOfLines={1}>
                {stageLabel} • {formatCountdown(state.remainingMs)}
              </Text>
              <Text style={styles.timerBannerMeta} numberOfLines={1}>
                Ciclo {state.currentCycle + 1} de {state.cycleDurations.length} · {timerBannerStatus}
              </Text>
            </View>
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={20}
              style={styles.timerBannerIcon}
            />
          </TouchableOpacity>
          {expanded && (
            <View style={styles.timerModal}>
              <Text style={styles.timerTitulo} numberOfLines={2}>
                {state.task.titulo}
              </Text>
              <Text style={styles.timerEtapa}>{stageLabel}</Text>
              <Text style={styles.timerContagem}>{formatCountdown(state.remainingMs)}</Text>
              <Text style={styles.timerCiclo}>
                Ciclo {state.currentCycle + 1} de {state.cycleDurations.length}
              </Text>
              {breakReminder && <Text style={styles.timerPausa}>{breakReminder}</Text>}
              {statusMessage && <Text style={styles.timerStatus}>{statusMessage}</Text>}
              <View style={styles.timerAcoes}>
                <TouchableOpacity
                  style={styles.timerBotaoSecundario}
                  onPress={onPauseToggle}
                  activeOpacity={0.8}
                >
                  <Text style={styles.timerBotaoSecundarioTexto}>{actionLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.timerBotaoPrincipal}
                  onPress={onFinalize}
                  activeOpacity={0.85}
                >
                  <Text style={styles.timerBotaoPrincipalTexto}>Finalizar</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.timerBotaoTeste}
                onPress={onJumpToTest}
                activeOpacity={0.8}
              >
                <Text style={styles.timerBotaoTesteTexto}>Ir para 3s (teste)</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

export const PomodoroProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [timerState, setTimerState] = useState<PomodoroState | null>(null);
  const [timerExpanded, setTimerExpanded] = useState(false);
  const [finalizeModalVisible, setFinalizeModalVisible] = useState(false);
  const [finalizeContext, setFinalizeContext] = useState<FinalizeContext | null>(null);
  const [sentimentoFinal, setSentimentoFinal] = useState<number | null>(null);
  const [atividadeConcluida, setAtividadeConcluida] = useState<boolean | null>(null);
  const [followUpDate, setFollowUpDate] = useState<string | null>(null);
  const [mostrarFollowUpPicker, setMostrarFollowUpPicker] = useState(false);
  const [hasUserGesture, setHasUserGesture] = useState(Platform.OS !== "web");
  const followUpInputRef = useRef<any>(null);
  const awaitingActionRef = useRef(false);
  const finalizeHandledRef = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || hasUserGesture) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const handleFirstInteraction = () => {
      setHasUserGesture(true);
    };

    window.addEventListener("pointerdown", handleFirstInteraction, { once: true } as any);
    window.addEventListener("keydown", handleFirstInteraction, { once: true } as any);

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
    };
  }, [hasUserGesture]);

  const persistPomodoroSnapshot = useCallback(
    async (state: PomodoroState | null) => {
      if (!state || !state.task.id) {
        return;
      }
      const sanitizedRemaining = Math.max(0, Math.round(state.remainingMs));
      const targetIso =
        !state.paused && !state.awaitingAction && state.targetTimestamp
          ? new Date(state.targetTimestamp).toISOString()
          : null;

      try {
        await atualizarPomodoroEstado(state.task.id, {
          stage: state.stage,
          currentCycle: state.currentCycle,
          remainingMs: sanitizedRemaining,
          paused: state.paused,
          awaitingAction: state.awaitingAction,
          targetTimestamp: targetIso,
          cycleDurations: state.cycleDurations,
          breakDuration: state.breakDuration,
        });
      } catch (error) {
        console.warn("[pomodoro] failed to persist state", error);
      }
    },
    []
  );

  const buildTimerStateFromTask = useCallback((task: Evento): PomodoroState | null => {
    if (typeof task.sentimentoInicio !== "number") {
      return null;
    }
    const sentimento = task.sentimentoInicio;
    const ciclosOrigem = sanitizeCycleDurations(task.pomodoroCycleDurations);
    const tempoTotal = task.tempoExecucao ?? 15;
    const base = calcularDuracaoBase(sentimento, tempoTotal);
    const ciclos = ciclosOrigem ?? gerarCiclos(tempoTotal, base);
    const stage = sanitizePomodoroStage(task.pomodoroStage) ?? "focus";
    const breakDuration = task.pomodoroBreakDuration
      ? Math.max(1, task.pomodoroBreakDuration)
      : BREAK_DURATION_MINUTES;
    const awaitingAction = Boolean(task.pomodoroAwaitingAction);
    const paused = awaitingAction ? true : Boolean(task.pomodoroPaused);
    const currentCycleRaw = task.pomodoroCurrentCycle ?? 0;
    const currentCycle = Math.min(Math.max(0, currentCycleRaw), ciclos.length - 1);
    let remainingMs =
      typeof task.pomodoroRemainingMs === "number"
        ? Math.max(0, task.pomodoroRemainingMs)
        : ciclos[currentCycle] * 60 * 1000;
    const defaultRemaining = ciclos[currentCycle] * 60 * 1000;

    let targetTimestamp: number | null = null;
    if (task.pomodoroTargetTimestamp) {
      const parsed = new Date(task.pomodoroTargetTimestamp);
      if (!Number.isNaN(parsed.getTime())) {
        targetTimestamp = parsed.getTime();
        const diff = targetTimestamp - Date.now();
        if (diff >= 0) {
          remainingMs = diff;
        }
      }
    }

    if ((paused || awaitingAction) && remainingMs <= 0) {
      remainingMs = defaultRemaining;
    }

    return {
      task,
      sentimentoInicio: sentimento,
      cycleDurations: ciclos,
      currentCycle,
      stage,
      remainingMs,
      paused,
      breakDuration,
      awaitingAction,
      targetTimestamp,
    };
  }, []);

  const triggerStageAlert = useCallback(() => {
    if (Platform.OS === "web" && !hasUserGesture) {
      return;
    }
    try {
      Vibration.vibrate([0, 350, 150, 350]);
    } catch (error) {
      console.warn("[pomodoro] failed to vibrate device", error);
    }
  }, [hasUserGesture]);

  const abrirFinalizacao = useCallback((state: PomodoroState, autoCompleted: boolean) => {
    setFinalizeContext({
      task: state.task,
      sentimentoInicio: state.sentimentoInicio,
      autoCompleted,
    });
    setSentimentoFinal(null);
    setAtividadeConcluida(null);
    setFollowUpDate(null);
    setMostrarFollowUpPicker(false);
    setFinalizeModalVisible(true);
  }, []);

  const loadActiveState = useCallback(async () => {
    const eventos = await listarEventos();
    const visiveis = filterVisibleEvents(eventos);
    const pendenteFinalizacao = visiveis.find(
      (task) => task.pomodoroStage === "finished" && !task.concluida
    );
    if (pendenteFinalizacao) {
      const identifier = pendenteFinalizacao.id ?? -1;
      if (finalizeHandledRef.current !== identifier) {
        const hydrated = buildTimerStateFromTask(pendenteFinalizacao);
        if (hydrated) {
          finalizeHandledRef.current = identifier;
          abrirFinalizacao(hydrated, true);
        }
      }
    }

    const ativo = visiveis.find((task) => {
      if (typeof task.sentimentoInicio !== "number") {
        return false;
      }
      if (task.pomodoroStage === "finished") {
        return false;
      }
      return (
        task.pomodoroStage === "focus" ||
        task.pomodoroStage === "break" ||
        Boolean(task.pomodoroAwaitingAction) ||
        typeof task.pomodoroRemainingMs === "number" ||
        Boolean(task.pomodoroTargetTimestamp)
      );
    });

    if (!ativo) {
      setTimerState(null);
      return;
    }

    const hydrated = buildTimerStateFromTask(ativo);
    if (!hydrated) {
      setTimerState(null);
      return;
    }

    setTimerState(hydrated);
  }, [abrirFinalizacao, buildTimerStateFromTask]);

  useEffect(() => {
    loadActiveState();
    const unsubscribe = subscribeEventoChanges(() => {
      loadActiveState();
    });
    return () => {
      unsubscribe();
    };
  }, [loadActiveState]);

  useEffect(() => {
    const awaiting = Boolean(timerState?.awaitingAction);
    if (!awaitingActionRef.current && awaiting) {
      triggerStageAlert();
      setTimerExpanded(true);
    }
    awaitingActionRef.current = awaiting;
    if (!timerState) {
      awaitingActionRef.current = false;
    }
  }, [timerState, triggerStageAlert]);

  useEffect(() => {
    if (!timerState) {
      setTimerExpanded(false);
    }
  }, [timerState]);

  useEffect(() => {
    if (
      !timerState ||
      timerState.paused ||
      timerState.awaitingAction ||
      timerState.stage === "finished"
    ) {
      return;
    }

    const interval = setInterval(() => {
      setTimerState((current) => {
        if (
          !current ||
          current.paused ||
          current.awaitingAction ||
          current.stage === "finished"
        ) {
          return current;
        }

        const now = Date.now();
        const baseRemaining = current.targetTimestamp
          ? current.targetTimestamp - now
          : current.remainingMs - 1000;
        const remaining = Math.max(0, baseRemaining);

        if (remaining > 0) {
          return { ...current, remainingMs: remaining };
        }

        if (current.stage === "focus") {
          if (current.currentCycle >= current.cycleDurations.length - 1) {
            const finishedState: PomodoroState = {
              ...current,
              stage: "finished",
              remainingMs: 0,
              paused: true,
              awaitingAction: true,
              targetTimestamp: null,
            };
            persistPomodoroSnapshot(finishedState);
            abrirFinalizacao(finishedState, true);
            return null;
          }

          const breakMs = current.breakDuration * 60 * 1000;
          const breakState: PomodoroState = {
            ...current,
            stage: "break",
            remainingMs: breakMs,
            paused: true,
            awaitingAction: true,
            targetTimestamp: null,
          };
          persistPomodoroSnapshot(breakState);
          return breakState;
        }

        if (current.stage === "break") {
          const proximo = current.currentCycle + 1;
          const focoMs = current.cycleDurations[proximo] * 60 * 1000;
          const focusState: PomodoroState = {
            ...current,
            stage: "focus",
            currentCycle: proximo,
            remainingMs: focoMs,
            paused: true,
            awaitingAction: true,
            targetTimestamp: null,
          };
          persistPomodoroSnapshot(focusState);
          return focusState;
        }

        return current;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [timerState, abrirFinalizacao, persistPomodoroSnapshot]);

  const togglePause = useCallback(() => {
    setTimerState((current) => {
      if (!current || current.stage === "finished") {
        return current;
      }

      let updated: PomodoroState;
      if (current.awaitingAction || current.paused) {
        const duration = Math.max(0, Math.round(current.remainingMs));
        const target = Date.now() + duration;
        updated = {
          ...current,
          paused: false,
          awaitingAction: false,
          targetTimestamp: target,
          remainingMs: duration,
        };
      } else {
        const remaining = current.targetTimestamp
          ? Math.max(0, current.targetTimestamp - Date.now())
          : Math.max(0, Math.round(current.remainingMs));
        updated = {
          ...current,
          paused: true,
          awaitingAction: false,
          targetTimestamp: null,
          remainingMs: remaining,
        };
      }

      persistPomodoroSnapshot(updated);
      return updated;
    });
  }, [persistPomodoroSnapshot]);

  const handleJumpToTestSeconds = useCallback(() => {
    setTimerState((current) => {
      if (!current || current.stage === "finished") {
        return current;
      }
      const isRunning = !current.paused && !current.awaitingAction;
      const updated: PomodoroState = {
        ...current,
        remainingMs: 3000,
        targetTimestamp: isRunning ? Date.now() + 3000 : null,
      };
      persistPomodoroSnapshot(updated);
      return updated;
    });
  }, [persistPomodoroSnapshot]);

  const handleFinalizeRequest = useCallback(() => {
    let snapshot: PomodoroState | null = null;
    setTimerState((current) => {
      if (!current) {
        return current;
      }
      const finishedState: PomodoroState = {
        ...current,
        stage: "finished",
        remainingMs: 0,
        paused: true,
        awaitingAction: true,
        targetTimestamp: null,
      };
      persistPomodoroSnapshot(finishedState);
      finalizeHandledRef.current = current.task.id ?? -1;
      snapshot = finishedState;
      return null;
    });
    if (snapshot) {
      abrirFinalizacao(snapshot, false);
    }
  }, [abrirFinalizacao, persistPomodoroSnapshot]);

  const handleFinalizeCancel = useCallback(() => {
    setFinalizeModalVisible(false);
    setMostrarFollowUpPicker(false);
    setSentimentoFinal(null);
    setAtividadeConcluida(null);
    setFollowUpDate(null);
    setFinalizeContext(null);
  }, []);

  const aoAlterarFollowUp = useCallback((event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== "ios") {
      setMostrarFollowUpPicker(false);
    }
    if (event.type === "dismissed") {
      return;
    }
    if (date) {
      setFollowUpDate(date.toISOString());
    }
  }, []);

  const aoAlterarFollowUpWeb = useCallback((valor: string) => {
    if (!valor) {
      setFollowUpDate(null);
      return;
    }
    const selecionada = new Date(valor);
    if (Number.isNaN(selecionada.getTime())) {
      setFollowUpDate(null);
      return;
    }
    setFollowUpDate(selecionada.toISOString());
  }, []);

  const abrirSeletorFollowUp = useCallback(() => {
    if (Platform.OS === "web") {
      const elemento = followUpInputRef.current;
      if (elemento) {
        if (typeof elemento.showPicker === "function") {
          elemento.showPicker();
        } else if (typeof elemento.click === "function") {
          elemento.click();
        }
        if (typeof elemento.focus === "function") {
          elemento.focus();
        }
      }
      return;
    }
    setMostrarFollowUpPicker(true);
  }, []);

  const handleFinalizeConfirm = useCallback(async () => {
    if (!finalizeContext) {
      return;
    }

    if (sentimentoFinal === null) {
      Alert.alert("Sentimento", "Informe como você está se sentindo agora.");
      return;
    }

    if (atividadeConcluida === null) {
      Alert.alert("Status", "Informe se a atividade foi concluída.");
      return;
    }

    let followUpIso = followUpDate;
    if (!atividadeConcluida) {
      if (!followUpIso) {
        Alert.alert("Nova tentativa", "Defina quando retomará a atividade.");
        return;
      }
      const parsed = new Date(followUpIso);
      if (Number.isNaN(parsed.getTime())) {
        Alert.alert("Nova tentativa", "Informe uma data válida para retomar.");
        return;
      }
      followUpIso = parsed.toISOString();
    }

    const eventoAtualizado: Evento = {
      ...finalizeContext.task,
      sentimentoInicio: finalizeContext.sentimentoInicio,
      sentimentoFim: sentimentoFinal,
      concluida: true,
    } as Evento;

    await atualizarEvento(eventoAtualizado);
    if (eventoAtualizado.id) {
      await atualizarPomodoroEstado(eventoAtualizado.id, {
        stage: null,
        currentCycle: null,
        remainingMs: null,
        paused: null,
        awaitingAction: null,
        targetTimestamp: null,
        cycleDurations: null,
        breakDuration: null,
      });
    }

    if (!atividadeConcluida && followUpIso) {
      const novaAtividade: Evento = {
        titulo: finalizeContext.task.titulo,
        observacao: finalizeContext.task.observacao,
        data: followUpIso,
        inicio: followUpIso,
        tipo: finalizeContext.task.tipo,
        dificuldade: finalizeContext.task.dificuldade,
        tempoExecucao: finalizeContext.task.tempoExecucao,
        cor: finalizeContext.task.cor,
        provider: finalizeContext.task.provider,
        accountId: finalizeContext.task.accountId,
        status: finalizeContext.task.status ?? "ativo",
        concluida: false,
        sentimentoInicio: null,
        sentimentoFim: null,
      } as Evento;
      await salvarEvento(novaAtividade);
    }

    setTimerState(null);
    setFinalizeModalVisible(false);
    setFinalizeContext(null);
    setMostrarFollowUpPicker(false);
    setSentimentoFinal(null);
    setAtividadeConcluida(null);
    setFollowUpDate(null);
    finalizeHandledRef.current = null;

    try {
      await triggerEventSync({ force: true });
    } catch (error) {
      console.warn("[pomodoro] failed to trigger sync after finalize", error);
    }
  }, [
    atividadeConcluida,
    finalizeContext,
    followUpDate,
    sentimentoFinal,
  ]);

  const startTask = useCallback(
    async (task: Evento, { sentimentoInicio }: { sentimentoInicio: number }) => {
      if (!task.id) {
        Alert.alert("Tarefa não encontrada", "Salve a atividade antes de iniciar.");
        return;
      }

      if (timerState && timerState.task.id !== task.id) {
        Alert.alert(
          "Pomodoro em andamento",
          "Finalize ou pause a atividade atual antes de iniciar uma nova."
        );
        return;
      }

      const tempoTotal = task.tempoExecucao ?? 15;
      const base = calcularDuracaoBase(sentimentoInicio, tempoTotal);
      const ciclos = gerarCiclos(tempoTotal, base);
      const atualizado: Evento = {
        ...task,
        sentimentoInicio,
        sentimentoFim: null,
        concluida: false,
      } as Evento;

      await atualizarEvento(atualizado);

      const initialMs = ciclos[0] * 60 * 1000;
      const targetTimestamp = Date.now() + initialMs;
      const initialState: PomodoroState = {
        task: atualizado,
        sentimentoInicio,
        cycleDurations: ciclos,
        currentCycle: 0,
        stage: "focus",
        remainingMs: initialMs,
        paused: false,
        breakDuration: BREAK_DURATION_MINUTES,
        awaitingAction: false,
        targetTimestamp,
      };

      await persistPomodoroSnapshot(initialState);
      setTimerState(initialState);
      setFinalizeContext(null);
      setSentimentoFinal(null);
      setAtividadeConcluida(null);
      setFollowUpDate(null);
      setMostrarFollowUpPicker(false);
      finalizeHandledRef.current = null;
    },
    [persistPomodoroSnapshot, timerState]
  );

  const getActiveTaskId = useCallback(() => timerState?.task.id ?? null, [timerState]);

  const timerStageLabel = timerState
    ? timerState.stage === "break"
      ? "Pausa curta"
      : "Foco na atividade"
    : "";

  const timerActionLabel = timerState
    ? timerState.awaitingAction
      ? timerState.stage === "break"
        ? "Iniciar pausa"
        : `Iniciar ciclo ${timerState.currentCycle + 1}`
      : timerState.paused
      ? "Retomar"
      : "Pausar"
    : "Pausar";

  const timerStatusMessage = timerState
    ? timerState.awaitingAction
      ? timerState.stage === "break"
        ? "Inicie sua pausa rápida para se hidratar e se movimentar."
        : "Toque em iniciar para começar o próximo ciclo de foco."
      : timerState.paused
      ? "Temporizador pausado"
      : null
    : null;

  const breakReminder =
    timerState?.stage === "break"
      ? "Momento de pausa: tome água, movimente-se e respire fundo."
      : null;

  const contextValue = useMemo(
    () => ({
      state: timerState,
      startTask,
      getActiveTaskId,
    }),
    [getActiveTaskId, startTask, timerState]
  );

  return (
    <PomodoroContext.Provider value={contextValue}>
      {children}
      {timerState && (
        <PomodoroOverlay
          state={timerState}
          expanded={timerExpanded}
          onToggleExpanded={() => setTimerExpanded((prev) => !prev)}
          onPauseToggle={togglePause}
          onFinalize={handleFinalizeRequest}
          onJumpToTest={handleJumpToTestSeconds}
          stageLabel={timerStageLabel}
          actionLabel={timerActionLabel}
          statusMessage={timerStatusMessage}
          breakReminder={breakReminder}
        />
      )}

      {finalizeModalVisible && finalizeContext && (
        <Modal visible transparent animationType="fade">
          <View style={styles.finalizeOverlay}>
            <View style={styles.finalizeModal}>
              <Text style={styles.finalizeTitulo}>Finalizar atividade</Text>
              <Text style={styles.finalizeDescricao}>
                Como você está se sentindo agora?
              </Text>
              <View style={styles.finalizeSentimentoOpcoes}>
                {[1, 2, 3, 4, 5].map((nivel) => {
                  const ativo = sentimentoFinal === nivel;
                  return (
                    <TouchableOpacity
                      key={`sentimento-final-${nivel}`}
                      style={[
                        styles.finalizeSentimentoOpcao,
                        ativo && styles.finalizeSentimentoOpcaoAtiva,
                      ]}
                      onPress={() => setSentimentoFinal(nivel)}
                    >
                      <Text
                        style={[
                          styles.finalizeSentimentoTexto,
                          ativo && styles.finalizeSentimentoTextoAtivo,
                        ]}
                      >
                        {nivel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.finalizePergunta}>A atividade foi concluída?</Text>
              <View style={styles.finalizeConclusaoOpcoes}>
                {[{ valor: true, label: "Sim" }, { valor: false, label: "Não" }].map(
                  (opcao) => {
                    const ativo = atividadeConcluida === opcao.valor;
                    return (
                      <TouchableOpacity
                        key={`conclusao-${opcao.label}`}
                        style={[
                          styles.finalizeConclusaoOpcao,
                          ativo && styles.finalizeConclusaoOpcaoAtiva,
                        ]}
                        onPress={() => setAtividadeConcluida(opcao.valor)}
                      >
                        <Text
                          style={[
                            styles.finalizeConclusaoTexto,
                            ativo && styles.finalizeConclusaoTextoAtivo,
                          ]}
                        >
                          {opcao.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>

              {atividadeConcluida === false && (
                <View style={styles.finalizeRetomarBloco}>
                  <Text style={styles.finalizeDescricao}>Quando você retomará?</Text>
                  <TouchableOpacity
                    style={styles.finalizeFollowUp}
                    onPress={abrirSeletorFollowUp}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.finalizeFollowUpTexto}>
                      {formatarDataCurta(followUpDate)}
                    </Text>
                    {Platform.OS === "web" && (
                      <input
                        ref={followUpInputRef}
                        type="datetime-local"
                        value={formatarDataParaInput(followUpDate)}
                        onChange={(event) => aoAlterarFollowUpWeb(event.target.value)}
                        style={{
                          position: "absolute",
                          opacity: 0,
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          cursor: "pointer",
                        }}
                      />
                    )}
                  </TouchableOpacity>
                  {Platform.OS !== "web" && mostrarFollowUpPicker && (
                    <DateTimePicker
                      value={followUpDate ? new Date(followUpDate) : new Date()}
                      mode="datetime"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={aoAlterarFollowUp}
                    />
                  )}
                </View>
              )}

              <View style={styles.finalizeAcoes}>
                <TouchableOpacity
                  style={styles.finalizeBotaoSecundario}
                  onPress={handleFinalizeCancel}
                >
                  <Text style={styles.finalizeBotaoSecundarioTexto}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.finalizeBotaoPrincipal}
                  onPress={handleFinalizeConfirm}
                >
                  <Text style={styles.finalizeBotaoPrincipalTexto}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </PomodoroContext.Provider>
  );
};

const styles = StyleSheet.create({
  timerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-start",
    paddingTop: TIMER_TOP_PADDING,
  },
  timerBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  timerContainer: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
  },
  timerBanner: {
    backgroundColor: "#2a9d8f",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timerBannerTexts: { flex: 1, marginRight: 12 },
  timerBannerTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  timerBannerSubtitle: { color: "#e0f7f4", fontSize: 14, marginTop: 2 },
  timerBannerMeta: { color: "#d0f0ec", fontSize: 12, marginTop: 2 },
  timerBannerIcon: { color: "#fff" },
  timerModal: {
    backgroundColor: "#fff",
    marginTop: 12,
    borderRadius: 16,
    padding: 20,
  },
  timerTitulo: { fontSize: 18, fontWeight: "700", color: "#264653" },
  timerEtapa: { fontSize: 14, color: "#2a9d8f", marginTop: 8 },
  timerContagem: { fontSize: 48, fontWeight: "700", color: "#264653", marginTop: 4 },
  timerCiclo: { fontSize: 14, color: "#6c757d", marginTop: 4 },
  timerPausa: { fontSize: 14, color: "#2a9d8f", marginTop: 12 },
  timerStatus: { fontSize: 13, color: "#6c757d", marginTop: 8 },
  timerAcoes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  timerBotaoSecundario: {
    flex: 1,
    marginRight: 12,
    borderWidth: 1,
    borderColor: "#2a9d8f",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  timerBotaoSecundarioTexto: { color: "#2a9d8f", fontSize: 15, fontWeight: "600" },
  timerBotaoPrincipal: {
    flex: 1,
    backgroundColor: "#e76f51",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  timerBotaoPrincipalTexto: { color: "#fff", fontSize: 15, fontWeight: "700" },
  timerBotaoTeste: {
    marginTop: 16,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f1faee",
  },
  timerBotaoTesteTexto: { color: "#2a9d8f", fontSize: 12, fontWeight: "600" },
  finalizeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  finalizeModal: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
  },
  finalizeTitulo: { fontSize: 20, fontWeight: "700", color: "#264653" },
  finalizeDescricao: { fontSize: 14, color: "#4a4a4a", marginTop: 12 },
  finalizeSentimentoOpcoes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  finalizeSentimentoOpcao: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#b7b7b7",
    alignItems: "center",
    justifyContent: "center",
  },
  finalizeSentimentoOpcaoAtiva: {
    backgroundColor: "#2a9d8f",
    borderColor: "#2a9d8f",
  },
  finalizeSentimentoTexto: { fontSize: 16, color: "#4a4a4a" },
  finalizeSentimentoTextoAtivo: { color: "#fff", fontWeight: "700" },
  finalizePergunta: { fontSize: 14, color: "#4a4a4a", marginTop: 24 },
  finalizeConclusaoOpcoes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  finalizeConclusaoOpcao: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#b7b7b7",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginHorizontal: 4,
  },
  finalizeConclusaoOpcaoAtiva: {
    borderColor: "#2a9d8f",
    backgroundColor: "#e0f7f4",
  },
  finalizeConclusaoTexto: { fontSize: 15, color: "#4a4a4a" },
  finalizeConclusaoTextoAtivo: { color: "#2a9d8f", fontWeight: "700" },
  finalizeRetomarBloco: { marginTop: 20 },
  finalizeFollowUp: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#b7b7b7",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    position: "relative",
  },
  finalizeFollowUpTexto: { fontSize: 15, color: "#264653" },
  finalizeAcoes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
  },
  finalizeBotaoSecundario: {
    flex: 1,
    marginRight: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#b7b7b7",
    paddingVertical: 12,
    alignItems: "center",
  },
  finalizeBotaoSecundarioTexto: { color: "#4a4a4a", fontSize: 15, fontWeight: "600" },
  finalizeBotaoPrincipal: {
    flex: 1,
    backgroundColor: "#2a9d8f",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  finalizeBotaoPrincipalTexto: { color: "#fff", fontSize: 15, fontWeight: "700" },
});

export type { PomodoroState, PomodoroStage };
