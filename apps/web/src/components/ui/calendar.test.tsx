import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./calendar";

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { weekStartsOn: 0 }) => unknown,
  ) => selector({ weekStartsOn: 0 }),
}));

let currentLanguage = "en-US";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Only the two calendar nav labels are looked up by key; return the
    // Polish strings for them so the aria-label assertion is meaningful.
    t: (key: string) =>
      key === "tasks:calendar.nextMonth"
        ? "Następny miesiąc"
        : key === "tasks:calendar.previousMonth"
          ? "Poprzedni miesiąc"
          : key,
    i18n: { language: currentLanguage },
  }),
}));

afterEach(() => {
  cleanup();
  currentLanguage = "en-US";
});

const september2026 = new Date(2026, 8, 15);

describe("Calendar localization", () => {
  it("renders the month caption and weekday names in English by default", () => {
    currentLanguage = "en-US";
    render(<Calendar month={september2026} />);

    expect(screen.getByText("September 2026")).toBeInTheDocument();
    // English abbreviated weekday.
    expect(screen.getAllByText("Mo").length).toBeGreaterThan(0);
  });

  it("renders the month caption and weekday names in Polish for pl-PL", () => {
    currentLanguage = "pl-PL";
    render(<Calendar month={september2026} />);

    // date-fns Polish month caption is lowercase "wrzesień".
    expect(screen.getByText(/wrzesień 2026/i)).toBeInTheDocument();
    // The English caption must be gone.
    expect(screen.queryByText("September 2026")).not.toBeInTheDocument();
  });

  it("localizes the month navigation aria labels via reused i18n keys", () => {
    currentLanguage = "pl-PL";
    render(<Calendar month={september2026} />);

    expect(screen.getByLabelText("Następny miesiąc")).toBeInTheDocument();
    expect(screen.getByLabelText("Poprzedni miesiąc")).toBeInTheDocument();
  });
});
