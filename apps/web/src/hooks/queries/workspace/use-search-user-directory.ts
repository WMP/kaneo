import { keepPreviousData, useQuery } from "@tanstack/react-query";
import searchUserDirectory from "@/fetchers/workspace/search-user-directory";

export const USER_DIRECTORY_MIN_QUERY_LENGTH = 2;

export const userDirectoryKey = (
  workspaceId: string | undefined,
  query: string,
) => ["workspace-user-directory", workspaceId, query] as const;

// Searches all accounts of the instance. `query` should already be trimmed and
// debounced by the caller; nothing is asked below two characters or when the
// directory is switched off.
function useSearchUserDirectory(
  workspaceId: string | undefined,
  query: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: userDirectoryKey(workspaceId, query),
    queryFn: () => searchUserDirectory(workspaceId ?? "", query),
    enabled:
      !!workspaceId &&
      enabled &&
      query.length >= USER_DIRECTORY_MIN_QUERY_LENGTH,
    // Keep the previous list while the next query loads, so the suggestions do
    // not flicker on every keystroke.
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    // A 403 is the answer to "is the directory on / may I search?".
    meta: { expectForbidden: true },
    retry: false,
  });
}

export default useSearchUserDirectory;
