import { useState, useEffect, useCallback, useRef } from 'react';
import { masterKeyManager } from '@/lib/master-key';
import { keyManager } from '@/lib/key-manager';
import type { UserKeypairs } from '@/lib/key-manager';
import apiClient from '@/lib/api';
import { sortChatsByLastMessage } from '@/lib/chat-utils';

// Module-level singletons shared across all useAICrypto instances.
// Ensures only one in-flight fetch for /ai/chats regardless of how many
// components mount and call loadChats() concurrently.
let _chatsLoadedOnce = false;
let _inflightFetch: Promise<void> | null = null;
// Module-level cache so newly-mounted instances start with already-loaded chats
// instead of empty [] (which caused title to be blank on client-side navigation).
let _chatsCache: { id: string, title: string, pinned: boolean, archived: boolean, createdAt: string, lastMessageAt?: string }[] = [];

export interface DecryptedMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    id?: string;
    createdAt?: string;
    isThinking?: boolean;
    reasoning?: string;
    suggestions?: string[];
}

export interface UseAICryptoReturn {
    isReady: boolean;
    kyberPublicKey: string | null;
    userKeys: { keypairs: UserKeypairs } | null;
    chats: { id: string, title: string, pinned: boolean, archived: boolean, createdAt: string, lastMessageAt?: string }[];
    loadChats: (forceRefresh?: boolean) => Promise<void>;
    updateChatTimestamp: (chatId: string, timestamp: string) => void;
    renameChat: (conversationId: string, newTitle: string) => Promise<void>;
    pinChat: (conversationId: string, pinned: boolean) => Promise<void>;
    archiveChat: (conversationId: string, archived: boolean) => Promise<void>;
    deleteChat: (conversationId: string) => Promise<void>;
    decryptHistory: (conversationId: string) => Promise<{ messages: any[]; fullHistory: any[]; getLinearBranch: (messages: any[], targetLeafId?: string) => any[] }>;
    decryptStreamChunk: (encryptedContent: string, iv: string, encapsulatedKey?: string, existingSessionKey?: Uint8Array) => Promise<{ decrypted: string, sessionKey: Uint8Array }>;
    encryptMessage: (content: string) => Promise<{ encryptedContent: string, iv: string, encapsulatedKey: string }>;
    encryptWithSessionKey: (content: string, sessionKey: Uint8Array) => Promise<{ encryptedContent: string, iv: string }>;
    getLinearBranch: (messages: any[], targetLeafId?: string) => any[];
    error: string | null;
}

export function useAICrypto(): UseAICryptoReturn {
    // Check master key availability directly
    const hasMasterKey = typeof window !== 'undefined' && masterKeyManager.hasMasterKey();

    const [isReady, setIsReady] = useState(false);
    const [kyberPublicKey, setKyberPublicKey] = useState<string | null>(null);
    const [userKeys, setUserKeys] = useState<{ keypairs: UserKeypairs } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [chats, setChats] = useState<{ id: string, title: string, pinned: boolean, archived: boolean, createdAt: string, lastMessageAt?: string }[]>(() => _chatsCache);

    // Cross-instance sync: dispatch and listen for chat mutations via custom events
    const instanceId = useRef(Math.random().toString(36));

    const broadcastChats = useCallback((updatedChats: typeof chats) => {
        _chatsCache = updatedChats; // Keep module-level cache current for new instances
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('chat-mutation', { detail: { chats: updatedChats, source: instanceId.current } }));
        }
    }, []);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.source !== instanceId.current) {
                setChats(detail.chats);
            }
        };
        window.addEventListener('chat-mutation', handler);
        return () => window.removeEventListener('chat-mutation', handler);
    }, []);

    // Per-instance ref used only to avoid double-calling within the same instance
    // across StrictMode double-invocations. Cross-instance deduplication is handled
    // by the module-level _inflightFetch promise and _chatsLoadedOnce flag.
    const hasLoadedChats = useRef(false);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
                // 1. Ensure keys are available
                if (!keyManager.hasKeys()) {
                    throw Error("No keys available")
                }

                try {
                    const keys = await keyManager.getUserKeys();
                    if (!mounted) return;

                    setUserKeys(keys);
                    setKyberPublicKey(keys.keypairs.kyberPublicKey);
                    setIsReady(true);
                } catch (err) {
                    console.error("Failed to load user keys for AI Crypto:", err);
                    if (mounted) setError("Failed to load encryption keys.");
                }
            } catch (e) {
                if (mounted) setError("Crypto initialization failed.");
            }
        };

        if (hasMasterKey) init();

        return () => {
            mounted = false;
        };
    }, [hasMasterKey]);

    const decryptTitle = useCallback(async (encryptedTitle: string, iv: string, encapsulatedKey: string) => {
        if (!userKeys) return "Encrypted Chat";
        try {
            const { decryptData } = await import('@/lib/crypto');
            const { ml_kem768 } = await import('@noble/post-quantum/ml-kem');

            const encKeyBytes = Uint8Array.from(atob(encapsulatedKey), c => c.charCodeAt(0));
            const kyberPriv = userKeys.keypairs.kyberPrivateKey;
            const sharedSecret = ml_kem768.decapsulate(encKeyBytes, kyberPriv);
            const decryptedBytes = decryptData(encryptedTitle, sharedSecret, iv);
            return new TextDecoder().decode(decryptedBytes);
        } catch (e) {
            console.error("Title decryption failed:", e);
            return "Decryption Failed";
        }
    }, [userKeys]);

    const loadChats = useCallback(async (forceRefresh = false) => {
        if (!userKeys) return;

        // Use module-level cache: if loaded and not forcing, skip entirely
        if (_chatsLoadedOnce && !forceRefresh) return;

        // If another instance already has a fetch in-flight, wait for it instead
        // of firing a duplicate request. This coalesces all concurrent callers.
        if (_inflightFetch) {
            await _inflightFetch;
            return;
        }

        // Own the in-flight slot
        let resolveFlight!: () => void;
        _inflightFetch = new Promise(r => { resolveFlight = r; });

        try {
            const res = await apiClient.getChats();
            const responseData = res as any;
            const rawChats: any[] = responseData.chats || responseData.data?.chats || [];

            const processed = await Promise.all(rawChats.map(async (chat: any) => {
                let title = "New Chat";
                if (chat.encrypted_title && chat.iv && chat.encapsulated_key) {
                    title = await decryptTitle(chat.encrypted_title, chat.iv, chat.encapsulated_key);

                    // Defensive sanitization to strip surrounding quotes/prefixes and stray trailing counts (including newline + digits like "\n0")
                    title = title.replace(/^\s*["'`]+|["'`]+\s*$/g, '')
                        .replace(/^Title:\s*/i, '')
                        .replace(/^Conversation\s*Start\s*[:\-\s]*/i, '')
                        .replace(/\s*[:\-\|]\s*0+$/g, '')
                        .replace(/(?:\n|\r|\s*[:\-\|]\s*)0+\s*$/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const words = title.split(/\s+/).filter(Boolean);
                    if (words.length > 10) title = words.slice(0, 10).join(' ');
                    if (!/[A-Za-z0-9]/.test(title) || title.length === 0) title = 'New Chat';
                }
                return {
                    id: chat.id,
                    title,
                    pinned: chat.pinned,
                    archived: !!chat.archived,
                    createdAt: chat.created_at,
                    lastMessageAt: chat.last_message_at || undefined
                };
            }));

            // sort by last message timestamp before storing
            const sorted = sortChatsByLastMessage(processed);
            setChats(sorted);
            broadcastChats(sorted);
            _chatsLoadedOnce = true;
            hasLoadedChats.current = true;
        } catch (e) {
            console.error("Failed to load chats:", e);
        } finally {
            _inflightFetch = null;
            resolveFlight();
        }
    }, [userKeys, decryptTitle, broadcastChats]);

    // helper to update a chat's lastMessageAt and reorder
    const updateChatTimestamp = useCallback((chatId: string, timestamp: string) => {
        setChats(prev => {
            const updated = prev.map(c => c.id === chatId ? { ...c, lastMessageAt: timestamp } : c);
            const sorted = sortChatsByLastMessage(updated);
            broadcastChats(sorted);
            return sorted;
        });
    }, [broadcastChats]);

    // Load chats once ready
    useEffect(() => {
        if (isReady && userKeys) {
            loadChats();
        }
    }, [isReady, userKeys, loadChats]);

    const renameChat = useCallback(async (conversationId: string, newTitle: string) => {
        if (!userKeys || !kyberPublicKey) return;
        try {
            const { encryptForUser } = await import('@/lib/ai-crypto');

            // Encrpyt new title
            const { encryptedContent, iv, encapsulatedKey } = await encryptForUser(newTitle, kyberPublicKey);

            await apiClient.updateChat(conversationId, {
                title: encryptedContent,
                iv,
                encapsulated_key: encapsulatedKey
            });

            // Optimistic Update
            const updated = chats.map(c => c.id === conversationId ? { ...c, title: newTitle } : c);
            setChats(sortChatsByLastMessage(updated));
            broadcastChats(updated);
        } catch (e) {
            console.error("Failed to rename chat:", e);
            throw e;
        }
    }, [userKeys, kyberPublicKey, chats, broadcastChats]);

    const pinChat = useCallback(async (conversationId: string, pinned: boolean) => {
        // Optimistic update
        const updated = chats.map(c => c.id === conversationId ? { ...c, pinned } : c);
        setChats(sortChatsByLastMessage(updated));
        broadcastChats(updated);
        try {
            await apiClient.updateChat(conversationId, { pinned });
        } catch (e) {
            console.error("Failed to pin chat:", e);
            // Revert on failure
            const reverted = chats.map(c => c.id === conversationId ? { ...c, pinned: !pinned } : c);
            setChats(sortChatsByLastMessage(reverted));
            broadcastChats(reverted);
        }
    }, [chats, broadcastChats]);

    const archiveChat = useCallback(async (conversationId: string, archived: boolean) => {
        const updated = chats.map(c => c.id === conversationId ? { ...c, archived } : c);
        setChats(sortChatsByLastMessage(updated));
        broadcastChats(updated);
        try {
            await apiClient.updateChat(conversationId, { archived });
        } catch (err) {
            console.error("Failed to archive chat", err);
            const reverted = chats.map(c => c.id === conversationId ? { ...c, archived: !archived } : c);
            setChats(sortChatsByLastMessage(reverted));
            broadcastChats(reverted);
        }
    }, [chats, broadcastChats]);

    const deleteChat = useCallback(async (conversationId: string) => {
        const updated = chats.filter(c => c.id !== conversationId);
        setChats(sortChatsByLastMessage(updated));
        broadcastChats(updated);

        try {
            await apiClient.deleteChat(conversationId);
        } catch (err) {
            console.error("Failed to delete chat:", err);
            loadChats();
        }
    }, [chats, broadcastChats, loadChats]);

    // Helper: Parse thinking tags from content and move to reasoning (supports both <thinking> and <think>)
    const parseThinkingFromContent = (content: string, existingReasoning?: string): { content: string; reasoning: string } => {
        let thinkingBuffer = "";
        let displayContent = "";
        let isInsideThinkingTag = false;
        let i = 0;
        let currentTagFormat = { open: '', close: '' };

        const thinkingTags = [
            { open: '<thinking>', close: '</thinking>' },
            { open: '<think>', close: '</think>' }
        ];

        while (i < content.length) {
            if (!isInsideThinkingTag) {
                // Look for opening tag (check both formats)
                let openIdx = -1;
                let foundTag = null;

                for (const tag of thinkingTags) {
                    const idx = content.indexOf(tag.open, i);
                    if (idx !== -1 && (openIdx === -1 || idx < openIdx)) {
                        openIdx = idx;
                        foundTag = tag;
                    }
                }

                if (openIdx !== -1 && foundTag) {
                    // Add everything before tag to display content
                    displayContent += content.substring(i, openIdx);
                    i = openIdx + foundTag.open.length;
                    currentTagFormat = foundTag;
                    isInsideThinkingTag = true;
                } else {
                    // No opening tag found, add everything from i to end
                    displayContent += content.substring(i);
                    break;
                }
            } else {
                // Inside thinking tag, look for closing tag
                const closeIdx = content.indexOf(currentTagFormat.close, i);
                if (closeIdx !== -1) {
                    // Add thinking content to buffer
                    thinkingBuffer += content.substring(i, closeIdx);
                    i = closeIdx + currentTagFormat.close.length;
                    isInsideThinkingTag = false;
                } else {
                    // Closing tag not found, rest is thinking
                    thinkingBuffer += content.substring(i);
                    break;
                }
            }
        }

        // Combine thinking: prefer existing reasoning, fallback to parsed thinking
        const finalReasoning = existingReasoning || thinkingBuffer || "";

        return {
            content: displayContent.trim(),
            reasoning: finalReasoning.trim()
        };
    };

    const getLinearBranch = useCallback((messages: any[], targetLeafId?: string) => {
        // Sort messages by creation date to ensure we have a chronological sequence
        const sortedMessages = [...messages].sort((a, b) =>
            new Date(a.createdAt || a.created_at).getTime() - new Date(b.createdAt || b.created_at).getTime()
        );

        const mById = new Map<string, any>();
        sortedMessages.forEach(m => mById.set(m.id, m));

        // Lineage Repair: If messages do not have parentId, we link them logically.
        // We detect "versions" by looking for consecutive messages of the same role.

        // Better approach: iterate once and build a local map of repaired IDs
        const repairedLineage = new Map<string, string | null>();
        const finalRepairedMessages = sortedMessages.map((m, idx) => {
            let pid = m.parent_id || null;

            if (!pid && idx > 0) {
                const prev = sortedMessages[idx - 1];
                const prevPid = repairedLineage.get(prev.id) || null;

                if (m.role === prev.role) {
                    // Same role usually means a regeneration or alternative (siblings)
                    pid = prevPid;
                } else {
                    // Different role means continuation (parent-child)
                    pid = prev.id;
                }
            }

            repairedLineage.set(m.id, pid);
            return { ...m, parent_id: pid, _repaired: !m.parent_id && idx > 0 };
        });

        // Re-build maps with repaired lineage
        const map = new Map<string | null, any[]>();
        const repairedById = new Map<string, any>();
        finalRepairedMessages.forEach(m => {
            repairedById.set(m.id, m);
            const pid = m.parent_id || null;
            if (!map.has(pid)) map.set(pid, []);
            map.get(pid)!.push(m);
        });

        const pathIds = new Set<string>();
        if (targetLeafId) {
            let curr: string | null = targetLeafId;
            while (curr) {
                pathIds.add(curr);
                curr = repairedById.get(curr)?.parent_id || null;
            }
        }

        const branch: any[] = [];
        const follow = (parentId: string | null) => {
            const kids = map.get(parentId) || [];
            if (kids.length === 0) return;

            // Sort children by date just in case
            kids.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            const picked = targetLeafId
                ? (kids.find(k => pathIds.has(k.id)) || kids[kids.length - 1])
                : kids[kids.length - 1];

            const versions = kids.map(m => ({
                id: m.id, content: m.content, toolCalls: m.toolCalls, feedback: m.feedback,
                createdAt: m.createdAt, total_time: m.total_time, ttft: m.ttft, tps: m.tps,
                model: m.model, suggestions: m.suggestions, sources: m.sources, reasoning: m.reasoning,
                reasoningDuration: m.reasoningDuration, steps: m.steps
            }));

            const base = { ...picked };
            if (versions.length > 1) {
                base.versions = versions;
                base.currentVersionIndex = versions.findIndex(v => v.id === base.id);
            }
            branch.push(base);
            follow(base.id);
        };

        follow(null);
        return branch;
    }, []);

    const decryptHistory = useCallback(async (conversationId: string): Promise<any> => {
        if (!userKeys) return { messages: [], fullHistory: [], getLinearBranch };

        try {
            const { decryptData } = await import('@/lib/crypto');
            const { ml_kem768 } = await import('@noble/post-quantum/ml-kem');

            const response = await apiClient.getAIChatMessages(conversationId);
            const encryptedMessages = response.messages || [];
            if (!encryptedMessages || encryptedMessages.length === 0) return { messages: [], fullHistory: [], getLinearBranch };

            const decrypted = await Promise.all(encryptedMessages.map(async (msg: any) => {
                try {
                    // E2EE Flow: Decapsulate -> Decrypt
                    if (msg.encapsulated_key && msg.encrypted_content) {
                        const encapsulatedKey = Uint8Array.from(atob(msg.encapsulated_key), c => c.charCodeAt(0));
                        const kyberPriv = userKeys.keypairs.kyberPrivateKey;

                        // Decapsulate
                        const sharedSecret = ml_kem768.decapsulate(encapsulatedKey, kyberPriv);

                        // Decrypt content
                        const decryptedBytes = decryptData(msg.encrypted_content, sharedSecret, msg.iv);
                        const decryptedContent = new TextDecoder().decode(decryptedBytes);

                        // Decrypt reasoning if it exists
                        let decryptedReasoning: string | undefined;
                        if (msg.reasoning && msg.reasoning_iv) {
                            try {
                                const reasoningDecryptedBytes = decryptData(msg.reasoning, sharedSecret, msg.reasoning_iv);
                                decryptedReasoning = new TextDecoder().decode(reasoningDecryptedBytes);
                            } catch (e) {
                                console.warn("Failed to decrypt reasoning:", msg.id, e);
                            }
                        }

                        const { content: cleanContent, reasoning: parsedReasoning } = parseThinkingFromContent(decryptedContent, decryptedReasoning);

                        let decryptedCitations: any[] | undefined;
                        if (msg.citations && msg.citations_iv) {
                            try {
                                const citationsDecryptedBytes = decryptData(msg.citations, sharedSecret, msg.citations_iv);
                                const citationsJson = new TextDecoder().decode(citationsDecryptedBytes);
                                decryptedCitations = JSON.parse(citationsJson);
                            } catch (e) {
                                console.warn("Failed to decrypt citations:", msg.id, e);
                            }
                        } else if (msg.citations) {
                            try {
                                decryptedCitations = typeof msg.citations === 'string' ? JSON.parse(msg.citations) : msg.citations;
                            } catch {
                                decryptedCitations = [];
                            }
                        }

                        let suggestions: string[] | undefined;
                        if (msg.suggestions) {
                            try {
                                let suggestionsJson = msg.suggestions;
                                if (msg.suggestions_iv) {
                                    try {
                                        const suggestionsDecryptedBytes = decryptData(msg.suggestions, sharedSecret, msg.suggestions_iv);
                                        suggestionsJson = new TextDecoder().decode(suggestionsDecryptedBytes);
                                    } catch (e) {
                                        console.warn("Failed to decrypt suggestions:", msg.id, e);
                                        suggestionsJson = "[]";
                                    }
                                }
                                suggestions = typeof suggestionsJson === 'string' ? JSON.parse(suggestionsJson) : (Array.isArray(suggestionsJson) ? suggestionsJson : []);
                            } catch {
                                suggestions = [];
                            }
                        }

                        // Decrypt Steps (CoT)
                        let decryptedSteps: any[] | undefined;
                        if (msg.steps && msg.steps_iv) {
                            try {
                                const stepsDecryptedBytes = decryptData(msg.steps, sharedSecret, msg.steps_iv);
                                const stepsJson = new TextDecoder().decode(stepsDecryptedBytes);
                                decryptedSteps = JSON.parse(stepsJson);
                            } catch (e) {
                                console.warn("Failed to decrypt steps:", msg.id, e);
                            }
                        } else if (msg.steps) {
                            try {
                                decryptedSteps = typeof msg.steps === 'string' ? JSON.parse(msg.steps) : msg.steps;
                            } catch {
                                decryptedSteps = [];
                            }
                        }

                        return {
                            ...msg,
                            role: msg.role as any,
                            content: cleanContent,
                            reasoning: parsedReasoning,
                            reasoningDuration: msg.reasoning_duration,
                            suggestions,
                            steps: decryptedSteps,
                            total_time: msg.total_time,
                            ttft: msg.ttft,
                            tps: msg.tps,
                            model: msg.model,
                            sources: decryptedCitations || msg.sources,
                            feedback: msg.feedback as 'like' | 'dislike' | undefined,
                            createdAt: msg.created_at || msg.createdAt,
                        };
                    }

                    if (msg.content) {
                        const { content: cleanContent, reasoning: parsedReasoning } = parseThinkingFromContent(msg.content);
                        return { ...msg, content: cleanContent, reasoning: parsedReasoning, createdAt: msg.created_at || msg.createdAt };
                    }
                    return { ...msg, createdAt: msg.created_at || msg.createdAt };
                } catch (e) {
                    console.error("Failed to decrypt message:", msg.id, e);
                    return { ...msg, content: "[Decryption Failed]", createdAt: msg.created_at || msg.createdAt };
                }
            }));

            const messages = getLinearBranch(decrypted);
            return { messages, fullHistory: decrypted, getLinearBranch };
        } catch (err) {
            console.error("Failed to fetch/decrypt history:", err);
            throw err;
        }
    }, [userKeys, getLinearBranch]);

    const decryptStreamChunk = useCallback(async (
        encryptedContent: string,
        iv: string,
        encapsulatedKey?: string,
        existingSessionKey?: Uint8Array
    ): Promise<{ decrypted: string, sessionKey: Uint8Array }> => {
        if (!userKeys) throw new Error("User keys not ready");

        let sessionKey = existingSessionKey;
        const { decryptData } = await import('@/lib/crypto');
        const { ml_kem768 } = await import('@noble/post-quantum/ml-kem');

        if (encapsulatedKey && !sessionKey) {
            const encKeyBytes = Uint8Array.from(atob(encapsulatedKey), c => c.charCodeAt(0));
            const kyberPriv = userKeys.keypairs.kyberPrivateKey;
            const sharedSecret = ml_kem768.decapsulate(encKeyBytes, kyberPriv);
            sessionKey = sharedSecret;
        }

        if (!sessionKey) throw new Error("No session key available for decryption");

        try {
            if (!encryptedContent) return { decrypted: "", sessionKey };
            const decryptedBytes = decryptData(encryptedContent, sessionKey, iv);
            const decrypted = new TextDecoder().decode(decryptedBytes);
            return { decrypted, sessionKey };
        } catch (e: any) {
            if (e.message && (e.message.includes("padding") || e.message.includes("invalid"))) {
                console.warn("Soft decryption failure:", e.message);
                return { decrypted: "", sessionKey };
            }
            console.error("Critical decryption failure:", e);
            throw e;
        }
    }, [userKeys]);

    const encryptMessage = useCallback(async (content: string) => {
        if (!userKeys || !kyberPublicKey) throw new Error("Encryption keys not ready");
        const { encryptForUser } = await import('@/lib/ai-crypto');
        return encryptForUser(content, kyberPublicKey);
    }, [userKeys, kyberPublicKey]);

    const encryptWithSessionKey = useCallback(async (content: string, sessionKey: Uint8Array) => {
        const { encryptData } = await import('@/lib/crypto');
        const { encryptedData, nonce } = encryptData(new TextEncoder().encode(content), sessionKey);
        return { encryptedContent: encryptedData, iv: nonce };
    }, []);

    return {
        isReady,
        kyberPublicKey,
        userKeys,
        chats,
        loadChats,
        updateChatTimestamp,
        renameChat,
        pinChat,
        archiveChat,
        deleteChat,
        decryptHistory,
        decryptStreamChunk,
        encryptMessage,
        encryptWithSessionKey,
        getLinearBranch,
        error
    };
}
