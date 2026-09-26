import { useMutation } from "@tanstack/react-query";
import exportWorkspaceActivity from "@/fetchers/workspace/export-workspace-activity";

// Triggers a browser download from the export response. Kept out of the
// mutation itself so tests can call the fetcher without touching the DOM.
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function useExportWorkspaceActivity() {
  return useMutation({
    mutationFn: exportWorkspaceActivity,
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename);
    },
  });
}

export default useExportWorkspaceActivity;
