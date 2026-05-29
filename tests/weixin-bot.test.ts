import { afterEach, describe, expect, it, vi } from "vitest";
import { getLanguage, setLanguageRuntime } from "../src/i18n/index.js";
import { WeixinBot, runWeixinQrLogin } from "../src/weixin/bot.js";

describe("Weixin iLink QR login", () => {
  const originalLanguage = getLanguage();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setLanguageRuntime(originalLanguage);
  });

  it("returns confirmed iLink credentials from the QR flow", async () => {
    setLanguageRuntime("EN");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("get_bot_qrcode")) {
          return new Response(
            JSON.stringify({
              qrcode: "qr-token",
              qrcode_img_content: "https://example.test/qr",
            }),
          );
        }
        return new Response(
          JSON.stringify({
            status: "confirmed",
            ilink_bot_id: "bot-account",
            bot_token: "bot-token",
            baseurl: "https://ilink-redirect.example.test",
            ilink_user_id: "owner-user",
          }),
        );
      }),
    );

    const info: string[] = [];
    await expect(
      runWeixinQrLogin({
        onInfo: (message) => info.push(message),
      }),
    ).resolves.toEqual({
      accountId: "bot-account",
      token: "bot-token",
      baseUrl: "https://ilink-redirect.example.test",
      userId: "owner-user",
    });
    expect(calls.some((url) => url.includes("get_bot_qrcode?bot_type=3"))).toBe(true);
    expect(calls.some((url) => url.includes("get_qrcode_status?qrcode=qr-token"))).toBe(true);
    const output = info.join("\n");
    expect(output).toContain("https://example.test/qr");
    expect(output).toContain("█▀▀▀▀▀▀▀█");
  });

  it("renders refreshed QR prompts after expiry", async () => {
    setLanguageRuntime("EN");
    vi.useFakeTimers();
    const calls: string[] = [];
    let qrCount = 0;
    const statuses = ["expired", "confirmed"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("get_bot_qrcode")) {
          qrCount++;
          return new Response(
            JSON.stringify({
              qrcode: `qr-token-${qrCount}`,
              qrcode_img_content: `https://example.test/qr-${qrCount}`,
            }),
          );
        }
        const status = statuses.shift();
        return new Response(
          JSON.stringify(
            status === "expired"
              ? { status }
              : {
                  status,
                  ilink_bot_id: "bot-account",
                  bot_token: "bot-token",
                  baseurl: "https://ilink-redirect.example.test",
                },
          ),
        );
      }),
    );

    const info: string[] = [];
    const promise = runWeixinQrLogin({
      onInfo: (message) => info.push(message),
      renderQr: (data) => `QR_FOR_${data}`,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toMatchObject({
      accountId: "bot-account",
      token: "bot-token",
    });

    expect(calls.filter((url) => url.includes("get_bot_qrcode"))).toHaveLength(2);
    const output = info.join("\n");
    expect(output).toContain("https://example.test/qr-2");
    expect(output).toContain("QR_FOR_https://example.test/qr-2");
    expect(output).toContain("Weixin QR refreshed (1/3). Scan this QR:");
  });

  it("falls back to URL-only prompts when terminal QR rendering fails", async () => {
    setLanguageRuntime("EN");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("get_bot_qrcode")) {
          return new Response(
            JSON.stringify({
              qrcode: "qr-token",
              qrcode_img_content: "https://example.test/qr",
            }),
          );
        }
        return new Response(
          JSON.stringify({
            status: "confirmed",
            ilink_bot_id: "bot-account",
            bot_token: "bot-token",
            baseurl: "https://ilink-redirect.example.test",
          }),
        );
      }),
    );

    const info: string[] = [];
    await runWeixinQrLogin({
      onInfo: (message) => info.push(message),
      renderQr: () => null,
    });

    const output = info.join("\n");
    expect(output).toContain("Weixin QR login: scan this URL with WeChat:");
    expect(output).toContain("https://example.test/qr");
    expect(output).not.toContain("scan this QR");
  });

  it("rejects non-Weixin iLink base URLs before sending tokens", () => {
    expect(
      () =>
        new WeixinBot({
          token: "token",
          accountId: "account",
          baseUrl: "https://example.test",
        }),
    ).toThrow("Weixin iLink baseUrl must be an HTTPS *.weixin.qq.com endpoint.");
  });
});
