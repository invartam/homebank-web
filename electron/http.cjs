async function readLimitedResponse(response, limit = 32 * 1024 * 1024) {
  const oversized = () => {
    const error = new Error("Fichier Drive trop volumineux.");
    error.kind = "api"; error.status = 413; error.retryable = false;
    return error;
  };
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw oversized();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw oversized();
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
module.exports = { readLimitedResponse };
