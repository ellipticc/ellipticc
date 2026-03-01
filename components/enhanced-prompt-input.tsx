import React, { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { IconPlus, IconChevronDown, IconArrowUp, IconX, IconFileText, IconLoader2, IconCheck, IconArchive, IconWorld, IconSquareFilled, IconAlertCircle, IconWand, IconArrowBackUp, IconPaperclip, IconBulbFilled } from "@tabler/icons-react";
import { Feather as FeatherIcon } from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { isPromptTooLong } from "@/lib/constants/prompt-limits";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { useIsMobileDevice } from "@/lib/mobile-utils";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuCheckboxItem,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { ModelSelectorLogo } from "@/components/ai-elements/model-selector"
import {
    Context,
    ContextTrigger,
    ContextContent,
    ContextContentHeader,
    ContextWindowBreakdown,
} from "@/components/ai-elements/context"
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Icons = {
    Plus: IconPlus,
    SelectArrow: IconChevronDown,
    ArrowUp: IconArrowUp,
    X: IconX,
    SquareFilled: IconSquareFilled,
    FileText: IconFileText,
    Loader2: IconLoader2,
    Check: IconCheck,
    Archive: IconArchive,
};

interface AttachedFile {
    id: string;
    file: File;
    type: string;
    preview: string | null;
}

interface FilePreviewCardProps {
    file: AttachedFile;
    onRemove: (id: string) => void;
}

const FilePreviewCard: React.FC<FilePreviewCardProps> = ({ file, onRemove }) => {
    const isImage = file.type.startsWith("image/") && file.preview;

    return (
        <div className={cn(
            "relative group flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-border bg-muted/50 transition-all hover:border-muted-foreground/50",
            "animate-in fade-in zoom-in-95 duration-200"
        )}>
            {isImage ? (
                <div className="w-full h-full relative">
                    <img src={file.preview!} alt={file.file.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
                </div>
            ) : (
                <div className="w-full h-full p-3 flex flex-col justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-background rounded">
                            <Icons.FileText className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                            {file.file.name.split('.').pop()}
                        </span>
                    </div>
                    <div className="space-y-0.5">
                        <p className="text-xs font-medium text-foreground truncate" title={file.file.name}>
                            {file.file.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                            {formatFileSize(file.file.size)}
                        </p>
                    </div>
                </div>
            )}

            {/* Remove Button Overlay */}
            <button
                onClick={() => onRemove(file.id)}
                className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <Icons.X className="w-3 h-3" />
            </button>
        </div>
    );
};


interface EnhancedPromptInputProps {
    onSubmit: (value: string, attachments: File[], thinkingMode?: boolean, searchMode?: boolean, style?: string) => Promise<void>;
    isLoading?: boolean;
    onStop?: () => void;
    model?: string;
    onModelChange?: (model: string) => void;
    contextItems?: Array<{ id: string; type: 'text' | 'code'; content: string }>;
    onRemoveContextItem?: (id: string) => void;
    // Context window tracking (only show indicator if conversationId is present)
    conversationId?: string;
    maxContextTokens?: number;
    usedContextTokens?: number;
    systemTokens?: number;
    toolDefinitionTokens?: number;
    messageTokens?: number;
    userMessageTokens?: number;
    assistantMessageTokens?: number;
    toolResultTokens?: number;
}

export const EnhancedPromptInput: React.FC<EnhancedPromptInputProps> = ({
    onSubmit,
    isLoading,
    onStop,
    model: externalModel,
    onModelChange,
    contextItems = [],
    onRemoveContextItem,
    conversationId,
    maxContextTokens = 128000,
    usedContextTokens = 0,
    systemTokens = 0,
    toolDefinitionTokens = 0,
    messageTokens = 0,
    userMessageTokens = 0,
    assistantMessageTokens = 0,
    toolResultTokens = 0,
}) => {
    const [message, setMessage] = useState("");
    const [files, setFiles] = useState<AttachedFile[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [localModel, setLocalModel] = useState('auto');
    const [thinkingMode, setThinkingMode] = useState(false);
    const [searchMode, setSearchMode] = useState(false);
    const [style, setStyle] = useState('Normal');
    const [tokenError, setTokenError] = useState(false);
    const [isImproving, setIsImproving] = useState(false);
    const [originalMessage, setOriginalMessage] = useState<string | null>(null);

    // Mobile detection
    const isMobile = useIsMobileDevice();

    // Audio recording state
    const {
        state: audioState,
        transcript,
        stream,
        startRecording,
        stopRecording,
        cancelRecording,
    } = useAudioRecording({
        onTranscript: (text, isFinal) => {
            if (isFinal) {
                // Final text - user can now edit manually
                setMessage(text);
            } else {
                // Interim text - overwrite with new interim
                setMessage(text);
            }
        },
        onNoAudioDetected: (shouldShowToast) => {
            // Only show toast if there's no existing text in the input
            if (shouldShowToast) {
                toast.error('No audio detected. Make sure your microphone is connected and unmuted.');
            }
        },
        hasExistingText: () => message.trim().length > 0,
    });

    const effectiveModel = externalModel || localModel;
    const handleModelChange = (m: string) => {
        setLocalModel(m);
        onModelChange?.(m);
    }

    // Thinking mode supported models
    const thinkingSupportedModels = ["qwen/qwen3-32b", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "deepseek-ai/DeepSeek-V3.1"];
    const isThinkingSupported = thinkingSupportedModels.includes(effectiveModel);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const models = [
        { id: "auto", name: "Auto", description: "Balances speed & quality", provider: "auto" },
        { id: "deepseek-ai/DeepSeek-V3.1", name: "DeepSeek V3.1", description: "General, 128k context", provider: "deepseek" },
        { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", description: "Vision, General", provider: "openai" },
        { id: "qwen/qwen3-32b", name: "Qwen 3 32B", description: "Code, Reasoning", provider: "alibaba" },
        { id: "moonshotai/kimi-k2-instruct-0905", name: "Kimi K2", description: "Long Context, 262k", provider: "moonshotai" },
    ];

    const currentModel = models.find(m => m.id === effectiveModel) || models[0];

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
    }, [message]);

    // File Handling
    const handleFiles = useCallback((newFilesList: FileList | File[]) => {
        const newFiles = Array.from(newFilesList).map(file => {
            const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
            return {
                id: Math.random().toString(36).substr(2, 9),
                file,
                type: isImage ? 'image/unknown' : (file.type || 'application/octet-stream'),
                preview: isImage ? URL.createObjectURL(file) : null,
            };
        });

        setFiles(prev => [...prev, ...newFiles]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) pastedFiles.push(file);
            }
        }

        if (pastedFiles.length > 0) {
            e.preventDefault();
            handleFiles(pastedFiles);
            return;
        }
    };

    const handleImprove = async () => {
        if (!message.trim() || isImproving) return;

        setIsImproving(true);
        try {
            const res = await apiClient.improveAIPrompt(message);

            if (!res.success) {
                toast.error(res.error || res.message || 'Failed to improve prompt');
                return;
            }

            setOriginalMessage(message);
            if (res.data?.improvedPrompt) {
                setMessage(res.data.improvedPrompt);
            }
        } catch (error) {
            console.error("Failed to improve prompt:", error);
            toast.error("Failed to improve prompt.");
        } finally {
            setIsImproving(false);
        }
    };

    const handleRevert = () => {
        if (originalMessage !== null) {
            setMessage(originalMessage);
            setOriginalMessage(null);
        }
    };

    const handleSend = async () => {
        if ((!message.trim() && files.length === 0 && contextItems.length === 0) || isLoading) return;

        setOriginalMessage(null);

        // Check token limit before sending
        if (isPromptTooLong(message)) {
            setTokenError(true);
            // Auto-clear error after 5 seconds
            setTimeout(() => setTokenError(false), 5000);
            return;
        }

        setTokenError(false);
        const messageToSend = message;
        const currentFiles = files.map(f => f.file);
        const shouldThink = thinkingMode && isThinkingSupported;
        const shouldSearch = searchMode;

        // Clear input immediately, before sending
        setMessage("");
        setFiles([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';

        try {
            await onSubmit(messageToSend, currentFiles, shouldThink, shouldSearch, style);
        } catch (error) {
            // On error, restore the message so user can retry
            setMessage(messageToSend);
            setFiles(currentFiles.map((file, index) => ({
                id: `error-${index}`,
                file,
                type: file.type,
                preview: null
            })));
            console.error("Failed to send message:", error);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const hasContent = message.trim() || files.length > 0 || contextItems.length > 0;

    return (
        <div
            className={cn(
                "relative w-full max-w-[57rem] mx-auto transition-all duration-300 font-sans",
                isDragging && "scale-[1.02]"
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {/* Main Container */}
            <div className={cn(
                "flex flex-col mx-auto md:mx-0 items-stretch transition-all duration-200 relative z-10 rounded-2xl border border-border/20 bg-white dark:bg-sidebar",
                isLoading && "opacity-60"
            )}>

                <div className="flex flex-col px-4 pt-4 pb-3 gap-2">


                    {(files.length > 0 || contextItems.length > 0) && (
                        <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-2 px-1">

                            {contextItems.map(item => (
                                <div
                                    key={item.id}
                                    className={cn(
                                        "relative group flex-shrink-0 max-w-[200px] h-24 rounded-xl overflow-hidden border border-primary/20 bg-primary/5 transition-all",
                                        "animate-in fade-in zoom-in-95 duration-200"
                                    )}
                                >
                                    <div className="w-full h-full p-3 flex flex-col justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 bg-background rounded text-primary">
                                                <Icons.FileText className="w-4 h-4" />
                                            </div>
                                            <span className="text-[10px] font-medium text-primary uppercase tracking-wider truncate">
                                                Context
                                            </span>
                                        </div>
                                        <div className="space-y-0.5">
                                            <p className="text-xs font-medium text-foreground line-clamp-2" title={item.content}>
                                                {item.content}
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => onRemoveContextItem?.(item.id)}
                                        className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Icons.X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}


                            {files.map(file => (
                                <FilePreviewCard
                                    key={file.id}
                                    file={file}
                                    onRemove={id => setFiles(prev => prev.filter(f => f.id !== id))}
                                />
                            ))}
                        </div>
                    )}


                    <div className={cn("relative mb-1", isLoading && "pointer-events-none")}>
                        <div className="max-h-[40vh] w-full overflow-y-auto overflow-x-hidden custom-scrollbar font-sans break-words min-h-[2.5rem] pl-1 pr-3 relative">
                            {isImproving ? (
                                <Shimmer className="w-full text-[16px] leading-relaxed py-0 block min-h-[1.5em] text-foreground p-[2px]">
                                    {message || "Improving..."}
                                </Shimmer>
                            ) : (
                                <textarea
                                    ref={textareaRef}
                                    value={message}
                                    onChange={(e) => {
                                        setMessage(e.target.value);
                                        if (originalMessage !== null) setOriginalMessage(null);
                                    }}
                                    onPaste={handlePaste}
                                    onKeyDown={handleKeyDown}
                                    placeholder={conversationId ? "Reply..." : "How can I help you today?"}
                                    data-has-content={hasContent ? "true" : undefined}
                                    className="w-full bg-transparent border-0 outline-none text-foreground text-[16px] placeholder:text-muted-foreground resize-none overflow-hidden py-0 leading-relaxed block font-normal antialiased p-[2px]"
                                    rows={1}
                                    autoFocus
                                    style={{ minHeight: '1.5em' }}
                                />
                            )}
                        </div>
                    </div>

                    {/* Token Limit Error */}
                    {tokenError && (
                        <div className="animate-in fade-in duration-200 flex items-center gap-2 px-3 py-2.5 bg-destructive/10 border border-destructive/30 rounded-lg">
                            <IconAlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                            <span className="text-sm text-destructive font-medium">Prompt too long. Please shorten your message.</span>
                        </div>
                    )}


                    <div className="flex gap-2 w-full items-center justify-between">

                        <div className={cn("flex items-center gap-1", isLoading && "pointer-events-none")}>
                            {/* Plus menu dropdown (desktop & mobile) */}
                            <DropdownMenu>
                                <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/20 dark:hover:bg-sidebar-accent/30 transition-all">
                                    <Icons.Plus className="w-4 h-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="top" align="start" className="w-max">
                                    {/* Attach files */}
                                    <DropdownMenuItem
                                        onClick={() => fileInputRef.current?.click()}
                                        className="cursor-pointer"
                                    >
                                        <IconPaperclip className="w-4 h-4 mr-2" />
                                        <span>Add files or photos</span>
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    {/* Web search toggle */}
                                    <DropdownMenuItem
                                        onClick={(e) => { e.preventDefault(); setSearchMode(!searchMode); }}
                                        className="cursor-pointer flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center">
                                            <IconWorld className="w-4 h-4 mr-2" />
                                            <span>Web search</span>
                                        </div>
                                        {searchMode && <Icons.Check className="w-4 h-4 text-primary" />}
                                    </DropdownMenuItem>

                                    {/* Thinking mode toggle */}
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (isThinkingSupported) setThinkingMode(!thinkingMode);
                                        }}
                                        disabled={!isThinkingSupported}
                                        className="cursor-pointer flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center">
                                            <IconBulbFilled className="w-4 h-4 mr-2" />
                                            <span>Thinking mode</span>
                                        </div>
                                        {thinkingMode && <Icons.Check className="w-4 h-4 text-primary" />}
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    {/* Style submenu */}
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger className="flex items-center gap-2">
                                            <span>Use style</span>
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            <DropdownMenuRadioGroup value={style} onValueChange={setStyle}>
                                                {['Normal', 'Learning', 'Concise', 'Explanatory', 'Formal'].map(s => (
                                                    <DropdownMenuRadioItem key={s} value={s} className="flex items-center gap-2">
                                                        <FeatherIcon className="w-4 h-4" />
                                                        {s}
                                                    </DropdownMenuRadioItem>
                                                ))}
                                            </DropdownMenuRadioGroup>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Improve / Revert buttons */}
                            <>
                                {isImproving ? (
                                    <button
                                        disabled
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 h-8 rounded-lg text-xs font-medium cursor-not-allowed opacity-50"
                                        type="button"
                                    >
                                        <Icons.Loader2 className="w-4 h-4 animate-spin text-primary" />
                                        <span>Improving</span>
                                    </button>
                                ) : originalMessage !== null ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={handleRevert}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 h-8 rounded-lg text-xs font-medium transition-all text-muted-foreground hover:bg-sidebar-accent/20 dark:hover:bg-sidebar-accent/30 hover:text-foreground"
                                                type="button"
                                            >
                                                <IconArrowBackUp className="w-4 h-4" />
                                                <span>Revert</span>
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                            Revert to original prompt
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={handleImprove}
                                                disabled={!message.trim() || isLoading}
                                                className={cn(
                                                    'inline-flex items-center gap-1.5 px-2.5 py-1 h-8 rounded-lg text-xs font-medium transition-all',
                                                    message.trim()
                                                        ? 'text-muted-foreground hover:bg-sidebar-accent/20 dark:hover:bg-sidebar-accent/30 hover:text-foreground'
                                                        : 'text-muted-foreground/50 cursor-not-allowed opacity-50'
                                                )}
                                                type="button"
                                            >
                                                <IconWand className="w-4 h-4" />
                                                <span>Improve</span>
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                            AI Improve Prompt
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                            </>

                        </div>

                        <div className="flex-1" />

                        <div className="flex items-center gap-1">
                            {/* Model Selector - Hidden on mobile to save space */}
                            {!isMobile && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 px-2.5 gap-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/20 dark:hover:bg-sidebar-accent/30 transition-all outline-none focus:outline-none focus-visible:outline-none">
                                        <span className="inline text-[12px] max-w-[80px] truncate">{currentModel.name}</span>
                                        <Icons.SelectArrow className="shrink-0 opacity-75 w-3 h-3" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent side="top" align="end" className="min-w-[220px]">
                                        <DropdownMenuLabel className="text-xs text-muted-foreground">Platform Models</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {models.map((model) => (
                                            <DropdownMenuItem
                                                key={model.id}
                                                onClick={() => handleModelChange(model.id)}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <ModelSelectorLogo provider={model.provider as any} className="w-4 h-4 mr-1" />
                                                <div className="flex flex-col flex-1">
                                                    <span className="text-sm font-medium">{model.name}</span>
                                                    <span className="text-[10px] text-muted-foreground">{model.description}</span>
                                                </div>
                                                {effectiveModel === model.id && <Icons.Check className="w-4 h-4 ml-auto text-primary" />}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}

                            {/* Send/Stop/Audio Button */}
                            {isLoading ? (
                                !isMobile ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={onStop}
                                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-muted text-foreground hover:bg-sidebar-accent/30 dark:hover:bg-sidebar-accent/40 transition-colors pointer-events-auto opacity-100"
                                                type="button"
                                                aria-label="Stop generation"
                                            >
                                                <Icons.SquareFilled className="w-4 h-4" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                            Stop generation (Esc)
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <button
                                        onClick={onStop}
                                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-muted text-foreground hover:bg-sidebar-accent/30 dark:hover:bg-sidebar-accent/40 transition-colors pointer-events-auto opacity-100"
                                        type="button"
                                        aria-label="Stop generation"
                                    >
                                        <Icons.SquareFilled className="w-4 h-4" />
                                    </button>
                                )
                            ) : !hasContent && audioState === 'idle' ? (
                                // Audio Recording Button - Show when input is empty
                                !isMobile ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={startRecording}
                                                className={cn(
                                                    "inline-flex items-center justify-center h-8 w-8 rounded-lg transition-all",
                                                    "bg-primary text-primary-foreground hover:bg-primary/90"
                                                )}
                                                type="button"
                                                aria-label="Start dictation"
                                            >
                                                <AudioLinesIcon size={16} className="text-primary-foreground" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                            Dictation
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <button
                                        onClick={startRecording}
                                        className={cn(
                                            "inline-flex items-center justify-center h-8 w-8 rounded-lg transition-all",
                                            "bg-primary text-primary-foreground hover:bg-primary/90"
                                        )}
                                        type="button"
                                        aria-label="Start dictation"
                                    >
                                        <AudioLinesIcon size={16} className="text-primary-foreground" />
                                    </button>
                                )
                            ) : audioState !== 'idle' && audioState !== 'no_audio_detected' ? (
                                // Recording/Transcribing Controls - Simplified
                                <div className="flex items-center gap-2">
                                    {/* Cancel Dictation */}
                                    {!isMobile ? (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={cancelRecording}
                                                    disabled={audioState.includes('transcribing')}
                                                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-muted text-foreground hover:bg-sidebar-accent/30 dark:hover:bg-sidebar-accent/40 transition-colors disabled:opacity-50"
                                                    type="button"
                                                    aria-label="Cancel dictation"
                                                >
                                                    <Icons.X className="w-4 h-4" />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                                Cancel Dictation
                                            </TooltipContent>
                                        </Tooltip>
                                    ) : (
                                        <button
                                            onClick={cancelRecording}
                                            disabled={audioState.includes('transcribing')}
                                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-muted text-foreground hover:bg-sidebar-accent/30 dark:hover:bg-sidebar-accent/40 transition-colors disabled:opacity-50"
                                            type="button"
                                            aria-label="Cancel dictation"
                                        >
                                            <Icons.X className="w-4 h-4" />
                                        </button>
                                    )}

                                    {/* Submit Dictation */}
                                    {!isMobile ? (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={stopRecording}
                                                    disabled={audioState.includes('transcribing')}
                                                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                                    type="button"
                                                    aria-label="Submit dictation"
                                                >
                                                    <Icons.Check className="w-4 h-4" />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                                Submit Dictation
                                            </TooltipContent>
                                        </Tooltip>
                                    ) : (
                                        <button
                                            onClick={stopRecording}
                                            disabled={audioState.includes('transcribing')}
                                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                            type="button"
                                            aria-label="Submit dictation"
                                        >
                                            <Icons.Check className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ) : (
                                // Regular Send Button
                                !isMobile ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={handleSend}
                                                disabled={!hasContent}
                                                className={cn(
                                                    "inline-flex items-center justify-center h-8 w-8 rounded-lg transition-all",
                                                    hasContent
                                                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                                        : "bg-muted text-muted-foreground cursor-not-allowed"
                                                )}
                                                type="button"
                                                aria-label="Send message"
                                            >
                                                <Icons.ArrowUp className="w-4 h-4" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="text-xs">
                                            {hasContent ? 'Send message (Enter)' : 'Message is empty'}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <button
                                        onClick={handleSend}
                                        disabled={!hasContent}
                                        className={cn(
                                            "inline-flex items-center justify-center h-8 w-8 rounded-lg transition-all",
                                            hasContent
                                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                                : "bg-muted text-muted-foreground cursor-not-allowed"
                                        )}
                                        type="button"
                                        aria-label="Send message"
                                    >
                                        <Icons.ArrowUp className="w-4 h-4" />
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {isDragging && (
                <div className="absolute inset-0 bg-background/80 border-2 border-dashed border-primary rounded-3xl z-50 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none animate-in fade-in duration-200">
                    <Icons.Archive className="w-10 h-10 text-primary mb-2 animate-bounce" />
                    <p className="text-primary font-medium">Drop files to upload</p>
                </div>
            )}

            <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                }}
                className="hidden"
            />
        </div>
    );
};
