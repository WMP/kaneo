import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { AnchoredToastProvider, ToastProvider } from "@/components/ui/toast";
import type { User } from "@/types/user";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  user: User | null | undefined;
}>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    // AnchoredToastProvider mounts its own portal/toast manager, separate
    // from the plain bottom-right ToastProvider below — a caller reaches for
    // it (via anchoredToastManager, not the app's usual toast() helper) only
    // when a fixed screen corner would risk covering the very control the
    // toast is confirming, positioning that one toast next to its anchor
    // element instead.
    <AnchoredToastProvider>
      <ToastProvider position="bottom-right">
        <div className="flex h-svh w-full flex-row overflow-x-hidden overflow-y-hidden bg-background scrollbar-thin scrollbar-thumb-border scrollbar-track-muted">
          <Outlet />
        </div>
      </ToastProvider>
    </AnchoredToastProvider>
  );
}

export default RootComponent;
