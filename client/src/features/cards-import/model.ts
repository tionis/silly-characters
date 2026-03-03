import {
  createEffect,
  createEvent,
  createStore,
  sample,
} from "effector";
import { notifications } from "@mantine/notifications";
import i18n from "@/shared/i18n/i18n";
import { startCardsImport } from "@/shared/api/cards-import";
import type {
  DuplicatesMode,
  ImportSettings,
} from "@/shared/types/import-settings";

const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  duplicatesMode: "skip",
};

export const openImportModal = createEvent<void>();
export const closeImportModal = createEvent<void>();
export const duplicatesModeChanged = createEvent<DuplicatesMode>();
export const importRequested = createEvent<{ files: File[] }>();

const setError = createEvent<string | null>();

export const startImportFx = createEffect<
  {
    files: File[];
    duplicatesMode: DuplicatesMode;
  },
  { ok: true; started: true },
  Error
>(async (params) => {
  return await startCardsImport(params);
});

export const $opened = createStore(false)
  .on(openImportModal, () => true)
  .on(closeImportModal, () => false);

export const $importSettings = createStore<ImportSettings>(
  DEFAULT_IMPORT_SETTINGS
)
  .on(duplicatesModeChanged, (s, v) => ({ ...s, duplicatesMode: v }));

export const $error = createStore<string | null>(null).on(
  setError,
  (_, v) => v
);

export const $isLoading = startImportFx.pending;

export const $isStartingImport = startImportFx.pending;

sample({
  clock: openImportModal,
  fn: () => null,
  target: setError,
});

// Import -> validate and start.
sample({
  clock: importRequested,
  source: $importSettings,
  filter: (_settings, payload) => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    return files.length > 0;
  },
  fn: (settings, payload) => ({
    files: payload.files,
    duplicatesMode: settings.duplicatesMode,
  }),
  target: startImportFx,
});

sample({
  clock: importRequested,
  filter: (payload) => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    return files.length === 0;
  },
  fn: () => {
    return i18n.t("cardsImport.filesRequired");
  },
  target: setError,
});

sample({
  clock: startImportFx.doneData,
  fn: () => {
    notifications.show({
      title: i18n.t("cardsImport.importStartedTitle"),
      message: i18n.t("cardsImport.importStartedMessage"),
      color: "green",
    });
    return null;
  },
  target: [closeImportModal, setError],
});

sample({
  clock: startImportFx.failData,
  fn: (e) => e.message,
  target: setError,
});
