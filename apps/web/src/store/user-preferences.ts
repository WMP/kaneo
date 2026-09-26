import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { GANTT_UNITS, type GanttUnit } from "@/components/gantt/timeline";

export const WEEK_START_DAYS = [0, 1, 6] as const;
export type WeekStartDay = (typeof WEEK_START_DAYS)[number];

export function isWeekStartDay(value: number): value is WeekStartDay {
  return WEEK_START_DAYS.some((day) => day === value);
}

export function isGanttUnit(value: unknown): value is GanttUnit {
  return GANTT_UNITS.includes(value as GanttUnit);
}

type UserPreferencesStore = {
  theme: "light" | "dark" | "system";
  setTheme: (
    theme: "light" | "dark" | "system",
    coordinates?: { x: number; y: number },
  ) => void;

  viewMode: "board" | "list";
  setViewMode: (mode: "board" | "list") => void;

  compactMode: boolean;
  setCompactMode: (compact: boolean) => void;

  showTaskNumbers: boolean;
  setShowTaskNumbers: (show: boolean) => void;
  toggleTaskNumbers: () => void;
  showAssignees: boolean;
  setShowAssignees: (show: boolean) => void;
  toggleAssignees: () => void;
  showDueDates: boolean;
  setShowDueDates: (show: boolean) => void;
  toggleDueDates: () => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  toggleLabels: () => void;
  showPriority: boolean;
  setShowPriority: (show: boolean) => void;
  togglePriority: () => void;
  showProjectBackgrounds: boolean;
  setShowProjectBackgrounds: (show: boolean) => void;
  showTaskItemCounts: boolean;
  setShowTaskItemCounts: (show: boolean) => void;
  toggleTaskItemCounts: () => void;
  resetDisplayPreferences: () => void;

  sidebarDefaultOpen: boolean;
  setSidebarDefaultOpen: (open: boolean) => void;

  weekStartsOn: WeekStartDay;
  setWeekStartsOn: (weekStartsOn: WeekStartDay) => void;

  ganttTimelineUnit: GanttUnit;
  // Whether the viewer has ever explicitly picked a unit (via the segmented
  // control) versus this still being the untouched "day" default. The Gantt
  // route reads this to decide whether ganttTimelineUnit should win outright
  // (touched) or whether it should instead compute a per-project default
  // from that project's own date span (see pickDefaultGanttUnit in
  // timeline.ts) — a global "day" default would otherwise open a
  // multi-year plan looking empty on every viewer's very first visit.
  ganttTimelineUnitTouched: boolean;
  setGanttTimelineUnit: (unit: GanttUnit) => void;

  ganttShowCriticalPath: boolean;
  setGanttShowCriticalPath: (show: boolean) => void;

  // Keyed by projectId: custom fields belong to one project, so the choice
  // of which one to show on the Gantt task rail can't be a single global
  // value the way weekStartsOn is.
  ganttCustomFieldByProject: Record<string, string | null>;
  setGanttCustomField: (projectId: string, fieldId: string | null) => void;
};

export const useUserPreferencesStore = create<UserPreferencesStore>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (
        theme: "light" | "dark" | "system",
        coordinates?: { x: number; y: number },
      ) => {
        if (coordinates) {
          document.documentElement.style.setProperty(
            "--x",
            `${coordinates.x}%`,
          );
          document.documentElement.style.setProperty(
            "--y",
            `${coordinates.y}%`,
          );
        } else {
          document.documentElement.style.removeProperty("--x");
          document.documentElement.style.removeProperty("--y");
        }

        if ("startViewTransition" in document) {
          document.startViewTransition(() => {
            set({ theme });
          });
        } else {
          set({ theme });
        }
      },

      viewMode: "board",
      setViewMode: (mode) => set({ viewMode: mode }),

      compactMode: false,
      setCompactMode: (compact) => set({ compactMode: compact }),

      showTaskNumbers: true,
      setShowTaskNumbers: (show) => set({ showTaskNumbers: show }),
      toggleTaskNumbers: () =>
        set((state) => ({ showTaskNumbers: !state.showTaskNumbers })),
      showAssignees: true,
      setShowAssignees: (show) => set({ showAssignees: show }),
      toggleAssignees: () =>
        set((state) => ({ showAssignees: !state.showAssignees })),
      showDueDates: true,
      setShowDueDates: (show) => set({ showDueDates: show }),
      toggleDueDates: () =>
        set((state) => ({ showDueDates: !state.showDueDates })),
      showLabels: true,
      setShowLabels: (show) => set({ showLabels: show }),
      toggleLabels: () => set((state) => ({ showLabels: !state.showLabels })),
      showPriority: true,
      setShowPriority: (show) => set({ showPriority: show }),
      togglePriority: () =>
        set((state) => ({ showPriority: !state.showPriority })),
      showProjectBackgrounds: true,
      setShowProjectBackgrounds: (show) =>
        set({ showProjectBackgrounds: show }),
      showTaskItemCounts: true,
      setShowTaskItemCounts: (show) => set({ showTaskItemCounts: show }),
      toggleTaskItemCounts: () =>
        set((state) => ({ showTaskItemCounts: !state.showTaskItemCounts })),
      resetDisplayPreferences: () =>
        set({
          showAssignees: true,
          showDueDates: true,
          showLabels: true,
          showTaskNumbers: true,
          showPriority: true,
          showTaskItemCounts: true,
        }),

      sidebarDefaultOpen: true,
      setSidebarDefaultOpen: (open) => set({ sidebarDefaultOpen: open }),

      weekStartsOn: 0,
      setWeekStartsOn: (weekStartsOn) => set({ weekStartsOn }),

      ganttTimelineUnit: "day",
      ganttTimelineUnitTouched: false,
      setGanttTimelineUnit: (ganttTimelineUnit) =>
        set({ ganttTimelineUnit, ganttTimelineUnitTouched: true }),

      ganttShowCriticalPath: false,
      setGanttShowCriticalPath: (ganttShowCriticalPath) =>
        set({ ganttShowCriticalPath }),

      ganttCustomFieldByProject: {},
      setGanttCustomField: (projectId, fieldId) =>
        set((state) => ({
          ganttCustomFieldByProject: {
            ...state.ganttCustomFieldByProject,
            [projectId]: fieldId,
          },
        })),
    }),
    {
      name: "user-preferences",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state && !isWeekStartDay(state.weekStartsOn)) {
          state.setWeekStartsOn(0);
        }
        if (state && !isGanttUnit(state.ganttTimelineUnit)) {
          state.setGanttTimelineUnit("day");
        }
        // Pre-existing installations persisted ganttTimelineUnit with no
        // "touched" flag at all (it didn't exist yet). The only way it could
        // already be something other than the hardcoded "day" default is an
        // explicit past pick via the segmented control (setGanttTimelineUnit
        // was never called any other way), so back-fill touched=true for
        // those rather than letting the untouched per-project default (see
        // pickDefaultGanttUnit in timeline.ts) silently override a unit the
        // viewer chose before this feature existed.
        if (
          state &&
          state.ganttTimelineUnit !== "day" &&
          !state.ganttTimelineUnitTouched
        ) {
          // Re-setting the same unit is a plain, already-reactive way to
          // flip ganttTimelineUnitTouched to true (see setGanttTimelineUnit
          // above) without reaching into the store's internals directly.
          state.setGanttTimelineUnit(state.ganttTimelineUnit);
        }
      },
    },
  ),
);
