"use client";

import React, { useMemo, useState, useRef, useEffect, useCallback, useTransition } from "react";
import { useFormatter } from "@/hooks/use-formatter";
import { useSortWorker } from "@/hooks/use-sort-worker";
import { precomputeFileFieldsBatch, precomputeFileFields, ComputedFileItem } from "@/lib/computed-fields";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { SortDescriptor, Selection } from "react-aria-components";
import { Table, TableCard } from "@/components/application/table/table";
import { Button } from "@/components/ui/button";
import { IconFolderPlus, IconFolderDown, IconFileUpload, IconFolderUp, IconDotsVertical, IconListDetails, IconDownload, IconFolder, IconEdit, IconInfoCircle, IconTrash, IconChevronRight, IconLink, IconEye, IconLayoutColumns, IconCopy, IconLoader2, IconGrid3x3, IconLock, IconX, IconUpload, IconChevronDown, IconFileText, IconBrandGoogleDrive } from "@tabler/icons-react";

import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import dynamic from "next/dynamic";

const CreateFolderModal = dynamic(() => import("@/components/modals/create-folder-modal").then(mod => mod.CreateFolderModal));
const MoveToFolderModal = dynamic(() => import("@/components/modals/move-to-folder-modal").then(mod => mod.MoveToFolderModal));
const CopyModal = dynamic(() => import("@/components/modals/copy-modal").then(mod => mod.CopyModal));
const DetailsModal = dynamic(() => import("@/components/modals/details-modal").then(mod => mod.DetailsModal));
const MoveToTrashModal = dynamic(() => import("@/components/modals/move-to-trash-modal").then(mod => mod.MoveToTrashModal));
const RenameModal = dynamic(() => import("@/components/modals/rename-modal").then(mod => mod.RenameModal));
const ConflictModal = dynamic(() => import("@/components/modals/conflict-modal").then(mod => mod.ConflictModal));
const LockItemModal = dynamic(() => import("@/components/modals/lock-item-modal").then(mod => mod.LockItemModal));
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/ui/input";
import { getCachedDecryptedFilename, decryptFilename, encryptFilename, computeFilenameHmac, createSignedFileManifest, createSignedFolderManifest, decryptUserPrivateKeys } from "@/lib/crypto";
import { apiClient, FileItem, FolderContentItem, FileContentItem, PQCKeypairs, Tag } from "@/lib/api";
import { prepareMoveToTrashPayload } from "@/lib/trash";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FullPagePreviewModal } from "@/components/previews/full-page-preview-modal";
import { useCurrentFolder } from "@/components/current-folder-context";
import { useOnFileAdded, useOnFileDeleted, useOnFileReplaced, useGlobalUpload } from "@/components/global-upload-context";
import { FileThumbnail } from "../files/file-thumbnail";
import { FileIcon } from "@/components/file-icon";
import { decryptData } from '@/lib/crypto';
import { masterKeyManager } from "@/lib/master-key";
import { paperService } from "@/lib/paper-service";
import { useIsMobile } from "@/hooks/use-mobile";
import { TruncatedNameTooltip } from "@/components/tables/truncated-name-tooltip";
import { cx } from "@/utils/cx";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-context";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import {
    DndContext,
    DragOverlay,
    useDraggable,
    useDroppable,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
    useDndMonitor,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { AnimatePresence, motion } from "motion/react";
import { useLanguage } from "@/lib/i18n/language-context";
import {
    ActionBar,
    ActionBarSelection,
    ActionBarGroup,
    ActionBarItem,
    ActionBarClose,
    ActionBarSeparator,
} from "@/components/ui/action-bar";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
    EmptyMedia,
} from "@/components/ui/empty";

/**
 * DropHelper: Contextual drop message that appears only when hovering valid targets
 */
const DropHelper = ({ folderName, isVisible }: { folderName: string | null; isVisible: boolean }) => {
    return (
        <AnimatePresence>
            {isVisible && folderName && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.12, ease: "easeOut" }}
                    className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg shadow-2xl border border-primary/30 backdrop-blur-md"
                >
                    <IconUpload className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium whitespace-nowrap">
                        Drop to move to <span className="font-bold">"{folderName}"</span>
                    </span>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

const AutoScroller = () => {
    useDndMonitor({
        onDragMove(event) {
            const sensorEvent = (event as any).sensorEvent;
            if (!sensorEvent) return;

            // Get coordinates based on event type
            let clientY = 0;
            if (sensorEvent instanceof MouseEvent || sensorEvent instanceof PointerEvent) {
                clientY = sensorEvent.clientY;
            } else if (sensorEvent instanceof TouchEvent && sensorEvent.touches.length > 0) {
                clientY = sensorEvent.touches[0].clientY;
            } else {
                return;
            }

            const SCROLL_ZONE_SIZE = 100;
            const SCROLL_SPEED = 15;
            const viewportHeight = window.innerHeight;

            // Scroll down
            if (viewportHeight - clientY < SCROLL_ZONE_SIZE) {
                window.scrollBy({ top: SCROLL_SPEED, behavior: 'auto' });
            }
            // Scroll up
            else if (clientY < SCROLL_ZONE_SIZE) {
                window.scrollBy({ top: -SCROLL_SPEED, behavior: 'auto' });
            }
        },
    });
    return null;
};

/**
 * DraggableRow: Wrapper for Table.Row that makes it draggable and optionally droppable
 */
const DraggableDroppableRow = React.memo(React.forwardRef<HTMLTableRowElement, {
    item: FileItem;
    isSelected: boolean;
    isDraggingSomewhere: boolean;
    children: React.ReactNode;
    onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}>(({
    item,
    isSelected,
    isDraggingSomewhere,
    children,
    onContextMenu,
    ...props
}, ref) => {
    const isMobile = useIsMobile();

    // Draggable logic for all items
    const {
        attributes,
        listeners,
        setNodeRef: setDragRef,
        isDragging
    } = useDraggable({
        id: item.id,
        disabled: isMobile,
        data: { type: 'move', item }
    });

    // Droppable logic only for folders
    const {
        setNodeRef: setDropRef,
        isOver
    } = useDroppable({
        id: item.id,
        disabled: isMobile || item.type !== 'folder' || isDraggingSomewhere && isSelected,
        data: { type: 'folder', item }
    });

    // Combine refs
    const setRefs = (node: HTMLTableRowElement | null) => {
        setDragRef(node);
        setDropRef(node);
        if (typeof ref === 'function') {
            ref(node);
        } else if (ref) {
            (ref as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
        }
    };

    const style = {
        zIndex: isDragging ? 50 : undefined,
        // Only disable touch action when we are definitely dragging to allow scrolling otherwise
        touchAction: isDragging ? 'none' : undefined,
    };

    return (
        <Table.Row
            {...props}
            ref={setRefs}
            style={style}
            {...attributes}
            {...listeners}
            data-droppable={item.type === 'folder' ? 'true' : undefined}
            className={cx(
                props.className,
                // Pointed border indicator for folders when hovering
                isOver && item.type === 'folder' && "star-dnd-over",
                isDragging && "opacity-50"
            )}
            onContextMenu={(e) => onContextMenu(e, item)}
        >
            {children}
        </Table.Row>
    );

}));
DraggableDroppableRow.displayName = "DraggableDroppableRow";

const RenameButton = ({
    onClick,
    className
}: {
    onClick: (e: React.MouseEvent) => void,
    className?: string
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
        timeoutRef.current = setTimeout(() => {
            setIsOpen(true);
        }, 300);
    };

    const handleMouseLeave = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setIsOpen(false);
    };

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    return (
        <Tooltip open={isOpen}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={onClick}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={className}
                >
                    <IconEdit className="h-3.5 w-3.5" />
                </button>
            </TooltipTrigger>
            <TooltipContent>Rename</TooltipContent>
        </Tooltip>
    );
};

export const Table01DividerLineSm = ({
    searchQuery,
    onFileUpload,
    onFolderUpload,
    dragDropFiles,
    onDragDropProcessed,
    onUploadHandlersReady,
    filterMode = 'default',
    initialFolderId
}: {
    searchQuery?: string
    onFileUpload?: () => void
    onFolderUpload?: () => void
    dragDropFiles?: { files: File[], folders: FileList | File[] | null }
    onDragDropProcessed?: () => void
    onFileInputRef?: (ref: HTMLInputElement | null) => void
    onFolderInputRef?: (ref: HTMLInputElement | null) => void
    onUploadHandlersReady?: (handlers: { handleFileUpload: () => void; handleFolderUpload: () => void }) => void
    filterMode?: 'default' | 'recents'
    initialFolderId?: string
}) => {
    const { t } = useLanguage();
    const { user } = useUser();
    const router = useRouter();
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const searchParams = useSearchParams();
    const STORAGE_KEY = 'files-table-visible-columns';



    // Debounce search query to prevent excessive API calls
    const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 300); // 300ms debounce

        return () => {
            clearTimeout(handler);
        };
    }, [searchQuery]);

    // Column visibility state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(['modified', 'size']));
    const [isPreferencesLoaded, setIsPreferencesLoaded] = useState(false);

    // Load preferences from local storage
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    // Always hide checksum by default
                    const filtered = parsed.filter(c => c !== 'checksum');
                    setVisibleColumns(new Set(filtered));
                }
            } catch (e) {
                console.error("Failed to parse visible columns preference", e);
            }
        }
        setIsPreferencesLoaded(true);
    }, []);

    // Save preferences to local storage
    useEffect(() => {
        if (isPreferencesLoaded) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(visibleColumns)));
        }
    }, [visibleColumns, isPreferencesLoaded]);

    // Global upload context
    const {
        startUploadWithFiles,
        startUploadWithFolders,
        startFileDownload,
        startFolderDownload,
        notifyFileAdded,
        startBulkDownload
    } = useGlobalUpload();
    const { formatDate } = useFormatter();

    // Current folder context
    const { setCurrentFolderId: setGlobalCurrentFolderId } = useCurrentFolder();

    const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
        column: "name",
        direction: "ascending",
    });

    // Sort worker for background sorting
    const { sortItems, isSorting } = useSortWorker();

    const [files, setFiles] = useState<ComputedFileItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetching, setIsFetching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending] = useTransition();

    // Prevent flashing the empty state: show it slightly after loading finishes
    const [showEmpty, setShowEmpty] = useState(false);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        if (!isLoading && !isFetching && files.length === 0) {
            // Delay showing the empty state briefly to avoid flashes during quick reloads
            timer = setTimeout(() => setShowEmpty(true), 150);
        } else {
            setShowEmpty(false);
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [isLoading, isFetching, files.length]);

    // Track last fetch to prevent duplicates
    const lastFetchRef = useRef<string | null>(null);

    // Pagination state
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const limit = 50;

    // Keep a ref to files for reading in callbacks without triggering updates
    const filesRef = useRef(files);
    filesRef.current = files;

    // Create a memoized map for efficient file lookups
    const filesMap = useMemo(() => {
        const map = new Map<string, FileItem>();
        files.forEach(file => map.set(file.id, file));
        return map;
    }, [files]);



    // Folder navigation state
    const [currentFolderId, setCurrentFolderId] = useState<string>(() => {
        if (initialFolderId) return initialFolderId;
        if (typeof window === 'undefined') return 'root';
        const params = new URLSearchParams(window.location.search);
        return params.get('folderId') || 'root';
    });

    // Reset folder ID when filterMode changes to avoid sticking to a folder in a filtered view
    useEffect(() => {
        if (filterMode === 'recents') {
            setCurrentFolderId('root');
        }
    }, [filterMode]);

    const [folderPath, setFolderPath] = useState<Array<{ id: string, name: string }>>([{ id: 'root', name: 'Vault' }]);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const isNavigatingRef = useRef(false);

    // Update root folder name when language changes
    useEffect(() => {
        setFolderPath(prev => {
            if (prev.length > 0 && prev[0].id === 'root') {
                const newPath = [...prev];
                newPath[0] = { ...newPath[0], name: 'Vault' };
                return newPath;
            }
            return prev;
        });
    }, [t]);

    // Selection state
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [menuOpenRow, setMenuOpenRow] = useState<string | null>(null);
    // Whether the current selection contains any paper items (papers cannot be downloaded)
    const selectedHasPaper = useMemo(() => Array.from(selectedItems).some(id => filesMap.get(id)?.type === 'paper'), [selectedItems, filesMap]);

    // View mode state
    const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

    // Save view mode to localStorage when it changes
    const handleViewModeChange = useCallback((newViewMode: 'table' | 'grid') => {
        setViewMode(newViewMode);
        localStorage.setItem('viewMode', newViewMode);
    }, []);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // DND State
    const [activeDragItem, setActiveDragItem] = useState<FileItem | null>(null);
    const [currentDropTarget, setCurrentDropTarget] = useState<FileItem | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    // Custom Collision Detection Cache
    const cachedDropTargets = useRef<{ id: string; name: string; rect: DOMRect; el: Element; type: 'space' | 'folder' }[]>([]);

    // Helper: Point in Rect
    const isPointInRect = (x: number, y: number, rect: DOMRect) => {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    // RAF throttling for smooth collision detection
    const rafIdRef = useRef<number | null>(null);
    const lastCollisionCheck = useRef<{ x: number; y: number } | null>(null);

    // Global drag state effects
    useEffect(() => {
        if (isDragging) {
            document.body.classList.add('is-dragging-files');
            const appMain = document.querySelector('main') || document.body;
            appMain.classList.add('global-drag-active');
        } else {
            document.body.classList.remove('is-dragging-files');
            const appMain = document.querySelector('main') || document.body;
            appMain.classList.remove('global-drag-active');
        }
        return () => {
            document.body.classList.remove('is-dragging-files');
            const appMain = document.querySelector('main') || document.body;
            appMain.classList.remove('global-drag-active');
        };
    }, [isDragging]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Avoid dragging when clicking
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 300, // Slightly longer long-press for better mobile experience
                tolerance: 15, // Higher tolerance for finger jitter
            },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const item = active.data.current?.item as FileItem;
        if (item) {
            setActiveDragItem(item);
            setIsDragging(true);
        }

        // Cache ALL drop targets (Spaces + Visible Folders) once at start
        const targets: typeof cachedDropTargets.current = [];

        // Try an initial detection
        try {
            const sensorEvent = (event as any).sensorEvent as PointerEvent | TouchEvent | undefined;
            let clientX: number | undefined, clientY: number | undefined;
            if (sensorEvent) {
                if ((sensorEvent as TouchEvent).touches && (sensorEvent as TouchEvent).touches.length) {
                    clientX = (sensorEvent as TouchEvent).touches[0].clientX;
                    clientY = (sensorEvent as TouchEvent).touches[0].clientY;
                } else if ((sensorEvent as PointerEvent).clientX !== undefined) {
                    clientX = (sensorEvent as PointerEvent).clientX;
                    clientY = (sensorEvent as PointerEvent).clientY;
                }
            }
        } catch (err) {
            // ignore detection errors
        }
    };


    const handleDragOver = (event: DragOverEvent) => {
        // Debounce removed to prevent state lag, relying on efficient DOM detection
        const { over } = event;
        const target = over?.data.current?.item as FileItem;

        // Get current pointer coordinates from sensor
        const sensorEvent = (event as any).sensorEvent as PointerEvent | TouchEvent | undefined;
        let clientX: number | undefined, clientY: number | undefined;
        if (sensorEvent) {
            if ((sensorEvent as TouchEvent).touches && (sensorEvent as TouchEvent).touches.length) {
                clientX = (sensorEvent as TouchEvent).touches[0].clientX;
                clientY = (sensorEvent as TouchEvent).touches[0].clientY;
            } else if ((sensorEvent as PointerEvent).clientX !== undefined) {
                clientX = (sensorEvent as PointerEvent).clientX;
                clientY = (sensorEvent as PointerEvent).clientY;
            }
        }

        // 1. Prefer direct folder targets first (closest center strategy handled by dnd-kit usually)
        if (target && target.type === 'folder' && target.id !== activeDragItem?.id) {
            if (currentDropTarget?.id !== target.id) {
                setCurrentDropTarget(target);
            }
            return;
        }

        // Only clear currentDropTarget if we didn't hit a folder via dnd-kit
        if (currentDropTarget && (!target || target.type !== 'folder')) {
            setCurrentDropTarget(null);
        }
    };


    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        // Clear all drag visuals immediately
        setActiveDragItem(null);
        setCurrentDropTarget(null);
        setIsDragging(false);

        if (!over) return;

        const targetFolder = over.data.current?.item as FileItem;
        if (!targetFolder || targetFolder.type !== 'folder') return;

        const draggedItem = active.data.current?.item as FileItem;
        if (!draggedItem) return;

        // Dropping onto same parent is no-op
        if (draggedItem.folderId === targetFolder.id) return;

        // Dropping folder onto itself is no-op
        if (draggedItem.id === targetFolder.id) return;

        // Determine which items to move (current item + others if selected)
        const itemsToMove = selectedItems.has(draggedItem.id)
            ? Array.from(selectedItems).map(id => filesMap.get(id)).filter(Boolean) as FileItem[]
            : [draggedItem];

        // Perform move
        await performMove(itemsToMove, targetFolder.id);
    };

    const performMove = async (items: FileItem[], destinationFolderId: string | null) => {
        setIsLoading(true);
        try {
            let successCount = 0;
            let errorCount = 0;

            for (const item of items) {
                try {
                    let response;
                    if (item.type === 'file') {
                        const nameHmac = await computeFilenameHmac(item.name, destinationFolderId === 'root' ? null : destinationFolderId);
                        response = await apiClient.moveFileToFolder(item.id, destinationFolderId === 'root' ? null : destinationFolderId, nameHmac);
                    } else if (item.type === 'paper') {
                        response = await apiClient.movePaperToFolder(item.id, destinationFolderId === 'root' ? null : destinationFolderId);
                    } else {
                        response = await apiClient.moveFolder(item.id, destinationFolderId === 'root' ? null : destinationFolderId);
                    }

                    if (response.success) successCount++; else errorCount++;
                } catch (err) {
                    console.error('Failed to move item', item.id, err);
                    errorCount++;
                }
            }

            if (successCount > 0) {
                toast.success(`Moved ${successCount} item${successCount > 1 ? 's' : ''} to folder`);
                // Optimistically remove moved items from the view
                setFiles(prev => prev.filter(f => !items.some(i => i.id === f.id)));
                setSelectedItems(new Set());
            }
            if (errorCount > 0) {
                toast.error(`Failed to move ${errorCount} item${errorCount > 1 ? 's' : ''}`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Update global current folder context when local folder changes
    useEffect(() => {
        setGlobalCurrentFolderId(currentFolderId === 'root' ? null : currentFolderId);
    }, [currentFolderId, setGlobalCurrentFolderId]);
    const [renameModalOpen, setRenameModalOpen] = useState(false);
    const [selectedItemForRename, setSelectedItemForRename] = useState<{ id: string; name: string; type: "file" | "folder" | "paper" } | null>(null);
    const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
    const [inlineRenameValue, setInlineRenameValue] = useState("");
    const [isInlineRenaming, setIsInlineRenaming] = useState(false);

    // Rename conflict state
    const [renameConflictOpen, setRenameConflictOpen] = useState(false);
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [renameConflictItems, setRenameConflictItems] = useState<Array<{ id: string; name: string; type: 'file' | 'folder' | 'paper'; existingPath: string; newPath: string; existingItem?: FileItem; existingFileId?: string }>>([]);
    const [pendingRenameManifest, setPendingRenameManifest] = useState<{
        manifestHash: string;
        manifestCreatedAt: number;
        manifestSignatureEd25519: string;
        manifestPublicKeyEd25519: string;
        manifestSignatureDilithium: string;
        manifestPublicKeyDilithium: string;
        algorithmVersion: string;
        nameHmac: string;
        encryptedFilename?: string;
        filenameSalt?: string;
        encryptedName?: string;
        nameSalt?: string;
        requestedName?: string;
    } | null>(null);
    const [renameModalInitialName, setRenameModalInitialName] = useState<string | undefined>(undefined);

    const [detailsModalOpen, setDetailsModalOpen] = useState(false);
    const [selectedItemForDetails, setSelectedItemForDetails] = useState<{ id: string; name: string; type: "file" | "folder" | "paper" } | null>(null);
    const [moveToFolderModalOpen, setMoveToFolderModalOpen] = useState(false);
    const [selectedItemsForMoveToFolder, setSelectedItemsForMoveToFolder] = useState<Array<{ id: string; name: string; type: "file" | "folder" | "paper" }>>([]);
    const [copyModalOpen, setCopyModalOpen] = useState(false);
    const [selectedItemsForCopy, setSelectedItemsForCopy] = useState<Array<{ id: string; name: string; type: "file" | "folder" | "paper" }>>([]);
    const [moveToTrashModalOpen, setMoveToTrashModalOpen] = useState(false);
    const [lockModalOpen, setLockModalOpen] = useState(false);
    const [selectedItemForLock, setSelectedItemForLock] = useState<{ id: string; name: string; type: "file" | "folder" | "paper" } | null>(null);

    const handleLockClick = useCallback((itemId: string, itemName: string, itemType: "file" | "folder" | "paper") => {
        setSelectedItemForLock({ id: itemId, name: itemName, type: itemType });
        setLockModalOpen(true);
    }, []);

    const [selectedItemForMoveToTrash] = useState<{ id: string; name: string; type: "file" | "folder" | "paper" } | null>(null);

    // Preview modal state
    const [previewModalOpen, setPreviewModalOpen] = useState(false);
    const [selectedItemForPreview, setSelectedItemForPreview] = useState<{ id: string; name: string; mimeType?: string } | null>(null);

    // Copy conflict state
    const [copyConflictOpen, setCopyConflictOpen] = useState(false);
    const [copyConflictItems, setCopyConflictItems] = useState<Array<{ id: string; name: string; type: 'file' | 'folder' | 'paper'; conflictingItemId?: string; existingPath: string; newPath: string }>>([]);
    const [copyDestinationFolderId, setCopyDestinationFolderId] = useState<string | null>(null);

    interface UserData {
        id: string
        // metadata fields returned by the profile endpoint
        created_at?: string
        storage_region?: string
        storage_endpoint?: string
        crypto_version?: string
        api_version?: string

        crypto_keypairs: {
            accountSalt: string
            pqcKeypairs: {
                kyber: { publicKey: string; encryptedPrivateKey: string; privateKeyNonce: string; encryptionKey: string; encryptionNonce: string }
                x25519: { publicKey: string; encryptedPrivateKey: string; privateKeyNonce: string; encryptionKey: string; encryptionNonce: string }
                dilithium: { publicKey: string; encryptedPrivateKey: string; privateKeyNonce: string; encryptionKey: string; encryptionNonce: string }
                ed25519: { publicKey: string; encryptedPrivateKey: string; privateKeyNonce: string; encryptionKey: string; encryptionNonce: string }
            }
        }
    }
    const [userData, setUserData] = useState<UserData | null>(null);

    // Fetch user data when conflict modal opens (for signing)
    useEffect(() => {
        if (copyConflictOpen && !userData) {
            apiClient.getProfile().then(response => {
                if (response.success && response.data?.user?.crypto_keypairs) {
                    const cryptoKeys = response.data.user.crypto_keypairs as { accountSalt?: string; pqcKeypairs?: PQCKeypairs }
                    if (cryptoKeys.pqcKeypairs && cryptoKeys.accountSalt) {
                        setUserData({
                            id: response.data.user.id,
                            crypto_keypairs: {
                                accountSalt: cryptoKeys.accountSalt,
                                pqcKeypairs: cryptoKeys.pqcKeypairs
                            }
                        })
                    }
                }
            }).catch(e => console.warn("Failed to load user data for signing", e));
        }
    }, [copyConflictOpen]);

    // Sync state with URL "preview" param
    useEffect(() => {
        const previewId = searchParams?.get('preview');
        if (previewId) {
            // Check the current folder's filesMap
            const file = filesMap.get(previewId);

            if (file && file.type === 'file') {
                setSelectedItemForPreview({ id: file.id, name: file.name, mimeType: file.mimeType });
                setPreviewModalOpen(true);
            } else {
                if (files.length > 0 && !isLoading) {
                    // Only show error if files are loaded and file is definitely missing/invalid
                    toast.error("File ID doesn't exist or cannot be previewed");
                    // Remove invalid param
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('preview');
                    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }
            }
        } else {
            setPreviewModalOpen(false);
            setSelectedItemForPreview(null);
        }
    }, [searchParams, filesMap, files, isLoading, pathname, router]);

    // Update handlePreviewClick to use URL
    const handlePreviewClick = useCallback((itemId: string, itemName: string, mimeType?: string) => {
        // Clear selection immediately so ActionBar hides quickly
        setSelectedItems(new Set());

        const params = new URLSearchParams(searchParams.toString());
        params.set('preview', itemId);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
    }, [pathname, router, searchParams]);

    // Hash copy animation state
    const [copiedHashId, setCopiedHashId] = useState<string | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        isOpen: boolean;
        targetItem?: FileItem;
    } | null>(null);

    // Parse URL path to get folder navigation
    const parseUrlPath = (path: string): string[] => {
        // Path-based routing: /v/<folderId>
        const vaultPrefix = '/v/';
        if (path.startsWith(vaultPrefix)) {
            const rest = path.slice(vaultPrefix.length);
            if (rest) return rest.split('/').filter(Boolean);
        }
        return [];
    };

    // Build URL path from folder path
    const buildUrlPath = (folderPath: Array<{ id: string, name: string }>): string => {
        if (folderPath.length <= 1) return "/v";
        const lastFolder = folderPath[folderPath.length - 1];
        return `/v/${lastFolder.id}`;
    };

    // Truncate breadcrumb names that are too long (encrypted names)
    const truncateBreadcrumbName = (name: string, maxLength: number = 20): string => {
        if (name.length <= maxLength) return name;
        // For long encrypted names, show start and end with ellipsis
        const startLen = Math.ceil(maxLength / 2 - 2);
        const endLen = Math.floor(maxLength / 2 - 2);
        return name.substring(0, startLen) + '...' + name.substring(name.length - endLen);
    };

    // Update URL when folder navigation changes
    const updateUrl = (newFolderPath: Array<{ id: string, name: string }>) => {
        const urlPath = buildUrlPath(newFolderPath);
        router.push(urlPath, { scroll: false });
    };

    // Initialize and sync folder navigation from URL
    // Initialize and sync folder navigation from URL
    useEffect(() => {
        const urlSegments = parseUrlPath(pathname);
        const urlLastId = urlSegments.length > 0 ? urlSegments[urlSegments.length - 1] : 'root';

        // Check if we need to resolve breadcrumb names on initial load
        const needsBreadcrumbResolution = isInitialLoad && urlSegments.length > 0 && folderPath.length <= 1;

        // Prevent update loops if state matches URL (unless we need breadcrumb resolution)
        // Also ensure we update if URL implies root but state implies we are deeper (fix for sidebar navigation)
        const isRootMismatch = urlLastId === 'root' && folderPath.length > 1;

        if (urlLastId === currentFolderId && !needsBreadcrumbResolution && !isRootMismatch) {
            if (isInitialLoad) setIsInitialLoad(false);
            if (isNavigatingRef.current) isNavigatingRef.current = false;
            return;
        }

        // If we initiated a navigation, ignore stale URL params until they match our optimistic state
        if (isNavigatingRef.current && urlLastId !== currentFolderId) {
            return;
        }

        // --- Optimistic Update ---
        const newPath = [{ id: 'root', name: 'Vault' }];
        let needsFetch = false;

        if (urlSegments.length === 0) {
            // Root
            setCurrentFolderId('root');
            setFolderPath(newPath);
            setIsInitialLoad(false);
            return;
        }

        // Reconstruct path from existing state if possible
        for (let i = 0; i < urlSegments.length; i++) {
            const segmentId = urlSegments[i];
            const known = folderPath.length > i + 1 ? folderPath[i + 1] : null;

            if (known && known.id === segmentId && known.name !== '...') {
                newPath.push(known);
            } else {
                newPath.push({ id: segmentId, name: '...' });
                needsFetch = true;
            }
        }

        // Apply Optimistic State
        setCurrentFolderId(urlLastId);
        setFolderPath(newPath);

        if (!needsFetch) {
            setIsInitialLoad(false);
            return;
        }

        // --- Fetch Missing Data using getFolderPath API ---
        const resolvePath = async () => {
            try {
                const resolvedPath = [{ id: 'root', name: 'Vault' }];

                // Use getFolderPath API to get the full path in a single request
                const pathResponse = await apiClient.getFolderPath(urlLastId);
                if (pathResponse.success && pathResponse.data?.path) {
                    const masterKey = masterKeyManager.hasMasterKey() ? masterKeyManager.getMasterKey() : null;

                    for (const segment of pathResponse.data.path) {
                        if (segment.id === 'root') continue;

                        let displayName = '...';
                        if (masterKey && segment.encryptedName && segment.nameSalt) {
                            try {
                                displayName = await getCachedDecryptedFilename(segment.encryptedName, segment.nameSalt, masterKey);
                            } catch {
                                displayName = segment.encryptedName || '...';
                            }
                        }
                        resolvedPath.push({ id: segment.id, name: displayName });
                    }

                    // Final update with decrypted names
                    setFolderPath(resolvedPath);
                    setIsInitialLoad(false);
                    return;
                }

                // Fallback: fetch each folder individually if path API fails
                for (const segment of urlSegments) {
                    if (segment === 'root') continue;

                    // Reuse existing if known/valid
                    const existing = newPath.find(p => p.id === segment && p.name !== '...');
                    if (existing) {
                        resolvedPath.push(existing);
                        continue;
                    }

                    // Fetch individual folder info
                    const response = await apiClient.getFolderInfo(segment);
                    if (response.success && response.data) {
                        let displayName = response.data.name || '';
                        if (response.data.encryptedName && response.data.nameSalt && masterKeyManager.hasMasterKey()) {
                            try {
                                const masterKey = masterKeyManager.getMasterKey();
                                displayName = await getCachedDecryptedFilename(response.data.encryptedName, response.data.nameSalt, masterKey);
                            } catch {
                                displayName = response.data.name || response.data.encryptedName;
                            }
                        }
                        resolvedPath.push({ id: segment, name: displayName });
                    }
                }

                // Final update with names
                setFolderPath(resolvedPath);
                setIsInitialLoad(false);

            } catch (err) {
                router.replace('/', { scroll: false });
                setCurrentFolderId('root');
                setFolderPath([{ id: 'root', name: 'Vault' }]);
                setIsInitialLoad(false);
            }
        };

        resolvePath();

    }, [pathname, searchParams, currentFolderId, isInitialLoad, router, t, folderPath.length]);

    // Start file uploads with progress tracking
    const startUploads = async (files: File[]) => {
        // Use global upload context
        startUploadWithFiles(files, currentFolderId === 'root' ? null : currentFolderId);
    };

    // Start folder uploads with progress tracking (similar to file uploads but with folder hierarchy)
    const startFolderUploads = async (files: FileList | File[]) => {
        // If files is a File[] array (from drag & drop), we need to pass it directly
        // The startUploadWithFolders can handle both FileList and File[] since File[] has the webkitRelativePath property
        startUploadWithFolders(files, currentFolderId === 'root' ? null : currentFolderId);
    };

    // Handle drag and drop files
    useEffect(() => {
        if (dragDropFiles) {
            const { files, folders } = dragDropFiles;
            if (files.length > 0) {
                startUploads(files);
            }
            if (folders) {
                startFolderUploads(folders);
            }
            // Notify parent that we've processed the drag drop files
            onDragDropProcessed?.();
        }
    }, [dragDropFiles, onDragDropProcessed]);

    // Register for file added events to add files and folders incrementally
    useOnFileAdded(useCallback((fileData: FileItem) => {

        // Check if this is a folder or a file
        if (fileData.type === 'folder') {
            // Handle folder - it should appear in the current folder view
            const folderInCurrentFolder = fileData && (
                (currentFolderId === 'root' && fileData.parentId === null) ||
                (currentFolderId !== 'root' && fileData.parentId === currentFolderId)
            );

            if (folderInCurrentFolder) {
                // Use plaintext name directly from callback
                const displayName = fileData.name || '(Unnamed)';

                const newFolder: FileItem = {
                    id: fileData.id,
                    name: displayName,
                    parentId: fileData.parentId,
                    path: fileData.path,
                    type: 'folder' as const,
                    createdAt: fileData.createdAt || new Date().toISOString(),
                    updatedAt: fileData.updatedAt || new Date().toISOString(),
                };

                // Add folder to beginning of list
                setFiles(prev => [precomputeFileFields(newFolder), ...prev]);
            }
        } else {
            // Handle file - existing logic
            // Add the newly uploaded file to the current file list incrementally
            // Handle: null folderId === 'root' currentFolderId case
            const fileInCurrentFolder = fileData && (
                (currentFolderId === 'root' && fileData.folderId === null) ||
                (currentFolderId !== 'root' && fileData.folderId === currentFolderId)
            );
            if (fileInCurrentFolder) {
                // Start with a default display name
                const displayName = `File ${fileData.id.substring(0, 8)}`; // Default fallback

                // Add to beginning of files list immediately with default name
                const newFile: FileItem = {
                    id: fileData.id,
                    name: displayName,
                    filename: fileData.filename,
                    encryptedFilename: fileData.encryptedFilename,
                    filenameSalt: fileData.filenameSalt,
                    size: fileData.size,
                    mimeType: fileData.mimeType,
                    folderId: fileData.folderId,
                    type: 'file' as const,
                    createdAt: fileData.createdAt || new Date().toISOString(),
                    updatedAt: fileData.updatedAt || new Date().toISOString(),
                    shaHash: fileData.shaHash,

                };

                // Add to beginning of files list for visibility
                setFiles(prev => [precomputeFileFields(newFile), ...prev]);

                // Asynchronously decrypt the filename and update the file
                if (fileData.encryptedFilename && fileData.filenameSalt && masterKeyManager.hasMasterKey()) {
                    (async () => {
                        try {
                            const masterKey = masterKeyManager.getMasterKey();
                            const decryptedName = await getCachedDecryptedFilename(fileData.encryptedFilename!, fileData.filenameSalt!, masterKey);
                            // Update the file with the decrypted name
                            setFiles(prev => prev.map(file =>
                                file.id === fileData.id
                                    ? precomputeFileFields({ ...file, name: decryptedName })
                                    : file
                            ));
                        } catch (err) {
                            console.warn(`Failed to decrypt filename for newly uploaded file ${fileData.id}:`, err);
                            // Keep the default fallback name
                        }
                    })();
                }
            }
        }
    }, [currentFolderId]));

    // Register for file deleted events to remove files incrementally
    useOnFileDeleted(useCallback((fileId: string) => {

        // Remove the file from the current file list
        setFiles(prev => prev.filter(file => file.id !== fileId));
    }, []));

    // Track current fetch ID to prevent race conditions
    const fetchIdRef = useRef<number>(0);

    const refreshFiles = useCallback(async (folderId: string = currentFolderId, force: boolean = false) => {
        const fetchKey = `${folderId}-${page}-${filterMode}`;

        // Prevent fetching for reserved routes or headers (unless in specific filter modes)
        if (['shared', 'trash', 'photos', 'recent', 'settings', 'admin', 'help', 'feedback'].includes(folderId) && filterMode === 'default') {
            setIsLoading(false);
            setIsFetching(false);
            return;
        }

        if (!force && lastFetchRef.current === fetchKey) {
            // Already fetching this data or already fetched
            // Ensure loading states are cleared if we were manually set to loading
            setIsLoading(false);
            setIsFetching(false);
            return;
        }
        lastFetchRef.current = fetchKey;

        // Increment fetch ID to invalidate previous requests
        const currentFetchId = ++fetchIdRef.current;

        let success = false;
        try {
            // Set loading state immediately to prevent empty state flash
            setIsLoading(true);
            setError(null);
            // console.log(`Loading folder contents for: ${folderId}, page: ${page} (Fetch ID: ${currentFetchId})`);

            // Determine search mode
            const isGlobalSearch = !!debouncedQuery && debouncedQuery.trim().length > 0;
            // currentFetchId is already defined above

            let response;

            // Arrays to hold accumulated data
            let allFiles: FileContentItem[] = [];
            let allFolders: FolderContentItem[] = [];

            if (filterMode === 'recents') {
                // RECENTS MODE
                // Fetch latest files and folders via folder contents API
                const response = await apiClient.getFolderContents("root", { page: 1, limit: 50 });

                // Safe check for response.data
                const filesData = response.success && response.data ? response.data.files || [] : [];
                const foldersData = response.success && response.data ? response.data.folders || [] : [];

                if (response.success) {
                    // Filter for items updated in the last 10 days
                    const tenDaysAgo = new Date();
                    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

                    const masterKey = masterKeyManager.hasMasterKey() ? masterKeyManager.getMasterKey() : null;

                    // Process files
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const mappedFiles = await Promise.all((filesData || []).map(async (f: any) => {
                        let name = f.name || f.filename || t('common.untitled');

                        const encryptedName = f.encryptedFilename || (f as any).encrypted_filename;
                        const nameSalt = f.filenameSalt || (f as any).filename_salt || (f as any).name_salt;

                        // Try decrypting if encrypted
                        if (encryptedName && nameSalt && masterKey) {
                            try {
                                name = await getCachedDecryptedFilename(encryptedName, nameSalt, masterKey);
                            } catch (e) {
                                console.error("Failed to decrypt recent file name", e);
                            }
                        }

                        return {
                            ...f,
                            // Ensure required string properties have fallbacks
                            encryptedFilename: f.encryptedFilename || "",
                            filenameSalt: f.filenameSalt || "",
                            name: name,
                            decryptedName: name,
                            folderId: f.folderId || null,
                            type: 'file' as const,
                            tags: []
                        };
                    })) as any;

                    // Process folders
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const mappedFolders = await Promise.all((foldersData || []).map(async (f: any) => {
                        let name = f.name || t('common.untitledFolder');

                        const encryptedName = f.encryptedName || (f as any).encrypted_name;
                        const nameSalt = f.nameSalt || (f as any).name_salt;

                        // Try decrypting if encrypted
                        if (encryptedName && nameSalt && masterKey) {
                            try {
                                name = await getCachedDecryptedFilename(encryptedName, nameSalt, masterKey);
                            } catch (e) {
                                console.error("Failed to decrypt recent folder name", e);
                            }
                        }

                        return {
                            ...f,
                            // Ensure required string properties have fallbacks
                            encryptedName: f.encryptedName || "",
                            nameSalt: f.nameSalt || "",
                            name: name,
                            decryptedName: name,
                            parentId: f.parentId || null,
                            type: 'folder' as const,

                            tags: []
                        };
                    })) as any;

                    // Combine files and folders
                    const allRecentItems = [...mappedFiles, ...mappedFolders];

                    // Client side sort by updatedAt descending
                    allRecentItems.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

                    // Filter for items updated in the last 10 days
                    const recentItems = allRecentItems.filter((item: any) => new Date(item.updatedAt) >= tenDaysAgo);

                    // Separate back into files and folders
                    allFiles = recentItems.filter((item: any) => item.type === 'file');
                    allFolders = recentItems.filter((item: any) => item.type === 'folder');

                    setFiles([...allFiles, ...allFolders] as any);
                    success = true;
                } else {
                    throw new Error(response.error || "Failed to load recent files");
                }
            } else if (isGlobalSearch) {
                // GLOBAL SEARCH MODE: Pagination Loop

                // Show feedback if this might take a moment
                const toastId = toast.loading("Searching all files...");

                try {
                    let pageToFetch = 1;
                    // Use a larger limit for search to reduce round trips
                    const searchLimit = 500;
                    let hasMore = true;

                    while (hasMore) {
                        // Check if search was cancelled/changed
                        if (currentFetchId !== fetchIdRef.current) {
                            toast.dismiss(toastId);
                            return;
                        }

                        // Fetch batch
                        const res = await apiClient.getFiles({ page: pageToFetch, limit: searchLimit });

                        if (!res.success || !res.data) {
                            throw new Error(res.error || "Failed to search files");
                        }

                        const data = res.data as { files: FileItem[], pagination: unknown };
                        // Map FileItem to FileContentItem structure if needed, preserving tags
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const batchFiles = (data.files || []).map((f: any) => ({
                            ...f,
                            type: 'file',
                            filename: f.filename || f.name,
                            encryptedFilename: f.encryptedFilename || f.encrypted_filename,
                            filenameSalt: f.filenameSalt || f.filename_salt,
                            createdAt: f.createdAt || f.created_at,
                            updatedAt: f.updatedAt || f.updated_at,
                            tags: f.tags // CRITICAL: Preserve tags!
                        })) as FileContentItem[];

                        allFiles = [...allFiles, ...batchFiles];

                        // Check pagination
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        if (data.pagination && pageToFetch < (data.pagination as any).totalPages) {
                            pageToFetch++;
                        } else {
                            hasMore = false;
                        }

                        // Safety break for extremely large accounts (e.g. > 10k files) to prevent browser hang
                        if (allFiles.length > 5000) {
                            hasMore = false;
                            toast("Search limited to first 5000 files", { icon: "⚠️" });
                        }
                    }

                    // Search completed successfully
                    toast.success(`Found ${allFiles.length} files`, { id: toastId });

                    // Set pagination to "all in one page" for the table view
                    setTotalPages(1);
                    setTotalItems(allFiles.length);

                } catch (err) {
                    toast.error("Search failed", { id: toastId });
                    throw err;
                }

            } else {
                // STANDARD FOLDER MODE: Single Page Fetch
                response = await apiClient.getFolderContents(folderId, { page, limit });

                if (currentFetchId !== fetchIdRef.current) return;

                if (response.success && response.data) {
                    allFiles = response.data.files || [];
                    allFolders = response.data.folders || [];
                    if (response.data.pagination) {
                        setTotalPages(response.data.pagination.totalPages);
                        setTotalItems(response.data.pagination.total);
                    }
                } else {
                    throw new Error(response.error || "Failed to load files");
                }
            }

            // --- Decryption & Processing ---

            // Get master key for filename decryption
            let masterKey: Uint8Array | null = null;
            try {
                masterKey = masterKeyManager.getMasterKey();
            } catch (err) {
                console.warn('Could not retrieve master key for filename decryption', err);
            }

            // Decrypt folders (only for folder mode usually, but harmless for global if any)
            const decryptedFolders = await Promise.all(allFolders.map(async (folder: FolderContentItem) => {
                let displayName = folder.name || '';
                if (!displayName && folder.encryptedName && folder.nameSalt && masterKey) {
                    try {
                        displayName = await getCachedDecryptedFilename(folder.encryptedName, folder.nameSalt, masterKey);
                    } catch {
                        displayName = 'Encrypted Folder';
                    }
                }

                return {
                    id: folder.id,
                    name: displayName || 'Unnamed Folder',
                    parentId: folder.parentId,
                    path: folder.path,
                    type: 'folder' as const,
                    createdAt: folder.createdAt,
                    updatedAt: folder.updatedAt,
                    tags: folder.tags ? await Promise.all(folder.tags.map(async (tag: Tag) => {
                        if (tag.decryptedName) return tag;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const tEncName = tag.encrypted_name || (tag as any).encryptedName;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const tSalt = tag.name_salt || (tag as any).nameSalt;

                        if (masterKey && tEncName && tSalt) {
                            try {
                                const decrypted = await getCachedDecryptedFilename(tEncName, tSalt, masterKey);
                                return { ...tag, decryptedName: decrypted };
                            } catch {
                                return tag;
                            }
                        }
                        return tag;
                    })) : undefined
                };
            }));

            // Decrypt files
            const decryptedFiles = await Promise.all(allFiles.map(async (file: FileContentItem) => {
                // Prioritize decryption if encrypted fields are available, regardless of filename field
                let displayName = '';

                // Try to decrypt if encrypted fields are available
                if (file.encryptedFilename && file.filenameSalt && masterKey) {
                    try {
                        displayName = await getCachedDecryptedFilename(file.encryptedFilename, file.filenameSalt, masterKey);
                    } catch {
                        displayName = file.encryptedFilename?.substring(0, 20) + '...' || '(Unnamed)';
                    }
                }

                // Fall back to filename field if decryption didn't work
                if (!displayName) {
                    displayName = file.filename || file.encryptedFilename || '(Unnamed)';
                }

                return {
                    id: file.id,
                    name: displayName,
                    filename: file.filename,
                    encryptedFilename: file.encryptedFilename,
                    filenameSalt: file.filenameSalt,
                    size: file.size,
                    mimeType: file.mimeType,
                    folderId: file.folderId,
                    type: ((file.type === 'paper' || file.mimeType === 'application/x-paper') ? 'paper' : 'file') as 'paper' | 'file',
                    createdAt: file.createdAt,
                    updatedAt: file.updatedAt,
                    shaHash: file.shaHash,

                    tags: file.tags ? await Promise.all(file.tags.map(async (tag: Tag) => {
                        // Already decrypted?
                        if (tag.decryptedName) return tag;

                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const tEncName = tag.encrypted_name || (tag as any).encryptedName;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const tSalt = tag.name_salt || (tag as any).nameSalt;

                        if (masterKey && tEncName && tSalt) {
                            try {
                                const decrypted = await getCachedDecryptedFilename(tEncName, tSalt, masterKey);
                                return { ...tag, decryptedName: decrypted };
                            } catch {
                                return tag;
                            }
                        }
                        return tag;
                    })) : undefined
                };
            }));

            // Check staleness again before setting state
            if (currentFetchId !== fetchIdRef.current) return;

            // Apply precomputed fields for better performance
            const processedFiles = precomputeFileFieldsBatch([...decryptedFolders, ...decryptedFiles]);

            setFiles(processedFiles);
            success = true;

        } catch (err) {
            // Error handling logic
            const errorMessage = err instanceof Error ? err.message : 'Failed to load files';

            if (currentFetchId !== fetchIdRef.current) return;

            // Logic for redirect if folder not found (only in folder mode usually)
            if (errorMessage.includes('404') || errorMessage.includes('not found')) {
                // Only redirect if we were trying to look at a specific folder, not searching
                if (!debouncedQuery && filterMode === 'default') {
                    setError(`Folder not found. Redirecting...`);
                    setTimeout(() => {
                        if (currentFetchId === fetchIdRef.current) {
                            router.replace('/', { scroll: false });
                            setCurrentFolderId('root');
                            setFolderPath([{ id: 'root', name: 'Vault' }]);
                        }
                    }, 2000);
                } else {
                    setError("Search failed: " + errorMessage);
                }
            } else {
                setError(errorMessage);
            }
        } finally {
            if (currentFetchId === fetchIdRef.current) {
                if (!success) {
                    lastFetchRef.current = null;
                }
                setIsLoading(false);
                setIsFetching(false);
            }
        }
    }, [currentFolderId, page, limit, apiClient, router, debouncedQuery, filterMode]);

    // Load files when folder or page changes, or when search query changes
    useEffect(() => {
        // Treat `/v` as the app's root folder view — allow root fetch on / or /v
        const isVaultRoute = pathname === '/v' || pathname?.startsWith('/v');

        // Prevent root fetch if we are not on the root page (but allow /v)
        if (currentFolderId === 'root' && !isVaultRoute && pathname !== '/' && filterMode === 'default') {
            // console.log(`Skipping root fetch because pathname is ${pathname}`);
            return;
        }
        refreshFiles();
    }, [refreshFiles]);

    // Register for file replaced events to refresh the file list
    useOnFileReplaced(useCallback(() => {

        // Refresh the current folder contents
        refreshFiles(currentFolderId, true);
    }, [refreshFiles, currentFolderId]));

    // Register for file added events (e.g. from upload or create folder)
    useOnFileAdded(useCallback((file: FileItem) => {
        // Only add if it belongs to current folder
        const targetFolderId = currentFolderId === 'root' ? null : currentFolderId;

        // Handle both null and undefined for root comparison
        const fileParentId = file.parentId || null;

        if (fileParentId === targetFolderId) {
            setFiles(prev => {
                // Avoid duplicates
                if (prev.some(f => f.id === file.id)) return prev;
                return [precomputeFileFields(file), ...prev];
            });
            setTotalItems(prev => prev + 1);
        }
    }, [currentFolderId]));

    // Register for file deleted events
    useOnFileDeleted(useCallback((fileId: string) => {
        setFiles(prev => prev.filter(f => f.id !== fileId));
        setTotalItems(prev => Math.max(0, prev - 1));
    }, []));

    // Listen for file-created events
    useEffect(() => {
        const handleFileCreated = (event: CustomEvent) => {
            const { fileId, type } = event.detail || {};
            console.log('[FilesTable] file-created event received:', { fileId, type });

            // Force refresh to show the newly created file/paper
            refreshFiles(currentFolderId, true);
        };

        window.addEventListener('file-created', handleFileCreated as EventListener);
        return () => {
            window.removeEventListener('file-created', handleFileCreated as EventListener);
        };
    }, [currentFolderId, refreshFiles]);



    // Navigate to a folder
    const navigateToFolder = async (folderId: string, folderName: string) => {
        if (folderId === currentFolderId) return;

        const newPath = [...folderPath, { id: folderId, name: folderName }];

        // Immediate updates without transition
        isNavigatingRef.current = true;
        setPage(1); // Reset page to 1
        setIsLoading(true);
        setCurrentFolderId(folderId);
        setFolderPath(newPath);
        updateUrl(newPath);
        setSelectedItems(new Set()); // Clear selection when navigating to new folder
    };

    // Navigate to parent folder
    const navigateToParent = async () => {
        if (folderPath.length > 1) {
            const newPath = folderPath.slice(0, -1);
            const parentFolder = newPath[newPath.length - 1];

            // Immediate updates without transition
            isNavigatingRef.current = true;
            setPage(1); // Reset page to 1
            setIsLoading(true);
            setCurrentFolderId(parentFolder.id);
            setFolderPath(newPath);
            updateUrl(newPath);
        }
    };

    // Navigate to specific folder in path
    const navigateToPath = async (folderId: string) => {
        const folderIndex = folderPath.findIndex(f => f.id === folderId);
        if (folderIndex !== -1) {
            if (folderId === currentFolderId) return;

            const newPath = folderPath.slice(0, folderIndex + 1);

            // Immediate updates without transition
            isNavigatingRef.current = true;
            setPage(1); // Reset page to 1
            setIsLoading(true);
            setCurrentFolderId(folderId);
            setFolderPath(newPath);
            updateUrl(newPath);
            setSelectedItems(new Set()); // Clear selection when navigating to new folder
        }
    };

    const handleFileUpload = useCallback(() => {
        if (onFileUpload) {
            onFileUpload()
        } else {
            fileInputRef.current?.click();
        }
    }, [onFileUpload]);

    const handleFolderUpload = useCallback(() => {
        if (onFolderUpload) {
            onFolderUpload()
        } else {
            folderInputRef.current?.click();
        }
    }, [onFolderUpload]);

    const handleCreatePaper = useCallback(async () => {
        try {
            const folderId = currentFolderId === 'root' ? null : currentFolderId;

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const minute = String(now.getMinutes()).padStart(2, '0');
            const second = String(now.getSeconds()).padStart(2, '0');
            const filename = `Untitled paper ${year}-${month}-${day} ${hour}.${minute}.${second}`;

            // Navigate to paper creation page in the same tab
            router.push('/p/new?creating=1');
            toast('Creating paper...');

            try {
                const newPaperId = await paperService.createPaper(filename, undefined, folderId);

                if (newPaperId) {
                    toast.success('Paper created');
                    router.push(`/p/${newPaperId}`);
                }
            } catch (err) {
                console.error('Failed to create new paper:', err);
                toast.error('Failed to create new paper');
            }
        } catch (error) {
            console.error("Failed to create new paper:", error);
            toast.error("Failed to create new paper");
        }
    }, [currentFolderId]);

    // Provide upload handlers to parent component
    useEffect(() => {
        if (onUploadHandlersReady) {
            onUploadHandlersReady({
                handleFileUpload,
                handleFolderUpload
            });
        }
    }, [onUploadHandlersReady, handleFileUpload, handleFolderUpload]);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = event.target.files;
        if (selectedFiles && selectedFiles.length > 0) {
            await startUploads(Array.from(selectedFiles));
        }
        // Reset the input value so the same file can be selected again
        event.target.value = "";
    };

    const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = event.target.files;
        if (selectedFiles && selectedFiles.length > 0) {
            await startFolderUploads(selectedFiles);
        }
        // Reset the input value so the same folder can be selected again
        event.target.value = "";
    };

    const handleRenameClick = useCallback((itemId: string, itemName: string, itemType: "file" | "folder" | "paper") => {
        setSelectedItemForRename({ id: itemId, name: itemName, type: itemType });
        setRenameModalOpen(true);
    }, [setSelectedItemForRename, setRenameModalOpen]);




    const handleDetailsClick = useCallback(async (itemId: string, itemName: string, itemType: "file" | "folder" | "paper") => {
        try {
            let response;
            if (itemType === 'file') {
                response = await apiClient.getFileInfo(itemId);
            } else if (itemType === 'paper') {
                response = await apiClient.getPaper(itemId);
            } else {
                response = await apiClient.getFolderInfo(itemId);
            }

            if (response.success) {
                // console.log(`${itemType} details:`, response.data);
                // Here you would open a details modal with the information
                setSelectedItemForDetails({ id: itemId, name: itemName, type: itemType });
                setDetailsModalOpen(true);
            } else {
                toast.error(`Failed to load ${itemType} details`);
            }
        } catch (error) {
            console.error('Details error:', error);
            toast.error(`Failed to load ${itemType} details`);
        }
    }, [apiClient, toast, setSelectedItemForDetails, setDetailsModalOpen]);

    const handleMoveToFolderClick = (itemId: string, itemName: string, itemType: "file" | "folder" | "paper") => {
        setSelectedItemsForMoveToFolder([{ id: itemId, name: itemName, type: itemType }]);
        setMoveToFolderModalOpen(true);
    };

    const handleCopyClick = (itemId: string, itemName: string, itemType: "file" | "folder" | "paper") => {
        setSelectedItemsForCopy([{ id: itemId, name: itemName, type: itemType }]);
        setCopyModalOpen(true);
    };

    const handleMoveToTrashClick = async (itemId: string, itemName: string, itemType: "file" | "folder" | "paper") => {
        const itemToRestore = filesMap.get(itemId);

        try {
            let response;
            if (itemType === 'file') {
                response = await apiClient.moveFileToTrash(itemId);
            } else if (itemType === 'paper') {
                response = await apiClient.movePaperToTrash(itemId);
            } else {
                response = await apiClient.moveFolderToTrash(itemId);
            }

            if (response.success) {
                // Check if the current folder is being trashed - if so, navigate to parent
                if (itemType === 'folder' && itemId === currentFolderId) {
                    navigateToParent();
                }

                // Remove the item from the current view immediately
                setFiles(prevFiles => prevFiles.filter(file => file.id !== itemId));

                // Clear selection for this item
                setSelectedItems(prevSelected => {
                    const newSelected = new Set(prevSelected);
                    newSelected.delete(itemId);
                    return newSelected;
                });

                // Show toast with undo option
                toast(t("files.itemMovedToTrash"), {
                    action: {
                        label: t("files.cancel"),
                        onClick: async () => {
                            try {
                                let restoreResponse;
                                if (itemType === 'file') {
                                    restoreResponse = await apiClient.restoreFileFromTrash(itemId);
                                } else if (itemType === 'paper') {
                                    restoreResponse = await apiClient.restorePapersFromTrash([itemId]);
                                } else {
                                    restoreResponse = await apiClient.restoreFolderFromTrash(itemId);
                                }

                                if (restoreResponse.success) {
                                    toast.success(t("files.restored", { type: itemType }));
                                    if (itemToRestore) {
                                        notifyFileAdded(itemToRestore);
                                    } else {
                                        refreshFiles(); // Fallback
                                    }
                                } else {
                                    toast.error(t("files.restoreFailed", { type: itemType }));
                                    refreshFiles(); // Refresh anyway to show current state
                                }
                            } catch (err) {
                                console.error('Restore error:', err);
                                toast.error(t("files.restoreFailed", { type: itemType }));
                                refreshFiles(); // Refresh anyway to show current state
                            }
                        },
                    },
                });
            } else {
                toast.error(`Failed to move ${itemType} to trash`);
            }
        } catch (error) {
            console.error('Move to trash error:', error);
            toast.error(`Failed to move ${itemType} to trash`);
        }
    };

    // Bulk move to trash handler
    const handleBulkMoveToTrash = useCallback(async () => {
        const selectedItemsArray = Array.from(selectedItems).map(id => filesMap.get(id)).filter(Boolean) as FileItem[];

        if (selectedItemsArray.length === 0) return;

        try {
            // Prepare payload and validate types via helper
            let folderIds: string[] = [];
            let fileIds: string[] = [];
            let paperIds: string[] = [];

            try {
                const result = prepareMoveToTrashPayload(selectedItemsArray, filesMap);
                folderIds = result.folderIds;
                fileIds = result.fileIds;
                paperIds = result.paperIds;
            } catch (err: any) {
                console.warn('Move to trash aborted due to type mismatches', err);
                toast.error(t('files.moveToTrashTypeMismatch') || 'Some selected items have mismatched types. Please re-select items and try again.');
                return;
            }

            // Use unified bulk API for files, folders, and papers
            const response = await apiClient.moveToTrash(folderIds, fileIds, paperIds);

            if (response.success) {
                // Check if the current folder is being trashed - if so, navigate to parent
                if (folderIds.includes(currentFolderId)) {
                    navigateToParent();
                }

                // Remove successfully moved items from the current view
                setFiles(prevFiles => prevFiles.filter(file =>
                    !selectedItemsArray.some(selected => selected.id === file.id)
                ));

                // Clear selection for all items
                setSelectedItems(new Set());

                // Show success toast
                toast(t("files.itemsMovedToTrash", { count: selectedItemsArray.length }), {
                    action: {
                        label: t("files.cancel"),
                        onClick: async () => {
                            // Restore all moved items
                            if (fileIds.length > 0) {
                                await apiClient.restoreFilesFromTrash(fileIds);
                            }
                            if (folderIds.length > 0) {
                                await apiClient.restoreFoldersFromTrash(folderIds);
                            }
                            // Restore papers
                            if (paperIds && paperIds.length > 0) {
                                await apiClient.restorePapersFromTrash(paperIds);
                            }

                            // Optimistically add items back
                            if (selectedItemsArray.length > 0) {
                                selectedItemsArray.forEach(item => notifyFileAdded(item));
                            } else {
                                refreshFiles();
                            }
                        },
                    },
                });

                // No need to refreshFiles() here since we already did optimistic updates
            } else {
                toast.error(`Failed to move items to trash`);
            }
        } catch {
            // console.error('Bulk move to trash error:', error);
            toast.error(`Failed to move items to trash`);
        }
    }, [selectedItems, apiClient, setFiles, setSelectedItems, toast, refreshFiles, currentFolderId, navigateToParent, filesMap, notifyFileAdded, t]);

    // Bulk move handler
    const handleBulkMoveToFolderClick = useCallback(() => {
        const selectedItemsArray = Array.from(selectedItems).map(id => {
            const item = filesMap.get(id);
            return item ? { id: item.id, name: item.name, type: item.type } : null;
        }).filter(Boolean) as Array<{ id: string, name: string, type: FileItem['type'] }>;

        if (selectedItemsArray.length === 0) return;
        setSelectedItemsForMoveToFolder(selectedItemsArray as any);
        setMoveToFolderModalOpen(true);
    }, [selectedItems, filesMap]);

    // Bulk copy handler
    const handleBulkCopyClick = useCallback(() => {
        const selectedItemsArray = Array.from(selectedItems).map(id => {
            const item = filesMap.get(id);
            return item ? { id: item.id, name: item.name, type: item.type } : null;
        }).filter(Boolean) as Array<{ id: string, name: string, type: FileItem['type'] }>;

        if (selectedItemsArray.length === 0) return;
        setSelectedItemsForCopy(selectedItemsArray as any);
        setCopyModalOpen(true);
    }, [selectedItems, filesMap]);



    // Handle file download (single item or folder)
    const handleDownloadClick = async (itemId: string, itemName: string, itemType: FileItem['type']) => {
        if (itemType === 'folder') {
            // Download folder as ZIP
            await startFolderDownload(itemId, itemName);
        } else {
            // Download single file
            await startFileDownload(itemId, itemName);
        }
    };


    // Handle bulk download of selected items
    const handleBulkDownload = useCallback(async () => {
        const selectedItemsArray = Array.from(selectedItems).map(id => {
            const item = filesMap.get(id);
            return item ? { id: item.id, name: item.name, type: item.type } : null;
        }).filter(Boolean) as Array<{ id: string, name: string, type: FileItem['type'] }>;

        if (selectedItemsArray.length === 0) return;

        // If only one item is selected, handle single download rules
        if (selectedItemsArray.length === 1) {
            const only = selectedItemsArray[0];
            // Single paper cannot be downloaded
            if (only.type === 'paper') {
                return;
            }
            // Folder or file: download as usual
            await handleDownloadClick(only.id, only.name, only.type);
            return;
        }

        // Multiple items selected: allow including papers — papers will be exported as .url shortcuts inside the ZIP
        await startBulkDownload(selectedItemsArray as any);
    }, [selectedItems, handleDownloadClick, startBulkDownload, toast]);

    // Handle folder double-click navigation
    const handleFolderDoubleClick = async (folderId: string, folderName: string) => {
        await navigateToFolder(folderId, folderName);
    };

    // Context menu handlers
    const handleContextMenu = (e: React.MouseEvent, item?: FileItem) => {
        e.preventDefault();
        e.stopPropagation();

        // Single selection: clear all previous selections and select only the right-clicked item
        if (item) {
            setSelectedItems(new Set([item.id]));
        }

        // If context menu is already open, just update its position and target without closing/reopening
        if (contextMenu?.isOpen) {
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                isOpen: true,
                targetItem: item
            });
        } else {
            // Context menu is not open, open it normally
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                isOpen: true,
                targetItem: item
            });
        }
    };

    const handleContextMenuClose = () => {
        setContextMenu(null);
    };

    // Context menu action handlers
    const handleContextMenuAction = (action: string, item?: FileItem) => {
        if (!item) {
            // Empty space actions
            switch (action) {
                case 'createFolder':
                    // Trigger create folder modal
                    const createFolderButton = document.querySelector('[data-create-folder-trigger]') as HTMLElement;
                    if (createFolderButton) {
                        createFolderButton.click();
                    }
                    break;
                case 'importFile':
                    handleFileUpload();
                    break;
                case 'importFolder':
                    handleFolderUpload();
                    break;
            }
        } else {
            // Item actions
            switch (action) {
                case 'download':
                    if (item.type !== 'paper') {
                        handleDownloadClick(item.id, item.name, item.type as any);
                    }
                    break;
                case 'preview':
                    if (item.type === 'file') {
                        handlePreviewClick(item.id, item.name, item.mimeType);
                    } else if (item.type === 'paper') {
                        router.push(`/p/${item.id}`);
                    }
                    break;
                case 'copyLink':
                    // TODO: Implement copy link functionality
                    toast.info('Copy link functionality coming soon');
                    break;
                case 'preview':
                    if (item.type === 'file') {
                        handlePreviewClick(item.id, item.name, item.mimeType);
                    } else if (item.type === 'paper') {
                        router.push(`/p/${item.id}`);
                    }
                    break;

                case 'moveToFolder':
                    handleMoveToFolderClick(item.id, item.name, item.type as any);
                    break;
                case 'copy':
                    handleCopyClick(item.id, item.name, item.type as any);
                    break;
                case 'rename':
                    handleRenameClick(item.id, item.name, item.type as any);
                    break;
                case 'details':
                    handleDetailsClick(item.id, item.name, item.type as any);
                    break;
                case 'lock':
                    handleLockClick(item.id, item.name, item.type as any);
                    break;
                case 'moveToTrash':
                    handleMoveToTrashClick(item.id, item.name, item.type as any);
                    break;
            }
        }
        handleContextMenuClose();
    };

    const handleInlineRenameSubmit = async (item: FileItem) => {
        const newName = inlineRenameValue.trim();

        // If unchanged or empty, cancel without API call
        if (!newName || newName === item.name) {
            setInlineRenameId(null);
            setIsInlineRenaming(false);
            return;
        }

        setIsInlineRenaming(true);
        try {
            // Paper handling
            if (item.type === 'paper') {
                if (!masterKeyManager.hasMasterKey()) {
                    throw new Error("Session expired");
                }
                await paperService.savePaper(item.id, undefined, newName);

                // Optimistic update
                setFiles(prev => prev.map(f => f.id === item.id ? { ...f, name: newName } : f));
                setInlineRenameId(null);
                setIsInlineRenaming(false);
                return;
            }

            const response = await apiClient.getProfile();
            if (!response.success || !response.data?.user?.crypto_keypairs) {
                throw new Error("Failed to load crypto keys");
            }
            const userData = response.data.user;

            if (!masterKeyManager.hasMasterKey()) {
                throw new Error("Session expired");
            }

            const privateKeys = await decryptUserPrivateKeys(userData as unknown as UserData);

            let signedManifest;
            if (item.type === 'folder') {
                signedManifest = await createSignedFolderManifest(newName, null, {
                    ed25519PrivateKey: privateKeys.ed25519PrivateKey,
                    ed25519PublicKey: privateKeys.ed25519PublicKey,
                    dilithiumPrivateKey: privateKeys.dilithiumPrivateKey,
                    dilithiumPublicKey: privateKeys.dilithiumPublicKey
                });
            } else {
                signedManifest = await createSignedFileManifest(newName, null, {
                    ed25519PrivateKey: privateKeys.ed25519PrivateKey,
                    ed25519PublicKey: privateKeys.ed25519PublicKey,
                    dilithiumPrivateKey: privateKeys.dilithiumPrivateKey,
                    dilithiumPublicKey: privateKeys.dilithiumPublicKey
                });
            }

            // Pass the item directly since state update might be too slow
            await handleRename({ ...signedManifest, requestedName: newName }, item as any);
        } catch (error) {
            console.error('Inline rename error:', error);
            toast.error("Failed to rename item");
        } finally {
            // Only clear if we are still targeting this item (avoid race conditions)
            setInlineRenameId(prev => prev === item.id ? null : prev);
            setIsInlineRenaming(false);
        }
    };

    const handleRename = async (data: string | ({
        manifestHash: string;
        manifestCreatedAt: number;
        manifestSignatureEd25519: string;
        manifestPublicKeyEd25519: string;
        manifestSignatureDilithium: string;
        manifestPublicKeyDilithium: string;
        algorithmVersion: string;
        nameHmac: string;
        encryptedFilename?: string;
        filenameSalt?: string;
        encryptedName?: string;
        nameSalt?: string;
        requestedName?: string;
    }), targetItemArg?: { id: string, name: string, type: FileItem['type'] } | null) => {
        const targetItem = targetItemArg || selectedItemForRename;
        if (!targetItem) return;

        try {
            let response;
            if (typeof data === 'string') {
                throw new Error('Expected manifest object for rename');
            }

            // Check if this is a file manifest (has encryptedFilename) or folder manifest (has encryptedName)
            if ('encryptedFilename' in data && data.encryptedFilename) {
                // File manifest
                response = await apiClient.renameFile(targetItem.id, data as unknown as {
                    encryptedFilename: string;
                    filenameSalt: string;
                    manifestHash: string;
                    manifestCreatedAt: number;
                    manifestSignatureEd25519: string;
                    manifestPublicKeyEd25519: string;
                    manifestSignatureDilithium: string;
                    manifestPublicKeyDilithium: string;
                    algorithmVersion: string;
                    nameHmac: string;
                });
            } else if ('encryptedName' in data && data.encryptedName) {
                // Folder manifest
                response = await apiClient.renameFolder(targetItem.id, data as unknown as {
                    encryptedName: string;
                    nameSalt: string;
                    manifestHash: string;
                    manifestCreatedAt: number;
                    manifestSignatureEd25519: string;
                    manifestPublicKeyEd25519: string;
                    manifestSignatureDilithium: string;
                    manifestPublicKeyDilithium: string;
                    algorithmVersion?: string;
                    nameHmac: string;
                });
            } else {
                throw new Error('Invalid manifest data: missing encrypted name fields');
            }

            if (response.success) {
                // Optimistic update
                if (typeof data !== 'string' && data.requestedName) {
                    const newName = data.requestedName;


                    setFiles(prev => prev.map(f => f.id === targetItem.id ? { ...f, name: newName } : f));
                    if (targetItemArg) {
                        // Was inline rename
                        toast.success(`Renamed to ${newName}`);
                    } else {
                        // Was modal rename
                        toast.success(`${targetItem.type} renamed successfully`);
                    }
                } else {
                    toast.success("Renamed successfully");
                    refreshFiles(); // Fallback if name unknown
                }

                setRenameModalOpen(false);
                setSelectedItemForRename(null);
            } else {
                // Check if this is a 409 conflict error
                const isConflict = response.error?.toLowerCase().includes('409') ||
                    response.error?.toLowerCase().includes('conflict') ||
                    response.error?.toLowerCase().includes('already exists');

                if (isConflict) {
                    // If it's a folder rename conflict, show conflict modal with details
                    if (targetItem.type === 'folder') {
                        const requestedName = data?.requestedName || '';
                        // Try to locate the existing folder in the current listing
                        const existingFolder = files.find(f => f.type === 'folder' && f.name === requestedName);

                        const conflictItem = {
                            id: targetItem.id,
                            name: requestedName,
                            type: 'folder' as const,
                            existingPath: existingFolder?.path || '',
                            newPath: '',
                            existingItem: existingFolder,
                            existingFileId: existingFolder?.id,
                        };

                        setPendingRenameManifest(data);
                        setRenameConflictItems([conflictItem]);
                        setRenameConflictOpen(true);
                        // Keep rename modal open so user can adjust if they chose to ignore
                    } else {
                        // For files keep the current behavior
                        toast.error('A file or folder with this name already exists');
                    }
                } else {
                    toast.error(`Failed to rename ${targetItem.type}`);
                    setRenameModalOpen(false);
                    setSelectedItemForRename(null);
                }
            }
        } catch (error) {
            console.error('Rename error:', error);
            toast.error(`Failed to rename ${targetItem.type}`);
            setRenameModalOpen(false);
            setSelectedItemForRename(null);
        }
    };

    // Handle rename conflict resolutions
    const handleRenameConflictResolution = async (resolutions: Record<string, 'replace' | 'keepBoth' | 'ignore'>) => {
        for (const [itemId, resolution] of Object.entries(resolutions)) {
            const conflict = renameConflictItems.find(c => c.id === itemId);
            if (!conflict) continue;

            if (resolution === 'replace') {
                if (!conflict.existingFileId) {
                    toast.error('Failed to locate existing folder to replace');
                    continue;
                }

                // Delete existing folder (soft delete)
                const delResp = await apiClient.deleteFolder(conflict.existingFileId);
                if (!delResp.success) {
                    toast.error(delResp.error || 'Failed to delete existing folder');
                    continue;
                }

                // Retry rename using pending manifest
                if (!pendingRenameManifest) {
                    toast.error('Pending rename data not available');
                    continue;
                }

                const response = await apiClient.renameFolder(conflict.id, pendingRenameManifest as {
                    encryptedName: string;
                    nameSalt: string;
                    manifestHash: string;
                    manifestCreatedAt: number;
                    manifestSignatureEd25519: string;
                    manifestPublicKeyEd25519: string;
                    manifestSignatureDilithium: string;
                    manifestPublicKeyDilithium: string;
                    algorithmVersion: string;
                    nameHmac: string;
                });
                if (response.success) {
                    toast.success('Folder renamed successfully');
                    // Close modals and refresh
                    setRenameConflictOpen(false);
                    setRenameModalOpen(false);
                    setSelectedItemForRename(null);
                    refreshFiles();
                } else {
                    toast.error(response.error || 'Failed to rename folder after replacing existing one');
                }
            } else if (resolution === 'keepBoth') {
                // Suggest a unique name and reopen rename modal pre-filled with it
                const base = conflict.name;
                let idx = 1;
                const exists = (name: string) => files.some(f => f.type === 'folder' && f.name === name);
                let suggested = `${base} (${idx})`;
                while (exists(suggested)) {
                    idx += 1;
                    suggested = `${base} (${idx})`;
                }

                setRenameConflictOpen(false);
                setRenameModalOpen(true);
                setRenameModalInitialName(suggested);
            } else if (resolution === 'ignore') {
                // Just close conflict modal and leave rename modal open for user to try a different name
                setRenameConflictOpen(false);
            }
        }

        // Clear pending state
        setPendingRenameManifest(null);
        setRenameConflictItems([]);
    };

    // Format file size
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };


    // Get file icon based on mime type or type
    const [sortedItems, setSortedItems] = useState<ComputedFileItem[]>([]);

    // Sort items using web worker when files or sort descriptor changes
    useEffect(() => {
        const performSort = async () => {
            if (files.length === 0) {
                setSortedItems([]);
                return;
            }

            try {
                // First separate folders from files (this is fast and doesn't need worker)
                const folders = files.filter(item => item.type === 'folder');
                const fileItems = files.filter(item => item.type !== 'folder');

                // Sort folders and files separately, then combine
                const sortedFolders = folders.length > 0 ? await sortItems(folders, {
                    sortBy: sortDescriptor.column as string,
                    direction: sortDescriptor.direction === 'descending' ? 'desc' : 'asc',
                    type: getSortType(sortDescriptor.column as string)
                }) : [];

                const sortedFiles = fileItems.length > 0 ? await sortItems(fileItems, {
                    sortBy: sortDescriptor.column as string,
                    direction: sortDescriptor.direction === 'descending' ? 'desc' : 'asc',
                    type: getSortType(sortDescriptor.column as string)
                }) : [];

                setSortedItems([...sortedFolders, ...sortedFiles]);
            } catch (error) {
                console.error('Sorting failed:', error);
                // Fallback to synchronous sort
                const sorted = [...files].sort((a, b) => {
                    const aIsFolder = a.type === 'folder';
                    const bIsFolder = b.type === 'folder';
                    if (aIsFolder && !bIsFolder) return -1;
                    if (!aIsFolder && bIsFolder) return 1;

                    if (sortDescriptor.column === 'modified') {
                        const firstDate = new Date(a.updatedAt || a.createdAt).getTime();
                        const secondDate = new Date(b.updatedAt || b.createdAt).getTime();
                        return sortDescriptor.direction === "descending" ? secondDate - firstDate : firstDate - secondDate;
                    }
                    if (sortDescriptor.column === 'size') {
                        const aSize = a.size || 0;
                        const bSize = b.size || 0;
                        return sortDescriptor.direction === "descending" ? bSize - aSize : aSize - bSize;
                    }
                    if (sortDescriptor.column === 'name') {
                        const firstName = a.name || '';
                        const secondName = b.name || '';
                        let cmp = firstName.localeCompare(secondName);
                        if (sortDescriptor.direction === "descending") cmp *= -1;
                        return cmp;
                    }
                    return 0;
                });
                setSortedItems(sorted);
            }
        };

        performSort();
    }, [files, sortDescriptor, sortItems]);

    // Helper function to map sort column to worker type
    const getSortType = (column: string): 'name' | 'date' | 'size' | 'type' => {
        switch (column) {
            case 'modified': return 'date';
            case 'size': return 'size';
            case 'name': return 'name';
            default: return 'name';
        }
    };

    // Filter items based on search query
    const deferredQuery = React.useDeferredValue(searchQuery);
    const filteredItems = useMemo(() => {
        if (!deferredQuery || deferredQuery.trim() === '') {
            return sortedItems;
        }

        const query = deferredQuery.toLowerCase().trim();

        // Tag search (#tag)
        if (query.startsWith('#')) {

            const tagQuery = query.substring(1).trim();
            // console.log(`[TagSearch] Query: "${tagQuery}"`); 
            if (!tagQuery) return sortedItems;

            return sortedItems.filter(item => {
                // Check tags
                const hasMatchingTag = item.tags?.some((tag: Tag) => {
                    const decryptedName = (tag.decryptedName || "").toLowerCase();
                    // const encryptedName = (tag.encrypted_name || tag.encryptedName || "").toLowerCase();
                    // console.log(`[TagSearch] Checking item "${item.name}" tag: decrypted="${decryptedName}", encrypted="${encryptedName}" vs query="${tagQuery}"`);
                    return decryptedName.includes(tagQuery);
                });

                return hasMatchingTag;
            });
        }

        return sortedItems.filter(item =>
            item.name.toLowerCase().includes(query)
        );
    }, [sortedItems, deferredQuery]);

    // Preview navigation logic
    const getPreviewableFiles = useCallback(() => {
        return filteredItems.filter(item => item.type === 'file');
    }, [filteredItems]);

    const handlePreviewNavigate = useCallback((direction: 'prev' | 'next') => {
        if (!selectedItemForPreview) return;

        const previewableFiles = getPreviewableFiles();
        const currentIndex = previewableFiles.findIndex(item => item.id === selectedItemForPreview.id);

        if (currentIndex === -1) return;

        const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        // Ensure bounds
        if (newIndex >= 0 && newIndex < previewableFiles.length) {
            const newItem = previewableFiles[newIndex];
            // Update URL instead of local state
            const params = new URLSearchParams(searchParams.toString());
            params.set('preview', newItem.id);
            router.push(`${pathname}?${params.toString()}`, { scroll: false });
        }
    }, [selectedItemForPreview, getPreviewableFiles, pathname, router, searchParams]);

    // Calculate if we have next/prev items
    const previewNavigationState = useMemo(() => {
        if (!selectedItemForPreview) return { hasPrev: false, hasNext: false };
        const previewableFiles = getPreviewableFiles();
        const currentIndex = previewableFiles.findIndex(item => item.id === selectedItemForPreview.id);

        if (currentIndex === -1) return { hasPrev: false, hasNext: false };

        return {
            hasPrev: currentIndex > 0,
            hasNext: currentIndex < previewableFiles.length - 1
        };
    }, [selectedItemForPreview, getPreviewableFiles]);

    const { openPicker: openGooglePicker, isReady: isGoogleReady } = useGoogleDrive();

    const emptyState = (
        <EmptyState
            title={
                filterMode === 'recents' ? "No recent files" :
                    isInitialLoad ? "Loading..." :
                        searchQuery ? "No results found" :
                            "No files found"
            }
            description={
                filterMode === 'recents' ? "Files you've edited recently will appear here" :
                    "Get started by adding content."
            }
            onCreateFolder={() => setCreateFolderOpen(true)}
            onCreatePaper={handleCreatePaper}
            onUploadFile={handleFileUpload}
            onImportFromGoogle={() => {
                if (isGoogleReady) openGooglePicker();
                else toast('Google Drive integration is not configured or still loading');
            }}
        />
    );

    const handleCopyConflict = (items: Array<{ id: string; name: string; type: "file" | "folder"; conflictingItemId?: string }>, destinationFolderId: string | null) => {
        setCopyConflictItems(items.map(item => ({
            ...item,
            // ConflictModal expects existingPath/newPath but they are not strictly used for Copy UI display usually
            // We provide dummy values to satisfy the interface if strict
            existingPath: 'Destination',
            newPath: 'Destination'
        })));
        setCopyDestinationFolderId(destinationFolderId);
        setCopyConflictOpen(true);
    };

    const handleCopyConflictResolution = async (resolutions: Record<string, 'replace' | 'keepBoth' | 'ignore'>) => {
        let successCount = 0;
        let failCount = 0;
        const promises = copyConflictItems.map(async (item) => {
            const resolution = resolutions[item.id];
            if (!resolution || resolution === 'ignore') return;

            try {
                if (resolution === 'replace') {
                    // 1. Delete the conflicting item first
                    if (item.conflictingItemId) {
                        // Use moveFileToTrash as a safe delete (name is freed from active folder)
                        const delRes = item.type === 'file'
                            ? await apiClient.moveFileToTrash(item.conflictingItemId)
                            : await apiClient.moveFolderToTrash(item.conflictingItemId);

                        if (!delRes.success) {
                            console.error('Failed to remove conflicting item', delRes);
                            failCount++;
                            return;
                        }
                    } else {
                        failCount++;
                        return;
                    }

                    // 2. Retry Copy (Replace)
                    const masterKey = masterKeyManager.getMasterKey();
                    if (!masterKey) {
                        toast.error('Encryption key missing');
                        failCount++;
                        return;
                    }
                    const nameHmac = await computeFilenameHmac(item.name, copyDestinationFolderId);

                    // Sign manifest for the ORIGINAL name
                    let signedManifest;
                    if (userData && masterKeyManager.hasMasterKey()) {
                        const privateKeys = await decryptUserPrivateKeys(userData);
                        if (item.type === 'file') {
                            signedManifest = await createSignedFileManifest(
                                item.name,
                                copyDestinationFolderId,
                                {
                                    ed25519PrivateKey: privateKeys.ed25519PrivateKey,
                                    ed25519PublicKey: privateKeys.ed25519PublicKey,
                                    dilithiumPrivateKey: privateKeys.dilithiumPrivateKey,
                                    dilithiumPublicKey: privateKeys.dilithiumPublicKey
                                }
                            );
                        } else {
                            // Sign folder manifest
                            signedManifest = await createSignedFolderManifest(
                                item.name,
                                copyDestinationFolderId,
                                {
                                    ed25519PrivateKey: privateKeys.ed25519PrivateKey,
                                    ed25519PublicKey: privateKeys.ed25519PublicKey,
                                    dilithiumPrivateKey: privateKeys.dilithiumPrivateKey,
                                    dilithiumPublicKey: privateKeys.dilithiumPublicKey
                                }
                            );
                        }
                    }

                    const res = item.type === 'file'
                        ? await apiClient.copyFile(item.id, copyDestinationFolderId, {
                            nameHmac,
                            ...(signedManifest ? {
                                manifestHash: signedManifest.manifestHash,
                                manifestSignatureEd25519: signedManifest.manifestSignatureEd25519,
                                manifestPublicKeyEd25519: signedManifest.manifestPublicKeyEd25519,
                                manifestSignatureDilithium: signedManifest.manifestSignatureDilithium,
                                manifestPublicKeyDilithium: signedManifest.manifestPublicKeyDilithium,
                                manifestCreatedAt: signedManifest.manifestCreatedAt,
                                algorithmVersion: signedManifest.algorithmVersion
                            } : {})
                        })
                        : await apiClient.copyFolder(item.id, copyDestinationFolderId, {
                            nameHmac,
                            ...(signedManifest ? {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                encryptedName: (signedManifest as any).encryptedName,
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                nameSalt: (signedManifest as any).nameSalt,
                                manifestHash: signedManifest.manifestHash,
                                manifestSignatureEd25519: signedManifest.manifestSignatureEd25519,
                                manifestPublicKeyEd25519: signedManifest.manifestPublicKeyEd25519,
                                manifestSignatureDilithium: signedManifest.manifestSignatureDilithium,
                                manifestPublicKeyDilithium: signedManifest.manifestPublicKeyDilithium,
                                manifestCreatedAt: signedManifest.manifestCreatedAt,
                                algorithmVersion: signedManifest.algorithmVersion
                            } : {})
                        });

                    if (res.success) successCount++; else failCount++;

                } else if (resolution === 'keepBoth') {
                    // 1. Generate new name: "Name (Copy)" 
                    const nameParts = item.name.lastIndexOf('.');
                    let newName = item.name + ' (Copy)';
                    if (item.type === 'file' && nameParts !== -1) {
                        // Insert before extension
                        newName = item.name.substring(0, nameParts) + ' (Copy)' + item.name.substring(nameParts);
                    }
                    if (item.type === 'folder') {
                        newName = item.name + ' (Copy)';
                    }

                    // 2. Encrypt new name
                    const masterKey = masterKeyManager.getMasterKey();
                    if (!masterKey) {
                        toast.error('Encryption key missing');
                        failCount++;
                        return;
                    }

                    const { encryptedFilename, filenameSalt } = await encryptFilename(newName, masterKey);

                    const nameHmac = await computeFilenameHmac(newName, copyDestinationFolderId);

                    // Sign manifest for the NEW name
                    let signedManifest;
                    if (userData && masterKeyManager.hasMasterKey()) {
                        const privateKeys = await decryptUserPrivateKeys(userData);
                        if (item.type === 'file') {
                            signedManifest = await createSignedFileManifest(
                                newName,
                                copyDestinationFolderId,
                                {
                                    ed25519PrivateKey: privateKeys.ed25519PrivateKey,
                                    ed25519PublicKey: privateKeys.ed25519PublicKey,
                                    dilithiumPrivateKey: privateKeys.dilithiumPrivateKey,
                                    dilithiumPublicKey: privateKeys.dilithiumPublicKey
                                }
                            );
                        } else {
                            // Sign folder manifest
                            signedManifest = await createSignedFolderManifest(
                                newName,
                                copyDestinationFolderId,
                                {
                                    ed25519PrivateKey: privateKeys.ed25519PrivateKey,
                                    ed25519PublicKey: privateKeys.ed25519PublicKey,
                                    dilithiumPrivateKey: privateKeys.dilithiumPrivateKey,
                                    dilithiumPublicKey: privateKeys.dilithiumPublicKey
                                }
                            );
                        }
                    }

                    let res;
                    if (item.type === 'file') {
                        res = await apiClient.copyFile(item.id, copyDestinationFolderId, {
                            filename: newName,
                            encryptedFilename: encryptedFilename,
                            filenameSalt: filenameSalt,
                            nameHmac,
                            ...(signedManifest ? {
                                manifestHash: signedManifest.manifestHash,
                                manifestSignatureEd25519: signedManifest.manifestSignatureEd25519,
                                manifestPublicKeyEd25519: signedManifest.manifestPublicKeyEd25519,
                                manifestSignatureDilithium: signedManifest.manifestSignatureDilithium,
                                manifestPublicKeyDilithium: signedManifest.manifestPublicKeyDilithium,
                                manifestCreatedAt: signedManifest.manifestCreatedAt,
                                algorithmVersion: signedManifest.algorithmVersion
                            } : {})
                        });
                    } else {
                        res = await apiClient.copyFolder(item.id, copyDestinationFolderId, {
                            encryptedName: encryptedFilename,
                            nameSalt: filenameSalt,
                            nameHmac,
                            ...(signedManifest ? {
                                manifestHash: signedManifest.manifestHash,
                                manifestSignatureEd25519: signedManifest.manifestSignatureEd25519,
                                manifestPublicKeyEd25519: signedManifest.manifestPublicKeyEd25519,
                                manifestSignatureDilithium: signedManifest.manifestSignatureDilithium,
                                manifestPublicKeyDilithium: signedManifest.manifestPublicKeyDilithium,
                                manifestCreatedAt: signedManifest.manifestCreatedAt,
                                algorithmVersion: signedManifest.algorithmVersion
                            } : {})
                        });
                    }

                    if (res.success) successCount++; else failCount++;
                }
            } catch (err) {
                console.error('Error resolving conflict', err);
                failCount++;
            }
        });

        await Promise.all(promises);

        if (successCount > 0) {
            toast.success(`Resolved ${successCount} conflicts`);
            refreshFiles();
        }
        if (failCount > 0) {
            toast.error(`Failed to resolve ${failCount} conflicts`);
        }
        setCopyConflictOpen(false);
        setCopyConflictItems([]);
    };
    const renderBreadcrumbs = useCallback(() => {
        return (
            <Breadcrumb className="flex-1 min-w-0">
                <BreadcrumbList className="flex-nowrap overflow-x-auto pb-0 gap-0.5 sm:gap-1 no-scrollbar duration-300">
                    {folderPath.map((folder, index) => {
                        const isLast = index === folderPath.length - 1;
                        const label = folder.name;

                        return (
                            <React.Fragment key={folder.id}>
                                <BreadcrumbItem className="min-w-0 flex-shrink-0">
                                    {isLast ? (
                                        <BreadcrumbPage className="truncate font-semibold text-foreground max-w-[120px] md:max-w-[250px] text-sm md:text-sm">
                                            {truncateBreadcrumbName(label)}
                                        </BreadcrumbPage>
                                    ) : (
                                        <BreadcrumbLink
                                            className="cursor-pointer truncate max-w-[100px] md:max-w-[150px] text-sm md:text-sm hover:text-foreground transition-colors"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                navigateToPath(folder.id);
                                            }}
                                        >
                                            {truncateBreadcrumbName(label)}
                                        </BreadcrumbLink>
                                    )}
                                </BreadcrumbItem>
                                {!isLast && (
                                    <BreadcrumbSeparator className="flex-shrink-0">
                                        <IconChevronRight className="h-3.5 w-3.5 opacity-50" />
                                    </BreadcrumbSeparator>
                                )}
                            </React.Fragment>
                        );
                    })}
                </BreadcrumbList>
            </Breadcrumb>
        );
    }, [folderPath, navigateToPath, truncateBreadcrumbName]);

    const renderLoadingIcons = useMemo(() => {
        return (
            <div className="flex items-center gap-1 opacity-50 pointer-events-none">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                    <IconFolderPlus className="h-3.5 w-3.5" />
                </Button>
                <div className="h-5 w-px bg-border mx-1" />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                    <IconFolderDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                    <IconFileUpload className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                    <IconListDetails className="h-3.5 w-3.5" />
                </Button>
            </div>
        );
    }, []);

    const renderHeaderIcons = useMemo(() => {
        const hasSelection = selectedItems.size > 0;
        const selectedCount = selectedItems.size;
        const hasMultipleSelection = selectedCount > 1;
        const selectedHasPaper = Array.from(selectedItems).some(id => filesMap.get(id)?.type === 'paper');

        const customizeColumnsDropdown = !isMobile && viewMode === 'table' ? (
            <>
                <div className="h-5 w-px bg-border mx-1" />
                <DropdownMenu>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Customize columns">
                                    <IconLayoutColumns className="h-3.5 w-3.5" />
                                </Button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Customize columns</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuCheckboxItem
                            checked={visibleColumns.has('modified')}
                            onCheckedChange={(checked) => {
                                setVisibleColumns(prev => {
                                    const next = new Set(prev);
                                    if (checked) next.add('modified');
                                    else next.delete('modified');
                                    return next;
                                });
                            }}
                        >
                            Modified
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={visibleColumns.has('size')}
                            onCheckedChange={(checked) => {
                                setVisibleColumns(prev => {
                                    const next = new Set(prev);
                                    if (checked) next.add('size');
                                    else next.delete('size');
                                    return next;
                                });
                            }}
                        >
                            Size
                        </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </>
        ) : null;

        if (!hasSelection) {
            // Default state - no selection
            return (
                <>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                aria-label={t("files.newFolder")}
                                data-create-folder-trigger
                                onClick={() => setCreateFolderOpen(true)}
                            >
                                <IconFolderPlus className="h-3.5 w-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("files.newFolder")}</TooltipContent>
                    </Tooltip>
                    <div className="h-5 w-px bg-border mx-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={handleFolderUpload}
                                aria-label={t("files.uploadFolder")}
                            >
                                <IconFolderDown className="h-3.5 w-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("files.uploadFolder")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={handleFileUpload}
                                aria-label={t("files.uploadFile")}
                            >
                                <IconFileUpload className="h-3.5 w-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("files.uploadFile")}</TooltipContent>
                    </Tooltip>
                    <div className="h-5 w-px bg-border mx-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => handleCreatePaper()}
                                aria-label={t("files.newPaper") || "New Paper"}
                            >
                                <IconFileText className="h-3.5 w-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("files.newPaper") || "New Paper"}</TooltipContent>
                    </Tooltip>
                    <div className="h-5 w-px bg-border mx-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => handleViewModeChange(viewMode === 'table' ? 'grid' : 'table')}
                                aria-label={viewMode === 'table' ? 'Switch to grid view' : 'Switch to table view'}
                            >
                                {viewMode === 'table' ? <IconGrid3x3 className="h-3.5 w-3.5" /> : <IconListDetails className="h-3.5 w-3.5" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{viewMode === 'table' ? 'Switch to grid view' : 'Switch to table view'}</TooltipContent>
                    </Tooltip>
                    {customizeColumnsDropdown}
                </>
            );
        } else {
            // Selected items state
            return (
                <>
                    {(selectedCount > 1 || !selectedHasPaper) && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={handleBulkDownload}
                                    aria-label={`Download ${selectedCount} item${selectedCount > 1 ? 's' : ''}`}
                                >
                                    <IconDownload className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{`Download ${selectedCount} item${selectedCount > 1 ? 's' : ''}`}</TooltipContent>
                        </Tooltip>
                    )}
                    {selectedCount === 1 && (() => {
                        const firstItemId = Array.from(selectedItems)[0];
                        const firstItem = filesMap.get(firstItemId);
                        return firstItem?.type === 'file' ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
                                        onClick={() => handlePreviewClick(firstItem.id, firstItem.name, firstItem.mimeType)}
                                        aria-label="Preview file"
                                    >
                                        <IconEye className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Preview file</TooltipContent>
                            </Tooltip>
                        ) : null;
                    })()}
                    {/* Move to folder */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={Array.from(selectedItems).some(id => {
                                    const item = filesMap.get(id);
                                    return item?.lockedUntil && new Date(item.lockedUntil) > new Date();
                                })}
                                onClick={() => {
                                    // Handle bulk move to folder
                                    const selectedItemsArray = Array.from(selectedItems).map(id => {
                                        const item = filesMap.get(id);
                                        return item ? { id: item.id, name: item.name, type: item.type } : null;
                                    }).filter(Boolean) as Array<{ id: string, name: string, type: "file" | "folder" }>;

                                    if (selectedItemsArray.length > 0) {
                                        setSelectedItemsForMoveToFolder(selectedItemsArray);
                                        setMoveToFolderModalOpen(true);
                                    }
                                }}
                                aria-label={Array.from(selectedItems).some(id => {
                                    const item = filesMap.get(id);
                                    return item?.lockedUntil && new Date(item.lockedUntil) > new Date();
                                }) ? "Some items are locked and cannot be moved" : "Move to folder"}
                            >
                                <IconFolder className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{Array.from(selectedItems).some(id => {
                            const item = filesMap.get(id);
                            return item?.lockedUntil && new Date(item.lockedUntil) > new Date();
                        }) ? "Some items are locked and cannot be moved" : "Move to folder"}</TooltipContent>
                    </Tooltip>

                    {/* Rename */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={hasMultipleSelection || (() => {
                                    const firstItemId = Array.from(selectedItems)[0];
                                    const firstItem = filesMap.get(firstItemId);
                                    return !!(firstItem?.lockedUntil && new Date(firstItem.lockedUntil) > new Date());
                                })()}
                                onClick={() => {
                                    if (!hasMultipleSelection) {
                                        const firstItemId = Array.from(selectedItems)[0];
                                        const firstItem = filesMap.get(firstItemId);
                                        if (firstItem) {
                                            handleRenameClick(firstItem.id, firstItem.name, firstItem.type as any);
                                        }
                                    }
                                }}
                                aria-label={hasMultipleSelection ? "Rename not available for multiple items" : (
                                    (() => {
                                        const firstItemId = Array.from(selectedItems)[0];
                                        const firstItem = filesMap.get(firstItemId);
                                        return firstItem?.lockedUntil && new Date(firstItem.lockedUntil) > new Date() ? "Item is locked" : "Rename";
                                    })()
                                )}
                            >
                                <IconEdit className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{hasMultipleSelection ? "Rename not available for multiple items" : (
                            (() => {
                                const firstItemId = Array.from(selectedItems)[0];
                                const firstItem = filesMap.get(firstItemId);
                                return firstItem?.lockedUntil && new Date(firstItem.lockedUntil) > new Date() ? "Item is locked" : "Rename";
                            })()
                        )}</TooltipContent>
                    </Tooltip>

                    {/* Details */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={hasMultipleSelection}
                                onClick={() => {
                                    if (!hasMultipleSelection) {
                                        const firstItemId = Array.from(selectedItems)[0];
                                        const firstItem = filesMap.get(firstItemId);
                                        if (firstItem) {
                                            handleDetailsClick(firstItem.id, firstItem.name, firstItem.type as any);
                                        }
                                    }
                                }}
                                aria-label={hasMultipleSelection ? "Details not available for multiple items" : "Details"}
                            >
                                <IconInfoCircle className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{hasMultipleSelection ? "Details not available for multiple items" : "Details"}</TooltipContent>
                    </Tooltip>

                    {/* Retention Policy - Only for single selection */}
                    {selectedCount === 1 && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={() => {
                                        const firstItemId = Array.from(selectedItems)[0];
                                        const firstItem = filesMap.get(firstItemId);
                                        if (firstItem) {
                                            handleLockClick(firstItem.id, firstItem.name, firstItem.type);
                                        }
                                    }}
                                    aria-label="Retention policy"
                                >
                                    <IconLock className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Retention policy</TooltipContent>
                        </Tooltip>
                    )}

                    <div className="h-5 w-px bg-border mx-1" />

                    {/* Move to trash */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                                disabled={Array.from(selectedItems).some(id => {
                                    const item = filesMap.get(id);
                                    return item?.lockedUntil && new Date(item.lockedUntil) > new Date();
                                })}
                                onClick={handleBulkMoveToTrash}
                                aria-label={Array.from(selectedItems).some(id => {
                                    const item = filesMap.get(id);
                                    return item?.lockedUntil && new Date(item.lockedUntil) > new Date();
                                }) ? "Some items are locked and cannot be deleted" : "Move to trash"}
                            >
                                <IconTrash className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{Array.from(selectedItems).some(id => {
                            const item = filesMap.get(id);
                            return item?.lockedUntil && new Date(item.lockedUntil) > new Date();
                        }) ? "Some items are locked and cannot be deleted" : "Move to trash"}</TooltipContent>
                    </Tooltip>
                    <div className="h-5 w-px bg-border mx-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => handleViewModeChange(viewMode === 'table' ? 'grid' : 'table')}
                                aria-label={viewMode === 'table' ? 'Switch to grid view' : 'Switch to table view'}
                            >
                                <IconListDetails className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{viewMode === 'table' ? 'Switch to grid view' : 'Switch to table view'}</TooltipContent>
                    </Tooltip>
                    {customizeColumnsDropdown}
                </>
            );
        }
    }, [selectedItems, filesMap, viewMode, currentFolderId, refreshFiles, handleFolderUpload, handleFileUpload, handleBulkDownload, handlePreviewClick, handleBulkMoveToTrash, handleViewModeChange, handleRenameClick, handleDetailsClick, setSelectedItemsForMoveToFolder, setMoveToFolderModalOpen, visibleColumns, isMobile, notifyFileAdded]);

    // Memoize the onSelectionChange callback to prevent unnecessary re-renders
    const handleTableSelectionChange = useCallback((keys: Selection) => {
        if (keys === 'all') {
            const allIds = filteredItems.map(item => item.id);
            setSelectedItems(prev => {
                // If nothing is selected, select all. If any items are selected (partial or all), clear selection.
                if (prev.size === 0) {
                    return new Set(allIds); // Select all visible rows
                }
                return new Set(); // Clear selection when any items are selected (including indeterminate)
            });
        } else {
            const newKeys = Array.from(keys as Set<string>);
            setSelectedItems(prev => {
                if (prev.size === newKeys.length && newKeys.every(id => prev.has(id))) {
                    return prev; // No change needed
                }
                return new Set(newKeys);
            });
        }
    }, [filteredItems]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle shortcuts when not typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            // Prevent background actions if any modal/dialog is open
            if (document.querySelector('[role="dialog"]') || document.querySelector('.radix-dialog-content')) {
                return;
            }

            // Select all (Ctrl+A)
            if (e.ctrlKey && e.key === 'a' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                setSelectedItems(new Set(filteredItems.map(item => item.id)));
                return;
            }

            // Clear selection (Escape)
            if (e.key === 'Escape') {
                setSelectedItems(new Set());
                return;
            }

            // Preview selected file (Space or Enter)
            if ((e.key === ' ' || e.key === 'Enter') && selectedItems.size === 1) {
                e.preventDefault();
                const firstItemId = Array.from(selectedItems)[0];
                const firstItem = filesMap.get(firstItemId);
                if (firstItem?.type === 'file') {
                    handlePreviewClick(firstItem.id, firstItem.name, firstItem.mimeType);
                } else if (firstItem?.type === 'folder') {
                    handleFolderDoubleClick(firstItem.id, firstItem.name);
                }
                return;
            }

            // Download selected items (Ctrl+D)
            if (e.ctrlKey && e.key === 'd' && !e.shiftKey && !e.altKey && selectedItems.size > 0) {
                e.preventDefault();
                handleBulkDownload();
                return;
            }

            // Delete selected items (Delete or Backspace)
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItems.size > 0) {
                e.preventDefault();
                handleBulkMoveToTrash();
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selectedItems, filesMap]);

    return (
        <div className={cn(
            "flex flex-col h-full bg-background mt-1",
            currentFolderId !== 'root' && "rounded-xl shadow-xs ring-1 ring-border overflow-hidden bg-[var(--table-surface)]"
        )}>

            {isMobile && (
                <div className="flex flex-col border-b border-border bg-[var(--table-surface)] shadow-sm z-20">
                    {/* Actions Toolbar - Mobile Only - Rectangle layout */}
                    <div className="flex items-center gap-3 px-4 py-2 bg-muted/20 overflow-x-auto no-scrollbar min-h-[52px] border-b border-border/40">
                        <div className="flex items-center gap-1.5 min-w-max">
                            {isLoading ? renderLoadingIcons : renderHeaderIcons}
                        </div>
                    </div>
                    {/* Breadcrumbs - Separate line */}
                    <div className="flex items-center px-4 h-10 bg-background/50 backdrop-blur-sm">
                        {renderBreadcrumbs()}
                    </div>
                </div>
            )}

            <TableCard.Root size="sm" className={cx(isMobile ? "rounded-none ring-0 shadow-none" : "rounded-xl", "overflow-hidden")}>
                {!isMobile && (
                    <TableCard.Header
                        title={renderBreadcrumbs()}
                        contentTrailing={
                            <div className="flex items-center gap-1">
                                {isLoading ? renderLoadingIcons : renderHeaderIcons}
                            </div>
                        }
                        className="h-10 border-0"
                    />
                )}

                {(isLoading || isPending) && files.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="text-center space-y-4">
                            <IconLoader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading...</p>
                            <div className="space-y-2 max-w-md mx-auto px-6">
                                {[...Array(3)].map((_, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <Skeleton className="h-4 w-4 rounded" />
                                        <Skeleton className="h-4 flex-1" />
                                        <Skeleton className="h-4 w-16" />
                                        <Skeleton className="h-4 w-12" />
                                        <Skeleton className="h-4 w-20" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="text-center text-red-500">
                            <p className="text-sm font-medium mb-1">Failed to load files</p>
                            <p className="text-xs opacity-80">{error}</p>
                        </div>
                    </div>
                ) : (
                    <div className={cn("relative h-full transition-opacity duration-200", (isFetching || isPending) && "opacity-60")}>
                        {/* Smooth Top Progress Bar for background fetching */}
                        {(isFetching || isPending) && (
                            <div className="absolute top-0 left-0 right-0 z-50 h-[2px] bg-primary/20 overflow-hidden">
                                <motion.div
                                    className="h-full bg-primary"
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                />
                            </div>
                        )}

                        {/* While refetching and we already have items, show skeleton rows that precisely match the table shape */}
                        {(isFetching || isPending) && filteredItems.length > 0 && (
                            <Table.Body>
                                {Array.from({ length: Math.max(5, Math.min(filteredItems.length || 8, 20)) }).map((_, i) => (
                                    <Table.Row key={`skeleton-${i}`} className="opacity-80 pointer-events-none select-none">
                                        <Table.Cell className="w-10 text-center pl-2 md:pl-4 pr-0">
                                            <Skeleton className="h-4 w-4 rounded" />
                                        </Table.Cell>
                                        <Table.Cell className="w-full max-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Skeleton className="h-4 w-4 rounded" />
                                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                    <div className="flex-1 min-w-0">
                                                        <Skeleton className="h-4 w-48 mb-1" />
                                                        <Skeleton className="h-3 w-32" />
                                                    </div>
                                                </div>
                                            </div>
                                        </Table.Cell>
                                        <Table.Cell className="hidden md:table-cell px-1 w-16 text-center">
                                            <Skeleton className="h-4 w-4 rounded" />
                                        </Table.Cell>
                                        <Table.Cell className="hidden md:table-cell text-right w-40 px-4">
                                            <Skeleton className="h-3 w-20" />
                                        </Table.Cell>
                                        <Table.Cell className="hidden md:table-cell text-right w-28 px-4">
                                            <Skeleton className="h-3 w-12" />
                                        </Table.Cell>
                                        <Table.Cell className="hidden md:table-cell px-1 w-16 text-center">
                                            <Skeleton className="h-4 w-4 rounded" />
                                        </Table.Cell>
                                        <Table.Cell className="px-2 md:px-3 w-10 md:w-12">
                                            <Skeleton className="h-4 w-8 rounded" />
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        )}
                        {viewMode === 'table' ? (
                            <DndContext
                                sensors={sensors}
                                onDragStart={handleDragStart}
                                onDragOver={handleDragOver}
                                onDragEnd={handleDragEnd}
                            >
                                <div className={cn("w-full relative", isDragging && "table-drag-boundary")}>
                                    <Table size="sm" aria-label="Files" selectionMode="multiple" selectionBehavior="replace" sortDescriptor={sortDescriptor} onSortChange={setSortDescriptor} selectedKeys={selectedItems} onSelectionChange={handleTableSelectionChange}
                                        onContextMenu={(e: React.MouseEvent) => handleContextMenu(e)}
                                    >
                                        {filteredItems.length > 0 && (
                                            <Table.Header className="group sticky top-0 z-40 bg-background border-b">
                                                <Table.Head className="w-10 text-center pl-2 md:pl-4 pr-0">
                                                    <Checkbox
                                                        slot="selection"
                                                        className={`transition-opacity duration-200 ${selectedItems.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
                                                    />
                                                </Table.Head>
                                                <Table.Head id="name" isRowHeader allowsSorting={true} className="w-full max-w-0 pointer-events-none cursor-default" align="left">
                                                    {selectedItems.size > 0 ? (
                                                        <span className="text-xs font-semibold whitespace-nowrap text-foreground px-1.5 py-1">{selectedItems.size} selected</span>
                                                    ) : (
                                                        <span className="text-xs font-semibold whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-1.5 py-1 transition-colors cursor-pointer pointer-events-auto">{t("files.name")}</span>
                                                    )}
                                                </Table.Head>

                                                <Table.Head id="modified" allowsSorting={true} align="right" className={`hidden md:table-cell w-40 ${visibleColumns.has('modified') ? '' : '[&>*]:invisible'} pointer-events-none cursor-default ${selectedItems.size > 0 ? '[&_svg]:invisible' : ''} px-4`}>
                                                    <span className={`text-xs font-semibold whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-1.5 py-1 transition-colors cursor-pointer pointer-events-auto ${selectedItems.size > 0 ? 'invisible' : ''}`}>{t("files.modified")}</span>
                                                </Table.Head>
                                                <Table.Head id="size" allowsSorting={true} align="right" className={`hidden md:table-cell w-28 ${visibleColumns.has('size') ? '' : '[&>*]:invisible'} pointer-events-none cursor-default ${selectedItems.size > 0 ? '[&_svg]:invisible' : ''} px-4`}>
                                                    <span className={`text-xs font-semibold whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-1.5 py-1 transition-colors cursor-pointer pointer-events-auto ${selectedItems.size > 0 ? 'invisible' : ''}`}>{t("files.size")}</span>
                                                </Table.Head>

                                                <Table.Head id="actions" align="right" className="w-12 px-2" />
                                            </Table.Header>
                                        )}


                                        {filteredItems.length > 0 ? (
                                            <Table.Body dependencies={[visibleColumns, selectedItems.size, filteredItems.length]}>
                                                {filteredItems.map((item) => {
                                                    const isSelected = selectedItems.has(item.id);
                                                    const isDraggingSomewhere = !!activeDragItem;

                                                    return (
                                                        <DraggableDroppableRow
                                                            key={item.id}
                                                            id={item.id}
                                                            item={item}
                                                            isSelected={isSelected}
                                                            isDraggingSomewhere={isDraggingSomewhere}
                                                            onDoubleClick={item.type === 'folder' ? () => handleFolderDoubleClick(item.id, item.name) : (item.type === 'file' ? () => handlePreviewClick(item.id, item.name, item.mimeType) : (item.type === 'paper' ? () => router.push('/p/' + item.id) : undefined))}
                                                            className="group hover:bg-muted/50 transition-colors duration-150"
                                                            onContextMenu={handleContextMenu}
                                                        >
                                                            <Table.Cell className="w-10 text-center pl-2 md:pl-4 pr-0">
                                                                <Checkbox
                                                                    slot="selection"
                                                                    className={`transition-opacity duration-200 ${selectedItems.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
                                                                />
                                                            </Table.Cell>
                                                            <Table.Cell className="w-full max-w-0">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <div className="text-base">
                                                                        {item.type === 'folder' ? (
                                                                            <IconFolder className="h-4 w-4 text-blue-500 inline-block align-middle" />
                                                                        ) : (
                                                                            <FileThumbnail
                                                                                fileId={item.id}
                                                                                mimeType={item.mimeType}
                                                                                name={item.name}
                                                                                className="h-4 w-4 inline-block align-middle"
                                                                                iconClassName="h-4 w-4"
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 flex-1 min-w-0 group/name-cell">
                                                                        {inlineRenameId === item.id ? (
                                                                            <Input
                                                                                autoFocus
                                                                                spellCheck={false}
                                                                                autoComplete="off"
                                                                                value={inlineRenameValue}
                                                                                onChange={(e) => setInlineRenameValue(e.target.value)}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                onMouseDown={(e) => e.stopPropagation()}
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === 'Enter') {
                                                                                        e.preventDefault();
                                                                                        e.currentTarget.blur();
                                                                                    }
                                                                                    if (e.key === 'Escape') {
                                                                                        e.stopPropagation();
                                                                                        setInlineRenameId(null);
                                                                                    }
                                                                                }}
                                                                                onBlur={() => handleInlineRenameSubmit(item)}
                                                                                className="h-7 py-0 px-1 text-sm font-medium focus-visible:ring-1 focus-visible:ring-offset-0 bg-background"
                                                                                disabled={isInlineRenaming}
                                                                            />
                                                                        ) : (
                                                                            <>
                                                                                <TruncatedNameTooltip
                                                                                    name={item.name}
                                                                                    className="text-sm font-medium whitespace-nowrap text-foreground cursor-default min-w-0 flex-initial"
                                                                                />
                                                                                <RenameButton
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setInlineRenameId(item.id);
                                                                                        setInlineRenameValue(item.name);
                                                                                    }}
                                                                                    className="opacity-0 group-hover/name-cell:opacity-100 p-1 transition-all text-muted-foreground hover:text-primary shrink-0 ml-0.5"
                                                                                />
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                    {item.lockedUntil && new Date(item.lockedUntil) > new Date() && (
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <IconLock className="h-3.5 w-3.5 text-amber-500 shrink-0 ml-1" />
                                                                            </TooltipTrigger>
                                                                            <TooltipContent>
                                                                                <p>{t("files.locked", { date: formatDate(item.lockedUntil) })}</p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    )}
                                                                </div>
                                                            </Table.Cell>

                                                            <Table.Cell className={`hidden md:table-cell text-right w-40 ${visibleColumns.has('modified') ? '' : '[&>*]:invisible'} px-4`}>
                                                                <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                                                                    {formatDate(item.updatedAt || item.createdAt)}
                                                                </span>
                                                            </Table.Cell>
                                                            <Table.Cell className={`hidden md:table-cell text-right w-28 ${visibleColumns.has('size') ? '' : '[&>*]:invisible'} px-4`}>
                                                                <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                                                                    {item.type === 'folder' ? '--' : formatFileSize(item.size || 0)}
                                                                </span>
                                                            </Table.Cell>
                                                            <Table.Cell className="px-2 md:px-3 w-10 md:w-12">
                                                                <div className={`flex justify-end gap-0.5 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200`}>
                                                                    <DropdownMenu>
                                                                        <DropdownMenuTrigger asChild>
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-8 w-8 p-0"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                onMouseDown={(e) => e.stopPropagation()}
                                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                            >
                                                                                <IconDotsVertical className="h-4 w-4" />
                                                                            </Button>
                                                                        </DropdownMenuTrigger>
                                                                        <DropdownMenuContent align="end" className="w-48">
                                                                            {item.type !== 'paper' && (
                                                                                <DropdownMenuItem onClick={() => handleDownloadClick(item.id, item.name, item.type as any)}>
                                                                                    <IconDownload className="h-4 w-4 mr-2" />
                                                                                    {t("files.download")}
                                                                                </DropdownMenuItem>
                                                                            )}
                                                                            {item.type === 'file' && (
                                                                                <DropdownMenuItem onClick={() => handlePreviewClick(item.id, item.name, item.mimeType)}>
                                                                                    <IconEye className="h-4 w-4 mr-2" />
                                                                                    {t("files.preview")}
                                                                                </DropdownMenuItem>
                                                                            )}

                                                                            <DropdownMenuSeparator />
                                                                            <DropdownMenuItem onClick={() => handleMoveToFolderClick(item.id, item.name, item.type as any)}>
                                                                                <IconFolder className="h-4 w-4 me-2" />
                                                                                {t("files.move")}
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => handleCopyClick(item.id, item.name, item.type as any)}>
                                                                                <IconCopy className="h-4 w-4 me-2" />
                                                                                {t("files.copyTo")}
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => handleRenameClick(item.id, item.name, item.type as any)}>
                                                                                <IconEdit className="h-4 w-4 me-2" />
                                                                                {t("files.rename")}
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => handleDetailsClick(item.id, item.name, item.type as any)}>
                                                                                <IconInfoCircle className="h-4 w-4 mr-2" />
                                                                                {t("files.details")}
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={() => handleLockClick(item.id, item.name, item.type as any)}>
                                                                                <IconLock className="h-4 w-4 mr-2" />
                                                                                {t("files.retention")}
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuSeparator />
                                                                            <DropdownMenuItem
                                                                                onClick={() => handleMoveToTrashClick(item.id, item.name, item.type as any)}
                                                                                variant="destructive"
                                                                                disabled={!!(item.lockedUntil && new Date(item.lockedUntil) > new Date())}
                                                                            >
                                                                                <IconTrash className="h-4 w-4 mr-2" />
                                                                                {t("files.moveToTrash")}
                                                                                {item.lockedUntil && new Date(item.lockedUntil) > new Date() && (
                                                                                    <IconLock className="h-3 w-3 ml-auto opacity-50" />
                                                                                )}
                                                                            </DropdownMenuItem>
                                                                        </DropdownMenuContent>
                                                                    </DropdownMenu>
                                                                </div>
                                                            </Table.Cell>
                                                        </DraggableDroppableRow>
                                                    );
                                                })}
                                            </Table.Body>

                                        ) : null}
                                    </Table>
                                    {filteredItems.length === 0 && showEmpty && emptyState}
                                </div>
                                <DragOverlay
                                    modifiers={isMobile ? [] : [snapCenterToCursor]}
                                    dropAnimation={null}
                                >
                                    {activeDragItem && isDragging && (
                                        <div className="bg-primary text-primary-foreground border border-primary/20 rounded shadow-md px-1.5 py-0.5 flex items-center gap-1.5 pointer-events-none z-50 whitespace-nowrap" style={{ willChange: 'transform' }}>
                                            <div className="flex-shrink-0">
                                                {activeDragItem.type === 'folder' ? (
                                                    <IconFolder className="h-3 w-3" />
                                                ) : (
                                                    <FileIcon mimeType={activeDragItem.mimeType} filename={activeDragItem.name} className="h-3 w-3" />
                                                )}
                                            </div>
                                            <span className="text-[10px] font-medium max-w-[100px] truncate">
                                                {activeDragItem.name}
                                            </span>
                                            {selectedItems.size > 1 && selectedItems.has(activeDragItem.id) && (
                                                <span className="text-[9px] opacity-90 font-medium bg-primary-foreground/20 px-1 rounded-sm">
                                                    +{selectedItems.size - 1}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </DragOverlay>
                                <DropHelper
                                    isVisible={!!currentDropTarget}
                                    folderName={currentDropTarget?.name || null}
                                />
                                <AutoScroller />
                            </DndContext>
                        ) : (
                            // Grid View
                            <div className="p-4 relative" onContextMenu={(e) => handleContextMenu(e)}>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
                                    {filteredItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className={`group relative bg-card rounded-lg border border-border p-4 hover:bg-muted/50 transition-all duration-200 cursor-pointer ${selectedItems.has(item.id) ? 'ring-2 ring-primary bg-muted' : ''}`}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();

                                                if (isMobile) {
                                                    // on mobile, single click enters/previews
                                                    if (item.type === 'folder') {
                                                        handleFolderDoubleClick(item.id, item.name);
                                                    } else if (item.type === 'file') {
                                                        handlePreviewClick(item.id, item.name, item.mimeType);
                                                    } else if (item.type === 'paper') {
                                                        router.push('/p/' + item.id);
                                                    }
                                                    return;
                                                }

                                                const newSelected = new Set(selectedItems);
                                                if (e.ctrlKey || e.metaKey) {
                                                    if (newSelected.has(item.id)) {
                                                        newSelected.delete(item.id);
                                                    } else {
                                                        newSelected.add(item.id);
                                                    }
                                                } else if (e.shiftKey && selectedItems.size > 0) {
                                                    newSelected.clear();
                                                    newSelected.add(item.id);
                                                } else {
                                                    newSelected.clear();
                                                    newSelected.add(item.id);
                                                }
                                                setSelectedItems(newSelected);
                                            }}
                                            onDoubleClick={() => {
                                                if (item.type === 'folder') {
                                                    handleFolderDoubleClick(item.id, item.name);
                                                } else if (item.type === 'file') {
                                                    handlePreviewClick(item.id, item.name, item.mimeType);
                                                } else if (item.type === 'paper') {
                                                    router.push('/p/' + item.id);
                                                }
                                            }}
                                            onContextMenu={(e) => handleContextMenu(e, item)}
                                        >
                                            {/* Selection checkbox */}
                                            <div className="absolute top-2 left-2 z-10">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedItems.has(item.id)}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        const newSelected = new Set(selectedItems);
                                                        if (e.target.checked) {
                                                            newSelected.add(item.id);
                                                        } else {
                                                            newSelected.delete(item.id);
                                                        }
                                                        setSelectedItems(newSelected);
                                                    }}
                                                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                                                />
                                            </div>



                                            {/* File/Folder icon */}
                                            <div className="flex flex-col items-center gap-3 pt-6">
                                                <div className="text-4xl w-full flex justify-center aspect-square items-center overflow-hidden rounded-md mb-2">
                                                    {item.type === 'folder' ? (
                                                        <IconFolder className="h-20 w-20 text-blue-500" />
                                                    ) : (
                                                        <FileThumbnail
                                                            fileId={item.id}
                                                            mimeType={item.mimeType}
                                                            name={item.name}
                                                            className="w-full h-full object-cover"
                                                            iconClassName="h-20 w-20"
                                                        />
                                                    )}
                                                </div>

                                                {inlineRenameId === item.id ? (
                                                    <Input
                                                        autoFocus
                                                        value={inlineRenameValue}
                                                        onChange={(e) => setInlineRenameValue(e.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleInlineRenameSubmit(item);
                                                            if (e.key === 'Escape') setInlineRenameId(null);
                                                        }}
                                                        onBlur={() => handleInlineRenameSubmit(item)}
                                                        className="h-7 py-0 px-1 text-sm font-medium focus-visible:ring-1 text-center"
                                                        disabled={isInlineRenaming}
                                                    />
                                                ) : (
                                                    <div className="relative w-full group/grid-name">
                                                        <TruncatedNameTooltip
                                                            name={item.name}
                                                            className="text-sm font-medium text-center text-foreground line-clamp-2 break-words w-full cursor-default"
                                                            maxTooltipWidth="300px"
                                                        />
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setInlineRenameId(item.id);
                                                                        setInlineRenameValue(item.name);
                                                                    }}
                                                                    className="absolute -right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover/grid-name:opacity-100 p-1 hover:bg-accent rounded transition-all text-muted-foreground hover:text-primary shrink-0"
                                                                >
                                                                    <IconEdit className="h-3.5 w-3.5" />
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Rename</TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                )}

                                                {/* File size or folder indicator */}
                                                <p className="text-xs text-muted-foreground text-center">
                                                    {item.type === 'folder' ? 'Folder' : formatFileSize(item.size || 0)}
                                                </p>

                                                {/* Modified date */}
                                                <p className="text-xs text-muted-foreground text-center font-[var(--font-jetbrains-mono)] font-semibold tracking-wider">
                                                    {formatDate(item.updatedAt || item.createdAt)}
                                                </p>
                                            </div>

                                            {/* Actions menu */}
                                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 w-6 p-0 bg-background/80 backdrop-blur-sm"
                                                            onClick={(e) => e.stopPropagation()}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                        >
                                                            <IconDotsVertical className="h-3 w-3" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-48">
                                                        {item.type !== 'paper' && (
                                                            <DropdownMenuItem onClick={() => handleDownloadClick(item.id, item.name, item.type as any)}>
                                                                <IconDownload className="h-4 w-4 mr-2" />
                                                                Download
                                                            </DropdownMenuItem>
                                                        )}
                                                        {item.type === 'file' && (
                                                            <DropdownMenuItem onClick={() => handlePreviewClick(item.id, item.name, item.mimeType)}>
                                                                <IconEye className="h-4 w-4 mr-2" />
                                                                Preview
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem onClick={() => handleMoveToFolderClick(item.id, item.name, item.type as any)}>
                                                            <IconFolder className="h-4 w-4 mr-2" />
                                                            Move to folder
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleCopyClick(item.id, item.name, item.type as any)}>
                                                            <IconCopy className="h-4 w-4 mr-2" />
                                                            Copy to...
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleRenameClick(item.id, item.name, item.type as any)}>
                                                            <IconEdit className="h-4 w-4 mr-2" />
                                                            Rename
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleDetailsClick(item.id, item.name, item.type as any)}>
                                                            <IconInfoCircle className="h-4 w-4 mr-2" />
                                                            Details
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem onClick={() => handleMoveToTrashClick(item.id, item.name, item.type as any)} variant="destructive">
                                                            <IconTrash className="h-4 w-4 mr-2" />
                                                            Move to trash
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {(isFetching || isPending) && filteredItems.length > 0 && (
                                    <div className="absolute inset-0 z-40 pointer-events-none">
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 p-0">
                                            {Array.from({ length: Math.min(filteredItems.length || 8, 24) }).map((_, i) => (
                                                <div key={`skeleton-card-${i}`} className="group relative bg-card rounded-lg border border-border p-4 opacity-90">
                                                    <div className="text-4xl w-full flex justify-center aspect-square items-center overflow-hidden rounded-md mb-2">
                                                        <Skeleton className="w-full h-full rounded-md" />
                                                    </div>
                                                    <Skeleton className="h-4 w-full mb-2" />
                                                    <Skeleton className="h-3 w-3/4" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {filteredItems.length === 0 && showEmpty && (
                                    emptyState
                                )}
                            </div>
                        )}
                    </div>
                )}
            </TableCard.Root>

            {/* Hidden file inputs moved here */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                accept="*/*"
            />
            <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFolderSelect}
                {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
            />

            <CreateFolderModal
                open={createFolderOpen}
                onOpenChange={setCreateFolderOpen}
                parentId={currentFolderId === 'root' ? null : currentFolderId}
                onFolderCreated={(folder) => {
                    if (folder) {
                        notifyFileAdded(folder);
                    } else {
                        refreshFiles();
                    }
                }}
            />

            <RenameModal
                itemName={selectedItemForRename?.name || ""}
                initialName={renameModalInitialName}
                itemType={(selectedItemForRename?.type === 'paper' ? 'file' : selectedItemForRename?.type) || "file"}
                open={renameModalOpen}
                onOpenChange={(open) => {
                    setRenameModalOpen(open);
                    if (!open) setRenameModalInitialName(undefined);
                }}
                onRename={handleRename}
            />

            {/* Conflict modal for rename actions */}
            <ConflictModal
                isOpen={renameConflictOpen}
                onClose={() => setRenameConflictOpen(false)}
                conflicts={renameConflictItems as any}
                onResolve={handleRenameConflictResolution}
                operation="rename"
            />


            <DetailsModal
                itemId={selectedItemForDetails?.id || ""}
                itemName={selectedItemForDetails?.name || ""}
                itemType={(selectedItemForDetails?.type === 'paper' ? 'file' : selectedItemForDetails?.type) || "file"}
                open={detailsModalOpen}
                onOpenChange={setDetailsModalOpen}
                onTagsUpdated={() => refreshFiles(currentFolderId, true)}
            />

            <MoveToFolderModal
                items={selectedItemsForMoveToFolder as unknown as { id: string; name: string; type: "file" | "folder" }[]}
                open={moveToFolderModalOpen}
                onOpenChange={setMoveToFolderModalOpen}
                onItemMoved={(movedItemIds) => {
                    if (movedItemIds && movedItemIds.length > 0) {
                        setFiles(prev => prev.filter(f => !movedItemIds.includes(f.id)));
                    }
                    setSelectedItems(new Set()); // Clear selection after moving items
                    refreshFiles();
                }}
            />

            <CopyModal
                items={selectedItemsForCopy as unknown as { id: string; name: string; type: "file" | "folder" }[]}
                open={copyModalOpen}
                onOpenChange={setCopyModalOpen}
                onItemCopied={() => {
                    setSelectedItems(new Set()); // Clear selection
                    refreshFiles();
                }}
                onConflict={handleCopyConflict}
            />

            <ConflictModal
                isOpen={copyConflictOpen}
                onClose={() => setCopyConflictOpen(false)}
                conflicts={copyConflictItems as any}
                onResolve={handleCopyConflictResolution}
                operation="copy"
            />

            <MoveToTrashModal
                itemId={selectedItemForMoveToTrash?.id || ""}
                itemName={selectedItemForMoveToTrash?.name || ""}
                itemType={(selectedItemForMoveToTrash?.type === 'paper' ? 'file' : selectedItemForMoveToTrash?.type) || "file"}
                open={moveToTrashModalOpen}
                onOpenChange={setMoveToTrashModalOpen}
                onItemMoved={() => {
                    // Remove the item from the current view immediately (optimistic update)
                    setFiles(prevFiles => prevFiles.filter(file => file.id !== selectedItemForMoveToTrash?.id));

                    // Clear selection for the moved item
                    if (selectedItemForMoveToTrash?.id) {
                        setSelectedItems(prevSelected => {
                            const newSelected = new Set(prevSelected);
                            newSelected.delete(selectedItemForMoveToTrash.id);
                            return newSelected;
                        });
                    }
                    // No need to refreshFiles() since we do optimistic updates
                }}
            />

            {/* Context Menu */}
            {
                contextMenu?.isOpen && (
                    <div
                        className="fixed inset-0 z-50"
                        onClick={handleContextMenuClose}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            handleContextMenuClose();
                        }}
                    >
                        <div
                            className="absolute bg-popover border border-border rounded-md shadow-lg py-1 min-w-48 z-50 animate-in fade-in-0 zoom-in-95 duration-200 ease-out pointer-events-auto"
                            style={{
                                left: (() => {
                                    const menuWidth = 192; // min-w-48 = 192px
                                    const viewportWidth = window.innerWidth;
                                    const cursorX = contextMenu.x;

                                    // If menu would go off-screen to the right, position it to the left of cursor
                                    if (cursorX + menuWidth > viewportWidth) {
                                        return cursorX - menuWidth;
                                    }
                                    return cursorX;
                                })(),
                                top: (() => {
                                    const menuHeight = 200; // Approximate height
                                    const viewportHeight = window.innerHeight;
                                    const cursorY = contextMenu.y;

                                    // If menu would go off-screen to the bottom, position it above cursor
                                    if (cursorY + menuHeight > viewportHeight) {
                                        return cursorY - menuHeight;
                                    }
                                    return cursorY;
                                })(),
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {!contextMenu.targetItem ? (
                                // Context menu for empty space
                                <>
                                    <button
                                        className="w-full px-3 py-2 text-start hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('createFolder')}
                                    >
                                        <IconFolderPlus className="h-4 w-4" />
                                        Create Folder
                                    </button>
                                    <div className="h-px bg-border mx-2 my-1" />
                                    <button
                                        className="w-full px-3 py-2 text-start hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('importFile')}
                                    >
                                        <IconFileUpload className="h-4 w-4" />
                                        Import File
                                    </button>
                                    <button
                                        className="w-full px-3 py-2 text-start hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('importFolder')}
                                    >
                                        <IconFolderDown className="h-4 w-4" />
                                        Import Folder
                                    </button>
                                    <div className="h-px bg-border mx-2 my-1" />
                                </>
                            ) : (
                                // Context menu for items
                                <>
                                    {contextMenu.targetItem?.type !== 'paper' && (
                                        <button
                                            className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                            onClick={() => handleContextMenuAction('download', contextMenu.targetItem)}
                                        >
                                            <IconDownload className="h-4 w-4" />
                                            Download
                                        </button>
                                    )}
                                    {contextMenu.targetItem?.type === 'file' && (
                                        <div
                                            className="flex items-center px-3 py-2 text-sm text-foreground hover:bg-accent cursor-pointer transition-colors"
                                            onClick={() => {
                                                if (contextMenu.targetItem) {
                                                    handlePreviewClick(contextMenu.targetItem.id, contextMenu.targetItem.name, contextMenu.targetItem.mimeType);
                                                    handleContextMenuClose();
                                                }
                                            }}
                                        >
                                            <IconEye className="h-4 w-4 mr-2" />
                                            Preview
                                        </div>
                                    )}
                                    <div className="h-px bg-border mx-2 my-1" />
                                    <button
                                        className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('moveToFolder', contextMenu.targetItem)}
                                    >
                                        <IconFolder className="h-4 w-4" />
                                        Move to Folder
                                    </button>
                                    <button
                                        className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('copy', contextMenu.targetItem)}
                                    >
                                        <IconCopy className="h-4 w-4" />
                                        Copy to...
                                    </button>
                                    <button
                                        className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('rename', contextMenu.targetItem)}
                                    >
                                        <IconEdit className="h-4 w-4" />
                                        Rename
                                    </button>
                                    <button
                                        className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('details', contextMenu.targetItem)}
                                    >
                                        <IconInfoCircle className="h-4 w-4" />
                                        Details
                                    </button>
                                    <button
                                        className="w-full px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-sm"
                                        onClick={() => handleContextMenuAction('lock', contextMenu.targetItem)}
                                    >
                                        <IconLock className="h-4 w-4" />
                                        Retention policy
                                    </button>
                                    <div className="h-px bg-border mx-2 my-1" />
                                    <button
                                        className={`w-full px-3 py-2 text-left flex items-center gap-2 text-sm ${contextMenu.targetItem && contextMenu.targetItem.lockedUntil && new Date(contextMenu.targetItem.lockedUntil) > new Date()
                                            ? 'opacity-50 cursor-not-allowed'
                                            : 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
                                            }`}
                                        onClick={() => {
                                            if (!(contextMenu.targetItem && contextMenu.targetItem.lockedUntil && new Date(contextMenu.targetItem.lockedUntil) > new Date())) {
                                                handleContextMenuAction('moveToTrash', contextMenu.targetItem)
                                            }
                                        }}
                                        disabled={!!(contextMenu.targetItem && contextMenu.targetItem.lockedUntil && new Date(contextMenu.targetItem.lockedUntil) > new Date())}
                                    >
                                        <IconTrash className="h-4 w-4" />
                                        Move to Trash
                                        {contextMenu.targetItem && contextMenu.targetItem.lockedUntil && new Date(contextMenu.targetItem.lockedUntil) > new Date() && (
                                            <IconLock className="h-3 w-3 ml-auto" />
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    </div >
                )
            }

            <LockItemModal
                open={lockModalOpen}
                onOpenChange={setLockModalOpen}
                itemId={selectedItemForLock?.id}
                itemName={selectedItemForLock?.name}
                itemType={(selectedItemForLock?.type === 'paper' ? 'file' : selectedItemForLock?.type) || "file"}
                onItemLocked={() => refreshFiles()}
            />

            <FullPagePreviewModal
                file={selectedItemForPreview ? (() => {
                    const item = filesMap.get(selectedItemForPreview.id);
                    return {
                        id: selectedItemForPreview.id,
                        name: selectedItemForPreview.name,
                        type: (selectedItemForPreview as any).type || 'file',
                        mimeType: selectedItemForPreview.mimeType,
                        size: item?.size,
                        lockedUntil: item?.lockedUntil,
                        retentionMode: item?.retentionMode
                    };
                })() : null}
                isOpen={previewModalOpen}
                onClose={() => {
                    setPreviewModalOpen(false);
                    // Clear URL param
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('preview');
                    router.push(`${pathname}?${params.toString()}`, { scroll: false });
                }}
                onDownload={(file) => handleDownloadClick(file.id, file.name, 'file')}
                onNavigate={handlePreviewNavigate}
                onDetails={(file) => handleDetailsClick(file.id, file.name, 'file')}
                hasPrev={previewNavigationState.hasPrev}
                hasNext={previewNavigationState.hasNext}
                currentIndex={selectedItemForPreview ? getPreviewableFiles().findIndex(item => item.id === selectedItemForPreview.id) : -1}
                totalItems={getPreviewableFiles().length}
            />

            <ActionBar
                open={selectedItems.size > 0 && !isDragging}
                onOpenChange={(open) => {
                    if (!open) setSelectedItems(new Set());
                }}
            >
                <ActionBarSelection>
                    {selectedItems.size} selected
                </ActionBarSelection>
                <ActionBarSeparator />
                <ActionBarGroup>
                    {(selectedItems.size > 1 || !selectedHasPaper) && (
                        <ActionBarItem onClick={handleBulkDownload}>
                            <IconDownload className="h-4 w-4 mr-2" />
                            Download
                        </ActionBarItem>
                    )}
                    <ActionBarItem onClick={handleBulkMoveToFolderClick}>
                        <IconFolder className="h-4 w-4 mr-2" />
                        Move
                    </ActionBarItem>
                    <ActionBarItem onClick={handleBulkCopyClick}>
                        <IconCopy className="h-4 w-4 mr-2" />
                        Copy
                    </ActionBarItem>
                    <ActionBarItem
                        variant="destructive"
                        onClick={handleBulkMoveToTrash}
                    >
                        <IconTrash className="h-4 w-4 mr-2" />
                        Trash
                    </ActionBarItem>
                </ActionBarGroup>
                <ActionBarSeparator />
                <ActionBarClose>
                    <IconX className="h-4 w-4" />
                </ActionBarClose>
            </ActionBar>
        </div >
    );

};

function EmptyState({ title, description, icon, onCreateFolder, onCreatePaper, onUploadFile, onImportFromGoogle }: { title: string, description: string, icon?: React.ReactNode, onCreateFolder?: () => void, onCreatePaper?: () => Promise<void> | void, onUploadFile?: () => void, onImportFromGoogle?: () => void }) {
    const [uploadDropdownOpen, setUploadDropdownOpen] = useState(false);

    // Prevent body scroll while empty state is shown
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    return (
        <Empty>
            <div className="w-full min-h-[calc(100vh-6rem)] flex items-center justify-center overflow-hidden p-6">
                <div className="w-full max-w-[760px] flex flex-col items-start gap-8 text-left">

                    {/* Lottie Animation (slightly smaller) */}
                    <div className="w-44 h-44">
                        <DotLottieReact src="/chill.lottie" loop autoplay className="w-full h-full" />
                    </div>

                    {/* Drop text with dropdown */}
                    <div className="w-full">
                        <p className="text-sm text-muted-foreground">
                            Drop anything here to{' '}
                            <DropdownMenu open={uploadDropdownOpen} onOpenChange={setUploadDropdownOpen}>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="link" size="sm" className="inline-flex items-center gap-2 p-0 no-underline hover:no-underline select-none">
                                        <span className="inline-flex items-center gap-1 border-b border-current pb-[2px] select-none">
                                            <span className="whitespace-nowrap">upload</span>
                                            <IconChevronDown data-icon="inline-end" className="w-4 h-4" />
                                        </span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="center" className="w-32">
                                    <DropdownMenuItem onClick={() => onUploadFile?.()}>
                                        <IconFileUpload data-icon="inline-start" className="w-4 h-4 mr-2" />
                                        Files
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onCreateFolder?.()}>
                                        <IconFolderDown data-icon="inline-start" className="w-4 h-4 mr-2" />
                                        Folder
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </p>
                    </div>

                    {/* Other ways section - buttons inline, left-aligned, muted hover */}
                    <div className="w-full">
                        <p className="text-xs text-muted-foreground/70 mb-3">Other ways to get started</p>

                        <div className="flex items-start gap-3">
                            <Button variant="secondary" size="sm" onClick={() => onCreateFolder?.()} className="inline-flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-secondary/50 hover:text-muted-foreground transition-colors">
                                <IconFolderPlus data-icon="inline-start" className="w-4 h-4" />
                                Create a folder
                            </Button>

                            <Button variant="secondary" size="sm" onClick={() => onCreatePaper?.()} className="inline-flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-secondary/50 hover:text-muted-foreground transition-colors">
                                <IconFileText data-icon="inline-start" className="w-4 h-4" />
                                Create a Paper
                            </Button>

                            <Button variant="secondary" size="sm" onClick={() => onImportFromGoogle?.()} className="inline-flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-secondary/50 hover:text-muted-foreground transition-colors">
                                <IconBrandGoogleDrive data-icon="inline-start" className="w-4 h-4" />
                                Import from Google Drive
                            </Button>
                        </div>
                    </div>

                </div>
            </div>
        </Empty>
    );
}
