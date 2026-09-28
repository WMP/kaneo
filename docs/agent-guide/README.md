# Agent contracts

Start with the task matrix in [`AGENTS.md`](../../AGENTS.md). Read only the contracts for the affected surfaces. The contracts describe current behavior and how to check it. Accepted future behavior is recorded separately in the project decisions.

Paths in these contracts are relative to the repository root unless a command explicitly changes directories. Every code path names the complete path; file patterns such as a feature's `schema.ts` are patterns, not instructions to open a root-level file.

| Contract | Subject |
| --- | --- |
| [API and boundaries](api-and-boundaries.md) | Routes, permissions, integrations and MCP |
| [Web and realtime](web-and-realtime.md) | Typed client, cache, events and translation |
| [Database](database.md) | Drizzle, migration lineage and existing data |
| [Scheduling](scheduling.md) | Gantt dates, relations, cascade and calendar |
| [Deployment and release](deployment.md) | Images, self-hosting and release behavior |
| [Verification](verification.md) | Read-only checks, focused tests and broader gates |
| [Invariant index](invariants.md) | Stable IDs, mechanisms, proof and known gaps |
| [Project decisions](project-decisions.md) | Accepted direction and implementation state for scheduling, preview images and agent rules |

An invariant's status means: **enforced** when the cited mechanism and appropriate test cover its stated scope; **partial** when some paths or proof are missing; **unenforced** when there is no guard. Change the status only after checking code and tests. Preserve IDs when reorganizing documents. Put implementation examples and edge cases in their topical contracts, not in `AGENTS.md`.
