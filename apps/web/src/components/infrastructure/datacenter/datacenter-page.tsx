import { Server } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import useRegions from "@/hooks/queries/infrastructure/datacenter/use-regions";
import useStorageClusters from "@/hooks/queries/infrastructure/datacenter/use-storage-clusters";
import useWorkspaceCapacity from "@/hooks/queries/infrastructure/datacenter/use-workspace-capacity";
import useWorkspaceHosts from "@/hooks/queries/infrastructure/datacenter/use-workspace-hosts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HostsTab } from "./hosts-tab";
import { OrderPlanTab } from "./order-plan-tab";
import { RegionsTab } from "./regions-tab";
import { StorageTab } from "./storage-tab";
import { namesOf, WarningsSummary } from "./warnings";

export function DatacenterPage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { canReadDatacenter, canManageDatacenter, isCheckingPermissions } =
    useWorkspacePermission();
  const canRead = canReadDatacenter();
  const canManage = canManageDatacenter();

  // Without the permission no datacenter request is sent at all.
  const requestedWorkspaceId = canRead ? workspaceId : undefined;
  const capacity = useWorkspaceCapacity(requestedWorkspaceId);
  const hosts = useWorkspaceHosts(requestedWorkspaceId);
  const clusters = useStorageClusters(requestedWorkspaceId);
  const regions = useRegions(requestedWorkspaceId);

  const names = useMemo(
    () => (capacity.data ? namesOf(capacity.data) : undefined),
    [capacity.data],
  );

  if (isCheckingPermissions) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />;
  }

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Server />
          </EmptyMedia>
          <EmptyTitle>{t("workspace:datacenter.noAccess.title")}</EmptyTitle>
          <EmptyDescription>
            {t("workspace:datacenter.noAccess.description")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const failed =
    capacity.isError || hosts.isError || clusters.isError || regions.isError;
  if (failed) {
    return (
      <p className="rounded-md border border-destructive/25 p-4 text-sm text-muted-foreground">
        {t("workspace:datacenter.loadFailed")}
      </p>
    );
  }

  if (
    !capacity.data ||
    !hosts.data ||
    !clusters.data ||
    !regions.data ||
    !names
  ) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />;
  }

  return (
    <div className="space-y-4">
      <WarningsSummary warnings={capacity.data.warnings} names={names} />
      <Tabs defaultValue="order-plan">
        <TabsList variant="underline">
          <TabsTab value="order-plan">
            {t("workspace:datacenter.tabs.orderPlan")}
          </TabsTab>
          <TabsTab value="hosts">
            {t("workspace:datacenter.tabs.hosts")}
          </TabsTab>
          <TabsTab value="storage">
            {t("workspace:datacenter.tabs.storage")}
          </TabsTab>
          <TabsTab value="regions">
            {t("workspace:datacenter.tabs.regions")}
          </TabsTab>
        </TabsList>
        <TabsPanel value="order-plan" className="pt-2">
          <OrderPlanTab
            workspaceId={workspaceId}
            rows={capacity.data.orderPlan}
          />
        </TabsPanel>
        <TabsPanel value="hosts" className="pt-2">
          <HostsTab
            workspaceId={workspaceId}
            hosts={hosts.data}
            capacity={capacity.data}
            canManage={canManage}
          />
        </TabsPanel>
        <TabsPanel value="storage" className="pt-2">
          <StorageTab
            workspaceId={workspaceId}
            clusters={clusters.data}
            results={capacity.data.clusters}
            regions={regions.data}
            canManage={canManage}
            today={capacity.data.today}
          />
        </TabsPanel>
        <TabsPanel value="regions" className="pt-2">
          <RegionsTab
            workspaceId={workspaceId}
            regions={regions.data}
            canManage={canManage}
          />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
