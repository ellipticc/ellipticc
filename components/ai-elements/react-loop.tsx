"use client";

/**
 * ReActLoop — unified Reasoning + ChainOfThought component.
 *
 * Renders a single collapsible "Thought for Xs" / "Thinking…" disclosure that
 * contains both inline reasoning text (from <thinking> tags) and/or ReAct loop
 * steps (search, code, etc.) under one header.
 *
 * Replaces the separate `Reasoning` + `ChainOfThought` pair.
 */

import { cn } from "@/lib/utils";
import {
  IconBulb,
  IconBulbFilled,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconSearch,
  IconCode,
} from "@tabler/icons-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MarkdownRenderer } from "./markdown-renderer";
import { Shimmer } from "./shimmer";
import { CodeBlock } from "./markdown-components";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReActStep {
  id?: string;
  /** 'think' = inline reasoning block; all other values = tool step */
  type?: string;
  stepType?: "thinking" | "search" | "code" | "think" | "searching" | "default";
  label?: ReactNode;
  description?: ReactNode;
  content?: string;
  code?: string;
  stdout?: string;
  status?: "complete" | "active" | "pending";
  queries?: string[];
  results?: any[];
  error?: string;
  images?: string[];
}

export interface ReActLoopProps {
  /** Inline reasoning/thinking text extracted from <thinking>/<think> tags */
  reasoning?: string;
  /** ReAct agent steps (search, code, etc.) */
  steps?: ReActStep[];
  /** Whether the model is still generating */
  isStreaming?: boolean;
  /** Total thinking duration in seconds (available once streaming ends) */
  duration?: number;
  thinkingType?: "thinking" | "think";
  className?: string;
  /** Controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_CLOSE_DELAY_MS = 200;
const MS_IN_S = 1000;

// ---------------------------------------------------------------------------
// Step icon helper
// ---------------------------------------------------------------------------

function getStepIcon(stepType?: ReActStep["stepType"]) {
  switch (stepType) {
    case "searching":
      return IconSearch;
    case "code":
      return IconCode;
    default:
      return IconDots;
  }
}

const stepStatusStyles: Record<string, string> = {
  active: "text-neutral-950 dark:text-stone-400 font-geist text-[12px]",
  complete: "text-neutral-950 dark:text-stone-500 font-geist text-[12px]",
  pending: "text-neutral-950/50 dark:text-stone-500/50 font-geist text-[12px]",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export const ReActSearchingQueries = memo(
  ({ queries, className }: { queries: string[]; className?: string }) => (
    <div className={cn("flex flex-wrap gap-2 mt-2", className)}>
      {queries.map((q, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/70 dark:bg-white/[0.08] border border-border/70 dark:border-white/15 text-[11px] text-muted-foreground dark:text-stone-300"
        >
          <IconSearch className="size-3 opacity-60" />
          {q}
        </div>
      ))}
    </div>
  )
);
ReActSearchingQueries.displayName = "ReActSearchingQueries";

export const ReActSourceTable = memo(
  ({ sources, className }: { sources: any[]; className?: string }) => (
    <div
      className={cn(
        "mt-3 rounded-xl border border-border/40 dark:border-white/10 bg-muted/20 dark:bg-white/5 overflow-hidden max-h-[220px] overflow-y-auto custom-scrollbar shadow-sm pb-1",
        className
      )}
    >
      <div className="pt-1">
        {sources.map((source, index) => {
          let domain = "";
          try {
            domain = new URL(source.url).hostname.replace("www.", "");
          } catch {
            domain = "source";
          }
          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center justify-between mx-2 px-3 py-2 transition-all text-sm hover:bg-muted/60 dark:hover:bg-white/10 cursor-pointer rounded-lg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0">
                  <img
                    src={
                      source.favicon ||
                      `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                    }
                    alt=""
                    className="size-4.5 rounded object-contain transition-none"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "/favicon-fallback.png";
                    }}
                  />
                </div>
                <span className="truncate text-foreground/80 font-mono tracking-tight">
                  {source.title}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0 ml-4">
                {domain}
              </span>
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
ReActSourceTable.displayName = "ReActSourceTable";

const ReActStepItem = memo(
  ({ step, isLast }: { step: ReActStep; isLast: boolean }) => {
    const Icon = getStepIcon(step.stepType);
    const statusStyle = stepStatusStyles[step.status || "complete"];

    return (
      <div
        className={cn(
          "flex gap-3 text-[12px] fade-in-0 slide-in-from-top-1 animate-in duration-300",
          statusStyle
        )}
      >
        <div className="relative mt-[2px] flex flex-col items-center w-[14px]">
          <div
            className={cn(
              "flex items-center justify-center rounded-full",
              step.status === "active" && "text-primary"
            )}
          >
            <Icon className="size-3.5 opacity-60" />
          </div>
          {!isLast && (
            <div className="flex-1 w-px bg-border transition-colors mt-1.5 mb-[-6px]" />
          )}
        </div>
        <div className="flex-1 min-w-0 pb-4">
          <div className="font-medium leading-tight text-[12px]">
            {step.label}
          </div>
          {step.description && (
            <div className="text-muted-foreground/80 text-[12px] mt-1 leading-relaxed">
              {step.description}
            </div>
          )}
          {(step.content ||
            step.code ||
            step.stdout ||
            step.queries ||
            step.results ||
            step.error ||
            step.images?.length) && (
            <div className="mt-3 space-y-3">
              {step.content && (
                <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {step.content}
                </div>
              )}
              {step.code && (
                <CodeBlock code={step.code} language="python" />
              )}
              {step.stdout && (
                <CodeBlock code={step.stdout} language="plain" />
              )}
              {step.stepType === "searching" && step.queries && (
                <ReActSearchingQueries queries={step.queries} />
              )}
              {step.stepType === "search" && step.results && (
                <ReActSourceTable sources={step.results} />
              )}
              {step.error && (
                <pre className="text-[11px] font-mono bg-destructive/10 text-destructive p-2 rounded-md overflow-x-auto max-w-full">
                  {step.error}
                </pre>
              )}
              {step.images && step.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {step.images.map((img, iIdx) => (
                    <div key={iIdx} className="mt-2 space-y-2">
                      <div className="relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
                        <img
                          src={`data:image/png;base64,${img}`}
                          alt={`Plot ${iIdx + 1}`}
                          className="max-w-full h-auto"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);
ReActStepItem.displayName = "ReActStepItem";

// ---------------------------------------------------------------------------
// ReActLoop — main component
// ---------------------------------------------------------------------------

export const ReActLoop = memo(
  ({
    reasoning,
    steps,
    isStreaming = false,
    duration: durationProp,
    thinkingType,
    className,
    open,
    onOpenChange,
  }: ReActLoopProps) => {
    // Only show if there's actual content (non-empty reasoning or non-empty steps)
    // Filter out empty think steps before checking
    const hasThinkSteps = steps && steps.some(s => s.type === 'think' && s.content && s.content.trim().length > 0);
    const hasNonThinkSteps = steps && steps.some(s => s.type !== 'think');
    const hasReasoning = reasoning && reasoning.trim().length > 0;
    const hasContent = !!(hasReasoning || hasThinkSteps || hasNonThinkSteps);
    if (!hasContent && !isStreaming) return null;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: isStreaming,
      onChange: onOpenChange,
      prop: open,
    });

    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(null);

    // Compute duration while streaming
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    // Auto-open when streaming starts
    useEffect(() => {
      if (isStreaming && !isOpen) setIsOpen(true);
    }, [isStreaming, isOpen, setIsOpen]);

    // Auto-close after streaming ends (once only)
    useEffect(() => {
      if (
        hasEverStreamedRef.current &&
        !isStreaming &&
        isOpen &&
        !hasAutoClosed
      ) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY_MS);
        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => setIsOpen(newOpen),
      [setIsOpen]
    );

    // Trigger label
    const triggerLabel: React.ReactNode = isStreaming ? (
      <Shimmer duration={1}>Thinking...</Shimmer>
    ) : duration !== undefined && duration > 0 ? (
      <p>Thought for {duration}s</p>
    ) : steps && steps.length > 0 ? (
      <p>Thought process</p>
    ) : null;

    if (!triggerLabel && !isStreaming) return null;

    return (
      <Collapsible
        className={cn("not-prose mb-2", className)}
        open={isOpen}
        onOpenChange={handleOpenChange}
      >
        {/* ── Trigger ── */}
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-neutral-950 dark:text-stone-500 text-[12px] transition-colors hover:text-neutral-700 dark:hover:text-stone-400">
          <div className="flex gap-1.5 items-center w-fit">
            <div className="relative flex items-center h-4">
              {isOpen ? (
                <IconBulbFilled className="size-3.5 text-neutral-950 dark:text-stone-500 transition-colors" />
              ) : (
                <IconBulb className="size-3.5 text-neutral-950 dark:text-stone-500 transition-colors" />
              )}
              {isOpen && (
                <div className="absolute top-5 bottom-[-16px] left-[6px] w-px bg-border transition-colors rounded-sm" />
              )}
            </div>
            <div className="flex-1">{triggerLabel}</div>
            <div className="ml-1 flex items-center">
              {isOpen ? (
                <IconChevronDown className="size-3.5 transition-transform duration-200" />
              ) : (
                <IconChevronRight className="size-3.5 transition-transform duration-200" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        {/* ── Content ── */}
        <CollapsibleContent
          className={cn(
            "mt-2 text-sm",
            "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in"
          )}
        >
          {(() => {
            // Check if steps contain interleaved 'think' type entries (live streaming path)
            const hasThinkSteps = steps && steps.some(s => s.type === 'think');

            if (hasThinkSteps) {
              // TRUE REACT LOOP: render unified chronological steps
              return (
                <div className="space-y-0">
                  {steps!.map((step, idx) => {
                    if (step.type === 'think') {
                      // Inline reasoning block
                      return (
                        <div
                          key={`think-${idx}`}
                          className="relative pl-[26px] text-neutral-950 dark:text-stone-500 [&_*]:text-neutral-950 [&_*]:dark:text-stone-500 font-geist text-[12px] leading-relaxed pb-3"
                        >
                          <div className="absolute left-[6px] top-0 bottom-0 w-px bg-border transition-colors rounded-sm" />
                          <MarkdownRenderer
                            content={step.content || ''}
                            isStreaming={isStreaming && idx === steps!.length - 1}
                            compact={true}
                          />
                        </div>
                      );
                    }
                    // Tool step
                    const toolSteps = steps!.filter(s => s.type !== 'think');
                    const toolIdx = toolSteps.indexOf(step);
                    const isLastTool = toolIdx === toolSteps.length - 1 && idx === steps!.length - 1;
                    return (
                      <ReActStepItem
                        key={step.id || `tool-${idx}`}
                        step={step}
                        isLast={isLastTool}
                      />
                    );
                  })}
                </div>
              );
            }

            // BACKWARD COMPAT: flat reasoning string + separate tool steps
            return (
              <>
                {reasoning && (
                  <div className="relative pl-[26px] text-neutral-950 dark:text-stone-500 [&_*]:text-neutral-950 [&_*]:dark:text-stone-500 font-geist text-[12px] leading-relaxed mb-3">
                    <div className="absolute left-[6px] top-0 bottom-[-4px] w-px bg-border transition-colors rounded-sm" />
                    <MarkdownRenderer
                      content={reasoning}
                      isStreaming={isStreaming}
                      compact={true}
                    />
                  </div>
                )}
                {steps && steps.length > 0 && (
                  <div className="space-y-0">
                    {steps.map((step, idx) => (
                      <ReActStepItem
                        key={step.id || idx}
                        step={step}
                        isLast={idx === steps!.length - 1}
                      />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

ReActLoop.displayName = "ReActLoop";
