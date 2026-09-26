import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import getTaskRelations from "@/fetchers/task-relation/get-task-relations";
import { isBlockingApprovalStatus } from "@/lib/approval";

export type ApprovalGate = {
  taskId: string;
  title: string;
  approvalStatus: string;
};

// Task Relations are fetched per-task (there is no project-wide relations
// endpoint), so this batches one query per visible task and reduces the
// results into "which gates, if any, block each task". Hard-blocking at the
// database level is out of scope for v1: this only surfaces a warning.
export function useGanttGateWarnings(taskIds: string[]) {
  const results = useQueries({
    queries: taskIds.map((taskId) => ({
      queryKey: ["task-relations", taskId],
      queryFn: () => getTaskRelations(taskId),
      enabled: !!taskId,
      staleTime: 30_000,
    })),
  });

  return useMemo(() => {
    const gatesByBlockedTask = new Map<string, ApprovalGate[]>();

    taskIds.forEach((taskId, index) => {
      const relations = results[index]?.data;
      if (!relations) return;

      for (const relation of relations) {
        if (relation.relationType !== "blocks") continue;
        // "blocks" is directional: sourceTaskId blocks targetTaskId. This
        // task is only gated when it is the target.
        if (relation.targetTaskId !== taskId) continue;
        const gateTask = relation.sourceTask;
        if (!gateTask) continue;
        if (!isBlockingApprovalStatus(gateTask.approvalStatus)) continue;

        const existing = gatesByBlockedTask.get(taskId) ?? [];
        existing.push({
          taskId: gateTask.id,
          title: gateTask.title,
          approvalStatus: gateTask.approvalStatus,
        });
        gatesByBlockedTask.set(taskId, existing);
      }
    });

    return gatesByBlockedTask;
  }, [results, taskIds]);
}
