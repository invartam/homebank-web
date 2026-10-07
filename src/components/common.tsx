import { FolderOpen, SearchX, Upload } from "lucide-react";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import type { ReactNode } from "react";

export function EmptyState({ onImport, hasWallet = false, message = "Aucune operation pour les comptes affiches." }: {
  onImport: () => void; hasWallet?: boolean; message?: string;
}) {
  return (
    <div className="empty-state">
      {hasWallet ? <SearchX size={24} aria-hidden="true" /> : <FolderOpen size={24} aria-hidden="true" />}
      <p>{hasWallet ? message : "Aucun fichier ouvert."}</p>
      {!hasWallet && <Button variant="contained" startIcon={<Upload size={18} />} onClick={onImport}>Importer</Button>}
    </div>
  );
}

export function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <ButtonBase className={active ? "nav-button active" : "nav-button"} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </ButtonBase>
  );
}
