// Ported from bb: apps/app/src/components/ui/markdown-preview.tsx
// Adaptations for the viewer:
//   - bb's local-file-link normalization / handlers (markdown-local-file-link*,
//     markdown-link) are dropped — the viewer's transcripts carry no local-file
//     anchor protocol — along with the `onOpenLink`/`onOpenLocalFileLink` props.
//   - bb's ImageLightbox is dropped; markdown images render inline (the
//     transcripts don't carry image attachments).
//   - `usePreferredTheme` comes from the viewer's class-based theme instead of
//     bb's jotai theme hook.
// The full markdown component map (headings, code blocks with copy button,
// tables with breakout, blockquotes, etc.) and the content-width CSS variable
// observer are bb's code verbatim.
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
} from "react"
import ReactMarkdown from "react-markdown"
import type { Components, ExtraProps, Options as ReactMarkdownOptions, UrlTransform } from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import { CopyButton } from "./copy-button"
import { usePreferredTheme, type Theme } from "@/lib/use-preferred-theme"
import { cn } from "@/lib/utils"

export interface MarkdownPreviewProps {
  allowHtml?: boolean
  className?: string
  content: string
  urlTransform?: UrlTransform
}

interface BuildMarkdownComponentsArgs {
  preferredTheme: Theme
}

interface ResolveMarkdownSourceMediaArgs {
  media: MarkdownSourceMedia
  preferredTheme: Theme
}

interface SetMarkdownContentWidthVariableArgs {
  element: HTMLElement
  width: number
}

type MarkdownBlockquoteProps = ComponentPropsWithoutRef<"blockquote"> & ExtraProps
type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & ExtraProps
type MarkdownHeadingProps = ComponentPropsWithoutRef<"h1"> & ExtraProps
type MarkdownHrProps = ComponentPropsWithoutRef<"hr"> & ExtraProps
type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & ExtraProps
type MarkdownListItemProps = ComponentPropsWithoutRef<"li"> & ExtraProps
type MarkdownOrderedListProps = ComponentPropsWithoutRef<"ol"> & ExtraProps
type MarkdownParagraphProps = ComponentPropsWithoutRef<"p"> & ExtraProps
type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & ExtraProps
type MarkdownSourceMedia = ComponentPropsWithoutRef<"source">["media"]
type MarkdownSourceProps = ComponentPropsWithoutRef<"source"> & ExtraProps
type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & ExtraProps
type MarkdownTableCellProps = ComponentPropsWithoutRef<"td"> & ExtraProps
type MarkdownTableHeadProps = ComponentPropsWithoutRef<"thead"> & ExtraProps
type MarkdownTableHeaderProps = ComponentPropsWithoutRef<"th"> & ExtraProps
type MarkdownUnorderedListProps = ComponentPropsWithoutRef<"ul"> & ExtraProps
type MarkdownRehypePlugins = NonNullable<ReactMarkdownOptions["rehypePlugins"]>

const MARKDOWN_TABLE_BREAKOUT_WIDTH = "max(100%, min(1100px, 100cqw - 2rem))"
const MARKDOWN_CONTENT_WIDTH_VARIABLE = "--md-content-w"
const MARKDOWN_SOURCE_COLOR_SCHEME_MEDIA_PATTERN = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/iu
// Security-critical order: raw HTML must become nodes before sanitization can
// strip unsafe elements, attributes, and URLs.
const MARKDOWN_HTML_REHYPE_PLUGINS: MarkdownRehypePlugins = [rehypeRaw, rehypeSanitize]

function MarkdownCode({ className: codeClassName, children, node: _node, ...props }: MarkdownCodeProps) {
  const codeText = String(children ?? "").replace(/\n$/, "")
  const languageMatch = /language-(\w+)/u.exec(codeClassName || "")
  const language = languageMatch?.[1]
  const isBlock = language !== undefined || codeText.includes("\n")
  if (isBlock) {
    return (
      <div className="my-2 overflow-hidden rounded-md border border-border bg-surface-recessed">
        <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
          <span className="font-mono text-xs uppercase text-muted-foreground">{language ?? ""}</span>
          <CopyButton text={codeText} label="Copy code" />
        </div>
        <pre className="overflow-x-auto px-3 pb-3 pt-1">
          <code className={cn("font-mono text-xs", language ? `language-${language}` : "")} {...props}>
            {codeText}
          </code>
        </pre>
      </div>
    )
  }
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" {...props}>
      {children}
    </code>
  )
}

function MarkdownPre({ children }: MarkdownPreProps) {
  return <>{children}</>
}

function MarkdownH1({ children }: MarkdownHeadingProps) {
  return <h1 className="mb-2 mt-4 text-lg font-semibold text-foreground first:mt-0">{children}</h1>
}

function MarkdownH2({ children }: MarkdownHeadingProps) {
  return <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>
}

function MarkdownH3({ children }: MarkdownHeadingProps) {
  return <h3 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
}

function MarkdownH4({ children }: MarkdownHeadingProps) {
  return <h4 className="mb-1 mt-3 text-sm font-medium text-foreground first:mt-0">{children}</h4>
}

function MarkdownH5({ children }: MarkdownHeadingProps) {
  return <h5 className="mb-1 mt-2 text-sm font-semibold uppercase text-muted-foreground first:mt-0">{children}</h5>
}

function MarkdownH6({ children }: MarkdownHeadingProps) {
  return <h6 className="mb-1 mt-2 text-xs font-semibold uppercase text-muted-foreground first:mt-0">{children}</h6>
}

function MarkdownParagraph({ children, className: _className, node: _node, ...paragraphProps }: MarkdownParagraphProps) {
  return (
    <p {...paragraphProps} className="mb-2 text-foreground last:mb-0">
      {children}
    </p>
  )
}

function MarkdownUnorderedList({ children }: MarkdownUnorderedListProps) {
  return <ul className="mb-2 list-disc pl-5 text-foreground">{children}</ul>
}

function MarkdownOrderedList({ children }: MarkdownOrderedListProps) {
  return <ol className="mb-2 list-decimal pl-5 text-foreground">{children}</ol>
}

function MarkdownListItem({ children }: MarkdownListItemProps) {
  return <li className="mb-1 text-foreground">{children}</li>
}

function MarkdownBlockquote({ children }: MarkdownBlockquoteProps) {
  return <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">{children}</blockquote>
}

function MarkdownTable({ children }: MarkdownTableProps) {
  return (
    <div
      className="my-2 flex justify-center"
      style={{
        width: MARKDOWN_TABLE_BREAKOUT_WIDTH,
        marginInline: `calc((100% - ${MARKDOWN_TABLE_BREAKOUT_WIDTH}) / 2)`,
      }}
    >
      <div
        className="w-max max-w-full overflow-x-auto"
        style={{
          minWidth: `min(var(${MARKDOWN_CONTENT_WIDTH_VARIABLE}), 100%)`,
        }}
      >
        <table className="border border-border">{children}</table>
      </div>
    </div>
  )
}

function MarkdownTableHead({ children }: MarkdownTableHeadProps) {
  return <thead className="bg-surface-recessed">{children}</thead>
}

function MarkdownTableHeader({ children }: MarkdownTableHeaderProps) {
  return <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
}

function MarkdownTableCell({ children }: MarkdownTableCellProps) {
  return <td className="border border-border px-2 py-1">{children}</td>
}

function MarkdownImage({ src, alt }: MarkdownImageProps) {
  const imageUrl = typeof src === "string" ? src : ""
  if (!imageUrl) return null
  return (
    <img
      src={imageUrl}
      alt={typeof alt === "string" ? alt : "Image"}
      className="my-2 max-h-96 max-w-full object-contain"
      loading="lazy"
    />
  )
}

function MarkdownHr(_props: MarkdownHrProps) {
  return <hr className="my-4 border-t border-border" />
}

function MarkdownAnchor(props: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const { children, node: _node, ...anchorProps } = props
  return (
    <a {...anchorProps} className="break-words underline underline-offset-2" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

function parseMarkdownSourceColorScheme(media: string): Theme | null {
  const match = MARKDOWN_SOURCE_COLOR_SCHEME_MEDIA_PATTERN.exec(media)
  const colorScheme = match?.[1]
  if (colorScheme === "dark" || colorScheme === "light") {
    return colorScheme
  }
  return null
}

function resolveMarkdownSourceMedia({ media, preferredTheme }: ResolveMarkdownSourceMediaArgs): MarkdownSourceMedia {
  if (!media) return media
  const colorScheme = parseMarkdownSourceColorScheme(media)
  if (!colorScheme) return media
  return colorScheme === preferredTheme ? "all" : "not all"
}

function buildMarkdownComponents({ preferredTheme }: BuildMarkdownComponentsArgs): Components {
  function MarkdownSource({ media, node: _node, ...sourceProps }: MarkdownSourceProps) {
    return <source {...sourceProps} media={resolveMarkdownSourceMedia({ media, preferredTheme })} />
  }

  return {
    a: MarkdownAnchor,
    blockquote: MarkdownBlockquote,
    code: MarkdownCode,
    h1: MarkdownH1,
    h2: MarkdownH2,
    h3: MarkdownH3,
    h4: MarkdownH4,
    h5: MarkdownH5,
    h6: MarkdownH6,
    hr: MarkdownHr,
    img: MarkdownImage,
    li: MarkdownListItem,
    ol: MarkdownOrderedList,
    p: MarkdownParagraph,
    pre: MarkdownPre,
    source: MarkdownSource,
    table: MarkdownTable,
    td: MarkdownTableCell,
    th: MarkdownTableHeader,
    thead: MarkdownTableHead,
    ul: MarkdownUnorderedList,
  }
}

function setMarkdownContentWidthVariable({ element, width }: SetMarkdownContentWidthVariableArgs): void {
  if (width <= 0) {
    return
  }
  element.style.setProperty(MARKDOWN_CONTENT_WIDTH_VARIABLE, `${width}px`)
}

function useMarkdownContentWidthVariable() {
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) {
      return
    }
    setMarkdownContentWidthVariable({
      element,
      width: element.getBoundingClientRect().width,
    })
    if (typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      setMarkdownContentWidthVariable({
        element,
        width: entry.contentRect.width,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return contentRef
}

function MarkdownPreviewComponent({ allowHtml = false, className, content, urlTransform }: MarkdownPreviewProps) {
  const preferredTheme = usePreferredTheme()
  const contentRef = useMarkdownContentWidthVariable()
  const markdownComponents = useMemo(() => buildMarkdownComponents({ preferredTheme }), [preferredTheme])

  return (
    <div
      ref={contentRef}
      className={cn("max-w-none break-words text-sm leading-relaxed text-foreground", className)}
    >
      <ReactMarkdown
        rehypePlugins={allowHtml ? MARKDOWN_HTML_REHYPE_PLUGINS : undefined}
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={urlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownPreview = memo(MarkdownPreviewComponent)
MarkdownPreview.displayName = "MarkdownPreview"
