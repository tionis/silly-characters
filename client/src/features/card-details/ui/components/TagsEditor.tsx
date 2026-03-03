import { useEffect, useState } from "react";
import { Paper, Stack, TagsInput, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getTags } from "@/shared/api/tags";

let cachedOptions: string[] | null = null;
let inFlight: Promise<string[]> | null = null;

async function loadTagOptions(): Promise<string[]> {
  if (cachedOptions) return cachedOptions;
  if (!inFlight) {
    inFlight = getTags()
      .then((tags) =>
        tags
          .map((t) => t.name)
          .filter((x) => x.trim().length > 0)
          .sort((a, b) => a.localeCompare(b))
      )
      .then((names) => {
        cachedOptions = names;
        return names;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function TagsEditor({
  label,
  placeholder,
  disabled,
  resetKey,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  resetKey?: string | number;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<string[]>(() => cachedOptions ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void loadTagOptions()
      .then((names) => {
        if (cancelled) return;
        setOptions(names);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("errors.loadTags"));
      });
    return () => {
      cancelled = true;
    };
  }, [t, resetKey]);

  return (
    <Paper p="md" style={{ minHeight: 110 }}>
      <Stack gap="xs">
        <TagsInput
          label={label}
          placeholder={placeholder}
          data={options}
          disabled={disabled}
          clearable
          acceptValueOnBlur
          splitChars={[",", ";"]}
          value={value}
          onChange={onChange}
        />

        {error && (
          <Text size="sm" c="dimmed">
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
