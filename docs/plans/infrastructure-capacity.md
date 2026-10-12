# Plan: infrastructure capacity for migrations

Status: accepted by the product owner on 2026-10-12. Stages 1, 1b (Ceph storage) and 2 (capacity engine, order plan, XLSX) are implemented on `claude/gracious-bohr-oi8g60`. This plan describes the target. The [invariant index](../agent-guide/invariants.md) records what the code and tests enforce today.

## Goal

A workspace uses Kaneo to migrate systems to OVH and Azure. Each migration task moves some virtual machines (VMs). A VM can start only when the physical server (host) it goes to is delivered and installed. Project leads already decided, in their cloud cost calculators, which server models they use and which VMs go on which host. Kaneo must record these decisions, show the use of every host day by day, warn when a migration starts before its host is ready, and give the datacenter team (DC) an order plan for OVH: which models, with how much RAM, in which region, for which project, and by which date.

Out of scope: automatic placement of VMs on hosts (the calculators decide), OVH API integration, prices.

## Concepts

- **Everything is a VM.** A plain server reached over SSH and a Kubernetes node are both VMs on a physical host. DC owns the hypervisors: DC orders and installs hosts, creates or moves VMs, and then gives SSH or Kubernetes access.
- **Model pool (per project).** The server models a project may use, for example ADVANCE-2 128 GB (GRA), ADVANCE-2 256 GB (GRA), SCALE 256 GB (GRA, PAR). A model carries its RAM, vCPU (threads), storage, allowed regions, lead time in days and a hypervisor reserve (percent of RAM, default 5).
- **Host.** One unit of a model in one region, owned by one project, for example "ADVANCE-2 256 GB GRA #1". Status: `planned` (needs an order), `ordered` (DC ordered it, expected delivery date known) or `installed` (ready). A project lead creates a planned host with one click from the pool; only DC changes the status.
- **VM item.** A VM listed in a migration task: name, vCPU, RAM, Ceph storage, local storage, the host it goes to (or none yet) and the Ceph cluster that holds its Ceph storage. A task can list many VMs on different hosts. Replicas are separate VM items, so each replica is placed on its own host.
- **Ceph storage cluster (workspace, owned by DC).** Most VM disks live on Ceph, not on the host. A cluster belongs to the workspace, is shared by its projects and has one region. Two kinds: `self_managed` (DC builds Ceph on dedicated storage servers, today in PAR; its capacity entries are servers with raw capacity, protected by erasure coding k+m) and `managed_service` (Ceph bought as an OVH service, today in GRA; its capacity entries are purchased amounts). A storage server never runs VMs. Usable capacity = sum of available entries × k/(k+m) (self-managed only) × fill threshold (default 80 percent).
- **Need date of a host** = the earliest start date of a task that has a VM on the host. **Order-by date** = need date minus the model's lead time.

## Decisions

| Topic | Decision |
| --- | --- |
| Ownership and visibility | Models, hosts and VM items belong to one project. Project routes go through `workspaceAccess`, so only people with access to the project see them. There is no shared "datacenter" project. |
| Permissions | Two new resources in `@kaneo/permissions`. `infrastructure: ["read", "plan", "manage"]` is a project-level resource (evaluated in the caller's role in the project, like `task`). `datacenter: ["read", "manage"]` is a workspace-level resource (added to `WORKSPACE_LEVEL_RESOURCES`, always evaluated in the workspace role). |
| What each permission allows | `infrastructure:read`: see the pool, hosts and VM items of the project. `infrastructure:plan`: edit VM items of tasks, create planned hosts from the pool, rename hosts. `infrastructure:manage`: edit the model pool, delete planned hosts. `datacenter:read`: see hosts of every project of the workspace and the order plan, export it. `datacenter:manage`: set host status, expected delivery date and hostname. |
| Default grants | Only the built-in `owner` role gets the new statements in code. Stored `viewer`, `member` and `admin` rows are not changed, so nobody gets new rights at upgrade; an administrator grants them in the role editor. Instance administrators and owners bypass as everywhere. |
| DC and project data | A DC user may see host and VM data (project name, VM names, sizes, dates) of every project through the `datacenter` routes, without project membership. Task titles and links to tasks are shown only to callers with access to the task's project. |
| Units | RAM and storage in whole GB, vCPU in whole threads. |
| Storage | A VM's Ceph storage counts against its Ceph cluster, its local storage against its host. A model's `storage_gb` is the host's local disk. Clusters, their erasure coding, threshold and capacity entries are managed with `datacenter:manage`; a project sees only the id, name, region and kind of the workspace's clusters (`infrastructure:read`), never their capacity or other projects' use. |
| Capacity | Usable RAM of a host = model RAM × (100 − hypervisor reserve) / 100. vCPU and storage are compared without reserve. A VM uses its host from its task's start date; a task without a start date counts as "unscheduled". |
| Kubernetes | Stage 5. A cluster is a set of VM items (nodes); a workload with replicas is placed on the cluster; capacity uses the N+1 rule and a per-node reserve. Until then, Kubernetes projects list their node VMs as VM items. |
| Order export | XLSX, one sheet, grouped by order-by date, region and model (stage 2). |
| Order task in the DC project | Stage 4. Created by a DC user with their own `task:create` right in the DC project, linked by cross-project `blocks` relations to the migration tasks. Cross-project relations do not move dates today (DEC-SCHED-03), so the host availability warning remains the main signal. |

## Data model (stage 1, additive migration `<timestamp>_ganttpro_infrastructure_capacity`)

- `ganttpro_infra_model`: `id`, `project_id` (FK `project.id`, cascade), `name`, `provider` (`ovh`, `azure`, `other`), `family`, `ram_gb` (> 0), `vcpu` (> 0), `storage_gb` (>= 0), `regions` (jsonb array of region codes, at least one), `lead_time_days` (>= 0, default 0), `hypervisor_reserve_percent` (0 to 90, default 5), `position`, timestamps; index on `project_id`.
- `ganttpro_infra_host`: `id`, `project_id` (FK `project.id`, cascade), `model_id` (FK `ganttpro_infra_model.id`, restrict), `region`, `label`, `status` (`planned`, `ordered`, `installed`; default `planned`), `available_from` (date, nullable), `hostname` (nullable), timestamps; indexes on `project_id` and `model_id`.
- `ganttpro_infra_vm`: `id`, `task_id` (FK `task.id`, cascade), `host_id` (FK `ganttpro_infra_host.id`, set null), `name`, `vcpu` (>= 0), `ram_gb` (>= 0), `storage_gb` (>= 0), `position`, timestamps; indexes on `task_id` and `host_id`.
- No backfill. An older binary ignores the tables.

The API checks what the database cannot: a host's region is one of its model's regions, and a VM's host belongs to the same project as the VM's task.

## Ceph storage (stage 1b, additive migration `<timestamp>_ganttpro_infrastructure_storage`)

- `ganttpro_infra_storage_cluster`: `id`, `workspace_id` (FK, cascade), `name` (unique in the workspace), `region`, `kind` (`self_managed`, `managed_service`), `ec_data_chunks` and `ec_coding_chunks` (k and m, both required for `self_managed`, both null for `managed_service`), `fill_threshold_percent` (1 to 100, default 80), `lead_time_days` (default 0), `position`, timestamps.
- `ganttpro_infra_storage_capacity`: `id`, `cluster_id` (FK, cascade), `label`, `model_name` (nullable, the server model of a self-managed node), `capacity_gb` (> 0; raw for a node, purchased for a service), `status` (`planned`, `ordered`, `installed`), `available_from`, `hostname`, timestamps.
- `ganttpro_infra_vm` gains `ceph_storage_gb` (>= 0, default 0) and `storage_cluster_id` (FK, set null). The existing `storage_gb` column is the local storage; the API names it `localStorageGb`.
- Routes: `GET /project/{projectId}/storage-clusters` (`infrastructure:read`, id, name, region, kind only); `GET|POST /workspace/{workspaceId}/storage-clusters`, `PUT|DELETE .../{clusterId}` and `POST|PUT|DELETE .../{clusterId}/capacity[/{entryId}]` (`datacenter:read` / `datacenter:manage`). A cluster used by a VM cannot be deleted (409 `INFRA_CLUSTER_IN_USE`); capacity entries follow the host status rules (ordered needs `availableFrom`, only a planned entry can be deleted). In `PUT /task/{taskId}/vms`, a cluster of another workspace answers 400 `INFRA_CLUSTER_NOT_IN_WORKSPACE`, and a cluster in another region than the VM's host 400 `INFRA_CLUSTER_REGION_MISMATCH`.

## Capacity engine and order plan (stage 2)

Pure functions in `apps/api/src/infrastructure/capacity.ts`, no database access, unit tested in `tests/api/infrastructure/`. A VM's **start date** is its task's start date, else its due date, else none (unscheduled). VMs never leave a host, so use is a step function that rises on start dates.

- **Host capacity**: usable RAM = model RAM × (100 − reserve) / 100, vCPU = model vCPU, local storage = model storage. A host is **available** from `available_from` when `ordered` or `installed`; a `planned` host is never available.
- **Host result**: `needDate` (earliest VM start), `orderByDate` (`needDate` − model lead time), use steps `[{ date, ramGb, vcpu, localStorageGb, ramPercent }]`, `peakRamPercent`, `firstOver80Date`, `firstOver100Date` (RAM, vCPU or local storage above the threshold).
- **Cluster capacity** on a day = sum of `capacity_gb` of entries available that day × k/(k+m) (self-managed) × fill threshold. **Cluster result**: use steps of Ceph GB, `needDate`, first day over 80 and 100 percent of usable capacity, the shortfall at the last step, and a suggestion: for `self_managed` the number of nodes of the size of the latest entry (its `model_name` and `capacity_gb`) that removes the shortfall; for `managed_service` the GB to buy.
- **Warnings**: `HOST_NOT_READY` (a VM starts before its host is available, or the host is planned), `ORDER_LATE` (planned host or entry whose order-by date is before today), `OVER_80`, `OVER_100`, `VM_UNPLACED` (no host), `VM_UNSCHEDULED` (no date), `CLUSTER_NOT_READY` and `CLUSTER_SHORTFALL` (DC only).
- **Order plan rows** (DC): every planned host (`host`), every planned capacity entry and every cluster suggestion (`storage_node` in a self-managed cluster, `storage_service` in a managed one), with order-by date, need date, provider, region, model, RAM, vCPU, storage, quantity, project (hosts only) and status, sorted by order-by date, region and model.

Routes: `GET /project/{projectId}/capacity` (`infrastructure:read`, the project's hosts and warnings with task ids and titles of this project only), `GET /workspace/{workspaceId}/capacity` (`datacenter:read`, every host and cluster and the order plan, no task titles) and `GET /workspace/{workspaceId}/order-plan.xlsx` (`datacenter:read`, one sheet built with `exceljs`). `today` is a parameter of the pure functions so tests are deterministic; the routes pass the UTC date.

## Web UI (stages 3 and 4)

Every string is a static i18n key in `i18n/en-US.json`, translated into every locale in the same change. Data comes from the typed `client` through fetchers in `apps/web/src/fetchers/infrastructure/` and hooks in `apps/web/src/hooks/{queries,mutations}/infrastructure/`; mutations invalidate the affected query keys (no realtime events yet).

**Project lead (stage 3)**

- **Project settings › Infrastructure** (`settings/projects/$projectId/infrastructure.tsx`, new item in the project settings menu, shown with `infrastructureRead`): the model pool table with add/edit/delete dialogs (`infrastructureManage`) and the hosts table: label, model, region, status badge, need date, order-by date, a RAM usage bar with the peak percent (amber from 80, red over 100), VM count, and "Add host" (`infrastructurePlan`) choosing a model and one of its regions. A warnings panel lists the project's capacity warnings with links to their tasks.
- **Task details › Infrastructure** section (in `components/task/task-details-content.tsx`, shown with `infrastructureRead`): an editable table of the task's VMs (name, vCPU, RAM GB, Ceph GB, local GB, host select, Ceph cluster select filtered to the host's region), add/duplicate/remove rows, one Save that calls `PUT /task/{taskId}/vms`, and "New host" in the host select that creates a planned host from a model and region and selects it. Editing needs `infrastructurePlan`; others see a read-only table. The section shows this task's warnings (host not ready on the task's start date, unplaced VM, no date).

**Datacenter (stage 4)**

- **Workspace › Datacenter** page (`workspace/$workspaceId/datacenter.tsx`, sidebar item shown with `datacenter:read`), three tabs:
  - *Order plan*: the order plan table (late rows highlighted) and "Download XLSX".
  - *Hosts*: every host of every project with project, model, region, status, delivery date, hostname, peak RAM percent and warnings; with `datacenter:manage` a status dialog (status, expected delivery date, hostname).
  - *Ceph storage*: one card per cluster with kind, erasure coding, threshold, usable vs used, usage bar, shortfall and suggestion, the capacity entries with their status; with `datacenter:manage` create/edit/delete clusters and entries and change entry status.

## API (stage 1, `apps/api/src/infrastructure/`, mounted at `/api/infrastructure`)

| Route | Permission | Behavior |
| --- | --- | --- |
| `GET /project/{projectId}/models` | `infrastructure:read` | Pool of the project, by position. |
| `POST /project/{projectId}/models` | `infrastructure:manage` | Create a model. |
| `PUT /project/{projectId}/models/{modelId}` | `infrastructure:manage` | Update. Removing a region that a host uses: 409 `INFRA_REGION_IN_USE`. |
| `DELETE /project/{projectId}/models/{modelId}` | `infrastructure:manage` | 409 `INFRA_MODEL_IN_USE` when a host uses it. |
| `GET /project/{projectId}/hosts` | `infrastructure:read` | Hosts with their model and VM totals (count, vCPU, RAM, storage). |
| `POST /project/{projectId}/hosts` | `infrastructure:plan` | `{ modelId, region, label? }`, status `planned`. Region outside the model: 400 `INFRA_REGION_NOT_ALLOWED`. Default label: `<model name> <ram> GB <region> #<n>`, n = next free number for the model and region in the project. |
| `PUT /project/{projectId}/hosts/{hostId}` | `infrastructure:plan` | `{ label?, region? }`. A region change is allowed only while `planned`. |
| `DELETE /project/{projectId}/hosts/{hostId}` | `infrastructure:manage` | Only a `planned` host (else 409 `INFRA_HOST_LOCKED`); its VMs become unplaced. |
| `GET /task/{taskId}/vms` | `infrastructure:read` | VM items of the task with their host summary. |
| `PUT /task/{taskId}/vms` | `infrastructure:plan` | Replace the task's list in one transaction: `{ vms: [{ id?, name, vcpu, ramGb, storageGb, hostId }] }`, at most 200. A host of another project or an unknown id: 400 `INFRA_HOST_NOT_IN_PROJECT`, nothing persisted. |
| `GET /workspace/{workspaceId}/hosts` | `datacenter:read` | Hosts of every project of the workspace with project name, model, status, dates and VM totals. |
| `PUT /workspace/{workspaceId}/hosts/{hostId}/status` | `datacenter:manage` | `{ status, availableFrom?, hostname? }`. `ordered` needs `availableFrom` (expected delivery); `installed` without a date stores today. A host of another workspace: 404. |

Errors are JSON with a `code`. Stage 1 publishes no activity or realtime events; stage 3 adds them with the web UI. No MCP tool in stage 1: the data is edited in the web UI, and an MCP tool waits until the order plan exists (stage 2).

## Stages

1. Database, API and permissions as above; role editor labels; OpenAPI; integration tests for permissions, workspace boundaries, validation and cascades.
2. Capacity engine (pure, unit tested): per host and day the used and free RAM, vCPU and local storage, per Ceph cluster and day the used and usable storage; warnings (over 80 percent, over 100 percent, task starts before its host is available, host or storage entry not ordered by its order-by date). The order plan also lists the storage servers (PAR) and service purchases (GRA) needed to keep each cluster under its threshold. Order plan and XLSX export (`datacenter:read`).
3. Web UI: task section "Infrastructure", project pool settings, hosts list, "Infrastructure" tab in the workload view, warnings on the Gantt, realtime refresh, translations in every locale.
4. DC actions in the UI: status changes, the order task in a chosen DC project with `blocks` relations.
5. Kubernetes clusters and workloads.

## Verification

- Stage 1: `tests/api-integration/infrastructure-*.test.ts` against disposable PostgreSQL: a member without the permission (403), a custom role with it (allowed), a caller of another workspace (403), a DC role without project membership (allowed on `datacenter` routes, 403 on project routes), a project role with `infrastructure` but no workspace `datacenter` (403 on `datacenter` routes), rejected regions and foreign hosts with nothing persisted, model and host deletion rules, task and project deletion cascades. `pnpm openapi:check`, API typecheck, the migration journal test.
