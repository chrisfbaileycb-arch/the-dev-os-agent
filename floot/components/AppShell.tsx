import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Zap, Layers3, Network, Database, Clock3, Settings2, Menu, Globe2, ChevronRight, HardDrive } from "lucide-react";
import { Button } from "./Button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./Sheet";
import { ThemeModeSwitch } from "./ThemeModeSwitch";
import { useConnection } from "../helpers/useConnection";
import { providerCatalog } from "../helpers/providerCatalog";
import styles from "./AppShell.module.css";

const navItems = [
  { to: "/", label: "Workspace", icon: Layers3 },
  { to: "/agents", label: "Agent team", icon: Network },
  { to: "/knowledge", label: "Knowledge", icon: Database },
  { to: "/history", label: "Run history", icon: Clock3 },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

export const AppShell = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { connection } = useConnection();
  const current = navItems.find((n) => n.to === location.pathname) ?? navItems[0];
  const chip = connection.mode === "demo" ? "Scripted preview" : `${providerCatalog[connection.provider].name} / ${connection.model || "no model"}`;

  const sidebarBody = (
    <>
      <Link to="/" className={styles.brand} aria-label="FreeToken Web home" onClick={() => setOpen(false)}>
        <span className={styles.brandMark}><Zap size={18} strokeWidth={2} /></span>
        <span className={styles.brandName}>FreeToken<span className={styles.brandEdition}>Web</span></span>
      </Link>
      <div className={styles.navLabel}>Workspace</div>
      <nav className={styles.nav} aria-label="Primary">
        {navItems.map((n) => {
          const active = n.to === location.pathname;
          return (
            <Link key={n.to} to={n.to} className={active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
              <n.icon size={17} strokeWidth={1.75} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.sidebarBottom}>
        <div className={styles.browserCard}>
          <Globe2 size={17} strokeWidth={1.75} />
          <strong>All you need is a tab.</strong>
          <p>Your workspace runs in the browser. No installs, no local server, no account.</p>
        </div>
        <div className={styles.profile}>
          <div className={styles.profileAvatar} aria-hidden="true"><HardDrive size={15} strokeWidth={1.75} /></div>
          <div className={styles.profileText}>
            <strong>Your workspace</strong>
            <small>Stored in this browser</small>
          </div>
          <span className={styles.version}>v0.1</span>
        </div>
      </div>
    </>
  );

  return (
    <div className={`${styles.shell} ${className ?? ""}`}>
      <aside className={styles.sidebar}>{sidebarBody}</aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <Button variant="ghost" size="icon" className={styles.menuButton} aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={18} /></Button>
          <div className={styles.breadcrumb}><span>Personal workspace</span><ChevronRight size={14} aria-hidden="true" /><strong>{current.label}</strong></div>
          <div className={styles.topbarRight}>
            <Link to="/settings" className={styles.providerChip}>
              <span className={connection.mode === "demo" ? styles.dotIdle : styles.dotLive} aria-hidden="true" />
              <span className={styles.chipText}>{chip}</span>
            </Link>
            <ThemeModeSwitch />
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className={styles.sheet}>
          <SheetTitle className={styles.srOnly}>Navigation</SheetTitle>
          <SheetDescription className={styles.srOnly}>Move between workspace pages</SheetDescription>
          {sidebarBody}
        </SheetContent>
      </Sheet>
    </div>
  );
};
