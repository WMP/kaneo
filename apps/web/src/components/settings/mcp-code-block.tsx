import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { toast } from "@/lib/toast";

const COPIED_RESET_MS = 2000;

type Props = {
  /** Accessible name of the snippet, also used in the copy button label. */
  label: string;
  value: string;
};

export function McpCodeBlock({ label, value }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);

    if (!ok) {
      // Leave the text selected so Ctrl+C still works.
      const node = preRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      toast.error(t("settings:mcpPage.copyFailed"));
      return;
    }

    setCopied(true);
    toast.success(t("settings:mcpPage.toastCopied"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <figure
      aria-label={label}
      className="flex items-start gap-2 rounded-lg border bg-muted/40 p-2"
    >
      <pre
        ref={preRef}
        className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1 py-1.5 font-mono text-xs leading-relaxed"
      >
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5"
        aria-label={t("settings:mcpPage.copyAria", { label })}
        onClick={handleCopy}
      >
        {copied ? (
          <>
            <CheckIcon className="size-3 text-success-foreground" />
            {t("settings:mcpPage.copied")}
          </>
        ) : (
          <>
            <CopyIcon className="size-3" />
            {t("settings:mcpPage.copy")}
          </>
        )}
      </Button>
    </figure>
  );
}
