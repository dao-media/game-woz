import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { ensureTransparentQuadTexture } from './transparentTexture';

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform vec3 uColor;
uniform float uTime;
uniform float uRayCount;
uniform float uIntensity;
uniform float uRotationSpeed;
uniform float uInnerRadius;
uniform float uOuterRadius;
uniform float uPulse;
uniform float uAspect;
uniform float uCircleBlend;
uniform vec2 uOriginUV;

varying vec2 outTexCoord;

void main() {
    // SinglePipeline sprite UV: v=0 top, v=1 bottom; origin (0.5,1) = feet at bottom-center.
    vec2 p = outTexCoord - uOriginUV;

    // Ground semicircle (z=0) vs full circle (airborne) — smooth blend via uCircleBlend.
    float semicircleGate = step(p.y, -0.002);
    float shapeGate = mix(semicircleGate, 1.0, uCircleBlend);
    if (shapeGate < 0.01) {
        gl_FragColor = vec4(0.0);
        return;
    }

    vec2 pA = vec2(p.x * uAspect, p.y);
    float dist = length(pA);

    if (dist > uOuterRadius) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float angle = atan(p.y, p.x * uAspect) + uTime * uRotationSpeed;
    float sector = 6.28318530718 / max(uRayCount, 1.0);
    float rayPhase = mod(angle + 3.14159265359, sector) / sector;
    float ray = smoothstep(0.0, 0.1, rayPhase) * (1.0 - smoothstep(0.5, 0.92, rayPhase));
    ray = pow(ray, 0.5);

    float shimmer = 0.6 + 0.4 * sin(angle * uRayCount * 0.45 + uTime * 2.2);

    float inner = smoothstep(uInnerRadius, uInnerRadius + 0.05, dist);
    float outer = 1.0 - smoothstep(uOuterRadius * 0.65, uOuterRadius, dist);
    float groundFade = mix(
        smoothstep(0.0, 0.06, -p.y),
        1.0 - smoothstep(uOuterRadius * 0.82, uOuterRadius, dist),
        uCircleBlend
    );

    float alpha = ray * shimmer * inner * outer * groundFade * shapeGate * uIntensity * uPulse;
    alpha = clamp(alpha, 0.0, 0.78);

    gl_FragColor = vec4(uColor, alpha);
}
`;

export const SLIPPER_RAY_BURST_PIPELINE = 'SlipperRayBurst';

export type SlipperGlowBindData = {
  uAspect?: number;
  uCircleBlend?: number;
  uIntensityMult?: number;
  uPulse?: number;
};

/** World-space ray burst — extends SinglePipeline so draw respects Image transform. */
export class SlipperRayBurstPipeline extends Phaser.Renderer.WebGL.Pipelines
  .SinglePipeline {
  uColor = [0.33, 0.02, 0.04];
  uTime = 0;
  uRayCount = 14;
  uIntensity = 0.62;
  uRotationSpeed = 0.42;
  uInnerRadius = 0.06;
  uOuterRadius = 0.92;
  uPulse = 1;
  uAspect = 2;
  /** 0 = floor semicircle, 1 = full circle (airborne). */
  uCircleBlend = 0;
  /** Bottom-center of quad UV (feet); fixed for origin (0.5, 1). */
  uOriginUV = [0.5, 1];

  constructor(game: Phaser.Game) {
    super({
      game,
      fragShader: FRAG,
    });
    applySlipperRayBurstTuning(this);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject);

    const bind = gameObject?.getData('slipperGlow') as
      | SlipperGlowBindData
      | undefined;
    const intensityMult = bind?.uIntensityMult ?? 1;
    const pulse = bind?.uPulse ?? this.uPulse;
    const aspect = bind?.uAspect ?? this.uAspect;
    const circleBlend = bind?.uCircleBlend ?? this.uCircleBlend;

    this.set1f('uTime', this.uTime);
    this.set1f('uRayCount', this.uRayCount);
    this.set1f('uIntensity', this.uIntensity * intensityMult);
    this.set1f('uRotationSpeed', this.uRotationSpeed);
    this.set1f('uInnerRadius', this.uInnerRadius);
    this.set1f('uOuterRadius', this.uOuterRadius);
    this.set1f('uPulse', pulse);
    this.set1f('uAspect', aspect);
    this.set1f('uCircleBlend', circleBlend);
    this.set2fv('uOriginUV', this.uOriginUV);
    this.set3fv('uColor', this.uColor);
  }
}

export function applySlipperRayBurstTuning(
  pipeline?: SlipperRayBurstPipeline,
): void {
  if (!pipeline) return;
  const c = tuning.slipperGlowColor;
  pipeline.uColor = [
    ((c >> 16) & 0xff) / 255,
    ((c >> 8) & 0xff) / 255,
    (c & 0xff) / 255,
  ];
  pipeline.uRayCount = tuning.slipperGlowRayCount;
  pipeline.uIntensity = tuning.slipperGlowIntensity;
  pipeline.uRotationSpeed = tuning.slipperGlowRotationSpeed;
  pipeline.uInnerRadius = tuning.slipperGlowInnerRadius;
  pipeline.uOuterRadius = tuning.slipperGlowOuterRadius;
}

export function registerSlipperRayBurstPipeline(
  game: Phaser.Game,
): SlipperRayBurstPipeline {
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (renderer.pipelines.has(SLIPPER_RAY_BURST_PIPELINE)) {
    return renderer.pipelines.get(
      SLIPPER_RAY_BURST_PIPELINE,
    ) as SlipperRayBurstPipeline;
  }
  const pipeline = new SlipperRayBurstPipeline(game);
  renderer.pipelines.add(SLIPPER_RAY_BURST_PIPELINE, pipeline);
  return pipeline;
}

export function ensureSlipperRayQuadTexture(scene: Phaser.Scene): string {
  return ensureTransparentQuadTexture(scene, 'slipper-ray-quad');
}
