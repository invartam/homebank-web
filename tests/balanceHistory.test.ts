import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, balancesByAccount, isoToHbDate } from "../src/lib/homebank";
import { balanceChartData, buildBalanceHistory, clampHistoryRange, historyAccounts, historyPeriodRange, zoomHistoryRange } from "../src/lib/balanceHistory";
import { sampleWallet } from "./fixtures";

const point = (date: string) => isoToHbDate(date);
const today = point("2026-10-10");
const plan = (attributes: Record<string, string> = {}) => ({ name: "fav", attributes: {
  key: "10", account: "1", amount: "-10", recflg: "1", nextdate: String(today + 1), every: "1", unit: "2", ...attributes,
} });
const valueAt = (history: ReturnType<typeof buildBalanceHistory>, date: number) =>
  balanceChartData(history, { start: date - 1, end: date }).closing;

describe("balance report", () => {
  it("separates bank, savings and individual accounts, excluding closed accounts", () => {
    const wallet = sampleWallet();
    expect(historyAccounts(wallet, "bank").map((account) => account.key)).toEqual([1]);
    expect(historyAccounts(wallet, "savings").map((account) => account.key)).toEqual([2]);
    expect(historyAccounts(wallet, "account:3")).toEqual([]);
    expect(historyAccounts(wallet, "account:2").map((account) => account.key)).toEqual([2]);
  });

  it("uses all non-void posted movements and initial balances, without category layers", () => {
    const wallet = sampleWallet(), history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    const data = balanceChartData(history, history.domain);
    expect(data.closing).toBe(balancesByAccount(wallet).get(1)!.future);
    expect(data.opening).toBe(100);
    expect(valueAt(history, today)).toBe(70);
    expect(data).not.toHaveProperty("layers");
  });

  it("does not count split allocations in addition to the transaction amount", () => {
    const wallet = sampleWallet();
    wallet.transactions[0].splits = [{ categoryKey: 2, amount: -12, memo: "" }, { categoryKey: 1, amount: -7, memo: "" }];
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(balanceChartData(history, history.domain).closing).toBe(65);
  });

  it("combines posted future movements and recurrences, never forecasts past days or today", () => {
    const wallet = sampleWallet();
    wallet.templates = [plan({ nextdate: String(today - 2), unit: "0", recflg: "3", limit: "6" })];
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(valueAt(history, today)).toBe(70);
    expect(valueAt(history, today + 1)).toBe(60);
    expect(valueAt(history, today + 3)).toBe(40);
    expect(valueAt(history, point("2026-10-31"))).toBe(35);
  });

  it("starts at HomeBank nextdate, avoiding already-posted installments", () => {
    const wallet = sampleWallet();
    wallet.templates = [plan({ nextdate: String(point("2026-11-11")) })];
    wallet.transactions.push({ ...wallet.transactions[0], id: "posted-installment", date: today + 1, amount: -10, status: "none" });
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(valueAt(history, today + 1)).toBe(60);
    expect(valueAt(history, point("2026-11-11"))).toBe(45);
  });

  it("does not guess duplicates between independent posted and planned movements", () => {
    const wallet = sampleWallet(); wallet.templates = [plan()];
    wallet.transactions.push({ ...wallet.transactions[0], id: "independent", date: today + 1, amount: -10 });
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(valueAt(history, today + 1)).toBe(50);
  });

  it("honors monthly recurrence, weekend adjustments and finite installment counts", () => {
    const wallet = sampleWallet(); wallet.transactions = [];
    wallet.templates = [plan({ nextdate: String(point("2026-10-31")), weekend: "2", recflg: "3", limit: "2" })];
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(valueAt(history, point("2026-10-31"))).toBe(100);
    expect(valueAt(history, point("2026-11-02"))).toBe(90);
    expect(valueAt(history, point("2026-11-30"))).toBe(80);
    expect(balanceChartData(history, history.domain).closing).toBe(80);
  });

  it("includes incoming planned transfers in the destination scope, cancels within a global scope", () => {
    const wallet = sampleWallet();
    wallet.templates = [plan({ flags: "8", dst_account: "2", amount: "-100", recflg: "3", limit: "1" })];
    const savings = buildBalanceHistory(wallet, historyAccounts(wallet, "savings"), today);
    expect(valueAt(savings, today + 1)).toBe(340);
    const bank = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(valueAt(bank, today + 1)).toBe(-30);
    wallet.accounts[1].type = ACCOUNT_TYPES.bank;
    const combined = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(valueAt(combined, today + 1)).toBe(310);
  });

  it("cancels posted transfers within a perimeter but preserves each account movement", () => {
    const wallet = sampleWallet(); wallet.accounts[1].type = ACCOUNT_TYPES.bank;
    const debit = { ...wallet.transactions[0], id: "transfer-out", flags: 8, transferKey: 1, amount: -50, accountKey: 1, destinationAccountKey: 2 };
    wallet.transactions.push(debit, { ...debit, id: "transfer-in", amount: 50, accountKey: 2, destinationAccountKey: 1 });
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(balanceChartData(history, history.domain).closing).toBe(305);
    const single = buildBalanceHistory(wallet, historyAccounts(wallet, "account:1"), today);
    expect(balanceChartData(single, single.domain).closing).toBe(15);
  });

  it("separates currencies, using the saved destination amount of planned transfers", () => {
    const wallet = sampleWallet(); wallet.accounts[1].type = ACCOUNT_TYPES.bank; wallet.accounts[1].currencyKey = 2;
    wallet.currencies.push({ ...wallet.currencies[0], key: 2, iso: "USD", rate: 50 });
    wallet.templates = [plan({ flags: "8", dst_account: "2", amount: "-100", damt: "120", recflg: "3", limit: "1" })];
    expect(() => buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today)).toThrow("devises");
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank", 2), today);
    expect(valueAt(history, today + 1)).toBe(360);
  });

  it("extends the domain without transactions, respecting the chosen finite horizon", () => {
    const wallet = sampleWallet(); wallet.transactions = [];
    for (const months of [3, 12, 60] as const) {
      const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today, months);
      expect(history.domain.end).toBe(point(months === 3 ? "2027-01-10" : months === 12 ? "2027-10-10" : "2031-10-10"));
      expect(balanceChartData(history, history.domain).balances.every((value) => value === 100)).toBe(true);
    }
  });

  it("excludes movements outside the horizon and closed-account schedules", () => {
    const wallet = sampleWallet();
    wallet.templates = [plan({ account: "3", amount: "-99999" })];
    wallet.transactions.push({ ...wallet.transactions[0], id: "distant", date: point("2032-01-01"), amount: 99999 });
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today, 60);
    expect(balanceChartData(history, history.domain).closing).toBe(65);
  });

  it("reports invalid or incomplete forecasts without losing the posted balance", () => {
    const wallet = sampleWallet(); wallet.templates = [plan({ every: "0", wording: "Invalide" })];
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    expect(history.issues.join(" ")).toContain("Invalide");
    expect(valueAt(history, today)).toBe(70);
    wallet.templates = [plan({ nextdate: String(point("1900-01-01")), unit: "0" })];
    expect(buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today).issues.join(" ")).toContain("incomplete");
  });

  it("does not change wallet objects, templates or transaction ordering", () => {
    const wallet = sampleWallet(); wallet.templates = [plan()];
    const before = JSON.stringify(wallet);
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    balanceChartData(history, history.domain);
    expect(JSON.stringify(wallet)).toBe(before);
  });

  it("bounds multi-century data, preserving daily extrema and today's connection", () => {
    const wallet = sampleWallet(), start = point("1900-01-01"), template = wallet.transactions[0]; wallet.transactions = [];
    for (let i = 0; i < 20_000; i++) wallet.transactions.push({ ...template, id: `t${i}`, date: start + i, amount: i === 12_345 ? -5000 : i === 12_346 ? 5000 : 0 });
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today), data = balanceChartData(history, history.domain);
    expect(data.dates.length).toBeLessThanOrEqual(2705);
    expect(data.dates).toContain(start + 12_345);
    expect(Math.min(...data.balances)).toBe(-4900);
    const detail = balanceChartData(history, { start: start + 12_340, end: start + 12_350 });
    for (let date = start + 12_340; date <= start + 12_350; date++) expect(detail.dates).toContain(date);
    expect(data.dates).toContain(today);
  });

  it("clamps the projection at HomeBank's maximum supported date", () => {
    const wallet = sampleWallet(); wallet.transactions = [];
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), point("9999-12-30"));
    expect(history.domain.end).toBe(point("9999-12-31"));
  });
});

describe("history navigation", () => {
  const domain = { start: point("2010-01-01"), end: point("2027-10-10") };
  it("anchors historic presets at today and offers a separate future window", () => {
    expect(historyPeriodRange(domain, "1m", today)).toEqual({ start: point("2026-09-10"), end: today });
    expect(historyPeriodRange(domain, "5y", today).start).toBe(point("2021-10-10"));
    expect(historyPeriodRange(domain, "forecast", today)).toEqual({ start: today, end: domain.end });
    expect(historyPeriodRange(domain, "all", today)).toEqual(domain);
  });
  it("zooms to a day and dezooms without losing domain bounds", () => {
    let range = domain;
    for (let i = 0; i < 20; i++) range = zoomHistoryRange(range, domain, 0.5);
    expect(range.end - range.start).toBe(1);
    for (let i = 0; i < 20; i++) range = zoomHistoryRange(range, domain, 2);
    expect(range).toEqual(domain);
  });
  it("does not slide a short historical window into future dates", () => {
    const short = { start: today - 2, end: today + 365 };
    expect(historyPeriodRange(short, "3m", today)).toEqual({ start: today - 2, end: today });
    expect(historyPeriodRange(short, "5y", today)).toEqual({ start: today - 2, end: today });
  });
  it("clamps movement while preserving range length", () => {
    expect(clampHistoryRange({ start: domain.end, end: domain.end + 10 }, domain)).toEqual({ start: domain.end - 10, end: domain.end });
  });
});
