import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

type Task = {
  id?: number;
  titulo: string;
  observacao?: string;
  data?: string;
  tipo: string;
  dificuldade: string;
  tempoExecucao?: number;
};

interface TaskModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (task: Task) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
  initialData?: Task | null;
}

const formatarDuracao = (minutos: number) => {
  if (minutos < 60) {
    return `${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  const restante = minutos % 60;
  if (restante === 0) {
    return `${horas}h`;
  }
  return `${horas}h${restante.toString().padStart(2, "0")}`;
};

const DURACOES = Array.from({ length: (8 * 60) / 15 }, (_, index) => {
  const value = (index + 1) * 15;
  return {
    label: formatarDuracao(value),
    value,
  };
});

const formatarData = (valor: string) => {
  if (!valor) return "";
  const dataConvertida = new Date(valor);
  if (Number.isNaN(dataConvertida.getTime())) {
    return valor;
  }
  return dataConvertida.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatarDataParaInput = (valor: string) => {
  if (!valor) return "";
  const dataConvertida = new Date(valor);
  if (Number.isNaN(dataConvertida.getTime())) {
    return "";
  }
  const semOffset = new Date(
    dataConvertida.getTime() - dataConvertida.getTimezoneOffset() * 60000
  );
  return semOffset.toISOString().slice(0, 16);
};

export default function TaskModal({
  visible,
  onClose,
  onSave,
  onDelete,
  initialData,
}: TaskModalProps) {
  const [titulo, setTitulo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState("");
  const [dificuldade, setDificuldade] = useState("");
  const [tempoExecucao, setTempoExecucao] = useState<number>(15);
  const [mostrarDatePicker, setMostrarDatePicker] = useState(false);
  const [mostrarDuracoes, setMostrarDuracoes] = useState(false);
  const dataInputRef = useRef<any>(null);

  useEffect(() => {
    if (initialData) {
      setTitulo(initialData.titulo || "");
      setObservacao(initialData.observacao || "");
      setData(initialData.data || "");
      setTipo(initialData.tipo || "");
      setDificuldade(initialData.dificuldade || "");
      setTempoExecucao(initialData.tempoExecucao ?? 15);
    } else {
      setTitulo("");
      setObservacao("");
      setData("");
      setTipo("");
      setDificuldade("");
      setTempoExecucao(15);
    }
    setMostrarDatePicker(false);
    setMostrarDuracoes(false);
  }, [initialData, visible]);

  const dataSelecionada = data
    ? formatarData(data)
    : "Selecione um horario na agenda";

  const valorDataWeb = formatarDataParaInput(data);
  const duracaoSelecionada = formatarDuracao(tempoExecucao);

  const abrirSeletorData = () => {
    if (Platform.OS === "web") {
      const elemento = dataInputRef.current;
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
    setMostrarDatePicker(true);
  };

  const aoAlterarData = (
    event: DateTimePickerEvent,
    selectedDate?: Date
  ) => {
    if (Platform.OS !== "ios") {
      setMostrarDatePicker(false);
    }
    if (event.type === "dismissed") {
      return;
    }
    if (selectedDate) {
      setData(selectedDate.toISOString());
    }
  };

  const aoAlterarDataWeb = (valor: string) => {
    if (!valor) {
      setData("");
      return;
    }
    const selecionada = new Date(valor);
    if (Number.isNaN(selecionada.getTime())) {
      setData("");
      return;
    }
    setData(selecionada.toISOString());
  };

  const obterDataPadrao = () => {
    if (!data) return new Date();
    const convertida = new Date(data);
    if (Number.isNaN(convertida.getTime())) {
      return new Date();
    }
    return convertida;
  };

  const salvar = async () => {
    if (!titulo || !tipo || !dificuldade || !tempoExecucao) {
      alert("Preencha os campos obrigatorios");
      return;
    }
    await Promise.resolve(
      onSave({
        id: initialData?.id,
        titulo,
        observacao,
        data,
        tipo,
        dificuldade,
        tempoExecucao,
      })
    );
    onClose();
  };

  const excluir = async () => {
    if (initialData?.id && onDelete) {
      await Promise.resolve(onDelete(initialData.id));
      onClose();
    }
  };

  const selecionarDuracao = (valor: number) => {
    setTempoExecucao(valor);
    setMostrarDuracoes(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.titulo}>
            {initialData ? "Editar Tarefa" : "Nova Tarefa"}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Titulo</Text>
            <TextInput
              placeholder="Titulo (obrigatorio)"
              style={styles.input}
              value={titulo}
              onChangeText={setTitulo}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Data de Execução</Text>
            <TouchableOpacity
              style={styles.dataDisplay}
              onPress={abrirSeletorData}
              activeOpacity={0.7}
            >
              <Text style={styles.dataValue}>{dataSelecionada}</Text>
              {Platform.OS === "web" && (
                <input
                  ref={dataInputRef}
                  type="datetime-local"
                  value={valorDataWeb}
                  onChange={(e) => aoAlterarDataWeb(e.target.value)}
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

            {Platform.OS !== "web" && mostrarDatePicker && (
              <View
                style={
                  Platform.OS === "ios" ? styles.iosPickerContainer : undefined
                }
              >
                <DateTimePicker
                  value={obterDataPadrao()}
                  mode="datetime"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={aoAlterarData}
                />
                {Platform.OS === "ios" && (
                  <View style={styles.iosPickerActions}>
                    <TouchableOpacity
                      onPress={() => setMostrarDatePicker(false)}
                    >
                      <Text style={styles.iosPickerDone}>Concluir</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Tempo de Execução</Text>
            {Platform.OS === "web" ? (
              <select
                value={tempoExecucao}
                onChange={(e) => selecionarDuracao(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  backgroundColor: "#fff",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {DURACOES.map((opcao) => (
                  <option key={opcao.value} value={opcao.value}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            ) : (
              <View style={styles.selectWrapper}>
                <TouchableOpacity
                  style={styles.selectInput}
                  activeOpacity={0.7}
                  onPress={() => setMostrarDuracoes((valor) => !valor)}
                >
                  <Text>{duracaoSelecionada}</Text>
                </TouchableOpacity>

                {mostrarDuracoes && (
                  <View style={styles.dropdown}>
                    <ScrollView style={styles.dropdownScroll}>
                      {DURACOES.map((opcao) => {
                        const ativo = tempoExecucao === opcao.value;
                        return (
                          <TouchableOpacity
                            key={opcao.value}
                            style={[
                              styles.dropdownOption,
                              ativo && styles.dropdownOptionSelected,
                            ]}
                            onPress={() => selecionarDuracao(opcao.value)}
                          >
                            <Text
                              style={
                                ativo ? styles.dropdownOptionTextSelected : undefined
                              }
                            >
                              {opcao.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Tipo</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.option, tipo === "Pessoal" && styles.selected]}
                onPress={() => setTipo("Pessoal")}
              >
                <Text>Pessoal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.option, tipo === "Trabalho" && styles.selected]}
                onPress={() => setTipo("Trabalho")}
              >
                <Text>Trabalho</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Dificuldade</Text>
            <View style={styles.row}>
              {["Baixa", "Media", "Alta"].map((nivel) => (
                <TouchableOpacity
                  key={nivel}
                  style={[
                    styles.option,
                    dificuldade === nivel && styles.selected,
                  ]}
                  onPress={() => setDificuldade(nivel)}
                >
                  <Text>{nivel}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Observação</Text>
            <TextInput
              placeholder="Observação"
              style={[styles.input, styles.textArea]}
              value={observacao}
              onChangeText={setObservacao}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelar} onPress={onClose}>
              <Text style={{ color: "#333" }}>Cancelar</Text>
            </TouchableOpacity>

            {initialData && onDelete && (
              <TouchableOpacity style={styles.excluir} onPress={excluir}>
                <Text style={{ color: "#fff" }}>Excluir</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.salvar} onPress={salvar}>
              <Text style={{ color: "#fff" }}>
                {initialData ? "Atualizar" : "Salvar"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "90%",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 20,
  },
  titulo: { fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 10,
    borderRadius: 6,
  },
  textArea: {
    minHeight: 96,
  },
  dataDisplay: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#f9f9f9",
    position: "relative",
  },
  dataValue: {
    fontSize: 14,
    color: "#333",
  },
  iosPickerContainer: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    marginTop: 10,
    backgroundColor: "#fff",
  },
  iosPickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 8,
  },
  iosPickerDone: {
    color: "#2a9d8f",
    fontWeight: "bold",
  },
  selectWrapper: {
    position: "relative",
  },
  selectInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#fff",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    marginTop: 6,
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  dropdownScroll: {
    maxHeight: 200,
  },
  dropdownOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dropdownOptionSelected: {
    backgroundColor: "#e9c46a",
  },
  dropdownOptionTextSelected: {
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: 10,
  },
  option: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    backgroundColor: "#fff",
  },
  selected: {
    backgroundColor: "#e9c46a",
    borderColor: "#b2893f",
  },
  btnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
  },
  cancelar: {
    backgroundColor: "#f1f1f1",
    padding: 10,
    borderRadius: 6,
    flex: 1,
    marginRight: 10,
    alignItems: "center",
  },
  excluir: {
    backgroundColor: "#e63946",
    padding: 10,
    borderRadius: 6,
    flex: 1,
    marginRight: 10,
    alignItems: "center",
  },
  salvar: {
    backgroundColor: "#2a9d8f",
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
});
