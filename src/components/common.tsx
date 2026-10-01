import { Upload } from "lucide-react";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import type { ReactNode } from "react";

export function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="empty-state">
      <Upload size={24} />
      <p>Importe un fichier HomeBank .xhb pour commencer.</p>
      <Button variant="contained" startIcon={<Upload size={18} />} onClick={onImport}>Importer</Button>
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
