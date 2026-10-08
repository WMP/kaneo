import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNumberedShortcuts } from "./use-numbered-shortcuts";

afterEach(() => {
  cleanup();
});

function Harness({
  isOpen = true,
  onSelect,
}: {
  isOpen?: boolean;
  onSelect: (index: number) => void;
}) {
  useNumberedShortcuts(isOpen, [
    { onSelect: () => onSelect(1) },
    { onSelect: () => onSelect(2) },
  ]);
  return (
    <div>
      <input aria-label="search" />
      <textarea aria-label="notes" />
      <button type="button">list item</button>
    </div>
  );
}

describe("useNumberedShortcuts", () => {
  it("selects the numbered option when a digit is pressed outside a field", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "list item" }), {
      key: "2",
    });

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("lets digits be typed into a search input without selecting anything", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    const search = screen.getByLabelText("search");
    search.focus();
    const event = fireEvent.keyDown(search, { key: "1" });

    expect(onSelect).not.toHaveBeenCalled();
    // Not default-prevented either, so the digit still reaches the input.
    expect(event).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("notes"), { key: "2" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ignores digits beyond the options and while closed", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<Harness onSelect={onSelect} />);

    fireEvent.keyDown(document.body, { key: "3" });
    expect(onSelect).not.toHaveBeenCalled();

    rerender(<Harness isOpen={false} onSelect={onSelect} />);
    fireEvent.keyDown(document.body, { key: "1" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
