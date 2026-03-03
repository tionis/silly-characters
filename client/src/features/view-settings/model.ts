import { createStore, createEvent, createEffect, sample } from "effector";
import {
  getViewSettings,
  updateViewSettings,
  type ColorScheme,
  type ViewSettings,
} from "@/shared/api/view-settings";

// Типы
export type ColumnsCount = 3 | 5 | 7;

const COLOR_SCHEME_STORAGE_KEY = "view-settings:color-scheme";

function getInitialColorScheme(): ColorScheme {
  if (typeof window === "undefined") return "auto";
  try {
    const value = window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "auto") return value;
  } catch {
    // ignore
  }
  return "auto";
}

const DEFAULT_SETTINGS: ViewSettings = {
  columnsCount: 5,
  isCensored: false,
  colorScheme: "auto",
};

// Stores
export const $columnsCount = createStore<ColumnsCount>(
  DEFAULT_SETTINGS.columnsCount
);
export const $isCensored = createStore<boolean>(DEFAULT_SETTINGS.isCensored);
export const $colorScheme = createStore<ColorScheme>(getInitialColorScheme());
export const $isLocalStorageLoaded = createStore<boolean>(false);

// Events
export const setColumnsCount = createEvent<ColumnsCount>();
export const toggleCensorship = createEvent<void>();
export const cycleColorScheme = createEvent<void>();

// Effects
export const loadFromApiFx = createEffect<void, ViewSettings, Error>(
  async () => {
    try {
      return await getViewSettings();
    } catch (error) {
      console.error("Ошибка загрузки настроек отображения:", error);
      return DEFAULT_SETTINGS;
    }
  }
);

export const saveToApiFx = createEffect<ViewSettings, ViewSettings, Error>(
  async (settings) => {
    try {
      return await updateViewSettings(settings);
    } catch (error) {
      console.error("Ошибка сохранения настроек отображения:", error);
      throw error;
    }
  }
);

const persistColorSchemeFx = createEffect<ColorScheme, void>(async (scheme) => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    // ignore
  }
});

// Обновление stores через события
$columnsCount.on(setColumnsCount, (_, count) => count);
$isCensored.on(toggleCensorship, (current) => !current);
$colorScheme.on(cycleColorScheme, (current) => {
  if (current === "light") return "dark";
  if (current === "dark") return "auto";
  return "light";
});

// Загрузка из API
sample({
  clock: loadFromApiFx.doneData,
  fn: (settings) => settings.columnsCount,
  target: $columnsCount,
});

sample({
  clock: loadFromApiFx.doneData,
  fn: (settings) => settings.isCensored,
  target: $isCensored,
});

sample({
  clock: loadFromApiFx.doneData,
  fn: (settings) => settings.colorScheme,
  target: $colorScheme,
});

sample({
  clock: loadFromApiFx.finally,
  fn: () => true,
  target: $isLocalStorageLoaded,
});

// Persist locally for instant start on next reload
sample({
  clock: $colorScheme,
  target: persistColorSchemeFx,
});

// Сохранение в API при изменении настроек
sample({
  clock: [setColumnsCount, toggleCensorship, cycleColorScheme],
  source: {
    columnsCount: $columnsCount,
    isCensored: $isCensored,
    colorScheme: $colorScheme,
  },
  fn: ({ columnsCount, isCensored, colorScheme }) => ({
    columnsCount,
    isCensored,
    colorScheme,
  }),
  target: saveToApiFx,
});

// Обновление stores после успешного сохранения на сервере
sample({
  clock: saveToApiFx.doneData,
  fn: (settings) => settings.columnsCount,
  target: $columnsCount,
});

sample({
  clock: saveToApiFx.doneData,
  fn: (settings) => settings.isCensored,
  target: $isCensored,
});

sample({
  clock: saveToApiFx.doneData,
  fn: (settings) => settings.colorScheme,
  target: $colorScheme,
});
