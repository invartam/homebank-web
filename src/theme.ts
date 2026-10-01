import { createTheme } from "@mui/material/styles";

export type ThemeMode = "light" | "dark";

export function createBankTheme(mode: ThemeMode) {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: dark
        ? { main: "#9fc2ff", dark: "#78a8fa", light: "#c8dcff", contrastText: "#162a46" }
        : { main: "#185abc", dark: "#12468f", light: "#e8f0fe" },
      secondary: { main: dark ? "#91cfbe" : "#39756b" },
      background: { default: dark ? "#16181b" : "#f6f8fb", paper: dark ? "#202326" : "#ffffff" },
      text: { primary: dark ? "#edf0f4" : "#202631", secondary: dark ? "#b2bac6" : "#626d7d" },
      divider: dark ? "#3b4047" : "#e2e7ef",
      success: { main: dark ? "#7cd7a7" : "#16734a" },
      warning: { main: dark ? "#f5bd6a" : "#a15c00" },
      error: { main: dark ? "#ff9898" : "#ba3434" },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
      allVariants: { letterSpacing: 0 },
      button: { textTransform: "none", fontWeight: 500, fontSize: "0.875rem" },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: 44, borderRadius: 24, paddingInline: 20 },
          outlined: { borderColor: dark ? "#586b87" : "#c9d4e5" },
        },
      },
      MuiIconButton: { styleOverrides: { root: { width: 44, height: 44 } } },
      MuiFab: { styleOverrides: { root: { borderRadius: 16, boxShadow: dark ? "0 3px 10px #00000040" : "0 3px 10px #185abc22" } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: dark ? "#202326" : "#fff",
            borderRadius: 6,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: dark ? "#78828f" : "#aeb9c8" },
          },
        },
      },
      MuiTextField: { defaultProps: { variant: "outlined", fullWidth: true } },
      MuiInputLabel: { defaultProps: { shrink: true } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500, letterSpacing: 0 } } },
    },
  });
}
