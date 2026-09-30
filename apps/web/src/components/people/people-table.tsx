import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateMedium } from "@/lib/format";
import PersonCell from "./person-cell";

export type PeopleTableRow = {
  key: string;
  name: string;
  email: string;
  image: string | null;
  isSelf: boolean;
  /** The role column: a `RoleCell`, possibly with badges next to it. */
  role: ReactNode;
  /** The context column (projects of a member, workspace role of a project member). */
  extra?: ReactNode;
  joinedAt: string | Date | null | undefined;
  /** Items of the actions menu; no menu when there are none. */
  menu?: { ariaLabel: string; items: ReactNode } | null;
};

type Props = {
  rows: PeopleTableRow[];
  roleHeader: string;
  /** Header of the context column; the column is left out without it. */
  extraHeader?: string;
  /** Shown above the table (for example "could not load the roles"). */
  notice?: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
};

/**
 * The table of people, the same in a workspace and in a project: person
 * (avatar, name, email), role, one column that depends on the context, the date
 * they joined, and an actions menu. What a row means, which roles are offered
 * and which actions exist is decided by the caller and handed in as nodes.
 */
function PeopleTable({
  rows,
  roleHeader,
  extraHeader,
  notice,
  emptyTitle,
  emptyDescription,
}: Props) {
  const { t } = useTranslation();
  const columnCount = extraHeader ? 5 : 4;

  return (
    <>
      {notice}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6 text-foreground font-medium">
              {t("people:table.columns.person")}
            </TableHead>
            <TableHead className="text-foreground font-medium">
              {roleHeader}
            </TableHead>
            {extraHeader ? (
              <TableHead className="text-foreground font-medium">
                {extraHeader}
              </TableHead>
            ) : null}
            <TableHead className="text-foreground font-medium">
              {t("people:table.columns.joined")}
            </TableHead>
            <TableHead className="w-px pe-6" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="ps-6 py-3">
                <PersonCell
                  name={row.name}
                  email={row.email}
                  image={row.image}
                  isSelf={row.isSelf}
                />
              </TableCell>
              <TableCell className="py-3">{row.role}</TableCell>
              {extraHeader ? (
                <TableCell className="py-3">{row.extra}</TableCell>
              ) : null}
              <TableCell className="py-3 text-sm text-muted-foreground tabular-nums">
                {row.joinedAt ? formatDateMedium(row.joinedAt) : "–"}
              </TableCell>
              <TableCell className="pe-6 py-3 text-right">
                {row.menu ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          aria-label={row.menu.ariaLabel}
                        />
                      }
                    >
                      <EllipsisIcon className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">{row.menu.items}</MenuPopup>
                  </Menu>
                ) : null}
              </TableCell>
            </TableRow>
          ))}

          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">
                    {emptyTitle}
                  </p>
                  <p className="text-xs">{emptyDescription}</p>
                </div>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </>
  );
}

export default PeopleTable;
