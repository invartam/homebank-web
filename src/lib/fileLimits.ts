export const MAX_WALLET_BYTES = 32 * 1024 * 1024;
export const MAX_WALLET_MESSAGE = "Fichier HomeBank trop volumineux (32 Mo maximum).";

export function validateWalletSize(size: number) {
  if (size > MAX_WALLET_BYTES) throw new Error(MAX_WALLET_MESSAGE);
}

export async function readWalletResponse(response: Response) {
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_WALLET_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    validateWalletSize(length);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      validateWalletSize(size);
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
