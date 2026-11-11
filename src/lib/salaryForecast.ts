import Decimal from "decimal.js";
import { balancesByAccount, isBankAccount, isClosedAccount, type Account, type Wallet } from "./homebank";
import { categoryPath, transactionType } from "./wallet";
import { projectScheduledOperations, readScheduledOperations, type ScheduledOperation } from "./scheduled";

// Cover the decimal range of finite JS inputs without changing Decimal's global settings.
const Money = Decimal.clone({ precision: 1000 });
const salaryWords = /\b(salaires?|salary|salaries|paie|payroll)\b/;
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const monthly = (operation: ScheduledOperation) => new Money(operation.amount).abs().mul(30.436875)
  .div(operation.every).div([1, 7, 30.436875, 365.2425][operation.unit]);
export type ManualForecasts = Record<string, { enabled: boolean; until: number }>;
export const manualForecastKey = (wallet: Wallet, account: Account) => JSON.stringify([wallet.sourceFileName, wallet.owner, account.key, account.name, account.currencyKey]);

export function salaryForecastBalances(wallet: Wallet, today: number, manual: ManualForecasts = {}) {
  const balances = balancesByAccount(wallet);
  const parsed = readScheduledOperations(wallet);
  const categories = new Map(wallet.categories.map((category) => [category.key, category]));
  const named = (operation: Pick<ScheduledOperation, "categoryKey" | "memo">) => {
    const category = categories.get(operation.categoryKey);
    return salaryWords.test(normalized(`${operation.memo} ${category ? categoryPath(category, categories) : ""}`));
  };
  const recorded = new Map<number, typeof wallet.transactions>();
  for (const transaction of wallet.transactions) {
    if (transaction.status === "void") continue;
    const items = recorded.get(transaction.accountKey) ?? [];
    items.push(transaction); recorded.set(transaction.accountKey, items);
  }
  for (const account of wallet.accounts) {
    if (isClosedAccount(account)) continue;
    const own = parsed.operations.filter((operation) => operation.accountKey === account.key);
    const incomes = own.filter((operation) => operation.type === "income" && operation.amount > 0);
    let candidates = isBankAccount(account) ? incomes.filter(named) : [], estimated = false;
    if (!candidates.length && isBankAccount(account)) {
      const regular = incomes.filter((operation) => operation.remaining !== 1 && operation.unit < 3 && operation.every * [1, 7, 30.436875][operation.unit] <= 93);
      const ranked = regular.map((operation) => ({ operation, monthly: monthly(operation) })).sort((a, b) => b.monthly.comparedTo(a.monthly));
      const income = incomes.filter((operation) => operation.remaining !== 1).reduce((sum, operation) => sum.plus(monthly(operation)), new Money(0));
      const expenses = own.filter((operation) => operation.amount < 0 && operation.remaining !== 1)
        .reduce((sum, operation) => sum.plus(monthly(operation)), new Money(0));
      const largest = ranked[0];
      if (largest && expenses.gt(0) && largest.monthly.gte(income.mul("0.6")) && largest.monthly.gte(expenses.mul("0.5"))) {
        candidates = [largest.operation]; estimated = true;
      }
    }
    const upcoming = candidates.length ? projectScheduledOperations(wallet, candidates, today, Math.min(3652059, today + 366)) : { entries: [], issues: [] };
    const scheduledSalary = upcoming.entries.find((entry) => entry.accountKey === account.key);
    let next = scheduledSalary ? { date: scheduledSalary.date, label: scheduledSalary.operation.memo || (estimated ? "Revenu recurrent" : "Salaire") } : undefined;
    // HomeBank can post ahead of time and advance nextdate: that future salary still bounds this budget.
    if (isBankAccount(account)) for (const transaction of recorded.get(account.key) ?? []) {
      if (transaction.date <= today || transaction.amount <= 0 || transactionType(transaction) !== "income") continue;
      const match = candidates.find((operation) => operation.categoryKey === transaction.categoryKey
        && ((operation.payeeKey > 0 && operation.payeeKey === transaction.payeeKey)
          || (operation.memo.trim() !== "" && normalized(operation.memo) === normalized(transaction.memo))));
      const explicit = named(transaction);
      if ((explicit || match) && (!next || transaction.date <= next.date)) {
        next = { date: transaction.date, label: transaction.memo || match?.memo || "Salaire" };
        if (explicit) estimated = false;
      }
    }
    const setting = manual[manualForecastKey(wallet, account)];
    if (!next && !setting?.enabled) {
      if (upcoming.issues.length) balances.get(account.key)!.forecast = {
        kind: "unavailable", until: today, label: "Revenu non calculable", estimated, available: false, issues: upcoming.issues, overdue: 0,
      };
      continue;
    }
    const boundary = next ? next.date : setting.until + 1;
    const validDate = next || (Number.isInteger(setting.until) && setting.until >= today && setting.until <= 3652059);
    const relevant = parsed.operations.filter((operation) => operation.accountKey === account.key || operation.destinationAccountKey === account.key);
    const projection = validDate && boundary > today ? projectScheduledOperations(wallet, relevant, today, boundary - 1) : { entries: [], issues: [], overdueCount: 0 };
    const issues = [...parsed.issues, ...upcoming.issues, ...projection.issues];
    if (!validDate) issues.push("Choisir une date de prevision a partir d'aujourd'hui.");
    const forecast = { kind: next ? "salary" as const : "manual" as const, until: next ? next.date : setting.until, estimated, available: issues.length === 0, issues,
      overdue: projection.overdueCount, label: next?.label || "Date choisie" };
    const balance = balances.get(account.key)!;
    if (forecast.available) {
      let total = new Money(account.initial);
      for (const transaction of recorded.get(account.key) ?? []) if (transaction.date < boundary) total = total.plus(transaction.amount);
      for (const entry of projection.entries) if (entry.accountKey === account.key) total = total.plus(entry.amount);
      const value = total.toNumber();
      if (Number.isFinite(value) && new Money(String(value)).eq(total)) balance.future = value;
      else { forecast.available = false; forecast.issues.push("Solde hors limites de precision."); }
    }
    balance.forecast = forecast;
  }
  return balances;
}
