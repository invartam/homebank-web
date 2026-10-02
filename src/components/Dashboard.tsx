import { ArrowDownToLine, ArrowRight, CalendarClock, ChevronRight, CircleCheck, FolderOpen, Landmark, Plus, Vault, WalletCards } from "lucide-react";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import { type Account, type AccountBalances, type Transaction, type Wallet, aggregateBalanceTone, balanceTone, formatAmount, formatHbDateFr, isBankAccount, isSavingsAccount } from "../lib/homebank";
import { recentTransactions, transactionType, transferLabel } from "../lib/wallet";
import { EmptyState } from "./common";

export function Dashboard({
  wallet,
  accounts,
  balances,
  totalFutureBalance,
  totalClearedBalance,
  totalReconciledBalance,
  onAccount,
  onImport,
  onDriveOpen,
  onAdd,
  driveConfigured,
  onOperations,
  onScheduled,
  onEdit,
}: {
  wallet: Wallet;
  accounts: Account[];
  balances: Map<number, AccountBalances>;
  totalFutureBalance: number;
  totalClearedBalance: number;
  totalReconciledBalance: number;
  onAccount: (accountKey: number) => void;
  onImport: () => void;
  onDriveOpen: () => void;
  onAdd: () => void;
  driveConfigured: boolean;
  onOperations: () => void;
  onScheduled: () => void;
  onEdit: (transaction: Transaction) => void;
}) {
  const accountKeys = new Set(accounts.map((account) => account.key));
  const { past: lastTransactions, future: nextTransactions } = recentTransactions(wallet.transactions, accountKeys);
  const bankAccounts = accounts.filter(isBankAccount);
  const savingsAccounts = accounts.filter(isSavingsAccount);
  const reconciledTone = aggregateBalanceTone(accounts, totalReconciledBalance);
  const clearedTone = aggregateBalanceTone(accounts, totalClearedBalance);
  const futureTone = aggregateBalanceTone(accounts, totalFutureBalance);

  return (
    <section className="dashboard">
      <div className="balance-band">
        <div className="balance-primary">
          <span className="balance-label"><CircleCheck size={18} />Solde rapproche total</span>
          <strong className={`balance-value ${reconciledTone}`}>
            {formatAmount(wallet, accounts[0]?.key ?? 0, totalReconciledBalance)}
          </strong>
          <span className="balance-account-count"><WalletCards size={16} />{accounts.length} comptes actifs</span>
        </div>
        <dl className="balance-pair">
          <div>
            <dt>Solde pointe</dt>
            <dd className={`balance-value ${clearedTone}`}>{formatAmount(wallet, accounts[0]?.key ?? 0, totalClearedBalance)}</dd>
          </div>
          <div>
            <dt>Solde futur</dt>
            <dd className={`balance-value ${futureTone}`}>{formatAmount(wallet, accounts[0]?.key ?? 0, totalFutureBalance)}</dd>
          </div>
        </dl>
        <div className="quick-actions">
          <Button variant="contained" startIcon={<Plus size={18} />} onClick={onAdd}>Ajouter</Button>
          <Button variant="outlined" startIcon={<FolderOpen size={18} />} onClick={onDriveOpen} disabled={!driveConfigured}>Drive</Button>
          <Button startIcon={<ArrowDownToLine size={18} />} onClick={onImport}>Importer</Button>
          <Button startIcon={<CalendarClock size={18} />} onClick={onScheduled}>Planifications</Button>
        </div>
      </div>

      <div className="accounts-layout">
        <AccountSection title="Banque" accounts={bankAccounts} balances={balances} wallet={wallet} onAccount={onAccount} />
        <AccountSection title="Epargne" accounts={savingsAccounts} balances={balances} wallet={wallet} onAccount={onAccount} />
      </div>

      <section className="panel compact">
        <div className="section-header">
          <div>
            <p className="eyebrow">Activite</p>
            <h2>Dernieres operations</h2>
          </div>
          <Button className="view-all" endIcon={<ArrowRight size={16} />} onClick={onOperations}>Tout voir</Button>
        </div>
        <div className="mini-list">
          <MiniTransactionGroup title="Passees" transactions={lastTransactions} wallet={wallet} onEdit={onEdit} />
          <MiniTransactionGroup title="A venir" transactions={nextTransactions} wallet={wallet} onEdit={onEdit} future />
          {lastTransactions.length === 0 && nextTransactions.length === 0 && <EmptyState onImport={onImport} />}
        </div>
      </section>
    </section>
  );
}

export function MiniTransactionGroup({
  title,
  transactions,
  wallet,
  future = false,
  onEdit,
}: {
  title: string;
  transactions: Transaction[];
  wallet: Wallet;
  future?: boolean;
  onEdit: (transaction: Transaction) => void;
}) {
  if (transactions.length === 0) {
    return null;
  }

  return (
    <section className="mini-group">
      <h3>{title}</h3>
      {transactions.map((txn) => (
        <ButtonBase key={txn.id} className={future ? "mini-row future" : "mini-row"} onClick={() => onEdit(txn)}>
          <span>{formatHbDateFr(txn.date, { day: "2-digit", month: "2-digit" })}</span>
          <strong>{transactionType(txn) === "transfer" ? txn.memo || transferLabel(wallet, txn) : wallet.payees.find((payee) => payee.key === txn.payeeKey)?.name || txn.memo || "Operation"}</strong>
          <em>{formatAmount(wallet, txn.accountKey, txn.amount)}</em>
        </ButtonBase>
      ))}
    </section>
  );
}

export function AccountSection({
  title,
  accounts,
  balances,
  wallet,
  onAccount,
}: {
  title: string;
  accounts: Account[];
  balances: Map<number, AccountBalances>;
  wallet: Wallet;
  onAccount: (accountKey: number) => void;
}) {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <section className="account-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Comptes</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="account-grid">
        {accounts.map((account) => {
          const { reconciled, cleared, future } = balances.get(account.key)!;

          return (
            <ButtonBase key={account.key} className={isSavingsAccount(account) ? "account-card savings" : "account-card"} onClick={() => onAccount(account.key)}>
              <span className="account-type-icon">{isSavingsAccount(account) ? <Vault size={22} /> : <Landmark size={22} />}</span>
              <span className="account-identity"><span>{account.name}</span><small>{account.bankName || (isSavingsAccount(account) ? "Compte d'epargne" : "Compte bancaire")}</small></span>
              <ChevronRight size={18} className="account-chevron" />
              <span className="account-balance-label">Solde rapproche</span>
              <strong className={`balance-value ${balanceTone(account, reconciled)}`}>
                {formatAmount(wallet, account.key, reconciled)}
              </strong>
              <dl>
                <div>
                  <dt>Solde pointe</dt>
                  <dd className={`balance-value ${balanceTone(account, cleared)}`}>{formatAmount(wallet, account.key, cleared)}</dd>
                </div>
                <div>
                  <dt>Solde futur</dt>
                  <dd className={`balance-value ${balanceTone(account, future)}`}>{formatAmount(wallet, account.key, future)}</dd>
                </div>
              </dl>
            </ButtonBase>
          );
        })}
      </div>
    </section>
  );
}
