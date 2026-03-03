import { TextInput } from "@mantine/core";
import { useStoreMap, useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $draft, fieldChanged } from "../../../model.form";

export function DraftNameField({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const value = useStoreMap({
    store: $draft,
    keys: [],
    fn: (draft) => draft.name,
  });
  const changeField = useUnit(fieldChanged);

  return (
    <TextInput
      label={t("cardDetails.fieldName")}
      disabled={disabled}
      value={value}
      onChange={(e) =>
        changeField({ field: "name", value: e.currentTarget.value })
      }
    />
  );
}
