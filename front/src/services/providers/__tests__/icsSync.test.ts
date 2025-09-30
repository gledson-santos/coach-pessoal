import { expandRecurringEvents, mapIcsToEvento, parseIcsEvents } from "../icsSync";
import { CalendarAccount } from "../../../types/calendar";

jest.mock("../../../database", () => ({
  substituirEventosIcs: jest.fn(),
}));

jest.mock("../../calendarAccountsStore", () => ({
  updateCalendarAccountStatus: jest.fn(),
}));

jest.mock("../../eventSync", () => ({
  triggerEventSync: jest.fn(),
}));

describe("ics recurrence expansion", () => {
  const account: CalendarAccount = {
    id: "account-1",
    provider: "ics",
    email: "user@example.com",
    displayName: "User",
    color: "#ffffff",
  };

  it("expands recurring events applying overrides and cancellations", () => {
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-1\nDTSTART:20250101T120000Z\nDTEND:20250101T130000Z\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20250102T120000Z\nRDATE:20250105T120000Z\nSUMMARY:Evento original\nDESCRIPTION:Descricao base\nEND:VEVENT\nBEGIN:VEVENT\nUID:event-1\nRECURRENCE-ID:20250101T120000Z\nSTATUS:CANCELLED\nEND:VEVENT\nBEGIN:VEVENT\nUID:event-1\nRECURRENCE-ID:20250103T120000Z\nDTSTART:20250103T150000Z\nDTEND:20250103T160000Z\nSUMMARY:Evento alterado\nDESCRIPTION:Descricao alterada\nEND:VEVENT\nEND:VCALENDAR`;

    const parsed = parseIcsEvents(ics);
    expect(parsed).toHaveLength(3);

    const expanded = expandRecurringEvents(parsed);
    expect(expanded).toHaveLength(2);

    const eventos = expanded
      .map((item) => mapIcsToEvento(item, account))
      .filter((item): item is NonNullable<ReturnType<typeof mapIcsToEvento>> => Boolean(item));

    expect(eventos).toHaveLength(2);

    const starts = eventos.map((evento) => evento.inicio);
    expect(starts).toContain("2025-01-03T15:00:00.000Z");
    expect(starts).toContain("2025-01-05T12:00:00.000Z");

    const overrideEvento = eventos.find((evento) => evento.inicio === "2025-01-03T15:00:00.000Z");
    expect(overrideEvento?.titulo).toBe("Evento alterado");
    expect(overrideEvento?.observacao).toBe("Descricao alterada");

    const regularEvento = eventos.find((evento) => evento.inicio === "2025-01-05T12:00:00.000Z");
    expect(regularEvento?.titulo).toBe("Evento original");
    expect(regularEvento?.observacao).toBe("Descricao base");

    const uniqueIds = new Set(eventos.map((evento) => evento.icsUid));
    expect(uniqueIds.size).toBe(eventos.length);
  });
});
