import { CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { DriveConnection } from "../lib/walletController";

export const driveConnectionLabels: Record<DriveConnection, string> = {
  local: "Copie locale", connected: "Drive connecte", reconnecting: "Reconnexion Drive",
  disconnected: "Drive interrompu", offline: "Drive hors ligne", "auth-required": "Connexion Google requise", error: "Synchronisation bloquee",
  "file-missing": "Fichier Drive introuvable",
};

export function DriveIndicator({ connection, saving, pending, error, disabled, onReconnect, onDetails }: {
  connection: DriveConnection;
  saving: boolean;
  pending: boolean;
  error: string;
  disabled: boolean;
  onReconnect: () => void;
  onDetails: () => void;
}) {
  const working = saving || connection === "reconnecting";
  const connected = connection === "connected";
  const label = saving ? "Synchronisation Drive" : connected && pending ? "Drive : sauvegarde en attente" : driveConnectionLabels[connection];
  const icon = working ? <RefreshCw size={20} className="drive-spinner" /> : connected ? <CloudCheck size={20} /> : <CloudOff size={20} />;
  return (
    <Tooltip title={`${label}${error ? ` : ${error}` : ""}`}>
      <span className="drive-indicator-slot">
        <IconButton className="drive-indicator" data-state={connection} data-pending={pending} aria-label={connection === "file-missing" ? "Choisir un autre fichier Drive" : connected ? label : working ? label : "Reconnecter Google Drive"}
          aria-description={label} disabled={disabled || working || connection === "offline"} onClick={connected ? onDetails : onReconnect}>
          <Badge variant="dot" overlap="circular" anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>{icon}</Badge>
        </IconButton>
      </span>
    </Tooltip>
  );
}
