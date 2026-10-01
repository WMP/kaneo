import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { JiraMetaUser } from "@/fetchers/jira-integration/types";
import { useJiraUserSearch } from "@/hooks/queries/jira-integration/use-get-jira-meta";

// What identifies a Jira user in a mapping: the username on Server / Data
// Center, the account id on Cloud.
export function jiraUserIdentifier(
  user: JiraMetaUser,
  deployment: "server" | "cloud" | undefined,
): string {
  const preferred =
    deployment === "cloud"
      ? (user.accountId ?? user.name)
      : (user.name ?? user.accountId);
  return preferred ?? "";
}

function useDebounced(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Free text for the Jira user, plus a search of Jira users (with the caller's
// own token) when metadata can be read.
export function JiraUserField({
  value,
  onChange,
  workspaceId,
  deployment,
  projectKey,
  searchEnabled,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  workspaceId: string;
  deployment: "server" | "cloud" | undefined;
  projectKey: string | null;
  searchEnabled: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query);
  const { data, isFetching, isError } = useJiraUserSearch(
    workspaceId,
    debounced,
    projectKey,
    { enabled: searching && searchEnabled },
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={t("settings:jiraIntegration.mapping.jiraUserLabel")}
          placeholder={
            deployment === "cloud"
              ? t(
                  "settings:jiraIntegration.mapping.jiraUserAccountIdPlaceholder",
                )
              : t("settings:jiraIntegration.mapping.jiraUserNamePlaceholder")
          }
          onChange={(event) => onChange(event.target.value)}
        />
        {searchEnabled && !disabled && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("settings:jiraIntegration.mapping.jiraUserSearch")}
            aria-expanded={searching}
            onClick={() => setSearching((open) => !open)}
          >
            <Search />
          </Button>
        )}
      </div>
      {searching && searchEnabled && !disabled && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <Input
            size="sm"
            value={query}
            aria-label={t(
              "settings:jiraIntegration.mapping.jiraUserSearchLabel",
            )}
            placeholder={t(
              "settings:jiraIntegration.mapping.jiraUserSearchPlaceholder",
            )}
            onChange={(event) => setQuery(event.target.value)}
          />
          {isError ? (
            <p className="text-xs text-destructive-foreground">
              {t("settings:jiraIntegration.mapping.jiraUserSearchError")}
            </p>
          ) : isFetching ? (
            <p className="text-xs text-muted-foreground">
              {t("settings:jiraIntegration.mapping.loading")}
            </p>
          ) : debounced.trim().length >= 2 && data?.users.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("settings:jiraIntegration.mapping.jiraUserNoResults")}
            </p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {(data?.users ?? []).map((user) => {
                const identifier = jiraUserIdentifier(user, deployment);
                if (!identifier) return null;
                return (
                  <li key={identifier}>
                    <button
                      type="button"
                      className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        onChange(identifier);
                        setSearching(false);
                        setQuery("");
                      }}
                    >
                      <span className="font-medium">
                        {user.displayName ?? identifier}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {identifier}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
