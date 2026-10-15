import type { WSContext } from "hono/ws";
import { describe, expect, it, vi } from "vitest";
import {
  handleWebSocketMessage,
  MAX_WEBSOCKET_MESSAGE_BYTES,
} from "../../../apps/api/src/ws/security";

function send(data: unknown) {
  const close = vi.fn();
  handleWebSocketMessage(
    { data } as MessageEvent<unknown>,
    {
      close,
    } as unknown as WSContext,
  );
  return close;
}

describe("handleWebSocketMessage limits", () => {
  it("accepts the exact keepalive and nothing else", () => {
    expect(send('{"type":"ping"}')).not.toHaveBeenCalled();
    expect(send('{"type":"pong"}')).toHaveBeenCalledWith(
      1008,
      "Unsupported message",
    );
  });

  it("closes with 1003 for a binary frame", () => {
    expect(send(new Uint8Array([1]))).toHaveBeenCalledWith(
      1003,
      "Only text keepalives are supported",
    );
  });

  it("closes with 1009 when the text is longer than the limit in characters", () => {
    expect(MAX_WEBSOCKET_MESSAGE_BYTES).toBe(64);
    expect(send("a".repeat(65))).toHaveBeenCalledWith(
      1009,
      "Message too large",
    );
    expect(send("a".repeat(64))).toHaveBeenCalledWith(
      1008,
      "Unsupported message",
    );
  });

  it("measures the limit in bytes, so a short multi-byte text is also too large", () => {
    // 33 characters, 66 UTF-8 bytes.
    const text = "é".repeat(33);
    expect(text.length).toBe(33);
    expect(send(text)).toHaveBeenCalledWith(1009, "Message too large");
    // 32 characters, exactly 64 bytes: within the limit, but not a keepalive.
    expect(send("é".repeat(32))).toHaveBeenCalledWith(
      1008,
      "Unsupported message",
    );
  });
});
