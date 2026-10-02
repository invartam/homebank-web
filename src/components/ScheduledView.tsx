import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, ChevronDown, ChevronRight, Eye, Landmark, Search, Vault, X } from "lucide-react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
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
import { type Account, type TransactionType, type Wallet, formatAmount, formatHbDateFr, isSavingsAccount } from "../lib/homebank";
import { paymodeLabels, transactionTypeLabels } from "../lib/wallet";
import { type ForecastTotals, type ScheduledEntry, type SchedulePeriod, forecastNet, projectScheduledOperations, readScheduledOperations, recurrenceLabel, scheduleRange, scheduledEntries, summarizeScheduledEntries, weekendLabels } from "../lib/scheduled";
import { useToday } from "../hooks/useToday";

type ScheduleMode = "calendar" | "recurring";
type FlowFilter = "all" | TransactionType;

export default function ScheduledView({ wallet, accounts, categoryLabels, accountFilter, onAccountFilter }: {
  wallet: Wallet;
  accounts: Account[];
  categoryLabels: Map<number, string>;
  accountFilter: number;
  onAccountFilter: (key: number) => void;
}) {
  const today = useToday();
  const [period, setPeriod] = useState<SchedulePeriod>("month");
  const [mode, setMode] = useState<ScheduleMode>("calendar");
  const [flow, setFlow] = useState<FlowFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScheduledEntry | null>(null);
  const parsed = useMemo(() => readScheduledOperations(wallet), [wallet.templates, wallet.accounts]);
  const range = useMemo(() => scheduleRange(today, period), [today, period]);
  const forecast = useMemo(() => projectScheduledOperations(wallet, parsed.operations, range.start, range.end), [wallet, parsed.operations, range]);
  const nextEntries = useMemo(() => parsed.operations.flatMap((operation) => scheduledEntries(wallet, operation)).sort((a, b) => a.date - b.date), [wallet, parsed.operations]);
  const matches = (entry: ScheduledEntry) => {
    if (accountFilter && entry.accountKey !== accountFilter) return false;
    if (flow !== "all" && flow !== entry.operation.type) return false;
    const query = search.trim().toLocaleLowerCase("fr-FR");
    return !query || `${entry.operation.memo} ${wallet.payees.find((payee) => payee.key === entry.operation.payeeKey)?.name ?? ""} ${categoryLabels.get(entry.operation.categoryKey) ?? ""} ${accounts.find((account) => account.key === entry.accountKey)?.name ?? ""}`.toLocaleLowerCase("fr-FR").includes(query);
  };
  const projected = forecast.entries.filter(matches);
  const recurring = nextEntries.filter(matches);
  const overdue = recurring.filter((entry) => entry.date < today);
  const displayed = mode === "calendar" ? projected : recurring;
  const summary = summarizeScheduledEntries(wallet, projected);
  const byAccount = summarizeScheduledEntries(wallet, projected, true);
  const title = accounts.find((account) => account.key === accountFilter)?.name ?? "Tous les comptes";
  const issues = [...parsed.issues, ...forecast.issues];
  const rowsKey = `${mode}-${period}-${accountFilter}-${flow}-${search}`;

  return (
    <section className="scheduled-view" aria-label={"Op\u00e9rations planifi\u00e9es"}>
      <div className="section-header">
        <div><p className="eyebrow">Pr&eacute;visions</p><h2>{title}</h2></div>
        <Chip size="small" variant="outlined" icon={<Eye size={14} />} label="Lecture seule" />
      </div>
      <div className="schedule-filters">
        <TextField select label="Compte" size="small" value={accountFilter} onChange={(event) => onAccountFilter(Number(event.target.value))} slotProps={{ select: { native: true } }}>
          <option value={0}>Tous les comptes</option>
          {accounts.map((account) => <option key={account.key} value={account.key}>{account.name}</option>)}
        </TextField>
        <TextField select label={"P\u00e9riode"} size="small" value={period} onChange={(event) => setPeriod(event.target.value as SchedulePeriod)} slotProps={{ select: { native: true } }}>
          <option value="month">Reste du mois</option><option value="30">30 jours</option><option value="90">90 jours</option>
        </TextField>
        <TextField select label="Type" size="small" value={flow} onChange={(event) => setFlow(event.target.value as FlowFilter)} slotProps={{ select: { native: true } }}>
          <option value="all">Tous les types</option><option value="expense">D&eacute;penses</option><option value="income">Revenus</option><option value="transfer">Virements internes</option>
        </TextField>
        <TextField label="Rechercher" size="small" value={search} onChange={(event) => setSearch(event.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={18} /></InputAdornment> } }} />
      </div>
      <div className="schedule-period"><CalendarClock size={16} /><span>Du {formatHbDateFr(range.start)} au {formatHbDateFr(range.end)}</span><span>{countLabel(projected.length)}</span></div>
      {issues.length > 0 && <Alert severity="warning" className="schedule-issues">Pr&eacute;vision incompl&egrave;te<ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></Alert>}
      <div className="schedule-forecast" aria-label="Synthese des previsions">
        {(summary.length ? summary : [{ accountKey: accountFilter || accounts[0]?.key || 0, currencyKey: wallet.baseCurrencyKey, income: 0, expenses: 0, transferIn: 0, transferOut: 0, count: 0 }]).map((total) => (
          <ForecastSummary key={total.currencyKey} total={total} wallet={wallet} multiCurrency={summary.length > 1} />
        ))}
      </div>
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
      <Tabs value={mode} onChange={(_event, value: ScheduleMode) => setMode(value)} variant="fullWidth" className="schedule-tabs" aria-label="Vue des planifications">
        <Tab value="calendar" label={"\u00c9ch\u00e9ancier"} id="schedule-tab-calendar" aria-controls="schedule-content" />
        <Tab value="recurring" label={"R\u00e9currences"} id="schedule-tab-recurring" aria-controls="schedule-content" />
      </Tabs>
      <div role="tabpanel" id="schedule-content" aria-labelledby={`schedule-tab-${mode}`}>
        {mode === "calendar" && overdue.length > 0 && <Accordion className="schedule-overdue" disableGutters>
          <AccordionSummary expandIcon={<ChevronDown size={18} />}><span>{overdue.length} planification{overdue.length === 1 ? "" : "s"} en retard</span></AccordionSummary>
          <AccordionDetails><ScheduleGroups entries={overdue} accounts={accounts} wallet={wallet} categoryLabels={categoryLabels} onSelect={setSelected} today={today} /></AccordionDetails>
        </Accordion>}
        {displayed.length > 0 ? <ScheduleGroups key={rowsKey} entries={displayed} accounts={accounts} wallet={wallet} categoryLabels={categoryLabels} onSelect={setSelected} today={today} /> : (
          <div className="empty-state"><CalendarClock size={28} /><p>{parsed.operations.length === 0 ? "Aucune operation planifiee active dans ce fichier." : "Aucune echeance pour ces filtres."}</p></div>
        )}
      </div>
      <ScheduleDetails entry={selected} wallet={wallet} accounts={accounts} categoryLabels={categoryLabels} onClose={() => setSelected(null)} />
    </section>
  );
}

function ForecastSummary({ total, wallet, multiCurrency }: { total: ForecastTotals; wallet: Wallet; multiCurrency: boolean }) {
  const max = Math.max(total.income, total.expenses, 1);
  const net = forecastNet(total);
  return <section className="schedule-currency-summary">
    {multiCurrency && <h3>{wallet.currencies.find((currency) => currency.key === total.currencyKey)?.iso ?? "Devise"}</h3>}
    <dl className="schedule-summary">
      <div><dt><ArrowDownLeft size={18} />Revenus pr&eacute;vus</dt><dd className="amount positive">{formatAmount(wallet, total.accountKey, total.income)}</dd><div className="forecast-track" aria-hidden="true"><span className="income-bar" style={{ width: `${total.income / max * 100}%` }} /></div></div>
      <div><dt><ArrowUpRight size={18} />D&eacute;penses pr&eacute;vues</dt><dd className="amount negative">{formatAmount(wallet, total.accountKey, total.expenses)}</dd><div className="forecast-track" aria-hidden="true"><span className="expense-bar" style={{ width: `${total.expenses / max * 100}%` }} /></div></div>
      <div><dt><ArrowLeftRight size={18} />Flux net pr&eacute;vu</dt><dd className={`amount ${net < 0 ? "negative" : "positive"}`}>{formatAmount(wallet, total.accountKey, net)}</dd></div>
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
