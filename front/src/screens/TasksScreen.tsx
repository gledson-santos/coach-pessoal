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
import {
  Evento,
  atualizarEvento,
  deletarEvento,
  listarEventos,
  salvarEvento,
} from "../database";
type Task = Evento;
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
type TaskCardProps = {
  task: Task;
  onEdit: () => void;
};
const TaskCard = ({ task, onEdit }: TaskCardProps) => {
  const tempo = task.tempoExecucao ?? 15;
  const dataFormatada = formatDate(task.data);
  const diasEmAberto = calculateOpenDays(task);
  const descricao = dataFormatada
    ? `Execucao: ${dataFormatada}`
    : diasEmAberto <= 0
    ? "Criada hoje"
    : `Em aberto ha ${diasEmAberto} dia${diasEmAberto === 1 ? "" : "s"}`;
  const calendarColor = normalizeCalendarColor(task.cor ?? DEFAULT_CALENDAR_CATEGORY.color);
  const categoryLabel = getCalendarCategoryLabel(task.cor ?? null);
  const badgeBackground = `${calendarColor}26`;
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
          <View style={styles.cardHeaderRight}>
            <View style={[styles.cardCategoryBadge, { backgroundColor: badgeBackground }]}>
              <View style={[styles.cardCategoryDot, { backgroundColor: calendarColor }]} />
              <Text style={styles.cardCategoryText}>{categoryLabel}</Text>
            </View>
            <Ionicons name="create-outline" size={20} style={styles.cardHeaderIcon} />
          </View>
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
  const carregarTarefas = useCallback(async () => {
    const eventos = await listarEventos();
    setTasks(eventos as Task[]);
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
  const sortedTasks = useMemo(() => {
    const copy = [...tasks];
    return copy.sort((a, b) => {
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
  }, [tasks]);
  const sections = useMemo(() => {
    const msPorDia = 1000 * 60 * 60 * 24;
    const agora = new Date();
    const hojeBase = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate()
    );
    const bucket = {
      today: [] as Task[],
      tomorrow: [] as Task[],
      upcoming: [] as Task[],
    };
    sortedTasks.forEach((task) => {
      const parsedDate = parseDate(task.data);
      if (parsedDate) {
        const dataBase = new Date(
          parsedDate.getFullYear(),
          parsedDate.getMonth(),
          parsedDate.getDate()
        );
        const diffDias = Math.floor(
          (dataBase.getTime() - hojeBase.getTime()) / msPorDia
        );
        if (diffDias <= 0) {
          bucket.today.push(task);
        } else if (diffDias === 1) {
          bucket.tomorrow.push(task);
        } else {
          bucket.upcoming.push(task);
        }
      } else {
        bucket.upcoming.push(task);
      }
    });
    return [
      {
        key: "today",
        title: "Hoje",
        data: bucket.today,
      },
      {
        key: "tomorrow",
        title: "Amanha",
        data: bucket.tomorrow,
      },
      {
        key: "upcoming",
        title: "Proximas",
        data: bucket.upcoming,
      },
    ];
  }, [sortedTasks]);
  const sectionsWithData = useMemo(
    () => sections.filter((section) => section.data.length > 0),
    [sections]
  );
  const hasTasks = sectionsWithData.length > 0;
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
  };
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tarefas</Text>
        <TouchableOpacity style={styles.addButton} onPress={abrirNovaTarefa}>
          <Text style={styles.addButtonText}>+ Nova tarefa</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={
          hasTasks ? styles.listWrapper : styles.emptyWrapper
        }
        showsVerticalScrollIndicator={false}
      >
        {hasTasks ? (
          sectionsWithData.map((section, index) => (
            <View
              key={section.key}
              style={[
                styles.section,
                index === 0 ? styles.firstSection : undefined,
              ]}
            >
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.data.map((task, taskIndex) => (
                <TaskCard
                  key={
                    task.id ? String(task.id) : `${section.key}-${taskIndex}`
                  }
                  task={task}
                  onEdit={() => abrirEdicao(task)}
                />
              ))}
            </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1f2d3d",
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
  section: {
    marginTop: 24,
  },
  firstSection: {
    marginTop: 0,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#5c6b73",
    marginBottom: 12,
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
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: "#1f2d3d",
    marginRight: 12,
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






