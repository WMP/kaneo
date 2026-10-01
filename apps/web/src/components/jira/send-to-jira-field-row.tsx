import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { JiraDraftField } from "@/fetchers/jira-integration/types";
import { JiraUserField } from "./jira-user-field";
import { SimpleSelect, TagListInput } from "./mapping-controls";
import {
  allowedValueText,
  type DraftValue,
  describeJiraValue,
  fromDateTimeInput,
  inputKindFor,
  toDateInput,
  toDateTimeInput,
  toList,
  toText,
} from "./send-to-jira-model";

export type DraftRowContext = {
  workspaceId: string;
  deployment: "server" | "cloud";
  projectKey: string | null;
  // Jira metadata (user search) can only be read with the caller's own token.
  canSearchUsers: boolean;
};

// A number is kept as typed while it is edited ("1." or "-" are not numbers
// yet) and handed on as a number once it is one.
function NumberInput({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: DraftValue;
  invalid: boolean;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(toText(value));
  return (
    <Input
      id={id}
      size="sm"
      type="number"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number(next);
        onChange(
          next.trim() === "" || !Number.isFinite(parsed) ? null : parsed,
        );
      }}
    />
  );
}

function OriginBadge({ origin }: { origin: JiraDraftField["origin"] }) {
  const { t } = useTranslation();
  const label = {
    task: t("tasks:jira.send.origin.task"),
    default: t("tasks:jira.send.origin.default"),
    empty: t("tasks:jira.send.origin.empty"),
  }[origin];
  return (
    <Badge
      variant={origin === "empty" ? "outline" : "secondary"}
      size="sm"
      data-draft-origin={origin}
    >
      {label}
    </Badge>
  );
}

// One field of the draft: its name and Jira id, where the value comes from,
// whether Jira requires it, and an input that fits its type. `edited` tells an
// untouched row (its value still is what the mapping produced) from one the
// person changed.
export function DraftFieldRow({
  field,
  value,
  edited,
  error,
  context,
  onChange,
}: {
  field: JiraDraftField;
  value: DraftValue;
  edited: boolean;
  error?: string;
  context: DraftRowContext;
  onChange: (value: DraftValue) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const kind = inputKindFor(field.type);
  const invalid = Boolean(error);
  const allowed = (field.allowedValues ?? [])
    .map(allowedValueText)
    .filter((text) => text !== "");

  // What Jira would receive for an untouched row, when that is not the text in
  // the input (a priority of "urgent" is sent as "Highest").
  const sentAs = edited ? null : describeJiraValue(field.jiraValue);
  const showSentAs = sentAs !== null && sentAs !== toText(value);

  // The composite controls below carry their own accessible name.
  let usesInputId = true;
  let input: React.ReactNode;
  switch (kind) {
    case "textarea":
      input = (
        <Textarea
          id={inputId}
          size="sm"
          rows={4}
          value={toText(value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      );
      break;
    case "number":
      input = (
        <NumberInput
          id={inputId}
          value={value}
          invalid={invalid}
          onChange={onChange}
        />
      );
      break;
    case "date":
      input = (
        <Input
          id={inputId}
          size="sm"
          type="date"
          value={toDateInput(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value || null)}
        />
      );
      break;
    case "datetime":
      input = (
        <Input
          id={inputId}
          size="sm"
          type="datetime-local"
          value={toDateTimeInput(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(fromDateTimeInput(event.target.value))}
        />
      );
      break;
    case "select": {
      if (allowed.length > 0) {
        usesInputId = false;
        // An untouched row shows the allowed value its Jira value equals, so a
        // Kaneo "urgent" reads as the "Highest" it will become.
        const matched = edited
          ? undefined
          : allowed.find(
              (option) => option.toLowerCase() === sentAs?.toLowerCase(),
            );
        input = (
          <SimpleSelect
            value={matched ?? toText(value)}
            onChange={onChange}
            options={allowed.map((option) => ({
              value: option,
              label: option,
            }))}
            placeholder={t("tasks:jira.send.selectPlaceholder")}
            ariaLabel={field.fieldName}
            invalid={invalid}
          />
        );
        break;
      }
      input = (
        <Input
          id={inputId}
          size="sm"
          value={toText(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      );
      break;
    }
    case "multi":
      usesInputId = false;
      input = (
        <TagListInput
          value={toList(value)}
          onChange={onChange}
          suggestions={allowed}
          ariaLabel={field.fieldName}
          placeholder={t("tasks:jira.send.multiPlaceholder")}
        />
      );
      break;
    case "users":
      usesInputId = false;
      input = (
        <TagListInput
          value={toList(value)}
          onChange={onChange}
          ariaLabel={field.fieldName}
          placeholder={t("tasks:jira.send.multiPlaceholder")}
        />
      );
      break;
    case "user":
      usesInputId = false;
      input = (
        <JiraUserField
          value={toText(value)}
          onChange={onChange}
          workspaceId={context.workspaceId}
          deployment={context.deployment}
          projectKey={context.projectKey}
          searchEnabled={context.canSearchUsers}
          invalid={invalid}
        />
      );
      break;
    default:
      input = (
        <Input
          id={inputId}
          size="sm"
          value={toText(value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }

  return (
    <div
      className="space-y-1.5 rounded-md border border-border p-3"
      data-field-id={field.fieldId}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {usesInputId ? (
          <label htmlFor={inputId} className="text-sm font-medium">
            {field.fieldName}
          </label>
        ) : (
          <span className="text-sm font-medium">{field.fieldName}</span>
        )}
        <code className="text-xs text-muted-foreground">{field.fieldId}</code>
        <OriginBadge origin={field.origin} />
        {field.required && (
          <Badge variant="warning" size="sm">
            {t("tasks:jira.send.required")}
          </Badge>
        )}
      </div>
      {input}
      {showSentAs && (
        <p className="text-xs text-muted-foreground">
          {t("tasks:jira.send.sentAs", { value: sentAs })}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-destructive-foreground"
        >
          {error}
        </p>
      )}
    </div>
  );
}
