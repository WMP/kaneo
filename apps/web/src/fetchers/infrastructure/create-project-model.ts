import { client } from "@kaneo/libs";
import { readProjectApiError } from "@/lib/project-member-error";

export type InfraModelInput = {
  name: string;
  provider: "ovh" | "azure" | "other";
  family?: string | null;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  regions: string[];
  leadTimeDays: number;
  hypervisorReservePercent: number;
};

export type CreateProjectModelRequest = { projectId: string } & InfraModelInput;

async function createProjectModel({
  projectId,
  ...json
}: CreateProjectModelRequest) {
  const response = await client.infrastructure.project[
    ":projectId"
  ].models.$post({ param: { projectId }, json });
  if (!response.ok) throw await readProjectApiError(response);
  return response.json();
}

export default createProjectModel;
