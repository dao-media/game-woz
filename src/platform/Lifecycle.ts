import type Phaser from 'phaser';

/**
 * App lifecycle: pause on blur/background, resume on focus.
 * Audio unlock is a one-shot stub until Sound is wired.
 */
export class Lifecycle {
  private audioUnlocked = false;
  private attached = false;

  attach(game: Phaser.Game): void {
    if (this.attached) return;
    this.attached = true;

    const onBlur = (): void => {
      game.scene.scenes.forEach((scene) => {
        if (scene.scene.isActive()) {
          scene.scene.pause();
        }
      });
      game.sound.pauseAll();
    };

    const onFocus = (): void => {
      game.scene.scenes.forEach((scene) => {
        if (scene.scene.isPaused()) {
          scene.scene.resume();
        }
      });
      game.sound.resumeAll();
    };

    game.events.on('blur', onBlur);
    game.events.on('focus', onFocus);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) onBlur();
        else onFocus();
      });
    }
  }

  /**
   * Call on first user gesture (menu START). Unlocks WebAudio context when sound exists.
   */
  unlockAudio(game: Phaser.Game): void {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    const sound = game.sound as unknown as { context?: AudioContext };
    if (sound.context?.state === 'suspended') {
      void sound.context.resume();
    }
  }

  get isAudioUnlocked(): boolean {
    return this.audioUnlocked;
  }
}
