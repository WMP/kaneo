import {
  isConnectivityError,
  isGatewayUnavailableStatus,
} from "@/lib/connectivity";
import { HttpError } from "@/lib/http-error";
import { useConnectivityStore } from "@/store/connectivity";

export type ApiError = {
  message: string;
  type: "network" | "cors" | "auth" | "server" | "unknown";
  status?: number;
  originalError?: Error;
};

function httpStatusOf(error: Error): number | null {
  if (!(error instanceof HttpError) && error.name !== "HttpError") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function isBrowserOffline(): boolean {
  return (
    useConnectivityStore.getState().browserOffline ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  );
}

export function parseApiError(error: unknown): ApiError {
  if (error instanceof Error) {
    // The server answered: classify by its status, never by message text —
    // fetchers word their errors like "Failed to fetch tasks", which the
    // substring checks below would otherwise misread as a lost connection.
    const status = httpStatusOf(error);
    if (status !== null) {
      if (status === 401) {
        return {
          message: "common:error.messages.auth",
          type: "auth",
          status,
          originalError: error,
        };
      }
      if (isGatewayUnavailableStatus(status)) {
        // A proxy answered for an API that is down or unreachable.
        return {
          message: "common:error.messages.serverUnreachable",
          type: "network",
          status,
          originalError: error,
        };
      }
      if (status >= 500) {
        return {
          message: "common:error.messages.server",
          type: "server",
          status,
          originalError: error,
        };
      }
      return {
        message: "common:error.messages.unknown",
        type: "unknown",
        status,
        originalError: error,
      };
    }

    // No response at all. The browser reports "offline", "server down" and a
    // CORS rejection identically, so use what this session already knows:
    // offline means a network problem; if the API answered earlier in this
    // session, the connection was lost (not a CORS misconfiguration, which
    // would have failed from the very first request); only a first-contact
    // failure keeps the CORS/setup hint for self-hosters.
    if (isConnectivityError(error)) {
      if (isBrowserOffline()) {
        return {
          message: "common:error.messages.network",
          type: "network",
          originalError: error,
        };
      }
      if (useConnectivityStore.getState().hasReachedServer) {
        return {
          message: "common:error.messages.serverUnreachable",
          type: "network",
          originalError: error,
        };
      }
      return {
        message: "common:error.messages.cors",
        type: "cors",
        originalError: error,
      };
    }

    if (
      error.message.includes("NetworkError") ||
      error.message.includes("CORS")
    ) {
      return {
        message: "common:error.messages.cors",
        type: "cors",
        originalError: error,
      };
    }

    if (
      error.message.includes("Load failed") ||
      error.message.includes("network") ||
      error.message.includes("connection")
    ) {
      return {
        message: "common:error.messages.network",
        type: "network",
        originalError: error,
      };
    }

    if (
      error.message.includes("401") ||
      error.message.includes("unauthorized") ||
      error.message.includes("authentication")
    ) {
      return {
        message: "common:error.messages.auth",
        type: "auth",
        status: 401,
        originalError: error,
      };
    }

    // Check for server errors
    if (
      error.message.includes("500") ||
      error.message.includes("server error") ||
      error.message.includes("internal")
    ) {
      return {
        message: "common:error.messages.server",
        type: "server",
        status: 500,
        originalError: error,
      };
    }

    // Don't surface `error.message` here: this branch covers both genuine
    // API unknowns and any non-API error passed in (e.g. a React render
    // error bubbled up to ErrorBoundary), and a raw `error.message` from
    // the latter can leak internal implementation details to end users.
    // The original error is preserved on `originalError` for Sentry.
    return {
      message: "common:error.messages.unknown",
      type: "unknown",
      originalError: error,
    };
  }

  return {
    message: "common:error.messages.unknown",
    type: "unknown",
  };
}

export function getCorsTroubleshootingSteps(): string[] {
  return [
    "common:error.troubleshootingSteps.cors.checkApiRunning",
    "common:error.troubleshootingSteps.cors.checkApiUrl",
    "common:error.troubleshootingSteps.cors.verifyCorsOrigins",
    "common:error.troubleshootingSteps.cors.checkProtocol",
    "common:error.troubleshootingSteps.cors.checkAccessibility",
  ];
}

export function getNetworkTroubleshootingSteps(): string[] {
  return [
    "common:error.troubleshootingSteps.network.checkConnection",
    "common:error.troubleshootingSteps.network.verifyApiRunning",
    "common:error.troubleshootingSteps.network.tryRefresh",
    "common:error.troubleshootingSteps.network.checkFirewall",
  ];
}
