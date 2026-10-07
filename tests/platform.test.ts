import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { currentBankPlatform, detectBankPlatform } from "../src/lib/platform";
import { bankTokens, createBankTheme } from "../src/theme";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); delete window.homebankPlatform; });
describe("platform banking designs", () => {
  it.each([
    [{ electron: "darwin", platform: "Windows" }, "macos", "electron", "apple"],
    [{ electron: "win32", platform: "MacIntel" }, "windows", "electron", "fluent"],
    [{ electron: "linux", userAgent: "iPhone" }, "linux", "electron", "material"],
    [{ capacitor: "ios", userAgent: "Android" }, "ios", "capacitor", "apple"],
    [{ capacitor: "android", platform: "MacIntel" }, "android", "capacitor", "material"],
    [{ platform: "Chrome OS" }, "chromeos", "web", "material"],
    [{ platform: "Linux", userAgent: "Mozilla/5.0 CrOS x86_64" }, "chromeos", "web", "material"],
    [{ platform: "Android" }, "android", "web", "material"],
    [{ platform: "Win32" }, "windows", "web", "fluent"],
    [{ platform: "macOS" }, "macos", "web", "apple"],
    [{ platform: "MacIntel", touchPoints: 5 }, "ios", "web", "apple"],
    [{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27 like Mac OS X)" }, "ios", "web", "apple"],
    [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows", "web", "fluent"],
    [{}, "unknown", "web", "material"],
  ] as const)("detects %j without giving browser hints priority over native signals", (signals, os, runtime, design) => {
    expect(detectBankPlatform(signals)).toEqual({ os, runtime, design });
  });
  it("uses only a native bridge in a native build, and never trusts it on a normal website", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    window.homebankPlatform = { platform: "win32" } as Window["homebankPlatform"];
    vi.stubEnv("VITE_NATIVE_APP", true);
    expect(currentBankPlatform()).toEqual({ os: "windows", runtime: "electron", design: "fluent" });
    vi.stubEnv("VITE_NATIVE_APP", "");
    expect(currentBankPlatform().runtime).toBe("web");
  });
  it.each(["material", "apple", "fluent"] as const)("keeps %s money and labels readable in both modes", (design) => {
    for (const mode of ["light", "dark"] as const) {
      const tokens = bankTokens(mode, design);
      const theme = createBankTheme(mode, design);
      expect(theme.palette.background.paper).toBe(tokens.surface);
      expect(theme.palette.primary.main).toBe(tokens.primary);
      for (const foreground of [tokens.text, tokens.muted, tokens.success, tokens.warning, tokens.danger, tokens.primary, tokens.futureText]) {
        expect(contrast(foreground, tokens.surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(tokens.inputOutline, tokens.surface)).toBeGreaterThanOrEqual(3);
      expect(theme.typography.body1.letterSpacing).toBe(0);
    }
  });
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const left = luminance(a), right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
