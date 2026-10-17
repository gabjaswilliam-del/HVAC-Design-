import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Keyboard, Server } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { useDismissOutside, useEscapeLayer } from "../components/escape";
import { navSearch, sectionOf, sections, segmentOf, systemLinks } from "./navigation";

const SIZE = 40;
const MAX = 0.3;
const SIGMA = 44;
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 760px)").matches;

/**
 * The dock: primary destinations, then Shortcuts and System at its foot. Items
 * magnify near the pointer (transform only), a laminate indicator slides to the
 * current section, and the dock is one tab stop with arrow keys. On a phone it is a
 * bottom tab bar.
 */
export function Dock({ onShortcuts, shortcutsOpen, inert }: { onShortcuts: () => void; shortcutsOpen: boolean; inert?: boolean }) {
  const s = useStrings();
  const n = s.nav;
  const location = useLocation();
  const active = sectionOf(location.pathname)?.key;
  const search = navSearch(location.search);
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const systemButton = useRef<HTMLButtonElement>(null);
  const onSystem = systemLinks.some((l) => l.path.slice(1) === segmentOf(location.pathname));
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEscapeLayer(menuOpen, () => {
    setMenuOpen(false);
    systemButton.current?.focus();
  });
  useDismissOutside(menuOpen, menuRef, () => setMenuOpen(false), systemButton);

  // The indicator follows the current section; it slides only after the first placement.
  useLayoutEffect(() => {
    const place = () => {
      const el = nav.current?.querySelector<HTMLElement>('.dock__list--main [aria-current="page"]');
      const ind = indicator.current;
      if (!ind || !nav.current) return;
      ind.hidden = !el;
      if (!el) return;
      const nr = nav.current.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      ind.style.transition = placed.current ? "" : "none";
      ind.style.setProperty("--ind-y", `${r.top - nr.top + r.height / 2 - 10}px`);
      placed.current = true;
    };
    place();
    window.addEventListener("resize", place);
    document.fonts?.ready.then(place);
    return () => window.removeEventListener("resize", place);
  }, [active]);

  const items = () => Array.from(nav.current?.querySelectorAll<HTMLElement>(".dock__item") ?? []);
  const onPointerMove = (e: React.PointerEvent) => {
    if (reduceMotion() || phone() || e.pointerType === "touch") return;
    const list = items();
    const centres = list.map((it) => {
      const r = it.getBoundingClientRect();
      const shift = parseFloat(it.style.getPropertyValue("--shift")) || 0;
      return r.top + r.height / 2 - shift;
    });
    const scales = centres.map((c) => 1 + MAX * Math.exp(-((e.clientY - c) ** 2) / (2 * SIGMA * SIGMA)));
    const extra = scales.map((x) => (x - 1) * SIZE);
    list.forEach((it, i) => {
      const before = extra.slice(0, i).reduce((a, b) => a + b, 0);
      const after = extra.slice(i + 1).reduce((a, b) => a + b, 0);
      it.style.setProperty("--s", scales[i].toFixed(3));
      it.style.setProperty("--shift", `${((before - after) / 2).toFixed(1)}px`);
    });
  };
  const onPointerLeave = () =>
    items().forEach((it) => {
      it.style.setProperty("--s", "1");
      it.style.setProperty("--shift", "0px");
    });

  // One tab stop: the current section (or the first item); arrows move between items.
  const currentIndex = sections.findIndex((x) => x.key === active);
  const stop = focusIndex ?? (currentIndex >= 0 ? currentIndex : 0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (!step || i < 0) return;
    e.preventDefault();
    const next = (i + step + all.length) % all.length;
    setFocusIndex(next);
    all[next].focus();
  };

  return (
    <nav ref={nav} className="dock" inert={inert} aria-label={n.label} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onKeyDown={onKeyDown} onBlur={(e) => !nav.current?.contains(e.relatedTarget as Node) && setFocusIndex(null)}>
      <span ref={indicator} className="dock__indicator" aria-hidden="true" />
      <ul className="dock__list dock__list--main">
        {sections.map((sec, i) => (
          <li key={sec.key}>
            <Link
              to={{ pathname: sec.path, search }}
              className="dock__item"
              aria-current={active === sec.key ? "page" : undefined}
              tabIndex={stop === i ? 0 : -1}
              aria-label={n.sections[sec.key]}
            >
              <sec.icon size={20} aria-hidden="true" />
              <span className="dock__label" aria-hidden="true">
                {n.sections[sec.key]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="dock__list dock__list--foot">
        <li>
          <button
            type="button"
            className="dock__item"
            aria-label={s.dock.shortcuts}
            aria-expanded={shortcutsOpen}
            aria-haspopup="dialog"
            tabIndex={stop === sections.length ? 0 : -1}
            onClick={onShortcuts}
            data-shortcuts-opener
          >
            <Keyboard size={20} aria-hidden="true" />
            <span className="dock__label" aria-hidden="true">
              {s.dock.shortcuts}
            </span>
          </button>
        </li>
        <li className="dock__system">
          <button
            type="button"
            ref={systemButton}
            className="dock__item"
            aria-label={n.system}
            aria-expanded={menuOpen}
            aria-controls="system-menu"
            aria-current={onSystem ? "page" : undefined}
            tabIndex={stop === sections.length + 1 ? 0 : -1}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Server size={20} aria-hidden="true" />
            <span className="dock__label" aria-hidden="true">
              {n.system}
            </span>
          </button>
          <div id="system-menu" ref={menuRef} className="system-menu" hidden={!menuOpen} role="group" aria-label={n.systemMenu}>
            <p className="system-menu__status">{n.systemStatus}</p>
            <ul>
              {systemLinks.map((l) => (
                <li key={l.path}>
                  <Link to={{ pathname: l.path, search }} className="system-menu__link" title={n.plannedTitle(l.planned)}>
                    <l.icon size={16} aria-hidden="true" />
                    {n.pages[l.page]}
                    <span className="tag-chip tag-chip--planned">{n.planned}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </li>
      </ul>
    </nav>
  );
}
