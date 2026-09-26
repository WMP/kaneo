import { CheckCircle2, Clock, ShieldQuestion, XCircle } from "lucide-react";

export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

export function getApprovalStatusIcon(
  approvalStatus: string,
  className = "h-[12px] w-[12px]",
) {
  switch (approvalStatus) {
    case "pending":
      return <Clock className={`${className} text-warning-foreground`} />;
    case "approved":
      return (
        <CheckCircle2 className={`${className} text-success-foreground`} />
      );
    case "rejected":
      return <XCircle className={`${className} text-destructive-foreground`} />;
    default:
      return (
        <ShieldQuestion className={`${className} text-muted-foreground`} />
      );
  }
}

// Only "pending" and "rejected" gates warrant surfacing a warning on a task
// they block: "approved" clears the gate, and "none" was never a gate.
export function isBlockingApprovalStatus(approvalStatus: string) {
  return approvalStatus === "pending" || approvalStatus === "rejected";
}
