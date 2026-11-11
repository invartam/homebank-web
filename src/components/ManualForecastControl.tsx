import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import { type Account, type Wallet, hbDateToIso, isoToHbDate } from "../lib/homebank";
import { manualForecastKey, type ManualForecasts } from "../lib/salaryForecast";

export function ManualForecastControl({ wallet, account, settings, onChange, today }: {
  wallet: Wallet; account: Account; settings: ManualForecasts; onChange: (key: string, setting: ManualForecasts[string]) => void; today: number;
}) {
  const key = manualForecastKey(wallet, account), setting = settings[key] ?? { enabled: false, until: Math.min(3652059, today + 30) };
  return <div className="manual-forecast-control">
    <FormControlLabel label="Pr&eacute;vision &agrave; date choisie" control={<Switch checked={setting.enabled} onChange={(_, enabled) => onChange(key, { ...setting, enabled })} />} />
    {setting.enabled && <TextField type="date" size="small" label="Date de pr&eacute;vision" value={hbDateToIso(setting.until)}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: hbDateToIso(today), max: "9999-12-31" } }}
      onChange={(event) => { const until = isoToHbDate(event.target.value); if (Number.isInteger(until) && until >= today && until <= 3652059) onChange(key, { ...setting, until }); }} />}
  </div>;
}
