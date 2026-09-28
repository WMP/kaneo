type TaskLabel = {
  id: string;
  name: string;
  color: string;
};

type TaskExternalLink = {
  id: string;
  taskId: string;
  integrationId: string | null;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
};

type TaskCustomFieldValue = {
  fieldId: string;
  value: string | null;
};

// Exactly one of userId/resourceId is set on a server response — a real
// Kaneo account, or an account-less resource (person/equipment/material)
// from /resource. resourceId/kind are optional so existing test fixtures
// and call sites built before resources existed (which only ever set
// userId) keep compiling; treat a missing kind as "user".
type TaskAssignee = {
  userId: string | null;
  resourceId?: string | null;
  kind?: "user" | "person" | "equipment" | "material";
  name: string;
  image: string | null;
  units: number;
  work: number | null;
};

type Task = {
  id: string;
  title: string;
  number: number | null;
  description: string | null;
  descriptionDeferred?: boolean;
  status: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  isMilestone: boolean;
  baselineStartDate: string | null;
  baselineDueDate: string | null;
  // Gantt scheduling constraint: "none" (default) | "start_no_earlier_than"
  // | "finish_no_later_than" | "must_start_on". Optional so existing test
  // fixtures/mocks built before this field existed keep compiling.
  constraintType?: string;
  constraintDate?: string | null;
  // One of: none, pending, approved, rejected. Optional for the same reason
  // as assigneeImage above: some call sites build a partial Task from a
  // narrower summary (e.g. a related-task lookup) that predates this field.
  approvalStatus?: string;
  approvalNote?: string | null;
  position: number | null;
  createdAt: string;
  updatedAt?: string;
  userId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage?: string | null;
  projectId: string;
  columnId?: string | null;
  subtaskCounts?: { completed: number; total: number };
  labels?: TaskLabel[];
  externalLinks?: TaskExternalLink[];
  customFieldValues?: TaskCustomFieldValue[];
  // The task's full assignee list. userId/assigneeId/assigneeName/
  // assigneeImage mirror this list's first entry for backward
  // compatibility. Optional so fixtures/mocks built before this field
  // existed, or narrower task summaries that omit it, keep compiling.
  assignees?: TaskAssignee[];
};

export default Task;
