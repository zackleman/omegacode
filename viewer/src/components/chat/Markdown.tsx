import ReactMarkdown from "react-markdown"

import { cn } from "@/lib/utils"

/** Assistant prose. Light markdown only (no raw HTML — content is model-authored). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed break-words [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3">
      <ReactMarkdown
        components={{
          p: (props) => <p className="my-1.5 first:mt-0 last:mb-0" {...props} />,
          a: (props) => <a className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
          ul: (props) => <ul className="my-1.5 list-disc pl-5" {...props} />,
          ol: (props) => <ol className="my-1.5 list-decimal pl-5" {...props} />,
          li: (props) => <li className="my-0.5" {...props} />,
          h1: (props) => <h1 className="mt-3 mb-1 text-base font-semibold first:mt-0" {...props} />,
          h2: (props) => <h2 className="mt-3 mb-1 text-sm font-semibold first:mt-0" {...props} />,
          h3: (props) => <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0" {...props} />,
          blockquote: (props) => <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground" {...props} />,
          code: ({ className, children, ...props }) => {
            const block = /language-/.test(className ?? "")
            return block ? (
              <code className={cn("font-mono text-xs leading-relaxed", className)} {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
