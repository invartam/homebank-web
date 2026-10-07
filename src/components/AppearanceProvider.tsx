import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { bankFonts, bankTokens, createBankTheme, type ThemeMode } from "../theme";
import { currentBankPlatform, type AccessibilityPreferences, type BankPlatform } from "../lib/platform";

const STORAGE_KEY = "homebank-theme";
const TRANSPARENCY_KEY = "homebank-reduce-transparency";
const AppearanceContext = createContext<{
  mode: ThemeMode; platform: BankPlatform; toggleTheme: () => void;
  reducedTransparency: boolean; systemTransparency: boolean; toggleTransparency: () => void;
} | null>(null);

function readPreference(): ThemeMode | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [platform] = useState(currentBankPlatform);
  const [manualTransparency, setManualTransparency] = useState(() => {
    try { return localStorage.getItem(TRANSPARENCY_KEY) === "true"; } catch { return false; }
  });
  const [mediaTransparency, setMediaTransparency] = useState(() => window.matchMedia("(prefers-reduced-transparency: reduce)").matches);
  const [mediaContrast, setMediaContrast] = useState(() => window.matchMedia("(prefers-contrast: more)").matches);
  const [forcedColors, setForcedColors] = useState(() => window.matchMedia("(forced-colors: active)").matches);
  const [nativeAccessibility, setNativeAccessibility] = useState<AccessibilityPreferences>(() =>
    platform.runtime === "electron" ? window.homebankPlatform?.accessibility ?? { reducedTransparency: false, highContrast: false }
      : { reducedTransparency: false, highContrast: false });
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const mode = preference ?? (systemDark ? "dark" : "light");
  const theme = useMemo(() => createBankTheme(mode, platform.design), [mode, platform.design]);
  const systemTransparency = mediaTransparency || nativeAccessibility.reducedTransparency;
  const highContrast = mediaContrast || forcedColors || nativeAccessibility.highContrast;
  const reducedTransparency = manualTransparency || systemTransparency || highContrast;

  useEffect(() => {
    const queries = [
      { media: window.matchMedia("(prefers-reduced-transparency: reduce)"), update: setMediaTransparency },
      { media: window.matchMedia("(prefers-contrast: more)"), update: setMediaContrast },
      { media: window.matchMedia("(forced-colors: active)"), update: setForcedColors },
    ];
    const listeners = queries.map(({ media, update }) => {
      const listener = () => update(media.matches);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    });
    return () => listeners.forEach((remove) => remove());
  }, []);

  useEffect(() => {
    if (platform.runtime !== "electron" || !window.homebankPlatform) return;
    let active = true;
    const update = (preferences: AccessibilityPreferences) => { if (active) setNativeAccessibility(preferences); };
    const remove = window.homebankPlatform.onAccessibilityChange(update);
    void window.homebankPlatform.getAccessibility().then(update).catch(() => undefined);
    return () => { active = false; remove(); };
  }, [platform.runtime]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.design = platform.design;
    document.documentElement.dataset.os = platform.os;
    document.documentElement.dataset.runtime = platform.runtime;
    document.documentElement.dataset.reducedTransparency = String(reducedTransparency);
    document.documentElement.dataset.highContrast = String(highContrast);
    document.documentElement.style.setProperty("--ui-font", bankFonts[platform.design]);
    for (const [key, value] of Object.entries(bankTokens(mode, platform.design))) {
      document.documentElement.style.setProperty("--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()), value);
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.palette.background.paper);
  }, [mode, theme, platform, reducedTransparency, highContrast]);

  const toggleTheme = () => {
    const next = mode === "dark" ? "light" : "dark";
    setPreference(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The switch still works when the browser disallows persistent storage.
    }
  };

  const toggleTransparency = () => {
    const next = !manualTransparency;
    setManualTransparency(next);
    try { localStorage.setItem(TRANSPARENCY_KEY, String(next)); } catch { /* The setting still works in memory. */ }
  };

  return (
    <AppearanceContext.Provider value={{ mode, platform, toggleTheme, reducedTransparency, systemTransparency: systemTransparency || highContrast, toggleTransparency }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance requires AppearanceProvider");
  return context;
}
