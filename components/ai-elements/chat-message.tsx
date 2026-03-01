"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { IconCopy, IconEdit, IconRefresh, IconThumbDown, IconFileText, IconThumbUp, IconCheck, IconChevronRight, IconDownload, IconChevronLeft, IconListDetails, IconArrowRight, IconHandStop, IconBulb, IconInfoCircle, IconWorld, IconWorldOff, IconViewportShort, IconThumbUpFilled, IconThumbDownFilled, IconArrowUp } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ReActLoop } from "@/components/ai-elements/react-loop"
import { MarkdownRenderer } from "@/components/ai-elements/markdown-renderer"
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion"

export interface ToolCall {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
    result?: string;
}

export interface MessageVersion {
    id: string;
    content: string;
    toolCalls?: ToolCall[];
    createdAt?: number;
    feedback?: 'like' | 'dislike';
    total_time?: number | string;
    ttft?: number | string;
    tps?: number | string;
    model?: string;
    suggestions?: string[];
    sources?: { title: string; url: string; content?: string }[];
    reasoning?: string;
    reasoningDuration?: number;
    steps?: any[];
}

export interface Message {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    isThinking?: boolean;
    createdAt?: number | string;
    feedback?: 'like' | 'dislike';
    sources?: { title: string; url: string; content?: string }[];
    toolCalls?: ToolCall[];
    versions?: MessageVersion[];
    currentVersionIndex?: number;
    isCheckpoint?: boolean;
    checkpointId?: string;
    reasoning?: string; // Content inside <think> tags
    reasoningDuration?: number; // Duration of thinking in seconds
    suggestions?: string[];
    ttft?: number | string;
    tps?: number | string;
    total_time?: number | string;
    model?: string;
    parent_id?: string | null;
    steps?: any[];
}

interface ChatMessageProps {
    message: Message;
    isLast: boolean;
    onCopy: (content: string) => void;
    onRetry?: () => void;
    onEdit?: (content: string) => void;
    onFeedback?: (messageId: string, feedback: 'like' | 'dislike') => void;
    onRegenerate?: (instruction?: string, overrides?: { thinkingMode?: boolean }) => void;
    onVersionChange?: (direction: 'prev' | 'next') => void;
    onCheckpoint?: (messageId: string) => void;
    availableModels?: { id: string; name: string }[];
    onRerunSystemWithModel?: (messageId: string, modelId: string) => void;
    onAddToChat?: (text: string) => void;
    onSuggestionClick?: (text: string) => void;
}

interface ParsedUserMessage {
    text: string;
    files: { name: string, content: string }[];
    contexts: { type: string, content: string }[];
}

function parseUserContent(rawContent: string): ParsedUserMessage {
    let text = rawContent;
    const files: { name: string, content: string }[] = [];
    const contexts: { type: string, content: string }[] = [];

    // Parse files (non-greedy match)
    const fileRegex = /--- START FILE: ([\s\S]*?) ---\n([\s\S]*?)\n--- END FILE ---\n?/g;
    text = text.replace(fileRegex, (match, name, content) => {
        files.push({ name: name.trim(), content: content.trim() });
        return '';
    });

    // Parse contexts (non-greedy match)
    const contextRegex = /\[CONTEXT \(([\s\S]*?)\)\]\n([\s\S]*?)\n\[\/CONTEXT\]\n?/g;
    text = text.replace(contextRegex, (match, type, content) => {
        contexts.push({ type: type.trim(), content: content.trim() });
        return '';
    });

    return {
        text: text.trim(),
        files,
        contexts
    };
}

export function ChatMessage({ message, isLast, onCopy, onEdit, onFeedback, onRegenerate, onVersionChange, onCheckpoint, availableModels = [], onRerunSystemWithModel, onAddToChat, onSuggestionClick }: ChatMessageProps) {
    // Helper to display pretty model names
    const formatModelName = (name?: string) => {
        if (!name) return '';
        return name.split('-').map(seg => {
            let seenLetter = false;
            return seg.split('').map(ch => {
                if (/[a-zA-Z]/.test(ch)) {
                    if (!seenLetter) {
                        seenLetter = true;
                        return ch.toUpperCase();
                    }
                    return ch.toLowerCase();
                }
                return ch;
            }).join('');
        }).join('-');
    };
    // ... existing state ...
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const isSystem = message.role === 'system';
    const [copied, setCopied] = React.useState(false);
    const [feedbackGiven, setFeedbackGiven] = React.useState(!!message.feedback);
    const [isEditingPrompt, setIsEditingPrompt] = React.useState(false);
    const [editContent, setEditContent] = React.useState(message.content);
    const [regenInput, setRegenInput] = React.useState("");
    const [isRegenOpen, setIsRegenOpen] = React.useState(false);
    const [systemModelPopoverOpen, setSystemModelPopoverOpen] = React.useState(false);

    const usedThinking = !!(message.reasoning || message.isThinking || message.reasoningDuration);

    // ... existing handlers ...
    const handleRegenerateOption = (type: string) => {
        setIsRegenOpen(false);
        setRegenInput("");
        switch (type) {
            case 'retry':
                onRegenerate?.();
                break;
            case 'custom':
                if (regenInput.trim()) {
                    onRegenerate?.(`Please rewrite the previous answer applying these changes: ${regenInput.trim()}`);
                }
                break;
            case 'details':
                onRegenerate?.("Provide a more detailed and expanded version of the previous answer.");
                break;
            case 'concise':
                onRegenerate?.("Provide a shorter, more concise version of the previous answer.");
                break;
            case 'think':
                onRegenerate?.(undefined, { thinkingMode: true });
                break;
        }
    };

    const handleCopy = () => {
        onCopy(message.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const ts = message.createdAt ? new Date(message.createdAt) : new Date();
        const exportedAt = new Date();
        const header = [
            `# Message export`,
            `This message was downloaded from Ellipticc (https://ellipticc.com). AI chats may display inaccurate or offensive information (see https://ellipticc.com/privacy-policy for more info).`,
            `Message ID: ${message.id || 'N/A'}`,
            `Exported: ${exportedAt.toLocaleString()}`,
            `Message timestamp: ${ts.toLocaleString()}`,
            '---',
            ''
        ].join('\n');

        let body = `${header}\n# ${message.role === 'user' ? 'User Question' : 'AI Assistant Response'}\n\n`;

        // Include reasoning/thinking if available
        if (displayRes.reasoning) {
            body += `<details>\n<summary>Thought process${displayRes.reasoningDuration ? ` (${displayRes.reasoningDuration}s)` : ''}</summary>\n\n${displayRes.reasoning}\n</details>\n\n`;
        }

        // Include Chain of Thought steps if available
        if (displayRes.steps && displayRes.steps.length > 0) {
            body += `<details>\n<summary>Chain of Thought (${displayRes.steps.length} step${displayRes.steps.length > 1 ? 's' : ''})</summary>\n\n`;
            displayRes.steps.forEach((step: any, idx: number) => {
                body += `### Step ${idx + 1}: ${step.label || step.stepType || 'Processing'}\n\n`;
                if (step.content) body += `${step.content}\n\n`;
                if (step.code) body += `\`\`\`python\n${step.code}\n\`\`\`\n\n`;
                if (step.stdout) body += `**Output:**\n\`\`\`\n${step.stdout}\n\`\`\`\n\n`;
                if (step.error) body += `**Error:**\n\`\`\`\n${step.error}\n\`\`\`\n\n`;
                if (step.results && step.results.length > 0) {
                    body += `**Search Results:**\n`;
                    step.results.forEach((r: any) => {
                        body += `- [${r.title}](${r.url})\n`;
                    });
                    body += `\n`;
                }
            });
            body += `</details>\n\n`;
        }

        // Main message content
        body += `${message.content}\n`;

        // ADD FOOTNOTES
        if (displayRes.sources && displayRes.sources.length > 0) {
            body += `\n<div align="center">⁂</div>\n\n`;
            displayRes.sources.forEach((source, idx) => {
                body += `[^${idx + 1}]: ${source.url}\n`;
            });
        }

        const blob = new Blob([body], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeDate = ts.toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `message-${message.id || Date.now()}-${safeDate}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleFeedback = (feedback: 'like' | 'dislike') => {
        setFeedbackGiven(true);
        onFeedback?.(message.id || '', feedback);
    };

    const handleEditPromptSubmit = () => {
        const trimmedEdit = editContent.trim();
        const trimmedMsg = message.content.trim();

        if (!trimmedEdit || trimmedEdit === trimmedMsg) {
            setEditContent(message.content); // Reset just in case spaces were removed
            setIsEditingPrompt(false);
            return;
        }

        onEdit?.(trimmedEdit);
        setIsEditingPrompt(false);
    };

    const versionCount = message.versions?.length || 1;
    const currentVersionIndex = message.currentVersionIndex || 0;
    const currentVersion = currentVersionIndex + 1;

    // Use metadata from current version if available, otherwise fallback to base message
    const displayRes = React.useMemo(() => {
        const v = message.versions?.[currentVersionIndex];
        if (!v) return message;
        return {
            ...message,
            content: v.content,
            toolCalls: v.toolCalls || message.toolCalls,
            feedback: v.feedback || message.feedback,
            createdAt: v.createdAt || message.createdAt,
            total_time: v.total_time !== undefined ? v.total_time : message.total_time,
            ttft: v.ttft !== undefined ? v.ttft : message.ttft,
            tps: v.tps !== undefined ? v.tps : message.tps,
            model: v.model || message.model,
            suggestions: v.suggestions || message.suggestions,
            sources: v.sources || message.sources,
            reasoning: v.reasoning || message.reasoning,
            reasoningDuration: v.reasoningDuration !== undefined ? v.reasoningDuration : message.reasoningDuration,
            steps: v.steps || message.steps
        };
    }, [message, currentVersionIndex]);

    const displayContent = displayRes.content;
    const feedbackValue = displayRes.feedback;
    const isInterrupted = displayContent && /Stopped by user/i.test(displayContent);

    return (
        <div
            id={message.id}
            className={cn(
                "flex w-full gap-3 group scroll-mt-24 justify-center" // optimized scroll margin for sticky header
            )}>

            {/* Message Content */}
            <div className={cn(
                "flex flex-col min-w-0 transition-all duration-200 w-full max-w-[58rem]",
                isUser
                    ? (isEditingPrompt ? "items-start !max-w-[none]" : "items-end ml-auto")
                    : "items-start"
            )}>
                {isUser ? (
                    // ... User Message Render ...
                    <>
                        {/* Edit Mode Overlay */}
                        <div className={cn("group relative flex flex-col items-end", isEditingPrompt && "w-full")}>
                            {isEditingPrompt ? (
                                <div className="w-full space-y-2">
                                    <div className="bg-muted rounded-2xl p-4">
                                        <Textarea
                                            value={editContent}
                                            onChange={(e) => setEditContent(e.target.value)}
                                            className="bg-background border resize-none text-[15px] leading-relaxed w-full"
                                            placeholder="Edit your message..."
                                            rows={Math.max(3, Math.min(10, (editContent.match(/\n/g) || []).length + 2))}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleEditPromptSubmit();
                                                }
                                                if (e.key === 'Escape') {
                                                    setIsEditingPrompt(false);
                                                }
                                            }}
                                            autoFocus
                                        />
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                                            <IconInfoCircle className="size-3.5 text-muted-foreground/70" />
                                            <span>Editing will start a new branch. Navigation is possible via arrows.</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setIsEditingPrompt(false)}
                                                className="h-8 px-3 text-xs"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={handleEditPromptSubmit}
                                                disabled={!editContent.trim() || editContent.trim() === (message.content ?? '').trim()}
                                                className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary/90"
                                            >
                                                Send
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Parse content for file and context pills */}
                                    {(() => {
                                        const parsed = parseUserContent(message.content);
                                        return (
                                            <div className="flex flex-col gap-2 w-full items-end pl-6 sm:pl-10">
                                                {/* Message bubble */}
                                                {parsed.text && (
                                                    <div className="relative group/user-msg w-fit max-w-full">
                                                        <div className={cn(
                                                            "px-4 py-3 rounded-2xl text-[14px] leading-relaxed shadow-sm font-medium w-fit selection:bg-[var(--user-message-selection)] selection:text-inherit break-words whitespace-pre-wrap transition-colors duration-200",
                                                            "bg-[var(--user-message-bg)] text-foreground/90 dark:text-white/90"
                                                        )}>
                                                            {parsed.text}
                                                        </div>

                                                        {/* User Version navigation - moved to bottom */}
                                                        {false && versionCount > 1 && (
                                                            // Logic moved to bottom action row
                                                            null
                                                        )}

                                                    </div>
                                                )}

                                                {/* File & Context Pills Area */}
                                                {(parsed.files.length > 0 || parsed.contexts.length > 0) && (
                                                    <div className="flex flex-wrap gap-2 justify-end mt-1.5">
                                                        {parsed.contexts.map((ctx, i) => (
                                                            <Sheet key={`ctx-${i}`} modal={false}>
                                                                <TooltipProvider delayDuration={300}>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <SheetTrigger asChild>
                                                                                <button className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border border-border/50 rounded-xl text-xs font-medium cursor-pointer hover:bg-muted/90 transition-colors shadow-sm select-none data-[state=open]:bg-muted/90 data-[state=open]:border-border/80 text-left">
                                                                                    <IconFileText className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                                                                                    <span className="truncate max-w-[150px] text-foreground/80">Context Reference</span>
                                                                                </button>
                                                                            </SheetTrigger>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="bottom" className="max-w-[300px] break-words">
                                                                            <p>Context Snippet</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>

                                                                <SheetContent side="right" className="w-[320px] sm:w-[400px] px-0 pb-0 flex flex-col" hideOverlay>
                                                                    <SheetHeader className="px-6 py-4 text-left space-y-1.5 shrink-0">
                                                                        <SheetTitle className="flex items-center gap-3 pr-8">
                                                                            <IconFileText className="w-5 h-5 text-primary/80 shrink-0" />
                                                                            <TooltipProvider delayDuration={300}>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger asChild>
                                                                                        <span className="truncate text-base">Context Snippet</span>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent side="bottom">
                                                                                        <p>Context Snippet</p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        </SheetTitle>
                                                                    </SheetHeader>
                                                                    <ScrollArea className="flex-1 w-full min-h-0">
                                                                        <div className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed bg-muted/30 p-4 m-6 rounded-xl border border-border/50">
                                                                            {ctx.content}
                                                                        </div>
                                                                    </ScrollArea>
                                                                </SheetContent>
                                                            </Sheet>
                                                        ))}
                                                        {parsed.files.map((file, i) => (
                                                            <Sheet key={`file-${i}`} modal={false}>
                                                                <TooltipProvider delayDuration={300}>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <SheetTrigger asChild>
                                                                                <button className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border border-border/50 rounded-xl text-xs font-medium cursor-pointer hover:bg-muted/90 transition-colors shadow-sm select-none data-[state=open]:bg-muted/90 data-[state=open]:border-border/80">
                                                                                    <IconFileText className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                                                                                    <span className="truncate max-w-[200px] text-foreground/80">{file.name}</span>
                                                                                </button>
                                                                            </SheetTrigger>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="bottom" className="max-w-[300px] break-words">
                                                                            <p>{file.name}</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>

                                                                <SheetContent side="right" className="w-[320px] sm:w-[400px] px-0 pb-0 flex flex-col" hideOverlay>
                                                                    <SheetHeader className="px-6 py-4 text-left space-y-1.5 shrink-0">
                                                                        <SheetTitle className="flex items-center gap-3 pr-8">
                                                                            <IconFileText className="w-5 h-5 text-primary/80 shrink-0" />
                                                                            <TooltipProvider delayDuration={300}>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger asChild>
                                                                                        <span className="truncate text-base">{file.name}</span>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent side="bottom" className="max-w-[300px] break-words">
                                                                                        <p>{file.name}</p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        </SheetTitle>
                                                                    </SheetHeader>
                                                                    <ScrollArea className="flex-1 w-full min-h-0">
                                                                        <div className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed bg-muted/30 p-4 m-6 rounded-xl border border-border/50">
                                                                            {file.content}
                                                                        </div>
                                                                    </ScrollArea>
                                                                </SheetContent>
                                                            </Sheet>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Actions Row - Below message */}
                                    <div className={cn(
                                        "flex items-center w-full mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none",
                                        isUser ? "justify-end" : "justify-between"
                                    )}>
                                        <div className={cn("flex items-center gap-3", isUser && "flex-row-reverse")}>
                                            {/* Timestamp - Explicitly to the left of buttons */}
                                            {message.createdAt && (
                                                <span className="text-[10px] text-muted-foreground/60 select-none">
                                                    {new Date(message.createdAt).toLocaleString(undefined, {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: 'numeric',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            )}

                                            <div className="flex items-center gap-1">
                                                {onEdit && (
                                                    <ActionButton
                                                        icon={IconEdit}
                                                        label="Edit"
                                                        onClick={() => {
                                                            setEditContent(parseUserContent(message.content).text);
                                                            setIsEditingPrompt(true);
                                                        }}
                                                    />
                                                )}
                                                <ActionButton
                                                    icon={copied ? IconCheck : IconCopy}
                                                    label="Copy"
                                                    onClick={handleCopy}
                                                />
                                                {message.content && /Stopped by user/i.test(message.content) && (
                                                    <ActionButton
                                                        icon={IconArrowRight}
                                                        label="Continue"
                                                        onClick={() => onRegenerate?.('continue')}
                                                        delayDuration={700}
                                                    />
                                                )}

                                                {/* User Version navigation - Repositioned to the right of Copy */}
                                                {versionCount > 1 && (
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground rounded-md px-1 select-none ml-1">
                                                        <TooltipProvider delayDuration={400}>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-5 w-5 hover:bg-sidebar-accent/50 transition-colors"
                                                                        onClick={() => onVersionChange?.('prev')}
                                                                        disabled={currentVersion <= 1}
                                                                    >
                                                                        <IconChevronLeft className="size-3" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent side="bottom"><p className="text-[10px]">Previous version</p></TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>

                                                        <span className="px-1 min-w-[24px] text-center font-mono opacity-60 text-[10px]">
                                                            {currentVersion}/{versionCount}
                                                        </span>

                                                        <TooltipProvider delayDuration={400}>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-5 w-5 hover:bg-sidebar-accent/50 transition-colors"
                                                                        onClick={() => onVersionChange?.('next')}
                                                                        disabled={currentVersion >= versionCount}
                                                                    >
                                                                        <IconChevronRight className="size-3" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent side="bottom"><p className="text-[10px]">Next version</p></TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="w-full space-y-0.5 selection:bg-primary/20 selection:text-foreground">
                        {/* ReAct Loop — unified reasoning text + CoT steps under one collapsible */}
                        {(displayRes.reasoning || (displayRes.steps && displayRes.steps.length > 0) || displayRes.isThinking) && (
                            <ReActLoop
                                key={`react-${displayRes.id}-${displayRes.reasoningDuration ?? 'none'}`}
                                reasoning={displayRes.reasoning}
                                steps={displayRes.steps}
                                isStreaming={!!displayRes.isThinking}
                                duration={displayRes.reasoningDuration}
                            />
                        )}

                        <div className="w-full max-w-full break-words overflow-hidden font-inter text-[14px]">
                            <MarkdownRenderer
                                content={displayRes.content}
                                sources={displayRes.sources}
                                compact={false}
                                isStreaming={!!displayRes.isThinking}
                            />
                        </div>

                        {/* Legacy References Footer Removed */}


                        {/* Actions Footer - rendered only when not thinking/streaming */}
                        {isAssistant && !message.isThinking && (
                            <div className="flex items-center justify-between mt-2 select-none">
                                {/* Left Actions */}
                                <div className="flex items-center gap-0.5">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={cn("h-6 w-6 rounded-md transition-colors", feedbackGiven && feedbackValue === 'like' ? "text-foreground bg-sidebar-accent/40" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/30 dark:hover:bg-sidebar-accent/40")}
                                                onClick={() => handleFeedback('like')}
                                            >
                                                {feedbackGiven && feedbackValue === 'like' ? (
                                                    <IconThumbUpFilled className="size-3.5" />
                                                ) : (
                                                    <IconThumbUp className="size-3.5" />
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            <p>Like</p>
                                        </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={cn("h-6 w-6 rounded-md transition-colors", feedbackGiven && feedbackValue === 'dislike' ? "text-foreground bg-sidebar-accent/40" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/30 dark:hover:bg-sidebar-accent/40")}
                                                onClick={() => handleFeedback('dislike')}
                                            >
                                                {feedbackGiven && feedbackValue === 'dislike' ? (
                                                    <IconThumbDownFilled className="size-3.5" />
                                                ) : (
                                                    <IconThumbDown className="size-3.5" />
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            <p>Dislike</p>
                                        </TooltipContent>
                                    </Tooltip>
                                    {/* Duplicate version navigation removed */}

                                    <ActionButton
                                        icon={copied ? IconCheck : IconCopy}
                                        label="Copy"
                                        onClick={handleCopy}
                                    />

                                    <DropdownMenu open={isRegenOpen} onOpenChange={setIsRegenOpen}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className={cn("h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/20 dark:hover:bg-sidebar-accent/30 rounded-md transition-colors", isRegenOpen && "bg-muted text-foreground")}>
                                                        <IconRefresh className="size-3.5" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom"><p>Regenerate</p></TooltipContent>
                                        </Tooltip>
                                        <DropdownMenuContent align="end" side="top" className="w-[210px] p-2 shadow-xl border border-border/50">
                                            <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                                                <div className="relative flex-1">
                                                    <Input
                                                        value={regenInput}
                                                        onChange={(e) => setRegenInput(e.target.value)}
                                                        placeholder="Change response..."
                                                        className="h-8 text-xs bg-muted/40 border-none focus-visible:ring-1 focus-visible:ring-border/40 rounded-md pr-8"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                if (regenInput.trim()) handleRegenerateOption('custom');
                                                            }
                                                        }}
                                                    />
                                                    <Button
                                                        size="icon"
                                                        className="absolute right-0.5 top-0.5 h-7 w-7 bg-foreground/5 hover:bg-foreground/10 text-foreground dark:bg-muted/40 dark:hover:bg-muted/60 rounded-sm transition-colors"
                                                        disabled={!regenInput.trim()}
                                                        onClick={() => handleRegenerateOption('custom')}
                                                    >
                                                        <IconArrowUp className="size-3.5" />
                                                    </Button>
                                                </div>
                                            </div>

                                            <DropdownMenuSeparator className="mx-0.5 my-1 opacity-50" />

                                            <div className="space-y-1">
                                                <DropdownMenuItem onClick={() => handleRegenerateOption('retry')} className="text-sm cursor-pointer py-1.5 px-2.5 focus:bg-sidebar-accent/50 rounded-md">
                                                    <IconRefresh className="mr-2.5 size-4 opacity-70" /> Retry
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleRegenerateOption('details')} className="text-sm cursor-pointer py-1.5 px-2.5 focus:bg-sidebar-accent/50 rounded-md">
                                                    <IconListDetails className="mr-2.5 size-4 opacity-70" /> Add details
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleRegenerateOption('concise')} className="text-sm cursor-pointer py-1.5 px-2.5 focus:bg-sidebar-accent/50 rounded-md">
                                                    <IconViewportShort className="mr-2.5 size-4 opacity-70" /> More concise
                                                </DropdownMenuItem>

                                                <DropdownMenuSeparator className="mx-0.5 my-1.5 opacity-50" />

                                                <DropdownMenuItem onClick={() => handleRegenerateOption('think')} className="text-sm cursor-pointer py-1.5 px-2.5 focus:bg-sidebar-accent/50 rounded-md">
                                                    <IconBulb className="mr-2.5 size-4 opacity-70" /> Think Longer
                                                </DropdownMenuItem>
                                            </div>
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <ActionButton
                                        icon={IconDownload}
                                        label="Download"
                                        onClick={handleDownload}
                                    />

                                    {/* Timing Metrics Indicator / Interrupted State */}
                                    {isInterrupted ? (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1 px-1.5 py-0.5 rounded-md select-none cursor-default">
                                            <IconHandStop className="size-3.5" />
                                            <span>Interrupted</span>
                                        </div>
                                    ) : null}

                                    {/* display model badge on every assistant response */}
                                    {displayRes.model && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="text-xs text-muted-foreground ml-1 px-1.5 py-0.5 rounded-md hover:bg-sidebar-accent/20 dark:hover:bg-sidebar-accent/30 transition-colors">
                                                    {formatModelName(displayRes.model)}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                <p>Model used: {formatModelName(displayRes.model)}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    )}

                                    {displayRes.total_time !== undefined && Number(displayRes.total_time) > 0 && (() => {
                                        const totalTime = Number(displayRes.total_time);
                                        const ttft = Number(displayRes.ttft);
                                        const tps = Number(displayRes.tps);
                                        const displayValue = ttft > 0 ? ttft : totalTime;
                                        const displayText = displayValue < 1000
                                            ? `${Math.round(displayValue)}ms`
                                            : `${(displayValue / 1000).toFixed(1)}s`;
                                        return (
                                            <div className="flex items-center gap-1">
                                                <HoverCard>
                                                    <HoverCardTrigger className="flex items-center text-xs text-muted-foreground ml-1 px-1.5 py-0.5 rounded-md hover:bg-sidebar-accent/10 dark:hover:bg-sidebar-accent/20 transition-colors cursor-default select-none">
                                                        {displayText}
                                                    </HoverCardTrigger>
                                                    <HoverCardContent side="bottom" align="center" className="flex flex-col gap-1.5 p-3 text-sm min-w-[180px] w-auto">
                                                        <div className="font-medium text-xs text-muted-foreground pb-1 border-b">Timing Metrics</div>
                                                        {ttft > 0 && (
                                                            <div className="flex justify-between gap-4 text-xs">
                                                                <span className="text-muted-foreground">Time to First Token:</span>
                                                                <span className="font-mono">{ttft < 1000 ? `${Math.round(ttft)}ms` : `${(ttft / 1000).toFixed(2)}s`}</span>
                                                            </div>
                                                        )}
                                                        <div className="flex justify-between gap-4 text-xs">
                                                            <span className="text-muted-foreground">Response Time:</span>
                                                            <span className="font-mono">{totalTime < 1000 ? `${Math.round(totalTime)}ms` : `${(totalTime / 1000).toFixed(2)}s`}</span>
                                                        </div>
                                                        {tps > 0 && (
                                                            <div className="flex justify-between gap-4 text-xs">
                                                                <span className="text-muted-foreground">Speed:</span>
                                                                <span className="font-mono">{tps.toFixed(1)} tok/s</span>
                                                            </div>
                                                        )}
                                                    </HoverCardContent>
                                                </HoverCard>

                                                {displayRes.sources && displayRes.sources.length > 0 && (
                                                    <Sheet modal={true}>
                                                        <SheetTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                className="flex items-center gap-2 h-7 px-2 rounded-full bg-muted/20 hover:bg-muted/50 text-muted-foreground transition-all ml-1 group/sources"
                                                            >
                                                                <div className="flex -space-x-1 overflow-hidden">
                                                                    {displayRes.sources.slice(0, 3).map((s, i) => (
                                                                        <div key={i} className="inline-block h-3.5 w-3.5 rounded-full overflow-hidden shrink-0 border-none">
                                                                            <img
                                                                                src={`https://www.google.com/s2/favicons?sz=64&domain=${new URL(s.url).hostname}`}
                                                                                alt=""
                                                                                className="h-full w-full object-cover"
                                                                                onError={(e) => (e.currentTarget.style.display = 'none')}
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <span className="text-[10px] font-medium group-hover/sources:text-foreground">
                                                                    {displayRes.sources.length} sources
                                                                </span>
                                                            </Button>
                                                        </SheetTrigger>
                                                        <SheetContent side="right" className="w-[350px] sm:w-[450px] p-0 flex flex-col gap-0 border-l border-border/40 shadow-2xl">
                                                            <SheetHeader className="px-6 py-5 border-b border-border/40 shrink-0 bg-muted/10">
                                                                <SheetTitle className="text-xl font-bold flex items-center gap-2">
                                                                    <span>{displayRes.sources.length}</span>
                                                                    <span className="text-foreground/80">Sources</span>
                                                                </SheetTitle>
                                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">Sources for "{displayContent.substring(0, 50)}..."</p>
                                                            </SheetHeader>
                                                            <ScrollArea className="flex-1 w-full">
                                                                <div className="divide-y divide-border/30">
                                                                    {displayRes.sources.map((source, idx) => (
                                                                        <div key={idx} className="p-6 hover:bg-muted/20 transition-colors group/source-item">
                                                                            <div className="flex items-start gap-4">
                                                                                <div className="text-[10px] font-mono text-muted-foreground/40 mt-1 shrink-0 bg-muted px-1.5 py-0.5 rounded">
                                                                                    {idx + 1}
                                                                                </div>
                                                                                <div className="space-y-3 flex-1 min-w-0">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <img
                                                                                            src={`https://www.google.com/s2/favicons?sz=64&domain=${new URL(source.url).hostname}`}
                                                                                            alt=""
                                                                                            className="size-4 rounded-full"
                                                                                        />
                                                                                        <span className="text-xs font-medium text-muted-foreground truncate uppercase tracking-wider">
                                                                                            {new URL(source.url).hostname.replace('www.', '').toLowerCase()}
                                                                                        </span>
                                                                                    </div>
                                                                                    <a
                                                                                        href={source.url}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="block group/title"
                                                                                    >
                                                                                        <h4 className="text-[15px] font-bold leading-snug text-foreground/90 group-hover/title:text-primary transition-colors line-clamp-2">
                                                                                            {source.title}
                                                                                        </h4>
                                                                                    </a>
                                                                                    {source.content && (
                                                                                        <p className="text-[13px] leading-relaxed text-muted-foreground/80 line-clamp-3">
                                                                                            {source.content}
                                                                                        </p>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </ScrollArea>
                                                        </SheetContent>
                                                    </Sheet>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Right Actions - Version Navigation */}
                                {versionCount > 1 && (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground rounded-md px-1 select-none">
                                        <TooltipProvider delayDuration={400}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-5 w-5 hover:bg-sidebar-accent/50 transition-colors"
                                                        onClick={() => onVersionChange?.('prev')}
                                                        disabled={currentVersion <= 1}
                                                    >
                                                        <IconChevronLeft className="size-3" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom"><p className="text-[10px]">Previous version</p></TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>

                                        <span className="px-1 min-w-[30px] text-center font-mono opacity-60">
                                            {currentVersion} / {versionCount}
                                        </span>

                                        <TooltipProvider delayDuration={400}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-5 w-5 hover:bg-sidebar-accent/50 transition-colors"
                                                        onClick={() => onVersionChange?.('next')}
                                                        disabled={currentVersion >= versionCount}
                                                    >
                                                        <IconChevronRight className="size-3" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom"><p className="text-[10px]">Next version</p></TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* System message actions - hide when streaming */}
                        {isSystem && !message.isThinking && availableModels.length > 0 && (
                            <div className="flex items-center justify-end mt-2 select-none">
                            </div>
                        )}
                        {/* Follow-up Suggestions - hide when streaming */}
                        {isAssistant && !message.isThinking && displayRes.suggestions && displayRes.suggestions.length > 0 && (
                            <Suggestions>
                                {displayRes.suggestions.map((s, i) => (
                                    <Suggestion
                                        key={i}
                                        suggestion={s}
                                        onClick={onSuggestionClick}
                                    />
                                ))}
                            </Suggestions>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function ActionButton({ icon: Icon, label, onClick, className, delayDuration }: { icon: any, label: string, onClick?: () => void, className?: string, delayDuration?: number }) {
    return (
        <TooltipProvider>
            <Tooltip delayDuration={delayDuration}>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className={cn("h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-md transition-colors", className)} onClick={onClick}>
                        <Icon className="size-3.5" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    <p>{label}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
