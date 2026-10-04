import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Beaker, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { navGroups } from "./navigation";
import "./app.css";

export function AppShell() {
  const s = useStrings();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastPath = useRef(location.pathname);

  // Move focus to the new page heading on navigation (not on first load). Compare
  // paths rather than counting renders so StrictMode's double effect run is harmless.
  useEffect(() => {
    setDrawerOpen(false);
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [location.pathname]);

  return (
    <div className={`shell${collapsed ? " shell--collapsed" : ""}${drawerOpen ? " shell--drawer" : ""}`}>
      <a className="skip-link" href="#main">
        {s.app.skipToContent}
      </a>
      <header className="site-header">
        <button
          type="button"
          className="icon-button site-header__menu"
          aria-label={drawerOpen ? s.header.closeNavigation : s.header.openNavigation}
          aria-expanded={drawerOpen}
          aria-controls="main-navigation"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          {drawerOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="site-header__identity">
          <span className="site-header__product">{s.app.productName}</span>
          <span className="site-header__site">{s.app.siteLabel}</span>
        </div>
        <span className="data-mode-badge" title={s.dataMode.demoDescription}>
          <Beaker size={15} aria-hidden="true" />
          {s.dataMode.demo}
        </span>
        <div className="site-header__context">
          <span className="site-header__label">{s.header.source}</span>
          <span>{s.header.demoReplay}</span>
        </div>
      </header>

      <nav id="main-navigation" className="main-nav" aria-label={s.nav.label}>
        {navGroups.map((group) => (
          <div className="main-nav__group" key={group.key}>
            <h2 className="main-nav__group-label">{s.nav.groups[group.key]}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    to={item.path}
                    end={item.path === "/"}
                    className="main-nav__link"
                    title={collapsed ? s.nav[item.key] : undefined}
                  >
                    <item.icon size={18} aria-hidden="true" />
                    <span className="main-nav__text">{s.nav[item.key]}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          type="button"
          className="main-nav__collapse"
          aria-label={collapsed ? s.header.expandNavigation : s.header.collapseNavigation}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </nav>
      {drawerOpen && <div className="nav-scrim" onClick={() => setDrawerOpen(false)} />}

      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}
