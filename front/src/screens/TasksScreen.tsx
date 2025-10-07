import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { Ionicons } from "@expo/vector-icons";
import TaskModal from "../components/TaskModal";
import { DEFAULT_CALENDAR_CATEGORY, getCalendarCategoryLabel, normalizeCalendarColor } from "../constants/calendarCategories";

import { deleteProviderEvent } from "../services/calendarProviderActions";
import { subscribeCalendarAccounts } from "../services/calendarAccountsStore";
import { notifyAccountLocalChange } from "../services/calendarSyncManager";
import { triggerEventSync } from "../services/eventSync";
import {
  Evento,
  atualizarEvento,
  deletarEvento,
  listarEventos,
  salvarEvento,
} from "../database";
import { filterVisibleEvents } from "../utils/eventFilters";
type Task = Evento;
type DisplayTask = Task & {
  aggregatedCount?: number;
};

type PomodoroStage = "focus" | "break" | "finished";

type PomodoroState = {
  task: Task;
  sentimentoInicio: number;
  cycleDurations: number[];
  currentCycle: number;
  stage: PomodoroStage;
  remainingMs: number;
  paused: boolean;
  breakDuration: number;
};

type FinalizeContext = {
  task: Task;
  sentimentoInicio: number;
  autoCompleted: boolean;
};

const BREAK_DURATION_MINUTES = 5;

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

const FILTERS = [
  { key: "atrasadas", label: "Atrasadas" },
  { key: "hoje", label: "Hoje" },
  { key: "proximas", label: "Próximas" },
  { key: "semData", label: "Sem Data" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];
const parseDate = (value?: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};
const formatDate = (value?: string) => {
  const date = parseDate(value);
  if (!date) return null;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
const formatDuration = (minutes?: number) => {
  if (!minutes) return "15 min";
  const horas = Math.floor(minutes / 60);
  const resto = minutes % 60;
  if (horas === 0) {
    return `${minutes} min`;
  }
  if (resto === 0) {
    return `${horas}h`;
  }
  return `${horas}h${resto.toString().padStart(2, "0")}`;
};
const calculateOpenDays = (task: Task) => {
  const createdAt = parseDate(task.inicio || task.data || undefined);
  if (!createdAt) {
    return 0;
  }
  const diffMs = Date.now() - createdAt.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : 0;
};
const isRecurringTask = (task: Task) => {
  const normalizedType = (task.tipo ?? "").toLowerCase();
  if (normalizedType.includes("recorr")) {
    return true;
  }

  if (typeof task.icsUid === "string" && task.icsUid.includes("::")) {
    return true;
  }

  if (typeof task.googleId === "string" && task.googleId.includes("_")) {
    return true;
  }

  if (typeof task.outlookId === "string" && task.outlookId.includes("_")) {
    return true;
  }

  return false;
};

const getRecurringGroupKey = (task: Task): string | null => {
  if (!isRecurringTask(task)) {
    return null;
  }

  if (typeof task.icsUid === "string" && task.icsUid.includes("::")) {
    return task.icsUid.split("::")[0]?.toLowerCase() ?? null;
  }

  if (typeof task.googleId === "string" && task.googleId.includes("_")) {
    return task.googleId.split("_")[0]?.toLowerCase() ?? null;
  }

  if (typeof task.outlookId === "string" && task.outlookId.includes("_")) {
    return task.outlookId.split("_")[0]?.toLowerCase() ?? null;
  }

  const title = (task.titulo ?? "").trim().toLowerCase();
  const type = (task.tipo ?? "").trim().toLowerCase();
  if (!title) {
    return null;
  }

  return `${type}:${title}`;
};

const groupUpcomingRecurringTasks = (
  tasks: Task[],
  todayBase: Date
): DisplayTask[] => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const result: DisplayTask[] = [];
  const grouped = new Map<string, DisplayTask>();

  tasks.forEach((task) => {
    const parsedDate = parseDate(task.data);
    if (!parsedDate) {
      result.push(task);
      return;
    }

    const baseDate = new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate()
    );

    const diffDays = Math.floor(
      (baseDate.getTime() - todayBase.getTime()) / msPerDay
    );

    const canGroup = diffDays > 1 && isRecurringTask(task);
    if (!canGroup) {
      result.push(task);
      return;
    }

    const groupKey = getRecurringGroupKey(task);
    if (!groupKey) {
      result.push(task);
      return;
    }

    const existing = grouped.get(groupKey);
    if (existing) {
      existing.aggregatedCount = (existing.aggregatedCount ?? 1) + 1;
      return;
    }

    const clone: DisplayTask = { ...task, aggregatedCount: 1 };
    grouped.set(groupKey, clone);
    result.push(clone);
  });

  grouped.forEach((value) => {
    if (value.aggregatedCount === 1) {
      delete value.aggregatedCount;
    }
  });

  return result;
};

type TaskCardProps = {
  task: DisplayTask;
  onEdit: () => void;
};
const TaskCard = ({ task, onEdit }: TaskCardProps) => {
  const tempo = task.tempoExecucao ?? 15;
  const dataFormatada = formatDate(task.data);
  const diasEmAberto = calculateOpenDays(task);
  const aggregatedCount = task.aggregatedCount ?? 0;
  const hasAggregation = aggregatedCount > 1;
  const descricao = dataFormatada
    ? hasAggregation
      ? `${aggregatedCount} próximas execuções agendadas`
      : `Execução: ${dataFormatada}`
    : diasEmAberto <= 0
    ? "Criada hoje"
    : `Em aberto há ${diasEmAberto} dia${diasEmAberto === 1 ? "" : "s"}`;
  const calendarColor = normalizeCalendarColor(task.cor ?? DEFAULT_CALENDAR_CATEGORY.color);
  const categoryLabel = getCalendarCategoryLabel(task.cor ?? null);
  const badgeBackground = `${calendarColor}26`;
  const recurring = isRecurringTask(task);
  return (
    <TouchableOpacity
      style={styles.cardWrapper}
      activeOpacity={0.85}
      onPress={onEdit}
    >
      <View style={[styles.cardAccent, { backgroundColor: calendarColor }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {task.titulo}
          </Text>
          <Ionicons name="create-outline" size={20} style={styles.cardHeaderIcon} />
        </View>
        <View style={styles.cardMetaRow}>
          <Ionicons name="calendar-outline" size={16} style={styles.metaIcon} />
          <Text style={[styles.cardSecondaryText, styles.cardMetaPrimaryText]}>
            {descricao}
          </Text>
          <View style={styles.metaDivider} />
          <Ionicons name="time-outline" size={16} style={styles.metaIcon} />
          <Text style={styles.cardMetaText}>{formatDuration(tempo)}</Text>
        </View>
        <View style={[styles.cardMetaRow, styles.cardMetaRowSpacing]}>
          <Ionicons name="speedometer-outline" size={16} style={styles.metaIcon} />
          <Text style={styles.cardMetaText}>Dificuldade: {task.dificuldade}</Text>
          {recurring && (
            <View style={[styles.recurringTag, styles.metaTag]}>
              <Text style={styles.recurringTagText}>Recorrente</Text>
            </View>
          )}
          <View style={[styles.cardCategoryBadge, styles.metaTag, { backgroundColor: badgeBackground }]}>
            <View style={[styles.cardCategoryDot, { backgroundColor: calendarColor }]} />
            <Text style={styles.cardCategoryText}>{categoryLabel}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};
export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("hoje");
  const [timerState, setTimerState] = useState<PomodoroState | null>(null);
  const [finalizeModalVisible, setFinalizeModalVisible] = useState(false);
  const [finalizeContext, setFinalizeContext] = useState<FinalizeContext | null>(null);
  const [sentimentoFinal, setSentimentoFinal] = useState<number | null>(null);
  const [atividadeConcluida, setAtividadeConcluida] = useState<boolean | null>(null);
  const [followUpDate, setFollowUpDate] = useState<string | null>(null);
  const [mostrarFollowUpPicker, setMostrarFollowUpPicker] = useState(false);
  const followUpInputRef = useRef<any>(null);
  const carregarTarefas = useCallback(async () => {
    const eventos = await listarEventos();
    const visiveis = filterVisibleEvents(eventos);
    const ativos = visiveis.filter((evento) => !evento.concluida);
    setTasks(ativos as Task[]);
  }, []);

  useEffect(() => {
    carregarTarefas();
  }, [carregarTarefas]);

  useEffect(() => {
    const lastSyncMap = new Map<string, string | null>();
    const unsubscribe = subscribeCalendarAccounts((list) => {
      let shouldReload = false;
      let removedAccount = false;
      const presentIds = new Set<string>();

      list.forEach((account) => {
        presentIds.add(account.id);
        const lastSync = account.lastSync ?? null;
        const previous = lastSyncMap.get(account.id);
        if (lastSync && lastSync !== previous) {
          shouldReload = true;
        }
        lastSyncMap.set(account.id, lastSync);
      });

      Array.from(lastSyncMap.keys()).forEach((id) => {
        if (!presentIds.has(id)) {
          removedAccount = true;
          lastSyncMap.delete(id);
        }
      });

      if (shouldReload || removedAccount) {
        carregarTarefas();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [carregarTarefas]);

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

  const handleStartTask = useCallback(
    async (task: Task, { sentimentoInicio }: { sentimentoInicio: number }) => {
      if (!task.id) {
        Alert.alert("Tarefa não encontrada", "Salve a atividade antes de iniciar.");
        return;
      }

      const tempoTotal = task.tempoExecucao ?? 15;
      const base = calcularDuracaoBase(sentimentoInicio, tempoTotal);
      const ciclos = gerarCiclos(tempoTotal, base);
      const atualizado: Task = {
        ...task,
        sentimentoInicio,
        sentimentoFim: null,
        concluida: false,
      };

      await atualizarEvento(atualizado);

      setTimerState({
        task: atualizado,
        sentimentoInicio,
        cycleDurations: ciclos,
        currentCycle: 0,
        stage: "focus",
        remainingMs: ciclos[0] * 60 * 1000,
        paused: false,
        breakDuration: BREAK_DURATION_MINUTES,
      });

      setFinalizeContext(null);
      setSentimentoFinal(null);
      setAtividadeConcluida(null);
      setFollowUpDate(null);

      await carregarTarefas();
    },
    [carregarTarefas]
  );

  useEffect(() => {
    if (!timerState || timerState.paused || timerState.stage === "finished") {
      return;
    }

    const interval = setInterval(() => {
      setTimerState((current) => {
        if (!current || current.paused || current.stage === "finished") {
          return current;
        }

        const restante = current.remainingMs - 1000;
        if (restante > 0) {
          return { ...current, remainingMs: restante };
        }

        if (current.stage === "focus") {
          if (current.currentCycle >= current.cycleDurations.length - 1) {
            return { ...current, stage: "finished", remainingMs: 0 };
          }
          return {
            ...current,
            stage: "break",
            remainingMs: current.breakDuration * 60 * 1000,
          };
        }

        if (current.stage === "break") {
          const proximo = current.currentCycle + 1;
          return {
            ...current,
            stage: "focus",
            currentCycle: proximo,
            remainingMs: current.cycleDurations[proximo] * 60 * 1000,
          };
        }

        return current;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [timerState]);

  useEffect(() => {
    if (timerState && timerState.stage === "finished") {
      abrirFinalizacao(timerState, true);
      setTimerState(null);
    }
  }, [timerState, abrirFinalizacao]);

  const togglePause = useCallback(() => {
    setTimerState((current) => {
      if (!current || current.stage === "finished") {
        return current;
      }
      return { ...current, paused: !current.paused };
    });
  }, []);

  const handleFinalizeRequest = useCallback(() => {
    setTimerState((current) => {
      if (!current) {
        return current;
      }
      abrirFinalizacao(current, false);
      return { ...current, paused: true };
    });
  }, [abrirFinalizacao]);

  const handleFinalizeCancel = useCallback(() => {
    setFinalizeModalVisible(false);
    setMostrarFollowUpPicker(false);
    setSentimentoFinal(null);
    setAtividadeConcluida(null);
    setFollowUpDate(null);
    if (finalizeContext && !finalizeContext.autoCompleted) {
      setTimerState((current) => {
        if (!current || current.stage === "finished") {
          return current;
        }
        return { ...current, paused: false };
      });
    }
    setFinalizeContext(null);
  }, [finalizeContext]);

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

  const aoAlterarFollowUp = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS !== "ios") {
        setMostrarFollowUpPicker(false);
      }
      if (event.type === "dismissed") {
        return;
      }
      if (date) {
        setFollowUpDate(date.toISOString());
      }
    },
    []
  );

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

    const eventoAtualizado: Task = {
      ...finalizeContext.task,
      sentimentoInicio: finalizeContext.sentimentoInicio,
      sentimentoFim: sentimentoFinal,
      concluida: true,
    };

    await atualizarEvento(eventoAtualizado);

    if (!atividadeConcluida && followUpIso) {
      const novaAtividade: Task = {
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
      } as Task;
      await salvarEvento(novaAtividade);
    }

    setTimerState(null);
    setFinalizeModalVisible(false);
    setFinalizeContext(null);
    setMostrarFollowUpPicker(false);
    setSentimentoFinal(null);
    setAtividadeConcluida(null);
    setFollowUpDate(null);

    await carregarTarefas();

    try {
      await triggerEventSync({ force: true });
    } catch (error) {
      console.warn("[tasks] failed to trigger sync after finalize", error);
    }
  }, [
    atividadeConcluida,
    carregarTarefas,
    finalizeContext,
    followUpDate,
    sentimentoFinal,
  ]);
  const categorizedTasks = useMemo<Record<FilterKey, DisplayTask[]>>(() => {
    const msPorDia = 1000 * 60 * 60 * 24;
    const agora = new Date();
    const hojeBase = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate()
    );

    const sorted = [...tasks].sort((a, b) => {
      const dataA = parseDate(a.data);
      const dataB = parseDate(b.data);
      if (dataA && dataB) {
        return dataA.getTime() - dataB.getTime();
      }
      if (dataA && !dataB) {
        return -1;
      }
      if (!dataA && dataB) {
        return 1;
      }
      const diasA = calculateOpenDays(a);
      const diasB = calculateOpenDays(b);
      return diasB - diasA;
    });

    const buckets: Record<FilterKey, DisplayTask[]> = {
      atrasadas: [],
      hoje: [],
      proximas: [],
      semData: [],
    };

    const upcomingBuffer: Task[] = [];

    sorted.forEach((task) => {
      const parsedDate = parseDate(task.data);
      if (!parsedDate) {
        buckets.semData.push(task);
        return;
      }

      const dataBase = new Date(
        parsedDate.getFullYear(),
        parsedDate.getMonth(),
        parsedDate.getDate()
      );
      const diffDias = Math.floor(
        (dataBase.getTime() - hojeBase.getTime()) / msPorDia
      );

      if (diffDias < 0) {
        buckets.atrasadas.push(task);
      } else if (diffDias === 0) {
        buckets.hoje.push(task);
      } else {
        upcomingBuffer.push(task);
      }
    });

    buckets.proximas = groupUpcomingRecurringTasks(upcomingBuffer, hojeBase);

    return buckets;
  }, [tasks]);

  const displayedTasks = categorizedTasks[activeFilter];
  const hasTasks = displayedTasks.length > 0;
  const abrirNovaTarefa = () => {
    setSelectedTask(null);
    setModalVisible(true);
  };
  const abrirEdicao = (task: Task) => {
    setSelectedTask(task);
    setModalVisible(true);
  };
  const handleSave = async (task: Task) => {
    const merged: Task = {
      ...selectedTask,
      ...task,
      googleId: task.googleId ?? selectedTask?.googleId,
      outlookId: task.outlookId ?? selectedTask?.outlookId,
      provider: task.provider ?? selectedTask?.provider,
      accountId: task.accountId ?? selectedTask?.accountId ?? null,
      cor: task.cor ?? selectedTask?.cor ?? DEFAULT_CALENDAR_CATEGORY.color,
      status: task.status ?? selectedTask?.status ?? "ativo",
    };

    if (merged.id) {
      await atualizarEvento(merged);
    } else {
      await salvarEvento(merged);
    }
    await carregarTarefas();
    try {
      await triggerEventSync({ force: true });
    } catch (error) {
      console.warn("[tasks] failed to trigger sync after save", error);
    }
  };
  const handleDelete = async (id: number) => {
    const deletedInfo = await deletarEvento(id);
    await carregarTarefas();

    const provider = deletedInfo?.provider;
    const accountId = deletedInfo?.accountId ?? null;
    const externalId =
      provider === "google"
        ? deletedInfo?.googleId ?? null
        : provider === "outlook"
        ? deletedInfo?.outlookId ?? null
        : null;

    if (provider === "google" || provider === "outlook") {
      await deleteProviderEvent({
        provider: provider as "google" | "outlook",
        accountId,
        externalId,
      });
      if (accountId) {
        notifyAccountLocalChange(accountId);
      }
    }
    try {
      await triggerEventSync({ force: true });
    } catch (error) {
      console.warn("[tasks] failed to trigger sync after delete", error);
    }
  };
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.title}>Minhas Tarefas</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={abrirNovaTarefa}
            activeOpacity={0.85}
          >
            <Text style={styles.addButtonText}>+ Nova tarefa</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          Organize e visualize tudo o que precisa fazer
        </Text>
      </View>
      <View style={styles.filterBarContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScrollContent}
        >
          {FILTERS.map((filter, index) => {
            const isActive = filter.key === activeFilter;
            const isLast = index === FILTERS.length - 1;
            return (
              <TouchableOpacity
                key={filter.key}
                style={[
                  styles.filterChip,
                  isActive ? styles.filterChipActive : undefined,
                  !isLast ? styles.filterChipSpacing : undefined,
                ]}
                onPress={() => setActiveFilter(filter.key)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive ? styles.filterChipTextActive : undefined,
                  ]}
                >
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={
          hasTasks ? styles.listWrapper : styles.emptyWrapper
        }
        showsVerticalScrollIndicator={false}
      >
        {hasTasks ? (
          displayedTasks.map((task, taskIndex) => (
            <TaskCard
              key={task.id ? String(task.id) : `${activeFilter}-${taskIndex}`}
              task={task}
              onEdit={() => abrirEdicao(task)}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>
            Nenhuma tarefa cadastrada. Toque em "+ Nova tarefa" para criar a primeira.
          </Text>
        )}
      </ScrollView>
      {timerState && (
        <Modal visible transparent animationType="fade">
          <View style={styles.timerOverlay}>
            <View style={styles.timerModal}>
              <Text style={styles.timerTitulo} numberOfLines={2}>
                {timerState.task.titulo}
              </Text>
              <Text style={styles.timerEtapa}>
                {timerState.stage === "break" ? "Pausa curta" : "Foco na atividade"}
              </Text>
              <Text style={styles.timerContagem}>{formatCountdown(timerState.remainingMs)}</Text>
              <Text style={styles.timerCiclo}>
                Ciclo {timerState.currentCycle + 1} de {timerState.cycleDurations.length}
              </Text>
              {timerState.paused && timerState.stage !== "finished" && (
                <Text style={styles.timerStatus}>Temporizador pausado</Text>
              )}
              <View style={styles.timerBotoes}>
                <TouchableOpacity
                  style={styles.timerBotaoSecundario}
                  onPress={togglePause}
                  activeOpacity={0.8}
                >
                  <Text style={styles.timerBotaoSecundarioTexto}>
                    {timerState.paused ? "Retomar" : "Pausar"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.timerBotaoPrincipal}
                  onPress={handleFinalizeRequest}
                  activeOpacity={0.85}
                >
                  <Text style={styles.timerBotaoPrincipalTexto}>Finalizar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {finalizeModalVisible && finalizeContext && (
        <Modal visible transparent animationType="fade">
          <View style={styles.finalizeOverlay}>
            <View style={styles.finalizeModal}>
              <Text style={styles.finalizeTitulo}>Finalizar atividade</Text>
              <Text style={styles.finalizeDescricao}>Como você está se sentindo agora?</Text>
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

              <View style={styles.finalizeBotoes}>
                <TouchableOpacity
                  style={styles.finalizeBotaoSecundario}
                  onPress={handleFinalizeCancel}
                >
                  <Text style={styles.finalizeBotaoSecundarioTexto}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.finalizeBotaoPrincipal}
                  onPress={handleFinalizeConfirm}
                  activeOpacity={0.85}
                >
                  <Text style={styles.finalizeBotaoPrincipalTexto}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      <TaskModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
        onDelete={(id) => handleDelete(id)}
        initialData={selectedTask}
        onStart={handleStartTask}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e6f4f1",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 0,
  },
  header: {
    marginBottom: 16,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1f2d3d",
    flex: 1,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#4b5563",
  },
  addButton: {
    backgroundColor: "#2a9d8f",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    shadowColor: "#0b4a4f",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  filterBarContainer: {
    backgroundColor: "#ffffff",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 18,
    marginBottom: 12,
    shadowColor: "#0b4a4f",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    zIndex: 1,
  },
  filterScrollContent: {
    paddingHorizontal: 6,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#e2f1ee",
  },
  filterChipSpacing: {
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: "#2a9d8f",
  },
  filterChipText: {
    color: "#1f2d3d",
    fontSize: 13,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#ffffff",
  },
  list: {
    flex: 1,
  },
  listWrapper: {
    flexGrow: 1,
    paddingTop: 16,
    paddingBottom: 32,
  },
  emptyWrapper: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  emptyText: {
    textAlign: "center",
    color: "#6b7280",
    lineHeight: 20,
  },
  cardWrapper: {
    flexDirection: "row",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    shadowColor: "#0b4a4f",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 12,
  },
  cardAccent: {
    width: 6,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  cardContent: {
    flex: 1,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  recurringTag: {
    backgroundColor: "#264653",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  recurringTagText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  cardCategoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  cardCategoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  cardCategoryText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1f2d3d",
    flex: 1,
  },
  cardHeaderIcon: {
    color: "#1c6b73",
    marginLeft: 12,
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 10,
  },
  cardMetaRowSpacing: {
    marginTop: 8,
  },
  metaIcon: {
    marginRight: 6,
    color: "#4b5563",
  },
  cardMetaText: {
    fontSize: 14,
    color: "#4b5563",
    marginRight: 8,
  },
  cardMetaPrimaryText: {
    flexShrink: 1,
    marginRight: 8,
  },
  metaDivider: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#cbd5f5",
    marginHorizontal: 6,
  },
  cardSecondaryText: {
    fontSize: 14,
    color: "#4b5563",
    flexShrink: 1,
  },
  metaTag: {
    marginLeft: 12,
  },
  timerOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  timerModal: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  timerTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1d3557",
    textAlign: "center",
    marginBottom: 12,
  },
  timerEtapa: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2a9d8f",
    marginBottom: 6,
  },
  timerContagem: {
    fontSize: 52,
    fontWeight: "800",
    color: "#264653",
    marginBottom: 8,
  },
  timerCiclo: {
    fontSize: 14,
    color: "#555",
  },
  timerStatus: {
    marginTop: 6,
    fontSize: 12,
    color: "#e76f51",
  },
  timerBotoes: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
    width: "100%",
  },
  timerBotaoSecundario: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a9d8f",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  timerBotaoSecundarioTexto: {
    color: "#2a9d8f",
    fontWeight: "700",
    fontSize: 14,
  },
  timerBotaoPrincipal: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#e76f51",
    alignItems: "center",
  },
  timerBotaoPrincipalTexto: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  finalizeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  finalizeModal: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
  },
  finalizeTitulo: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1d3557",
    textAlign: "center",
    marginBottom: 16,
  },
  finalizeDescricao: {
    fontSize: 14,
    color: "#333",
    marginBottom: 8,
  },
  finalizeSentimentoOpcoes: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  finalizeSentimentoOpcao: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  finalizeSentimentoOpcaoAtiva: {
    backgroundColor: "#2a9d8f",
    borderColor: "#1d6e64",
  },
  finalizeSentimentoTexto: {
    fontSize: 16,
    fontWeight: "600",
    color: "#264653",
  },
  finalizeSentimentoTextoAtivo: {
    color: "#fff",
  },
  finalizePergunta: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  finalizeConclusaoOpcoes: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  finalizeConclusaoOpcao: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  finalizeConclusaoOpcaoAtiva: {
    backgroundColor: "#e9c46a",
    borderColor: "#b48a3a",
  },
  finalizeConclusaoTexto: {
    fontSize: 15,
    fontWeight: "600",
    color: "#264653",
  },
  finalizeConclusaoTextoAtivo: {
    color: "#fff",
  },
  finalizeRetomarBloco: {
    marginTop: 4,
    marginBottom: 16,
  },
  finalizeFollowUp: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#f8f9fa",
    position: "relative",
  },
  finalizeFollowUpTexto: {
    fontSize: 14,
    color: "#264653",
  },
  finalizeBotoes: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  finalizeBotaoSecundario: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#f1f1f1",
    alignItems: "center",
  },
  finalizeBotaoSecundarioTexto: {
    color: "#264653",
    fontWeight: "600",
  },
  finalizeBotaoPrincipal: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2a9d8f",
    alignItems: "center",
  },
  finalizeBotaoPrincipalTexto: {
    color: "#fff",
    fontWeight: "700",
  },
});






