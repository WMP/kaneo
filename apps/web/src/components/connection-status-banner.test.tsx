import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectivityStore } from "@/store/connectivity";

const m = vi.hoisted(() => ({
  checkApiReachable: vi.fn(async () => true),
  toastSuccess: vi.fn(),
}));

vi.mock("@/fetchers/instance/get-health", () => ({
  checkApiReachable: m.checkApiReachable,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.toastSuccess, error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { ConnectionStatusBanner } = await import("./connection-status-banner");

let queryClient: QueryClient;

function renderBanner() {
  queryClient = new QueryClient();
  vi.spyOn(queryClient, "refetchQueries").mockResolvedValue(undefined);
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectionStatusBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useConnectivityStore.setState({
    browserOffline: false,
    serverUnreachable: false,
    hasReachedServer: true,
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectionStatusBanner", () => {
  it("renders nothing while the connection is healthy", () => {
    renderBanner();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("alerts immediately when the browser goes offline", () => {
    renderBanner();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "common:connection.offlineTitle",
    );
  });

  it("alerts as soon as a request finds the server unreachable", () => {
    renderBanner();
    act(() => {
      useConnectivityStore.getState().markServerUnreachable();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "common:connection.serverUnreachableTitle",
    );
  });

  it("on a successful retry, hides the alert, refetches what is on screen and confirms", async () => {
    renderBanner();
    act(() => {
      useConnectivityStore.getState().markServerUnreachable();
    });
    m.checkApiReachable.mockResolvedValueOnce(true);

    fireEvent.click(
      screen.getByRole("button", { name: /common:connection.retry/ }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      type: "active",
    });
    expect(m.toastSuccess).toHaveBeenCalledWith("common:connection.restored");
  });

  it("does not announce recovery when the network returns but the server still does not answer", async () => {
    renderBanner();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    m.checkApiReachable.mockResolvedValueOnce(false);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "common:connection.serverUnreachableTitle",
      ),
    );
    expect(m.toastSuccess).not.toHaveBeenCalled();
    expect(queryClient.refetchQueries).not.toHaveBeenCalled();
  });
});
