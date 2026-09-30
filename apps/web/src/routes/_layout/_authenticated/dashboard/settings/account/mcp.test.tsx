import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { McpSettings } from "./mcp";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://kaneo.example.com/api${path}`,
}));
vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { label?: string }) =>
      options?.label ? `${key}:${options.label}` : key,
  }),
}));

const MCP_URL = "https://kaneo.example.com/api/mcp";

describe("MCP settings page", () => {
  afterEach(cleanup);
  beforeEach(() => vi.clearAllMocks());

  it("shows the server URL and the client commands built from it", () => {
    render(<McpSettings />);

    expect(
      screen.getByLabelText("settings:mcpPage.serverUrl.title"),
    ).toHaveTextContent(MCP_URL);
    expect(
      screen.getByLabelText("settings:mcpPage.claudeCode.title"),
    ).toHaveTextContent(`claude mcp add --transport http kaneo ${MCP_URL}`);
    expect(
      screen.getByLabelText("settings:mcpPage.stdio.title"),
    ).toHaveTextContent(
      "npx -y @kaneo/mcp install --api-url https://kaneo.example.com",
    );
  });

  it("offers a copy button per command and the documentation link", () => {
    render(<McpSettings />);

    expect(
      screen.getAllByRole("button", { name: /^settings:mcpPage\.copyAria/ }),
    ).toHaveLength(8);
    const docs = screen.getByRole("link", {
      name: /settings:mcpPage\.docsLink/,
    });
    expect(docs).toHaveAttribute(
      "href",
      "https://kaneo.app/docs/core/integrations/mcp",
    );
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("copies the exact command and confirms it", async () => {
    render(<McpSettings />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:mcpPage.copyAria:settings:mcpPage.serverUrl.title",
      }),
    );

    expect(copyToClipboard).toHaveBeenCalledWith(MCP_URL);
    expect(
      await screen.findByText("settings:mcpPage.copied"),
    ).toBeInTheDocument();
  });
});
