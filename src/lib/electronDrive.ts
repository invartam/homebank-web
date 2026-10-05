import type { DriveFileRef } from "./googleDrive";

export type DesktopDriveResult<T> = { ok: true; value: T } | { ok: false; error: {
  kind: "authorization" | "api" | "generic";
  message: string; status?: number; retryable?: boolean; requiresInteraction?: boolean;
} };

declare global {
  interface Window {
    homebankDrive?: {
      readonly configured: boolean;
      authorize: (prompt: "" | "consent" | "none") => Promise<DesktopDriveResult<{ expiresAt: number }>>;
      pick: () => Promise<DesktopDriveResult<{ file: DriveFileRef; expiresAt: number }>>;
      verify: (fileId: string) => Promise<DesktopDriveResult<void>>;
      download: (fileId: string) => Promise<DesktopDriveResult<string>>;
      save: (fileId: string, xml: string) => Promise<DesktopDriveResult<void>>;
    };
  }
}

export const electronDrive = () => import.meta.env.VITE_NATIVE_APP ? window.homebankDrive : undefined;
