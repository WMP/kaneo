import { useQuery } from "@tanstack/react-query";
import getCustomFieldsByProject from "@/fetchers/custom-field/get-custom-fields-by-project";

// includeHidden=true is a distinct query (and cache key) from the default
// effective-fields list: it returns every inherited workspace field (hidden
// ones included) plus the project's own fields, for the project's
// field-visibility editor. Existing single-argument callers keep getting the
// effective list under the original ["custom-fields", projectId] key.
function useGetCustomFieldsByProject(projectId: string, includeHidden = false) {
  return useQuery({
    queryKey: includeHidden
      ? (["custom-fields", projectId, "all"] as const)
      : (["custom-fields", projectId] as const),
    queryFn: () => getCustomFieldsByProject({ projectId, includeHidden }),
    enabled: !!projectId,
  });
}

export default useGetCustomFieldsByProject;
