import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  JiraMappingConfig,
  ResolvedJiraMapping,
} from "@/fetchers/jira-integration/types";
import { MappingEditor } from "./mapping-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
  }),
}));

// No network: the editor falls back to typed values, as without a token.
vi.mock("./use-jira-editor-data", () => ({
  useJiraEditorData: ({ level }: { level: string }) => ({
    workspaceId: "ws",
    level,
    hasToken: false,
    customFields: [],
    members: [{ id: "u1", label: "Ada" }],
    projectKey: null,
  }),
}));
vi.mock("./jira-user-field", () => ({ JiraUserField: () => null }));

const k = (name: string) => `settings:jiraIntegration.mapping.${name}`;

const parent: ResolvedJiraMapping = {
  jiraProjectKey: { value: "WS", origin: "workspace" },
  issueTypeId: { value: null, origin: "default" },
  issueTypeName: { value: null, origin: "default" },
  components: { value: [], origin: "default" },
  fieldMappings: [
    {
      target: { fieldId: "summary", type: "string" },
      source: { kind: "builtin", field: "title" },
      origin: "default",
    },
    {
      target: { fieldId: "priority", type: "priority" },
      source: { kind: "builtin", field: "priority" },
      valueMap: { urgent: "Highest" },
      origin: "workspace",
    },
  ],
  statusMappings: [
    { jiraStatusName: "Done", kaneoStatus: "done", origin: "workspace" },
  ],
  userMappings: [],
  labelComponentMappings: [],
};

function setup(
  props: Partial<React.ComponentProps<typeof MappingEditor>> = {},
  config: JiraMappingConfig = {},
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <MappingEditor
      level="project"
      config={config}
      parent={parent}
      readOnly={false}
      workspaceId="ws"
      projectId="p1"
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave };
}

const save = () => screen.getByRole("button", { name: k("save") });
const originBadges = () =>
  [...document.querySelectorAll("[data-origin]")].map((node) =>
    node.getAttribute("data-origin"),
  );

afterEach(cleanup);

describe("MappingEditor inheritance", () => {
  it("shows inherited rows with their origin and nothing to save", () => {
    setup();
    expect(originBadges()).toEqual(
      expect.arrayContaining(["default", "workspace"]),
    );
    expect(screen.getAllByRole("button", { name: k("override") })).toHaveLength(
      3,
    );
    expect(save()).toBeDisabled();
  });

  it("override copies the inherited field into the own level", () => {
    const { onSave } = setup();
    // Rows: summary (default), priority (workspace), status Done.
    fireEvent.click(screen.getAllByRole("button", { name: k("override") })[1]);

    expect(
      screen.getByText(`${k("overrides")} ${k("origin.workspace")}`),
    ).toBeTruthy();
    expect(save()).toBeEnabled();
    fireEvent.click(save());

    expect(onSave).toHaveBeenCalledWith({
      fieldMappings: [
        {
          target: { fieldId: "priority", type: "priority" },
          source: { kind: "builtin", field: "priority" },
          valueMap: { urgent: "Highest" },
        },
      ],
    });
  });

  it("disable adds removal markers and restore takes them back", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: k("disable") })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: k("disable") })[1]);
    expect(screen.getAllByText(k("disabledHere"))).toHaveLength(2);

    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith({
      fieldMappings: [
        {
          target: { fieldId: "summary", type: "string" },
          source: { kind: "none" },
          disabled: true,
        },
      ],
      statusMappings: [{ jiraStatusName: "Done", kaneoStatus: null }],
    });

    fireEvent.click(screen.getAllByRole("button", { name: k("restore") })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: k("restore") })[0]);
    expect(screen.queryByText(k("disabledHere"))).toBeNull();
    expect(save()).toBeDisabled();
  });

  it("removing an override makes the row inherited again", () => {
    setup();
    const overrides = () =>
      screen.queryAllByRole("button", { name: k("override") });
    fireEvent.click(overrides()[1]);
    expect(overrides()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: k("removeOverride") }));
    expect(overrides()).toHaveLength(3);
    expect(save()).toBeDisabled();
  });

  it("an incomplete own row blocks saving", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: k("addField") }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(k("jiraFieldId")), {
      target: { value: "customfield_1" },
    });
    expect(save()).toBeEnabled();
  });
});

describe("MappingEditor levels", () => {
  it("hides the status section at the user level and never sends statuses", () => {
    const { onSave } = setup(
      { level: "user", projectId: undefined },
      { jiraProjectKey: "OWN" },
    );
    expect(screen.queryByText(k("statusesTitle"))).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: k("disable") })[0]);
    fireEvent.click(save());
    const sent = onSave.mock.calls[0][0] as JiraMappingConfig;
    expect(sent.statusMappings).toBeUndefined();
    expect(sent.jiraProjectKey).toBe("OWN");
  });

  it("shows the status section at the project level", () => {
    setup();
    expect(screen.getByText(k("statusesTitle"))).toBeTruthy();
  });

  it("read-only mode offers no actions and no save", () => {
    setup({ readOnly: true });
    expect(screen.queryByRole("button", { name: k("override") })).toBeNull();
    expect(screen.queryByRole("button", { name: k("disable") })).toBeNull();
    expect(screen.queryByRole("button", { name: k("save") })).toBeNull();
    expect(screen.getByText(k("readOnlyNotice"))).toBeTruthy();
  });

  it("discard returns to the stored config", () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: k("disable") })[0]);
    expect(screen.getByText(k("disabledHere"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: k("discard") }));
    expect(screen.queryByText(k("disabledHere"))).toBeNull();
  });
});
