import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsType, EChartsCoreOption } from "echarts/core";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { ChartNoAxesCombined, ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { aggregateBalanceTone, currencyForAccount, formatAmount, formatHbDateFr, hbDateToIso, isoToHbDate, overdraftLimit, type Wallet } from "../lib/homebank";
import { balanceChartData, buildBalanceHistory, clampHistoryRange, historyAccounts, historyPeriodRange, zoomHistoryRange,
  type BalanceScope, type HistoryPeriod, type HistoryRange, type ProjectionMonths } from "../lib/balanceHistory";
import { useToday } from "../hooks/useToday";

export function BalanceHistoryChart({ wallet }: { wallet: Wallet }) {
  const today = useToday(), theme = useTheme();
  const [scope, setScope] = useState<BalanceScope>(() => historyAccounts(wallet, "bank").length ? "bank" : "savings");
  const [months, setMonths] = useState<ProjectionMonths>(12);
  const [currencyKey, setCurrencyKey] = useState<number | undefined>();
  const [period, setPeriod] = useState<HistoryPeriod | null>("3m");
  const [selectedRange, setSelectedRange] = useState<HistoryRange | null>(null);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null), chart = useRef<EChartsType | null>(null);
  const module = useRef<typeof import("../lib/balanceChartEngine") | null>(null);
  const scoped = useMemo(() => historyAccounts(wallet, scope), [wallet.accounts, wallet.currencies, wallet.baseCurrencyKey, scope]);
  const currencies = useMemo(() => [...new Map(scoped.map((account) => { const currency = currencyForAccount(wallet, account.key); return [currency?.key ?? wallet.baseCurrencyKey, currency]; })).entries()], [scoped, wallet.currencies, wallet.baseCurrencyKey]);
  const selectedCurrency = currencies.some(([key]) => key === currencyKey) ? currencyKey! : currencies[0]?.[0];
  const accounts = useMemo(() => historyAccounts(wallet, scope, selectedCurrency), [wallet.accounts, wallet.currencies, wallet.baseCurrencyKey, scope, selectedCurrency]);
  const history = useMemo(() => buildBalanceHistory(wallet, accounts, today, months), [wallet.transactions, wallet.templates, accounts, today, months]);
  const range = selectedRange ? clampHistoryRange(selectedRange, history.domain) : historyPeriodRange(history.domain, period ?? "3m", today);
  const data = useMemo(() => balanceChartData(history, range), [history, range.start, range.end]);
  const accountKey = accounts[0]?.key ?? 0;
  const overdraft = scope.startsWith("account:") && accounts.length === 1 ? overdraftLimit(accounts[0]) : undefined;
  const curveColor = theme.palette.mode === "dark" ? "#74b6ee" : "#477eb8";
  const money = (amount: number) => formatAmount(wallet, accountKey, amount);
  const state = useRef({ history, data, range, theme, money, overdraft });
  state.current = { history, data, range, theme, money, overdraft };
  const chooseRange = (next: HistoryRange) => { setSelectedRange(clampHistoryRange(next, history.domain)); setPeriod(null); };
  const rangeAction = useRef(chooseRange); rangeAction.current = chooseRange;
  const options = (): EChartsCoreOption | null => {
    if (!module.current) return null;
    const current = state.current, palette = current.theme.palette;
    return module.current.balanceChartOptions(current.history, current.data, current.range, {
      dark: palette.mode === "dark", text: palette.text.primary, muted: palette.text.secondary, grid: palette.divider,
      surface: palette.mode === "dark" ? "#191c20" : palette.background.paper, primary: curveColor, danger: palette.error.main,
      font: current.theme.typography.fontFamily ?? "Arial",
      fractionDigits: currencyForAccount(wallet, accountKey)?.fractionDigits ?? 2,
    }, current.money, current.overdraft);
  };
  const optionsRef = useRef(options); optionsRef.current = options;

  useEffect(() => {
    if (!accounts.length) return;
    setReady(false); setFailed(false);
    let cancelled = false, instance: EChartsType | undefined, observer: ResizeObserver | undefined, frame = 0;
    void import("../lib/balanceChartEngine").then((engine) => {
      if (cancelled || !host.current) return;
      module.current = engine; instance = engine.init(host.current, undefined, { renderer: "canvas" }); chart.current = instance;
      instance.setOption(optionsRef.current()!, { notMerge: true, silent: true });
      instance.on("datazoom", (event: unknown) => {
        const payload = event as { start?: number; end?: number; batch?: { start?: number; end?: number }[] };
        const zoom = payload.batch?.[0] ?? payload;
        if (typeof zoom.start !== "number" || typeof zoom.end !== "number" || !Number.isFinite(zoom.start) || !Number.isFinite(zoom.end)) return;
        const domain = state.current.history.domain, span = domain.end - domain.start;
        const next = clampHistoryRange({ start: Math.round(domain.start + span * zoom.start / 100), end: Math.round(domain.start + span * zoom.end / 100) }, domain);
        if (next.start !== state.current.range.start || next.end !== state.current.range.end) rangeAction.current(next);
      });
      observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => instance?.resize()); });
      observer.observe(host.current); setReady(true);
    }).catch(() => { if (!cancelled) { instance?.dispose(); chart.current = null; setFailed(true); } });
    return () => { cancelled = true; cancelAnimationFrame(frame); observer?.disconnect(); instance?.dispose(); chart.current = null; };
  }, [Boolean(accounts.length)]);

  useEffect(() => {
    if (chart.current) chart.current.setOption(optionsRef.current()!, { notMerge: true, silent: true });
  }, [history, data, range.start, range.end, theme, overdraft, ready]);

  const changeScope = (next: BalanceScope) => { setScope(next); setSelectedRange(null); setCurrencyKey(undefined); };
  useEffect(() => {
    if (scope.startsWith("account:") && !historyAccounts(wallet, scope).length) {
      changeScope(historyAccounts(wallet, "bank").length ? "bank" : "savings");
    }
  }, [wallet.accounts, scope]);
  const choosePeriod = (next: HistoryPeriod | null) => { if (next) { setPeriod(next); setSelectedRange(null); } };
  const shift = (direction: number) => chooseRange({ start: range.start + (range.end - range.start) * direction, end: range.end + (range.end - range.start) * direction });

  return <section className="balance-history" aria-labelledby="balance-history-title">
    <div className="section-header">
      <div><p className="eyebrow">Rapport de solde</p><h2 id="balance-history-title"><ChartNoAxesCombined size={20} aria-hidden="true" />Evolution du solde</h2></div>
    </div>
    <div className={currencies.length > 1 ? "history-filters multiple" : "history-filters"}>
      <TextField select size="small" label="Perimetre du graphique" value={scope} onChange={(event) => changeScope(event.target.value as BalanceScope)} slotProps={{ select: { native: true } }}>
        <option value="bank">Comptes banque</option><option value="savings">Comptes epargne</option>
        <optgroup label="Par compte">{historyAccounts(wallet, "bank").concat(historyAccounts(wallet, "savings")).map((account) => <option key={account.key} value={`account:${account.key}`}>{account.name}</option>)}</optgroup>
      </TextField>
      <TextField select size="small" label="Horizon des previsions" value={months} onChange={(event) => { setMonths(Number(event.target.value) as ProjectionMonths); setPeriod("forecast"); setSelectedRange(null); }} slotProps={{ select: { native: true } }}>
        <option value="3">3 mois</option><option value="12">1 an</option><option value="60">5 ans</option>
      </TextField>
      {currencies.length > 1 && <TextField select size="small" label="Devise du graphique" value={selectedCurrency} onChange={(event) => setCurrencyKey(Number(event.target.value))} slotProps={{ select: { native: true } }}>
        {currencies.map(([key, currency]) => <option key={key} value={key}>{currency?.iso ?? "Devise inconnue"}</option>)}
      </TextField>}
    </div>
    <div className="history-toolbar">
      <ToggleButtonGroup exclusive size="small" value={period} onChange={(_, value) => choosePeriod(value)} aria-label="Periode du graphique">
        {([ ["1m", "1 M"], ["3m", "3 M"], ["1y", "1 A"], ["5y", "5 A"], ["all", "Tout"], ["forecast", "Previsions"] ] as const).map(([value, label]) => <ToggleButton key={value} value={value} aria-label={`Periode ${label}`}>{label}</ToggleButton>)}
      </ToggleButtonGroup>
      <div className="history-tools">
        <Tooltip title="Periode precedente"><span><IconButton aria-label="Periode precedente du graphique" disabled={range.start <= history.domain.start} onClick={() => shift(-1)}><ChevronLeft size={18} /></IconButton></span></Tooltip>
        <Tooltip title="Zoomer"><span><IconButton aria-label="Zoomer le graphique" disabled={range.end - range.start <= 1} onClick={() => chooseRange(zoomHistoryRange(range, history.domain, 0.5))}><ZoomIn size={18} /></IconButton></span></Tooltip>
        <Tooltip title="Dezoomer"><span><IconButton aria-label="Dezoomer le graphique" disabled={range.end - range.start >= history.domain.end - history.domain.start} onClick={() => chooseRange(zoomHistoryRange(range, history.domain, 2))}><ZoomOut size={18} /></IconButton></span></Tooltip>
        <Tooltip title="Reinitialiser la periode"><IconButton aria-label="Reinitialiser le graphique" onClick={() => { setPeriod("all"); setSelectedRange(null); }}><RotateCcw size={18} /></IconButton></Tooltip>
        <Tooltip title="Periode suivante"><span><IconButton aria-label="Periode suivante du graphique" disabled={range.end >= history.domain.end} onClick={() => shift(1)}><ChevronRight size={18} /></IconButton></span></Tooltip>
      </div>
    </div>
    <div className="history-dates">
      <TextField size="small" type="date" label="Du" value={hbDateToIso(range.start)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: hbDateToIso(history.domain.start), max: hbDateToIso(range.end - 1) } }}
        onChange={(event) => { const date = isoToHbDate(event.target.value); if (Number.isFinite(date) && date < range.end) chooseRange({ start: date, end: range.end }); }} />
      <TextField size="small" type="date" label="Au" value={hbDateToIso(range.end)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: hbDateToIso(range.start + 1), max: hbDateToIso(history.domain.end) } }}
        onChange={(event) => { const date = isoToHbDate(event.target.value); if (Number.isFinite(date) && date > range.start) chooseRange({ start: range.start, end: date }); }} />
      <div className="history-closing"><span>{range.end > today ? "Solde previsionnel" : "Solde"} au {formatHbDateFr(range.end)}</span><strong className={`balance-value ${aggregateBalanceTone(accounts, data.closing)}`} data-testid="history-closing-balance">{money(data.closing)}</strong></div>
    </div>
    {history.issues.length > 0 && <Alert severity="warning" className="history-warning">Prevision incomplete : {history.issues.slice(0, 3).join(" ")}{history.issues.length > 3 ? ` (+${history.issues.length - 3})` : ""}</Alert>}
    {!accounts.length ? <p className="history-empty">Aucun compte ouvert dans ce perimetre.</p> : failed ? <Alert severity="error">Graphique indisponible. Rechargez la page.</Alert> : <div className="history-plot-frame">
      <div ref={host} className="history-plot" data-ready={ready} data-point-count={data.dates.length} role="img" aria-label={`Graphique du solde. ${formatHbDateFr(range.start)} au ${formatHbDateFr(range.end)}. Solde ${money(data.closing)}.`} />
      {!ready && <div className="history-loading"><CircularProgress size={26} aria-label="Chargement du graphique" /></div>}
    </div>}
    {accounts.length > 0 && <div className="history-legend" aria-label="Legende du solde">
      <span><i className="history-swatch" style={{ borderColor: curveColor }} />Solde comptable</span>
      <span><i className="history-swatch forecast" style={{ borderColor: curveColor }} />Solde pr&eacute;visionnel</span>
      {overdraft !== undefined && <span data-testid="history-overdraft"><i className="history-swatch forecast" style={{ borderColor: theme.palette.error.main }} />D&eacute;couvert autoris&eacute; : {money(overdraft)}</span>}
    </div>}
  </section>;
}
