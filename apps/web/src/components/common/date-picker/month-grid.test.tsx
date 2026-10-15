import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MonthGrid } from "./month-grid";

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { weekStartsOn: 0 }) => unknown,
  ) => selector({ weekStartsOn: 0 }),
}));

let currentLanguage: string | undefined = "en-US";
let withI18n = true;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Only the two navigation labels are looked up by key; return the Polish
    // strings for them so the aria-label assertion is meaningful.
    t: (key: string) =>
      key === "tasks:calendar.nextMonth"
        ? "Następny miesiąc"
        : key === "tasks:calendar.previousMonth"
          ? "Poprzedni miesiąc"
          : key,
    ...(withI18n ? { i18n: { language: currentLanguage } } : {}),
  }),
}));

afterEach(() => {
  cleanup();
  currentLanguage = "en-US";
  withI18n = true;
});

describe("MonthGrid localization", () => {
  it("renders the month caption in English by default", () => {
    render(<MonthGrid value={new Date(2026, 8, 15)} onSelect={vi.fn()} />);

    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("renders the month caption in Polish for pl-PL", () => {
    currentLanguage = "pl-PL";
    render(<MonthGrid value={new Date(2026, 8, 15)} onSelect={vi.fn()} />);

    expect(screen.getByText(/wrzesień 2026/i)).toBeInTheDocument();
    expect(screen.queryByText("September 2026")).not.toBeInTheDocument();
  });

  it("localizes the month navigation aria labels", () => {
    render(<MonthGrid value={new Date(2026, 8, 15)} onSelect={vi.fn()} />);

    expect(screen.getByLabelText("Następny miesiąc")).toBeInTheDocument();
    expect(screen.getByLabelText("Poprzedni miesiąc")).toBeInTheDocument();
  });

  it("still renders when useTranslation has no i18n", () => {
    withI18n = false;
    render(<MonthGrid value={new Date(2026, 8, 15)} onSelect={vi.fn()} />);

    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });
});
