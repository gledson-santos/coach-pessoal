import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  Alert,
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
  const [mostrarModalInicio, setMostrarModalInicio] = useState(false);
  const [textoConfirmacao, setTextoConfirmacao] = useState("");
  const [dadosOriginais, setDadosOriginais] = useState({
    titulo: "",
    observacao: "",
    data: "",
    tipo: "",
    dificuldade: "",
    tempoExecucao: 15,
  });
  const dataInputRef = useRef<any>(null);

  useEffect(() => {
    if (initialData) {
      setTitulo(initialData.titulo || "");
      setObservacao(initialData.observacao || "");
      setData(initialData.data || "");
      setTipo(initialData.tipo || "");
      setDificuldade(initialData.dificuldade || "");
      setTempoExecucao(initialData.tempoExecucao ?? 15);
      setDadosOriginais({
        titulo: initialData.titulo || "",
        observacao: initialData.observacao || "",
        data: initialData.data || "",
        tipo: initialData.tipo || "",
        dificuldade: initialData.dificuldade || "",
        tempoExecucao: initialData.tempoExecucao ?? 15,
      });
    } else {
      setTitulo("");
      setObservacao("");
      setData("");
      setTipo("");
      setDificuldade("");
      setTempoExecucao(15);
      setDadosOriginais({
        titulo: "",
        observacao: "",
        data: "",
        tipo: "",
        dificuldade: "",
        tempoExecucao: 15,
      });
    }
    setMostrarDatePicker(false);
    setMostrarDuracoes(false);
    setMostrarModalInicio(false);
    setTextoConfirmacao("");
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

  const camposAtuais = useMemo(
    () => ({
      titulo,
      observacao,
      data,
      tipo,
      dificuldade,
      tempoExecucao,
    }),
    [titulo, observacao, data, tipo, dificuldade, tempoExecucao]
  );

  const houveAlteracao = useMemo(
    () =>
      Object.entries(camposAtuais).some(([chave, valor]) => {
        const chaveTipada = chave as keyof typeof dadosOriginais;
        return valor !== dadosOriginais[chaveTipada];
      }),
    [camposAtuais, dadosOriginais]
  );

  const camposObrigatoriosPreenchidos = useMemo(
    () =>
      Boolean(
        titulo.trim() &&
          tipo.trim() &&
          dificuldade.trim() &&
          tempoExecucao
      ),
    [titulo, tipo, dificuldade, tempoExecucao]
  );

  const podeSalvar = camposObrigatoriosPreenchidos && houveAlteracao;

  const salvar = async () => {
    if (!camposObrigatoriosPreenchidos) {
      alert("Preencha os campos obrigatorios");
      return;
    }

    if (!houveAlteracao) {
      alert("Nenhuma alteração foi realizada.");
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
      const executarExclusao = async () => {
        await Promise.resolve(onDelete(initialData.id!));
        onClose();
      };

      if (Platform.OS === "web") {
        if (typeof window !== "undefined") {
          const confirmado = window.confirm("Deseja realmente excluir esta tarefa?");
          if (confirmado) {
            await executarExclusao();
          }
        }
        return;
      }

      Alert.alert(
        "Confirmar exclusão",
        "Deseja realmente excluir esta tarefa?",
        [
          {
            text: "Cancelar",
            style: "cancel",
          },
          {
            text: "Excluir",
            style: "destructive",
            onPress: () => {
              void executarExclusao();
            },
          },
        ]
      );
    }
  };

  const selecionarDuracao = (valor: number) => {
    setTempoExecucao(valor);
    setMostrarDuracoes(false);
  };

  const horaInicio = useMemo(() => {
    if (!data) {
      return "HORA INICIO";
    }
    const convertida = new Date(data);
    if (Number.isNaN(convertida.getTime())) {
      return "HORA INICIO";
    }
    return convertida.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [data]);

  const fraseConfirmacao = useMemo(() => {
    const nomeTarefa = titulo || initialData?.titulo || "TAREFA";
    const duracao = formatarDuracao(tempoExecucao);

    return `Começo ${nomeTarefa} às ${horaInicio}, por ${duracao}, sem distrações. Se eu travar, realizo algumas ações essenciais para essa atividade`;
  }, [horaInicio, tempoExecucao, titulo, initialData?.titulo]);

  const normalizar = (valor: string) =>
    valor
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const textoConfirmacaoValido = useMemo(() => {
    const texto = normalizar(textoConfirmacao.trim());
    return texto.includes("comeco") && texto.includes("distracoes");
  }, [textoConfirmacao]);

  const iniciar = () => {
    setTextoConfirmacao("");
    setMostrarModalInicio(true);
  };

  const confirmarInicio = () => {
    if (!textoConfirmacaoValido) {
      alert(
        "Confirme o compromisso incluindo as palavras 'começo' e 'distrações'."
      );
      return;
    }
    setMostrarModalInicio(false);
    setTextoConfirmacao("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            {initialData ? (
              <TouchableOpacity
                onPress={onClose}
                style={styles.backButton}
                accessibilityLabel="Voltar"
              >
                <Text style={styles.backButtonText}>←</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.titulo}>Nova Tarefa</Text>
            )}
          </View>

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
            {initialData && onDelete && (
              <TouchableOpacity style={styles.excluir} onPress={excluir}>
                <Text style={styles.textoBotaoBranco}>Excluir</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.salvar, !podeSalvar && styles.salvarDesabilitado]}
              onPress={salvar}
              disabled={!podeSalvar}
            >
              <Text style={styles.textoBotaoBranco}>Salvar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iniciar} onPress={iniciar}>
              <Text style={styles.iniciarTexto}>Iniciar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal visible={mostrarModalInicio} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={styles.modalInicio}>
            <Text style={styles.tituloModalInicio}>Vamos Começar!</Text>
            <Text style={styles.textoModalInicio}>
              Me confirme escrevendo o compromisso no formato:
            </Text>
            <Text style={styles.textoExemplo}>
              "{fraseConfirmacao}"
            </Text>
            <TextInput
              placeholder="Digite o compromisso para iniciar"
              style={[styles.input, styles.textArea, styles.inputConfirmacao]}
              multiline
              value={textoConfirmacao}
              onChangeText={setTextoConfirmacao}
            />
            <View style={styles.btnRowInicio}>
              <TouchableOpacity
                style={styles.cancelarInicio}
                onPress={() => {
                  setMostrarModalInicio(false);
                  setTextoConfirmacao("");
                }}
              >
                <Text style={styles.cancelarInicioTexto}>Voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={
                  textoConfirmacaoValido
                    ? styles.confirmarInicio
                    : [styles.confirmarInicio, styles.confirmarInicioDesabilitado]
                }
                disabled={!textoConfirmacaoValido}
                onPress={confirmarInicio}
              >
                <Text style={styles.confirmarInicioTexto}>Começar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  backButton: {
    marginRight: 10,
    padding: 8,
  },
  backButtonText: {
    fontSize: 42,
    lineHeight: 42,
    fontWeight: "600",
  },
  titulo: { flex: 1, fontSize: 18, fontWeight: "bold" },
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
    justifyContent: "flex-end",
    marginTop: 15,
    gap: 10,
  },
  excluir: {
    backgroundColor: "#e63946",
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
  salvar: {
    backgroundColor: "#2a9d8f",
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
  salvarDesabilitado: {
    backgroundColor: "#a7dcd3",
  },
  iniciar: {
    backgroundColor: "#1e88e5",
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
  iniciarTexto: {
    color: "#fff",
    fontWeight: "600",
  },
  textoBotaoBranco: {
    color: "#fff",
    fontWeight: "600",
  },
  modalInicio: {
    width: "90%",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 20,
  },
  tituloModalInicio: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },
  textoModalInicio: {
    fontSize: 14,
    marginBottom: 10,
    color: "#333",
  },
  textoExemplo: {
    fontSize: 14,
    fontStyle: "italic",
    marginBottom: 12,
    color: "#2a9d8f",
  },
  inputConfirmacao: {
    minHeight: 120,
  },
  btnRowInicio: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 10,
  },
  cancelarInicio: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: "#f1f1f1",
  },
  cancelarInicioTexto: {
    color: "#333",
  },
  confirmarInicio: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: "#2a9d8f",
  },
  confirmarInicioDesabilitado: {
    backgroundColor: "#a7dcd3",
  },
  confirmarInicioTexto: {
    color: "#fff",
    fontWeight: "bold",
  },
});
