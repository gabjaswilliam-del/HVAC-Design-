/**
 * Stands in for `three/webgpu` (see vite.config.ts). three-render-objects imports its
 * WebGPURenderer for an option this app never sets (`useWebGPU`); without the stand-in the
 * whole WebGPU renderer and node system would ship in the 3D chunk. Using it fails loudly.
 */
export class WebGPURenderer {
  constructor() {
    throw new Error("WebGPU rendering is not included in this build.");
  }
}
