import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discordPlugin } from "../../../../apps/api/src/plugins/discord";
import {
  postToDiscord,
  sanitizeDiscordContent,
} from "../../../../apps/api/src/plugins/discord/client";
import {
  getDefaultDiscordConfig,
  normalizeDiscordConfig,
  validateDiscordConfig,
} from "../../../../apps/api/src/plugins/discord/config";
import { genericWebhookPlugin } from "../../../../apps/api/src/plugins/generic-webhook";
import { postToGenericWebhook } from "../../../../apps/api/src/plugins/generic-webhook/client";
import {
  defaultGenericWebhookEvents,
  normalizeGenericWebhookConfig,
  validateGenericWebhookConfig,
} from "../../../../apps/api/src/plugins/generic-webhook/config";
import { mattermostPlugin } from "../../../../apps/api/src/plugins/mattermost";
import { postToMattermost } from "../../../../apps/api/src/plugins/mattermost/client";
import {
  getDefaultMattermostConfig,
  normalizeMattermostConfig,
  validateMattermostConfig,
} from "../../../../apps/api/src/plugins/mattermost/config";
import { slackPlugin } from "../../../../apps/api/src/plugins/slack";
import { postToSlack } from "../../../../apps/api/src/plugins/slack/client";
import {
  getDefaultSlackConfig,
  normalizeSlackConfig,
  validateSlackConfig,
} from "../../../../apps/api/src/plugins/slack/config";
import { telegramPlugin } from "../../../../apps/api/src/plugins/telegram";
import { postToTelegram } from "../../../../apps/api/src/plugins/telegram/client";
import {
  normalizeTelegramConfig,
  validateTelegramConfig,
} from "../../../../apps/api/src/plugins/telegram/config";

const slackUrl = "https://hooks.slack.com/services/T000/B000/XXXX";
const discordUrl = "https://discord.com/api/webhooks/123/abc";
const mmUrl = "https://127.0.0.1/hooks/token";
const botToken = "123456789:ABCD0123456789abcdefghijklmnopqWXYZ";

const fetchMock = vi.fn();

function initOf(call: number): RequestInit {
  return fetchMock.mock.calls[call]?.[1] as RequestInit;
}

// A fetch that never answers on its own and fails the way fetch does when the
// request is aborted.
function hangingFetch() {
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat webhook clients", () => {
  it.each([
    ["Slack", () => postToSlack(slackUrl, { text: "hi" }), slackUrl, "Slack"],
    [
      "Discord",
      () => postToDiscord(discordUrl, { content: "hi" }),
      discordUrl,
      "Discord",
    ],
    [
      "Mattermost",
      () => postToMattermost(mmUrl, { text: "hi" }),
      mmUrl,
      "Mattermost",
    ],
  ])("%s posts JSON and accepts a 2xx answer", async (_name, run, url) => {
    fetchMock.mockResolvedValue(new Response("ok"));
    await expect(run()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      [_name === "Discord" ? "content" : "text"]: "hi",
    });
  });

  it.each([
    ["Slack", () => postToSlack(slackUrl, { text: "hi" })],
    ["Discord", () => postToDiscord(discordUrl, { content: "hi" })],
    ["Mattermost", () => postToMattermost(mmUrl, { text: "hi" })],
  ])(
    "%s reports the status and body of a failed request",
    async (name, run) => {
      fetchMock.mockResolvedValue(
        new Response("rate limited", { status: 429 }),
      );
      await expect(run()).rejects.toThrow(
        `${name} webhook request failed (429): rate limited`,
      );
    },
  );

  it.each([
    ["Slack", () => postToSlack(slackUrl, { text: "hi" })],
    ["Discord", () => postToDiscord(discordUrl, { content: "hi" })],
    ["Mattermost", () => postToMattermost(mmUrl, { text: "hi" })],
  ])("%s gives up after 10 seconds with a timeout error", async (name, run) => {
    vi.useFakeTimers();
    hangingFetch();
    const outcome = run().then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = initOf(0).signal;
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(await outcome).toBe(
      `${name} webhook request timed out after 10000ms`,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["Slack", () => postToSlack(slackUrl, { text: "hi" })],
    ["Discord", () => postToDiscord(discordUrl, { content: "hi" })],
    ["Mattermost", () => postToMattermost(mmUrl, { text: "hi" })],
  ])(
    "%s rethrows a network error unchanged and clears its timer",
    async (_name, run) => {
      vi.useFakeTimers();
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      await expect(run()).rejects.toThrow("fetch failed");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("Mattermost refuses redirects and a private destination before sending", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    await postToMattermost(mmUrl, { text: "hi" });
    expect(initOf(0).redirect).toBe("error");
    fetchMock.mockClear();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    await expect(postToMattermost(mmUrl, { text: "hi" })).rejects.toThrow(
      "non-routable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Telegram posts to the bot endpoint and requires {ok:true}", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await postToTelegram(botToken, { chat_id: "1", text: "hi" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
    );
    for (const answer of [null, "str", 5, {}, { ok: "true" }, { ok: false }]) {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(answer)));
      await expect(
        postToTelegram(botToken, { chat_id: "1", text: "hi" }),
      ).rejects.toThrow("Outbound request failed: response");
    }
  });

  it("Telegram times out without echoing the token", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const outcome = postToTelegram(botToken, { chat_id: "1", text: "hi" }).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const message = await outcome;
    expect(message).toBe("Outbound request failed: timeout");
    expect(message).not.toContain(botToken);
  });

  it("generic webhook signs only when a secret is given and refuses private targets", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    await postToGenericWebhook("https://127.0.0.1/h", { a: 1 });
    expect(initOf(0).headers).toEqual({
      "Content-Type": "application/json",
    });
    await postToGenericWebhook("https://127.0.0.1/h", { a: 1 }, "s");
    expect(
      (initOf(1).headers as Record<string, string>)["X-Kaneo-Signature"],
    ).toMatch(/^[0-9a-f]{64}$/);
    fetchMock.mockClear();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    await expect(
      postToGenericWebhook("http://127.0.0.1/h", { a: 1 }),
    ).rejects.toThrow("Outbound request failed: destination");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Discord content sanitising", () => {
  it("neutralises mass mentions, role, user, channel and emoji references", () => {
    const z = "​";
    expect(sanitizeDiscordContent("@everyone @here")).toBe(
      `@${z}everyone @${z}here`,
    );
    expect(sanitizeDiscordContent("<@&1> <@2> <@!3> <#4>")).toBe(
      `<@${z}&1> <@${z}2> <@${z}!3> <#${z}4>`,
    );
    expect(sanitizeDiscordContent("<:a:1> <a:b:2>")).toBe(
      `<:${z}a:1> <a:${z}b:2>`,
    );
    expect(sanitizeDiscordContent("plain text")).toBe("plain text");
  });
});

describe("chat plugin configuration", () => {
  it("Slack accepts only hooks.slack.com service URLs", async () => {
    expect(await validateSlackConfig({ webhookUrl: slackUrl })).toEqual({
      valid: true,
    });
    for (const webhookUrl of [
      "http://hooks.slack.com/services/T/B/X",
      "https://hooks.slack.com/services/T/B",
      "https://evil.example/services/T/B/X",
      "",
    ]) {
      expect(await validateSlackConfig({ webhookUrl })).toEqual({
        valid: false,
        errors: ["Invalid Slack webhook URL"],
      });
    }
    expect((await validateSlackConfig({})).valid).toBe(false);
    expect((await validateSlackConfig(null)).valid).toBe(false);
    expect(getDefaultSlackConfig(slackUrl)).toEqual({
      webhookUrl: slackUrl,
      events: {
        taskCreated: true,
        taskStatusChanged: true,
        taskPriorityChanged: false,
        taskTitleChanged: false,
        taskDescriptionChanged: false,
        taskCommentCreated: true,
      },
    });
    expect(
      normalizeSlackConfig({
        webhookUrl: slackUrl,
        channelName: "   ",
        events: { taskCreated: false },
      }),
    ).toMatchObject({
      channelName: undefined,
      events: { taskCreated: false, taskStatusChanged: true },
    });
  });

  it("Discord accepts discord.com and discordapp.com webhooks only", async () => {
    for (const webhookUrl of [
      discordUrl,
      "https://discordapp.com/api/webhooks/1/x",
      "https://DISCORD.com/api/webhooks/1/x",
    ]) {
      expect((await validateDiscordConfig({ webhookUrl })).valid).toBe(true);
    }
    for (const webhookUrl of [
      "http://discord.com/api/webhooks/1/x",
      "https://discord.com.evil.example/api/webhooks/1/x",
      "https://discord.com/api/webhooks/1",
      "https://discord.com/api/webhooks/1/x y",
    ]) {
      const result = await validateDiscordConfig({ webhookUrl });
      expect(result.valid, webhookUrl).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    }
    expect((await validateDiscordConfig(undefined)).valid).toBe(false);
    expect(getDefaultDiscordConfig(discordUrl).events?.taskCommentCreated).toBe(
      true,
    );
    expect(
      normalizeDiscordConfig({ webhookUrl: discordUrl, channelName: " x " })
        .channelName,
    ).toBe("x");
  });

  it("Mattermost requires https and a public destination", async () => {
    expect(await validateMattermostConfig({ webhookUrl: mmUrl })).toEqual({
      valid: true,
    });
    expect(
      await validateMattermostConfig({ webhookUrl: "http://127.0.0.1/x" }),
    ).toEqual({ valid: false, errors: ["Webhook URL must be an HTTPS URL"] });
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const refused = await validateMattermostConfig({ webhookUrl: mmUrl });
    expect(refused.valid).toBe(false);
    expect(refused.errors?.[0]).toContain("non-routable");
    expect(getDefaultMattermostConfig(mmUrl).webhookUrl).toBe(mmUrl);
    expect(
      normalizeMattermostConfig({ webhookUrl: mmUrl, channelName: "" })
        .channelName,
    ).toBeUndefined();
  });

  it("Telegram validates the token shape, chat id and thread id", () => {
    expect(validateTelegramConfig({ botToken, chatId: " 5 " })).toEqual({
      valid: true,
    });
    const invalid = (config: unknown) => validateTelegramConfig(config);
    expect(invalid({ botToken: "123:short", chatId: "5" })).toEqual({
      valid: false,
      errors: ["Enter a valid Telegram bot token"],
    });
    expect(invalid({ botToken, chatId: "   " })).toEqual({
      valid: false,
      errors: ["Chat ID is required"],
    });
    for (const threadId of [0, -1, 1.5, "7"]) {
      expect(invalid({ botToken, chatId: "5", threadId }).valid).toBe(false);
    }
    expect(invalid({ botToken, chatId: "5", threadId: 3 }).valid).toBe(true);
    expect(invalid(null).valid).toBe(false);
    expect(
      normalizeTelegramConfig({
        botToken,
        chatId: "5",
        threadId: Number.NaN,
        chatLabel: "  ",
      }),
    ).toMatchObject({ threadId: undefined, chatLabel: undefined });
  });

  it("generic webhook accepts http(s) URLs and bounds the reminder lead time", async () => {
    expect(
      await validateGenericWebhookConfig({ webhookUrl: "https://127.0.0.1/x" }),
    ).toEqual({ valid: true });
    expect(
      (await validateGenericWebhookConfig({ webhookUrl: "ftp://127.0.0.1/x" }))
        .errors,
    ).toEqual(["Webhook URL must use http or https"]);
    expect(
      (await validateGenericWebhookConfig({ webhookUrl: "not a url" })).valid,
    ).toBe(false);
    for (const dueDateReminderLeadTimeMinutes of [4, 43_201, 5.5]) {
      expect(
        (
          await validateGenericWebhookConfig({
            webhookUrl: "https://127.0.0.1/x",
            dueDateReminderLeadTimeMinutes,
          })
        ).valid,
      ).toBe(false);
    }
    for (const dueDateReminderLeadTimeMinutes of [5, 43_200]) {
      expect(
        (
          await validateGenericWebhookConfig({
            webhookUrl: "https://127.0.0.1/x",
            dueDateReminderLeadTimeMinutes,
          })
        ).valid,
      ).toBe(true);
    }
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const refused = await validateGenericWebhookConfig({
      webhookUrl: "https://127.0.0.1/x",
    });
    expect(refused.valid).toBe(false);
    expect(refused.errors?.[0]).toContain("non-routable");
  });

  it("generic webhook normalisation trims the secret and fills defaults", () => {
    expect(
      normalizeGenericWebhookConfig({
        webhookUrl: "https://x.test/h",
        secret: "  ",
      }).secret,
    ).toBeUndefined();
    expect(
      normalizeGenericWebhookConfig({
        webhookUrl: "https://x.test/h",
        secret: " s ",
      }).secret,
    ).toBe("s");
    const normalized = normalizeGenericWebhookConfig({
      webhookUrl: "https://x.test/h",
      health: { lastFailureMessage: "x" },
      events: { taskDeleted: true },
    });
    expect(normalized.health).toEqual({
      lastFailureMessage: "x",
      failureCount: 0,
    });
    expect(normalized.dueDateReminderLeadTimeMinutes).toBe(1440);
    expect(normalized.events).toEqual({
      ...defaultGenericWebhookEvents,
      taskDeleted: true,
    });
  });
});

describe("config validation never throws", () => {
  const throwing = {
    get webhookUrl(): string {
      throw new Error("getter exploded");
    },
    get botToken(): string {
      throw new Error("getter exploded");
    },
  };

  it("reports an unexpected failure as an invalid config with its message", async () => {
    for (const validate of [
      validateSlackConfig,
      validateDiscordConfig,
      validateMattermostConfig,
      validateGenericWebhookConfig,
    ]) {
      expect(await validate(throwing)).toEqual({
        valid: false,
        errors: ["getter exploded"],
      });
    }
    expect(validateTelegramConfig(throwing)).toEqual({
      valid: false,
      errors: ["getter exploded"],
    });
  });

  it("falls back to a generic message for a non-Error throw", async () => {
    const thrown = {
      get webhookUrl(): string {
        throw "plain string";
      },
    };
    expect(await validateSlackConfig(thrown)).toEqual({
      valid: false,
      errors: ["Invalid config"],
    });
  });
});

describe("plugin descriptors", () => {
  it("expose their type, name and the handlers each plugin supports", () => {
    expect([
      slackPlugin.type,
      discordPlugin.type,
      mattermostPlugin.type,
      telegramPlugin.type,
      genericWebhookPlugin.type,
    ]).toEqual([
      "slack",
      "discord",
      "mattermost",
      "telegram",
      "generic-webhook",
    ]);
    for (const plugin of [
      slackPlugin,
      discordPlugin,
      mattermostPlugin,
      telegramPlugin,
    ]) {
      expect(plugin.onTaskCreated).toBeTypeOf("function");
      expect(plugin.onTaskCommentCreated).toBeTypeOf("function");
      expect(plugin.onTaskDeleted).toBeUndefined();
      expect(plugin.onTaskMoved).toBeUndefined();
    }
    expect(genericWebhookPlugin.onTaskDeleted).toBeTypeOf("function");
    expect(genericWebhookPlugin.onTaskUnassigned).toBeTypeOf("function");
  });

  it("validateConfig delegates to the plugin's own validation", async () => {
    expect((await slackPlugin.validateConfig({ webhookUrl: "x" })).valid).toBe(
      false,
    );
    expect(
      (await slackPlugin.validateConfig({ webhookUrl: slackUrl })).valid,
    ).toBe(true);
    expect(
      (await discordPlugin.validateConfig({ webhookUrl: discordUrl })).valid,
    ).toBe(true);
    expect(
      (await mattermostPlugin.validateConfig({ webhookUrl: mmUrl })).valid,
    ).toBe(true);
    expect(
      (await telegramPlugin.validateConfig({ botToken, chatId: "1" })).valid,
    ).toBe(true);
    expect(
      (await telegramPlugin.validateConfig({ botToken: "x", chatId: "1" }))
        .valid,
    ).toBe(false);
    expect(
      (
        await genericWebhookPlugin.validateConfig({
          webhookUrl: "https://127.0.0.1/x",
        })
      ).valid,
    ).toBe(true);
  });
});
