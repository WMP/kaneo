import { eventContext } from "../events";

export type ActorSource = {
  actorVia: "mcp" | "api" | null;
  actorTokenHint: string | null;
};

// What the acting user authenticated with, for a user-driven activity row.
// Reads the request's event context (AsyncLocalStorage), which also reaches
// event handlers that run inside `publishEvent`. Outside a request (webhooks,
// imports, startup jobs) there is no context: both fields are null.
export function currentActorSource(): ActorSource {
  const store = eventContext.getStore();
  const via = store?.actorVia ?? null;
  return {
    actorVia: via,
    actorTokenHint: via ? (store?.actorTokenHint ?? null) : null,
  };
}
