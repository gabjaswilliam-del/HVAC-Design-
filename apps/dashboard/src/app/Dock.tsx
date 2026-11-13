import { useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useStrings } from "../lib/i18n";
import { navSearch, sectionOf, sections } from "./navigation";

const SIZE = 40;
const MAX = 0.3;
const SIGMA = 44;
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 760px)").matches;

/**
 * The dock: the primary destinations. Items magnify near the pointer (transform only),
 * a laminate indicator slides to the current section, and the dock is one tab stop with
 * arrow keys. On a phone it is a bottom tab bar.
 */
export function Dock({ inert }: { inert?: boolean }) {
  const n = useStrings().nav;
  const location = useLocation();
  const active = sectionOf(location.pathname)?.key;
  const search = navSearch(location.search);
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

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
    </nav>
  );
}
