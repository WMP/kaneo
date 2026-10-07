import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EstimateEditor from "./estimate-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function setup(
  props: Partial<React.ComponentProps<typeof EstimateEditor>> = {},
) {
  const onSave = vi.fn();
  const view = render(
    <EstimateEditor minutes={null} unit="hours" onSave={onSave} {...props} />,
  );
  const input = screen.getByRole("textbox", {
    name: "tasks:popover.estimate.amountLabel",
  });
  return { onSave, input, ...view };
}

describe("EstimateEditor commit paths", () => {
  it("commits on blur", () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(120, "hours");
  });

  it("commits on Enter", () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(120, "hours");
  });

  it("does not save twice for Enter, blur and then unmount", () => {
    const { onSave, input, unmount } = setup();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not save an unchanged value on blur or unmount", () => {
    const { onSave, input, unmount } = setup({ minutes: 90 });
    expect(input).toHaveValue("1.5");
    fireEvent.blur(input);
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("commits a changed valid value when it unmounts without a blur (popover closed)", () => {
    const { onSave, input, unmount } = setup();
    fireEvent.change(input, { target: { value: "3" } });
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(180, "hours");
  });

  it("commits an emptied field as a cleared estimate when it unmounts", () => {
    const { onSave, input, unmount } = setup({ minutes: 60 });
    fireEvent.change(input, { target: { value: "" } });
    unmount();
    expect(onSave).toHaveBeenCalledWith(null, "hours");
  });

  it("reverts invalid text on blur and never saves it, also on unmount", () => {
    const { onSave, input, unmount } = setup({ minutes: 90 });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("1.5");
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save invalid text left in the field when it unmounts", () => {
    const { onSave, input, unmount } = setup({ minutes: 90 });
    fireEvent.change(input, { target: { value: "12x" } });
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape cancels the edit: nothing is saved on the close that follows", () => {
    const { onSave, input, unmount } = setup({ minutes: 90 });
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("1.5");
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape pressed outside the field still cancels a pending edit", () => {
    const { onSave, input, unmount } = setup();
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(document.body, { key: "Escape" });
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("typing again after Escape makes the edit committable", () => {
    const { onSave, input, unmount } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.change(input, { target: { value: "4" } });
    unmount();
    expect(onSave).toHaveBeenCalledWith(240, "hours");
  });

  it("does nothing while disabled", () => {
    const { onSave, input, unmount } = setup({ disabled: true });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a rejected save reverts and the close that follows does not retry it", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    const { input, unmount } = setup({ onSave });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    await vi.waitFor(() => expect(input).toHaveValue(""));
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
