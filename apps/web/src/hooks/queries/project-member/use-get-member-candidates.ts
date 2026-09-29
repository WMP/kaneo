import { useQuery } from "@tanstack/react-query";
import getMemberCandidates from "@/fetchers/project-member/get-member-candidates";
import { projectMemberCandidatesKey } from "@/lib/project-member-keys";

// A 403 means the caller may not add members: the answer is the gate, so it is
// not retried (the global policy already skips it) and a failure is data.
function useGetMemberCandidates(projectId: string | undefined) {
  return useQuery({
    queryKey: projectMemberCandidatesKey(projectId),
    queryFn: () => getMemberCandidates(projectId ?? ""),
    enabled: !!projectId,
    // A 403 is the answer to "may I?": not reported as a failure.
    meta: { expectForbidden: true },
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetMemberCandidates;
