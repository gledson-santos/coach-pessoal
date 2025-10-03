import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Evento, salvarEvento, listarEventos, atualizarEvento } from "../database";
import TaskModal from "../components/TaskModal";
import { subscribeCalendarAccounts } from "../services/calendarAccountsStore";
import { DEFAULT_CALENDAR_CATEGORY, normalizeCalendarColor } from "../constants/calendarCategories";
import { triggerEventSync } from "../services/eventSync";
import { filterVisibleEvents } from "../utils/eventFilters";

type EventoAgenda = Evento;

type OverlapInterval = {
  start: number;
  end: number;
};

type EventoNormalizado = EventoAgenda & {
  startMin: number;
  endMin: number;
  conflict: boolean;
  overlaps: OverlapInterval[];
  uniqueKey: string;
  columnIndex: number;
  maxColumns: number;
};

const horas = Array.from({ length: 24 }, (_, i) => i);
const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const MINUTE_HEIGHT = 1.5;
const DIA_ALTURA = MINUTE_HEIGHT * 60 * 24;
const WEEK_DAY_WIDTH = 120;
const WEEK_DAY_MARGIN_HORIZONTAL = 8;
const DURACAO_MINIMA = 15;
const CONFLICT_HEADER_GAP = 32;
const CONFLICT_EXTRA_OFFSET = 6;
const CARD_SPACING = 4;

const mesclarIntervalos = (intervalos: OverlapInterval[]) => {
  if (intervalos.length === 0) return [] as OverlapInterval[];
  const ordenados = [...intervalos].sort((a, b) => a.start - b.start);
  const resultado: OverlapInterval[] = [ordenados[0]];

  for (let i = 1; i < ordenados.length; i += 1) {
    const atual = ordenados[i];
    const ultimo = resultado[resultado.length - 1];
    if (atual.start <= ultimo.end) {
      ultimo.end = Math.max(ultimo.end, atual.end);
    } else {
      resultado.push({ ...atual });
    }
  }

  return resultado;
};

export default function AgendaScreen() {
  const [dataAtual, setDataAtual] = useState(new Date());
  const [eventos, setEventos] = useState<EventoAgenda[]>([]);

  const carregarEventos = useCallback(async () => {
    const lista = await listarEventos();
    const visiveis = filterVisibleEvents(lista);
    setEventos(visiveis as EventoAgenda[]);
  }, []);
  const [modoSemana, setModoSemana] = useState(false);
  const [larguraTimeline, setLarguraTimeline] = useState(0);

  const [modalVisible, setModalVisible] = useState(false);
  const [tarefaSelecionada, setTarefaSelecionada] = useState<any>(null);


  const weekHorizontalRef = useRef<ScrollView | null>(null);
  const previousModoSemana = useRef(false);
  const lastSyncMapRef = useRef<Map<string, string | null>>(new Map());
  useEffect(() => {
    carregarEventos();
  }, [carregarEventos]);
  useEffect(() => {
    const lastSyncMap = lastSyncMapRef.current;
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
        carregarEventos();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [carregarEventos]);

  const eventosPorDia = useMemo(() => {
    const mapa = new Map<string, EventoNormalizado[]>();

    eventos.forEach((ev, index) => {
      const inicioDate = new Date(ev.inicio ?? "");
      if (Number.isNaN(inicioDate.getTime())) {
        return;
      }
      const fimDate = new Date(ev.fim ?? "");
      const chaveDia = inicioDate.toDateString();
      const startMin = inicioDate.getHours() * 60 + inicioDate.getMinutes();
      let endMin = fimDate.getHours() * 60 + fimDate.getMinutes();

      if (Number.isNaN(endMin) || endMin <= startMin) {
        endMin = startMin + (ev.tempoExecucao ?? DURACAO_MINIMA);
      }

      const normalizado: EventoNormalizado = {
        ...ev,
        startMin,
        endMin,
        conflict: false,
        overlaps: [],
        uniqueKey: `${ev.id ?? `idx-${index}`}`,
        columnIndex: 0,
        maxColumns: 1,
      };

      const lista = mapa.get(chaveDia);
      if (lista) {
        lista.push(normalizado);
      } else {
        mapa.set(chaveDia, [normalizado]);
      }
    });

    mapa.forEach((lista) => {
      lista.sort((a, b) => a.startMin - b.startMin);

      lista.forEach((item) => {
        item.overlaps = [];
        item.conflict = false;
        item.columnIndex = 0;
        item.maxColumns = 1;
      });

      for (let i = 0; i < lista.length; i += 1) {
        for (let j = i + 1; j < lista.length; j += 1) {
          const a = lista[i];
          const b = lista[j];
          if (a.endMin > b.startMin && b.endMin > a.startMin) {
            const inicioSobreposicao = Math.max(a.startMin, b.startMin);
            const fimSobreposicao = Math.min(a.endMin, b.endMin);
            if (inicioSobreposicao < fimSobreposicao) {
              a.conflict = true;
              b.conflict = true;
              a.overlaps.push({ start: inicioSobreposicao, end: fimSobreposicao });
              b.overlaps.push({ start: inicioSobreposicao, end: fimSobreposicao });
            }
          }
        }
      }

      lista.forEach((item) => {
        item.overlaps = mesclarIntervalos(item.overlaps);
      });

      const activeEvents: EventoNormalizado[] = [];
      const columnSlots: (EventoNormalizado | null)[] = [];

      lista.forEach((ev) => {
        for (let i = activeEvents.length - 1; i >= 0; i -= 1) {
          const ativo = activeEvents[i];
          if (ativo.endMin <= ev.startMin) {
            columnSlots[ativo.columnIndex] = null;
            activeEvents.splice(i, 1);
          }
        }

        let colunaLivre = columnSlots.findIndex((slot) => slot === null);
        if (colunaLivre === -1) {
          colunaLivre = columnSlots.length;
          columnSlots.push(null);
        }

        ev.columnIndex = colunaLivre;
        columnSlots[colunaLivre] = ev;
        activeEvents.push(ev);

        const simultaneos = activeEvents.length;
        activeEvents.forEach((ativo) => {
          ativo.maxColumns = Math.max(ativo.maxColumns, simultaneos);
          if (simultaneos > 1) {
            ativo.conflict = true;
          }
        });
      });
    });

    return mapa;
  }, [eventos]);

  const mudarDia = (dias: number) => {
    const novaData = new Date(dataAtual);
    novaData.setDate(novaData.getDate() + dias);
    setDataAtual(novaData);
  };

  const voltarHoje = () => {
    setDataAtual(new Date());
    setModoSemana(false);
  };

  const alternarSemana = () => {
    if (!modoSemana) {
      setDataAtual(new Date());
    }
    setModoSemana((prev) => !prev);
  };

  useEffect(() => {
    if (modoSemana && !previousModoSemana.current) {
      const semanaVisivel = getSemana(dataAtual);
      const hoje = new Date();
      const indiceHoje = semanaVisivel.findIndex(
        (dia) =>
          dia.getFullYear() === hoje.getFullYear() &&
          dia.getMonth() === hoje.getMonth() &&
          dia.getDate() === hoje.getDate()
      );

      if (indiceHoje >= 0) {
        const columnWidth = WEEK_DAY_WIDTH + WEEK_DAY_MARGIN_HORIZONTAL * 2;
        requestAnimationFrame(() => {
          weekHorizontalRef.current?.scrollTo({
            x: Math.max(0, indiceHoje * columnWidth),
            y: 0,
            animated: false,
          });
        });
      }
    }

    previousModoSemana.current = modoSemana;
  }, [modoSemana, dataAtual]);

  const ehHoje = (d: Date) => {
    const hoje = new Date();
    return (
      d.getFullYear() === hoje.getFullYear() &&
      d.getMonth() === hoje.getMonth() &&
      d.getDate() === hoje.getDate()
    );
  };

  const horaAtual = new Date().getHours() + new Date().getMinutes() / 60;
  const minutosAtual = new Date().getHours() * 60 + new Date().getMinutes();

  const eventosDiaAtual = eventosPorDia.get(dataAtual.toDateString()) ?? [];

  const getSemana = (ref: Date) => {
    const inicio = new Date(ref);
    inicio.setDate(ref.getDate() - ref.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      return d;
    });
  };

  const abrirModalNova = () => {
    setTarefaSelecionada(null);
    setModalVisible(true);
  };

  const abrirModalEditar = (tarefa: any) => {
    if (tarefa) {
      const { startMin, endMin, conflict, overlaps, uniqueKey, columnIndex, maxColumns, ...limpo } = tarefa;
      setTarefaSelecionada(limpo);
    } else {
      setTarefaSelecionada(null);
    }
    setModalVisible(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.leftBtns}>
          <TouchableOpacity style={styles.todayBtn} onPress={voltarHoje}>
            <Text style={styles.todayBtnText}>Hoje</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.weekBtn} onPress={alternarSemana}>
            <Text style={styles.weekBtnText}>
              {modoSemana ? "Dia" : "Semana"}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.addBtn} onPress={abrirModalNova}>
          <Text style={styles.addBtnText}>+ Adicionar Tarefa</Text>
        </TouchableOpacity>
      </View>

      {!modoSemana && (
        <View style={styles.header}>
          <TouchableOpacity onPress={() => mudarDia(-1)}>
            <Text style={styles.nav}>{"<"}</Text>
          </TouchableOpacity>

          <Text style={styles.dataTitulo}>
            {dataAtual.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "short",
            })}
          </Text>

          <TouchableOpacity onPress={() => mudarDia(1)}>
            <Text style={styles.nav}>{">"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!modoSemana && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.timelineWrapper}>
            <View style={styles.timelineLabels}>
              {horas.map((h) => (
                <View key={h} style={styles.hourSlot}>
                  <Text style={styles.hourLabel}>
                    {`${h.toString().padStart(2, "0")}:00`}
                  </Text>
                </View>
              ))}
            </View>

            <View
              style={styles.timelineArea}
              onLayout={(event) => {
                setLarguraTimeline(event.nativeEvent.layout.width);
              }}
            >
              {horas.map((h) => (
                <View
                  key={h}
                  style={[
                    styles.hourLine,
                    { top: h * 60 * MINUTE_HEIGHT },
                  ]}
                />
              ))}

              {eventosDiaAtual.map((ev) => {
                const corBase = ev.conflict
                  ? "#e63946"
                  : normalizeCalendarColor(ev.cor ?? DEFAULT_CALENDAR_CATEGORY.color);
                const altura = Math.max(
                  (ev.endMin - ev.startMin) * MINUTE_HEIGHT,
                  DURACAO_MINIMA * MINUTE_HEIGHT
                );
                const isEventoCurto = altura <= DURACAO_MINIMA * MINUTE_HEIGHT + 2;
                const isShortDuration = (ev.tempoExecucao ?? DURACAO_MINIMA) <= DURACAO_MINIMA;
                const titleNumberOfLines = isShortDuration || isEventoCurto ? 2 : undefined;

                const estiloDinamico: any = {
                  top: ev.startMin * MINUTE_HEIGHT,
                  height: altura,
                  backgroundColor: corBase,
                };

                if (larguraTimeline > 0) {
                  const larguraColuna =
                    larguraTimeline / ev.maxColumns - CARD_SPACING;
                  estiloDinamico.width = Math.max(larguraColuna, 0);
                  estiloDinamico.left =
                    ev.columnIndex * (larguraColuna + CARD_SPACING) + CARD_SPACING / 2;
                }

                if (isEventoCurto) {
                  estiloDinamico.paddingVertical = 4;
                  estiloDinamico.justifyContent = "center";
                  estiloDinamico.alignItems = "flex-start";
                }

                return (
                  <TouchableOpacity
                    key={ev.uniqueKey}
                    style={[styles.eventBlock, ev.conflict && styles.eventBlockConflict, estiloDinamico]}
                    onPress={() => abrirModalEditar(ev)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.eventoTexto,
                        isEventoCurto && styles.eventoTextoCurto,
                        isShortDuration && styles.eventoTextoShortDuration,
                      ]}
                      numberOfLines={titleNumberOfLines}
                    >
                      {ev.titulo}
                    </Text>
                    {!isShortDuration && (
                      <Text style={[styles.eventoHora, isEventoCurto && styles.eventoHoraCurta]}>
                        {new Date(ev.inicio ?? "").toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" "}-{" "}
                        {new Date(ev.fim ?? "").toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    )}

                    {ev.overlaps.map((intervalo, idx) => {
                      const sobreposicaoInicio = intervalo.start - ev.startMin;
                      const sobreposicaoAltura = intervalo.end - intervalo.start;
                      let heightOverlay = Math.max(
                        sobreposicaoAltura * MINUTE_HEIGHT,
                        2
                      );
                      let topOverlay = Math.max(
                        sobreposicaoInicio * MINUTE_HEIGHT,
                        0
                      );

                      const limiteMinimo = CONFLICT_HEADER_GAP + CONFLICT_EXTRA_OFFSET;
                      if (topOverlay < limiteMinimo) {
                        const diferenca = limiteMinimo - topOverlay;
                        topOverlay = limiteMinimo;
                        heightOverlay -= diferenca;
                      }

                      if (heightOverlay <= 0) {
                        return null;
                      }

                      return (
                        <View
                          key={`${ev.uniqueKey}-conflict-${idx}`}
                          pointerEvents="none"
                          style={[
                            styles.conflictOverlay,
                            {
                              top: topOverlay,
                              height: heightOverlay,
                            },
                          ]}
                        />
                      );
                    })}
                  </TouchableOpacity>
                );
              })}

              {ehHoje(dataAtual) && (
                <View
                  style={[
                    styles.currentTimeLine,
                    { top: minutosAtual * MINUTE_HEIGHT },
                  ]}
                />
              )}
            </View>
          </View>
        </ScrollView>
      )}



      {modoSemana && (
        <ScrollView
          style={styles.weekScroll}
          contentContainerStyle={styles.weekScrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <View style={styles.weekRow}>
            <View style={styles.weekLabels}>
              {horas.map((h) => (
                <View key={h} style={styles.weekHourSlot}>
                  <Text style={styles.weekHourLabel}>
                    {`${h.toString().padStart(2, "0")}:00`}
                  </Text>
                </View>
              ))}
            </View>

            <ScrollView
              ref={weekHorizontalRef}
              horizontal
              contentContainerStyle={styles.weekContent}
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
            >
              {getSemana(dataAtual).map((dia) => {
                const eventosDia =
                  eventosPorDia.get(dia.toDateString()) ?? [];

                return (
                  <View key={dia.toDateString()} style={styles.weekDayColumn}>
                    <Text
                      style={[
                        styles.weekDayHeader,
                        ehHoje(dia) && styles.weekDayHeaderToday,
                      ]}
                    >
                      {diasSemana[dia.getDay()]} {dia.getDate()}
                    </Text>

                    <View style={styles.weekTimelineArea}>
                      {horas.map((h) => (
                        <View
                          key={h}
                          style={[
                            styles.weekHourLine,
                            { top: h * 60 * MINUTE_HEIGHT },
                          ]}
                        />
                      ))}

                      {eventosDia.map((ev) => {
                        const corBase = ev.conflict
                          ? "#e63946"
                          : normalizeCalendarColor(ev.cor ?? DEFAULT_CALENDAR_CATEGORY.color);
                        const altura = Math.max(
                          (ev.endMin - ev.startMin) * MINUTE_HEIGHT,
                          DURACAO_MINIMA * MINUTE_HEIGHT
                        );
                        const isEventoCurto = altura <= DURACAO_MINIMA * MINUTE_HEIGHT + 2;
                        const availableWidth =
                          WEEK_DAY_WIDTH - CARD_SPACING * (ev.maxColumns + 1);
                        const larguraEvento = Math.max(
                          availableWidth / ev.maxColumns,
                          0
                        );
                        const left =
                          CARD_SPACING +
                          ev.columnIndex * (larguraEvento + CARD_SPACING);

                        const estiloEvento: any = {
                          top: ev.startMin * MINUTE_HEIGHT,
                          height: altura,
                          backgroundColor: corBase,
                          width: larguraEvento,
                          left,
                        };

                        if (isEventoCurto) {
                          estiloEvento.paddingVertical = 4;
                          estiloEvento.justifyContent = "center";
                        }

                        return (
                          <TouchableOpacity
                            key={ev.uniqueKey}
                            style={[
                              styles.eventBlock,
                              ev.conflict && styles.eventBlockConflict,
                              estiloEvento,
                            ]}
                            onPress={() => abrirModalEditar(ev)}
                            activeOpacity={0.85}
                          >
                            <Text
                              style={[styles.eventoTexto, isEventoCurto && styles.eventoTextoCurto]}
                              numberOfLines={isEventoCurto ? 2 : undefined}
                            >
                              {ev.titulo}
                            </Text>
                            <Text style={[styles.eventoHora, isEventoCurto && styles.eventoHoraCurta]}>
                              {new Date(ev.inicio ?? "").toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {" "}-{" "}
                              {new Date(ev.fim ?? "").toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </Text>

                            {ev.overlaps.map((intervalo, idx) => {
                              const sobreposicaoInicio =
                                intervalo.start - ev.startMin;
                              const sobreposicaoAltura =
                                intervalo.end - intervalo.start;
                              let heightOverlay = Math.max(
                                sobreposicaoAltura * MINUTE_HEIGHT,
                                2
                              );
                              let topOverlay = Math.max(
                                sobreposicaoInicio * MINUTE_HEIGHT,
                                0
                              );

                              const limiteMinimo =
                                CONFLICT_HEADER_GAP + CONFLICT_EXTRA_OFFSET;
                              if (topOverlay < limiteMinimo) {
                                const diferenca = limiteMinimo - topOverlay;
                                topOverlay = limiteMinimo;
                                heightOverlay -= diferenca;
                              }

                              if (heightOverlay <= 0) {
                                return null;
                              }

                              return (
                                <View
                                  key={`${ev.uniqueKey}-week-conflict-${idx}`}
                                  pointerEvents="none"
                                  style={[
                                    styles.conflictOverlay,
                                    {
                                      top: topOverlay,
                                      height: heightOverlay,
                                    },
                                  ]}
                                />
                              );
                            })}
                          </TouchableOpacity>
                        );
                      })}

                      {ehHoje(dia) && (
                        <View
                          style={[
                            styles.weekCurrentTimeLine,
                            { top: minutosAtual * MINUTE_HEIGHT },
                          ]}
                        />
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      <TaskModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={async (task) => {
          if (task.id) {
            await atualizarEvento(task);
          } else {
            await salvarEvento(task);
          }
          await carregarEventos();
          try {
            await triggerEventSync({ force: true });
          } catch (error) {
            console.warn("[agenda] failed to trigger sync after save", error);
          }
        }}
        initialData={tarefaSelecionada}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f7f7" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#ddd",
  },
  leftBtns: { flexDirection: "row", gap: 8 },
  todayBtn: {
    backgroundColor: "#264653",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  todayBtnText: { color: "#fff", fontWeight: "bold" },
  weekBtn: {
    backgroundColor: "#457b9d",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  weekBtnText: { color: "#fff", fontWeight: "bold" },
  addBtn: {
    backgroundColor: "#2a9d8f",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  addBtnText: { color: "#fff", fontWeight: "bold" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    alignItems: "center",
    backgroundColor: "#264653",
  },
  nav: { fontSize: 22, color: "#fff" },
  dataTitulo: { fontSize: 18, fontWeight: "bold", color: "#fff" },
  scroll: { flex: 1 },
  timelineWrapper: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingBottom: 20,
  },
  timelineLabels: {
    width: 60,
    height: DIA_ALTURA,
  },
  hourSlot: {
    height: MINUTE_HEIGHT * 60,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingRight: 6,
  },
  hourLabel: {
    color: "#999",
    fontSize: 12,
  },
  timelineArea: {
    flex: 1,
    height: DIA_ALTURA,
    position: "relative",
    backgroundColor: "#fcfcfc",
  },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#eee",
  },
  eventBlock: {
    position: "absolute",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#fff",
    overflow: "hidden",
    zIndex: 10,
  },
  eventBlockConflict: {
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  eventoTexto: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
    lineHeight: 18,
    textAlign: "left",
  },
  eventoTextoCurto: {
    fontSize: 12,
    lineHeight: 16,
  },
  eventoTextoShortDuration: {
    textAlign: "left",
    width: "100%",
  },
  eventoHora: { color: "#fff", fontSize: 12, marginTop: 4, lineHeight: 16 },
  eventoHoraCurta: {
    fontSize: 10,
    marginTop: 2,
    lineHeight: 12,
  },
  conflictOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  currentTimeLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "red",
    zIndex: 15,
  },
  linhaAgora: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "red",
  },
  weekScroll: { flex: 1 },
  weekScrollContent: {
    paddingBottom: 20,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  weekContent: {
    paddingRight: 16,
  },
  weekLabels: {
    width: 60,
    paddingTop: 32,
    paddingRight: 6,
    height: DIA_ALTURA + 32,
  },
  weekHourSlot: {
    height: MINUTE_HEIGHT * 60,
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },
  weekHourLabel: {
    color: "#999",
    fontSize: 12,
  },
  weekDayColumn: {
    width: WEEK_DAY_WIDTH,
    marginHorizontal: WEEK_DAY_MARGIN_HORIZONTAL,
  },
  weekDayHeader: {
    textAlign: "center",
    fontWeight: "600",
    marginBottom: 8,
  },
  weekDayHeaderToday: {
    color: "#e63946",
  },
  weekTimelineArea: {
    height: DIA_ALTURA,
    position: "relative",
    backgroundColor: "#fcfcfc",
    borderLeftWidth: 1,
    borderColor: "#eee",
  },
  weekHourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#eee",
  },
  weekCurrentTimeLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "red",
    zIndex: 12,
  },
});

