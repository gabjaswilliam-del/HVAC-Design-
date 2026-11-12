interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const offsets = [
  [0, 0], [0, 18], [0, -18], [18, 0], [-18, 0],
  [0, 36], [0, -36], [28, 18], [-28, 18], [28, -18], [-28, -18], [0, 54], [0, -54], [48, 36], [-48, 36],
];

function overlaps(a: Bounds, b: Bounds) {
  return a.left < b.right + 2 && a.right > b.left - 2
    && a.top < b.bottom + 2 && a.bottom > b.top - 2;
}

/** Keep fixed-size HTML callouts clear of the zoomed SVG and the stage controls. */
export function placeOverviewCallouts(box: HTMLElement, visibleWidth: number) {
  const stage = box.closest(".stage") ?? box.parentElement!;
  const area = box.getBoundingClientRect();
  const occupied: Bounds[] = Array.from(stage.querySelectorAll(
    ".eq-node__art, .eq-node__frame--selected, .eq-badge, .eq-node__label, .viewswitch, .stage-controls, .stage-note",
  ), (el) => el.getBoundingClientRect());
  const callouts = [".hang", ".lbl", ".key"].flatMap((selector) =>
    Array.from(box.querySelectorAll<HTMLElement>(selector)),
  );

  for (const el of callouts) {
    delete el.dataset.overviewOccluded;
    el.style.removeProperty("--overview-callout-offset");
  }

  const measured = callouts.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  for (const { el, rect } of measured) {
    const string = el.classList.contains("hang")
      ? el.parentElement?.querySelector<HTMLElement>(".hang__string")
      : null;
    const placement = offsets.find(([x, y]) => {
      const moved = {
        left: rect.left + x, right: rect.right + x,
        top: rect.top + y, bottom: rect.bottom + y,
      };
      return moved.left >= area.left && moved.right <= area.left + visibleWidth
        && moved.top >= area.top && moved.bottom <= area.bottom
        && occupied.every((obstacle) => !overlaps(moved, obstacle));
    });

    if (placement) {
      const [x, y] = placement;
      el.style.setProperty("--overview-callout-offset", `${x}px ${y}px`);
      occupied.push({
        left: rect.left + x, right: rect.right + x,
        top: rect.top + y, bottom: rect.bottom + y,
      });
      if (string) string.toggleAttribute("data-overview-occluded", x !== 0 || y !== 0);
    } else {
      // Alarms remain actionable. Dense secondary readings are available via zoom or Details.
      if (!el.classList.contains("hang") && !el.contains(document.activeElement)) el.dataset.overviewOccluded = "";
      if (string) string.dataset.overviewOccluded = "";
    }
  }
}
