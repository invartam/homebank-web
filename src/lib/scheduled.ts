import { Temporal } from "@js-temporal/polyfill";
import { type RawNode, type Wallet, type TransactionType, TRANSACTION_FLAGS, currencyForAccount, hbDateToIso, isoToHbDate, visibleAccounts } from "./homebank";

const RECUR = 1;
const LIMITED = 2;
const RELATIVE = 4;
const MAX_STEPS = 10000;

export interface ScheduledOperation {
  id: string;
  templateKey: number;
  accountKey: number;
  destinationAccountKey: number;
  amount: number;
  transferAmount: number;
  type: TransactionType;
  payeeKey: number;
  categoryKey: number;
  memo: string;
  number: string;
  paymode: number;
  nextDate: number;
  every: number;
  unit: number;
  relative: boolean;
  ordinal: number;
  weekday: number;
  weekend: number;
  gap: number;
  remaining: number | null;
}

export interface ScheduledEntry {
  id: string;
  operation: ScheduledOperation;
  accountKey: number;
  counterpartAccountKey: number;
  amount: number;
  date: number;
}

export interface ForecastTotals {
  accountKey: number;
  currencyKey: number;
  income: number;
  expenses: number;
  transferIn: number;
  transferOut: number;
  count: number;
}

export type SchedulePeriod = "month" | "30" | "90";
const plainDate = (date: number) => Temporal.PlainDate.from(hbDateToIso(date));
const hbDate = (date: Temporal.PlainDate) => isoToHbDate(date.toString());

function numberAttribute(node: RawNode, name: string, fallback = 0) {
  const raw = node.attributes[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Attribut ${name} invalide.`);
  return value;
}

function integerAttribute(node: RawNode, name: string, fallback = 0) {
  const value = numberAttribute(node, name, fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Attribut ${name} invalide.`);
  return value;
}

export function readScheduledOperations(wallet: Wallet) {
  const operations: ScheduledOperation[] = [];
  const issues: string[] = [];
  const active = new Set(visibleAccounts(wallet).map((account) => account.key));
  wallet.templates.forEach((node, index) => {
    try {
      // Older HomeBank files stored the recurrence bits in the transaction flags.
      const flags = integerAttribute(node, "flags");
      const recurrence = node.attributes.recflg === undefined
        ? ((flags & 4) ? RECUR : 0) | ((flags & 128) ? LIMITED : 0)
        : integerAttribute(node, "recflg");
      if (!(recurrence & RECUR)) return;
      const accountKey = integerAttribute(node, "account");
      if (!active.has(accountKey)) return;
      const nextDate = integerAttribute(node, "nextdate");
      if (nextDate < 1 || plainDate(nextDate).year > 9999) throw new Error("Prochaine date invalide.");
      const every = integerAttribute(node, "every", 1);
      const unit = integerAttribute(node, "unit");
      const weekend = integerAttribute(node, "weekend");
      const gap = integerAttribute(node, "gap");
      const relative = Boolean(recurrence & RELATIVE);
      const ordinal = integerAttribute(node, "ordn");
      const weekday = integerAttribute(node, "wkdy");
      if (every < 1 || every > 255 || unit > 3 || weekend > 3 || gap > 3
        || (relative && (ordinal < 1 || ordinal > 5 || weekday < 1 || weekday > 8))) {
        throw new Error("Recurrence non prise en charge ou invalide.");
      }
      const remaining = recurrence & LIMITED ? integerAttribute(node, "limit") : null;
      if (remaining === 0) return;
      const amount = numberAttribute(node, "amount");
      const type = flags & TRANSACTION_FLAGS.internalTransfer ? "transfer" : amount > 0 ? "income" : "expense";
      operations.push({
        id: `schedule-${index}`, templateKey: integerAttribute(node, "key"), accountKey,
        destinationAccountKey: integerAttribute(node, "dst_account"), amount,
        transferAmount: numberAttribute(node, "damt"), type,
        payeeKey: integerAttribute(node, "payee"), categoryKey: integerAttribute(node, "category"),
        memo: node.attributes.wording === "(null)" ? "" : node.attributes.wording ?? "",
        number: node.attributes.info === "(null)" ? "" : node.attributes.info ?? "",
        paymode: integerAttribute(node, "paymode"), nextDate, every, unit, relative, ordinal, weekday, weekend, gap, remaining,
      });
    } catch (error) {
      issues.push(`${node.attributes.wording || `Planification ${index + 1}`} : ${error instanceof Error ? error.message : "Donnees invalides."}`);
    }
  });
  return { operations, issues };
}

export function scheduledPostDate(date: number, weekend: number) {
  const weekday = plainDate(date).dayOfWeek;
  if (weekday < 6) return date;
  if (weekend === 1) return date - (weekday - 5);
  if (weekend === 2) return date + (8 - weekday);
  return date;
}

function advance(operation: ScheduledOperation, current: Temporal.PlainDate, gap: number) {
  let next: Temporal.PlainDate;
  if (operation.relative) {
    const first = current.with({ day: 1 }).add({ months: operation.every });
    if (operation.weekday === 8) {
      next = first.with({ day: operation.ordinal === 5 ? first.daysInMonth : operation.ordinal });
    } else {
      const offset = (operation.weekday - first.dayOfWeek + 7) % 7;
      let day = 1 + offset + 7 * (operation.ordinal - 1);
      if (day > first.daysInMonth) day -= 7;
      next = first.with({ day });
    }
  } else {
    const durations = [{ days: operation.every }, { weeks: operation.every }, { months: operation.every }, { years: operation.every }];
    next = current.add(durations[operation.unit]);
    if (operation.weekend === 3 && next.dayOfWeek >= 6) next = next.add({ days: 8 - next.dayOfWeek });
    // Match scheduled_date_advance in hb-template.c, including its saved month-end gap.
    if (operation.unit >= 2) {
      if (current.day >= 28) {
        if (gap) next = next.add({ days: gap });
        gap = Math.max(0, Math.min(3, current.day + gap - next.day));
      } else gap = 0;
    }
  }
  return { next, gap };
}

export function scheduleRange(today: number, period: SchedulePeriod) {
  const date = plainDate(today);
  return { start: today, end: hbDate(period === "month" ? date.with({ day: date.daysInMonth }) : date.add({ days: Number(period) - 1 })) };
}

export function scheduledEntries(wallet: Wallet, operation: ScheduledOperation, date = scheduledPostDate(operation.nextDate, operation.weekend), suffix = "next"): ScheduledEntry[] {
  const entries: ScheduledEntry[] = [{ id: `${operation.id}-${suffix}-${operation.accountKey}`, operation, accountKey: operation.accountKey,
    counterpartAccountKey: operation.type === "transfer" ? operation.destinationAccountKey : 0, amount: operation.amount, date }];
  if (operation.type === "transfer") {
    const source = wallet.accounts.find((account) => account.key === operation.accountKey);
    const destination = visibleAccounts(wallet).find((account) => account.key === operation.destinationAccountKey);
    if (destination && destination.key !== operation.accountKey) {
      const amount = source?.currencyKey === destination.currencyKey ? -operation.amount : operation.transferAmount;
      if (amount && Math.sign(amount) !== Math.sign(operation.amount)) entries.push({
        id: `${operation.id}-${suffix}-${destination.key}`, operation, accountKey: destination.key,
        counterpartAccountKey: operation.accountKey, amount, date,
      });
    }
  }
  return entries;
}

export function projectScheduledOperations(wallet: Wallet, operations: ScheduledOperation[], start: number, end: number) {
  const entries: ScheduledEntry[] = [];
  const issues: string[] = [];
  let overdueCount = 0;
  for (const operation of operations) {
    let current = plainDate(operation.nextDate);
    let gap = operation.gap;
    let step = 0;
    try {
      while (hbDate(current) <= end + 2 && (operation.remaining === null || step < operation.remaining)) {
        if (step >= MAX_STEPS) throw new Error("Trop d'echeances anciennes : prevision incomplete.");
        const date = scheduledPostDate(hbDate(current), operation.weekend);
        if (date < start) overdueCount++;
        if (date >= start && date <= end) entries.push(...scheduledEntries(wallet, operation, date, String(step)));
        const advanced = advance(operation, current, gap);
        if (Temporal.PlainDate.compare(advanced.next, current) <= 0) throw new Error("La recurrence n'avance pas.");
        current = advanced.next;
        gap = advanced.gap;
        step++;
      }
    } catch (error) {
      issues.push(`${operation.memo || "Planification"} : ${error instanceof Error ? error.message : "Prevision impossible."}`);
    }
    if (operation.type === "transfer" && scheduledEntries(wallet, operation).length !== 2) {
      issues.push(`${operation.memo || "Virement"} : compte lie indisponible ou montant lie invalide.`);
    }
  }
  entries.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  return { entries, overdueCount, issues };
}

export function summarizeScheduledEntries(wallet: Wallet, entries: ScheduledEntry[], byAccount = false) {
  const totals = new Map<number, ForecastTotals>();
  for (const entry of entries) {
    const currencyKey = currencyForAccount(wallet, entry.accountKey)?.key ?? wallet.baseCurrencyKey;
    const key = byAccount ? entry.accountKey : currencyKey;
    const total = totals.get(key) ?? { accountKey: entry.accountKey, currencyKey, income: 0, expenses: 0, transferIn: 0, transferOut: 0, count: 0 };
    total.count++;
    if (entry.operation.type === "transfer") {
      if (entry.amount > 0) total.transferIn += entry.amount;
      else total.transferOut -= entry.amount;
    } else if (entry.amount > 0) total.income += entry.amount;
    else total.expenses -= entry.amount;
    totals.set(key, total);
  }
  return [...totals.values()];
}

export const forecastNet = (total: ForecastTotals) => total.income - total.expenses + total.transferIn - total.transferOut;

export function recurrenceLabel(operation: ScheduledOperation) {
  if (operation.remaining === 1) return "Une seule echeance";
  if (operation.relative) {
    const ordinals = ["", "Premier", "Deuxieme", "Troisieme", "Quatrieme", "Dernier"];
    const weekdays = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche", "jour"];
    return `${ordinals[operation.ordinal]} ${weekdays[operation.weekday]} ${operation.every === 1 ? "du mois" : `tous les ${operation.every} mois`}`;
  }
  if (operation.every === 1) return ["Chaque jour", "Chaque semaine", "Chaque mois", "Chaque annee"][operation.unit];
  return `Tous les ${operation.every} ${["jours", "semaines", "mois", "ans"][operation.unit]}`;
}

export const weekendLabels = ["Date inchangee", "Vendredi precedent", "Lundi suivant", "Week-end saute"];
