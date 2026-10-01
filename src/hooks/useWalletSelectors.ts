import { useMemo } from "react";
import { type Wallet, balancesByAccount, sumAccountBalances, visibleAccounts } from "../lib/homebank";
import { categoryPath, transactionType, transactionTypeLabels, transferLabel } from "../lib/wallet";

export function useWalletSelectors(wallet: Wallet, query: string, accountFilter: number) {
  const accountByKey = useMemo(() => new Map(wallet.accounts.map((account) => [account.key, account])), [wallet.accounts]);
  const payeeByKey = useMemo(() => new Map(wallet.payees.map((payee) => [payee.key, payee])), [wallet.payees]);
  const categoryLabelByKey = useMemo(() => {
    const byKey = new Map(wallet.categories.map((category) => [category.key, category]));
    return new Map(wallet.categories.map((category) => [category.key, categoryPath(category, byKey)]));
  }, [wallet.categories]);
  const activeAccounts = useMemo(() => visibleAccounts(wallet), [wallet.accounts]);
  const activeAccountKeys = useMemo(() => new Set(activeAccounts.map((account) => account.key)), [activeAccounts]);
  const balances = useMemo(() => balancesByAccount(wallet), [wallet.accounts, wallet.transactions]);
  const totals = useMemo(() => sumAccountBalances(activeAccounts, balances), [activeAccounts, balances]);
  const transactions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("fr-FR");
    return wallet.transactions.filter((txn) => {
      if (!activeAccountKeys.has(txn.accountKey) || (accountFilter && txn.accountKey !== accountFilter)) return false;
      const payee = payeeByKey.get(txn.payeeKey)?.name ?? "";
      const category = categoryLabelByKey.get(txn.categoryKey) ?? "";
      const type = transactionType(txn);
      const transfer = type === "transfer" ? transferLabel(wallet, txn) : "";
      return !search || `${txn.memo} ${txn.number} ${payee} ${category} ${transactionTypeLabels[type]} ${transfer}`.toLocaleLowerCase("fr-FR").includes(search);
    }).sort((a, b) => b.date - a.date);
  }, [wallet.transactions, activeAccountKeys, accountFilter, query, payeeByKey, categoryLabelByKey]);
  const operationSummary = useMemo(() => {
    const accounts = accountFilter ? activeAccounts.filter((account) => account.key === accountFilter) : activeAccounts;
    return {
      title: accountFilter ? (accountByKey.get(accountFilter)?.name ?? "Compte") : "Tous les comptes",
      ...sumAccountBalances(accounts, balances),
      currencyAccountKey: accounts[0]?.key ?? 0,
      accounts,
    };
  }, [activeAccounts, accountFilter, accountByKey, balances]);
  return { accountByKey, payeeByKey, categoryLabelByKey, activeAccounts, transactions, balances, totals, operationSummary };
}
