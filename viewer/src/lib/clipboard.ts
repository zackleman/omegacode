// Minimal stand-in for bb's @/lib/clipboard. bb's version routes through its
// app-toast infra; the viewer has no toast surface, so this just copies and
// reports success/failure. Signature kept compatible with the ported
// CopyButton.

export interface CopyToClipboardOptions {
  successMessage?: string | null
  errorMessage?: string | null
}

export async function copyToClipboardWithToast(text: string, _options?: CopyToClipboardOptions): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
