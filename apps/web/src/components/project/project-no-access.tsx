import { Link } from "@tanstack/react-router";
import { LockIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type Props = {
  workspaceId: string;
};

/** Shown where a project answered 403: no generic error, a way back. */
function ProjectNoAccess({ workspaceId }: Props) {
  const { t } = useTranslation();
  return (
    <Empty className="min-h-[60vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>{t("projectMembers:noAccess.title")}</EmptyTitle>
        <EmptyDescription>
          {t("projectMembers:noAccess.description")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId"
              params={{ workspaceId }}
            />
          }
        >
          {t("projectMembers:noAccess.back")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export default ProjectNoAccess;
