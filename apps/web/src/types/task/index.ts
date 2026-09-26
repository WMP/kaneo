type TaskLabel = {
  id: string;
  name: string;
  color: string;
};

type TaskExternalLink = {
  id: string;
  taskId: string;
  integrationId: string;
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
  labels?: TaskLabel[];
  externalLinks?: TaskExternalLink[];
  customFieldValues?: TaskCustomFieldValue[];
};

export default Task;
