import { useStoreMap, useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $draft, fieldChanged } from "../../../model.form";
import { TagsEditor } from "../TagsEditor";

export function DraftTagsField({
  disabled,
  resetKey,
}: {
  disabled?: boolean;
  resetKey?: string | number;
}) {
  const { t } = useTranslation();
  const value = useStoreMap({
    store: $draft,
    keys: [],
    fn: (draft) => draft.tags,
  });
  const changeField = useUnit(fieldChanged);

  return (
    <TagsEditor
      label={t("cardDetails.fieldTags")}
      disabled={disabled}
      resetKey={resetKey}
      value={value}
      onChange={(next) => changeField({ field: "tags", value: next })}
    />
  );
}
