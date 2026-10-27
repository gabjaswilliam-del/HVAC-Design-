/**
 * The sky behind the knowledge graphs (the RAG Graph's systems, Graph Memory's timeline):
 * still, faint stars, the same on every visit (a seeded generator, mulberry32). Two layers
 * whose tiles differ in size, so the pattern never visibly repeats: many small dim stars, and
 * a few brighter ones with a soft halo. All are far smaller and dimmer than any node (1.35 px
 * at most, against 4 px or more) and colourless, so none reads as data. A CSS background.
 */
export const SKY = (() => {
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const halo = "<defs><radialGradient id='h'><stop offset='0' stop-color='rgba(214,224,239,0.16)'/><stop offset='1' stop-color='rgba(214,224,239,0)'/></radialGradient></defs>";
  const layer = (w: number, h: number, count: number, bright: number) => {
    let stars = "";
    for (let i = 0; i < count; i++) {
      const x = (rand() * w).toFixed(1);
      const y = (rand() * h).toFixed(1);
      const big = rand() < bright;
      const r = big ? 0.9 + rand() * 0.45 : 0.5 + rand() * 0.4;
      const alpha = (big ? 0.5 + rand() * 0.25 : 0.2 + rand() * 0.3).toFixed(2);
      const fill = rand() < 0.15 ? `rgba(242,230,212,${alpha})` : `rgba(214,224,239,${alpha})`;
      if (big) stars += `<circle cx='${x}' cy='${y}' r='${(r * 4).toFixed(1)}' fill='url(#h)'/>`;
      stars += `<circle cx='${x}' cy='${y}' r='${r.toFixed(2)}' fill='${fill}'/>`;
    }
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${halo}${stars}</svg>`)}")`;
  };
  return `${layer(1187, 997, 190, 0)}, ${layer(1543, 1301, 55, 0.4)}`;
})();
