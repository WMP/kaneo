import { getEffectiveCustomFieldDefinitions } from "../effective-fields";

// The effective set for a project: its workspace's fields (minus the ones
// this project hides) plus the project's own fields. Pass
// `includeHidden: true` to instead get every inherited workspace field —
// hidden ones included, with their real hidden state — for the project's
// field-visibility editor.
async function getCustomFieldsByProject(
  projectId: string,
  includeHidden = false,
) {
  return getEffectiveCustomFieldDefinitions(projectId, { includeHidden });
}

export default getCustomFieldsByProject;
