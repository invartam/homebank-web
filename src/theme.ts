import { createTheme } from "@mui/material/styles";
import type { DesignSystem } from "./lib/platform";

export type ThemeMode = "light" | "dark";

const lightTokens = {
  surface: "#ffffff", canvas: "#f6f8fb", primary: "#185abc", primaryContainer: "#e8f0fe",
  text: "#202631", muted: "#626d7d", outline: "#d8dfe8", inputOutline: "#788493", focus: "#185abc",
  subtleSurface: "#f8fafc", avatarText: "#385171", avatarSurface: "#e7edf5",
  success: "#16734a", warning: "#965600", danger: "#ba3434", secondary: "#39756b",
  secondaryContainer: "#e4f1ed", subtleIcon: "#697587", hoverOutline: "#8ca3c1",
  shadow: "#23385614", hover: "#edf2fa", futureText: "#657082", futureSurface: "#f1f4f8",
  fabText: "#123b77", fabSurface: "#dce9ff", fabHover: "#cbdfff", chromeSurface: "#ffffff",
};
const darkTokens: typeof lightTokens = {
  surface: "#202326", canvas: "#16181b", primary: "#9fc2ff", primaryContainer: "#293b55",
  text: "#edf0f4", muted: "#b2bac6", outline: "#484e57", inputOutline: "#78828f", focus: "#9fc2ff",
  subtleSurface: "#292d32", avatarText: "#d0ddef", avatarSurface: "#3a4553",
  success: "#7cd7a7", warning: "#f5bd6a", danger: "#ff9898", secondary: "#91cfbe",
  secondaryContainer: "#283f39", subtleIcon: "#a3adba", hoverOutline: "#7c96b9",
  shadow: "#00000040", hover: "#2e343d", futureText: "#aab2be", futureSurface: "#282c30",
  fabText: "#d9e7ff", fabSurface: "#334a6c", fabHover: "#405d85", chromeSurface: "#202326",
};
export const bankFonts: Record<DesignSystem, string> = {
  material: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  apple: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
  fluent: '"Segoe UI Variable", "Segoe UI", Roboto, Arial, sans-serif',
};

export function bankTokens(mode: ThemeMode, design: DesignSystem = "material"): typeof lightTokens {
  const dark = mode === "dark";
  const base = dark ? darkTokens : lightTokens;
  if (design === "apple") return dark ? {
    ...base, canvas: "#151517", surface: "#242426", primary: "#9bc6ff", primaryContainer: "#28394f",
    text: "#f5f5f7", muted: "#bcbcc4", outline: "#48484e", inputOutline: "#85858e",
    subtleSurface: "#2d2d30", hover: "#333337", futureSurface: "#2b2b2e", futureText: "#b5b5bd",
    avatarSurface: "#303b4a", chromeSurface: "rgba(36, 36, 38, 0.9)",
  } : {
    ...base, canvas: "#f2f2f7", primary: "#0062cc", primaryContainer: "#e4efff",
    text: "#1d1d1f", muted: "#65656d", outline: "#d8d8de", inputOutline: "#7d7d86",
    subtleSurface: "#f6f6f8", hover: "#ececf1", futureSurface: "#f0f0f4", futureText: "#65656d",
    fabSurface: "#0062cc", fabText: "#ffffff", fabHover: "#004fa6", chromeSurface: "rgba(250, 250, 252, 0.9)",
  };
  if (design === "fluent") return dark ? {
    ...base, canvas: "#1f1f1f", surface: "#292929", primary: "#9bc6ff", primaryContainer: "#233c54",
    text: "#f5f5f5", muted: "#bdbdbd", outline: "#484848", inputOutline: "#8a8a8a",
    subtleSurface: "#303030", hover: "#383838", futureSurface: "#303030", futureText: "#bdbdbd",
    chromeSurface: "rgba(41, 41, 41, 0.94)",
  } : {
    ...base, canvas: "#f5f5f5", primary: "#0f6cbd", primaryContainer: "#e7f1fa",
    text: "#242424", muted: "#616161", outline: "#d6d6d6", inputOutline: "#767676",
    subtleSurface: "#fafafa", hover: "#ebebeb", futureSurface: "#f2f2f2", futureText: "#616161",
    fabSurface: "#0f6cbd", fabText: "#ffffff", fabHover: "#115ea3", chromeSurface: "rgba(250, 250, 250, 0.94)",
  };
  return base;
}

export function createBankTheme(mode: ThemeMode, design: DesignSystem = "material") {
  const tokens = bankTokens(mode, design);
  const dark = mode === "dark";
  const material = design === "material";
  return createTheme({
    palette: {
      mode,
      primary: { main: tokens.primary, contrastText: dark ? "#162a46" : "#ffffff" },
      secondary: { main: tokens.secondary },
      background: { default: tokens.canvas, paper: tokens.surface },
      text: { primary: tokens.text, secondary: tokens.muted }, divider: tokens.outline,
      success: { main: tokens.success }, warning: { main: tokens.warning }, error: { main: tokens.danger },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: bankFonts[design], allVariants: { letterSpacing: 0 },
      button: { textTransform: "none", fontWeight: 500, fontSize: "0.875rem" },
    },
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: !material } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: 44, borderRadius: design === "fluent" ? 4 : material ? 24 : 20, paddingInline: 18 },
          outlined: { borderColor: tokens.inputOutline },
        },
      },
      MuiIconButton: { styleOverrides: { root: { width: 44, height: 44 } } },
      MuiFab: { styleOverrides: { root: { borderRadius: design === "fluent" ? 8 : 16, boxShadow: "0 3px 10px " + tokens.shadow } } },
      MuiOutlinedInput: { styleOverrides: {
        root: { backgroundColor: tokens.surface, borderRadius: material ? 6 : design === "apple" ? 8 : 4,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: tokens.inputOutline } },
        notchedOutline: material ? {} : { "& legend": { display: "none" } },
      } },
      MuiTextField: { defaultProps: { variant: "outlined", fullWidth: true } },
      MuiInputLabel: { defaultProps: { shrink: true }, styleOverrides: {
        root: material ? {} : { position: "relative", transform: "none", marginBottom: 6, maxWidth: "100%",
          fontSize: 13, lineHeight: "20px", "&.MuiInputLabel-shrink": { transform: "none" } },
      } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500, letterSpacing: 0, borderRadius: design === "fluent" ? 4 : 20 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: design === "apple" ? 16 : 8, backgroundImage: "none" } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: "none", minHeight: 44, borderRadius: design === "fluent" ? 4 : 8 } } },
    },
  });
}
