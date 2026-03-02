'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

// Import custom markdown components
import {
  CodeBlock,
  InlineCode,
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  Text,
  UnorderedList,
  OrderedList,
  ListItem,
  BlockQuote,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Link,
  Strong,
  Emphasis,
  HorizontalRule,
  Break,
  MathInline,
  MathBlock,
} from '@/components/ai-elements/markdown-components';
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationCarouselHeader,
  InlineCitationSource,
} from '@/components/ai-elements/inline-citation';

// Plugins for extended Markdown support
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export interface CitationSource {
  title: string;
  url: string;
  content?: string;
}

interface MarkdownRendererProps {
  /**
   * Markdown content to render
   */
  content: string;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Whether to use tighter spacing (for chat messages)
   */
  compact?: boolean;
  /**
   * Whether content is actively being streamed — skips syntax highlighting
   */
  isStreaming?: boolean;
  /**
   * Citation sources — when provided, [N] markers in text are replaced with
   * hoverable citation pills inline.
   */
  sources?: CitationSource[];
}

/**
 * AST-based Markdown renderer with Shiki + Remark + Rehype
 * Handles streaming responses safely and renders rich formatting using custom design system components
 * 
 * Features:
 * - Remark + Rehype for proper Markdown AST parsing
 * - GFM support (tables, strikethrough, task lists)
 * - Math support (KaTeX)
 */
/**
 * Recursively walk React children, find raw strings containing [N] or 【N】,
 * and replace them with interactive citation pill components.
 */
function processTextWithCitations(
  children: React.ReactNode,
  sources: CitationSource[],
  keyPrefix = ''
): React.ReactNode {
  return React.Children.map(children, (child, childIdx) => {
    // Process string children — this is where [N] markers live
    if (typeof child === 'string') {
      const regex = /(?:(?:\[(\d+)\]|【(\d+)】)\s*)+/g;
      const individualRegex = /(?:\[(\d+)\]|【(\d+)】)/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(child)) !== null) {
        const clusterEnd = match.index + match[0].length;

        // Check for sentence-ending punctuation immediately after the citation cluster.
        // When the LLM writes "claim[1]." we want to render "claim.[1]" not "claim[1]."
        const nextChar = child[clusterEnd] ?? '';
        const trailingPunct = /^[.,;:!?]/.test(nextChar) ? nextChar : '';

        // Text before the citation cluster, plus any trailing punctuation hoisted before the pill
        const beforeText = child.substring(lastIndex, match.index);
        if (beforeText || trailingPunct) {
          parts.push(beforeText + trailingPunct);
        }

        // Extract individual citation numbers from the cluster
        const groupCitations: { number: number; source: CitationSource }[] = [];
        let indMatch;
        individualRegex.lastIndex = 0; // reset for each new cluster string
        while ((indMatch = individualRegex.exec(match[0])) !== null) {
          const num = parseInt(indMatch[1] || indMatch[2], 10);
          const source = sources[num - 1];
          if (source) {
            groupCitations.push({ number: num, source });
          }
        }

        if (groupCitations.length > 0) {
          parts.push(
            <InlineCitationCard key={`${keyPrefix}c-${childIdx}-${match.index}`} openDelay={100} closeDelay={300}>
              <InlineCitation className="inline">
                <InlineCitationCardTrigger
                  sources={groupCitations.map(c => c.source)}
                  indices={groupCitations.map(c => c.number)}
                />
              </InlineCitation>

              <InlineCitationCardBody>
                <InlineCitationCarousel>
                  <InlineCitationCarouselContent>
                    {groupCitations.map((c, i) => (
                      <InlineCitationCarouselItem key={i} className="pl-6 pr-6 py-4">
                        <InlineCitationSource
                          title={c.source.title}
                          url={c.source.url}
                          description={c.source.content}
                        />
                      </InlineCitationCarouselItem>
                    ))}
                  </InlineCitationCarouselContent>
                  <InlineCitationCarouselHeader sources={groupCitations.map(c => c.source)} />
                </InlineCitationCarousel>
              </InlineCitationCardBody>
            </InlineCitationCard>
          );
        } else {
          // No matching source — emit the citation text literally; punctuation was
          // already hoisted into the preceding text node above.
          parts.push(match[0]);
        }

        // Advance past the cluster and the hoisted punctuation character (if any)
        lastIndex = clusterEnd + (trailingPunct ? 1 : 0);
      }

      if (parts.length === 0) return child; // No citations found

      // Remaining text
      if (lastIndex < child.length) {
        parts.push(child.substring(lastIndex));
      }

      return <>{parts}</>;
    }

    // Recurse into React elements with children
    if (React.isValidElement(child) && (child as any).props?.children) {
      const props = (child as any).props;
      return React.cloneElement(child as React.ReactElement<any>, {
        ...props,
        children: processTextWithCitations(props.children, sources, `${keyPrefix}${childIdx}-`),
      });
    }

    return child;
  });
}

const InternalMarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  compact = false,
  isStreaming = false,
  sources,
}) => {
  // Normalize problematic unicode characters while preserving math delimiters
  const safeContent = React.useMemo(() => {
    if (!content) return content;

    let normalized = content;

    // Normalise Windows line endings so all downstream regexes only see \n
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Escape standalone currency dollar signs ($66,250 / $1.2B etc.) BEFORE the
    // math-extraction pass. remark-math would otherwise steal them as delimiters.
    // Pattern: $ immediately followed by a digit (currency), never $letter (math var).
    // We do this on a non-math-aware pass first, then the mathRegex below handles
    // legitimate $...$ math regions that already contain escaped chars.
    normalized = normalized.replace(/\$(?=\d)/g, '\\$');

    // Preserve math regions and don't normalize inside them
    const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]*?\$)/g;
    const mathBlocks: string[] = [];
    let mathIndex = 0;
    const placeholder = '\u0000MATH_PLACEHOLDER_';

    // Extract math blocks
    normalized = normalized.replace(mathRegex, (match) => {
      mathBlocks.push(match);
      return placeholder + (mathIndex++) + '\u0000';
    });

    // Normalize ALL hyphens/dashes to regular ASCII hyphen-minus (U+002D)
    // This includes: hyphen, non-breaking hyphen, en-dash, em-dash, etc.
    normalized = normalized.replace(/[\u2010-\u2015‐‑‒–—]/g, '-');

    // Normalize ALL spaces to regular space
    // This includes: non-breaking space, thin space, hair space, etc.
    normalized = normalized.replace(/[\u00A0\u2000-\u200B\u202F\u205F]/g, ' ');

    // Normalize quotes
    normalized = normalized.replace(/[\u2018\u2019]/g, "'"); // Curly single quotes
    normalized = normalized.replace(/[\u201C\u201D]/g, '"'); // Curly double quotes
    normalized = normalized.replace(/[\u00AD]/g, '-'); // Soft hyphen

    // Restore math blocks
    mathBlocks.forEach((block, idx) => {
      normalized = normalized.replace(placeholder + idx + '\u0000', block);
    });

    // ── Setext heading detection ────────────────────────────────────────────
    // Convert setext-style headings to ATX *before* the standalone-line
    // normalization so the underlines are consumed and never turned into <hr>.
    //   H1: text line followed by 3+ '=' characters
    //   H2: text line followed by 3+ '-' characters
    // Keep a --- under converted headings so the horizontal rule is preserved.
    normalized = normalized.replace(
      /^([^\n]+)\n[ \t]*={3,}[ \t]*$/gm,
      (_, headingText) => `\n# ${headingText.trim()}\n\n---\n\n`
    );
    normalized = normalized.replace(
      /^([^\n]+)\n[ \t]*-{3,}[ \t]*$/gm,
      (_, headingText) => `\n## ${headingText.trim()}\n\n---\n\n`
    );

    // ── Standalone decorative lines → thematic breaks ───────────────────────
    // Any remaining '===' or '---' lines (not consumed as setext underlines
    // above) are treated as horizontal rules.  Surrounding blank lines ensure
    // remark/CommonMark parses them as thematic breaks rather than stray text.
    normalized = normalized.replace(/^\s*={3,}\s*$/gm, '\n\n---\n\n');
    normalized = normalized.replace(/^\s*-{3,}\s*$/gm, '\n\n---\n\n');

    return normalized;
  }, [content]);

  // Helper: optionally wrap children through citation processing
  const cite = (children: React.ReactNode) =>
    sources && sources.length > 0
      ? processTextWithCitations(children, sources)
      : children;

  // Components mapping for react-markdown
  const components = useMemo(
    () => ({
      // Inline code only — bare `code` elements (backtick `code`)
      // react-markdown passes `node` with tagName; when code is inside <pre>
      // (fenced block), we must NOT render InlineCode.
      code: (props: any) => {
        const { children, className, node } = props;
        // If there's a language class, this is a fenced code block child —
        // let the `pre` handler deal with it by returning a raw <code>.
        if (className) {
          return <code className={className}>{children}</code>;
        }
        return <InlineCode>{children}</InlineCode>;
      },

      // Fenced code blocks — `pre` wraps `code` in react-markdown AST
      // Extract the child <code> element, read its language + content, render CodeBlock
      pre: (props: any) => {
        const { children } = props;

        // react-markdown renders <pre><code className="language-X">...</code></pre>
        // When our `code` override runs first, the child is an InlineCode or raw <code>.
        // We need to find ANY child that looks like a code element.
        const childArray = React.Children.toArray(children);

        for (const child of childArray) {
          if (!React.isValidElement(child)) continue;
          const childProps = (child as any).props;
          if (!childProps) continue;

          // Extract language from className (if present)
          const codeClassName = childProps.className || '';
          const language = codeClassName
            ? codeClassName.match(/language-(\w+)/)?.[1]
            : undefined;

          // Get the text content
          const codeChildren = childProps.children;
          const content = typeof codeChildren === 'string'
            ? codeChildren
            : String(codeChildren || '');

          if (content) {
            return (
              <CodeBlock
                language={language || 'plain'}
                code={content}
                isStreaming={isStreaming}
              />
            );
          }
        }

        // Fallback: render as-is
        return <pre className="overflow-x-auto my-4">{children}</pre>;
      },

      // Headings — citations can appear inside headings
      h1: (props: any) => <H1>{cite(props.children)}</H1>,
      h2: (props: any) => <H2>{cite(props.children)}</H2>,
      h3: (props: any) => <H3>{cite(props.children)}</H3>,
      h4: (props: any) => <H4>{cite(props.children)}</H4>,
      h5: (props: any) => <H5>{cite(props.children)}</H5>,
      h6: (props: any) => <H6>{cite(props.children)}</H6>,

      // Text — primary target for inline citations
      p: (props: any) => {
        if (compact) {
          return <span className={cn("inline leading-relaxed", props.className)}>{cite(props.children)}</span>;
        }
        return <Text>{cite(props.children)}</Text>;
      },

      // Lists
      ul: UnorderedList as any,
      ol: OrderedList as any,
      li: (props: any) => <ListItem>{cite(props.children)}</ListItem>,

      // Tables
      table: Table as any,
      thead: TableHead as any,
      tbody: TableBody as any,
      tr: TableRow as any,
      th: (props: any) => <TableCell isHeader={true}>{cite(props.children)}</TableCell>,
      td: (props: any) => <TableCell isHeader={false}>{cite(props.children)}</TableCell>,

      // Other elements
      blockquote: (props: any) => <BlockQuote>{cite(props.children)}</BlockQuote>,
      a: Link as any,
      hr: HorizontalRule as any,
      br: Break as any,

      // Math
      math: (props: any) => <MathBlock {...props} />,
      inlineMath: (props: any) => <MathInline {...props} />,

      // Text formatting
      strong: (props: any) => <Strong>{cite(props.children)}</Strong>,
      em: (props: any) => <Emphasis>{cite(props.children)}</Emphasis>,

      // GFM strikethrough
      del: ({ children }: any) => (
        <del className="line-through text-muted-foreground">{cite(children)}</del>
      ),

      // Images — constrained to container width, never overflow
      img: ({ src, alt, title }: any) => (
        <img
          src={src}
          alt={alt ?? ''}
          title={title}
          className="max-w-full h-auto rounded-lg my-4 block"
          loading="lazy"
        />
      ),
    }),
    [isStreaming, sources]
  );

  // Remark plugins for Markdown parsing
  // remarkMath detects $...$ and $$...$$ delimiters for inline and block math
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      remarkBreaks
    ],
    []
  );

  // Rehype plugins for AST transformation
  const rehypePlugins = useMemo(
    () => [
      [
        rehypeKatex,
        {
          strict: false, // Allow macros and relaxed parsing
          throwOnError: false, // Don't throw on problematic math, just skip rendering
          errorColor: '#cc0000',
          trust: true,
          fleqn: false, // Default equation alignment
          leqno: false, // Don't number equations
        },
      ] as any,
    ],
    []
  );

  return (
    <div
      className={cn(
        // Base wrapper with prose styling - increased text size from default
        'prose dark:prose-invert prose-base max-w-none w-full overflow-hidden',
        '[&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:w-full',
        '[&_code]:break-words',

        // Remove margins if compact
        compact && [
          '[&>*:first-child]:mt-0',
          '[&>*:last-child]:mb-0',
          '[&_h1]:mt-3 [&_h1]:mb-2',
          '[&_h2]:mt-2.5 [&_h2]:mb-1.5',
          '[&_h3]:mt-2 [&_h3]:mb-1',
          '[&_p]:my-1.5',
          '[&_ul]:my-1 [&_ol]:my-1',
          '[&_blockquote]:my-2',
          '[&_pre]:my-2',
        ],

        // Custom overrides
        'text-foreground',

        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownRenderer = React.memo(InternalMarkdownRenderer);
