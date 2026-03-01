"use client";

import type { ComponentProps, ReactNode } from "react";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from '@/lib/utils';
import { IconChevronDown, IconChevronRight, IconDots, IconSearch, IconCode, IconBulb, IconBulbFilled } from "@tabler/icons-react";
import { createContext, memo, useContext, useMemo } from "react";
import { CodeBlock } from "./markdown-components";

interface ChainOfThoughtContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null
);

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used within ChainOfThought"
    );
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });

    const chainOfThoughtContext = useMemo(
      () => ({ isOpen, setIsOpen }),
      [isOpen, setIsOpen]
    );

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        <div className={cn("not-prose w-full space-y-4", className)} {...props}>
          {children}
        </div>
      </ChainOfThoughtContext.Provider>
    );
  }
);

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  label?: ReactNode;
};

export const ChainOfThoughtHeader = memo(
  ({ className, children, label, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen, setIsOpen } = useChainOfThought();

    return (
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-1.5 text-neutral-950 dark:text-stone-500 text-[12px] transition-colors hover:text-neutral-700 dark:hover:text-stone-400 group",
            className
          )}
          {...props}
        >
          <div className="relative flex items-center h-4">
            {isOpen ? (
              <IconBulbFilled className="size-3.5 text-neutral-950 dark:text-stone-500 transition-colors" />
            ) : (
              <IconBulb className="size-3.5 text-neutral-950 dark:text-stone-500 transition-colors" />
            )}
            {isOpen && <div className="absolute top-5 bottom-[-16px] left-[6px] w-px bg-border transition-colors rounded-sm" />}
          </div>
          <span className="font-medium text-[12px]">
            {children ?? label ?? "Thought process"}
          </span>
          {isOpen ? (
            <IconChevronDown className="size-3.5 opacity-50 group-hover:opacity-100 transition-transform" />
          ) : (
            <IconChevronRight className="size-3.5 opacity-50 group-hover:opacity-100 transition-transform" />
          )}
        </CollapsibleTrigger>
      </Collapsible>
    );
  }
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: React.ComponentType<any>;
  label: ReactNode;
  description?: ReactNode;
  content?: string;
  code?: string;
  stdout?: string;
  status?: "complete" | "active" | "pending";
  stepType?: "thinking" | "search" | "code" | "think" | "searching" | "default";
  isLast?: boolean;
};

const stepStatusStyles = {
  active: "text-neutral-950 dark:text-stone-400 font-geist text-[12px]",
  complete: "text-neutral-950 dark:text-stone-500 font-geist text-[12px]",
  pending: "text-neutral-950/50 dark:text-stone-500/50 font-geist text-[12px]",
};

const getStepIcon = (stepType?: ChainOfThoughtStepProps['stepType']) => {
  switch (stepType) {
    case 'searching':
      return IconSearch;
    case 'code':
      return IconCode;
    case 'thinking':
    case 'think':
      return IconDots;
    default:
      return IconDots;
  }
};

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon,
    label,
    description,
    content,
    code,
    stdout,
    status = "complete",
    stepType,
    isLast = false,
    children,
    ...props
  }: ChainOfThoughtStepProps) => {
    const DefaultIcon = Icon || getStepIcon(stepType);

    return (
      <div
        className={cn(
          "flex gap-3 text-[12px]",
          stepStatusStyles[status],
          "fade-in-0 slide-in-from-top-1 animate-in duration-300",
          className
        )}
        {...props}
      >
        <div className="relative mt-[2px] flex flex-col items-center w-[14px]">
          <div className={cn(
            "flex items-center justify-center rounded-full",
            status === 'active' && "text-primary"
          )}>
            <DefaultIcon className="size-3.5 opacity-60" />
          </div>
          {!isLast && (
            <div className="flex-1 w-px bg-border transition-colors mt-1.5 mb-[-6px]" />
          )}
        </div>
        <div className="flex-1 min-w-0 pb-4">
          <div className="font-medium leading-tight text-[12px]">{label}</div>
          {description && (
            <div className="text-muted-foreground/80 text-[12px] mt-1 leading-relaxed">{description}</div>
          )}
          {(content || code || stdout || children) && (
            <div className="mt-3 space-y-3">
              {content && (
                <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {content}
                </div>
              )}
              {code && <CodeBlock code={code} language="python" />}
              {stdout && <CodeBlock code={stdout} language="plain" />}
              {children}
            </div>
          )}
        </div>
      </div>
    );
  }
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
);

export const ChainOfThoughtSearchingQueries = memo(
  ({ queries, className, ...props }: { queries: string[], className?: string }) => (
    <div className={cn("flex flex-wrap gap-2 mt-2", className)} {...props}>
      {queries.map((q, i) => (
        <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 dark:bg-stone-800/80 border border-border/60 dark:border-stone-700/70 text-[11px] text-muted-foreground/80 dark:text-stone-400">
          <IconSearch className="size-3 opacity-60" />
          {q}
        </div>
      ))}
    </div>
  )
);

export const ChainOfThoughtSourceTable = memo(
  ({ sources, className, ...props }: { sources: any[], className?: string }) => (
    <div className={cn("mt-3 rounded-xl border border-border/30 bg-muted/5 overflow-hidden max-h-[220px] overflow-y-auto custom-scrollbar shadow-inner pb-1", className)} {...props}>
      <div className="pt-1">
        {sources.map((source, index) => {
          let domain = "";
          try {
            domain = new URL(source.url).hostname.replace('www.', '');
          } catch (e) {
            domain = "source";
          }

          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center justify-between mx-2 px-3 py-2 transition-all text-sm hover:bg-muted/50 dark:hover:bg-muted/40 cursor-pointer rounded-lg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0">
                  <img
                    src={source.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                    alt=""
                    className="size-4.5 rounded object-contain transition-none"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/favicon-fallback.png"
                    }}
                  />
                </div>
                <span className="truncate text-foreground/80 font-mono tracking-tight">{source.title}</span>
              </div>
              <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0 ml-4">{domain}</span>

              {index !== sources.length - 1 && (
                <div className="absolute bottom-0 left-5 right-5 h-[1px] bg-border/40" />
              )}
            </a>
          );
        })}
      </div>
    </div>
  )
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn("gap-1 px-2 py-0.5 font-normal text-xs dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700", className)}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  )
);

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => {
    const { isOpen } = useChainOfThought();

    return (
      <Collapsible open={isOpen}>
        <CollapsibleContent
          className={cn(
            "mt-2 space-y-3",
            "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
            className
          )}
          {...props}
        >
          {children}
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
  caption?: string;
};

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn("mt-2 space-y-2", className)} {...props}>
      <div className="relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
        {children}
      </div>
      {caption && <p className="text-muted-foreground text-xs">{caption}</p>}
    </div>
  )
);

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults";
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
ChainOfThoughtImage.displayName = "ChainOfThoughtImage";
