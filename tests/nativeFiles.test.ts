import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareNativeFile } from "../src/lib/nativeFiles";

const mocks = vi.hoisted(() => ({ native: false, writeFile: vi.fn(), share: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("@capacitor/filesystem", () => ({ Filesystem: { writeFile: mocks.writeFile }, Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" } }));
vi.mock("@capacitor/share", () => ({ Share: { share: mocks.share } }));
beforeEach(() => { mocks.native = false; mocks.writeFile.mockReset().mockResolvedValue({ uri: "file:///cache/wallet.xhb" }); mocks.share.mockReset().mockResolvedValue({}); });
describe("native wallet export", () => {
  it("keeps browser and Electron exports on their existing download path", async () => {
    expect(await shareNativeFile("wallet.xhb", "<homebank/>" )).toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });
  it("exports UTF-8 XML through the mobile system share sheet", async () => {
    mocks.native = true;
    expect(await shareNativeFile("wallet.xhb", "<homebank/>" )).toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith({ path: "homebank-export/wallet.xhb", data: "<homebank/>", directory: "CACHE", encoding: "utf8", recursive: true });
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ["file:///cache/wallet.xhb"] }));
  });
  it("reports share failures instead of pretending the file was exported", async () => {
    mocks.native = true;
    mocks.share.mockRejectedValueOnce(new Error("Partage impossible"));
    await expect(shareNativeFile("wallet.xhb", "<homebank/>")).rejects.toThrow("Partage impossible");
  });
});
