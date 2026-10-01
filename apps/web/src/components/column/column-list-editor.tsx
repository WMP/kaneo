import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import columnIcons, {
  DEFAULT_COLUMN_ICON_NAMES,
} from "@/constants/column-icons";
import { getColumnIcon } from "@/lib/column";
import { cn } from "@/lib/utils";

/** What the editor needs from a column: a project column or a workspace column. */
export type EditableColumn = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  isFinal: boolean;
};

/** Every callback resolves `false` when the change failed (it already told the person). */
type ColumnAction = Promise<boolean | undefined> | boolean | undefined;

export type ColumnListEditorProps = {
  columns: EditableColumn[] | undefined;
  isLoading: boolean;
  /** Without it the list is read-only: no add, edit, delete or reorder control. */
  canEdit: boolean;
  onCreate: (input: { name: string; icon: string }) => ColumnAction;
  onRename: (column: EditableColumn, name: string) => ColumnAction;
  onToggleFinal: (column: EditableColumn, isFinal: boolean) => ColumnAction;
  onUpdateIcon: (column: EditableColumn, icon: string) => ColumnAction;
  /** Deleting may need more input (a target column), so the parent decides how. */
  onDelete: (column: EditableColumn) => void;
  onReorder: (
    updates: Array<{ id: string; position: number }>,
  ) => Promise<unknown> | unknown;
};

function IconPickerPopover({
  selectedIconName,
  triggerIcon,
  variant,
  disabled,
  onPick,
}: {
  selectedIconName: string | undefined;
  triggerIcon: React.ReactNode;
  variant: "ghost" | "outline";
  disabled?: boolean;
  onPick: (iconName: string) => ColumnAction;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredIcons = Object.entries(columnIcons).filter(([iconName]) =>
    iconName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const handlePick = async (iconName: string) => {
    const result = await onPick(iconName);
    if (result !== false) handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={true}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="sm"
          className="h-8 w-8 p-0 shrink-0"
          title={t("settings:columnEditor.pickIconTitle")}
          aria-label={t("settings:columnEditor.pickIconTitle")}
          disabled={disabled}
        >
          {triggerIcon}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("settings:columnEditor.searchIconsPlaceholder")}
            aria-label={t("settings:columnEditor.searchIconsPlaceholder")}
            className="h-8 text-xs"
          />
          <div className="max-h-[280px] overflow-y-auto pr-1">
            <div className="grid grid-cols-6 gap-1.5">
              {filteredIcons.map(([iconName, Icon]) => (
                <Button
                  key={iconName}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handlePick(iconName)}
                  className={cn(
                    "h-10 items-center justify-center rounded-md p-0",
                    selectedIconName === iconName &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                  title={iconName}
                  aria-label={iconName}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The list of board columns with its create row: rename, icon, "done" flag,
 * delete, and reorder by drag or with the move buttons. Project columns and
 * workspace columns share it; the two differ only in the callbacks they pass.
 * A reorder is sent once, when the drag ends or a move button is pressed.
 */
export default function ColumnListEditor({
  columns,
  isLoading,
  canEdit,
  onCreate,
  onRename,
  onToggleFinal,
  onUpdateIcon,
  onDelete,
  onReorder,
}: ColumnListEditorProps) {
  const { t } = useTranslation();
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnIcon, setNewColumnIcon] = useState("Circle");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // The order shown while a reorder is being dragged or saved.
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  // A drag that ends without a drop (Escape, dropped outside the list) is
  // cancelled: the order goes back to what it was.
  const droppedRef = useRef(false);

  useEffect(() => {
    return () => {
      dragPreviewRef.current?.remove();
    };
  }, []);

  const orderedColumns = useMemo(() => {
    if (!columns) return [];
    if (!orderOverride) return columns;
    const byId = new Map(columns.map((column) => [column.id, column]));
    const ordered = orderOverride.flatMap((id) => {
      const column = byId.get(id);
      return column ? [column] : [];
    });
    const shown = new Set(ordered.map((column) => column.id));
    return [...ordered, ...columns.filter((column) => !shown.has(column.id))];
  }, [columns, orderOverride]);

  const commitOrder = async (ids: string[]) => {
    const current = (columns ?? []).map((column) => column.id);
    if (
      ids.length === current.length &&
      ids.every((id, i) => id === current[i])
    ) {
      setOrderOverride(null);
      return;
    }
    setOrderOverride(ids);
    try {
      await onReorder(ids.map((id, position) => ({ id, position })));
    } finally {
      setOrderOverride(null);
    }
  };

  const moveColumn = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= orderedColumns.length) return;
    const ids = orderedColumns.map((column) => column.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    void commitOrder(ids);
  };

  const handleCreate = async () => {
    const name = newColumnName.trim();
    if (!name) return;
    const result = await onCreate({ name, icon: newColumnIcon });
    if (result === false) return;
    setNewColumnName("");
    setNewColumnIcon("Circle");
  };

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    column: EditableColumn,
  ) => {
    droppedRef.current = false;
    setDraggedId(column.id);
    setOrderOverride(orderedColumns.map((item) => item.id));

    dragPreviewRef.current?.remove();

    const sourceElement = e.currentTarget;
    const sourceRect = sourceElement.getBoundingClientRect();

    // Use an isolated clone so the drag image only captures the selected row.
    const dragPreview = sourceElement.cloneNode(true) as HTMLDivElement;

    dragPreview.setAttribute("aria-hidden", "true");
    dragPreview.inert = true;

    Object.assign(dragPreview.style, {
      position: "fixed",
      top: "-10000px",
      left: "-10000px",
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      margin: "0",
      boxSizing: "border-box",
      overflow: "hidden",
      pointerEvents: "none",
      transform: "none",
      contain: "layout paint",
    });

    document.body.appendChild(dragPreview);
    dragPreviewRef.current = dragPreview;

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", column.id);
    e.dataTransfer.setDragImage(
      dragPreview,
      e.clientX - sourceRect.left,
      e.clientY - sourceRect.top,
    );
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedId === null) return;
    const from = orderedColumns.findIndex((column) => column.id === draggedId);
    if (from === -1 || from === index) return;

    const ids = orderedColumns.map((column) => column.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(index, 0, moved);
    setOrderOverride(ids);
  };

  const handleDragEnd = () => {
    const ids = orderOverride;
    setDraggedId(null);

    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;

    if (!ids) return;
    if (droppedRef.current) void commitOrder(ids);
    else setOrderOverride(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    droppedRef.current = true;
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings:columnEditor.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target of the drag reorder; keyboard users reorder with the move buttons */}
      <div
        className="space-y-1"
        onDragOver={
          canEdit && draggedId ? (e) => e.preventDefault() : undefined
        }
        onDrop={canEdit && draggedId ? handleDrop : undefined}
      >
        {orderedColumns.map((col, index) => (
          // biome-ignore lint/a11y/useSemanticElements: false positive for role="listitem"
          <div
            key={col.id}
            role="listitem"
            draggable={canEdit}
            onDragStart={canEdit ? (e) => handleDragStart(e, col) : undefined}
            onDragOver={canEdit ? (e) => handleDragOver(e, index) : undefined}
            onDrop={canEdit ? handleDrop : undefined}
            onDragEnd={canEdit ? handleDragEnd : undefined}
            className="flex items-center gap-2 p-2 border border-border rounded-md bg-sidebar hover:bg-sidebar-accent/50 transition-colors"
          >
            {canEdit && (
              <GripVertical
                aria-hidden="true"
                className="w-4 h-4 text-muted-foreground cursor-grab shrink-0"
              />
            )}
            <IconPickerPopover
              variant="ghost"
              disabled={!canEdit}
              selectedIconName={
                col.icon ||
                (Object.hasOwn(DEFAULT_COLUMN_ICON_NAMES, col.slug)
                  ? DEFAULT_COLUMN_ICON_NAMES[
                      col.slug as keyof typeof DEFAULT_COLUMN_ICON_NAMES
                    ]
                  : undefined)
              }
              triggerIcon={getColumnIcon(col.slug, col.isFinal, col.icon)}
              onPick={(icon) => onUpdateIcon(col, icon)}
            />
            <Input
              key={col.name}
              defaultValue={col.name}
              className="h-8 text-sm flex-1"
              disabled={!canEdit}
              aria-label={t("settings:columnEditor.nameAria", {
                name: col.name,
              })}
              onBlur={async (e) => {
                const input = e.currentTarget;
                if (input.value === col.name) return;
                const result = await onRename(col, input.value);
                if (result === false) input.value = col.name;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className="flex items-center gap-2"
                title={t("settings:columnEditor.doneColumnTooltip")}
              >
                {col.isFinal ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("settings:columnEditor.doneColumn")}
                </span>
                <Switch
                  checked={col.isFinal}
                  onCheckedChange={
                    canEdit
                      ? (checked) => void onToggleFinal(col, checked)
                      : undefined
                  }
                  disabled={!canEdit}
                  aria-label={t("settings:columnEditor.markDoneAria", {
                    name: col.name,
                  })}
                  className="scale-75"
                />
                <span className="text-[11px] text-muted-foreground w-8">
                  {col.isFinal
                    ? t("settings:columnEditor.on")
                    : t("settings:columnEditor.off")}
                </span>
              </div>
              {canEdit && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    disabled={index === 0 || orderOverride !== null}
                    aria-label={t("settings:columnEditor.moveUpAria", {
                      name: col.name,
                    })}
                    onClick={() => moveColumn(index, -1)}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    disabled={
                      index === orderedColumns.length - 1 ||
                      orderOverride !== null
                    }
                    aria-label={t("settings:columnEditor.moveDownAria", {
                      name: col.name,
                    })}
                    onClick={() => moveColumn(index, 1)}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    aria-label={t("settings:columnEditor.deleteAria", {
                      name: col.name,
                    })}
                    onClick={() => onDelete(col)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <IconPickerPopover
            variant="outline"
            selectedIconName={newColumnIcon}
            triggerIcon={getColumnIcon("", false, newColumnIcon)}
            onPick={(icon) => {
              setNewColumnIcon(icon);
              return true;
            }}
          />
          <Input
            placeholder={t("settings:columnEditor.newColumnPlaceholder")}
            aria-label={t("settings:columnEditor.newColumnPlaceholder")}
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={!newColumnName.trim()}
            className="h-8 gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("settings:columnEditor.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
