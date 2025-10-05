import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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
    : `Em aberto ha ${diasEmAberto} dia${diasEmAberto === 1 ? "" : "s"}`;
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
          <View style={styles.cardHeaderRight}>
            {recurring && (
              <View style={styles.recurringTag}>
                <Text style={styles.recurringTagText}>Recorrente</Text>
              </View>
            )}
            <View style={[styles.cardCategoryBadge, { backgroundColor: badgeBackground }]}>
              <View style={[styles.cardCategoryDot, { backgroundColor: calendarColor }]} />
              <Text style={styles.cardCategoryText}>{categoryLabel}</Text>
            </View>
            <Ionicons name="create-outline" size={20} style={styles.cardHeaderIcon} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {task.titulo}
          </Text>
        </View>
        <View style={styles.cardMetaRow}>
          <Ionicons name="time-outline" size={16} style={styles.metaIcon} />
          <Text style={styles.cardMetaText}>{formatDuration(tempo)}</Text>
          <View style={styles.metaDivider} />
          <Ionicons name="speedometer-outline" size={16} style={styles.metaIcon} />
          <Text style={styles.cardMetaText}>Dificuldade: {task.dificuldade}</Text>
        </View>
        <View style={styles.cardMetaRow}>
          <Ionicons name="calendar-outline" size={16} style={styles.metaIcon} />
          <Text style={styles.cardSecondaryText}>{descricao}</Text>
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
  const carregarTarefas = useCallback(async () => {
    const eventos = await listarEventos();
    const visiveis = filterVisibleEvents(eventos);
    setTasks(visiveis as Task[]);
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
      <TaskModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
        onDelete={(id) => handleDelete(id)}
        initialData={selectedTask}
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
    paddingBottom: 24,
  },
  header: {
    marginBottom: 16,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
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
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
  },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-end",
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
    alignSelf: "stretch",
  },
  cardHeaderIcon: {
    color: "#1c6b73",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 10,
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
});






