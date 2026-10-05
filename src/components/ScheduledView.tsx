import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, ChevronRight, Eye, Landmark, Search, Vault, X } from "lucide-react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { type Account, type TransactionType, type Wallet, formatAmount, formatHbDateFr, isClosedAccount, isSavingsAccount } from "../lib/homebank";
import { paymodeLabels, transactionTypeLabels } from "../lib/wallet";
import { type ForecastTotals, type ScheduledEntry, forecastNet, readScheduledOperations, recurrenceLabel, scheduledEntries, summarizeScheduledEntries, weekendLabels } from "../lib/scheduled";
import { type CalendarEntry, type CalendarMode, calendarEntries, calendarRange, summarizeCalendarEntries } from "../lib/calendar";
import ScheduledCalendar from "./ScheduledCalendar";
import { useToday } from "../hooks/useToday";
import { ClosedAccountsToggle } from "./ClosedAccountsToggle";

type ScheduleMode = "calendar" | "recurring";
type FlowFilter = "all" | TransactionType;

export default function ScheduledView({ wallet, accounts: activeAccounts, categoryLabels, accountFilter: requestedAccountFilter, onAccountFilter }: {
  wallet: Wallet;
  accounts: Account[];
  categoryLabels: Map<number, string>;
  accountFilter: number;
  onAccountFilter: (key: number) => void;
}) {
  const today = useToday();
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<ScheduleMode>("calendar");
  const [includeClosed, setIncludeClosed] = useState(false);
  const showClosed = mode === "calendar" && includeClosed;
  const accounts = showClosed ? wallet.accounts : activeAccounts;
  const accountFilter = accounts.some((account) => account.key === requestedAccountFilter) ? requestedAccountFilter : 0;
  const [flow, setFlow] = useState<FlowFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScheduledEntry | null>(null);
  const parsed = useMemo(() => readScheduledOperations(wallet, showClosed), [wallet.templates, wallet.accounts, showClosed]);
  const range = useMemo(() => calendarRange(anchor, calendarMode), [anchor, calendarMode]);
  const calendar = useMemo(() => mode === "calendar" ? calendarEntries(wallet, parsed.operations, range.start, range.end, today, showClosed)
    : { entries: [], issues: [] }, [wallet, parsed.operations, range, today, mode, showClosed]);
  const nextEntries = useMemo(() => parsed.operations.flatMap((operation) => scheduledEntries(wallet, operation)).sort((a, b) => a.date - b.date), [wallet, parsed.operations]);
  const matches = (entry: ScheduledEntry | CalendarEntry) => {
    if (accountFilter && entry.accountKey !== accountFilter) return false;
    const operation = "operation" in entry ? entry.operation : entry.source === "recorded" ? entry.transaction : entry.scheduled.operation;
    const type = "type" in entry ? entry.type : entry.operation.type;
    if (flow !== "all" && flow !== type) return false;
    const query = search.trim().toLocaleLowerCase("fr-FR");
    return !query || `${operation.memo} ${wallet.payees.find((payee) => payee.key === operation.payeeKey)?.name ?? ""} ${categoryLabels.get(operation.categoryKey) ?? ""} ${accounts.find((account) => account.key === entry.accountKey)?.name ?? ""}`.toLocaleLowerCase("fr-FR").includes(query);
  };
  const displayedCalendar = calendar.entries.filter(matches);
  const recurring = nextEntries.filter(matches);
  const summary = mode === "calendar" ? summarizeCalendarEntries(wallet, displayedCalendar) : summarizeScheduledEntries(wallet, recurring);
  const byAccount = mode === "recurring" ? summarizeScheduledEntries(wallet, recurring, true) : [];
  const title = accounts.find((account) => account.key === accountFilter)?.name ?? "Tous les comptes";
  const issues = [...parsed.issues, ...(mode === "calendar" ? calendar.issues : parsed.operations
    .filter((operation) => operation.type === "transfer" && scheduledEntries(wallet, operation).length !== 2)
    .map((operation) => `${operation.memo || "Virement"} : compte lie indisponible ou montant lie invalide.`))];
  const rowsKey = `${accountFilter}-${flow}-${search}`;
  const emptyAccountKey = accountFilter || accounts[0]?.key || 0;
  const emptyCurrencyKey = accounts.find((account) => account.key === emptyAccountKey)?.currencyKey ?? wallet.baseCurrencyKey;
  const forecastSummary = <div className="schedule-forecast" aria-label="Synthese des previsions">
    {(summary.length ? summary : [{ accountKey: emptyAccountKey, currencyKey: emptyCurrencyKey, income: 0, expenses: 0, transferIn: 0, transferOut: 0, count: 0 }]).map((total) => (
      <ForecastSummary key={total.currencyKey} total={total} wallet={wallet} multiCurrency={summary.length > 1} planned={mode === "recurring"} />
    ))}
  </div>;

  return (
    <section className="scheduled-view" data-mode={mode} aria-label={"Op\u00e9rations planifi\u00e9es"}>
      <div className="section-header">
        <div><p className="eyebrow">Pr&eacute;visions</p><h2>{title}</h2></div>
        <Chip size="small" variant="outlined" icon={<Eye size={14} />} label="Lecture seule" />
      </div>
      <Tabs value={mode} onChange={(_event, value: ScheduleMode) => {
        setMode(value);
        if (value === "recurring" && wallet.accounts.some((account) => account.key === requestedAccountFilter && isClosedAccount(account))) onAccountFilter(0);
      }} variant="fullWidth" className="schedule-tabs" aria-label="Vue des planifications">
        <Tab value="calendar" label={"\u00c9ch\u00e9ancier"} id="schedule-tab-calendar" aria-controls="schedule-content" />
        <Tab value="recurring" label={"R\u00e9currences"} id="schedule-tab-recurring" aria-controls="schedule-content" />
      </Tabs>
      <div className="schedule-filters" data-mode={mode}>
        <TextField select label="Compte" size="small" value={accountFilter} onChange={(event) => onAccountFilter(Number(event.target.value))} slotProps={{ select: { native: true } }}>
          <option value={0}>Tous les comptes</option>
          {accounts.map((account) => <option key={account.key} value={account.key}>{account.name}{isClosedAccount(account) ? " (clos)" : ""}</option>)}
        </TextField>
        <TextField select label="Type" size="small" value={flow} onChange={(event) => setFlow(event.target.value as FlowFilter)} slotProps={{ select: { native: true } }}>
          <option value="all">Tous les types</option><option value="expense">D&eacute;penses</option><option value="income">Revenus</option><option value="transfer">Virements internes</option>
        </TextField>
        <TextField label="Rechercher" size="small" value={search} onChange={(event) => setSearch(event.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={18} /></InputAdornment> } }} />
      </div>
      {mode === "calendar" && wallet.accounts.some(isClosedAccount) && <ClosedAccountsToggle checked={includeClosed} onChange={(checked) => {
        setIncludeClosed(checked);
        if (!checked && wallet.accounts.some((account) => account.key === requestedAccountFilter && isClosedAccount(account))) onAccountFilter(0);
      }} />}
      {mode === "recurring" && <div className="schedule-period"><CalendarClock size={16} /><span>Prochaines &eacute;ch&eacute;ances</span><span>{countLabel(recurring.length)}</span></div>}
      {issues.length > 0 && <Alert severity="warning" className="schedule-issues">Pr&eacute;vision incompl&egrave;te<ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></Alert>}
      {mode === "recurring" && forecastSummary}
      {accountFilter === 0 && byAccount.length > 0 && (
        <section className="schedule-account-overview" aria-label="Previsions par compte">
          <h3>Par compte</h3>
          {accounts.map((account) => {
            const total = byAccount.find((item) => item.accountKey === account.key);
            if (!total) return null;
            return <ButtonBase key={account.key} className="schedule-account-row" onClick={() => onAccountFilter(account.key)} aria-label={`Voir les planifications de ${account.name}`}>
              <span className="schedule-account-name">{isSavingsAccount(account) ? <Vault size={19} /> : <Landmark size={19} />}<strong>{account.name}</strong><small>{countLabel(total.count)}</small></span>
              <span><small>Revenus</small><strong className="amount positive">{formatAmount(wallet, account.key, total.income)}</strong></span>
              <span><small>D&eacute;penses</small><strong className="amount negative">{formatAmount(wallet, account.key, total.expenses)}</strong></span>
              <span><small>Flux net</small><strong className={`amount ${forecastNet(total) < 0 ? "negative" : "positive"}`}>{formatAmount(wallet, account.key, forecastNet(total))}</strong></span>
              <ChevronRight size={18} />
            </ButtonBase>;
          })}
        </section>
      )}
      <div role="tabpanel" id="schedule-content" aria-labelledby={`schedule-tab-${mode}`}>
        {mode === "calendar" ? <ScheduledCalendar wallet={wallet} accounts={accounts} categoryLabels={categoryLabels} entries={displayedCalendar}
          anchor={anchor} mode={calendarMode} today={today} fallbackAccountKey={emptyAccountKey} onAnchor={setAnchor} onMode={setCalendarMode}>{forecastSummary}</ScheduledCalendar>
          : recurring.length > 0 ? <ScheduleGroups key={rowsKey} entries={recurring} accounts={accounts} wallet={wallet} categoryLabels={categoryLabels} onSelect={setSelected} today={today} /> : (
          <div className="empty-state"><CalendarClock size={28} /><p>{parsed.operations.length === 0 ? "Aucune operation planifiee active dans ce fichier." : "Aucune echeance pour ces filtres."}</p></div>
        )}
      </div>
      <ScheduleDetails entry={selected} wallet={wallet} accounts={accounts} categoryLabels={categoryLabels} onClose={() => setSelected(null)} />
    </section>
  );
}

function ForecastSummary({ total, wallet, multiCurrency, planned }: { total: ForecastTotals; wallet: Wallet; multiCurrency: boolean; planned: boolean }) {
  const max = Math.max(total.income, total.expenses, 1);
  const net = forecastNet(total);
  return <section className="schedule-currency-summary">
    {multiCurrency && <h3>{wallet.currencies.find((currency) => currency.key === total.currencyKey)?.iso ?? "Devise"}</h3>}
    <dl className="schedule-summary">
      <div><dt><ArrowDownLeft size={18} />{planned ? "Revenus pr\u00e9vus" : "Revenus"}</dt><dd className="amount positive">{formatAmount(wallet, total.accountKey, total.income)}</dd><div className="forecast-track" aria-hidden="true"><span className="income-bar" style={{ width: `${total.income / max * 100}%` }} /></div></div>
      <div><dt><ArrowUpRight size={18} />{planned ? "D\u00e9penses pr\u00e9vues" : "D\u00e9penses"}</dt><dd className="amount negative">{formatAmount(wallet, total.accountKey, total.expenses)}</dd><div className="forecast-track" aria-hidden="true"><span className="expense-bar" style={{ width: `${total.expenses / max * 100}%` }} /></div></div>
      <div><dt><ArrowLeftRight size={18} />{planned ? "Flux net pr\u00e9vu" : "Flux net"}</dt><dd className={`amount ${net < 0 ? "negative" : "positive"}`}>{formatAmount(wallet, total.accountKey, net)}</dd></div>
    </dl>
    {(total.transferIn > 0 || total.transferOut > 0) && <p className="schedule-transfers"><ArrowLeftRight size={16} /><span>Virements internes : +{formatAmount(wallet, total.accountKey, total.transferIn)} entrants / -{formatAmount(wallet, total.accountKey, total.transferOut)} sortants</span></p>}
  </section>;
}

function ScheduleGroups({ entries, accounts, wallet, categoryLabels, onSelect, today }: {
  entries: ScheduledEntry[]; accounts: Account[]; wallet: Wallet; categoryLabels: Map<number, string>; onSelect: (entry: ScheduledEntry) => void; today: number;
}) {
  const [visibleCount, setVisibleCount] = useState(40);
  return <div className="schedule-groups">{accounts.map((account) => {
    const rows = entries.filter((entry) => entry.accountKey === account.key);
    if (rows.length === 0) return null;
    return <section className="schedule-group" key={account.key} aria-label={`Planifications ${account.name}`}>
      <h3>{isSavingsAccount(account) ? <Vault size={18} /> : <Landmark size={18} />}{account.name}<small>{rows.length}</small></h3>
      <ul className="schedule-list">{rows.slice(0, visibleCount).map((entry) => {
        const operation = entry.operation;
        const counterpart = accounts.find((item) => item.key === entry.counterpartAccountKey)?.name ?? "Compte indisponible";
        const label = operation.type === "transfer" ? `${entry.amount > 0 ? "Depuis" : "Vers"} ${counterpart}` : categoryLabels.get(operation.categoryKey) ?? "Sans categorie";
        return <li key={entry.id}><ButtonBase className="schedule-row" onClick={() => onSelect(entry)} aria-label={`Consulter ${scheduleTitle(wallet, entry)} du ${formatHbDateFr(entry.date)}`}>
          <span className={`schedule-date ${entry.date < today ? "overdue" : ""}`}><span>{formatHbDateFr(entry.date)}</span>{entry.date < today && <small>En retard</small>}{entry.date === today && <small>Aujourd'hui</small>}</span>
          <span className="schedule-identity"><strong>{scheduleTitle(wallet, entry)}</strong><span>{label}</span><small>{recurrenceLabel(operation)}{operation.remaining !== null ? ` / ${operation.remaining} restante${operation.remaining > 1 ? "s" : ""}` : ""}</small></span>
          <span className="schedule-row-value"><strong className={`amount ${entry.amount < 0 ? "negative" : "positive"}`}>{formatAmount(wallet, entry.accountKey, entry.amount)}</strong><small>{transactionTypeLabels[operation.type]}</small></span>
          <ChevronRight size={16} className="schedule-row-chevron" />
        </ButtonBase></li>;
      })}</ul>
      {rows.length > visibleCount && <Button onClick={() => setVisibleCount((count) => count + 40)}>Voir plus ({rows.length - visibleCount})</Button>}
    </section>;
  })}</div>;
}

function scheduleTitle(wallet: Wallet, entry: ScheduledEntry) {
  return wallet.payees.find((payee) => payee.key === entry.operation.payeeKey)?.name || entry.operation.memo || (entry.operation.type === "transfer" ? "Virement interne" : "Operation planifiee");
}

function ScheduleDetails({ entry, wallet, accounts, categoryLabels, onClose }: {
  entry: ScheduledEntry | null; wallet: Wallet; accounts: Account[]; categoryLabels: Map<number, string>; onClose: () => void;
}) {
  const operation = entry?.operation;
  return <Dialog open={Boolean(entry)} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="schedule-details-title">
    <DialogTitle id="schedule-details-title" className="schedule-detail-title"><span>{entry ? scheduleTitle(wallet, entry) : "Planification"}</span><Tooltip title="Fermer"><IconButton aria-label="Fermer les details" onClick={onClose}><X size={20} /></IconButton></Tooltip></DialogTitle>
    <DialogContent>{entry && operation && <>
      <p className={`schedule-detail-amount amount ${entry.amount < 0 ? "negative" : "positive"}`}>{formatAmount(wallet, entry.accountKey, entry.amount)}</p>
      <Chip size="small" variant="outlined" label={transactionTypeLabels[operation.type]} />
      <dl className="schedule-details">
        <div><dt>Compte</dt><dd>{accounts.find((account) => account.key === entry.accountKey)?.name}</dd></div>
        {operation.type === "transfer" && <div><dt>Compte lie</dt><dd>{accounts.find((account) => account.key === entry.counterpartAccountKey)?.name ?? "Compte indisponible"}</dd></div>}
        <div><dt>&Eacute;ch&eacute;ance consult&eacute;e</dt><dd>{formatHbDateFr(entry.date)}</dd></div>
        <div><dt>Prochaine date HomeBank</dt><dd>{formatHbDateFr(operation.nextDate)}</dd></div>
        <div><dt>R&eacute;currence</dt><dd>{recurrenceLabel(operation)}</dd></div>
        <div><dt>Occurrences restantes</dt><dd>{operation.remaining ?? "Sans limite"}</dd></div>
        <div><dt>Week-end</dt><dd>{weekendLabels[operation.weekend]}</dd></div>
        <div><dt>Tiers</dt><dd>{wallet.payees.find((payee) => payee.key === operation.payeeKey)?.name || "Aucun"}</dd></div>
        <div><dt>Cat&eacute;gorie</dt><dd>{categoryLabels.get(operation.categoryKey) ?? "Sans categorie"}</dd></div>
        <div><dt>Moyen de paiement</dt><dd>{paymodeLabels[operation.paymode] ?? "Autre"}</dd></div>
        <div><dt>Num&eacute;ro de paiement</dt><dd>{operation.number || "Aucun"}</dd></div>
        <div><dt>M&eacute;mo</dt><dd>{operation.memo || "Aucun"}</dd></div>
      </dl>
    </>}</DialogContent>
    <DialogActions><Button onClick={onClose}>Fermer</Button></DialogActions>
  </Dialog>;
}

const countLabel = (count: number) => `${count} \u00e9ch\u00e9ance${count === 1 ? "" : "s"}`;
