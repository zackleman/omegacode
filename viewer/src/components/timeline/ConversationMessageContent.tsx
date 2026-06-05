// Adapted from bb:
// apps/app/src/components/thread/timeline/ConversationMessageContent.tsx
//
// bb's component handles attachments, an image lightbox, local-file links, and
// the muted `[bb …]` prefix for agent-initiated messages. The viewer's
// transcripts carry none of that, so this keeps the two render paths that
// matter — assistant prose through bb's MarkdownPreview, and the user-message
// bubble with bb's collapsible "Show more" behavior — and drops the rest.
import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/ui/copy-button"
import { MarkdownPreview } from "@/components/ui/markdown-preview"

export type ConversationMessageRole = "user" | "assistant"

export interface ConversationMessageContentProps {
  role: ConversationMessageRole
  text: string
}

const COLLAPSED_MESSAGE_LINE_COUNT = 15
const USER_MESSAGE_CHAR_CAP = 4096

function splitPreWrappedLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/u)
}

function useIsOverflowing(
  elementRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  measurementKey: string,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false)

  useLayoutEffect(() => {
    if (!enabled) {
      setIsOverflowing(false)
      return
    }
    const element = elementRef.current
    if (!element) {
      return
    }
    const measure = () => {
      setIsOverflowing(element.scrollHeight > element.clientHeight + 1)
    }
    measure()
    if (typeof ResizeObserver === "undefined") {
      return
    }
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [elementRef, enabled, measurementKey])

  return isOverflowing
}

function CollapsibleMessageText({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const isTruncated = text.length > USER_MESSAGE_CHAR_CAP
  const cappedBody = isTruncated ? text.slice(0, USER_MESSAGE_CHAR_CAP) : text
  const lines = splitPreWrappedLines(cappedBody)
  const exceedsCollapsedLineCount = lines.length > COLLAPSED_MESSAGE_LINE_COUNT
  const renderedBody =
    isExpanded || !exceedsCollapsedLineCount ? cappedBody : lines.slice(0, COLLAPSED_MESSAGE_LINE_COUNT).join("\n")
  const isOverflowing = useIsOverflowing(textRef, !isExpanded, renderedBody)
  const showToggle = isExpanded || exceedsCollapsedLineCount || isOverflowing

  return (
    <>
      <p ref={textRef} className={cn("whitespace-pre-wrap break-words", !isExpanded && "line-clamp-[15]")}>
        {renderedBody}
        {isExpanded && isTruncated ? <span className="text-muted-foreground"> [truncated]</span> : null}
      </p>
      {showToggle ? (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={isExpanded}
          >
            {isExpanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : null}
    </>
  )
}

function UserConversationMessage({ text }: { text: string }) {
  const messageText = text.trim()
  return (
    <div className="w-full">
      <div className="ml-auto w-fit max-w-[80%]">
        <div className="rounded-md bg-surface-selected p-2 text-sm leading-relaxed text-foreground">
          {messageText ? (
            <CollapsibleMessageText text={text} />
          ) : (
            <p className="text-muted-foreground">Sent attachments</p>
          )}
        </div>
        {messageText ? (
          <div className="mt-1 flex items-center justify-end gap-2">
            <CopyButton text={text} label="Copy message" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AssistantConversationMessage({ text }: { text: string }) {
  return (
    <div className="group w-full px-2 text-sm leading-relaxed">
      <MarkdownPreview content={text} />
    </div>
  )
}

export function ConversationMessageContent({ role, text }: ConversationMessageContentProps) {
  if (role === "user") {
    return <UserConversationMessage text={text} />
  }
  return <AssistantConversationMessage text={text} />
}
