import { useMemo } from "react";
import { type Wallet, balancesByAccount, sumAccountBalances, visibleAccounts } from "../lib/homebank";
import { categoryPath, transactionType, transactionTypeLabels, transferLabel } from "../lib/wallet";

export function useWalletSelectors(wallet: Wallet, query: string, accountFilter: number, includeClosed = false) {
  const accountByKey = useMemo(() => new Map(wallet.accounts.map((account) => [account.key, account])), [wallet.accounts]);
  const payeeByKey = useMemo(() => new Map(wallet.payees.map((payee) => [payee.key, payee])), [wallet.payees]);
  const categoryLabelByKey = useMemo(() => {
    const byKey = new Map(wallet.categories.map((category) => [category.key, category]));
    return new Map(wallet.categories.map((category) => [category.key, categoryPath(category, byKey)]));
  }, [wallet.categories]);
  const activeAccounts = useMemo(() => visibleAccounts(wallet), [wallet.accounts]);
  const transactionAccounts = includeClosed ? wallet.accounts : activeAccounts;
  const transactionAccountKeys = useMemo(() => new Set(transactionAccounts.map((account) => account.key)), [transactionAccounts]);
  const transactionAccountFilter = transactionAccountKeys.has(accountFilter) ? accountFilter : 0;
  const balances = useMemo(() => balancesByAccount(wallet), [wallet.accounts, wallet.transactions]);
  const totals = useMemo(() => sumAccountBalances(activeAccounts, balances), [activeAccounts, balances]);
  const transactions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("fr-FR");
    return wallet.transactions.filter((txn) => {
      if (!transactionAccountKeys.has(txn.accountKey) || (transactionAccountFilter && txn.accountKey !== transactionAccountFilter)) return false;
      const payee = payeeByKey.get(txn.payeeKey)?.name ?? "";
      const category = categoryLabelByKey.get(txn.categoryKey) ?? "";
      const type = transactionType(txn);
      const transfer = type === "transfer" ? transferLabel(wallet, txn) : "";
      return !search || `${txn.memo} ${txn.number} ${payee} ${category} ${transactionTypeLabels[type]} ${transfer}`.toLocaleLowerCase("fr-FR").includes(search);
    }).sort((a, b) => b.date - a.date);
  }, [wallet.transactions, transactionAccountKeys, transactionAccountFilter, query, payeeByKey, categoryLabelByKey]);
  const operationSummary = useMemo(() => {
    const accounts = transactionAccountFilter ? transactionAccounts.filter((account) => account.key === transactionAccountFilter) : transactionAccounts;
    return {
      title: transactionAccountFilter ? (accountByKey.get(transactionAccountFilter)?.name ?? "Compte") : "Tous les comptes",
      ...sumAccountBalances(accounts, balances),
      currencyAccountKey: accounts[0]?.key ?? 0,
      accounts,
    };
  }, [transactionAccounts, transactionAccountFilter, accountByKey, balances]);
  return { accountByKey, payeeByKey, categoryLabelByKey, activeAccounts, transactionAccounts, transactionAccountFilter, transactions, balances, totals, operationSummary };
}
