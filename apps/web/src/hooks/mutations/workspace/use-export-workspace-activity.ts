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
  // Defer revocation: revoking the object URL synchronously after click() can
  // abort the download in some browsers before they have started reading the
  // blob, which is most likely on the larger, capped exports this triggers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
