import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Save } from "lucide-react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { type Account, type Transaction, type TransactionType, type Wallet, hbDateToIso, isoToHbDate } from "../lib/homebank";
import { paymodeLabels, transactionStructureLocked, transactionType, transactionTypeLabels, withTransactionType } from "../lib/wallet";

export function TransactionForm({
  wallet, accounts, categoryLabelByKey, transaction, onCancel, onSubmit, disabled = false,
}: {
  wallet: Wallet;
  accounts: Account[];
  categoryLabelByKey: Map<number, string>;
  transaction: Transaction;
  onCancel: () => void;
  onSubmit: (transaction: Transaction, payeeName: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(transaction);
  const [date, setDate] = useState(hbDateToIso(transaction.date));
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [type, setType] = useState<TransactionType>(() => transactionType(transaction));
  const [linkedAmount, setLinkedAmount] = useState(String(Math.abs(transaction.transferAmount)));
  const lockedStructure = transactionStructureLocked(wallet, transaction);
  const incoming = transactionType(transaction) === "transfer" && transaction.amount > 0;
  const isTransfer = type === "transfer";
  const source = wallet.accounts.find((account) => account.key === draft.accountKey);
  const destination = wallet.accounts.find((account) => account.key === draft.destinationAccountKey);
  const differentCurrency = isTransfer && destination && source?.currencyKey !== destination.currencyKey;
  const currencyCode = (account?: Account) => wallet.currencies.find((currency) => currency.key === account?.currencyKey)?.iso ?? "";
  const [payeeName, setPayeeName] = useState(
    transaction.payeeKey ? (wallet.payees.find((payee) => payee.key === transaction.payeeKey)?.name ?? "") : "",
  );
  const payeeListId = `payees-${transaction.id}`;
  const categoryOptions = useMemo(() => [...wallet.categories].sort((left, right) =>
    (categoryLabelByKey.get(left.key) ?? left.name).localeCompare(categoryLabelByKey.get(right.key) ?? right.name, "fr-FR"),
  ), [wallet.categories, categoryLabelByKey]);
  const structuralDisabled = disabled || lockedStructure;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const saved = lockedStructure ? draft : withTransactionType({
      ...draft, date: isoToHbDate(date),
      transferAmount: differentCurrency ? Number(linkedAmount) * (incoming ? -1 : 1) : 0,
    }, type, Number(amount), incoming);
    onSubmit(saved, payeeName);
  };

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="section-header">
        <div>
          <p className="eyebrow">Saisie</p>
          <h2>{wallet.transactions.some((item) => item.id === draft.id) ? "Modifier" : "Ajouter"} une operation</h2>
        </div>
        <Tooltip title="Retour aux operations"><IconButton type="button" onClick={onCancel} aria-label="Retour aux operations">
          <ArrowLeft size={20} />
        </IconButton></Tooltip>
      </div>
      {lockedStructure && <Alert severity="info" className="structure-notice">Ventilation ou virement incomplet / compte desactive : les montants et les comptes sont conserves.</Alert>}
      <ToggleButtonGroup className="operation-type" exclusive value={type} color="primary" disabled={structuralDisabled}
        aria-label="Type d'operation" onChange={(_, value: TransactionType | null) => { if (value) setType(value); }}>
        <ToggleButton value="expense"><ArrowUpRight size={17} />{transactionTypeLabels.expense}</ToggleButton>
        <ToggleButton value="income"><ArrowDownLeft size={17} />{transactionTypeLabels.income}</ToggleButton>
        <ToggleButton value="transfer"><ArrowLeftRight size={17} />{transactionTypeLabels.transfer}</ToggleButton>
      </ToggleButtonGroup>
      <div className="form-grid">
        <TextField id="operation-date" label="Date" type="date" required value={date} disabled={structuralDisabled}
          onChange={(event) => setDate(event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { "aria-label": "Date" } }} />
        <TextField id="operation-account" label={isTransfer ? incoming ? "Compte credite" : "Compte debite" : "Compte"} select required value={draft.accountKey} disabled={structuralDisabled}
          onChange={(event) => {
            const accountKey = Number(event.target.value);
            setDraft({ ...draft, accountKey, destinationAccountKey: draft.destinationAccountKey === accountKey ? 0 : draft.destinationAccountKey });
          }}
          slotProps={{ select: { native: true } }}>
          {accounts.map((account) => <option key={account.key} value={account.key}>{account.name}</option>)}
        </TextField>
        <TextField id="operation-amount" label="Montant" type="number" required value={amount} disabled={structuralDisabled}
          onChange={(event) => setAmount(event.target.value)}
          slotProps={{ htmlInput: { inputMode: "decimal", min: isTransfer ? "0.01" : "0", step: "0.01", "aria-label": "Montant" } }} />
        {isTransfer ? <TextField id="operation-destination" label={incoming ? "Compte debite" : "Compte credite"} select required
          value={draft.destinationAccountKey || ""} disabled={structuralDisabled}
          onChange={(event) => { setDraft({ ...draft, destinationAccountKey: Number(event.target.value) }); setLinkedAmount(""); }}
          slotProps={{ select: { native: true } }}>
          <option value="">Choisir un compte</option>
          {accounts.filter((account) => account.key !== draft.accountKey).map((account) => <option key={account.key} value={account.key}>{account.name}</option>)}
          {lockedStructure && destination && !accounts.some((account) => account.key === destination.key) && <option value={destination.key}>{destination.name}</option>}
        </TextField> : <TextField id="operation-paymode" label="Moyen" select value={draft.paymode === 5 ? 0 : draft.paymode} disabled={structuralDisabled}
          onChange={(event) => setDraft({ ...draft, paymode: Number(event.target.value) })}
          slotProps={{ select: { native: true } }}>
          {paymodeLabels.map((label, index) => index === 5 ? null : <option key={label} value={index}>{label}</option>)}
        </TextField>}
        {differentCurrency && <TextField id="operation-linked-amount" label={`Montant ${incoming ? "debite" : "credite"} (${currencyCode(destination)})`}
          type="number" required value={linkedAmount} disabled={structuralDisabled} onChange={(event) => setLinkedAmount(event.target.value)}
          slotProps={{ htmlInput: { inputMode: "decimal", min: "0.01", step: "0.01" } }} />}
        {!isTransfer && <TextField id="operation-payee" label="Tiers" value={payeeName} disabled={disabled}
          onChange={(event) => setPayeeName(event.target.value)} slotProps={{ htmlInput: { list: payeeListId } }} />}
        <datalist id={payeeListId}>
          {wallet.payees.map((payee) => <option key={payee.key} value={payee.name} />)}
        </datalist>
        <TextField id="operation-number" label="Numero" value={draft.number} disabled={disabled}
          onChange={(event) => setDraft({ ...draft, number: event.target.value })} />
        <TextField id="operation-category" label="Categorie" select value={draft.categoryKey} disabled={structuralDisabled}
          onChange={(event) => setDraft({ ...draft, categoryKey: Number(event.target.value) })}
          slotProps={{ select: { native: true } }}>
          <option value={0}>Sans categorie</option>
          {categoryOptions.map((category) => <option key={category.key} value={category.key}>{categoryLabelByKey.get(category.key) ?? category.name}</option>)}
        </TextField>
        <TextField id="operation-status" label="Statut" select value={draft.status} disabled={disabled}
          onChange={(event) => setDraft({ ...draft, status: event.target.value as Transaction["status"] })}
          slotProps={{ select: { native: true } }}>
          <option value="none">Non pointe</option>
          <option value="cleared">Pointe</option>
          <option value="reconciled">Reconcilie</option>
          <option value="void">Annule</option>
        </TextField>
        <TextField id="operation-memo" className="form-memo" label="Memo" multiline minRows={2} value={draft.memo} disabled={disabled}
          onChange={(event) => setDraft({ ...draft, memo: event.target.value })} />
      </div>
      <div className="form-actions">
        <Button type="button" onClick={onCancel} disabled={disabled}>Annuler</Button>
        <Button variant="contained" type="submit" startIcon={<Save size={18} />} disabled={disabled}>Enregistrer</Button>
      </div>
    </form>
  );
}
