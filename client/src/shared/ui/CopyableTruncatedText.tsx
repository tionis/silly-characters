import { Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import i18n from "@/shared/i18n/i18n";

function middleEllipsis(value: string, keepStart = 14, keepEnd = 12): string {
  const v = value ?? "";
  if (v.length <= keepStart + keepEnd + 1) return v;
  const start = v.slice(0, Math.max(0, keepStart));
  const end = v.slice(Math.max(0, v.length - keepEnd));
  return `${start}…${end}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  const value = (text ?? "").toString();
  if (value.trim().length === 0) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for non-secure contexts / older browsers
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyableTruncatedText({
  value,
  copyValue,
  tooltip,
  keepStart,
  keepEnd,
  onCopiedMessage,
  onCopyFailedMessage,
  maxWidth = 220,
  dimmed,
}: {
  value: string | null | undefined;
  copyValue?: string | null | undefined;
  tooltip?: string | null | undefined;
  keepStart?: number;
  keepEnd?: number;
  onCopiedMessage?: string;
  onCopyFailedMessage?: string;
  maxWidth?: number | string;
  dimmed?: boolean;
}) {
  const raw = (value ?? "").toString();
  const copy = (copyValue ?? value ?? "").toString();
  const has = raw.trim().length > 0;
  const display = has
    ? middleEllipsis(raw, keepStart ?? 14, keepEnd ?? 12)
    : i18n.t("empty.dash");

  return (
    <Tooltip label={tooltip ?? (copy || raw || i18n.t("empty.dash"))} withArrow>
      <Text
        size="sm"
        c={dimmed ? "dimmed" : "blue"}
        style={{
          maxWidth,
          cursor: has ? "pointer" : "default",
          userSelect: has ? "none" : "text",
          wordBreak: "break-all",
        }}
        lineClamp={1}
        title={tooltip ?? (copy || raw || "")}
        onClick={() => {
          if (!has) return;
          void copyToClipboard(copy).then((ok) => {
            notifications.show({
              message: ok
                ? onCopiedMessage ?? i18n.t("actions.copied")
                : onCopyFailedMessage ?? i18n.t("errors.generic"),
              color: ok ? "green" : "red",
            });
          });
        }}
      >
        {display}
      </Text>
    </Tooltip>
  );
}
