/**
 * The parts of three.js the knowledge views use. three comes with react-force-graph-3d (the
 * same copy draws both 3D views) and ships no types to this project; these keep the code
 * that builds scene objects typed. Only what is used is declared.
 */
declare module "three" {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
  }
  export class Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }
  export class Color {
    constructor(color?: string | number);
    r: number;
    g: number;
    b: number;
    set(color: string | number | Color): this;
    copy(color: Color): this;
    lerpColors(a: Color, b: Color, t: number): this;
    multiplyScalar(s: number): this;
  }
  export class Object3D {
    position: Vector3;
    scale: Vector3;
    rotation: Euler;
    visible: boolean;
    renderOrder: number;
    frustumCulled: boolean;
    userData: Record<string, unknown>;
    children: Object3D[];
    parent: Object3D | null;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    traverse(fn: (o: Object3D) => void): void;
    raycast(...args: unknown[]): void;
  }
  export class Group extends Object3D {}
  export class Scene extends Object3D {
    fog: Fog | null;
  }
  export class Camera extends Object3D {}
  export class Light extends Object3D {
    intensity: number;
    color: Color;
  }
  export class AmbientLight extends Light {
    constructor(color?: string | number, intensity?: number);
  }
  export class DirectionalLight extends Light {
    constructor(color?: string | number, intensity?: number);
  }
  export class HemisphereLight extends Light {
    constructor(sky?: string | number, ground?: string | number, intensity?: number);
  }
  export class Fog {
    constructor(color: string | number, near?: number, far?: number);
    color: Color;
    near: number;
    far: number;
  }
  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this;
    dispose(): void;
  }
  export class BufferAttribute {
    constructor(array: Float32Array, itemSize: number);
  }
  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }
  interface MaterialOptions {
    color?: string | number | Color;
    transparent?: boolean;
    opacity?: number;
    depthWrite?: boolean;
    depthTest?: boolean;
    blending?: number;
    side?: number;
    fog?: boolean;
    toneMapped?: boolean;
    wireframe?: boolean;
    colorWrite?: boolean;
  }
  export class Material {
    opacity: number;
    transparent: boolean;
    depthWrite: boolean;
    depthTest: boolean;
    visible: boolean;
    dispose(): void;
  }
  export class MeshStandardMaterial extends Material {
    constructor(options?: MaterialOptions & { emissive?: string | number | Color; emissiveIntensity?: number; roughness?: number; metalness?: number });
    color: Color;
    emissive: Color;
    emissiveIntensity: number;
  }
  export class MeshBasicMaterial extends Material {
    constructor(options?: MaterialOptions);
    color: Color;
  }
  export class SpriteMaterial extends Material {
    constructor(options?: MaterialOptions & { map?: Texture | null; sizeAttenuation?: boolean });
    color: Color;
    map: Texture | null;
  }
  export class PointsMaterial extends Material {
    constructor(options?: MaterialOptions & { size?: number; sizeAttenuation?: boolean });
  }
  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    geometry: BufferGeometry;
    material: Material;
  }
  export class Sprite extends Object3D {
    constructor(material?: SpriteMaterial);
    material: SpriteMaterial;
  }
  export class Points extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
  }
  export class Texture {
    needsUpdate: boolean;
    colorSpace: string;
    dispose(): void;
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
  }
  export class WebGLRenderer {
    domElement: HTMLCanvasElement;
    render(scene: Scene, camera: Camera): void;
    getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  }
  export const AdditiveBlending: number;
  export const NormalBlending: number;
  export const BackSide: number;
  export const SRGBColorSpace: string;
}
