import { type Account, type Wallet, aggregateBalanceTone, formatAmount } from "../lib/homebank";

export function BalanceStrip({
  wallet,
  accountKey,
  reconciled,
  cleared,
  future,
  accounts,
}: {
  wallet: Wallet;
  accountKey: number;
  reconciled: number;
  cleared: number;
  future: number;
  accounts: Account[];
}) {
  return (
    <dl className="balance-strip">
      <div>
        <dt>Rapproche</dt>
        <dd className={`balance-value ${aggregateBalanceTone(accounts, reconciled)}`}>{formatAmount(wallet, accountKey, reconciled)}</dd>
      </div>
      <div>
        <dt>Pointe</dt>
        <dd className={`balance-value ${aggregateBalanceTone(accounts, cleared)}`}>{formatAmount(wallet, accountKey, cleared)}</dd>
      </div>
      <div>
        <dt>Futur</dt>
        <dd className={`balance-value ${aggregateBalanceTone(accounts, future)}`}>{formatAmount(wallet, accountKey, future)}</dd>
      </div>
    </dl>
  );
}

