import { useState, type ReactNode } from "react";
import Pagination from "@mui/material/Pagination";
import { type Transaction } from "../lib/homebank";

const PAGE_SIZE = 50;

export function TransactionList({ transactions, children }: { transactions: Transaction[]; children: (transaction: Transaction) => ReactNode }) {
  const [selection, setSelection] = useState({ transactions, page: 1 });
  const count = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE));
  // A new filter or wallet snapshot starts at the first page, without an effect-time stale render.
  const page = selection.transactions === transactions ? Math.min(selection.page, count) : 1;
  return <>
    <div className="transaction-list">
      {transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(children)}
    </div>
    {count > 1 && <Pagination className="transaction-pagination" page={page} count={count}
      onChange={(_event, page) => setSelection({ transactions, page })} aria-label="Pages des operations"
      getItemAriaLabel={(type, page) => type === "page" ? "Page " + page : type === "next" ? "Page suivante" : type === "previous" ? "Page precedente" : type} />}
  </>;
}
