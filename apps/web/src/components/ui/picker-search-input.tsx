import { Search } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";

type PickerSearchInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  /** Called on Enter, typically to pick the first match. */
  onEnter?: () => void;
  className?: string;
};

const FOCUSABLE_ITEMS = "button:not([disabled]),[role=menuitem]";

/**
 * ArrowDown/ArrowUp for a picker list: moves focus between the list's
 * buttons, and from the first one back to the search input (the input is
 * the list's preceding sibling inside the popover).
 */
export function handlePickerListKeyDown(event: React.KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const list = event.currentTarget as HTMLElement;
  const items = Array.from(list.querySelectorAll<HTMLElement>(FOCUSABLE_ITEMS));
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  if (event.key === "ArrowDown") {
    items[Math.min(index + 1, items.length - 1)]?.focus();
    return;
  }
  if (index === 0) {
    list.parentElement
      ?.querySelector<HTMLInputElement>("[data-picker-search-input]")
      ?.focus();
    return;
  }
  items[index - 1]?.focus();
}

/**
 * The search field at the top of a picker popover: autofocused when the
 * popover opens, Enter picks the first match, ArrowDown moves into the list
 * (the list's container takes `handlePickerListKeyDown`).
 */
export function PickerSearchInput({
  value,
  onValueChange,
  placeholder,
  onEnter,
  className,
}: PickerSearchInputProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border px-2.5 py-2",
        className,
      )}
    >
      <Search
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        // biome-ignore lint/a11y/noAutofocus: the picker exists to be searched; focus moves here on open.
        autoFocus
        data-picker-search-input=""
        type="search"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Never submit a surrounding form (the create-task modal).
            event.preventDefault();
            onEnter?.();
            return;
          }
          if (event.key === "ArrowDown") {
            const list = event.currentTarget.parentElement?.nextElementSibling;
            const first = list?.querySelector<HTMLElement>(FOCUSABLE_ITEMS);
            if (first) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
        className="h-6 w-full min-w-0 border-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

/**
 * The scrolling list under a `PickerSearchInput`; ArrowUp/ArrowDown move
 * focus between its buttons (the key handler does not make the div itself
 * interactive: the focusable elements are the buttons inside).
 */
export function PickerList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates arrow keys from the buttons inside it.
    <div className={className} onKeyDown={handlePickerListKeyDown} {...props} />
  );
}

export function PickerNoResults({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="px-2 py-3 text-center text-xs text-muted-foreground"
    >
      {children}
    </p>
  );
}
