import { describe, expect, it } from "vitest";
import { type Wallet, isoToHbDate, serializeHomeBankXml } from "../src/lib/homebank";
import { calendarEntries, calendarRange, monthGrid, shiftCalendarAnchor, summarizeCalendarEntries } from "../src/lib/calendar";
import { forecastNet, readScheduledOperations } from "../src/lib/scheduled";
import { sampleWallet } from "./fixtures";

const date = isoToHbDate;
const today = date("2026-10-15");
function fixture(): Wallet {
  const wallet = sampleWallet();
  const transaction = wallet.transactions[0];
  wallet.transactions = [
    { ...transaction, id: "past", date: date("2026-09-10"), amount: 1000, flags: 2, status: "none" },
    { ...transaction, id: "month-past", date: date("2026-10-01"), amount: -40, status: "cleared" },
    { ...transaction, id: "today", date: today, amount: -5, status: "none" },
    { ...transaction, id: "future-entered", date: date("2026-10-16"), amount: -900 },
    { ...transaction, id: "cancelled", date: date("2026-10-02"), amount: -100, status: "void" },
    { ...transaction, id: "closed", date: date("2026-10-02"), amount: -100, accountKey: 3 },
  ];
  wallet.templates = [{ name: "fav", attributes: { key: "1", account: "1", amount: "-10", recflg: "1", nextdate: String(date("2026-10-01")), every: "1", unit: "0" } }];
  return wallet;
}
function entries(wallet: Wallet, start: string, end: string, boundary = today) {
  return calendarEntries(wallet, readScheduledOperations(wallet).operations, date(start), date(end), boundary);
}

describe("banking calendar history and forecasts", () => {
  it("shows only entered, non-cancelled movements on active accounts in the past", () => {
    const result = entries(fixture(), "2026-09-01", "2026-09-30");
    expect(result.entries.map((entry) => entry.id)).toEqual(["recorded-past"]);
    expect(result.entries[0].source).toBe("recorded");
    expect(summarizeCalendarEntries(fixture(), result.entries)[0].income).toBe(1000);
  });

  it("combines posted movements at any date with forecasts strictly after today", () => {
    const wallet = fixture();
    const result = entries(wallet, "2026-10-01", "2026-10-31");
    expect(result.entries.filter((entry) => entry.source === "recorded").map((entry) => entry.id)).toEqual(["recorded-month-past", "recorded-today", "recorded-future-entered"]);
    expect(result.entries.filter((entry) => entry.source === "scheduled")).toHaveLength(16);
    expect(result.entries.filter((entry) => entry.date === today)).toHaveLength(1);
    expect(result.entries.filter((entry) => entry.date === date("2026-10-16"))).toHaveLength(2);
    expect(summarizeCalendarEntries(wallet, result.entries)[0]).toMatchObject({ income: 0, expenses: 1105, count: 19 });
  });

  it("includes future posted movements with any valid status, even without schedules", () => {
    const wallet = fixture();
    expect(entries(wallet, "2026-10-16", "2026-10-16").entries).toHaveLength(2);
    wallet.templates = [];
    for (const status of ["none", "cleared", "reconciled"] as const) {
      wallet.transactions[3].status = status;
      expect(entries(wallet, "2026-10-16", "2026-10-31").entries.map((entry) => entry.id)).toEqual(["recorded-future-entered"]);
    }
    wallet.transactions[3].status = "void";
    expect(entries(wallet, "2026-10-16", "2026-10-31").entries).toHaveLength(0);
    wallet.transactions[3].status = "none";
    wallet.transactions[3].accountKey = 3;
    expect(entries(wallet, "2026-10-16", "2026-10-31").entries).toHaveLength(0);
  });

  it("does not synthesize historical scheduled occurrences or back-project before nextdate", () => {
    const wallet = fixture();
    wallet.transactions = [];
    expect(entries(wallet, "2026-10-01", "2026-10-15").entries).toHaveLength(0);
    wallet.templates[0].attributes.nextdate = String(date("2026-11-01"));
    expect(entries(wallet, "2026-10-16", "2026-10-31").entries).toHaveLength(0);
  });

  it("uses entered movements for past years and combines posted and scheduled future years", () => {
    const wallet = fixture();
    wallet.templates[0].attributes.unit = "2";
    wallet.transactions.push({ ...wallet.transactions[0], id: "last-year", date: date("2025-01-12"), amount: 500 });
    wallet.transactions.push({ ...wallet.transactions[0], id: "next-year", date: date("2027-01-12"), amount: 250 });
    expect(entries(wallet, "2025-01-01", "2025-12-31").entries.map((entry) => entry.id)).toEqual(["recorded-last-year"]);
    const future = entries(wallet, "2027-01-01", "2027-12-31").entries;
    expect(future).toHaveLength(13);
    expect(future.filter((entry) => entry.source === "scheduled")).toHaveLength(12);
    expect(summarizeCalendarEntries(wallet, future)[0]).toMatchObject({ income: 250, expenses: 120 });
  });

  it("combines the current year's recorded past and projected future by date", () => {
    const wallet = fixture();
    wallet.templates[0].attributes.unit = "2";
    const result = entries(wallet, "2026-01-01", "2026-12-31");
    expect(result.entries.map((entry) => entry.date)).toEqual(["2026-09-10", "2026-10-01", "2026-10-15", "2026-10-16", "2026-11-01", "2026-12-01"].map(date));
    expect(summarizeCalendarEntries(wallet, result.entries)[0]).toMatchObject({ income: 1000, expenses: 965, count: 6 });
  });

  it("respects remaining limits including historical and today's occurrences", () => {
    const wallet = fixture();
    wallet.templates[0].attributes.recflg = "3";
    wallet.templates[0].attributes.limit = "16";
    const result = entries(wallet, "2026-10-16", "2026-10-31");
    expect(result.entries).toHaveLength(2);
    expect(result.entries.filter((entry) => entry.source === "scheduled").map((entry) => entry.date)).toEqual([date("2026-10-16")]);
    expect(wallet.templates[0].attributes.limit).toBe("16");
  });

  it("applies the boundary to weekend-adjusted posting dates", () => {
    const wallet = fixture();
    Object.assign(wallet.templates[0].attributes, { nextdate: String(date("2026-10-17")), unit: "2", weekend: "1" });
    expect(entries(wallet, "2026-10-01", "2026-10-31", date("2026-10-16")).entries.filter((entry) => entry.source === "scheduled")).toHaveLength(0);
    expect(entries(wallet, "2026-10-01", "2026-10-31", date("2026-10-15")).entries.filter((entry) => entry.source === "scheduled")[0].date).toBe(date("2026-10-16"));
  });

  it("keeps transfers separate from revenues and expenses for both data sources", () => {
    const wallet = fixture();
    wallet.transactions = [
      { ...wallet.transactions[0], date: today + 1, accountKey: 1, flags: 8, amount: -100, destinationAccountKey: 2 },
      { ...wallet.transactions[0], id: "credit", date: today + 1, accountKey: 2, flags: 8, amount: 100, destinationAccountKey: 1 },
    ];
    Object.assign(wallet.templates[0].attributes, { flags: "8", dst_account: "2", amount: "-50", nextdate: String(today + 1), unit: "2" });
    const result = entries(wallet, "2026-10-01", "2026-10-31");
    const totals = summarizeCalendarEntries(wallet, result.entries);
    expect(totals[0]).toMatchObject({ income: 0, expenses: 0, transferIn: 150, transferOut: 150, count: 4 });
    expect(forecastNet(totals[0])).toBe(0);
    const byAccount = summarizeCalendarEntries(wallet, result.entries, true);
    expect(forecastNet(byAccount.find((total) => total.accountKey === 1)!)).toBe(-150);
    expect(forecastNet(byAccount.find((total) => total.accountKey === 2)!)).toBe(150);
  });

  it("never adds different currencies into one calendar total", () => {
    const wallet = fixture();
    wallet.currencies.push({ ...wallet.currencies[0], key: 2, iso: "USD" });
    wallet.accounts[1].currencyKey = 2;
    wallet.transactions.push({ ...wallet.transactions[0], id: "usd", date: today, accountKey: 2, amount: 50 });
    expect(summarizeCalendarEntries(wallet, entries(wallet, "2026-10-01", "2026-10-31").entries).map((total) => total.currencyKey)).toEqual([1, 2]);
  });

  it("does not mutate transactions, raw templates or exported HomeBank XML", () => {
    const wallet = fixture();
    const before = serializeHomeBankXml(wallet);
    entries(wallet, "2026-01-01", "2027-12-31");
    expect(serializeHomeBankXml(wallet)).toBe(before);
  });

  it("optionally includes closed account history and future posted movements without voids or missing accounts", () => {
    const wallet = fixture();
    wallet.transactions.push(
      { ...wallet.transactions[0], id: "closed-future", date: today + 1, accountKey: 3, amount: -50 },
      { ...wallet.transactions[0], id: "closed-void", date: today + 1, accountKey: 3, status: "void" },
      { ...wallet.transactions[0], id: "missing", date: today + 1, accountKey: 999 },
    );
    const range = calendarRange(today, "year");
    const parsed = readScheduledOperations(wallet, true);
    const before = serializeHomeBankXml(wallet);
    const result = calendarEntries(wallet, parsed.operations, range.start, range.end, today, true);
    expect(result.entries.filter((entry) => entry.accountKey === 3).map((entry) => entry.id)).toEqual(["recorded-closed", "recorded-closed-future"]);
    expect(result.entries.some((entry) => entry.accountKey === 999)).toBe(false);
    expect(summarizeCalendarEntries(wallet, result.entries, true).find((total) => total.accountKey === 3)?.expenses).toBe(150);
    expect(calendarEntries(wallet, parsed.operations, range.start, range.end, today).entries.some((entry) => entry.accountKey === 3)).toBe(false);
    expect(serializeHomeBankXml(wallet)).toBe(before);
  });

  it("includes closed account forecasts only on explicit opt-in", () => {
    const wallet = fixture();
    wallet.templates = [{ name: "fav", attributes: { account: "3", amount: "-25", recflg: "1", nextdate: String(today + 1), every: "1", unit: "2" } }];
    expect(readScheduledOperations(wallet).operations).toHaveLength(0);
    const parsed = readScheduledOperations(wallet, true);
    expect(parsed.operations).toHaveLength(1);
    const result = calendarEntries(wallet, parsed.operations, today + 1, today + 1, today, true);
    expect(result.entries.filter((entry) => entry.accountKey === 3 && entry.source === "scheduled")).toHaveLength(1);
    expect(summarizeCalendarEntries(wallet, result.entries, true).find((total) => total.accountKey === 3)?.expenses).toBe(25);
  });

  it("includes both sides of a forecast transfer with a closed counterpart on opt-in", () => {
    const wallet = fixture();
    Object.assign(wallet.templates[0].attributes, { flags: "8", dst_account: "3", amount: "-50", nextdate: String(today + 1), unit: "2" });
    const parsed = readScheduledOperations(wallet, true);
    const result = calendarEntries(wallet, parsed.operations, today + 1, today + 1, today, true);
    const transfer = result.entries.filter((entry) => entry.type === "transfer");
    expect(transfer.map((entry) => entry.accountKey)).toEqual([1, 3]);
    expect(result.issues).toHaveLength(0);
    expect(summarizeCalendarEntries(wallet, transfer)[0]).toMatchObject({ transferIn: 50, transferOut: 50 });
    const openOnly = calendarEntries(wallet, readScheduledOperations(wallet).operations, today + 1, today + 1, today);
    expect(openOnly.entries.filter((entry) => entry.type === "transfer").map((entry) => entry.accountKey)).toEqual([1]);
    expect(openOnly.issues[0]).toContain("compte lie indisponible");
  });

  it("reports incomplete projections instead of making their totals look reliable", () => {
    const wallet = fixture();
    wallet.templates[0].attributes.nextdate = String(date("0001-01-01"));
    expect(entries(wallet, "2026-10-16", "2026-10-31").issues[0]).toContain("prevision incomplete");
  });
});

describe("calendar layout and navigation", () => {
  it("creates six Monday-first weeks including neighbouring month placeholders", () => {
    const cells = monthGrid(date("2026-10-15"));
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: date("2026-09-28"), inMonth: false });
    expect(cells[3]).toEqual({ date: date("2026-10-01"), inMonth: true });
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("handles leap years and December-to-January navigation", () => {
    expect(calendarRange(date("2024-02-10"), "month")).toEqual({ start: date("2024-02-01"), end: date("2024-02-29") });
    expect(monthGrid(date("2024-02-10")).filter((cell) => cell.inMonth)).toHaveLength(29);
    expect(shiftCalendarAnchor(date("2026-12-31"), "month", 1)).toBe(date("2027-01-01"));
    expect(shiftCalendarAnchor(date("2026-01-31"), "month", -1)).toBe(date("2025-12-01"));
    expect(shiftCalendarAnchor(date("2026-10-15"), "year", 1)).toBe(date("2027-10-01"));
    expect(calendarRange(date("2026-10-15"), "year")).toEqual({ start: date("2026-01-01"), end: date("2026-12-31") });
  });

  it("bounds navigation to dates HomeBank can display", () => {
    expect(shiftCalendarAnchor(date("0001-01-01"), "month", -1)).toBe(date("0001-01-01"));
    expect(shiftCalendarAnchor(date("9999-12-01"), "month", 1)).toBe(date("9999-12-01"));
    expect(shiftCalendarAnchor(date("0001-10-01"), "year", -1)).toBe(date("0001-01-01"));
    expect(shiftCalendarAnchor(date("9999-10-01"), "year", 1)).toBe(date("9999-12-01"));
  });
});
