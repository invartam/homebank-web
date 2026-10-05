import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";

export function ClosedAccountsToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <FormControlLabel className="closed-accounts-toggle" label="Inclure les comptes clos"
    control={<Switch size="small" checked={checked} onChange={(_event, value) => onChange(value)}
      slotProps={{ input: { role: "switch" } }} />} />;
}
