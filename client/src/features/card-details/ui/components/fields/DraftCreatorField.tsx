import { TextInput } from "@mantine/core";
import { useStoreMap, useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $draft, fieldChanged } from "../../../model.form";

export function DraftCreatorField({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const value = useStoreMap({
    store: $draft,
    keys: [],
    fn: (draft) => draft.creator,
  });
  const changeField = useUnit(fieldChanged);

  return (
    <TextInput
      label={t("cardDetails.fieldCreator")}
      disabled={disabled}
      value={value}
      onChange={(e) =>
        changeField({ field: "creator", value: e.currentTarget.value })
      }
    />
  );
}
