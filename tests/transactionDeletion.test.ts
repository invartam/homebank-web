import { describe, expect, it } from "vitest";
import { accountBalance, accountClearedBalance, accountReconciledBalance, parseHomeBankXml, serializeHomeBankXml, type Wallet } from "../src/lib/homebank";
import { commitTransaction, deleteTransaction, newTransaction, transactionDeletionTargets, withTransactionType } from "../src/lib/wallet";
import { sampleWallet } from "./fixtures";

const pair = () => commitTransaction(sampleWallet(), withTransactionType({ ...newTransaction(1), destinationAccountKey: 2 }, "transfer", 25), "");

describe("non-reconciled operation deletion", () => {
  it.each(["none", "cleared", "void"] as const)("deletes a %s operation without touching the input or other data", (status) => {
    const wallet = sampleWallet();
    const operation = { ...wallet.transactions[1], status };
    wallet.transactions[1] = operation;
    const before = structuredClone(wallet);
    const result = deleteTransaction(wallet, operation.id);
    expect(result.transactions).toEqual(wallet.transactions.filter((item) => item.id !== operation.id));
    expect(wallet).toEqual(before);
    expect(result.templates).toBe(wallet.templates);
    expect(result.accounts).toBe(wallet.accounts);
    const roundTrip = parseHomeBankXml(serializeHomeBankXml(result));
    expect(roundTrip.transactions.map(({ id: _id, ...item }) => item)).toEqual(result.transactions.map(({ id: _id, ...item }) => item));
    expect(roundTrip.templates).toEqual(wallet.templates);
    expect(accountReconciledBalance(result, 1)).toBe(accountReconciledBalance(wallet, 1));
    expect(accountBalance(result, 1)).toBe(accountBalance(wallet, 1) + (status === "void" ? 0 : 10));
    expect(accountClearedBalance(result, 1)).toBe(accountClearedBalance(wallet, 1) + (status === "cleared" ? 10 : 0));
  });

  it("deletes a complete unreconciled split without leaving split records or rounding money", () => {
    const wallet = sampleWallet();
    const operation = { ...newTransaction(1), amount: -0.3, splits: [
      { categoryKey: 1, amount: -0.1, memo: "A" }, { categoryKey: 2, amount: -0.2, memo: "B" },
    ] };
    wallet.transactions.push(operation);
    const result = deleteTransaction(wallet, operation.id);
    expect(result.transactions).toHaveLength(wallet.transactions.length - 1);
    expect(parseHomeBankXml(serializeHomeBankXml(result)).transactions).toHaveLength(wallet.transactions.length - 1);
    expect(accountBalance(result, 1)).toBe(accountBalance(sampleWallet(), 1));
  });

  it("rejects reconciled, absent, duplicate-ID and closed/missing-account records atomically", () => {
    const wallet = sampleWallet();
    const transaction = wallet.transactions[1];
    const cases: [Wallet, string][] = [
      [wallet, wallet.transactions[0].id], [wallet, "unknown"],
      [{ ...wallet, transactions: [...wallet.transactions, { ...transaction }] }, transaction.id],
      [{ ...wallet, accounts: wallet.accounts.map((a) => a.key === 1 ? { ...a, flags: 2 } : a) }, transaction.id],
      [{ ...wallet, accounts: wallet.accounts.filter((a) => a.key !== 1) }, transaction.id],
    ];
    for (const [candidate, id] of cases) {
      const before = structuredClone(candidate);
      expect(() => deleteTransaction(candidate, id)).toThrow();
      expect(candidate).toEqual(before);
    }
  });

  it.each([0, 1])("deletes both reciprocal transfer legs from side %s, including different currencies/dates", (side) => {
    const initial = sampleWallet();
    initial.accounts[1].currencyKey = 2;
    initial.currencies.push({ ...initial.currencies[0], key: 2, iso: "USD" });
    const wallet = commitTransaction(initial, { ...withTransactionType({ ...newTransaction(1), destinationAccountKey: 2 }, "transfer", 25), transferAmount: 28 }, "");
    const legs = wallet.transactions.slice(-2);
    legs[1].date += 1; legs[1].status = "cleared";
    expect(transactionDeletionTargets(wallet, legs[side].id)).toHaveLength(2);
    const result = deleteTransaction(wallet, legs[side].id);
    expect(result.transactions).toEqual(initial.transactions);
    expect(accountBalance(result, 1)).toBe(accountBalance(initial, 1));
    expect(accountBalance(result, 2)).toBe(accountBalance(initial, 2));
  });

  it("rejects either reconciled side and every malformed or protected transfer without partial deletion", () => {
    const wallet = pair(); const [debit, credit] = wallet.transactions.slice(-2);
    const variants: Wallet[] = [
      ...[debit.id, credit.id].map((id) => ({ ...wallet, transactions: wallet.transactions.map((item) => item.id === id ? { ...item, status: "reconciled" as const } : item) })),
      { ...wallet, transactions: wallet.transactions.filter((item) => item.id !== credit.id) },
      { ...wallet, transactions: [...wallet.transactions, { ...credit, id: "third-leg" }] },
      { ...wallet, transactions: [...wallet.transactions, { ...wallet.transactions[0], id: credit.id }] },
      { ...wallet, transactions: wallet.transactions.map((item) => item.transferKey ? { ...item, transferKey: 0 } : item) },
      { ...wallet, transactions: wallet.transactions.map((item) => item.id === credit.id ? { ...item, destinationAccountKey: 99 } : item) },
      { ...wallet, transactions: wallet.transactions.map((item) => item.transferKey ? { ...item, accountKey: 1, destinationAccountKey: 1 } : item) },
      { ...wallet, accounts: wallet.accounts.map((a) => a.key === 2 ? { ...a, flags: 2 } : a) },
      { ...wallet, accounts: wallet.accounts.filter((a) => a.key !== 2) },
    ];
    for (const candidate of variants) {
      const before = structuredClone(candidate);
      expect(() => deleteTransaction(candidate, debit.id)).toThrow();
      expect(candidate).toEqual(before);
    }
  });
});
