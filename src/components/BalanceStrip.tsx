import { Fragment, useMemo } from "react";
import { type Account, type AccountBalances, type Wallet, accountBalanceGroups, aggregateBalanceTone, formatAmount } from "../lib/homebank";

export function BalanceStrip({
  wallet,
  accountKey,
  reconciled,
  cleared,
  future,
  accounts,
  balances,
}: {
  wallet: Wallet;
  accountKey: number;
  reconciled: number;
  cleared: number;
  future: number;
  accounts: Account[];
  balances: Map<number, AccountBalances>;
}) {
  const grouped = useMemo(() => accountBalanceGroups(wallet, accounts, balances), [wallet.accounts, wallet.currencies, wallet.baseCurrencyKey, accounts, balances]);
  const groups = grouped.length > 1 ? grouped : [{ accounts, accountKey, reconciled, cleared, future }];
  return (
    <dl className="balance-strip">
      {groups.map((group) => <Fragment key={group.accountKey}>
      <div>
        <dt>Rapproche</dt>
        <dd className={"balance-value " + aggregateBalanceTone(group.accounts, group.reconciled)}>{formatAmount(wallet, group.accountKey, group.reconciled)}</dd>
      </div>
      <div>
        <dt>Pointe</dt>
        <dd className={"balance-value " + aggregateBalanceTone(group.accounts, group.cleared)}>{formatAmount(wallet, group.accountKey, group.cleared)}</dd>
      </div>
      <div>
        <dt>Futur</dt>
        <dd className={"balance-value " + aggregateBalanceTone(group.accounts, group.future)}>{formatAmount(wallet, group.accountKey, group.future)}</dd>
      </div>
      </Fragment>)}
    </dl>
  );
}
