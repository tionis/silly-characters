import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Badge,
} from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import {
  $error,
  $importSettings,
  $isLoading,
  $isStartingImport,
  $opened,
  closeImportModal,
  duplicatesModeChanged,
  importRequested,
} from "../model";

export function CardsImportModal() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [
    opened,
    settings,
    error,
    isLoading,
    isStarting,
    onClose,
    onChangeDuplicates,
    onImport,
  ] = useUnit([
    $opened,
    $importSettings,
    $error,
    $isLoading,
    $isStartingImport,
    closeImportModal,
    duplicatesModeChanged,
    importRequested,
  ]);

  useEffect(() => {
    if (opened) return;
    setFiles([]);
  }, [opened]);

  const canImport = files.length > 0;
  const setDuplicatesMode = (v: string) => {
    if (v === "skip" || v === "copy") onChangeDuplicates(v);
  };
  const selectedCountLabel = useMemo(() => {
    if (files.length <= 0) return null;
    return t("cardsImport.selectedCount", { count: files.length });
  }, [files.length, t]);

  return (
    <Modal
      opened={opened}
      onClose={() => onClose()}
      title={t("cardsImport.title")}
      centered
      size="md"
      padding="lg"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("cardsImport.description")}
        </Text>

        {error && (
          <Alert color="red" title={t("errors.generic")}>
            {error}
          </Alert>
        )}

        <FileInput
          multiple
          clearable
          accept="image/png,.png"
          label={t("cardsImport.filesLabel")}
          placeholder={t("cardsImport.filesPlaceholder")}
          value={files}
          onChange={(value) => {
            if (Array.isArray(value)) {
              setFiles(value);
              return;
            }
            if (value) {
              setFiles([value]);
              return;
            }
            setFiles([]);
          }}
        />

        {selectedCountLabel ? <Badge>{selectedCountLabel}</Badge> : null}

        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {t("cardsImport.duplicatesModeLabel")}
          </Text>
          <SegmentedControl
            fullWidth
            value={settings.duplicatesMode}
            onChange={setDuplicatesMode}
            data={[
              { value: "skip", label: t("cardsImport.duplicatesModeSkip") },
              { value: "copy", label: t("cardsImport.duplicatesModeCopy") },
            ]}
          />
        </Stack>

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => onClose()} disabled={isLoading}>
            {t("actions.cancel")}
          </Button>
          <Button
            color="green"
            onClick={() => onImport({ files })}
            disabled={!canImport || isLoading}
            loading={isStarting}
          >
            {t("cardsImport.importButton")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

