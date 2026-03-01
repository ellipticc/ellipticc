'use client';

import React, { useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { IconCopy, IconCheck, IconCode } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { highlightCode } from '@/lib/shiki-highlighter';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * CodeBlock Component
 * Renders fenced code blocks with Shiki highlighting, lowercase language label, hover-only copy button
 */
const InternalCodeBlock = React.forwardRef<
  HTMLDivElement,
  {
    language?: string;
    code?: string;
    children?: React.ReactNode;
    className?: string;
    isStreaming?: boolean;
  }
>(({ language = 'plain', code, children, className, isStreaming = false }, ref) => {
  const { theme, resolvedTheme } = useTheme();
  // Prefer resolvedTheme so `system` follows the OS preference on first render
  const isDark = (resolvedTheme || theme) === 'dark';
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = React.useState<string | null>(null);
  // Track local hover for this specific code block so copy button only shows for the hovered block
  const [isHovered, setIsHovered] = React.useState(false);

  // Get code content
  const codeContent = code || (typeof children === 'string' ? children : String(children || ''));

  // Highlight code live — always run, never clear previous output while loading
  React.useEffect(() => {
    if (!codeContent.trim()) return;

    let cancelled = false;
    (async () => {
      try {
        const safeLanguage = language === 'conf' ? 'properties' : language;
        const html = await highlightCode(codeContent, safeLanguage, isDark);
        if (!cancelled) {
          setHighlightedHtml(html);
        }
      } catch (error) {
        console.warn(`Failed to highlight code (${language}):`, error);
        // Don't clear highlightedHtml on error — keep showing stale version
      }
    })();

    return () => { cancelled = true; };
  }, [codeContent, language, isDark]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Map language codes to lowercase labels (ChatGPT style)
  const languageLabel = language === 'plain' ? 'code' : language.toLowerCase();

  // Fixed color values for light/dark modes
  const bgColor = isDark ? '#171717' : '#f9f9f9';
  const textColor = isDark ? '#e5e5e5' : '#1a1a1a';
  const labelColor = isDark ? '#a1a1a1' : '#666666';

  return (
    <div
      ref={ref}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'my-4 rounded-lg overflow-hidden',
        'border border-border/40 dark:border-border/50',
        'group w-full max-w-full',
        className
      )}
      style={{ backgroundColor: bgColor, maxWidth: '100%' }}
    >
      {/* Header with Language Label */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <IconCode className="h-3.5 w-3.5" style={{ color: labelColor }} />
          <span className="text-xs font-medium" style={{ color: labelColor }}>
            {languageLabel}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className={cn('h-5 w-5 p-0 transition-opacity', isHovered ? 'opacity-100' : 'opacity-0')}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <IconCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" style={{ color: labelColor }} />
          )}
        </Button>
      </div>

      {/* Code Content - Direct Scroll with Strict Width */}
      <div className="overflow-x-auto w-full" style={{ backgroundColor: bgColor }}>
        {highlightedHtml ? (
          <div className="p-0">
            <div
              className={cn(
                'p-4 text-sm font-mono inline-block whitespace-pre',
                'min-w-[max-content]',
                '[&_*]:!bg-transparent [&_*]:!background-transparent',
                '[&_span]:!background-color-transparent'
              )}
              style={{ color: textColor, backgroundColor: 'transparent', fontFamily: "'IBM Plex Mono', monospace", minWidth: 'max-content' }}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </div>
        ) : (
          <div className="p-0">
            <pre className={cn(
              'p-4 m-0 text-sm font-mono',
              'whitespace-pre'
            )}
              style={{ color: textColor, backgroundColor: 'transparent', fontFamily: "'IBM Plex Mono', monospace", display: 'inline-block', minWidth: 'max-content' }}>
              <code>{codeContent}</code>
            </pre>
          </div>
        )}
      </div>

      {/* Full Screen Preview */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" resizable initialFraction={0.5} minWidth={400} className="max-w-none p-0" style={{ backgroundColor: '#171717' }}>
          <div className="flex flex-col h-full">
            {/* Preview Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
              <div>
                <SheetTitle className="text-sm font-medium" style={{ color: textColor }}>
                  {languageLabel || 'code'}
                </SheetTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-7 gap-2 text-xs"
                title={copied ? 'Copied!' : 'Copy code'}
              >
                {copied ? (
                  <>
                    <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <IconCopy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-x-auto" style={{ backgroundColor: '#171717', maxWidth: '100%' }}>
              {highlightedHtml ? (
                <div className="p-0">
                  <div
                    className={cn(
                      'p-6 text-sm font-mono inline-block whitespace-pre',
                      'min-w-[max-content]',
                      '[&_*]:!bg-transparent [&_*]:!background-transparent',
                      '[&_span]:!background-color-transparent'
                    )}
                    style={{ color: '#e5e5e5', backgroundColor: 'transparent', fontFamily: "'IBM Plex Mono', monospace", minWidth: 'max-content' }}
                    dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                  />
                </div>
              ) : (
                <div className="p-0">
                  <pre className={cn(
                    'p-6 m-0 text-sm font-mono',
                    'whitespace-pre'
                  )}
                    style={{ color: '#e5e5e5', backgroundColor: 'transparent', fontFamily: "'IBM Plex Mono', monospace", display: 'inline-block', minWidth: 'max-content' }}>
                    <code>{codeContent}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
});

InternalCodeBlock.displayName = 'CodeBlock';

export const CodeBlock = React.memo(InternalCodeBlock, (prev, next) => {
  return prev.code === next.code && prev.language === next.language && prev.children === next.children && prev.isStreaming === next.isStreaming;
});

/**
 * InlineCode Component
 * Renders single backtick code as inline element
 */
export const InlineCode: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <code
    className={cn(
      'inline align-baseline px-1.5 py-0.5 rounded-md break-words',
      'bg-muted text-xs font-mono text-foreground',
      'border border-border',
      'mx-0.5',
      className
    )}
    style={{ display: 'inline', fontSize: '0.85em' }}
  >
    {children}
  </code>
);

/**
 * Heading Components
 */
export const H1: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <h1
    className={cn(
      'text-2xl sm:text-3xl font-bold',
      'text-foreground',
      'mt-8 mb-4 first:mt-0',
      'tracking-tight',
      className
    )}
  >
    {children}
  </h1>
);

export const H2: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <h2
    className={cn(
      'text-xl sm:text-2xl font-bold',
      'text-foreground',
      'mt-7 mb-3 first:mt-0',
      'tracking-tight',
      className
    )}
  >
    {children}
  </h2>
);

export const H3: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <h3
    className={cn(
      'text-lg font-semibold',
      'text-foreground',
      'mt-6 mb-2 first:mt-0',
      'tracking-tight',
      className
    )}
  >
    {children}
  </h3>
);

export const H4: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <h4
    className={cn(
      'text-base font-semibold',
      'text-foreground',
      'mt-5 mb-2 first:mt-0',
      'tracking-tight',
      className
    )}
  >
    {children}
  </h4>
);

export const H5: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <h5
    className={cn(
      'text-sm font-semibold',
      'text-foreground',
      'mt-4 mb-1.5 first:mt-0',
      className
    )}
  >
    {children}
  </h5>
);

export const H6: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <h6
    className={cn(
      'text-xs font-semibold uppercase',
      'text-muted-foreground',
      'mt-3 mb-1 first:mt-0',
      'tracking-widest',
      className
    )}
  >
    {children}
  </h6>
);

/**
 * Text/Paragraph Component
 */
export const Text: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <p
    className={cn(
      'text-foreground',
      'text-[14px] leading-relaxed',
      'my-2.5',
      className
    )}
  >
    {children}
  </p>
);

/**
 * List Components
 */
export const UnorderedList: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <ul
    className={cn(
      'list-disc list-outside',
      'my-3 space-y-1.5 pl-6',
      'text-foreground text-[14px]',
      className
    )}
  >
    {children}
  </ul>
);

export const OrderedList: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <ol
    className={cn(
      'list-decimal list-outside',
      'my-3 space-y-1.5 pl-6',
      'text-foreground text-[14px]',
      className
    )}
  >
    {children}
  </ol>
);

export const ListItem: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <li className={cn('text-foreground leading-relaxed', className)}>
    {children}
  </li>
);

/**
 * BlockQuote Component
 */
export const BlockQuote: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <blockquote
    className={cn(
      'border-l-4 border-primary/40 pl-4 pr-2 py-1 my-4',
      'bg-muted/30 rounded-r-md',
      'text-muted-foreground italic',
      '[&_p]:my-0 [&_p]:text-muted-foreground',
      className
    )}
  >
    {children}
  </blockquote>
);

/**
 * Table Components - Using security tab styling
 */
export const Table: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('my-4 border border-border rounded-lg overflow-hidden bg-card dark:border-white/15 dark:bg-black/30', className)}>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  </div>
);

export const TableHead: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <thead className={cn('bg-muted/50 border-b dark:bg-black/40 dark:border-b-white/10', className)}>
    {children}
  </thead>
);

export const TableBody: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <tbody className={cn('divide-y dark:divide-white/10', className)}>
    {children}
  </tbody>
);

export const TableRow: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <tr className={cn('hover:bg-muted/30 dark:hover:bg-white/5 transition-colors', className)}>
    {children}
  </tr>
);

export const InternalTableCell: React.FC<{
  children?: React.ReactNode;
  className?: string;
  isHeader?: boolean;
  align?: 'left' | 'center' | 'right';
}> = ({ children, className, isHeader, align = 'left' }) => {
  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  }[align];

  if (isHeader) {
    return (
      <th className={cn('px-4 py-3 font-medium text-muted-foreground dark:text-stone-300 text-xs tracking-wider', alignClass, className)}>
        {children}
      </th>
    );
  }

  return (
    <td className={cn('px-4 py-3 align-top', alignClass, className)}>
      {children}
    </td>
  );
};
export const TableCell = React.memo(InternalTableCell);

/**
 * Link Component
 */
export const Link: React.FC<{
  href?: string;
  children?: React.ReactNode;
  className?: string;
}> = ({ href, children, className }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={cn(
      'text-primary font-medium',
      'hover:text-primary/80 hover:underline',
      'transition-colors duration-200',
      'break-words',
      className
    )}
  >
    {children}
  </a>
);

/**
 * Strong/Bold Component
 */
export const Strong: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <strong className={cn('font-bold text-foreground', className)}>
    {children}
  </strong>
);

/**
 * Emphasis/Italic Component
 */
export const Emphasis: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <em className={cn('italic', className)}>
    {children}
  </em>
);

/**
 * Horizontal Rule Component
 */
export const HorizontalRule: React.FC<{
  className?: string;
}> = ({ className }) => (
  <hr
    className={cn(
      'block w-full mx-auto my-6 border-0 border-t-2 border-border/80 dark:border-border',
      className
    )}
  />
);

/**
 * Break Component
 * Renders as actual <br> element instead of div for proper line breaking
 * Especially important in table cells where semantic HTML is required
 */
export const Break: React.FC<{
  className?: string;
}> = ({ className }) => (
  <br className={className} />
);

/**
 * Math Components (KaTeX)
 */
export const MathInline: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <span className={cn('inline-block align-baseline mx-1 my-0.5 overflow-x-auto max-w-full px-1.5 py-0.5 bg-muted/30 rounded-md border border-border/20 selection:bg-primary/30', className)}>
    {children}
  </span>
);

export const MathBlock: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('w-full overflow-x-auto my-8 p-6 bg-muted/10 dark:bg-muted/5 border border-border/40 rounded-2xl flex justify-center scrollbar-thin hover:border-border/60 transition-colors', className)}>
    <div className="max-w-full overflow-hidden">
      {children}
    </div>
  </div>
);
