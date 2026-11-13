/**
 * The parts of three.js and its addons used directly by the Knowledge and CAD 3D views.
 * three ships no declarations in this project; declare only the APIs these views use.
 */
declare module "three" {
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): this;
  }
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    length(): number;
    normalize(): this;
    negate(): this;
    multiplyScalar(s: number): this;
    addScaledVector(v: Vector3, s: number): this;
    applyQuaternion(q: Quaternion): this;
    applyMatrix4(m: Matrix4): this;
    project(camera: Camera): this;
    distanceTo(v: Vector3): number;
    cross(v: Vector3): this;
  }
  export class Quaternion {
    setFromUnitVectors(from: Vector3, to: Vector3): this;
  }
  export class Matrix4 {
    compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
    makeTranslation(x: number, y: number, z: number): this;
    makeBasis(x: Vector3, y: Vector3, z: Vector3): this;
    setPosition(v: Vector3): this;
  }
  export class Box3 {
    min: Vector3;
    max: Vector3;
    union(box: Box3): this;
    getCenter(target: Vector3): Vector3;
    expandByPoint(point: Vector3): this;
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
    up: Vector3;
    scale: Vector3;
    rotation: Euler;
    quaternion: Quaternion;
    visible: boolean;
    renderOrder: number;
    frustumCulled: boolean;
    userData: Record<string, unknown>;
    children: Object3D[];
    parent: Object3D | null;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    clear(): this;
    lookAt(v: Vector3): void;
    updateMatrixWorld(): void;
    traverse(fn: (o: Object3D) => void): void;
    raycast(...args: unknown[]): void;
  }
  export class Group extends Object3D {}
  export class Scene extends Object3D {
    fog: Fog | null;
    environment: Texture | null;
    environmentIntensity: number;
  }
  export class Camera extends Object3D {
    matrixWorldInverse: Matrix4;
  }
  export class OrthographicCamera extends Camera {
    constructor(left: number, right: number, top: number, bottom: number, near?: number, far?: number);
    left: number;
    right: number;
    top: number;
    bottom: number;
    zoom: number;
    updateProjectionMatrix(): void;
  }
  export class Light extends Object3D {
    intensity: number;
    color: Color;
  }
  export class AmbientLight extends Light {
    constructor(color?: string | number, intensity?: number);
  }
  export class DirectionalLight extends Light {
    constructor(color?: string | number, intensity?: number);
    target: Object3D;
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
    boundingBox: Box3 | null;
    setAttribute(name: string, attribute: BufferAttribute): this;
    applyMatrix4(matrix: Matrix4): this;
    computeBoundingBox(): void;
    dispose(): void;
  }
  export class BufferAttribute {
    constructor(array: Float32Array | number[], itemSize: number);
  }
  export class Float32BufferAttribute extends BufferAttribute {}
  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }
  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number);
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number);
  }
  export class CylinderGeometry extends BufferGeometry {
    constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean);
  }
  export class TubeGeometry extends BufferGeometry {
    constructor(path: CatmullRomCurve3, tubularSegments?: number, radius?: number, radialSegments?: number, closed?: boolean);
  }
  export class TorusGeometry extends BufferGeometry {
    constructor(radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number, arc?: number);
  }
  export class EdgesGeometry extends BufferGeometry {
    constructor(geometry: BufferGeometry, thresholdAngle?: number);
  }
  export class CatmullRomCurve3 {
    constructor(points?: Vector3[]);
  }
  interface MaterialOptions {
    color?: string | number | Color;
    map?: Texture | null;
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
    polygonOffset?: boolean;
    polygonOffsetFactor?: number;
    polygonOffsetUnits?: number;
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
    map: Texture | null;
  }
  export class LineBasicMaterial extends Material {
    constructor(options?: MaterialOptions);
    color: Color;
  }
  export class ShaderMaterial extends Material {
    constructor(options?: MaterialOptions & { uniforms?: Record<string, { value: any }>; vertexShader?: string; fragmentShader?: string });
    uniforms: Record<string, { value: any }>;
  }
  export class SpriteMaterial extends Material {
    constructor(options?: MaterialOptions & { sizeAttenuation?: boolean });
    color: Color;
    map: Texture | null;
  }
  export class PointsMaterial extends Material {
    constructor(options?: MaterialOptions & { size?: number; sizeAttenuation?: boolean });
    color: Color;
  }
  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    geometry: BufferGeometry;
    material: Material;
  }
  export class LineSegments extends Mesh {
    constructor(geometry?: BufferGeometry, material?: Material);
  }
  export class Sprite extends Object3D {
    constructor(material?: SpriteMaterial);
    material: SpriteMaterial;
  }
  export class Points extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    material: Material;
  }
  export class Texture {
    needsUpdate: boolean;
    colorSpace: string;
    dispose(): void;
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
  }
  export class WebGLRenderTarget {
    constructor(width?: number, height?: number);
    texture: Texture;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
  export interface WebGLRendererOptions {
    antialias?: boolean;
    alpha?: boolean;
  }
  export class WebGLRenderer {
    constructor(options?: WebGLRendererOptions);
    domElement: HTMLCanvasElement;
    toneMapping: number;
    autoClear: boolean;
    info: { autoReset: boolean; render: { calls: number; triangles: number }; reset(): void };
    setPixelRatio(ratio: number): void;
    getPixelRatio(): number;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setRenderTarget(target: WebGLRenderTarget | null): void;
    render(scene: Scene, camera: Camera): void;
    getContext(): WebGLRenderingContext | WebGL2RenderingContext;
    dispose(): void;
    forceContextLoss(): void;
  }
  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer);
    fromScene(scene: Scene, sigma?: number): WebGLRenderTarget;
    dispose(): void;
  }
  export class Raycaster {
    setFromCamera(coords: Vector2, camera: Camera): void;
    intersectObjects<T extends Object3D>(objects: T[], recursive?: boolean): { object: T }[];
  }
  export const MOUSE: { ROTATE: number; DOLLY: number; PAN: number };
  export const TOUCH: { PAN: number; DOLLY_ROTATE: number };
  export const NeutralToneMapping: number;
  export const AdditiveBlending: number;
  export const NormalBlending: number;
  export const BackSide: number;
  export const SRGBColorSpace: string;
}

declare module "three/addons/controls/MapControls.js" {
  import type { Camera, Vector3 } from "three";
  export class MapControls {
    constructor(camera: Camera, element: HTMLCanvasElement);
    target: Vector3;
    cursorStyle: "auto" | "grab";
    enableDamping: boolean;
    zoomToCursor: boolean;
    minPolarAngle: number;
    maxPolarAngle: number;
    minAzimuthAngle: number;
    maxAzimuthAngle: number;
    minZoom: number;
    maxZoom: number;
    mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
    touches: { ONE: number; TWO: number };
    update(): void;
    dispose(): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  }
}

declare module "three/addons/environments/RoomEnvironment.js" {
  import { Scene } from "three";
  export class RoomEnvironment extends Scene {}
}

declare module "three/addons/utils/BufferGeometryUtils.js" {
  import type { BufferGeometry } from "three";
  export function mergeGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry;
}
