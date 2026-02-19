// Midiocre — Transport (high-level play/pause/stop/seek/loop control)

import { MidiTimeline } from '../midi/MidiTypes.js';
import { Scheduler } from './Scheduler.js';

export type TransportState = 'stopped' | 'playing' | 'paused';

export class Transport {
  private scheduler: Scheduler;
  private timeline: MidiTimeline | null = null;
  private _state: TransportState = 'stopped';
  private _loop = false;
  private _onStateChange?: (state: TransportState) => void;
  private _onProgress?: (time: number, duration: number) => void;
  private progressTimer: number | null = null;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;

    // Handle end of playback
    this.scheduler.onEnd(() => {
      if (this._loop && this.timeline) {
        this.scheduler.seekTo(0);
        this.scheduler.start(0);
      } else {
        this._state = 'stopped';
        this._onStateChange?.('stopped');
        this.stopProgressTimer();
      }
    });
  }

  get state(): TransportState {
    return this._state;
  }

  get loop(): boolean {
    return this._loop;
  }

  set loop(v: boolean) {
    this._loop = v;
  }

  get currentTime(): number {
    return this.scheduler.currentTime;
  }

  get duration(): number {
    return this.timeline?.durationSeconds ?? 0;
  }

  get tempoMultiplier(): number {
    return this.scheduler.tempo;
  }

  set tempoMultiplier(v: number) {
    this.scheduler.tempo = v;
  }

  setTimeline(timeline: MidiTimeline): void {
    this.timeline = timeline;
    this.scheduler.setTimeline(timeline);
    this._state = 'stopped';
  }

  play(): void {
    if (!this.timeline) return;
    if (this._state === 'paused') {
      this.scheduler.resume();
    } else {
      this.scheduler.seekTo(0);
      this.scheduler.start(0);
    }
    this._state = 'playing';
    this._onStateChange?.('playing');
    this.startProgressTimer();
  }

  pause(): void {
    if (this._state !== 'playing') return;
    this.scheduler.pause();
    this._state = 'paused';
    this._onStateChange?.('paused');
    this.stopProgressTimer();
  }

  stop(): void {
    this.scheduler.stop();
    this.scheduler.seekTo(0);
    this._state = 'stopped';
    this._onStateChange?.('stopped');
    this.stopProgressTimer();
  }

  seek(timeSeconds: number): void {
    const wasPlaying = this._state === 'playing';
    this.scheduler.seekTo(Math.max(0, Math.min(timeSeconds, this.duration)));
    if (wasPlaying) {
      this.scheduler.start(timeSeconds);
    }
  }

  onStateChange(cb: (state: TransportState) => void): void {
    this._onStateChange = cb;
  }

  onProgress(cb: (time: number, duration: number) => void): void {
    this._onProgress = cb;
  }

  onEvent(cb: (event: any) => void): void {
    this.scheduler.onEvent(cb);
  }

  private startProgressTimer(): void {
    this.stopProgressTimer();
    const tick = () => {
      if (this._state === 'playing') {
        this._onProgress?.(this.currentTime, this.duration);
        this.progressTimer = window.requestAnimationFrame(tick);
      }
    };
    this.progressTimer = window.requestAnimationFrame(tick);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer !== null) {
      window.cancelAnimationFrame(this.progressTimer);
      this.progressTimer = null;
    }
  }
}
