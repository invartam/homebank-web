import { type Account, type AccountBalances, type Wallet, formatAmount, formatHbDateFr } from "../lib/homebank";

export function FutureBalance({ wallet, accounts, balances, amount, accountKey }: {
  wallet: Wallet; accounts: Account[]; balances: Map<number, AccountBalances>; amount: number; accountKey: number;
}) {
  const forecasts = accounts.map((account) => balances.get(account.key)?.forecast).filter((item) => item !== undefined);
  const single = accounts.length === 1 ? forecasts[0] : undefined;
  const unavailable = !Number.isFinite(amount) || forecasts.some((item) => !item.available);
  const description = unavailable ? "Pr\u00e9vision incompl\u00e8te" : single
    ? `${single.kind === "manual" ? "Au" : "Avant le"} ${formatHbDateFr(single.until)}${single.estimated ? " · revenu estim\u00e9" : ""}`
    : forecasts.length ? "Horizons propres \u00e0 chaque compte" : "Op\u00e9rations inscrites";
  return <><span className={unavailable ? "future-balance-unavailable" : undefined}>{unavailable ? "\u2014" : formatAmount(wallet, accountKey, amount)}</span>
    <small className="future-balance-note" title={forecasts.flatMap((item) => item.issues).join(" ") || single?.label}>{description}</small>
    {forecasts.some((item) => item.overdue > 0) && <small className="future-balance-note">&Eacute;ch&eacute;ances en retard non incluses</small>}
  </>;
}
