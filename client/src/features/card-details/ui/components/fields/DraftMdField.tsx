import { useStoreMap, useUnit } from "effector-react";
import type { DraftField } from "../../../model.form";
import { $draft, fieldChanged } from "../../../model.form";
import { MdTextareaField } from "../MdTextareaField";

const STRING_FIELDS: ReadonlySet<DraftField> = new Set([
  "creator_notes",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
]);

export function DraftMdField({
  field,
  label,
  resetKey,
  minRows,
  disabled,
}: {
  field: DraftField;
  label: string;
  resetKey?: string | number;
  minRows?: number;
  disabled?: boolean;
}) {
  if (!STRING_FIELDS.has(field)) {
    throw new Error(`DraftMdField: unsupported field '${String(field)}'`);
  }

  const value = useStoreMap({
    store: $draft,
    keys: [field],
    fn: (draft, [f]) => draft[f] as string,
  });
  const changeField = useUnit(fieldChanged);

  return (
    <MdTextareaField
      label={label}
      resetKey={resetKey}
      minRows={minRows}
      value={value}
      onChange={(next) => changeField({ field, value: next })}
      textareaProps={{ disabled }}
    />
  );
}
