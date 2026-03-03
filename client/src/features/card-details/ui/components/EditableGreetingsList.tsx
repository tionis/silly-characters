import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import type { Store } from "effector";
import { useStoreMap } from "effector-react";
import { useTranslation } from "react-i18next";
import { MdTextareaField } from "./MdTextareaField";

function GreetingRow({
  id,
  idx,
  totalCount,
  valuesStore,
  onChangeValue,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  resetKey,
}: {
  id: string;
  idx: number;
  totalCount: number;
  valuesStore: Store<Record<string, string>>;
  onChangeValue: (id: string, next: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
  resetKey?: string | number;
}) {
  const { t } = useTranslation();
  const value = useStoreMap({
    store: valuesStore,
    keys: [id],
    fn: (values, [key]) => values[key] ?? "",
  });

  const canMoveUp = idx > 0;
  const canMoveDown = idx < totalCount - 1;

  return (
    <MdTextareaField
      key={`${id}-${resetKey ?? "k"}`}
      label={
        <Group gap={8} wrap="nowrap">
          <Text size="sm" fw={600}>
            #{idx + 1}
          </Text>
          {onMoveUp && (
            <Tooltip label={t("cardDetails.moveUp")} withArrow>
              <ActionIcon
                variant="subtle"
                size="xs"
                disabled={!canMoveUp}
                aria-label={t("cardDetails.moveUp")}
                onClick={() => canMoveUp && onMoveUp(id)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              </ActionIcon>
            </Tooltip>
          )}
          {onMoveDown && (
            <Tooltip label={t("cardDetails.moveDown")} withArrow>
              <ActionIcon
                variant="subtle"
                size="xs"
                disabled={!canMoveDown}
                aria-label={t("cardDetails.moveDown")}
                onClick={() => canMoveDown && onMoveDown(id)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      }
      minRows={6}
      resetKey={`${resetKey ?? ""}:${id}`}
      value={value}
      onChange={(next) => onChangeValue(id, next)}
      extraActions={
        <Group gap={6} wrap="nowrap">
          <Tooltip label={t("cardDetails.duplicateField")} withArrow>
            <ActionIcon
              variant="light"
              aria-label={t("cardDetails.duplicateField")}
              onClick={() => onDuplicate(id)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </ActionIcon>
          </Tooltip>

          <Tooltip label={t("cardDetails.deleteField")} withArrow>
            <ActionIcon
              variant="light"
              color="red"
              aria-label={t("cardDetails.deleteField")}
              onClick={() => onDelete(id)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </ActionIcon>
          </Tooltip>
        </Group>
      }
    />
  );
}

export function EditableGreetingsList({
  title,
  ids,
  valuesStore,
  onChangeValue,
  onAdd,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  resetKey,
}: {
  title: string;
  ids: string[];
  valuesStore: Store<Record<string, string>>;
  onChangeValue: (id: string, next: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
  resetKey?: string | number;
}) {
  const { t } = useTranslation();

  return (
    <Paper p="md">
      <Group justify="space-between" align="center" mb="sm">
        <Group gap={8}>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Badge variant="light" color="gray">
            {(ids ?? []).length}
          </Badge>
        </Group>

        <Tooltip label={t("cardDetails.addField")} withArrow>
          <ActionIcon
            variant="light"
            color="indigo"
            onClick={onAdd}
            aria-label={t("cardDetails.addField")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </ActionIcon>
        </Tooltip>
      </Group>

      {(ids ?? []).length === 0 ? (
        <Text c="dimmed">{t("empty.dash")}</Text>
      ) : (
        <Stack gap="md">
          {ids.map((id, idx) => (
            <GreetingRow
              key={id}
              id={id}
              idx={idx}
              totalCount={ids.length}
              valuesStore={valuesStore}
              onChangeValue={onChangeValue}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              resetKey={resetKey}
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}
