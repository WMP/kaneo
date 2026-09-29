import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { checkApiReachable } from "@/fetchers/instance/get-health";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { useConnectivityStore } from "@/store/connectivity";

// How often the API is re-probed while it is unreachable (the browser still
// reports a network, so no "online" event will announce its return).
export const RECONNECT_PROBE_INTERVAL_MS = 10_000;

// A single app-wide notice for a lost connection. Without it a dropped Wi-Fi or
// a dead API only showed up as silently empty lists (failed queries rendered
// their empty state) until some screen surfaced a raw error. The state comes
// from useConnectivityStore, fed by the browser's online/offline events and by
// every settled request in the query/mutation caches (see query-client).
export function ConnectionStatusBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const browserOffline = useConnectivityStore((state) => state.browserOffline);
  const serverUnreachable = useConnectivityStore(
    (state) => state.serverUnreachable,
  );
  const [isChecking, setIsChecking] = useState(false);
  const unhealthy = browserOffline || serverUnreachable;

  // Probes the API and records the outcome. A successful probe also proves the
  // browser has a network, so it clears both flags together (in that order, so
  // there is no transient "healthy" state while the server is still down).
  const checkNow = useCallback(async (signal?: AbortSignal) => {
    setIsChecking(true);
    const reachable = await checkApiReachable(signal);
    if (signal?.aborted) return;
    setIsChecking(false);
    const store = useConnectivityStore.getState();
    if (reachable) {
      store.markServerReachable();
      store.setBrowserOffline(false);
    } else if (navigator.onLine !== false) {
      store.markServerUnreachable();
      store.setBrowserOffline(false);
    }
  }, []);

  // Browser network events: going offline is shown at once; coming back is
  // only announced after a probe confirms the API answers, so a Wi-Fi that
  // reconnects before DNS/VPN is ready doesn't flash "connection restored".
  useEffect(() => {
    const onOffline = () =>
      useConnectivityStore.getState().setBrowserOffline(true);
    const onOnline = () => {
      void checkNow();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [checkNow]);

  // While the API is unreachable but the browser is online, keep probing.
  useEffect(() => {
    if (browserOffline || !serverUnreachable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await checkNow(controller.signal);
      if (!controller.signal.aborted) {
        timer = setTimeout(tick, RECONNECT_PROBE_INTERVAL_MS);
      }
    };
    timer = setTimeout(tick, RECONNECT_PROBE_INTERVAL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [browserOffline, serverUnreachable, checkNow]);

  // On recovery, refetch what is on screen: queries that failed during the
  // outage (e.g. a project list that rendered empty) reload without a manual
  // page refresh.
  const wasUnhealthyRef = useRef(unhealthy);
  useEffect(() => {
    if (wasUnhealthyRef.current && !unhealthy) {
      void queryClient.refetchQueries({ type: "active" });
      toast.success(t("common:connection.restored"));
    }
    wasUnhealthyRef.current = unhealthy;
  }, [unhealthy, queryClient, t]);

  if (!unhealthy) return null;

  const Icon = browserOffline ? WifiOff : CloudOff;
  const title = browserOffline
    ? t("common:connection.offlineTitle")
    : t("common:connection.serverUnreachableTitle");
  const description = browserOffline
    ? t("common:connection.offlineDescription")
    : t("common:connection.serverUnreachableDescription");

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-2 z-[60] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-lg border border-destructive/40 bg-popover px-4 py-3 text-sm shadow-lg">
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={isChecking}
          onClick={() => {
            void checkNow();
          }}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("size-3.5", isChecking && "animate-spin")}
          />
          {isChecking
            ? t("common:connection.checking")
            : t("common:connection.retry")}
        </Button>
      </div>
    </div>
  );
}

export default ConnectionStatusBanner;
