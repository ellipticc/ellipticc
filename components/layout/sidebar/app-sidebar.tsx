"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  IconHelpCircle,
  IconCaretLeftRightFilled,
  IconAdjustments,
  IconStack2,
  IconBubbleText,
  IconLayoutSidebar,
  IconSearch,
  IconWritingSign,
  IconEdit,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"

import { NavMain } from "@/components/layout/navigation/nav-main"
import { NavSecondary } from "@/components/layout/navigation/nav-secondary"
import { NavUser } from "@/components/layout/navigation/nav-user"

import { NavHistory, NavPinned } from "@/components/layout/navigation/nav-assistant"
import {
  Sidebar,
  SidebarTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { useGlobalUpload } from "@/components/global-upload-context"
import { useUser } from "@/components/user-context"
import { useAICrypto } from "@/hooks/use-ai-crypto"
import { getDiceBearAvatar } from "@/lib/avatar"
import { useLanguage } from "@/lib/i18n/language-context"
import { GlobalSearch } from "./global-search"

const defaultUser = {
  name: "Loading...",
  email: "loading@example.com",
  avatar: getDiceBearAvatar("loading"),
  id: "",
}

export const AppSidebar = React.memo(function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { t } = useLanguage()
  const { handleFileUpload, handleFolderUpload } = useGlobalUpload()
  const { user: contextUser, loading: userLoading } = useUser()
  const { toggleSidebar, state, isMobile, setOpenMobile } = useSidebar()
  const { chats, renameChat, pinChat, deleteChat, archiveChat } = useAICrypto();
  const chatActions = React.useMemo(() => ({ renameChat, pinChat, deleteChat, archiveChat }), [renameChat, pinChat, deleteChat, archiveChat]);
  const [searchOpen, setSearchOpen] = React.useState(false)
  // filter applied when opening search via sidebar items ('pinned' or 'history')
  const [searchFilter, setSearchFilter] = React.useState<'pinned' | 'history' | null>(null)

  // Keyboard shortcut for search (Cmd+K) and new chat (Ctrl+Shift+O)
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Ignore input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
      if (e.key === "O" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        router.push('/')
      }

      // Single key shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key === "v") {
          e.preventDefault();
          router.push('/v');
        }
        if (e.key === "d") {
          e.preventDefault();
          router.push('/p/new');
        }
        if (e.key === "s") {
          e.preventDefault();
          window.location.hash = '#settings/General';
        }
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [router])

  // Close sidebar on mobile after navigation
  React.useEffect(() => {
    if (isMobile && state === "expanded") {
      setOpenMobile(false);
    }
  }, [pathname, isMobile, state]);

  const isChat = pathname === '/' || pathname === '/new' || pathname.startsWith('/c/') || pathname.startsWith('/paper') || pathname.startsWith('/p/');

  const data = {
    user: contextUser ? {
      name: contextUser.name || "",
      email: contextUser.email,
      avatar: contextUser.avatar || getDiceBearAvatar(contextUser.id),
      id: contextUser.id,
      is_checkmarked: contextUser.is_checkmarked,
      show_checkmark: contextUser.show_checkmark,
    } : defaultUser,
    navMain: [
      {
        title: "Vault",
        url: "/v",
        icon: IconStack2,
        id: "my-files",
        shortcut: "V",
        isMuted: isChat && !pathname.startsWith('/v'),
      },
      {
        title: "Draft",
        url: "/p/new",
        icon: IconWritingSign,
        id: "draft",
        shortcut: "D",
        isMuted: isChat && !pathname.startsWith('/p/new'),
      },
    ],
    navSecondary: [
      {
        title: t("sidebar.settings"),
        url: "#",
        icon: IconAdjustments,
        id: "settings",
        shortcut: "S",
      },
      {
        title: t("sidebar.getHelp"),
        url: "#",
        icon: IconHelpCircle,
        id: "help",
        shortcut: "H",
      },
      {
        title: t("sidebar.feedback"),
        url: "#",
        icon: IconBubbleText,
        id: "feedback",
        shortcut: "F",
      },
    ],
  }

  const [isAuthenticated, setIsAuthenticated] = React.useState(false)

  React.useEffect(() => {
    const checkAuth = async () => {
      // Check if token exists
      let token = localStorage.getItem('auth_token');

      if (!token) {
        // Try to get from cookies
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=');
          if (name === 'auth_token') {
            token = decodeURIComponent(value);
            break;
          }
        }
      }

      if (!token) {
        // Redirect to login if no token
        window.location.href = '/login'
        return
      }

      // Check if token is expired
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const currentTime = Math.floor(Date.now() / 1000);
        if (payload.exp < currentTime) {
          // Token is expired, clear it and redirect to login
          localStorage.removeItem('auth_token');
          localStorage.removeItem('master_key');
          localStorage.removeItem('account_salt');
          localStorage.removeItem('viewMode');
          document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          window.location.href = '/login';
          return;
        }
      } catch {
        // If we can't decode the token, consider it invalid
        localStorage.removeItem('auth_token');
        localStorage.removeItem('master_key');
        localStorage.removeItem('account_salt');
        localStorage.removeItem('viewMode');
        document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        window.location.href = '/login';
        return;
      }

      setIsAuthenticated(true)
    }

    checkAuth()
  }, [contextUser])

  // If user is loading, render a sidebar skeleton immediately so layout doesn't shift
  if (!isAuthenticated && userLoading) {
    return (
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader className="gap-2 p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <div className="flex items-center gap-2">
                  <IconCaretLeftRightFilled className="size-4 shrink-0 opacity-40" />
                  <span className="text-base font-geist-mono select-none break-all leading-none opacity-40">ellipticc</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <div className="px-3 py-3">
            <Skeleton className="h-3 w-3/4 mb-2" />
            <Skeleton className="h-3 w-1/2 mb-2" />
            <Skeleton className="h-3 w-2/3 mb-2" />
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="px-3 py-3 mx-2 mb-2 text-xs text-muted-foreground w-auto space-y-3 bg-muted/30 rounded-lg border border-border/30">
            <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
          </div>
        </SidebarFooter>
      </Sidebar>
    );
  }

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        "transition-[width,background-color] duration-300 ease-in-out",
        isChat && "dark:bg-muted/10",
        props.className
      )}
      {...props}
    >
      <SidebarHeader className="gap-2 p-2 relative z-20">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:hidden">
              <SidebarMenuButton asChild className="flex-1">
                <Link href="/" className="flex items-center gap-2">
                  <IconCaretLeftRightFilled className="size-4 shrink-0 text-primary" />
                  <span className="text-base font-geist-mono select-none break-all leading-none">ellipticc</span>
                </Link>
              </SidebarMenuButton>
              <SidebarTrigger className="ml-1" tooltip={{
                children: (
                  <div className="flex items-center gap-2">
                    {state === "expanded" ? "Collapse" : "Expand"}
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                      <span className="text-xs">⌘</span>B
                    </kbd>
                  </div>
                )
              }} />
            </div>

            <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
              <SidebarMenuButton
                className="relative group/toggle-icon hover:bg-transparent"
                onClick={toggleSidebar}
                tooltip={{
                  children: (
                    <div className="flex items-center gap-2">
                      {t("common.toggleSidebar") || "Toggle Sidebar"}
                      <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                        <span className="text-xs">⌘</span>B
                      </kbd>
                    </div>
                  )
                }}
              >
                <IconCaretLeftRightFilled className="size-4 shrink-0 transition-opacity group-hover/toggle-icon:opacity-0" />
                <IconLayoutSidebar className="size-4 shrink-0 absolute inset-0 m-auto opacity-0 transition-opacity group-hover/toggle-icon:opacity-100" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu className="mt-3 mb-1">
          {/* Search button */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => { setSearchFilter(null); setSearchOpen(true); }}
              tooltip={{
                children: (
                  <div className="flex items-center gap-1">
                    Search
                    <Kbd>
                      <span className="text-[10px]">Ctrl</span>K
                    </Kbd>
                  </div>
                ),
                side: "right",
                hidden: state !== "collapsed"
              }}
              className={cn(
                "relative group/menu-button font-medium transition-all group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0 pl-2",
                searchOpen && "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
            >
              <IconSearch />
              <span className="group-data-[collapsible=icon]:hidden">Search</span>
              <kbd className="pointer-events-none ml-auto h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground inline-flex group-data-[collapsible=icon]:hidden">
                <span className="text-[10px]">Ctrl</span>K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="flex-1 gap-0">
        <SidebarGroup className="py-0">
          <SidebarGroupContent>
            <SidebarMenu className="mt-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={{
                    children: (
                      <div className="flex items-center gap-1">
                        New Chat
                        <Kbd>
                          <span className="text-[9px]">⌘⇧</span>O
                        </Kbd>
                      </div>
                    ),
                    side: "right",
                    hidden: state !== "collapsed"
                  }}
                  isActive={pathname === '/'}
                  className="relative group/menu-button group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0 pl-2"
                >
                  <Link href="/">
                    <IconEdit className="size-4 shrink-0" />
                    <span className="group-data-[collapsible=icon]:hidden">Chat</span>
                    <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-0 group-hover/menu-button:opacity-60 transition-opacity flex group-data-[collapsible=icon]:hidden sm:flex">
                      <span className="text-[9px]">⌘⇧</span>O
                    </kbd>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <NavPinned onSearchOpen={() => { setSearchFilter('pinned'); setSearchOpen(true); }} chats={chats} actions={chatActions} />
              <NavHistory onSearchOpen={() => { setSearchFilter('history'); setSearchOpen(true); }} chats={chats} actions={chatActions} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavMain items={data.navMain} />

        <GlobalSearch
          open={searchOpen}
          onOpenChange={(open) => {
            setSearchOpen(open);
            if (!open) setSearchFilter(null);
          }}
          filter={searchFilter}
        />
      </SidebarContent>
      <SidebarFooter className="mt-auto relative z-20">
        <NavSecondary items={data.navSecondary} />
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar >
  )
})
