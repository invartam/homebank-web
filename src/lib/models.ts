export type TransactionStatus = "none" | "cleared" | "reconciled" | "void";
export type TransactionType = "expense" | "income" | "transfer";

export const TRANSACTION_FLAGS = {
  income: 1 << 1,
  internalTransfer: 1 << 3,
  advancedTransfer: 1 << 4,
} as const;

export interface Currency {
  key: number;
  flags: number;
  iso: string;
  name: string;
  symbol: string;
  symbolPrefix: number;
  decimalChar: string;
  groupingChar: string;
  fractionDigits: number;
  rate: number;
  modifiedDate: number;
}

export interface Account {
  key: number;
  flags: number;
  position: number;
  type: number;
  currencyKey: number;
  name: string;
  number: string;
  bankName: string;
  groupKey: number;
  initial: number;
  minimum: number;
  maximum: number;
  cheque1: number;
  cheque2: number;
  website: string;
  notes: string;
  templateKey: number;
  creditCardCloseDay: number;
  reconciledDate: number;
}

export interface Payee {
  key: number;
  flags: number;
  name: string;
  categoryKey: number;
  paymode: number;
  notes: string;
}

export interface Category {
  key: number;
  parent: number;
  flags: number;
  name: string;
  budget: number[];
}

export interface Tag {
  key: number;
  name: string;
}

export interface Group {
  key: number;
  name: string;
}

export interface TransactionSplit {
  categoryKey: number;
  amount: number;
  memo: string;
}

export interface Transaction {
  id: string;
  date: number;
  amount: number;
  accountKey: number;
  destinationAccountKey: number;
  transferAmount: number;
  paymode: number;
  groupFlag: number;
  status: TransactionStatus;
  flags: number;
  payeeKey: number;
  categoryKey: number;
  memo: string;
  number: string;
  tagKeys: number[];
  transferKey: number;
  splits: TransactionSplit[];
}

export interface RawNode {
  name: string;
  attributes: Record<string, string>;
}

export interface Wallet {
  sourceFileName?: string;
  fileVersion: string;
  appVersion: string;
  owner: string;
  baseCurrencyKey: number;
  vehicleCategoryKey: number;
  autoPostMode: number;
  autoWeekday: number;
  autoMonths: number;
  autoDays: number;
  earnByHour: number;
  currencies: Currency[];
  groups: Group[];
  accounts: Account[];
  payees: Payee[];
  categories: Category[];
  tags: Tag[];
  transactions: Transaction[];
  assignments: RawNode[];
  templates: RawNode[];
  filters: RawNode[];
}

export const ACCOUNT_FLAGS = {
  closed: 1 << 1,
} as const;

export const ACCOUNT_TYPES = {
  bank: 1,
  cash: 2,
  asset: 3,
  creditCard: 4,
  liability: 5,
  checking: 6,
  savings: 7,
} as const;

export const emptyWallet = (): Wallet => ({
  fileVersion: "1.6",
  appVersion: "51003",
  owner: "",
  baseCurrencyKey: 1,
  vehicleCategoryKey: 0,
  autoPostMode: 0,
  autoWeekday: 0,
  autoMonths: 0,
  autoDays: 0,
  earnByHour: 0,
  currencies: [
    {
      key: 1,
      flags: 0,
      iso: "EUR",
      name: "Euro",
      symbol: "EUR",
      symbolPrefix: 0,
      decimalChar: ".",
      groupingChar: ",",
      fractionDigits: 2,
      rate: 1,
      modifiedDate: 0,
    },
  ],
  groups: [],
  accounts: [],
  payees: [],
  categories: [],
  tags: [],
  transactions: [],
  assignments: [],
  templates: [],
  filters: [],
});
