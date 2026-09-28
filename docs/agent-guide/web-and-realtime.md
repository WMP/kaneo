# Web, realtime and translations

Use the typed client from `@kaneo/libs`, web requests in `apps/web/src/fetchers/`, and TanStack Query hooks for server state. For a mutation, check the response, query invalidation and optimistic state against a reload. Publish the appropriate event when a change drives activity, notification, integration or realtime updates; trace it from the API through WebSocket delivery to the affected project's/user's cache. The relevant patterns live under `apps/api/src/events/`, `apps/api/src/ws/` and `apps/web/src/hooks/`.

Redis is optional. A new realtime behavior must still work on one API instance without Redis, and must account for Redis fan-out if it spans API instances. For cross-project relations, both projects' subscribers may need refresh; see `apps/api/src/task-relation/controllers/create-task-relation.ts` and its second project notification.

Web copy uses static i18n keys with `i18n/en-US.json` as the source of truth. Run `pnpm i18n:check` after changing catalogs; `pnpm i18n:check:fix` can fill placeholders but does not translate them. Retain keyboard access, accessible labels and empty/error/loading states. For a user-visible drag or resize, a focused pure-function test is useful but cannot alone prove the browser interaction and persistence; run a browser scenario when those are the behavior being changed.
