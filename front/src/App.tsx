import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AgendaScreen from "./screens/AgendaScreen";
import TasksScreen from "./screens/TasksScreen";
import ConfigScreen from "./screens/ConfigScreen";
import LoginScreen from "./screens/LoginScreen";
import { initializeCalendarAccounts } from "./services/calendarAccountsStore";
import { initializeCalendarSyncEngine } from "./services/calendarSyncManager";
import { initializeEventSync } from "./services/eventSync";
import { PomodoroProvider } from "./pomodoro/PomodoroProvider";

type Tela = "chat" | "agenda" | "tarefas" | "config";

type IoniconName = keyof typeof Ionicons.glyphMap;

const menuOptions: {
  key: Tela;
  label: string;
  icon: IoniconName;
  activeIcon: IoniconName;
}[] = [
  {
    key: "chat",
    label: "Chat Coach",
    icon: "chatbubble-ellipses-outline",
    activeIcon: "chatbubble-ellipses",
  },
  {
    key: "agenda",
    label: "Agenda",
    icon: "calendar-outline",
    activeIcon: "calendar",
  },
  {
    key: "tarefas",
    label: "Tarefas",
    icon: "checkbox-outline",
    activeIcon: "checkbox",
  },
  {
    key: "config",
    label: "Configuracoes",
    icon: "settings-outline",
    activeIcon: "settings",
  },
];

export default function App() {
  const [tela, setTela] = useState<Tela>("chat");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    initializeEventSync();
    (async () => {
      try {
        const storedAccounts = await initializeCalendarAccounts();
        initializeCalendarSyncEngine(storedAccounts);
      } catch (error) {
        console.error("[app] falha ao inicializar sincronizacao de calendarios", error);
      }
    })();
  }, []);

  const renderConteudo = () => {
    switch (tela) {
      case "agenda":
        return <AgendaScreen />;
      case "tarefas":
        return <TasksScreen />;
      case "config":
        return <ConfigScreen />;
      default:
        return (
          <View style={styles.conteudo}>
            <Text style={styles.texto}>
              Ola! Sou seu coach de produtividade. Como posso ajudar voce a
              organizar melhor o seu dia?
            </Text>
          </View>
        );
    }
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <PomodoroProvider>
      <View style={[styles.container, tela === "tarefas" && styles.containerTarefas]}>
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Coach Pessoal</Text>
          <Text style={styles.headerSub}>Seu assistente de produtividade</Text>
        </View>

        <View style={[styles.conteudo, tela === "tarefas" && styles.conteudoTarefas]}>
          {renderConteudo()}
        </View>

        <View style={styles.menu}>
          {menuOptions.map(({ key, label, icon, activeIcon }) => {
            const isActive = tela === key;
            const color = isActive ? "#264653" : "#7a7a7a";
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setTela(key)}
                style={styles.menuItem}
              >
                <Ionicons
                  name={isActive ? activeIcon : icon}
                  size={24}
                  color={color}
                />
                <Text
                  style={[
                    styles.menuTexto,
                    isActive ? styles.menuTextoAtivo : undefined,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </PomodoroProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  containerTarefas: { backgroundColor: "#e6f4f1" },
  header: {
    padding: 15,
    backgroundColor: "#264653",
    alignItems: "center",
  },
  headerTitulo: { fontSize: 20, fontWeight: "bold", color: "#fff" },
  headerSub: { fontSize: 14, color: "#ddd" },
  conteudo: { flex: 1, padding: 20, justifyContent: "center" },
  conteudoTarefas: { paddingHorizontal: 0, paddingVertical: 0, justifyContent: "flex-start" },
  texto: { fontSize: 16, textAlign: "center" },
  menu: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#fff",
  },
  menuItem: { alignItems: "center" },
  menuTexto: { fontSize: 12, marginTop: 2, color: "#7a7a7a" },
  menuTextoAtivo: { color: "#264653", fontWeight: "600" },
});



