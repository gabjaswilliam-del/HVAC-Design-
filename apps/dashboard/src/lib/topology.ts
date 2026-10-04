/** Display helpers over the site topology shared by several features. */
import type { Link } from "./contracts";

export type Medium = "cw-hot" | "cw-cool" | "chw-supply" | "chw-return";

export const BUS_MEDIUM: Record<string, Medium> = {
  cw_supply: "cw-cool",
  cw_return: "cw-hot",
  chw_supply: "chw-supply",
  chw_return: "chw-return",
};

/** Drawn medium of a link: its bus's medium, or the supply side of its loop. */
export function linkMedium(link: Link): Medium {
  const end = [link.from, link.to].find((e): e is { bus: string } => "bus" in e);
  if (end) return BUS_MEDIUM[end.bus];
  return link.medium === "cw" ? "cw-cool" : "chw-supply";
}

export const devicesOf = (link: Link) => [link.from, link.to].flatMap((e) => ("device" in e ? [e.device] : []));
export const busesOf = (link: Link) => [link.from, link.to].flatMap((e) => ("bus" in e ? [e.bus] : []));
