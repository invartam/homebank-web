import { Temporal } from "@js-temporal/polyfill";
import { currencyForAccount, hbDateToIso, isBankAccount, isClosedAccount, isSavingsAccount, isoToHbDate, type Account, type Wallet } from "./homebank";
import { projectScheduledOperations, readScheduledOperations } from "./scheduled";

export type BalanceScope = "bank" | "savings" | `account:${number}`;
export type HistoryRange = { start: number; end: number };
export type HistoryPeriod = "1m" | "3m" | "1y" | "5y" | "all" | "forecast";
export type ProjectionMonths = 3 | 12 | 60;
type HistoryEvent = { date: number; amount: number };
export interface BalanceHistory {
  domain: HistoryRange;
  initial: number;
  events: HistoryEvent[];
  today: number;
  issues: string[];
  accounts: Account[];
}
export interface BalanceChartData {
  dates: number[];
  balances: number[];
  opening: number;
  closing: number;
}

export function historyAccounts(wallet: Wallet, scope: BalanceScope, currencyKey?: number) {
  return wallet.accounts.filter((account) => !isClosedAccount(account)
    && (scope === "bank" ? isBankAccount(account) : scope === "savings" ? isSavingsAccount(account) : account.key === Number(scope.slice(8)))
    && (currencyKey === undefined || currencyForAccount(wallet, account.key)?.key === currencyKey));
}

export function buildBalanceHistory(wallet: Wallet, accounts: Account[], today: number, months: ProjectionMonths = 12): BalanceHistory {
  const active = accounts.filter((account) => !isClosedAccount(account));
  const currencies = new Set(active.map((account) => currencyForAccount(wallet, account.key)?.key ?? wallet.baseCurrencyKey));
  if (currencies.size > 1) throw new Error("Les devises doivent etre affichees separement.");
  const keys = new Set(active.map((account) => account.key));
  const anchor = Temporal.PlainDate.from(hbDateToIso(today));
  const horizon = anchor.add({ months });
  const end = horizon.year > 9999 ? 3652059 : isoToHbDate(horizon.toString());
  const byDate = new Map<number, HistoryEvent>();
  const add = (date: number, amount: number) => {
    const event = byDate.get(date) ?? { date, amount: 0 };
    event.amount += amount;
    byDate.set(date, event);
  };
  let first = today, hasDates = false;
  for (const transaction of wallet.transactions) {
    if (!keys.has(transaction.accountKey) || transaction.status === "void" || transaction.date > end) continue;
    first = Math.min(first, transaction.date); hasDates = true;
    add(transaction.date, transaction.amount);
  }
  const scheduled = readScheduledOperations(wallet);
  // nextdate is HomeBank's next unposted occurrence. Never guess duplicates by amount/date.
  const operations = scheduled.operations.filter((operation) => keys.has(operation.accountKey) || keys.has(operation.destinationAccountKey));
  const projection = end > today && active.length
    ? projectScheduledOperations(wallet, operations, today + 1, end)
    : { entries: [], issues: [] };
  for (const entry of projection.entries) if (keys.has(entry.accountKey)) add(entry.date, entry.amount);
  const start = hasDates ? Math.max(1, first - 1) : Math.max(1, today - 365);
  return {
    domain: { start: Math.min(start, 3652058), end: Math.max(end, start + 1) },
    initial: active.reduce((sum, account) => sum + account.initial, 0),
    events: [...byDate.values()].sort((a, b) => a.date - b.date),
    today,
    issues: active.length ? [...scheduled.issues, ...projection.issues] : [],
    accounts: active,
  };
}

export function clampHistoryRange(range: HistoryRange, domain: HistoryRange): HistoryRange {
  const width = Math.min(domain.end - domain.start, Math.max(1, range.end - range.start));
  const start = Math.max(domain.start, Math.min(range.start, domain.end - width));
  return { start, end: start + width };
}

export function historyPeriodRange(domain: HistoryRange, period: HistoryPeriod, today = domain.end): HistoryRange {
  if (period === "all") return domain;
  if (period === "forecast") return clampHistoryRange({ start: today, end: domain.end }, domain);
  const anchor = Math.min(today, domain.end);
  const end = Temporal.PlainDate.from(hbDateToIso(anchor));
  const start = end.subtract(period === "1m" ? { months: 1 } : period === "3m" ? { months: 3 } : period === "1y" ? { years: 1 } : { years: 5 });
  return clampHistoryRange({ start: Math.max(domain.start, isoToHbDate(start.year < 1 ? "0001-01-01" : start.toString())), end: anchor }, domain);
}

export function zoomHistoryRange(range: HistoryRange, domain: HistoryRange, factor: number): HistoryRange {
  const span = Math.max(1, Math.min(domain.end - domain.start, Math.round((range.end - range.start) * factor)));
  const center = (range.start + range.end) / 2;
  return clampHistoryRange({ start: Math.round(center - span / 2), end: Math.round(center - span / 2) + span }, domain);
}

// Bound canvas data while retaining daily balance extrema in every broad-view bucket.
function addEnvelopeDates(history: BalanceHistory, range: HistoryRange, dates: Set<number>, buckets: number) {
  const width = Math.max(1, Math.ceil((range.end - range.start + 1) / buckets));
  let balance = history.initial;
  const groups = new Map<number, { min: number; max: number; minDate: number; maxDate: number; lastDate: number }>();
  for (const event of history.events) {
    balance += event.amount;
    if (event.date < range.start || event.date > range.end) continue;
    const bucket = Math.floor((event.date - range.start) / width);
    const group = groups.get(bucket) ?? { min: balance, max: balance, minDate: event.date, maxDate: event.date, lastDate: event.date };
    if (balance < group.min) { group.min = balance; group.minDate = event.date; }
    if (balance > group.max) { group.max = balance; group.maxDate = event.date; }
    group.lastDate = event.date; groups.set(bucket, group);
  }
  for (const group of groups.values()) { dates.add(group.minDate); dates.add(group.maxDate); dates.add(group.lastDate); }
}

export function balanceChartData(history: BalanceHistory, requested: HistoryRange, buckets = 450): BalanceChartData {
  const range = clampHistoryRange(requested, history.domain);
  buckets = Math.max(1, Math.min(buckets, 450));
  const samples = new Set([history.domain.start, history.domain.end, range.start, range.end]);
  if (history.today >= history.domain.start && history.today <= history.domain.end) samples.add(history.today);
  addEnvelopeDates(history, history.domain, samples, buckets);
  if (range.end - range.start <= 730) for (let date = range.start; date <= range.end; date++) samples.add(date);
  else addEnvelopeDates(history, range, samples, buckets);
  const dates = [...samples].sort((a, b) => a - b);
  let opening = history.initial;
  for (const event of history.events) {
    if (event.date >= range.start) break;
    opening += event.amount;
  }
  let balance = history.initial, cursor = 0;
  const balances: number[] = [];
  for (const date of dates) {
    while (cursor < history.events.length && history.events[cursor].date <= date) {
      const event = history.events[cursor++]; balance += event.amount;
    }
    balances.push(balance);
  }
  return { dates, balances, opening, closing: balances[dates.indexOf(range.end)] };
}

export const historyTimestamp = (date: number) => (date - 719163) * 86400000;
