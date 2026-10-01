import { Download, FilePlus2, FolderOpen, Home, Info, ListFilter, Moon, Plus, Search, Settings, Sun, Upload, WalletCards } from "lucide-react";
import Avatar from "@mui/material/Avatar";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Fab from "@mui/material/Fab";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Switch from "@mui/material/Switch";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { type Transaction, parseHomeBankXml, serializeHomeBankXml } from "./lib/homebank";
import { googleDriveConfigured } from "./lib/googleDrive";
import { newTransaction, todayHbDate } from "./lib/wallet";
import { useWallet } from "./hooks/useWallet";
import { useWalletSelectors } from "./hooks/useWalletSelectors";
import { Dashboard } from "./components/Dashboard";
import { BalanceStrip } from "./components/BalanceStrip";
import { TransactionRow } from "./components/TransactionRow";
import { TransactionForm } from "./components/TransactionForm";
import { EmptyState, NavButton } from "./components/common";
import { useAppearance } from "./components/AppearanceProvider";
import { DriveIndicator, driveConnectionLabels } from "./components/DriveIndicator";

type View = "dashboard" | "transactions" | "add" | "settings";

export function App() {
  const { mode, toggleTheme } = useAppearance();
  const { wallet, message, driveFile, driveSaving, driveConnection, driveError, busy, hydrated, pendingDriveSave, controller } = useWallet();
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [replaceDriveOpen, setReplaceDriveOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { accountByKey, payeeByKey, categoryLabelByKey, activeAccounts, transactions, balances, totals, operationSummary } =
    useWalletSelectors(wallet, query, accountFilter);
  const disabled = busy || !hydrated;

  const resetNavigation = () => {
    setAccountFilter(0);
    setQuery("");
    setEditing(null);
    setView("dashboard");
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = parseHomeBankXml(await file.text(), file.name);
      if (await controller.importWallet(parsed)) resetNavigation();
    } catch (error) {
      controller.setMessage(error instanceof Error ? error.message : "Import impossible.");
    } finally {
      input.value = "";
    }
  };

  const exportFile = () => {
    const blob = new Blob([serializeHomeBankXml(wallet)], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const basename = wallet.sourceFileName?.replace(/\.xhb$/i, "") || "homebank-web";
    link.href = url;
    link.download = `${basename}-web.xhb`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    controller.setMessage("Export .xhb genere.");
  };

  const openDriveFile = async () => {
    if (driveConnection === "file-missing") {
      setReplaceDriveOpen(true);
      return;
    }
    if (await controller.connectDrive()) resetNavigation();
  };

  const reconnectDrive = () => {
    if (driveConnection === "file-missing") setReplaceDriveOpen(true);
    else void controller.connectDrive();
  };

  const chooseDriveFile = async () => {
    setReplaceDriveOpen(false);
    if (await controller.chooseDriveFile(true)) resetNavigation();
  };

  const startAdd = () => {
    const accountKey = activeAccounts.find((account) => account.key === accountFilter)?.key ?? activeAccounts[0]?.key;
    if (!accountKey) {
      controller.setMessage("Importe un compte actif avant d'ajouter une operation.");
      return;
    }
    setEditing(newTransaction(accountKey));
    setView("add");
  };

  const editTransaction = (transaction: Transaction) => {
    setEditing(transaction);
    setView("add");
  };

  const markTransaction = (transaction: Transaction, status: Transaction["status"]) => {
    void controller.mark(transaction.id, status);
  };

  const commit = async (transaction: Transaction, payee: string) => {
    if (await controller.commit(transaction, payee)) {
      setEditing(null);
      setView("transactions");
    }
  };

  const resetLocal = async () => {
    if (await controller.reset()) {
      resetNavigation();
      setView("settings");
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      <header className="topbar">
        <div className="page-heading">
          <p className="eyebrow">HomeBank <span className="desktop-owner"> / {wallet.owner || "Mon portefeuille"}</span></p>
          <h1>{view === "dashboard" ? "Mes comptes" : view === "transactions" ? "Mes operations" : view === "add" ? "Saisie d'operation" : "Mon fichier"}</h1>
        </div>
        <div className="topbar-actions">
          {driveFile ? <DriveIndicator connection={driveConnection} saving={driveSaving} pending={pendingDriveSave} error={driveError}
            disabled={disabled} onReconnect={reconnectDrive} onDetails={() => setView("settings")} />
            : <Chip className="connection-chip" variant="outlined" icon={<FolderOpen size={16} />} label="Copie locale" onClick={() => setView("settings")} />}
          <Tooltip title={mode === "dark" ? "Passer au theme clair" : "Passer au theme sombre"}>
            <span className="theme-toggle">
              <Switch checked={mode === "dark"} onChange={toggleTheme}
                icon={<span className="theme-thumb"><Sun size={14} /></span>}
                checkedIcon={<span className="theme-thumb"><Moon size={14} /></span>}
                slotProps={{ input: { "aria-label": "Theme sombre", role: "switch" } }} />
            </span>
          </Tooltip>
          <Tooltip title="Importer un fichier .xhb"><span className="header-import">
            <IconButton className="icon-button" onClick={() => fileInput.current?.click()} aria-label="Importer un fichier .xhb" disabled={disabled}>
              <Upload size={20} />
            </IconButton>
          </span></Tooltip>
          <Avatar className="profile-avatar" aria-label={wallet.owner || "Mon portefeuille"}>{(wallet.owner || "H").slice(0, 1).toUpperCase()}</Avatar>
        </div>
        <input ref={fileInput} type="file" accept=".xhb,.xml" onChange={importFile} disabled={disabled} hidden />
        {busy && <LinearProgress className="loading-indicator" aria-label="Chargement" />}
      </header>

      <main id="main-content" aria-busy={busy}>
        <fieldset className="workspace-controls" disabled={disabled}>
          {driveConnection === "file-missing" && (
            <Alert severity="warning" className="drive-file-alert">
              <AlertTitle>Fichier Drive indisponible</AlertTitle>
              <p>{driveFile?.name} est introuvable, inaccessible ou dans la corbeille. La copie locale est conserv&eacute;e et la synchronisation est suspendue.</p>
              <Button startIcon={<FolderOpen size={18} />} onClick={() => setReplaceDriveOpen(true)} disabled={disabled}>Choisir un autre fichier Drive</Button>
            </Alert>
          )}
          {view === "dashboard" && (
            <Dashboard
              wallet={wallet}
              totalFutureBalance={totals.future}
              totalClearedBalance={totals.cleared}
              totalReconciledBalance={totals.reconciled}
              accounts={activeAccounts}
              balances={balances}
              onAccount={(key) => {
                setAccountFilter(key);
                setView("transactions");
              }}
              onImport={() => fileInput.current?.click()}
              onDriveOpen={openDriveFile}
              onAdd={startAdd}
              driveConfigured={googleDriveConfigured()}
              onOperations={() => { setAccountFilter(0); setQuery(""); setView("transactions"); }}
              onEdit={editTransaction}
            />
          )}

          {view === "transactions" && (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h2>{operationSummary.title}</h2>
                </div>
                <Tooltip title="Ajouter une operation"><IconButton className="primary-icon-button" onClick={startAdd} aria-label="Ajouter une operation">
                  <Plus size={20} />
                </IconButton></Tooltip>
              </div>

              <BalanceStrip
                wallet={wallet}
                accountKey={operationSummary.currencyAccountKey}
                reconciled={operationSummary.reconciled}
                cleared={operationSummary.cleared}
                future={operationSummary.future}
                accounts={operationSummary.accounts}
              />

              <div className="filters">
                <TextField label="Rechercher" size="small" value={query} onChange={(event) => setQuery(event.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={18} /></InputAdornment> } }} />
                <TextField select label="Compte" size="small" value={accountFilter} onChange={(event) => setAccountFilter(Number(event.target.value))}
                  slotProps={{ select: { native: true }, input: { startAdornment: <InputAdornment position="start"><ListFilter size={18} /></InputAdornment> } }}>
                    <option value={0}>Tous les comptes</option>
                    {activeAccounts.map((account) => (
                      <option key={account.key} value={account.key}>
                        {account.name}
                      </option>
                    ))}
                </TextField>
              </div>

              <div className="transaction-list">
                {transactions.map((txn) => (
                  <TransactionRow
                    key={txn.id}
                    txn={txn}
                    wallet={wallet}
                    accountName={accountByKey.get(txn.accountKey)?.name ?? "Compte"}
                    categoryName={categoryLabelByKey.get(txn.categoryKey) ?? "Sans categorie"}
                    payeeName={payeeByKey.get(txn.payeeKey)?.name}
                    isFuture={txn.date > todayHbDate()}
                    onEdit={editTransaction}
                    onMark={markTransaction}
                  />
                ))}
                {transactions.length === 0 && <EmptyState onImport={() => fileInput.current?.click()} />}
              </div>
            </section>
          )}

          {view === "add" && editing && (
            <TransactionForm
              wallet={wallet}
              accounts={activeAccounts}
              categoryLabelByKey={categoryLabelByKey}
              key={editing.id}
              transaction={editing}
              onCancel={() => {
                setEditing(null);
                setView("transactions");
              }}
              onSubmit={commit}
              disabled={disabled}
            />
          )}

          {view === "settings" && (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Fichier</p>
                  <h2>{wallet.sourceFileName ?? "Aucun fichier source"}</h2>
                </div>
              </div>
              <div className="action-grid">
                <Button variant="contained" startIcon={<Upload size={18} />} onClick={() => fileInput.current?.click()}>Importer .xhb</Button>
                <Button variant="outlined" startIcon={<FolderOpen size={18} />} onClick={driveFile ? reconnectDrive : openDriveFile} disabled={!googleDriveConfigured() || driveConnection === "reconnecting" || driveConnection === "offline"}>
                  {driveConnection === "file-missing" ? "Choisir un autre fichier Drive" : driveFile ? "Reconnecter Drive" : "Ouvrir Drive"}
                </Button>
                <Button variant="outlined" startIcon={<Download size={18} />} onClick={exportFile} disabled={activeAccounts.length === 0}>Exporter .xhb</Button>
                <Button color="error" startIcon={<FilePlus2 size={18} />} onClick={resetLocal}>Nouveau local</Button>
              </div>
              <dl className="metrics">
                <div>
                  <dt>Comptes</dt>
                  <dd>{activeAccounts.length}</dd>
                </div>
                <div>
                  <dt>Operations</dt>
                  <dd>{wallet.transactions.length}</dd>
                </div>
                <div>
                  <dt>Google Drive</dt>
                  <dd>{driveFile ? driveConnectionLabels[driveConnection] : "Non lie"}</dd>
                </div>
                <div>
                  <dt>Version fichier</dt>
                  <dd>{wallet.fileVersion}</dd>
                </div>
              </dl>
            </section>
          )}
        </fieldset>
      </main>

      <Dialog open={replaceDriveOpen} onClose={() => setReplaceDriveOpen(false)} aria-labelledby="replace-drive-title" fullWidth maxWidth="sm">
        <DialogTitle id="replace-drive-title" sx={{ fontSize: 20, lineHeight: 1.3 }}>Charger un autre fichier Drive ?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Le portefeuille sera remplac&eacute; apr&egrave;s validation du fichier choisi. Aucun fichier Drive ne sera &eacute;cras&eacute;.
          </DialogContentText>
          {pendingDriveSave && <Alert severity="warning" sx={{ mt: 2 }}>Modifications locales non synchronis&eacute;es : exportez votre copie avant de remplacer le portefeuille.</Alert>}
          {editing && <DialogContentText sx={{ mt: 2 }}>Le brouillon de saisie sera abandonn&eacute; si le nouveau fichier est charg&eacute;.</DialogContentText>}
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button startIcon={<Download size={18} />} onClick={exportFile}>Exporter la copie locale</Button>
          <Button onClick={() => setReplaceDriveOpen(false)}>Annuler</Button>
          <Button variant="contained" startIcon={<FolderOpen size={18} />} onClick={chooseDriveFile} disabled={disabled}>Choisir le fichier</Button>
        </DialogActions>
      </Dialog>

      <p className="status-line" role="status">
        <Info size={16} aria-hidden="true" />
        <span>{message}{driveFile && ` Drive: ${driveFile.name} - ${driveSaving ? "sauvegarde..." : driveConnectionLabels[driveConnection]}`}</span>
      </p>

      <nav className="bottom-nav" aria-label="Navigation principale">
        <div className="navigation-brand"><img src="/icon.svg" width="36" height="36" alt="" /><span>HomeBank<small>Mon espace bancaire</small></span></div>
        <p className="navigation-caption">Mon portefeuille</p>
        <NavButton active={view === "dashboard"} icon={<Home size={20} />} label="Comptes" onClick={() => setView("dashboard")} />
        <NavButton
          active={view === "transactions"}
          icon={<WalletCards size={20} />}
          label="Operations"
          onClick={() => setView("transactions")}
        />
        <Tooltip title="Ajouter une operation"><span className="fab-slot"><Fab variant="extended" className="fab" disabled={disabled} onClick={startAdd} aria-label="Ajouter une operation">
          <Plus size={24} /><span>Nouvelle operation</span>
        </Fab></span></Tooltip>
        <NavButton active={view === "settings"} icon={<Settings size={20} />} label="Fichier" onClick={() => setView("settings")} />
        <div className="navigation-file"><FolderOpen size={18} /><span>{wallet.sourceFileName || "Aucun fichier"}<small>{driveFile ? driveConnectionLabels[driveConnection] : "Stockage local"}</small></span></div>
      </nav>
    </div>
  );
}
