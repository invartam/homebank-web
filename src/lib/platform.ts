import { Capacitor } from "@capacitor/core";

export type DesignSystem = "material" | "apple" | "fluent";
export type OperatingSystem = "macos" | "ios" | "windows" | "android" | "chromeos" | "linux" | "unknown";
export interface BankPlatform { os: OperatingSystem; runtime: "web" | "electron" | "capacitor"; design: DesignSystem }
export interface AccessibilityPreferences { reducedTransparency: boolean; highContrast: boolean }
declare global {
  interface Window {
    homebankPlatform?: {
      readonly platform: string;
      readonly accessibility: AccessibilityPreferences;
      getAccessibility: () => Promise<AccessibilityPreferences>;
      onAccessibilityChange: (callback: (preferences: AccessibilityPreferences) => void) => () => void;
    };
  }
}

export function detectBankPlatform(signals: { electron?: string; capacitor?: string; platform?: string; userAgent?: string; touchPoints?: number }): BankPlatform {
  let os: OperatingSystem = "unknown";
  let runtime: BankPlatform["runtime"] = "web";
  if (signals.electron) {
    runtime = "electron";
    os = signals.electron === "darwin" ? "macos" : signals.electron === "win32" ? "windows" : signals.electron === "linux" ? "linux" : "unknown";
  } else if (signals.capacitor && signals.capacitor !== "web") {
    runtime = "capacitor";
    os = signals.capacitor === "ios" ? "ios" : signals.capacitor === "android" ? "android" : "unknown";
  } else {
    const platform = signals.platform ?? "";
    const agent = signals.userAgent ?? "";
    if (/CrOS/i.test(agent) || /Chrome\s?OS/i.test(platform)) os = "chromeos";
    else if (/iPhone|iPad|iPod|iOS/i.test(platform) || /iPhone|iPad|iPod/i.test(agent)) os = "ios";
    else if (/Android/i.test(platform)) os = "android";
    else if (/Win/i.test(platform)) os = "windows";
    else if (/Mac/i.test(platform)) os = (signals.touchPoints ?? 0) > 1 ? "ios" : "macos";
    else if (/Android/i.test(agent)) os = "android";
    else if (/Windows/i.test(agent)) os = "windows";
    else if (/Macintosh|Mac OS X/i.test(agent)) os = "macos";
    else if (/Linux/i.test(platform + " " + agent)) os = "linux";
  }
  return { os, runtime, design: os === "macos" || os === "ios" ? "apple" : os === "windows" ? "fluent" : "material" };
}

export function currentBankPlatform(): BankPlatform {
  const navigatorWithHints = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectBankPlatform({
    electron: import.meta.env.VITE_NATIVE_APP ? window.homebankPlatform?.platform : undefined,
    capacitor: import.meta.env.VITE_NATIVE_APP && Capacitor.isNativePlatform() ? Capacitor.getPlatform() : undefined,
    platform: navigatorWithHints.userAgentData?.platform || navigator.platform,
    userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints,
  });
}
