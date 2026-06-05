// Ported from bb: apps/app/src/components/ui/copy-button.tsx
// (CopyButton only — CopyableInlineLabel was not needed by the timeline).
import { useCallback, useEffect, useState } from "react"
import { copyToClipboardWithToast } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { Icon } from "@/components/ui/icon"

interface ClipboardCopyOptions {
  text: string
  successMessage?: string | null
  errorMessage?: string | null
}

function useClipboardCopy({ text, successMessage = null, errorMessage = "Failed to copy" }: ClipboardCopyOptions) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeoutId = window.setTimeout(() => {
      setCopied(false)
    }, 2000)
    return () => window.clearTimeout(timeoutId)
  }, [copied])

  const copy = useCallback(async () => {
    if (!text || copied) return
    const success = await copyToClipboardWithToast(text, {
      successMessage,
      errorMessage,
    })
    if (success) setCopied(true)
  }, [text, copied, successMessage, errorMessage])

  return { copied, copy }
}

interface CopyButtonProps extends ClipboardCopyOptions {
  className?: string
  iconClassName?: string
  label?: string
}

export function CopyButton({
  text,
  className,
  iconClassName,
  label = "Copy to clipboard",
  successMessage,
  errorMessage,
}: CopyButtonProps) {
  const { copied, copy } = useClipboardCopy({
    text,
    successMessage,
    errorMessage,
  })

  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-5 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:opacity-100",
        className,
      )}
      onClick={() => {
        void copy()
      }}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <Icon name="Check" className={cn("size-3", iconClassName)} />
      ) : (
        <Icon name="Copy" className={cn("size-3", iconClassName)} />
      )}
    </button>
  )
}
