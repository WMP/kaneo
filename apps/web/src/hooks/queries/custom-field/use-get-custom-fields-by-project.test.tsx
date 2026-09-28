import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useGetCustomFieldsByProject from "./use-get-custom-fields-by-project";

const getCustomFieldsByProject = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/custom-field/get-custom-fields-by-project", () => ({
  default: getCustomFieldsByProject,
}));

describe("useGetCustomFieldsByProject", () => {
  let client: QueryClient;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getCustomFieldsByProject.mockReset();
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it("fetches the effective set by default — this is what task detail, the create-task modal, and board/backlog badges all read", async () => {
    getCustomFieldsByProject.mockResolvedValue([
      { id: "effective-field", scope: "workspace", hidden: false },
    ]);

    const { result } = renderHook(
      () => useGetCustomFieldsByProject("project-1"),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getCustomFieldsByProject).toHaveBeenCalledWith({
      projectId: "project-1",
      includeHidden: false,
    });
    expect(result.current.data).toEqual([
      { id: "effective-field", scope: "workspace", hidden: false },
    ]);
  });

  it("keeps includeHidden results in a separate cache entry from the effective list", async () => {
    getCustomFieldsByProject
      .mockResolvedValueOnce([{ id: "effective-only", hidden: false }])
      .mockResolvedValueOnce([
        { id: "effective-only", hidden: false },
        { id: "hidden-field", hidden: true },
      ]);

    const effective = renderHook(
      () => useGetCustomFieldsByProject("project-1"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(effective.result.current.isSuccess).toBe(true));

    const all = renderHook(
      () => useGetCustomFieldsByProject("project-1", true),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));

    // Fetching the includeHidden list must not have reused or overwritten
    // the effective list's cache entry — every task-rendering call site
    // keeps seeing only non-hidden inherited fields.
    expect(effective.result.current.data).toEqual([
      { id: "effective-only", hidden: false },
    ]);
    expect(all.result.current.data).toEqual([
      { id: "effective-only", hidden: false },
      { id: "hidden-field", hidden: true },
    ]);
    expect(getCustomFieldsByProject).toHaveBeenLastCalledWith({
      projectId: "project-1",
      includeHidden: true,
    });
  });
});
