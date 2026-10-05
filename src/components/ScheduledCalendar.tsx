import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, CircleCheck, X } from "lucide-react";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import { type Account, type Wallet, currencyForAccount, formatAmount, formatHbDateFr, hbDateToIso, isoToHbDate } from "../lib/homebank";
import { type CalendarEntry, type CalendarMode, calendarRange, monthGrid, shiftCalendarAnchor, summarizeCalendarEntries } from "../lib/calendar";
import { type ForecastTotals } from "../lib/scheduled";
import { transactionTypeLabels } from "../lib/wallet";

const dateObject = (date: number) => new Date((date - 719163) * 86400000);
const shortNumber = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });
const weekdays = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const fullWeekdays = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export const calendarLabel = (date: number, mode: CalendarMode) => {
  const label = new Intl.DateTimeFormat("fr-FR", { year: "numeric", month: mode === "month" ? "long" : undefined, timeZone: "UTC" }).format(dateObject(date));
  return label.charAt(0).toLocaleUpperCase("fr-FR") + label.slice(1);
};

export default function ScheduledCalendar({ wallet, accounts, categoryLabels, entries, anchor, mode, today, fallbackAccountKey, onAnchor, onMode, children }: {
  wallet: Wallet; accounts: Account[]; categoryLabels: Map<number, string>; entries: CalendarEntry[];
  anchor: number; mode: CalendarMode; today: number; fallbackAccountKey: number; onAnchor: (date: number) => void;
  onMode: (mode: CalendarMode) => void; children: ReactNode;
}) {
  const [selection, setSelection] = useState<{ date: number; mode: CalendarMode } | null>(null);
  const [visibleCount, setVisibleCount] = useState(40);
  const range = calendarRange(anchor, mode);
  const previous = shiftCalendarAnchor(anchor, mode, -1);
  const next = shiftCalendarAnchor(anchor, mode, 1);
  const title = calendarLabel(anchor, mode);
  const buckets = useMemo(() => {
    const grouped = new Map<number, CalendarEntry[]>();
    for (const entry of entries) {
      const key = mode === "month" ? entry.date : dateObject(entry.date).getUTCMonth();
      const bucket = grouped.get(key) ?? [];
      bucket.push(entry);
      grouped.set(key, bucket);
    }
    return grouped;
  }, [entries, mode]);
  const recordedCount = entries.filter((entry) => entry.source === "recorded").length;
  const plannedCount = entries.length - recordedCount;
  const currencies = summarizeCalendarEntries(wallet, entries);
  const multiCurrency = currencies.length > 1;
  const emptyTotals: ForecastTotals[] = (currencies.length ? currencies : [{ accountKey: fallbackAccountKey,
    currencyKey: currencyForAccount(wallet, fallbackAccountKey)?.key ?? wallet.baseCurrencyKey }])
    .map((total) => ({ accountKey: total.accountKey, currencyKey: total.currencyKey, income: 0, expenses: 0, transferIn: 0, transferOut: 0, count: 0 }));
  const select = (date: number) => { setVisibleCount(40); setSelection({ date, mode }); };
  const selectedRange = selection ? calendarRange(selection.date, "month") : null;
  const selectedEntries = selection ? entries.filter((entry) => selection.mode === "month" ? entry.date === selection.date
    : entry.date >= selectedRange!.start && entry.date <= selectedRange!.end) : [];
  const selectedTotals = summarizeCalendarEntries(wallet, selectedEntries);

  const renderCell = (date: number, inMonth: boolean, cellEntries: CalendarEntry[], label: string) => {
    const populatedTotals = summarizeCalendarEntries(wallet, cellEntries);
    const totals = populatedTotals.length || mode === "month" ? populatedTotals : emptyTotals;
    const current = mode === "month" ? date === today : calendarRange(date, "month").start === calendarRange(today, "month").start;
    const past = (mode === "month" ? date : calendarRange(date, "month").end) < today;
    const name = !inMonth ? label : mode === "month" ? formatHbDateFr(date) : calendarLabel(date, "month");
    const descriptions = totals.map((total) => `Revenus ${formatAmount(wallet, total.accountKey, total.income)}, depenses ${formatAmount(wallet, total.accountKey, total.expenses)}, virements entrants ${formatAmount(wallet, total.accountKey, total.transferIn)}, virements sortants ${formatAmount(wallet, total.accountKey, total.transferOut)}`).join(" ; ");
    return <div role="gridcell" key={date} className={`calendar-cell ${inMonth ? "" : "outside"} ${past ? "past" : "future"} ${current ? "current" : ""}`}>
      <ButtonBase disabled={!inMonth} onClick={() => select(date)} onKeyDown={navigateGrid} className="calendar-cell-button" data-date={inMonth ? hbDateToIso(date) : undefined}
        aria-label={inMonth ? `${name}, ${cellEntries.length} operation${cellEntries.length === 1 ? "" : "s"}${descriptions ? `, ${descriptions}` : ""}` : label}
        aria-current={current ? "date" : undefined}>
        <span className="calendar-cell-heading"><span className="calendar-cell-date">{label}</span>
          {inMonth && mode === "year" && <small>{past ? "Saisi" : calendarRange(date, "month").start > today ? "Pr\u00e9vu" : "En cours"}</small>}
        </span>
        {inMonth && totals.length > 0 && <span className="calendar-cell-totals">{totals.map((total) => <CellTotals key={total.currencyKey} total={total} wallet={wallet} multiCurrency={multiCurrency} />)}</span>}
        {inMonth && (cellEntries.length > 0 || mode === "year") && <span className="calendar-cell-count">{cellEntries.length}<span> op.</span></span>}
      </ButtonBase>
    </div>;
  };

  const grid = monthGrid(anchor);
  const year = String(dateObject(anchor).getUTCFullYear()).padStart(4, "0");
  return <section className="scheduled-calendar" aria-label="Calendrier des operations">
    <div className="calendar-toolbar">
      <h3>{title}</h3>
      <ToggleButtonGroup value={mode} exclusive size="small" className="calendar-mode" aria-label="Affichage du calendrier"
        onChange={(_event, value: CalendarMode | null) => { if (value) onMode(value); }}>
        <ToggleButton value="month">Mois</ToggleButton><ToggleButton value="year">Ann&eacute;e</ToggleButton>
      </ToggleButtonGroup>
      <div className="calendar-navigation">
        <Tooltip title={mode === "month" ? "Mois precedent" : "Annee precedente"}><span><IconButton size="small" aria-label={mode === "month" ? "Mois precedent" : "Annee precedente"}
          disabled={calendarRange(previous, mode).start === range.start} onClick={() => onAnchor(previous)}><ChevronLeft size={20} /></IconButton></span></Tooltip>
        <Button size="small" onClick={() => onAnchor(today)}>Aujourd'hui</Button>
        <Tooltip title={mode === "month" ? "Mois suivant" : "Annee suivante"}><span><IconButton size="small" aria-label={mode === "month" ? "Mois suivant" : "Annee suivante"}
          disabled={calendarRange(next, mode).start === range.start} onClick={() => onAnchor(next)}><ChevronRight size={20} /></IconButton></span></Tooltip>
      </div>
    </div>
    <div className="calendar-legend">
      <span><CircleCheck size={14} />{recordedCount} saisie{recordedCount === 1 ? "" : "s"}</span>
      <span><CalendarClock size={14} />{plannedCount} planifi&eacute;e{plannedCount === 1 ? "" : "s"}</span>
      <span className="calendar-operation-count">{entries.length} op&eacute;ration{entries.length === 1 ? "" : "s"}</span>
    </div>
    {children}
    {mode === "month" ? <div className="calendar-month-grid" role="grid" aria-label={title}>
      <div className="calendar-weekdays" role="row">{weekdays.map((weekday, index) => <span key={weekday} role="columnheader" aria-label={fullWeekdays[index]}>{weekday}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div className="calendar-week" role="row" key={week}>
        {grid.slice(week * 7, week * 7 + 7).map((cell) => renderCell(cell.date, cell.inMonth, buckets.get(cell.date) ?? [], String(dateObject(cell.date).getUTCDate())))}
      </div>)}
    </div> : <div className="calendar-year-grid" role="grid" aria-label={title}>
      {Array.from({ length: 4 }, (_, row) => <div className="calendar-year-row" role="row" key={row}>
        {Array.from({ length: 3 }, (_, column) => {
          const month = row * 3 + column;
          const date = isoToHbDate(`${year}-${String(month + 1).padStart(2, "0")}-01`);
          return renderCell(date, true, buckets.get(month) ?? [], monthName.format(dateObject(date)));
        })}
      </div>)}
    </div>}
    <Dialog open={Boolean(selection)} onClose={() => setSelection(null)} fullWidth maxWidth="sm" aria-labelledby="calendar-agenda-title">
      <DialogTitle id="calendar-agenda-title" className="schedule-detail-title"><span>{selection ? selection.mode === "month" ? `Operations du ${formatHbDateFr(selection.date)}` : calendarLabel(selection.date, "month") : "Operations"}</span>
        <Tooltip title="Fermer"><IconButton aria-label="Fermer les operations" onClick={() => setSelection(null)}><X size={20} /></IconButton></Tooltip>
      </DialogTitle>
      <DialogContent>
        {selectedTotals.map((total) => <dl className="calendar-agenda-summary" key={total.currencyKey}>
          <div><dt>Revenus</dt><dd className="amount positive">{formatAmount(wallet, total.accountKey, total.income)}</dd></div>
          <div><dt>D&eacute;penses</dt><dd className="amount negative">{formatAmount(wallet, total.accountKey, total.expenses)}</dd></div>
          {(total.transferIn > 0 || total.transferOut > 0) && <div className="calendar-agenda-transfers"><dt>Virements internes</dt><dd>+{formatAmount(wallet, total.accountKey, total.transferIn)} / -{formatAmount(wallet, total.accountKey, total.transferOut)}</dd></div>}
        </dl>)}
        {selectedEntries.length === 0 ? <p className="calendar-agenda-empty">Aucune op&eacute;ration pour ces filtres.</p> : <ul className="calendar-agenda-list">{selectedEntries.slice(0, visibleCount).map((entry) => {
          const operation = entry.source === "recorded" ? entry.transaction : entry.scheduled.operation;
          const account = accounts.find((item) => item.key === entry.accountKey);
          const counterpartKey = entry.source === "recorded" ? entry.transaction.destinationAccountKey : entry.scheduled.counterpartAccountKey;
          const counterpart = accounts.find((item) => item.key === counterpartKey)?.name ?? "Compte indisponible";
          const identity = wallet.payees.find((payee) => payee.key === operation.payeeKey)?.name || operation.memo || transactionTypeLabels[entry.type];
          return <li className="calendar-agenda-row" key={entry.id}>
            <span className="calendar-agenda-date">{formatHbDateFr(entry.date)}</span>
            <span className="calendar-agenda-identity"><strong>{identity}</strong><span>{account?.name}</span>
              <small>{entry.type === "transfer" ? `${entry.amount > 0 ? "Depuis" : "Vers"} ${counterpart}` : categoryLabels.get(operation.categoryKey) ?? "Sans categorie"}</small>
              {operation.memo && operation.memo !== identity && <small>{operation.memo}</small>}
            </span>
            <span className="calendar-agenda-value"><strong className={`amount ${entry.amount < 0 ? "negative" : "positive"}`}>{formatAmount(wallet, entry.accountKey, entry.amount)}</strong><small>{transactionTypeLabels[entry.type]}</small>
              <small className={`calendar-entry-source ${entry.source}`}>{entry.source === "recorded" ? <CircleCheck size={12} /> : <CalendarClock size={12} />}{entry.source === "recorded" ? "Saisie" : "Planifi\u00e9e"}</small>
            </span>
          </li>;
        })}</ul>}
        {selectedEntries.length > visibleCount && <Button onClick={() => setVisibleCount((count) => count + 40)}>Voir plus ({selectedEntries.length - visibleCount})</Button>}
      </DialogContent>
      <DialogActions>
        {selection?.mode === "year" && <Button onClick={() => { onAnchor(selection.date); onMode("month"); setSelection(null); }}>Voir le mois</Button>}
        <Button onClick={() => setSelection(null)}>Fermer</Button>
      </DialogActions>
    </Dialog>
  </section>;
}

function CellTotals({ total, wallet, multiCurrency }: { total: ForecastTotals; wallet: Wallet; multiCurrency: boolean }) {
  const iso = wallet.currencies.find((currency) => currency.key === total.currencyKey)?.iso ?? "EUR";
  const value = (amount: number) => {
    const signed = amount === 0 ? 0 : amount;
    return <><span className="calendar-full-amount">{signed > 0 ? "+" : ""}{formatAmount(wallet, total.accountKey, signed)}</span><span className="calendar-short-amount" aria-hidden="true">{signed > 0 ? "+" : ""}{shortNumber.format(signed)}</span></>;
  };
  return <span className="calendar-currency-totals">
    {multiCurrency && <small className="calendar-cell-currency">{iso}</small>}
    <span className="calendar-income" title={`Revenus ${formatAmount(wallet, total.accountKey, total.income)}`}><ArrowDownLeft size={12} />{value(total.income)}</span>
    <span className="calendar-expenses" title={`Depenses ${formatAmount(wallet, total.accountKey, total.expenses)}`}><ArrowUpRight size={12} />{value(-total.expenses)}</span>
    {total.transferIn > 0 && <span className="calendar-transfer calendar-transfer-in" title={`Virements entrants ${formatAmount(wallet, total.accountKey, total.transferIn)}`}><ArrowLeftRight size={12} />{value(total.transferIn)}</span>}
    {total.transferOut > 0 && <span className="calendar-transfer calendar-transfer-out" title={`Virements sortants ${formatAmount(wallet, total.accountKey, total.transferOut)}`}><ArrowLeftRight size={12} />{value(-total.transferOut)}</span>}
  </span>;
}

function navigateGrid(event: KeyboardEvent<HTMLButtonElement>) {
  if (!event.key.startsWith("Arrow") && event.key !== "Home" && event.key !== "End") return;
  const grid = event.currentTarget.closest('[role="grid"]');
  const buttons = Array.from(grid?.querySelectorAll<HTMLButtonElement>("button[data-date]") ?? []);
  const index = buttons.indexOf(event.currentTarget);
  if (index < 0) return;
  const annual = grid?.classList.contains("calendar-year-grid");
  const columns = annual ? buttons.filter((button) => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 1).length : 7;
  const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? columns : -columns;
  const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + offset;
  event.preventDefault();
  buttons[target]?.focus();
}
