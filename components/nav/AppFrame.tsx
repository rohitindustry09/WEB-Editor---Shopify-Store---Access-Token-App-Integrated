"use client";

import "./shell.css";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActionList, Icon, Popover } from "@shopify/polaris";
import { ChevronRightIcon, LayoutSidebarLeftIcon, MenuHorizontalIcon, SearchIcon, SettingsIcon } from "@shopify/polaris-icons";
import { signOutAction } from "@/app/(auth)/actions";
import { PipelineGlobalWidget } from "@/app/(app)/tools/all-in-one/PipelineGlobalWidget";
import { AnimatedIcon } from "@/components/motion/AnimatedIcon";
import { PageMotion } from "@/components/motion/PageMotion";
import { ShellMotion, useSidebarMarker } from "@/components/motion/ShellMotion";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { CommandPalette } from "./CommandPalette";
import { StoreDomainProvider } from "./StoreContext";
import { ErrorCenterProvider } from "@/components/errors/ErrorCenter";
import { ErrorPanel } from "@/components/errors/ErrorPanel";
import { NAV_SECTIONS, activeNavUrl, type NavItem } from "./navItems";
import { useSidebarCollapsed } from "./useSidebarCollapsed";

/**
 * The app shell: a dark full-height sidebar (search, navigation, settings and the
 * store menu) with the page shown in a rounded panel beside it — the layout of
 * the current Shopify admin. The sidebar collapses to an icon-only rail (button, or
 * Ctrl/⌘ + B). On a phone it becomes a slide-in drawer.
 */
export function AppFrame({
  shopName,
  domain,
  children,
}: {
  shopName: string;
  domain: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  // Parent items the user opened or closed by hand; a parent whose page is open is always shown open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const current = activeNavUrl(pathname);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Ctrl/⌘ + K opens the search, Ctrl/⌘ + B collapses the sidebar, Escape closes the phone drawer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleCollapsed();
      } else if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const disconnect = async () => {
    await fetch("/api/disconnect", { method: "POST" });
    router.push("/connect");
    router.refresh();
  };

  const signOut = async () => {
    await signOutAction();
    router.replace("/connect");
    router.refresh();
  };

  const isGroupOpen = (item: NavItem): boolean => {
    const containsCurrent = Boolean(current && (item.url === current || item.children?.some((child) => child.url === current)));
    return toggled[item.url] ?? containsCurrent;
  };

  const initials = shopName.slice(0, 2).toUpperCase();

  // The sidebar's brass marker follows the open page, and keeps following while a group opens or the sidebar collapses.
  useSidebarMarker(`${current ?? ""}|${JSON.stringify(toggled)}|${collapsed}`);

  return (
    <StoreDomainProvider value={domain}>
    <ErrorCenterProvider>
    <div className="shell">
      <aside className="shell-sidebar" data-open={drawerOpen} aria-label="Sidebar">
        <div className="shell-top">
          <button
            type="button"
            className="shell-icon-button shell-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl B)`}
          >
            <Icon source={LayoutSidebarLeftIcon} tone="inherit" />
          </button>
          <button type="button" className="shell-search" onClick={() => setPaletteOpen(true)} aria-label="Search pages and tools (Ctrl K)" title="Search (Ctrl K)">
            <span className="shell-search-icon"><Icon source={SearchIcon} tone="inherit" /></span>
            <span className="shell-search-label">Search</span>
            <kbd className="shell-kbd">Ctrl K</kbd>
          </button>
        </div>

        <nav className="shell-nav" aria-label="Main navigation">
          <div className="shell-pill" aria-hidden="true" />
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="shell-section">
              {section.title && <div className="shell-section-title">{section.title}</div>}
              <ul className="shell-list">
                {section.items.map((item) => {
                  const open = isGroupOpen(item);
                  const isActive = current === item.url;
                  const hasChildren = Boolean(item.children?.length);
                  return (
                    <li key={item.url}>
                      <div className="shell-row">
                        <Link
                          href={item.url}
                          className="shell-item has-icon-motion"
                          data-active={isActive}
                          aria-current={isActive ? "page" : undefined}
                          title={item.label}
                          onClick={closeDrawer}
                        >
                          <span className="shell-item-icon"><AnimatedIcon source={item.icon} motion="wiggle" size={18} /></span>
                          <span className="shell-item-label">{item.label}</span>
                        </Link>
                        {hasChildren && (
                          <button
                            type="button"
                            className="shell-chevron"
                            aria-expanded={open}
                            aria-label={`${open ? "Collapse" : "Expand"} ${item.label}`}
                            onClick={() => setToggled((prev) => ({ ...prev, [item.url]: !open }))}
                          >
                            <span className="shell-chevron-icon" data-open={open}><Icon source={ChevronRightIcon} tone="inherit" /></span>
                          </button>
                        )}
                      </div>
                      {hasChildren && (
                        // Always rendered and opened with a height transition (never mounted on the spot), so a group glides open
                        // instead of popping in and shoving everything below it. `inert` keeps a closed group out of reach of the keyboard.
                        <div className="shell-sub-wrap" data-open={open}>
                          <div className="shell-sub-clip">
                            <ul className="shell-sublist" inert={!open}>
                              {item.children?.map((child) => (
                                <li key={child.url + child.label}>
                                  <Link
                                    href={child.url}
                                    className="shell-subitem"
                                    data-active={current === child.url}
                                    aria-current={current === child.url ? "page" : undefined}
                                    onClick={closeDrawer}
                                  >
                                    {child.label}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shell-bottom">
          <ThemeToggle />
          <Link href="/settings/connection" className="shell-item has-icon-motion" data-active={current === "/settings/connection"} title="Settings" onClick={closeDrawer}>
            <span className="shell-item-icon"><AnimatedIcon source={SettingsIcon} motion="spin" size={18} /></span>
            <span className="shell-item-label">Settings</span>
          </Link>
          <Popover
            active={storeMenuOpen}
            onClose={() => setStoreMenuOpen(false)}
            preferredPosition="above"
            preferredAlignment="left"
            activator={
              <button
                type="button"
                className="shell-store"
                aria-haspopup="menu"
                aria-expanded={storeMenuOpen}
                title={shopName}
                onClick={() => setStoreMenuOpen((open) => !open)}
              >
                <span className="shell-avatar" aria-hidden="true">{initials}</span>
                <span className="shell-store-text">
                  <span className="shell-store-name">{shopName}</span>
                  {domain && <span className="shell-store-domain">{domain}</span>}
                </span>
                <span className="shell-store-more"><Icon source={MenuHorizontalIcon} tone="inherit" /></span>
              </button>
            }
          >
            <ActionList
              actionRole="menuitem"
              sections={[
                {
                  items: [
                    {
                      content: "Store connection",
                      onAction: () => {
                        setStoreMenuOpen(false);
                        closeDrawer();
                        router.push("/settings/connection");
                      },
                    },
                    { content: "Disconnect store", onAction: disconnect },
                    { content: "Sign out", onAction: signOut },
                  ],
                },
              ]}
            />
          </Popover>
        </div>
      </aside>

      {drawerOpen && <button type="button" className="shell-backdrop" aria-label="Close menu" onClick={closeDrawer} />}

      <div className="shell-main">
        <div className="shell-aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="shell-mobilebar">
          <button type="button" className="shell-icon-button" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen}>
            <span className="shell-hamburger" aria-hidden="true" />
          </button>
        </div>
        <div className="shell-progress" aria-hidden="true" />
        <main className="shell-panel" id="main-content">
          {/* Keyed by the page, so every navigation replays the GSAP entrance. */}
          <PageMotion key={pathname}>{children}</PageMotion>
        </main>
      </div>

      <ShellMotion />
      <ErrorPanel />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <PipelineGlobalWidget />
    </div>
    </ErrorCenterProvider>
    </StoreDomainProvider>
  );
}
