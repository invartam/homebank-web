import { type Category, type Transaction, type TransactionType, type Wallet, TRANSACTION_FLAGS, isClosedAccount, isoToHbDate, nextKey, upsertTransaction } from "./homebank";

export const transactionTypeLabels: Record<TransactionType, string> = {
  expense: "D\u00e9pense", income: "Revenu", transfer: "Virement interne",
};

export const transactionType = (transaction: Transaction): TransactionType => {
  if ((transaction.flags & TRANSACTION_FLAGS.internalTransfer) !== 0 || transaction.paymode === 5 || transaction.transferKey !== 0 || transaction.destinationAccountKey !== 0) return "transfer";
  return transaction.amount > 0 || (transaction.amount === 0 && (transaction.flags & TRANSACTION_FLAGS.income) !== 0) ? "income" : "expense";
};

export const withTransactionType = (transaction: Transaction, type: TransactionType, magnitude: number, incoming = false): Transaction => {
  const amount = (type === "income" || (type === "transfer" && incoming) ? 1 : -1) * Math.abs(magnitude);
  const flags = (transaction.flags & ~(TRANSACTION_FLAGS.income | TRANSACTION_FLAGS.internalTransfer | TRANSACTION_FLAGS.advancedTransfer))
    | (type === "income" || (type === "transfer" && incoming) ? TRANSACTION_FLAGS.income : 0)
    | (type === "transfer" ? TRANSACTION_FLAGS.internalTransfer : 0);
  return {
    ...transaction, amount, flags,
    paymode: type === "transfer" || transaction.paymode === 5 ? 0 : transaction.paymode,
    destinationAccountKey: type === "transfer" ? transaction.destinationAccountKey : 0,
    transferKey: type === "transfer" ? transaction.transferKey : 0,
    transferAmount: type === "transfer" ? transaction.transferAmount : 0,
  };
};

export const transferCounterpart = (wallet: Wallet, transaction: Transaction) => {
  if (transactionType(transaction) !== "transfer" || transaction.transferKey <= 0) return undefined;
  const linked = wallet.transactions.filter((item) => item.transferKey === transaction.transferKey);
  if (linked.length !== 2) return undefined;
  return linked.find((item) => item.id !== transaction.id && transactionType(item) === "transfer"
    && item.accountKey === transaction.destinationAccountKey && item.destinationAccountKey === transaction.accountKey);
};

export const transactionStructureLocked = (wallet: Wallet, transaction: Transaction) => {
  if (transaction.splits.length > 0) return true;
  if (!wallet.transactions.some((item) => item.id === transaction.id) || transactionType(transaction) !== "transfer") return false;
  const counterpart = transferCounterpart(wallet, transaction);
  return !counterpart || counterpart.splits.length > 0 || !wallet.accounts.some((account) => account.key === counterpart.accountKey && !isClosedAccount(account));
};

export const transferLabel = (wallet: Wallet, transaction: Transaction) => {
  const name = wallet.accounts.find((account) => account.key === transaction.destinationAccountKey)?.name ?? "Compte inconnu";
  return `${transaction.amount > 0 ? "Depuis" : "Vers"} ${name}`;
};

export const paymodeLabels = [
  "Aucun", "Carte credit", "Cheque", "Especes", "Virement", "Interne", "Carte debit",
  "Paiement recurrent", "Paiement electronique", "Depot", "Frais", "Prelevement", "Mobile",
];

export const todayHbDate = (date = new Date()) => isoToHbDate(
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
);

export const newTransaction = (accountKey: number): Transaction => ({
  id: `local-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
  date: todayHbDate(),
  amount: 0,
  accountKey,
  destinationAccountKey: 0,
  transferAmount: 0,
  paymode: 0,
  groupFlag: 0,
  status: "none",
  flags: 0,
  payeeKey: 0,
  categoryKey: 0,
  memo: "",
  number: "",
  tagKeys: [],
  transferKey: 0,
  splits: [],
});

export const categoryPath = (category: Category, categoryByKey: Map<number, Category>) => {
  const names = [category.name];
  const seen = new Set([category.key]);
  let parent = categoryByKey.get(category.parent);
  while (parent && !seen.has(parent.key)) {
    seen.add(parent.key);
    names.unshift(parent.name);
    parent = categoryByKey.get(parent.parent);
  }
  return names.join(":");
};

export const commitTransaction = (wallet: Wallet, transaction: Transaction, input: string): Wallet => {
  if (!Number.isFinite(transaction.amount) || !Number.isInteger(transaction.date) || transaction.date < 1) {
    throw new Error("Date ou montant invalide.");
  }
  const account = wallet.accounts.find((account) => account.key === transaction.accountKey);
  if (!account) {
    throw new Error("Compte introuvable.");
  }
  const original = wallet.transactions.find((item) => item.id === transaction.id);
  const counterpart = original && transferCounterpart(wallet, original);
  const locked = original && transactionStructureLocked(wallet, original);
  if (locked) {
    const structuralKeys = ["date", "amount", "accountKey", "destinationAccountKey", "transferAmount", "paymode", "flags", "categoryKey", "transferKey", "splits"] as const;
    if (structuralKeys.some((key) => JSON.stringify(transaction[key]) !== JSON.stringify(original[key]))) {
      throw new Error("La structure de cette operation ne peut pas etre modifiee.");
    }
  } else if (isClosedAccount(account)) {
    throw new Error("Le compte est desactive.");
  }
  const type = transactionType(transaction);
  const destination = wallet.accounts.find((item) => item.key === transaction.destinationAccountKey);
  if (type === "transfer" && !locked) {
    if (!destination || isClosedAccount(destination) || destination.key === account.key) {
      throw new Error("Choisis deux comptes actifs differents pour le virement.");
    }
    if (transaction.splits.length || !transaction.amount) throw new Error("Montant de virement invalide.");
    if (destination.currencyKey !== account.currencyKey && (!Number.isFinite(transaction.transferAmount) || transaction.transferAmount === 0 || Math.sign(transaction.transferAmount) === Math.sign(transaction.amount))) {
      throw new Error("Montant du compte lie invalide.");
    }
  }
  const name = input.trim();
  let payeeKey = 0;
  if (name) {
    const existing = wallet.payees.find((payee) => payee.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"));
    payeeKey = existing?.key ?? nextKey(wallet.payees);
    if (!existing) {
      wallet = { ...wallet, payees: [...wallet.payees, { key: payeeKey, flags: 0, name, categoryKey: 0, paymode: 0, notes: "" }] };
    }
  }
  if (locked) return setTransactionStatus(upsertTransaction(wallet, { ...transaction, payeeKey }), transaction.id, transaction.status);
  if (type !== "transfer") {
    const flags = (transaction.flags & ~(TRANSACTION_FLAGS.income | TRANSACTION_FLAGS.internalTransfer | TRANSACTION_FLAGS.advancedTransfer))
      | (type === "income" ? TRANSACTION_FLAGS.income : 0);
    const result = upsertTransaction(wallet, { ...transaction, flags, payeeKey, destinationAccountKey: 0, transferKey: 0, transferAmount: 0 });
    return counterpart ? { ...result, transactions: result.transactions.filter((item) => item.id !== counterpart.id) } : result;
  }

  const target = destination!;
  const differentCurrency = account.currencyKey !== target.currencyKey;
  const transferKey = counterpart ? original!.transferKey : wallet.transactions.reduce((max, item) => Math.max(max, item.transferKey), 0) + 1;
  if (!Number.isSafeInteger(transferKey) || transferKey > 0xffffffff) throw new Error("Cle de virement invalide.");
  const flags = (transaction.flags & ~(TRANSACTION_FLAGS.income | TRANSACTION_FLAGS.advancedTransfer))
    | TRANSACTION_FLAGS.internalTransfer | (transaction.amount > 0 ? TRANSACTION_FLAGS.income : 0)
    | (differentCurrency ? TRANSACTION_FLAGS.advancedTransfer : 0);
  const saved = { ...transaction, payeeKey, flags, transferKey, paymode: 0, transferAmount: differentCurrency ? transaction.transferAmount : 0 };
  const linkedAmount = differentCurrency ? saved.transferAmount : -saved.amount;
  const linked = {
    ...(counterpart ?? newTransaction(target.key)),
    accountKey: target.key, destinationAccountKey: account.key, transferKey, paymode: 0,
    amount: linkedAmount, transferAmount: differentCurrency ? saved.amount : 0,
    date: !counterpart || !original || original.date !== saved.date ? saved.date : counterpart.date,
    status: saved.status === "void" ? "void" as const : counterpart?.status === "void" ? saved.status : (counterpart?.status ?? "none"),
    flags: ((counterpart?.flags ?? saved.flags) & ~(TRANSACTION_FLAGS.income | TRANSACTION_FLAGS.advancedTransfer))
      | TRANSACTION_FLAGS.internalTransfer | (linkedAmount > 0 ? TRANSACTION_FLAGS.income : 0)
      | (differentCurrency ? TRANSACTION_FLAGS.advancedTransfer : 0),
    payeeKey, categoryKey: saved.categoryKey, memo: saved.memo, number: saved.number, tagKeys: [...saved.tagKeys],
  };
  return upsertTransaction(upsertTransaction(wallet, saved), linked);
};

export const setTransactionStatus = (wallet: Wallet, id: string, status: Transaction["status"]): Wallet => {
  const transaction = wallet.transactions.find((item) => item.id === id);
  if (!transaction) throw new Error("Operation introuvable.");
  const result = upsertTransaction(wallet, { ...transaction, status });
  const counterpart = transferCounterpart(wallet, transaction);
  return status === "void" && counterpart ? upsertTransaction(result, { ...counterpart, status }) : result;
};

export const recentTransactions = (transactions: Transaction[], accountKeys: Set<number>, today = todayHbDate()) => {
  const active = transactions.filter((txn) => accountKeys.has(txn.accountKey) && txn.status !== "void");
  return {
    past: active.filter((txn) => txn.date <= today).sort((a, b) => b.date - a.date).slice(0, 5),
    future: active.filter((txn) => txn.date > today).sort((a, b) => a.date - b.date).slice(0, 5),
  };
};
