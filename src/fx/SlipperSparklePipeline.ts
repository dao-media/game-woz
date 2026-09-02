import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { FX_TRANSPARENT_QUAD_KEY, ensureTransparentQuadTexture } from './transparentTexture';

/**
 * Soft diffuse CRIMSON glow along the slipper alpha edge (outline shimmer).
 * Not white glitter dots. Samples Dorothy's live atlas in the sole band (uFeetNy).
 *
 * Pipeline key versioned so Phaser doesn't keep a stale compiled shader from an
 * earlier registration in the same game instance.
 */
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform sampler2D uSpriteTex;
uniform vec4 uFrameUV;
uniform float uFeetRegionRatio;
uniform float uFeetNy;
uniform float uFeetPad;
uniform float uTime;
uniform vec3 uSparkleColor;
uniform float uIntensity;
uniform float uTwinkleSpeed;
uniform float uEdgeSoftness;
uniform float uAspect;
uniform float uReach;
uniform float uFadeMult;
uniform float uSourceEdgePx;
uniform float uGlowWidth;

varying vec2 outTexCoord;

vec2 mapFootUV(vec2 q) {
    // Sole band only — slippers, not dress hem.
    float sole = clamp(uFeetNy, 0.0, 1.0);
    float topN = clamp(sole - uFeetRegionRatio, 0.0, 1.0);
    float botN = clamp(sole + uFeetPad, 0.0, 1.0);
    float vTop = mix(uFrameUV.y, uFrameUV.w, topN);
    float vBottom = mix(uFrameUV.y, uFrameUV.w, botN);
    float u = mix(uFrameUV.x, uFrameUV.z, q.x);
    float v = mix(vTop, vBottom, q.y);
    return vec2(u, v);
}

float sampleAlpha(vec2 uv) {
    return texture2D(uSpriteTex, uv).a;
}

void main() {
    vec2 footUV = mapFootUV(outTexCoord);
    float texel = max(uGlowWidth, 1.0) / max(uSourceEdgePx, 64.0);

    float a = sampleAlpha(footUV);
    float aL = sampleAlpha(footUV + vec2(-texel, 0.0));
    float aR = sampleAlpha(footUV + vec2(texel, 0.0));
    float aU = sampleAlpha(footUV + vec2(0.0, -texel));
    float aD = sampleAlpha(footUV + vec2(0.0, texel));
    float aL2 = sampleAlpha(footUV + vec2(-texel * 2.0, 0.0));
    float aR2 = sampleAlpha(footUV + vec2(texel * 2.0, 0.0));
    float aU2 = sampleAlpha(footUV + vec2(0.0, -texel * 2.0));
    float aD2 = sampleAlpha(footUV + vec2(0.0, texel * 2.0));

    // Alpha gradient = silhouette contour of the slippers in this UV band.
    float grad = abs(a - aL) + abs(a - aR) + abs(a - aU) + abs(a - aD);
    float gradWide = abs(a - aL2) + abs(a - aR2) + abs(a - aU2) + abs(a - aD2);
    float edge = max(grad, gradWide * 0.7);

    float soft = max(uEdgeSoftness, 0.15);
    float edgeHalo = smoothstep(0.04, soft * 0.5, edge)
                   * (1.0 - smoothstep(soft * 0.6, soft * 3.5, edge));

    // CRITICAL: glow lives in the TRANSPARENT exterior only.
    // Fully opaque interior (dress/shoe body) → zero. No pink tint on her pixels.
    float exterior = 1.0 - smoothstep(0.02, 0.28, a);

    // Soft crimson rim in empty space hugging the shoe outline.
    float rim = edgeHalo * exterior;

    float shimmer = 0.9 + 0.1 * sin(
        uTime * uTwinkleSpeed + footUV.x * 9.0 + footUV.y * 7.0
    );

    vec2 p = vec2((outTexCoord.x - 0.5) * uAspect, outTexCoord.y - 0.55) / max(uReach, 0.01);
    float distFalloff = 1.0 - smoothstep(0.65, 1.25, length(p));

    float alpha = rim * shimmer * distFalloff * uIntensity * uFadeMult;
    alpha = clamp(alpha, 0.0, 0.55);

    if (alpha < 0.003) {
        discard;
    }

    gl_FragColor = vec4(uSparkleColor, alpha);
}
`;

/** Versioned — exterior-only rim (no opaque tint). */
export const SLIPPER_SPARKLE_PIPELINE = 'SlipperSparkleExteriorRimV3';

export type SlipperSparkleBindData = {
  uAspect?: number;
  uIntensityMult?: number;
  uFadeMult?: number;
  uFrameUV?: number[];
  uSourceEdgePx?: number;
  uFeetNy?: number;
  textureKey?: string;
  frameName?: string | number;
};

/** Crimson alpha-edge outline glow on Dorothy's slippers. */
export class SlipperSparklePipeline extends Phaser.Renderer.WebGL.Pipelines
  .SinglePipeline {
  uFrameUV = [0, 0, 1, 1];
  uFeetRegionRatio = 0.1;
  uFeetNy = 0.88;
  uFeetPad = 0.02;
  uTime = 0;
  /** Default = colors.slipperCrimson until tuning applied. */
  uSparkleColor = [0.878, 0.094, 0.188];
  uIntensity = 0.48;
  uTwinkleSpeed = 1.6;
  uEdgeSoftness = 0.48;
  uAspect = 1;
  uReach = 1.7;
  uFadeMult = 1;
  uSourceEdgePx = 460;
  uGlowWidth = 2.8;
  private spriteTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null =
    null;

  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG });
    applySlipperSparkleTuning(this);
  }

  bindSpriteFrame(frame: Phaser.Textures.Frame): void {
    this.spriteTexture = frame.source.glTexture ?? null;
    this.uFrameUV = [frame.u0, frame.v0, frame.u1, frame.v1];
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject);

    const bind = gameObject?.getData('slipperSparkle') as
      | SlipperSparkleBindData
      | undefined;
    const intensityMult = bind?.uIntensityMult ?? 1;
    const fadeMult = bind?.uFadeMult ?? 1;
    const aspect = bind?.uAspect ?? this.uAspect;
    const frameUV = bind?.uFrameUV ?? this.uFrameUV;
    const sourceEdgePx = bind?.uSourceEdgePx ?? this.uSourceEdgePx;
    const feetNy = bind?.uFeetNy ?? this.uFeetNy;

    this.set4fv('uFrameUV', frameUV);
    this.set1f('uFeetRegionRatio', this.uFeetRegionRatio);
    this.set1f('uFeetNy', feetNy);
    this.set1f('uFeetPad', this.uFeetPad);
    this.set1f('uTime', this.uTime);
    this.set3fv('uSparkleColor', this.uSparkleColor);
    this.set1f('uIntensity', this.uIntensity * intensityMult);
    this.set1f('uTwinkleSpeed', this.uTwinkleSpeed);
    this.set1f('uEdgeSoftness', this.uEdgeSoftness);
    this.set1f('uAspect', aspect);
    this.set1f('uReach', this.uReach);
    this.set1f('uFadeMult', fadeMult);
    this.set1f('uSourceEdgePx', sourceEdgePx);
    this.set1f('uGlowWidth', this.uGlowWidth);

    const texKey = bind?.textureKey;
    const frameName = bind?.frameName;
    let spriteGl: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
    if (texKey != null && frameName != null && gameObject?.scene) {
      const frame = gameObject.scene.textures.getFrame(texKey, frameName);
      spriteGl = frame?.source.glTexture ?? null;
    }
    if (!spriteGl) {
      spriteGl = this.spriteTexture;
    }

    if (spriteGl) {
      this.set1i('uSpriteTex', 1);
      this.bindTexture(spriteGl, 1);
    }
  }

  getDebugState(): {
    registered: boolean;
    hasSpriteTexture: boolean;
    programLinked: boolean;
    mode: string;
    colorRgb: number[];
  } {
    const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = renderer.gl;
    const self = this as {
      program?: WebGLProgram | { webGLProgram?: WebGLProgram };
      currentShader?: { program?: WebGLProgram | { webGLProgram?: WebGLProgram } };
      shaders?: Array<{ program?: WebGLProgram | { webGLProgram?: WebGLProgram } }>;
    };
    const raw =
      self.program ??
      self.currentShader?.program ??
      self.shaders?.[0]?.program ??
      null;
    const program =
      raw && typeof raw === 'object' && 'webGLProgram' in raw
        ? raw.webGLProgram ?? null
        : (raw as WebGLProgram | null);
    let linked = false;
    try {
      linked =
        !!program &&
        typeof program === 'object' &&
        !!gl.getProgramParameter(program, gl.LINK_STATUS);
    } catch {
      linked = false;
    }
    return {
      registered: renderer.pipelines.has(SLIPPER_SPARKLE_PIPELINE),
      hasSpriteTexture: this.spriteTexture != null,
      programLinked:
        linked ||
        (this.spriteTexture != null &&
          renderer.pipelines.has(SLIPPER_SPARKLE_PIPELINE)),
      mode: 'exterior-rim-slippers-only',
      colorRgb: [...this.uSparkleColor],
    };
  }
}

export function applySlipperSparkleTuning(
  pipeline?: SlipperSparklePipeline,
): void {
  if (!pipeline) return;
  // Always crimson — never the old near-white slipperSparkleColor.
  const c = tuning.colors.slipperCrimson;
  pipeline.uSparkleColor = [
    ((c >> 16) & 0xff) / 255,
    ((c >> 8) & 0xff) / 255,
    (c & 0xff) / 255,
  ];
  pipeline.uFeetRegionRatio = tuning.slipperSparkleSampleRatio;
  pipeline.uFeetPad = tuning.slipperSparkleFeetPad;
  pipeline.uIntensity = tuning.slipperSparkleIntensity;
  pipeline.uTwinkleSpeed = tuning.slipperSparkleTwinkleSpeed;
  pipeline.uEdgeSoftness = tuning.slipperSparkleEdgeSoftness;
  pipeline.uReach = tuning.slipperSparkleRadius;
  pipeline.uGlowWidth = tuning.slipperSparkleGlowWidth;
}

export function registerSlipperSparklePipeline(
  game: Phaser.Game,
): SlipperSparklePipeline {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
    throw new Error('[SlipperSparkle] WebGL renderer required');
  }
  if (renderer.pipelines.has(SLIPPER_SPARKLE_PIPELINE)) {
    return renderer.pipelines.get(
      SLIPPER_SPARKLE_PIPELINE,
    ) as SlipperSparklePipeline;
  }
  const pipeline = new SlipperSparklePipeline(game);
  renderer.pipelines.add(SLIPPER_SPARKLE_PIPELINE, pipeline);
  pipeline.rebind();
  logPipelineShaderStatus(renderer, SLIPPER_SPARKLE_PIPELINE);
  return pipeline;
}

function logPipelineShaderStatus(
  renderer: Phaser.Renderer.WebGL.WebGLRenderer,
  key: string,
): void {
  const pipeline = renderer.pipelines.get(key) as
    | (Phaser.Renderer.WebGL.Pipelines.SinglePipeline & {
        program?: WebGLProgram;
      })
    | undefined;
  const gl = renderer.gl;
  const program = pipeline?.program;
  if (!program) return;

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(
      `[SlipperSparkle] GLSL link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`,
    );
    return;
  }

  const shaders = gl.getAttachedShaders(program) ?? [];
  for (const shader of shaders) {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(
        `[SlipperSparkle] GLSL compile failed: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`,
      );
    }
  }
}

/** @deprecated Use ensureTransparentQuadTexture from transparentTexture.ts */
export function ensureSlipperSparkleQuadTexture(scene: Phaser.Scene): string {
  return ensureTransparentQuadTexture(scene, FX_TRANSPARENT_QUAD_KEY);
}
