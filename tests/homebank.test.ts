import { describe, expect, it } from "vitest";
import { accountBalance, accountClearedBalance, accountReconciledBalance, balanceTone, balancesByAccount, formatHbDateFr, hbDateToIso, isoToHbDate, parseHomeBankXml, serializeHomeBankXml, sumAccountBalances, visibleAccounts } from "../src/lib/homebank";
import { categoryPath, commitTransaction, newTransaction, recentTransactions, todayHbDate } from "../src/lib/wallet";
import { sampleWallet, sampleXml } from "./fixtures";

describe("HomeBank data", () => {
  it("keeps balances consistent with statuses, initial amounts and closed accounts", () => {
    const wallet = sampleWallet();
    const balances = balancesByAccount(wallet);
    expect(balances.get(1)).toEqual({ reconciled: 80, cleared: 70, future: 65 });
    expect(sumAccountBalances(visibleAccounts(wallet), balances)).toEqual({ reconciled: 320, cleared: 310, future: 305 });
    for (const account of wallet.accounts) {
      expect(balances.get(account.key)).toEqual({
        reconciled: accountReconciledBalance(wallet, account.key),
        cleared: accountClearedBalance(wallet, account.key),
        future: accountBalance(wallet, account.key),
      });
    }
  });

  it("uses the overdraft boundary for balance colors", () => {
    const account = sampleWallet().accounts[0];
    expect([1, 0, -20, -50, -51].map((amount) => balanceTone(account, amount)))
      .toEqual(["positive", "warning", "warning", "warning", "danger"]);
  });

  it("uses local calendar days near midnight and preserves French dates", () => {
    expect(todayHbDate(new Date(2026, 9, 1, 0, 30))).toBe(isoToHbDate("2026-10-01"));
    expect(hbDateToIso(isoToHbDate("2024-02-29"))).toBe("2024-02-29");
    expect(formatHbDateFr(isoToHbDate("2026-10-01"))).toBe("01/10/2026");
  });

  it("keeps empty split memos aligned and preserves line breaks in XML", () => {
    const wallet = parseHomeBankXml(sampleXml.replace("</homebank>", '<ope account="1" date="739891" amount="-6" scat="1||2||1" samt="-1||-2||-3" smem="||milieu||" wording="ligne&#10;suivante"/></homebank>'));
    expect(wallet.transactions.at(-1)?.splits.map((split) => split.memo)).toEqual(["", "milieu", ""]);
    const restored = parseHomeBankXml(serializeHomeBankXml(wallet));
    expect(restored.transactions.at(-1)?.memo).toBe("ligne\nsuivante");
    expect(restored.transactions.at(-1)?.splits).toEqual(wallet.transactions.at(-1)?.splits);
    expect(restored.templates).toEqual(wallet.templates);
    expect(restored.accounts).toEqual(wallet.accounts);
  });

  it("rejects invalid XML", () => {
    expect(() => parseHomeBankXml("<homebank>")).toThrow();
    expect(() => parseHomeBankXml("<other/>")).toThrow();
    expect(() => parseHomeBankXml('<homebank><ope amount="NaN"/></homebank>')).toThrow();
    expect(() => parseHomeBankXml('<homebank><account key="1junk"/></homebank>')).toThrow();
    expect(() => parseHomeBankXml('<other><homebank/></other>')).toThrow();
  });

  it("preserves tags even when their definitions follow operations", () => {
    const wallet = parseHomeBankXml('<homebank><ope account="1" tags="apres"/><tag key="5" name="apres"/></homebank>');
    expect(wallet.transactions[0].tagKeys).toEqual([5]);
    expect(parseHomeBankXml(serializeHomeBankXml(wallet)).transactions[0].tagKeys).toEqual([5]);
  });

  it("keeps the five closest past and future operations, excluding void and closed accounts", () => {
    const txn = sampleWallet().transactions[0];
    const operations = Array.from({ length: 20 }, (_, index) => ({ ...txn, id: String(index), date: 100 + index }));
    operations.push({ ...txn, id: "void", date: 110, status: "void" }, { ...txn, id: "closed", date: 110, accountKey: 3 });
    const recent = recentTransactions(operations, new Set([1]), 110);
    expect(recent.past.map((item) => item.date)).toEqual([110, 109, 108, 107, 106]);
    expect(recent.future.map((item) => item.date)).toEqual([111, 112, 113, 114, 115]);
    expect(operations).toHaveLength(22);
  });

  it("keeps tier, payment number and memo independent", () => {
    const wallet = sampleWallet();
    const txn = { ...newTransaction(1), number: "456", memo: "Memo" };
    const committed = commitTransaction(wallet, txn, " Tiers Existant ");
    expect(committed.transactions.at(-1)).toMatchObject({ number: "456", memo: "Memo", payeeKey: 1 });
    expect(committed.payees).toHaveLength(1);
    expect(commitTransaction(committed, txn, "").transactions.at(-1)?.payeeKey).toBe(0);
    expect(commitTransaction(wallet, txn, "Nouveau tiers").payees).toHaveLength(2);
    expect(wallet.payees).toHaveLength(1);
    expect(() => commitTransaction(wallet, { ...txn, amount: NaN }, "")).toThrow();
  });

  it("builds category paths and tolerates parent cycles", () => {
    const wallet = sampleWallet();
    const map = new Map(wallet.categories.map((category) => [category.key, category]));
    expect(categoryPath(wallet.categories[1], map)).toBe("Maison:Courses");
    map.set(1, { ...wallet.categories[0], parent: 2 });
    expect(categoryPath(wallet.categories[1], map)).toBe("Maison:Courses");
  });
});
