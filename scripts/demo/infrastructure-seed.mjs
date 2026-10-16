#!/usr/bin/env node
// Seeds a fictional infrastructure capacity scenario (docs/plans/infrastructure-capacity.md)
// through the public HTTP API: a workspace with a project lead role, a
// datacenter role, two projects with server model pools, hosts, Ceph storage
// clusters and migration tasks with VMs. Local instances only.
//
//   node scripts/demo/infrastructure-seed.mjs [--api-url http://localhost:1337] [--origin http://localhost:5173]
//
// Run it once against a fresh database: the accounts below must not exist yet.

const PASSWORD = "DemoPass123!";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const apiUrl = option("--api-url", "http://localhost:1337").replace(/\/$/, "");
const origin = option("--origin", "http://localhost:5173");

const { hostname } = new URL(apiUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
  console.error(
    `Refusing ${apiUrl}: this seed creates accounts with a known password and runs against localhost only.`,
  );
  process.exit(1);
}

const API = `${apiUrl}/api`;

async function request(cookie, method, path, body) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Origin: origin,
      "content-type": "application/json",
      Cookie: cookie ?? "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return {
    json: text ? JSON.parse(text) : null,
    cookie: response.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; "),
  };
}

async function signUp(name, email) {
  const { json, cookie } = await request("", "POST", "/auth/sign-up/email", {
    name,
    email,
    password: PASSWORD,
  });
  return { id: json.user.id, email, cookie };
}

// Dates are offsets in days from today (UTC), so the scenario always shows
// a late order, a host that arrives after its task starts and a Ceph
// shortfall.
function day(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const admin = await signUp("Amelia Grant", "infra-admin@example.com");
const lead = await signUp("Ravi Patel", "infra-lead@example.com");
const dc = await signUp("Lena Fischer", "infra-dc@example.com");

const workspace = (
  await request(admin.cookie, "POST", "/auth/organization/create", {
    name: "Cloud Migration Demo",
    slug: "cloud-migration-demo",
  })
).json;
const W = workspace.id;

await request(admin.cookie, "POST", "/auth/organization/create-role", {
  organizationId: W,
  role: "project-lead",
  permission: {
    project: ["read", "update"],
    task: ["create", "read", "update", "delete", "assign"],
    label: ["create", "read", "update"],
    workspace: ["read"],
    infrastructure: ["read", "plan", "manage"],
  },
});
await request(admin.cookie, "POST", "/auth/organization/create-role", {
  organizationId: W,
  role: "datacenter",
  permission: { workspace: ["read"], datacenter: ["read", "manage"] },
});

const createProject = async (name, slug) =>
  (
    await request(admin.cookie, "POST", "/project", {
      name,
      workspaceId: W,
      icon: "Layout",
      slug,
    })
  ).json;
const billing = await createProject("Billing", "BIL");
const portal = await createProject("Partner Portal", "PRT");

await request(admin.cookie, "POST", `/workspace/${W}/members`, {
  userId: lead.id,
  role: "member",
});
await request(admin.cookie, "POST", `/workspace/${W}/members`, {
  userId: dc.id,
  role: "datacenter",
});
await request(admin.cookie, "POST", `/project/${billing.id}/members`, {
  userId: lead.id,
  role: "project-lead",
});

// Region catalog (datacenter team). Models and clusters may only name these.
// Paris is a 3-AZ region: workload hosts there sit in PAR1, PAR2 or PAR3.
for (const [code, name, zones] of [
  ["GRA", "Gravelines", []],
  ["PAR", "Paris", ["PAR1", "PAR2", "PAR3"]],
]) {
  await request(dc.cookie, "POST", `/infrastructure/workspace/${W}/regions`, {
    code,
    name,
    zones,
  });
}

// Server model pools (project leads).
const createModel = async (user, project, body) =>
  (
    await request(
      user.cookie,
      "POST",
      `/infrastructure/project/${project.id}/models`,
      { provider: "ovh", ...body },
    )
  ).json;
await createModel(lead, billing, {
  name: "ADVANCE-2",
  family: "Advance",
  ramGb: 128,
  vcpu: 32,
  storageGb: 1920,
  regions: ["GRA"],
  leadTimeDays: 7,
});
const advance256 = await createModel(lead, billing, {
  name: "ADVANCE-2",
  family: "Advance",
  ramGb: 256,
  vcpu: 32,
  storageGb: 1920,
  regions: ["GRA"],
  leadTimeDays: 7,
});
const scale256 = await createModel(lead, billing, {
  name: "SCALE-1",
  family: "Scale",
  ramGb: 256,
  vcpu: 48,
  storageGb: 3840,
  regions: ["GRA", "PAR"],
  leadTimeDays: 21,
});
const portalScale = await createModel(admin, portal, {
  name: "SCALE-1",
  family: "Scale",
  ramGb: 256,
  vcpu: 48,
  storageGb: 3840,
  regions: ["PAR"],
  leadTimeDays: 21,
});

// One request creates `quantity` hosts, spread round-robin over `zones`
// (a region with zones needs them, a region without zones takes none).
const createHosts = async (user, project, modelId, region, options = {}) =>
  (
    await request(
      user.cookie,
      "POST",
      `/infrastructure/project/${project.id}/hosts`,
      { modelId, region, ...options },
    )
  ).json.hosts;
const [gra1, gra2] = await createHosts(lead, billing, advance256.id, "GRA", {
  quantity: 2,
});
const [par1, par2] = await createHosts(lead, billing, scale256.id, "PAR", {
  quantity: 2,
  zones: ["PAR1", "PAR2"],
});
const [portalPar1] = await createHosts(admin, portal, portalScale.id, "PAR", {
  zones: ["PAR2"],
});
const [portalPar2] = await createHosts(admin, portal, portalScale.id, "PAR", {
  zones: ["PAR3"],
});

// Ceph storage clusters (datacenter team): self-managed in PAR, an OVH
// managed service in GRA.
const clusters = `/infrastructure/workspace/${W}/storage-clusters`;
const cephPar = (
  await request(dc.cookie, "POST", clusters, {
    name: "Ceph PAR",
    region: "PAR",
    kind: "self_managed",
    ecDataChunks: 4,
    ecCodingChunks: 2,
    fillThresholdPercent: 80,
    leadTimeDays: 21,
  })
).json;
const cephGra = (
  await request(dc.cookie, "POST", clusters, {
    name: "Ceph GRA (OVH service)",
    region: "GRA",
    kind: "managed_service",
    fillThresholdPercent: 80,
    leadTimeDays: 5,
  })
).json;
for (let index = 1; index <= 3; index += 1) {
  const entry = (
    await request(dc.cookie, "POST", `${clusters}/${cephPar.id}/capacity`, {
      modelName: "STOR-2 24 TB",
      capacityGb: 24000,
    })
  ).json;
  await request(
    dc.cookie,
    "PUT",
    `${clusters}/${cephPar.id}/capacity/${entry.id}`,
    {
      status: "installed",
      availableFrom: day(-30),
      hostname: `ceph-par-0${index}`,
    },
  );
}
const graService = (
  await request(dc.cookie, "POST", `${clusters}/${cephGra.id}/capacity`, {
    capacityGb: 20000,
  })
).json;
await request(
  dc.cookie,
  "PUT",
  `${clusters}/${cephGra.id}/capacity/${graService.id}`,
  { status: "installed", availableFrom: day(-10) },
);

// Host status (datacenter team).
const setStatus = (host, body) =>
  request(
    dc.cookie,
    "PUT",
    `/infrastructure/workspace/${W}/hosts/${host.id}/status`,
    body,
  );
await setStatus(gra1, {
  status: "installed",
  availableFrom: day(-3),
  hostname: "gra-adv2-01",
});
await setStatus(par1, { status: "ordered", availableFrom: day(45) });

// Migration tasks and their VMs.
const createTask = async (user, project, title, start, due) =>
  (
    await request(user.cookie, "POST", `/task/${project.id}`, {
      title,
      description: "",
      priority: "medium",
      status: "to-do",
      startDate: `${day(start)}T00:00:00.000Z`,
      dueDate: `${day(due)}T00:00:00.000Z`,
    })
  ).json;
const putVms = (user, task, vms) =>
  request(user.cookie, "PUT", `/infrastructure/task/${task.id}/vms`, { vms });
const vm = (
  name,
  vcpu,
  ramGb,
  cephStorageGb,
  hostId,
  storageClusterId,
  localStorageGb = 0,
) => ({
  name,
  vcpu,
  ramGb,
  cephStorageGb,
  localStorageGb,
  hostId,
  storageClusterId,
});

const billingApi = await createTask(
  lead,
  billing,
  "Move billing-api (Deployment, 3 replicas)",
  5,
  9,
);
await putVms(lead, billingApi, [
  vm("k8s-billing-node-1", 16, 112, 200, gra1.id, cephGra.id),
  vm("k8s-billing-node-2", 16, 112, 200, gra2.id, cephGra.id),
  vm("k8s-billing-node-3", 16, 112, 200, gra1.id, cephGra.id),
]);
const billingDb = await createTask(
  lead,
  billing,
  "Move billing-db (PostgreSQL StatefulSet)",
  40,
  44,
);
await putVms(lead, billingDb, [
  vm("billing-db-1", 16, 128, 1500, par1.id, cephPar.id, 400),
  vm("billing-db-2", 16, 128, 1500, par2.id, cephPar.id, 400),
  vm("billing-db-backup", 4, 16, 2000, null, cephPar.id),
]);
const reporting = await createTask(lead, billing, "Move reporting VM", 12, 14);
await putVms(lead, reporting, [
  vm("report-vm-1", 8, 32, 300, gra2.id, cephGra.id),
]);
const portalMove = await createTask(
  admin,
  portal,
  "Move the partner portal",
  20,
  25,
);
await putVms(admin, portalMove, [
  vm("portal-web-1", 8, 64, 200, portalPar1.id, cephPar.id),
  vm("portal-web-2", 8, 64, 200, portalPar2.id, cephPar.id),
  vm("portal-document-archive", 8, 64, 36000, portalPar1.id, cephPar.id),
]);

console.log(
  JSON.stringify(
    {
      workspaceId: W,
      projects: { billing: billing.id, portal: portal.id },
      accounts: {
        administrator: admin.email,
        projectLead: lead.email,
        datacenter: dc.email,
        password: PASSWORD,
      },
    },
    null,
    2,
  ),
);
