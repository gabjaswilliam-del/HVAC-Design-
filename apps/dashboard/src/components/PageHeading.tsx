import { useEffect, useRef, type ReactNode } from "react";

// Set when the screen changes; the next page heading to mount takes focus. This does
// not depend on when the router commits the new route, unlike a timer in the shell.
let pending = false;
export const requestHeadingFocus = () => {
  pending = true;
};

/** A page's h1: programmatically focusable, and focused after screen navigation. */
export function PageHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // After every render, not only on mount: two screens can share one page component
  // (React then keeps the same heading), and a screen change must still move focus.
  useEffect(() => {
    if (!pending) return;
    pending = false;
    ref.current?.focus();
  });
  return (
    <h1 ref={ref} tabIndex={-1}>
      {children}
    </h1>
  );
}
