import { asc, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import db from "../../database";
import {
  infraHostTable,
  infraModelTable,
  infraStorageCapacityTable,
  infraStorageClusterTable,
  infraVmTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import {
  type CapCluster,
  type CapHost,
  type CapVm,
  type CapWarning,
  computeCapacity,
  type OrderPlanRow,
} from "../capacity";

export const todayUtc = () => new Date().toISOString().slice(0, 10);

// The task's start date, else its due date, as a UTC calendar date.
function startOf(task: { startDate: Date | null; dueDate: Date | null }) {
  const date = task.startDate ?? task.dueDate;
  return date ? date.toISOString().slice(0, 10) : null;
}

type Scope = { projectId: string } | { workspaceId: string };

// One query per entity type: hosts with model and project, VMs with their task,
// and (workspace scope) clusters with their entries.
async function loadHosts(scope: Scope) {
  const rows = await db
    .select({
      host: infraHostTable,
      model: infraModelTable,
      projectName: projectTable.name,
    })
    .from(infraHostTable)
    .innerJoin(infraModelTable, eq(infraModelTable.id, infraHostTable.modelId))
    .innerJoin(projectTable, eq(projectTable.id, infraHostTable.projectId))
    .where(
      "projectId" in scope
        ? eq(infraHostTable.projectId, scope.projectId)
        : eq(projectTable.workspaceId, scope.workspaceId),
    )
    .orderBy(asc(infraHostTable.createdAt), asc(infraHostTable.id));
  return rows.map(({ host, model, projectName }) => ({
    id: host.id,
    label: host.label,
    projectId: host.projectId,
    projectName,
    region: host.region,
    zone: host.zone,
    status: host.status,
    availableFrom: host.availableFrom,
    hostname: host.hostname,
    model: {
      id: model.id,
      name: model.name,
      provider: model.provider,
      family: model.family,
      ramGb: model.ramGb,
      vcpu: model.vcpu,
      storageGb: model.storageGb,
      leadTimeDays: model.leadTimeDays,
      hypervisorReserveGb: model.hypervisorReserveGb,
    },
  }));
}

async function loadVms(scope: Scope) {
  const rows = await db
    .select({
      vm: infraVmTable,
      taskTitle: taskTable.title,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      clusterName: infraStorageClusterTable.name,
    })
    .from(infraVmTable)
    .innerJoin(taskTable, eq(taskTable.id, infraVmTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(
      infraStorageClusterTable,
      eq(infraStorageClusterTable.id, infraVmTable.storageClusterId),
    )
    .where(
      "projectId" in scope
        ? eq(taskTable.projectId, scope.projectId)
        : eq(projectTable.workspaceId, scope.workspaceId),
    )
    .orderBy(asc(infraVmTable.createdAt), asc(infraVmTable.id));
  return rows.map((row) => ({
    capVm: {
      id: row.vm.id,
      name: row.vm.name,
      taskId: row.vm.taskId,
      projectId: row.projectId,
      hostId: row.vm.hostId,
      storageClusterId: row.vm.storageClusterId,
      vcpu: row.vm.vcpu,
      ramGb: row.vm.ramGb,
      localStorageGb: row.vm.localStorageGb,
      cephStorageGb: row.vm.cephStorageGb,
      startDate: startOf(row),
    } satisfies CapVm,
    taskTitle: row.taskTitle,
    projectName: row.projectName,
    clusterName: row.clusterName,
  }));
}

async function loadClusters(workspaceId: string) {
  const clusters = await db
    .select()
    .from(infraStorageClusterTable)
    .where(eq(infraStorageClusterTable.workspaceId, workspaceId))
    .orderBy(
      asc(infraStorageClusterTable.position),
      asc(infraStorageClusterTable.createdAt),
    );
  if (clusters.length === 0) return [];
  const entries = await db
    .select()
    .from(infraStorageCapacityTable)
    .where(
      inArray(
        infraStorageCapacityTable.clusterId,
        clusters.map((c) => c.id),
      ),
    )
    .orderBy(
      asc(infraStorageCapacityTable.createdAt),
      asc(infraStorageCapacityTable.id),
    );
  return clusters.map(
    (c): CapCluster => ({
      id: c.id,
      name: c.name,
      region: c.region,
      kind: c.kind,
      ecDataChunks: c.ecDataChunks,
      ecCodingChunks: c.ecCodingChunks,
      fillThresholdPercent: c.fillThresholdPercent,
      leadTimeDays: c.leadTimeDays,
      entries: entries
        .filter((e) => e.clusterId === c.id)
        .map((e) => ({
          id: e.id,
          label: e.label,
          modelName: e.modelName,
          capacityGb: e.capacityGb,
          status: e.status,
          availableFrom: e.availableFrom,
          createdAt: e.createdAt.toISOString(),
        })),
    }),
  );
}

type VmRow = Awaited<ReturnType<typeof loadVms>>[number];

function hostSummary(host: CapHost & { hostname: string | null }) {
  return {
    id: host.id,
    label: host.label,
    region: host.region,
    zone: host.zone,
    status: host.status,
    availableFrom: host.availableFrom,
    hostname: host.hostname,
    projectId: host.projectId,
    projectName: host.projectName,
    model: host.model,
  };
}

// Capacity of one project: its hosts and VMs only. No cluster capacity or use
// (a project never sees them); a VM only names its cluster. Warnings carry the
// task titles of this project.
export async function getProjectCapacity(projectId: string) {
  const today = todayUtc();
  const [hosts, vmRows] = await Promise.all([
    loadHosts({ projectId }),
    loadVms({ projectId }),
  ]);
  const result = computeCapacity({
    hosts,
    vms: vmRows.map((r) => r.capVm),
    clusters: [],
    today,
  });
  const vmById = new Map(vmRows.map((r) => [r.capVm.id, r]));
  const resultOf = new Map(result.hosts.map((r) => [r.hostId, r]));
  const describe = (id: string) => {
    const row = vmById.get(id) as VmRow;
    return {
      id: row.capVm.id,
      name: row.capVm.name,
      taskId: row.capVm.taskId,
      taskTitle: row.taskTitle,
      hostId: row.capVm.hostId,
      startDate: row.capVm.startDate,
      cephStorageGb: row.capVm.cephStorageGb,
      storageCluster: row.capVm.storageClusterId
        ? { id: row.capVm.storageClusterId, name: row.clusterName ?? "" }
        : null,
    };
  };
  return {
    today,
    hosts: hosts.map((h) => ({
      host: hostSummary(h),
      result: resultOf.get(h.id) as NonNullable<
        ReturnType<typeof resultOf.get>
      >,
    })),
    warnings: result.warnings.map((w: CapWarning) => ({
      ...w,
      ...(w.vmId
        ? {
            vmName: vmById.get(w.vmId)?.capVm.name,
            taskTitle: vmById.get(w.vmId)?.taskTitle,
          }
        : {}),
    })),
    unplacedVms: result.unplacedVms.map((v) => describe(v.id)),
    unscheduledVms: result.unscheduledVms.map((v) => describe(v.id)),
  };
}

// Capacity of the whole workspace for the datacenter team. VM data is limited
// to names and project; task titles and task ids are never included.
export async function getWorkspaceCapacity(workspaceId: string) {
  const today = todayUtc();
  const [hosts, vmRows, clusters] = await Promise.all([
    loadHosts({ workspaceId }),
    loadVms({ workspaceId }),
    loadClusters(workspaceId),
  ]);
  const result = computeCapacity({
    hosts,
    vms: vmRows.map((r) => r.capVm),
    clusters,
    today,
  });
  const vmById = new Map(vmRows.map((r) => [r.capVm.id, r]));
  const hostResult = new Map(result.hosts.map((r) => [r.hostId, r]));
  const clusterResult = new Map(result.clusters.map((r) => [r.clusterId, r]));
  return {
    today,
    hosts: hosts.map((h) => ({
      host: hostSummary(h),
      result: hostResult.get(h.id) as NonNullable<
        ReturnType<typeof hostResult.get>
      >,
    })),
    clusters: clusters.map((c) => ({
      cluster: {
        id: c.id,
        name: c.name,
        region: c.region,
        kind: c.kind,
        ecDataChunks: c.ecDataChunks,
        ecCodingChunks: c.ecCodingChunks,
        fillThresholdPercent: c.fillThresholdPercent,
        leadTimeDays: c.leadTimeDays,
      },
      result: clusterResult.get(c.id) as NonNullable<
        ReturnType<typeof clusterResult.get>
      >,
    })),
    warnings: result.warnings.map((w) => {
      const { taskId: _taskId, ...rest } = w;
      const row = w.vmId ? vmById.get(w.vmId) : undefined;
      return row
        ? {
            ...rest,
            vmName: row.capVm.name,
            projectId: row.capVm.projectId,
            projectName: row.projectName,
          }
        : rest;
    }),
    orderPlan: result.orderPlan,
  };
}

const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: "Order by", key: "orderByDate", width: 12 },
  { header: "Needed by", key: "needDate", width: 12 },
  { header: "Type", key: "type", width: 16 },
  { header: "Provider", key: "provider", width: 10 },
  { header: "Region", key: "region", width: 10 },
  { header: "Zone", key: "zone", width: 10 },
  { header: "Model", key: "model", width: 20 },
  { header: "Family", key: "family", width: 14 },
  { header: "RAM (GB)", key: "ramGb", width: 10 },
  { header: "vCPU", key: "vcpu", width: 8 },
  { header: "Storage (GB)", key: "storageGb", width: 13 },
  { header: "Quantity", key: "quantity", width: 10 },
  { header: "Capacity (GB)", key: "capacityGb", width: 14 },
  { header: "Project", key: "projectName", width: 24 },
  { header: "Cluster", key: "clusterName", width: 20 },
  { header: "Labels", key: "labels", width: 40 },
  { header: "Status", key: "status", width: 10 },
  { header: "Late", key: "late", width: 8 },
];

const asDate = (value: string | null) =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

export async function buildOrderPlanWorkbook(rows: OrderPlanRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Order plan");
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };
  for (const row of rows) {
    const added = sheet.addRow({
      ...row,
      orderByDate: asDate(row.orderByDate),
      needDate: asDate(row.needDate),
      labels: row.labels.join(", "),
      late: row.late ? "yes" : "no",
    });
    for (const key of ["orderByDate", "needDate"]) {
      added.getCell(key).numFmt = "yyyy-mm-dd";
    }
    if (row.late) {
      added.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFC7CE" },
        };
      });
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function getWorkspaceSlug(workspaceId: string) {
  const [row] = await db
    .select({ slug: workspaceTable.slug })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId));
  return row?.slug ?? workspaceId;
}
