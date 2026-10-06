import { type Account, type RawNode, type Tag, type Transaction, type TransactionSplit, type TransactionStatus, type Wallet, ACCOUNT_FLAGS, ACCOUNT_TYPES, emptyWallet } from "./models";
export * from "./models";
import { validateWalletSize } from "./fileLimits";

export class HomeBankImportError extends Error {}

const statusByValue: Record<number, TransactionStatus> = {
  0: "none",
  1: "cleared",
  2: "reconciled",
  3: "void",
};

const statusToValue: Record<TransactionStatus, number> = {
  none: 0,
  cleared: 1,
  reconciled: 2,
  void: 3,
};

const intAttr = (element: Element, name: string, fallback = 0) => {
  const value = element.getAttribute(name);
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HomeBankImportError(`Attribut ${name} invalide dans <${element.tagName}>.`);
  return parsed;
};

const floatAttr = (element: Element, name: string, fallback = 0) => {
  const value = element.getAttribute(name);
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HomeBankImportError(`Attribut ${name} invalide dans <${element.tagName}>.`);
  return parsed;
};

const textAttr = (element: Element, name: string, fallback = "") => {
  const value = element.getAttribute(name);
  return value === null || value === "(null)" ? fallback : value;
};

const attrs = (element: Element): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    result[attr.name] = attr.value;
  }
  return result;
};

const parseTagKeys = (value: string, tags: Tag[]) =>
  value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => tags.find((tag) => tag.name === name)?.key ?? 0)
    .filter((key) => key > 0);

const parseSplits = (element: Element): TransactionSplit[] => {
  if (!textAttr(element, "scat") && !textAttr(element, "samt")) return [];
  const categories = textAttr(element, "scat").split("||");
  const amounts = textAttr(element, "samt").split("||");
  const memos = textAttr(element, "smem").split("||");
  if (categories.length !== amounts.length || (element.hasAttribute("smem") && memos.length !== categories.length)) {
    throw new HomeBankImportError("Ventilation XML incoherente.");
  }
  return categories.map((category, index) => {
    const categoryKey = Number(category);
    const amount = Number(amounts[index]);
    if (!category.trim() || !Number.isSafeInteger(categoryKey) || categoryKey < 0
      || !amounts[index].trim() || !Number.isFinite(amount)) throw new HomeBankImportError("Ventilation XML invalide.");
    return { categoryKey, amount, memo: memos[index] ?? "" };
  });
};

export const parseHomeBankXml = (xml: string, sourceFileName?: string): Wallet => {
  validateWalletSize(xml.length);
  validateWalletSize(new TextEncoder().encode(xml).byteLength);
  if (/<!DOCTYPE/i.test(xml)) throw new HomeBankImportError("Les declarations DTD ne sont pas prises en charge dans les fichiers HomeBank.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) {
    throw new HomeBankImportError("Fichier XML invalide.");
  }

  const root = doc.documentElement;
  if (root.tagName !== "homebank") {
    throw new HomeBankImportError("Le fichier ne contient pas de racine <homebank>.");
  }
  if (root.hasAttribute("v")) {
    const rawVersion = (root.getAttribute("v") ?? "").trim();
    const version = Number(rawVersion);
    // hb-xml.c uses g_ascii_dtostr/g_ascii_strtod: v is a double, not a major.minor pair.
    if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(rawVersion) || !Number.isFinite(version) || version <= 0) {
      throw new HomeBankImportError("Version du fichier HomeBank invalide.");
    }
    if (version > 1.6) {
      throw new HomeBankImportError("Version HomeBank non prise en charge (format maximal : 1.6). Le fichier n'a pas ete modifie.");
    }
  }

  const wallet = emptyWallet();
  wallet.sourceFileName = sourceFileName;
  wallet.fileVersion = root.getAttribute("v") ?? wallet.fileVersion;
  wallet.appVersion = root.getAttribute("d") ?? wallet.appVersion;
  wallet.currencies = [];
  wallet.tags = Array.from(root.children)
    .filter((child) => child.tagName === "tag")
    .map((child) => ({ key: intAttr(child, "key"), name: textAttr(child, "name") }));

  for (const child of Array.from(root.children)) {
    switch (child.tagName) {
      case "properties":
        wallet.owner = textAttr(child, "title");
        wallet.baseCurrencyKey = intAttr(child, "curr", wallet.baseCurrencyKey);
        wallet.vehicleCategoryKey = intAttr(child, "car_category");
        wallet.autoPostMode = intAttr(child, "auto_smode");
        wallet.autoWeekday = intAttr(child, "auto_weekday");
        wallet.autoMonths = intAttr(child, "auto_nbmonths");
        wallet.autoDays = intAttr(child, "auto_nbdays");
        wallet.earnByHour = floatAttr(child, "earnbyh");
        break;
      case "cur":
        if ((textAttr(child, "iso") && !/^[A-Za-z]{3}$/.test(textAttr(child, "iso")))
          || intAttr(child, "frac", 2) < 0 || intAttr(child, "frac", 2) > 20) throw new HomeBankImportError("Devise XML invalide.");
        wallet.currencies.push({
          key: intAttr(child, "key"),
          flags: intAttr(child, "flags"),
          iso: textAttr(child, "iso"),
          name: textAttr(child, "name"),
          symbol: textAttr(child, "symb"),
          symbolPrefix: intAttr(child, "syprf"),
          decimalChar: textAttr(child, "dchar", "."),
          groupingChar: textAttr(child, "gchar", ","),
          fractionDigits: intAttr(child, "frac", 2),
          rate: floatAttr(child, "rate", 1),
          modifiedDate: intAttr(child, "mdate"),
        });
        break;
      case "grp":
        wallet.groups.push({ key: intAttr(child, "key"), name: textAttr(child, "name") });
        break;
      case "account":
        wallet.accounts.push({
          key: intAttr(child, "key"),
          flags: intAttr(child, "flags"),
          position: intAttr(child, "pos"),
          type: intAttr(child, "type"),
          currencyKey: intAttr(child, "curr", wallet.baseCurrencyKey),
          name: textAttr(child, "name", "Compte"),
          number: textAttr(child, "number"),
          bankName: textAttr(child, "bankname"),
          groupKey: intAttr(child, "grp"),
          initial: floatAttr(child, "initial"),
          minimum: floatAttr(child, "minimum"),
          maximum: floatAttr(child, "maximum"),
          cheque1: intAttr(child, "cheque1"),
          cheque2: intAttr(child, "cheque2"),
          website: textAttr(child, "website"),
          notes: textAttr(child, "notes"),
          templateKey: intAttr(child, "tpl"),
          creditCardCloseDay: intAttr(child, "ccday"),
          reconciledDate: intAttr(child, "rdate"),
        });
        break;
      case "pay":
        wallet.payees.push({
          key: intAttr(child, "key"),
          flags: intAttr(child, "flags"),
          name: textAttr(child, "name"),
          categoryKey: intAttr(child, "category"),
          paymode: intAttr(child, "paymode"),
          notes: textAttr(child, "notes"),
        });
        break;
      case "cat":
        wallet.categories.push({
          key: intAttr(child, "key"),
          parent: intAttr(child, "parent"),
          flags: intAttr(child, "flags"),
          name: textAttr(child, "name"),
          budget: Array.from({ length: 13 }, (_, index) => floatAttr(child, `b${index}`)),
        });
        break;
      case "tag":
        break;
      case "asg":
        wallet.assignments.push({ name: "asg", attributes: attrs(child) });
        break;
      case "fav":
        wallet.templates.push({ name: "fav", attributes: attrs(child) });
        break;
      case "ope": {
        if (child.hasAttribute("date") && (intAttr(child, "date") < 1 || intAttr(child, "date") > 3652059)) throw new HomeBankImportError("Date XML invalide.");
        if (child.hasAttribute("st") && !Object.hasOwn(statusByValue, intAttr(child, "st"))) throw new HomeBankImportError("Statut XML non pris en charge.");
        const index = wallet.transactions.length + 1;
        wallet.transactions.push({
          id: `txn-${Date.now()}-${index}`,
          date: intAttr(child, "date"),
          amount: floatAttr(child, "amount"),
          accountKey: intAttr(child, "account"),
          destinationAccountKey: intAttr(child, "dst_account"),
          transferAmount: floatAttr(child, "damt"),
          paymode: intAttr(child, "paymode"),
          groupFlag: intAttr(child, "grpflg"),
          status: statusByValue[intAttr(child, "st")] ?? "none",
          flags: intAttr(child, "flags"),
          payeeKey: intAttr(child, "payee"),
          categoryKey: intAttr(child, "category"),
          memo: textAttr(child, "wording"),
          number: textAttr(child, "info"),
          tagKeys: parseTagKeys(textAttr(child, "tags"), wallet.tags),
          transferKey: intAttr(child, "kxfer"),
          splits: parseSplits(child),
        });
        break;
      }
      case "flt":
        wallet.filters.push({ name: "flt", attributes: attrs(child) });
        break;
    }
  }

  if (wallet.currencies.length > 1) {
    wallet.currencies = wallet.currencies.filter(
      (currency, index, all) => all.findIndex((item) => item.key === currency.key) === index,
    );
  }

  return wallet;
};

const xmlEscape = (value: string | number | undefined) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\t", "&#9;");

const attr = (name: string, value: string | number | undefined) => ` ${name}="${xmlEscape(value)}"`;

const rawNode = (node: RawNode) => {
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => attr(name, value))
    .join("");
  return `<${node.name}${attributes}/>`;
};

export const serializeHomeBankXml = (wallet: Wallet) => {
  const tagNames = new Map(wallet.tags.map((tag) => [tag.key, tag.name]));
  const lines = [
    '<?xml version="1.0"?>',
    `<homebank${attr("v", wallet.fileVersion)}${attr("d", wallet.appVersion)}>`,
    `<properties${attr("title", wallet.owner)}${attr("curr", wallet.baseCurrencyKey)}${attr(
      "car_category",
      wallet.vehicleCategoryKey,
    )}${attr("auto_smode", wallet.autoPostMode)}${attr("auto_weekday", wallet.autoWeekday)}${attr(
      "auto_nbmonths",
      wallet.autoMonths,
    )}${attr("auto_nbdays", wallet.autoDays)}${attr("earnbyh", wallet.earnByHour)}/>`,
    ...wallet.currencies.map(
      (cur) =>
        `<cur${attr("key", cur.key)}${attr("flags", cur.flags)}${attr("iso", cur.iso)}${attr(
          "name",
          cur.name,
        )}${attr("symb", cur.symbol)}${attr("syprf", cur.symbolPrefix)}${attr(
          "dchar",
          cur.decimalChar,
        )}${attr("gchar", cur.groupingChar)}${attr("frac", cur.fractionDigits)}${attr(
          "rate",
          cur.rate,
        )}${attr("mdate", cur.modifiedDate)}/>`,
    ),
    ...wallet.groups.map((group) => `<grp${attr("key", group.key)}${attr("name", group.name)}/>`),
    ...wallet.accounts.map(
      (account) =>
        `<account${attr("key", account.key)}${attr("flags", account.flags)}${attr(
          "pos",
          account.position,
        )}${attr("type", account.type)}${attr("curr", account.currencyKey)}${attr(
          "name",
          account.name,
        )}${attr("number", account.number)}${attr("bankname", account.bankName)}${attr(
          "initial",
          account.initial,
        )}${attr("minimum", account.minimum)}${attr("maximum", account.maximum)}${attr(
          "cheque1",
          account.cheque1,
        )}${attr("cheque2", account.cheque2)}${attr("website", account.website)}${attr(
          "notes",
          account.notes,
        )}${attr("tpl", account.templateKey)}${attr("grp", account.groupKey)}${attr(
          "ccday",
          account.creditCardCloseDay,
        )}${attr("rdate", account.reconciledDate)}/>`,
    ),
    ...wallet.payees.map(
      (payee) =>
        `<pay${attr("key", payee.key)}${attr("flags", payee.flags)}${attr(
          "name",
          payee.name,
        )}${attr("category", payee.categoryKey)}${attr("paymode", payee.paymode)}${attr(
          "notes",
          payee.notes,
        )}/>`,
    ),
    ...wallet.categories.map((category) => {
      const budgets = category.budget
        .map((amount, index) => (amount ? attr(`b${index}`, amount) : ""))
        .join("");
      return `<cat${attr("key", category.key)}${attr("parent", category.parent)}${attr(
        "flags",
        category.flags,
      )}${attr("name", category.name)}${budgets}/>`;
    }),
    ...wallet.tags.map((tag) => `<tag${attr("key", tag.key)}${attr("name", tag.name)}/>`),
    ...wallet.assignments.map(rawNode),
    ...wallet.templates.map(rawNode),
    ...wallet.transactions.map((txn) => {
      const splitAttrs =
        txn.splits.length === 0
          ? ""
          : `${attr("scat", txn.splits.map((split) => split.categoryKey).join("||"))}${attr(
              "samt",
              txn.splits.map((split) => split.amount).join("||"),
            )}${attr("smem", txn.splits.map((split) => split.memo).join("||"))}`;
      const transferAmount = txn.transferAmount ? attr("damt", txn.transferAmount) : "";
      return `<ope${attr("date", txn.date)}${attr("amount", txn.amount)}${attr(
        "account",
        txn.accountKey,
      )}${transferAmount}${attr("dst_account", txn.destinationAccountKey)}${attr(
        "paymode",
        txn.paymode,
      )}${attr("grpflg", txn.groupFlag)}${attr("st", statusToValue[txn.status])}${attr(
        "flags",
        txn.flags,
      )}${attr("payee", txn.payeeKey)}${attr("category", txn.categoryKey)}${attr(
        "wording",
        txn.memo,
      )}${attr("info", txn.number)}${attr(
        "tags",
        txn.tagKeys.map((key) => tagNames.get(key)).filter(Boolean).join(" "),
      )}${attr(
        "kxfer",
        txn.transferKey,
      )}${splitAttrs}/>`;
    }),
    ...wallet.filters.map(rawNode),
    "</homebank>",
  ];

  return `${lines.join("\n")}\n`;
};

export const hbDateToIso = (hbDate: number) => {
  const unixDays = hbDate - 719163;
  return new Date(unixDays * 86400000).toISOString().slice(0, 10);
};

export const formatHbDateFr = (hbDate: number, options: Intl.DateTimeFormatOptions = {}) => {
  const date = new Date(`${hbDateToIso(hbDate)}T00:00:00`);
  const settings: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...options,
  };
  const key = JSON.stringify(settings);
  let formatter = dateFormats.get(key);
  if (!formatter) {
    if (dateFormats.size >= 32) dateFormats.clear();
    formatter = new Intl.DateTimeFormat("fr-FR", settings);
    dateFormats.set(key, formatter);
  }
  return formatter.format(date);
};
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const amountFormats = new Map<string, Intl.NumberFormat>();

export const isoToHbDate = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return NaN;
  return Math.floor(date.getTime() / 86400000) + 719163;
};

export const currencyForAccount = (wallet: Wallet, accountKey: number) => {
  const account = wallet.accounts.find((item) => item.key === accountKey);
  return (
    wallet.currencies.find((item) => item.key === account?.currencyKey) ??
    wallet.currencies.find((item) => item.key === wallet.baseCurrencyKey) ??
    wallet.currencies[0]
  );
};

export const formatAmount = (wallet: Wallet, accountKey: number, amount: number) => {
  const currency = currencyForAccount(wallet, accountKey);
  const settings: Intl.NumberFormatOptions = {
    style: "currency",
    currency: currency?.iso || "EUR",
    minimumFractionDigits: currency?.fractionDigits ?? 2,
    maximumFractionDigits: currency?.fractionDigits ?? 2,
  };
  const key = JSON.stringify(settings);
  let formatter = amountFormats.get(key);
  if (!formatter) {
    if (amountFormats.size >= 32) amountFormats.clear();
    formatter = new Intl.NumberFormat("fr-FR", settings);
    amountFormats.set(key, formatter);
  }
  return formatter.format(amount);
};

export type BalanceTone = "positive" | "warning" | "danger";

export const overdraftLimit = (account: Account) => {
  if (account.minimum === 0) {
    return 0;
  }

  return account.minimum < 0 ? account.minimum : -Math.abs(account.minimum);
};

export const balanceTone = (account: Account | undefined, balance: number): BalanceTone => {
  if (balance > 0) {
    return "positive";
  }

  const limit = account ? overdraftLimit(account) : 0;
  return balance >= limit ? "warning" : "danger";
};

export const aggregateBalanceTone = (accounts: Account[], balance: number): BalanceTone => {
  if (balance > 0) {
    return "positive";
  }

  const limit = accounts.reduce((sum, account) => sum + overdraftLimit(account), 0);
  return balance >= limit ? "warning" : "danger";
};

export const accountBalance = (wallet: Wallet, accountKey: number) =>
  wallet.transactions
    .filter((txn) => txn.accountKey === accountKey && txn.status !== "void")
    .reduce((sum, txn) => sum + txn.amount, wallet.accounts.find((acc) => acc.key === accountKey)?.initial ?? 0);

export const accountReconciledBalance = (wallet: Wallet, accountKey: number) =>
  wallet.transactions
    .filter((txn) => txn.accountKey === accountKey && txn.status === "reconciled")
    .reduce((sum, txn) => sum + txn.amount, wallet.accounts.find((acc) => acc.key === accountKey)?.initial ?? 0);

export const accountClearedBalance = (wallet: Wallet, accountKey: number) =>
  wallet.transactions
    .filter((txn) => txn.accountKey === accountKey && (txn.status === "cleared" || txn.status === "reconciled"))
    .reduce((sum, txn) => sum + txn.amount, wallet.accounts.find((acc) => acc.key === accountKey)?.initial ?? 0);

export interface AccountBalances {
  reconciled: number;
  cleared: number;
  future: number;
}

export const balancesByAccount = (wallet: Wallet) => {
  const balances = new Map<number, AccountBalances>(wallet.accounts.map((account) => [account.key, {
    reconciled: account.initial, cleared: account.initial, future: account.initial,
  }]));
  for (const txn of wallet.transactions) {
    const balance = balances.get(txn.accountKey);
    if (!balance || txn.status === "void") continue;
    balance.future += txn.amount;
    if (txn.status === "cleared" || txn.status === "reconciled") balance.cleared += txn.amount;
    if (txn.status === "reconciled") balance.reconciled += txn.amount;
  }
  return balances;
};

export const sumAccountBalances = (accounts: Account[], balances: Map<number, AccountBalances>): AccountBalances =>
  accounts.reduce((sum, account) => {
    const balance = balances.get(account.key);
    if (balance) {
      sum.reconciled += balance.reconciled;
      sum.cleared += balance.cleared;
      sum.future += balance.future;
    }
    return sum;
  }, { reconciled: 0, cleared: 0, future: 0 });

export const accountBalanceGroups = (wallet: Wallet, accounts: Account[], balances = balancesByAccount(wallet)) => {
  const groups = new Map<number, Account[]>();
  for (const account of accounts) {
    const key = currencyForAccount(wallet, account.key)?.key ?? wallet.baseCurrencyKey;
    const group = groups.get(key) ?? [];
    group.push(account);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ accounts: group, accountKey: group[0].key, ...sumAccountBalances(group, balances) }));
};

export const isClosedAccount = (account: Account) => (account.flags & ACCOUNT_FLAGS.closed) !== 0;

export const visibleAccounts = (wallet: Wallet) => wallet.accounts.filter((account) => !isClosedAccount(account));

export const isSavingsAccount = (account: Account) =>
  account.type === ACCOUNT_TYPES.savings || account.type === ACCOUNT_TYPES.asset;

export const isBankAccount = (account: Account) => !isSavingsAccount(account);

export const upsertTransaction = (wallet: Wallet, transaction: Transaction): Wallet => {
  const exists = wallet.transactions.some((item) => item.id === transaction.id);
  return {
    ...wallet,
    transactions: exists
      ? wallet.transactions.map((item) => (item.id === transaction.id ? transaction : item))
      : [...wallet.transactions, transaction],
  };
};

export const nextKey = (items: Array<{ key: number }>) =>
  items.reduce((max, item) => Math.max(max, item.key), 0) + 1;
