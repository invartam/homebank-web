import { Check, CheckCheck, Pencil } from "lucide-react";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import { type Transaction, type Wallet, formatAmount, formatHbDateFr } from "../lib/homebank";
import { transactionType, transactionTypeLabels, transferLabel } from "../lib/wallet";

export function TransactionRow({
  txn,
  wallet,
  accountName,
  categoryName,
  payeeName,
  isFuture,
  readOnly = false,
  onEdit,
  onMark,
}: {
  txn: Transaction;
  wallet: Wallet;
  accountName: string;
  categoryName: string;
  payeeName?: string;
  isFuture: boolean;
  readOnly?: boolean;
  onEdit: (transaction: Transaction) => void;
  onMark: (transaction: Transaction, status: Transaction["status"]) => void;
}) {
  const type = transactionType(txn);
  const description = type === "transfer" ? transferLabel(wallet, txn) : categoryName;
  return (
    <div className={isFuture ? "transaction-row future" : "transaction-row"}>
      <ButtonBase className="transaction-main" onClick={() => onEdit(txn)} type="button" disabled={readOnly}>
        <span className="date-pill">{formatHbDateFr(txn.date, { day: "2-digit", month: "2-digit" })}</span>
        <span className="transaction-description">
          <strong>{type === "transfer" ? txn.memo || description : payeeName || txn.memo || "Operation"}</strong>
          <small>
            {accountName} - {transactionTypeLabels[type]} - {description}
          </small>
        </span>
        <span className={txn.amount < 0 ? "amount negative" : "amount positive"}>
          {formatAmount(wallet, txn.accountKey, txn.amount)}
        </span>
        {!readOnly && <Pencil size={16} className="edit-indicator" aria-hidden="true" />}
      </ButtonBase>
      <div className="transaction-actions">
        {readOnly && <span className="transaction-status">Compte clos</span>}
        {!readOnly && txn.status === "none" && (
          <Button startIcon={<Check size={16} />} size="small" onClick={() => onMark(txn, "cleared")} type="button">
            Pointer
          </Button>
        )}
        {!readOnly && txn.status !== "reconciled" && txn.status !== "void" && (
          <Button startIcon={<CheckCheck size={16} />} size="small" onClick={() => onMark(txn, "reconciled")} type="button">
            Rapprocher
          </Button>
        )}
        {txn.status === "reconciled" && <span className="transaction-status"><CheckCheck size={15} />Rapprochee</span>}
        {txn.status === "void" && <span className="transaction-status">Annulee</span>}
      </div>
    </div>
  );
}
