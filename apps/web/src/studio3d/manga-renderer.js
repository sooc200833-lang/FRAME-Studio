// Manga-style rendering for the 3D Background Studio.
//
// 1. The lit scene is rendered into a colour target that also keeps depth.
// 2. The scene is rendered again with normals.
// 3. A full-screen pass draws ink where depth jumps (silhouettes, overlaps)
//    or the surface direction turns (creases), optionally replaces mid tones
//    with a dot screen, and lays everything on paper (or keeps it transparent).
//
// Lines come from the image, not from mesh edges, so every object gets clean
// outlines without extra geometry. (Idea: screen-space ink from depth, as in
// many NPR renderers; the shader here is written for this project.)

import {
  Color, DepthTexture, FloatType, HalfFloatType, Mesh, MeshNormalMaterial, NearestFilter, NoBlending, OrthographicCamera,
  PlaneGeometry, RGBAFormat, Scene, ShaderChunk, ShaderMaterial, UnsignedByteType, UnsignedIntType, Vector2, WebGLRenderTarget,
} from 'three';
import { lineStyleParams } from './line-style.js';

export const PAPER_COLOR = '#f4f1ea';
export const INK_COLOR = '#1c1b20';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  ${ShaderChunk.packing}
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 resolution;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform bool orthographic;
  uniform bool ink;
  uniform float inkWidth;
  uniform float depthSensitivity;
  uniform bool tone;
  uniform float toneSize;
  uniform bool transparent;
  uniform vec3 paper;
  uniform vec3 inkColor;
  uniform bool encodeOutput;
  varying vec2 vUv;

  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  float viewDistance(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    if (depth >= 0.99999) return cameraFar;
    float viewZ = orthographic
      ? orthographicDepthToViewZ(depth, cameraNear, cameraFar)
      : perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    return -viewZ;
  }

  vec3 normalAt(vec2 uv) {
    return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0);
  }

  // Hand-drawn line style (see line-style.js). Lengths are CSS px.
  uniform float pixelScale;
  uniform float lineOutline;
  uniform float lineCrease;
  uniform float lineTaper;
  uniform float lineWobble;
  uniform float lineWobbleSize;
  uniform float lineJitter;
  uniform float lineGrain;
  uniform float lineBreakup;
  uniform float lineSketch;
  uniform float lineOpacity;
  // Line re-draw (boil) step: each step shifts every noise field, so the
  // same lines come out drawn a little differently.
  uniform float lineSeed;

  vec2 boilShift() {
    // Small offsets keep the hash precise (large coordinates lose bits).
    float s = mod(lineSeed, 97.0);
    return vec2(fract(s * 0.618034) * 61.0, fract(s * 0.414214) * 47.0);
  }

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Smooth value noise in [0, 1].
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // Position in viewport CSS pixels, so noise looks the same at any export size.
  vec2 cssPosition(vec2 uv) {
    return uv * resolution / pixelScale;
  }

  // Where to look for the edge: a little off the exact spot, so lines wander.
  vec2 wobbled(vec2 uv, float seed) {
    if (lineWobble <= 0.0) return uv;
    vec2 q = cssPosition(uv) / lineWobbleSize + seed + boilShift();
    vec2 shift = vec2(noise(q), noise(q + 17.3)) * 2.0 - 1.0;
    return uv + shift * lineWobble * pixelScale / resolution;
  }

  // Ink strength at uv. Depth lines (silhouettes, overlaps) use the outline
  // width, folds the crease width; both thin out with distance and vary along
  // the line with jitter.
  float edgeAt(vec2 uv, float widthScale) {
    float centre = viewDistance(uv);
    vec3 n = normalAt(uv);
    bool centreEmpty = texture2D(tColor, uv).a < 0.01;
    float taper = mix(1.0, clamp(8.0 / max(centre, 1e-3), 0.35, 1.0), lineTaper);
    float jitter = lineJitter > 0.0
      ? max(0.25, 1.0 + lineJitter * (noise(cssPosition(uv) / (lineWobbleSize * 0.6) + 31.7 + boilShift()) * 2.0 - 1.0))
      : 1.0;
    float base = inkWidth * widthScale * taper * jitter;
    // Never thinner than the old minimum width (0.5 CSS px).
    float radiusOut = max(base * lineOutline, 0.5 * pixelScale);
    vec2 pxOut = radiusOut / resolution;
    // A wider line compares points further apart, so even a tilted flat
    // surface shows a depth change; judge the jump per base width instead.
    float spread = max(1.0, radiusOut / max(inkWidth, 1e-3));
    vec2 pxIn = max(base * lineCrease, 0.5 * pixelScale) / resolution;
    float edge = 0.0;
    vec2 dirs[8];
    dirs[0] = vec2(1.0, 0.0); dirs[1] = vec2(-1.0, 0.0);
    dirs[2] = vec2(0.0, 1.0); dirs[3] = vec2(0.0, -1.0);
    dirs[4] = vec2(1.0, 1.0); dirs[5] = vec2(-1.0, -1.0);
    dirs[6] = vec2(1.0, -1.0); dirs[7] = vec2(-1.0, 1.0);
    // Relative depth jump: 2–25 % depending on sensitivity.
    float depthThreshold = mix(0.25, 0.02, depthSensitivity);
    for (int i = 0; i < 8; i++) {
      vec2 sampleUv = uv + dirs[i] * pxOut;
      bool otherEmpty = texture2D(tColor, sampleUv).a < 0.01;
      // Each boundary is inked on one side only, so a line is one width wide
      // (not twice that): depth/silhouette lines on the farther side, crease
      // lines from the positive-direction neighbours.
      if (centreEmpty && otherEmpty) continue;
      if (centreEmpty) { edge = 1.0; break; }
      if (otherEmpty) continue;
      float other = viewDistance(sampleUv);
      if (other < centre) {
        float jump = (centre - other) / max(other, 1e-3) / spread;
        edge = max(edge, smoothstep(depthThreshold, depthThreshold * 1.6, jump));
      }
      if (i == 0 || i == 2 || i == 4 || i == 6) {
        vec2 creaseUv = uv + dirs[i] * pxIn;
        if (texture2D(tColor, creaseUv).a < 0.01) continue;
        float turn = 1.0 - dot(n, normalAt(creaseUv));
        edge = max(edge, smoothstep(0.18, 0.3, turn));
      }
    }
    return edge;
  }

  float inkAt(vec2 uv) {
    float line = edgeAt(wobbled(uv, 0.0), 1.0);
    if (lineSketch > 0.0) {
      // A second, lighter pass drawn a little differently: a sketched line.
      line = max(line, edgeAt(wobbled(uv, 53.1), 0.7) * lineSketch);
    }
    vec2 css = cssPosition(uv);
    if (lineBreakup > 0.0) {
      // Dry brush: the brush skips in patches.
      float threshold = lineBreakup * 0.75;
      // Small patches, so gaps read as short scratches rather than blots.
      line *= smoothstep(threshold, threshold + 0.12, noise(css / 5.0 + 5.1 + boilShift()));
    }
    if (lineGrain > 0.0) {
      // Pencil tooth: paper grain breaks the line's opacity.
      line *= mix(1.0, 0.35 + 0.65 * noise(css / 1.3 + 91.7 + boilShift()), lineGrain);
    }
    return line * lineOpacity;
  }

  float dotScreen(float luminance) {
    // 45° dot grid; darker tone -> bigger dots.
    vec2 pixel = vUv * resolution;
    float angle = 0.785398;
    mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 cell = fract(rotation * pixel / toneSize) - 0.5;
    float radius = sqrt(clamp(1.0 - luminance, 0.0, 1.0)) * 0.62;
    float distanceToCentre = length(cell);
    float aa = 1.2 / toneSize;
    return 1.0 - smoothstep(radius - aa, radius + aa, distanceToCentre);
  }

  void main() {
    vec4 colour = texture2D(tColor, vUv);
    vec3 shaded = colour.rgb;
    if (tone && colour.a > 0.01) {
      float luminance = dot(shaded, vec3(0.299, 0.587, 0.114));
      // Light areas stay paper, darker bands become dot tone.
      float amount = luminance > 0.82 ? 0.0 : dotScreen(luminance + 0.12);
      shaded = mix(paper, inkColor, amount);
    }
    float line = ink ? inkAt(vUv) : 0.0;
    float coverage = max(colour.a, line);
    vec3 surface = colour.a > 0.01 ? shaded : paper;
    vec3 result = mix(surface, inkColor, line);
    if (transparent) {
      gl_FragColor = vec4(result, coverage);
    } else {
      gl_FragColor = vec4(mix(paper, result, coverage), 1.0);
    }
    // Render targets keep linear colour; exports need sRGB like the canvas.
    if (encodeOutput) gl_FragColor.rgb = linearToSrgb(gl_FragColor.rgb);
    #include <colorspace_fragment>
  }
`;

export class MangaRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    const half = renderer.capabilities.isWebGL2 ? HalfFloatType : UnsignedByteType;
    this.colorTarget = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, format: RGBAFormat, samples: 0 });
    this.colorTarget.depthTexture = new DepthTexture(1, 1, renderer.capabilities.isWebGL2 ? FloatType : UnsignedIntType);
    this.colorTarget.depthTexture.minFilter = NearestFilter;
    this.colorTarget.depthTexture.magFilter = NearestFilter;
    this.normalTarget = new WebGLRenderTarget(1, 1, { type: half, format: RGBAFormat });
    this.normalMaterial = new MeshNormalMaterial();
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      uniforms: {
        tColor: { value: this.colorTarget.texture },
        tDepth: { value: this.colorTarget.depthTexture },
        tNormal: { value: this.normalTarget.texture },
        resolution: { value: new Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 500 },
        orthographic: { value: false },
        ink: { value: true },
        inkWidth: { value: 1.5 },
        depthSensitivity: { value: 0.5 },
        tone: { value: false },
        toneSize: { value: 6 },
        transparent: { value: false },
        paper: { value: new Color(PAPER_COLOR) },
        inkColor: { value: new Color(INK_COLOR) },
        encodeOutput: { value: false },
        pixelScale: { value: 1 },
        lineOutline: { value: 1 },
        lineCrease: { value: 1 },
        lineTaper: { value: 0 },
        lineWobble: { value: 0 },
        lineWobbleSize: { value: 90 },
        lineJitter: { value: 0 },
        lineGrain: { value: 0 },
        lineBreakup: { value: 0 },
        lineSketch: { value: 0 },
        lineOpacity: { value: 1 },
        lineSeed: { value: 0 },
      },
    });
    this.quadScene = new Scene();
    this.quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.clearColor = new Color();
  }

  setSize(width, height) {
    this.colorTarget.setSize(width, height);
    this.normalTarget.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }

  /**
   * Renders `scene` from `camera` into `target` (null = the canvas).
   * options: { ink, inkWidth, inkDepth, lineStyle, lineHand, tone, toneSize, transparent, pixelScale }
   */
  render(scene, camera, options, target = null) {
    const renderer = this.renderer;
    const uniforms = this.material.uniforms;
    const previousTarget = renderer.getRenderTarget();
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.colorTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    if (options.ink) {
      const previousOverride = scene.overrideMaterial;
      scene.overrideMaterial = this.normalMaterial;
      renderer.setClearColor(0x8080ff, 1);
      renderer.setRenderTarget(this.normalTarget);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      scene.overrideMaterial = previousOverride;
    }

    const scale = options.pixelScale || 1;
    uniforms.cameraNear.value = camera.near;
    uniforms.cameraFar.value = camera.far;
    uniforms.orthographic.value = Boolean(camera.isOrthographicCamera);
    uniforms.ink.value = Boolean(options.ink);
    uniforms.inkWidth.value = (options.inkWidth || 1.5) * scale;
    uniforms.depthSensitivity.value = options.inkDepth ?? 0.5;
    const style = lineStyleParams(options.lineStyle, options.lineHand);
    uniforms.pixelScale.value = scale;
    uniforms.lineOutline.value = style.outline;
    uniforms.lineCrease.value = style.crease;
    uniforms.lineTaper.value = style.taper;
    uniforms.lineWobble.value = style.wobble;
    uniforms.lineWobbleSize.value = style.wobbleSize;
    uniforms.lineJitter.value = style.jitter;
    uniforms.lineGrain.value = style.grain;
    uniforms.lineBreakup.value = style.breakup;
    uniforms.lineSketch.value = style.sketch;
    uniforms.lineOpacity.value = style.opacity;
    uniforms.lineSeed.value = Number(options.lineSeed) || 0;
    uniforms.tone.value = Boolean(options.tone);
    uniforms.toneSize.value = (options.toneSize || 6) * scale;
    uniforms.transparent.value = Boolean(options.transparent);
    uniforms.encodeOutput.value = target !== null;

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.quadScene, this.quadCamera);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
  }

  dispose() {
    this.colorTarget.depthTexture?.dispose();
    this.colorTarget.dispose();
    this.normalTarget.dispose();
    this.normalMaterial.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
