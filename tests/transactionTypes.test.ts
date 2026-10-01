import { describe, expect, it } from "vitest";
import { TRANSACTION_FLAGS, accountBalance, parseHomeBankXml, serializeHomeBankXml } from "../src/lib/homebank";
import { commitTransaction, newTransaction, setTransactionStatus, transactionStructureLocked, transactionType, transferCounterpart, withTransactionType } from "../src/lib/wallet";
import { sampleWallet } from "./fixtures";

const transfer = () => withTransactionType({ ...newTransaction(1), destinationAccountKey: 2, memo: "Epargne mensuelle", number: "REF-1" }, "transfer", 25);

describe("HomeBank operation types", () => {
  it("normalizes expense and income signs and preserves unrelated flags", () => {
    const draft = { ...newTransaction(1), flags: 1 << 5, destinationAccountKey: 2, transferKey: 10, paymode: 5 };
    const expense = withTransactionType(draft, "expense", -12.34);
    const income = withTransactionType(draft, "income", -12.34);
    expect(expense).toMatchObject({ amount: -12.34, flags: 32, transferKey: 0, destinationAccountKey: 0, paymode: 0 });
    expect(income).toMatchObject({ amount: 12.34, flags: 34 });
    expect(transactionType(income)).toBe("income");
    expect(transactionType(expense)).toBe("expense");
    expect(transactionType({ ...expense, amount: 10 })).toBe("income");
    expect(transactionType({ ...expense, paymode: 5 })).toBe("transfer");
    expect(transactionType({ ...expense, flags: TRANSACTION_FLAGS.internalTransfer })).toBe("transfer");
    expect(commitTransaction(sampleWallet(), income, "Salaire").transactions.at(-1)).toMatchObject({ amount: 12.34, flags: 34 });
  });

  it("creates a reciprocal pair atomically, with opposite amounts and independent statuses", () => {
    const original = sampleWallet();
    const wallet = commitTransaction(original, { ...transfer(), status: "reconciled" }, "");
    const debit = wallet.transactions.at(-2)!;
    const credit = wallet.transactions.at(-1)!;
    expect(wallet.transactions).toHaveLength(original.transactions.length + 2);
    expect(debit).toMatchObject({ accountKey: 1, destinationAccountKey: 2, amount: -25, flags: 8, paymode: 0, transferKey: 1, status: "reconciled" });
    expect(credit).toMatchObject({ accountKey: 2, destinationAccountKey: 1, amount: 25, flags: 10, paymode: 0, transferKey: 1, status: "none", memo: debit.memo, number: debit.number });
    expect(credit.id).not.toBe(debit.id);
    expect(transferCounterpart(wallet, debit)).toBe(credit);
    expect(accountBalance(wallet, 1)).toBe(accountBalance(original, 1) - 25);
    expect(accountBalance(wallet, 2)).toBe(accountBalance(original, 2) + 25);
    expect(original.transactions).toHaveLength(5);
    const next = commitTransaction(wallet, transfer(), "");
    expect(next.transactions.at(-1)?.transferKey).toBe(2);
  });

  it("edits the credit side without duplicates and preserves the counterpart status and date", () => {
    let wallet = commitTransaction(sampleWallet(), transfer(), "");
    let debit = wallet.transactions.at(-2)!;
    const credit = wallet.transactions.at(-1)!;
    wallet = setTransactionStatus(wallet, debit.id, "reconciled");
    wallet = { ...wallet, transactions: wallet.transactions.map((item) => item.id === debit.id ? { ...item, date: credit.date - 1 } : item) };
    wallet = commitTransaction(wallet, { ...credit, amount: 60, memo: "Modifie", number: "REF-2", status: "cleared" }, "");
    debit = wallet.transactions.find((item) => item.id === debit.id)!;
    expect(wallet.transactions).toHaveLength(7);
    expect(debit).toMatchObject({ amount: -60, memo: "Modifie", number: "REF-2", date: credit.date - 1, status: "reconciled" });
    const savedCredit = wallet.transactions.find((item) => item.id === credit.id)!;
    wallet = commitTransaction(wallet, { ...savedCredit, date: credit.date + 3 }, "");
    expect(wallet.transactions.filter((item) => item.transferKey === credit.transferKey).map((item) => item.date)).toEqual([credit.date + 3, credit.date + 3]);
  });

  it("moves accounts reciprocally and removes the counterpart when converting back to income", () => {
    const initial = sampleWallet();
    initial.accounts.push({ ...initial.accounts[0], key: 4, name: "Autre banque" });
    let wallet = commitTransaction(initial, transfer(), "");
    const debit = wallet.transactions.at(-2)!;
    const credit = wallet.transactions.at(-1)!;
    wallet = commitTransaction(wallet, { ...debit, accountKey: 4 }, "");
    expect(wallet.transactions.find((item) => item.id === credit.id)?.destinationAccountKey).toBe(4);
    wallet = commitTransaction(wallet, withTransactionType(wallet.transactions.find((item) => item.id === credit.id)!, "income", 30), "Tiers");
    expect(wallet.transactions).toHaveLength(6);
    expect(wallet.transactions.some((item) => item.id === debit.id)).toBe(false);
    expect(wallet.transactions.at(-1)).toMatchObject({ flags: 2, transferKey: 0, destinationAccountKey: 0, amount: 30 });
  });

  it("converts a simple operation to a transfer without duplicating its original side", () => {
    const wallet = sampleWallet();
    const operation = wallet.transactions[0];
    const result = commitTransaction(wallet, withTransactionType({ ...operation, destinationAccountKey: 2 }, "transfer", 20), "");
    expect(result.transactions).toHaveLength(6);
    expect(result.transactions.filter((item) => item.id === operation.id)).toHaveLength(1);
    expect(result.transactions.at(-1)).toMatchObject({ amount: 20, date: operation.date, status: "none" });
  });

  it("supports explicit amounts in different currencies and round-trips the HomeBank link", () => {
    const wallet = sampleWallet();
    wallet.accounts[1].currencyKey = 2;
    wallet.currencies.push({ ...wallet.currencies[0], key: 2, iso: "USD" });
    let result = commitTransaction(wallet, { ...transfer(), transferAmount: 28 }, "");
    expect(result.transactions.at(-2)).toMatchObject({ amount: -25, transferAmount: 28, flags: 24 });
    expect(result.transactions.at(-1)).toMatchObject({ amount: 28, transferAmount: -25, flags: 26 });
    result = parseHomeBankXml(serializeHomeBankXml(result));
    const credit = result.transactions.at(-1)!;
    expect(transferCounterpart(result, credit)).toMatchObject({ amount: -25, transferAmount: 28, flags: 24 });
    result = commitTransaction(result, { ...credit, amount: 40, transferAmount: -35 }, "");
    expect(result.transactions.at(-2)).toMatchObject({ amount: -35, transferAmount: 40 });
  });

  it("rejects invalid destinations, currencies and amounts without modifying the wallet", () => {
    const wallet = sampleWallet();
    for (const destinationAccountKey of [0, 1, 3, 99]) {
      expect(() => commitTransaction(wallet, { ...transfer(), destinationAccountKey }, "Nouveau" )).toThrow();
    }
    expect(() => commitTransaction(wallet, { ...transfer(), amount: 0 }, "")).toThrow();
    expect(() => commitTransaction(wallet, { ...transfer(), amount: Infinity }, "")).toThrow();
    expect(() => commitTransaction(wallet, { ...transfer(), accountKey: 3 }, "")).toThrow();
    wallet.accounts[1].currencyKey = 2;
    for (const transferAmount of [0, NaN, Infinity, -28]) {
      expect(() => commitTransaction(wallet, { ...transfer(), transferAmount }, "")).toThrow();
    }
    expect(wallet.transactions).toHaveLength(5);
    expect(wallet.payees).toHaveLength(1);
  });

  it("keeps pointing independent but voids both sides and restores both when edited", () => {
    let wallet = commitTransaction(sampleWallet(), transfer(), "");
    const debit = wallet.transactions.at(-2)!;
    const credit = wallet.transactions.at(-1)!;
    wallet = setTransactionStatus(wallet, credit.id, "reconciled");
    expect(wallet.transactions.at(-2)?.status).toBe("none");
    wallet = setTransactionStatus(wallet, debit.id, "void");
    expect(wallet.transactions.slice(-2).map((item) => item.status)).toEqual(["void", "void"]);
    wallet = commitTransaction(wallet, { ...wallet.transactions.at(-2)!, status: "none" }, "");
    expect(wallet.transactions.slice(-2).map((item) => item.status)).toEqual(["none", "none"]);
  });

  it("protects split, orphan and ambiguous imported structures", () => {
    let wallet = commitTransaction(sampleWallet(), transfer(), "");
    const debit = wallet.transactions.at(-2)!;
    const credit = wallet.transactions.at(-1)!;
    const orphan = { ...wallet, transactions: wallet.transactions.filter((item) => item.id !== credit.id) };
    expect(transactionStructureLocked(orphan, debit)).toBe(true);
    expect(() => commitTransaction(orphan, { ...debit, amount: -30 }, "")).toThrow();
    expect(commitTransaction(orphan, { ...debit, memo: "Memo seul" }, "").transactions.at(-1)?.memo).toBe("Memo seul");
    wallet = { ...wallet, transactions: [...wallet.transactions, { ...credit, id: "duplicate" }] };
    expect(transactionStructureLocked(wallet, debit)).toBe(true);
    expect(() => commitTransaction(wallet, withTransactionType(debit, "expense", 25), "")).toThrow();
    const split = { ...newTransaction(1), amount: -25, splits: [{ categoryKey: 1, amount: -25, memo: "" }] };
    const splitWallet = { ...sampleWallet(), transactions: [split] };
    expect(transactionStructureLocked(splitWallet, split)).toBe(true);
    expect(() => commitTransaction(splitWallet, withTransactionType(split, "income", 25), "")).toThrow();
  });
});
