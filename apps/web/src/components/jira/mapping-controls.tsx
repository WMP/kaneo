import { Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JiraMappingOrigin } from "@/fetchers/jira-integration/types";

export function OriginBadge({ origin }: { origin: JiraMappingOrigin }) {
  const { t } = useTranslation();
  const label = {
    default: t("settings:jiraIntegration.mapping.origin.default"),
    workspace: t("settings:jiraIntegration.mapping.origin.workspace"),
    project: t("settings:jiraIntegration.mapping.origin.project"),
    user: t("settings:jiraIntegration.mapping.origin.user"),
  }[origin];
  return (
    <Badge variant="outline" size="sm" data-origin={origin}>
      {t("settings:jiraIntegration.mapping.inheritedFrom", { origin: label })}
    </Badge>
  );
}

export type SelectOption = { value: string; label: string };

// A Select over a plain list. A current value that is not in the list (a
// mapping saved for something that no longer exists) stays visible instead of
// silently turning into the placeholder.
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  invalid,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const known = options.some((option) => option.value === value);
  const all = value && !known ? [...options, { value, label: value }] : options;
  const current = all.find((option) => option.value === value);

  return (
    <Select
      value={value || null}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className={className}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
      >
        <SelectValue placeholder={placeholder}>{current?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {all.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Chips with a free-text input: Enter or a comma adds an entry, the optional
// suggestions come from Jira metadata when it could be read.
export function TagListInput({
  value,
  onChange,
  suggestions,
  ariaLabel,
  placeholder,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions?: string[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [text, setText] = useState("");

  const commit = (raw: string) => {
    const entries = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && !value.includes(entry));
    if (entries.length > 0) onChange([...value, ...entries]);
    setText("");
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((entry) => (
            <li key={entry}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {entry}
                {!disabled && (
                  <button
                    type="button"
                    className="rounded-sm p-0.5 hover:bg-foreground/10"
                    aria-label={t(
                      "settings:jiraIntegration.mapping.removeTag",
                      {
                        value: entry,
                      },
                    )}
                    onClick={() =>
                      onChange(value.filter((other) => other !== entry))
                    }
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <>
          <Input
            size="sm"
            value={text}
            aria-label={ariaLabel}
            placeholder={placeholder}
            list={suggestions?.length ? listId : undefined}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commit(text);
              }
            }}
            onBlur={() => commit(text)}
          />
          {suggestions?.length ? (
            <datalist id={listId}>
              {suggestions.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </div>
  );
}

// Kaneo value -> Jira value rows (priority, dropdown, status, ...). The rows
// are local state because a row with an empty key cannot live in a record; the
// record handed to `onChange` leaves incomplete rows out. The parent remounts
// the editor (a new `key`) when the mapping it edits is replaced.
export function ValueMapEditor({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const nextId = useRef(0);
  const [rows, setRows] = useState(() =>
    Object.entries(value).map(([key, mapped]) => ({
      id: nextId.current++,
      key,
      mapped,
    })),
  );

  const commit = (next: typeof rows) => {
    setRows(next);
    onChange(
      Object.fromEntries(
        next
          .filter((row) => row.key.trim() !== "")
          .map((row) => [row.key, row.mapped]),
      ),
    );
  };

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            size="sm"
            value={row.key}
            disabled={disabled}
            aria-label={t("settings:jiraIntegration.mapping.valueMapKaneo")}
            placeholder={t("settings:jiraIntegration.mapping.valueMapKaneo")}
            onChange={(event) =>
              commit(
                rows.map((other) =>
                  other.id === row.id
                    ? { ...other, key: event.target.value }
                    : other,
                ),
              )
            }
          />
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <Input
            size="sm"
            value={row.mapped}
            disabled={disabled}
            aria-label={t("settings:jiraIntegration.mapping.valueMapJira")}
            placeholder={t("settings:jiraIntegration.mapping.valueMapJira")}
            onChange={(event) =>
              commit(
                rows.map((other) =>
                  other.id === row.id
                    ? { ...other, mapped: event.target.value }
                    : other,
                ),
              )
            }
          />
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings:jiraIntegration.mapping.valueMapRemove")}
              onClick={() =>
                commit(rows.filter((other) => other.id !== row.id))
              }
            >
              <X />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() =>
            setRows([...rows, { id: nextId.current++, key: "", mapped: "" }])
          }
        >
          <Plus />
          {t("settings:jiraIntegration.mapping.valueMapAdd")}
        </Button>
      )}
    </div>
  );
}
