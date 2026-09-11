import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { Link, useLocation } from "react-router-dom";
import { Zap, Layers3, Network, Database, Clock3, Settings2, Menu, Globe2, ChevronRight, HardDrive } from "lucide-react";
import { Button } from "./Button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./Sheet";
import { ThemeModeSwitch } from "./ThemeModeSwitch";
import { useConnection } from "../helpers/useConnection";
import { useInstallPrompt } from "../helpers/useInstallPrompt";
import { providerCatalog } from "../helpers/providerCatalog";
import styles from "./AppShell.module.css";

const navItems = [
  { to: "/", label: "Workspace", icon: Layers3 },
  { to: "/agents", label: "Agent team", icon: Network },
  { to: "/knowledge", label: "Knowledge", icon: Database },
  { to: "/history", label: "Run history", icon: Clock3 },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

// Hosted icon assets (Floot Storage). The manifest at static/manifest.json points at the same files.
const FAVICON = "/_cdn/static/b2eddd1a-0dbc-419f-833d-162fc8e58bf6-favicon-32.png";
const TOUCH_ICON = "/_cdn/static/37fab768-fab0-403b-ac3e-e1f7f4ea191f-icon-192.png";

export const AppShell = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { connection } = useConnection();
  const { canInstall, installed } = useInstallPrompt();
  const current = navItems.find((n) => n.to === location.pathname) ?? navItems[0];
  const chip = connection.mode === "demo" ? "Scripted preview" : `${providerCatalog[connection.provider].name} / ${connection.model || "no model"}`;
  const browserNote = installed
    ? "Running as an installed app. Your work stays in this browser."
    : canInstall
      ? "Your workspace runs in the browser. Add it to your shelf from Settings."
      : "Your workspace runs in the browser. No local server, no account.";

  const sidebarBody = (
    <>
      <Link to="/" className={styles.brand} aria-label="Hey Buddy home" onClick={() => setOpen(false)}>
        <span className={styles.brandMark}><Zap size={18} strokeWidth={2} /></span>
        <span className={styles.brandName}>Hey Buddy<span className={styles.brandEdition}>Web</span></span>
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
          <p>{browserNote}</p>
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
    <>
      <Helmet>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#171d2b" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Hey Buddy" />
        <link rel="icon" href={FAVICON} sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href={TOUCH_ICON} />
      </Helmet>
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
    </>
  );
};
