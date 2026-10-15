# Upstream project-access adapters

Upstream Kaneo restricts members to selected projects with its own tables
(`workspace_member_access`, `workspace_member_project`). This fork does not
adopt that model: project access comes from `ganttpro_project_member`, see
`apps/api/src/utils/project-access.ts` and `docs/plans/project-membership.md`.

The files in this directory keep upstream's module paths and signatures, so
that upstream code merged in a later sync compiles without rewiring. Each one
delegates to the fork's access functions. Do not add upstream's write-side
modules here (replace/clear/grant/invitation access); map them to the fork's
project member API instead. `docs/upstream-sync/exceptions.md` lists the
mapping for functions that cannot be adapted, such as
`projectAccessCondition`.
