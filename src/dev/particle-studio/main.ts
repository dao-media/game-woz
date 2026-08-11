/**
 * Particle Studio — Red Magic lab.
 * Open via /particle-studio.html
 *
 * Drives the same `RedMagic` module the play Scene uses so tunables
 * stay honest to in-game HEAVY / ULTIMATE.
 */
import Phaser from 'phaser';
import { RedMagic } from '../../fx/RedMagic';
import { tuning } from '../../config/tuning';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const hud = $('hud');
const statusEl = $('status');
const viewport = $('viewport');

type LabParams = {
  radiusX: number;
  radiusY: number;
  spin: number;
  floorSquash: number;
  spreadDeg: number;
  bloom: number;
  blur: number;
  vig: number;
  ringOn: boolean;
};

const P: LabParams = {
  radiusX: 90,
  radiusY: 46,
  spin: 1.6,
  floorSquash: tuning.foreshorten,
  spreadDeg: 28,
  bloom: 1.1,
  blur: 1.4,
  vig: 0.35,
  ringOn: true,
};

function bindRange(
  id: string,
  apply: (v: number) => void,
  scale: number,
  digits: number | null,
): void {
  const el = $(id) as HTMLInputElement;
  const out = $(`v-${id}`);
  const sync = () => {
    const v = Number(el.value) * scale;
    apply(v);
    out.textContent = digits == null ? String(Math.round(v)) : v.toFixed(digits);
  };
  el.addEventListener('input', sync);
  sync();
}

bindRange('rx', (v) => { P.radiusX = v; }, 1, null);
bindRange('ry', (v) => { P.radiusY = v; }, 1, null);
bindRange('spin', (v) => { P.spin = v; }, 0.1, 1);
bindRange('squash', (v) => { P.floorSquash = v; }, 0.01, 2);
bindRange('spread', (v) => { P.spreadDeg = v; }, 1, null);
bindRange('bloom', (v) => { P.bloom = v; }, 0.1, 1);
bindRange('blur', (v) => { P.blur = v; }, 0.1, 1);
bindRange('vig', (v) => { P.vig = v; }, 0.01, 2);

class ParticleLabScene extends Phaser.Scene {
  private fx!: RedMagic;
  private cx = 0;
  private cy = 0;
  private downAt: { x: number; y: number } | null = null;
  private channeling = false;
  private shiftHeld = false;

  constructor() {
    super('ParticleLab');
  }

  create(): void {
    this.cx = this.scale.width / 2;
    this.cy = this.scale.height / 2;

    this.fx = new RedMagic(this, {
      radiusX: P.radiusX,
      radiusY: P.radiusY,
      spin: P.spin,
      floorSquash: P.floorSquash,
      cameraLight: true,
    });

    this.fx.ring(this.cx, this.cy);
    P.ringOn = true;
    $('btn-ring').classList.add('active');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downAt = { x: p.worldX, y: p.worldY };
      if (this.shiftHeld) {
        this.channeling = true;
        this.fx.channel(this.cx - 80, this.cy, p.worldX, p.worldY);
        setHud('channeling… release to stop');
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.channeling || !this.downAt) return;
      this.fx.channel(this.downAt.x, this.downAt.y, p.worldX, p.worldY);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.channeling) {
        this.fx.stopChannel();
        this.channeling = false;
        this.downAt = null;
        setHud('click · pulse · drag · blast');
        return;
      }
      if (!this.downAt) return;
      const d = Phaser.Math.Distance.Between(
        this.downAt.x,
        this.downAt.y,
        p.worldX,
        p.worldY,
      );
      if (d > 36) {
        this.fx.blast(this.downAt.x, this.downAt.y, p.worldX, p.worldY, P.spreadDeg);
        setStatus(
          `blast → (${Math.round(p.worldX)}, ${Math.round(p.worldY)}) spread ${P.spreadDeg}°`,
        );
      } else {
        this.fx.pulse(p.worldX, p.worldY);
        setStatus(`pulse @ (${Math.round(p.worldX)}, ${Math.round(p.worldY)})`);
      }
      this.downAt = null;
      setHud('click · pulse · drag · blast');
    });

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.cx = gameSize.width / 2;
      this.cy = gameSize.height / 2;
      if (P.ringOn) this.fx.ring(this.cx, this.cy);
    });

    $('btn-pulse').onclick = () => {
      this.fx.pulse(this.cx, this.cy);
      setStatus('pulse @ center (ULTIMATE)');
    };
    $('btn-blast').onclick = () => {
      this.fx.blast(80, this.cy, this.scale.width - 80, this.cy, P.spreadDeg);
      setStatus(`blast across stage · spread ${P.spreadDeg}° (HEAVY)`);
    };
    $('btn-beam').onclick = () => {
      this.fx.beam(80, this.cy, this.scale.width - 80, this.cy);
      setStatus('beam across stage (slow comet)');
    };
    $('btn-ring').onclick = () => {
      P.ringOn = !P.ringOn;
      if (P.ringOn) {
        this.fx.ring(this.cx, this.cy);
        $('btn-ring').classList.add('active');
        setStatus('ambient ring on');
      } else {
        this.fx.ring();
        $('btn-ring').classList.remove('active');
        setStatus('ambient ring off');
      }
    };
    $('btn-channel').onclick = () => {
      this.fx.channel(this.cx - 120, this.cy, this.cx + 120, this.cy - 40);
      this.time.delayedCall(900, () => this.fx.stopChannel());
      setStatus('channel burst 900ms');
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.shiftHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shiftHeld = false;
    });
  }

  update(): void {
    this.fx.configure({
      radiusX: P.radiusX,
      radiusY: P.radiusY,
      spin: P.spin,
      floorSquash: P.floorSquash,
    });
    this.fx.setCameraLight(P.bloom, P.blur, P.vig);
  }
}

function setHud(text: string): void {
  hud.textContent = text;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: viewport,
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: ParticleLabScene,
  render: {
    antialias: true,
    pixelArt: false,
  },
});
