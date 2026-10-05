import { Temporal } from "@js-temporal/polyfill";
import { type Transaction, type TransactionType, type Wallet, hbDateToIso, isoToHbDate, visibleAccounts } from "./homebank";
import { transactionType } from "./wallet";
import { type ScheduledEntry, type ScheduledOperation, projectScheduledOperations, summarizeScheduledEntries } from "./scheduled";

export type CalendarMode = "month" | "year";
type CalendarMovement = { id: string; date: number; accountKey: number; amount: number; type: TransactionType };
export type CalendarEntry = CalendarMovement & (
  { source: "recorded"; transaction: Transaction } | { source: "scheduled"; scheduled: ScheduledEntry }
);

const plainDate = (date: number) => Temporal.PlainDate.from(hbDateToIso(date));
const hbDate = (date: Temporal.PlainDate) => isoToHbDate(date.toString());

export function calendarRange(anchor: number, mode: CalendarMode) {
  const date = plainDate(anchor);
  const start = date.with({ month: mode === "year" ? 1 : date.month, day: 1 });
  const last = mode === "year" ? start.with({ month: 12 }) : start;
  return { start: hbDate(start), end: hbDate(last.with({ day: last.daysInMonth })) };
}

export function shiftCalendarAnchor(anchor: number, mode: CalendarMode, direction: number) {
  const date = plainDate(anchor).with({ day: 1 });
  const next = date.add(mode === "month" ? { months: direction } : { years: direction });
  if (next.year < 1) return isoToHbDate("0001-01-01");
  if (next.year > 9999) return isoToHbDate("9999-12-01");
  return hbDate(next);
}

export function monthGrid(anchor: number) {
  const range = calendarRange(anchor, "month");
  const start = range.start - (plainDate(range.start).dayOfWeek - 1);
  return Array.from({ length: 42 }, (_, index) => ({ date: start + index, inMonth: start + index >= range.start && start + index <= range.end }));
}

export function calendarEntries(wallet: Wallet, operations: ScheduledOperation[], start: number, end: number, today: number, includeClosed = false) {
  const active = new Set((includeClosed ? wallet.accounts : visibleAccounts(wallet)).map((account) => account.key));
  const entries: CalendarEntry[] = wallet.transactions
    .filter((transaction) => active.has(transaction.accountKey) && transaction.status !== "void"
      && transaction.date >= start && transaction.date <= end)
    .map((transaction) => ({ id: `recorded-${transaction.id}`, source: "recorded", transaction, date: transaction.date,
      accountKey: transaction.accountKey, amount: transaction.amount, type: transactionType(transaction) }));
  // Posted future movements remain visible; nextdate governs unposted forecasts.
  const projection = end > today
    ? projectScheduledOperations(wallet, operations.filter((operation) => active.has(operation.accountKey)), Math.max(start, today + 1), end, includeClosed)
    : { entries: [], issues: [] };
  entries.push(...projection.entries.map((scheduled): CalendarEntry => ({
    id: `projected-${scheduled.id}`, source: "scheduled", scheduled, date: scheduled.date,
    accountKey: scheduled.accountKey, amount: scheduled.amount, type: scheduled.operation.type,
  })));
  entries.sort((left, right) => left.date - right.date || left.id.localeCompare(right.id));
  return { entries, issues: projection.issues };
}

export function summarizeCalendarEntries(wallet: Wallet, entries: CalendarEntry[], byAccount = false) {
  return summarizeScheduledEntries(wallet, entries.map((entry) => entry.source === "scheduled" ? entry.scheduled : {
    accountKey: entry.accountKey, amount: entry.amount, operation: { type: entry.type },
  }), byAccount);
}
