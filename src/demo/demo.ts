// Midiocre — Demo player with themes, waterfall + waveform viz, seamless SF2 hot-swap

import { Midiocre, MidiocreConfig } from '../api/Midiocre.js';

// -- Config resolution -------------------------------------------------------

const BUILT_IN_DEFAULTS: MidiocreConfig = {
  sf2Path: 'SoundFonts',
  midiPath: 'DemoMidiFiles',
  sf2Files: [],
  midiFiles: [],
  autoplay: false,
  loop: false,
  volume: 0.8,
  tempo: 1.0,
};

async function loadConfig(): Promise<MidiocreConfig> {
  let config = { ...BUILT_IN_DEFAULTS };
  try {
    const resp = await fetch('demo-player.config.json');
    if (resp.ok) config = { ...config, ...(await resp.json()) };
  } catch { /* optional */ }
  const winConfig = (window as any).MidiocrePlayerConfig;
  if (winConfig && typeof winConfig === 'object') config = { ...config, ...winConfig };
  return config;
}

// -- DOM helpers -------------------------------------------------------------

function $(id: string): HTMLElement { return document.getElementById(id)!; }

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Read a CSS custom property from the root element
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// -- Piano visualization (keys + progress) -----------------------------------

class PianoCanvas {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private progress = 0;
  private activeNotes = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx2d.scale(devicePixelRatio, devicePixelRatio);
    this.draw();
  }

  setProgress(f: number): void { this.progress = Math.max(0, Math.min(1, f)); this.draw(); }
  noteOn(n: number): void { this.activeNotes.add(n); }
  noteOff(n: number): void { this.activeNotes.delete(n); }
  clearNotes(): void { this.activeNotes.clear(); }

  private draw(): void {
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const ctx = this.ctx2d;
    ctx.clearRect(0, 0, w, h);

    // Use theme colors
    ctx.fillStyle = cssVar('--bg-viz') || '#0a1628';
    ctx.fillRect(0, 0, w, h);

    const pw = w * this.progress;
    ctx.fillStyle = cssVar('--accent-dim') || 'rgba(233,69,96,0.3)';
    ctx.fillRect(0, 0, pw, h);

    const totalKeys = 88;
    const kw = w / totalKeys;
    const blackSemitones = [1, 3, 6, 8, 10];
    const keyWhite = cssVar('--key-white') || '#e0e0e0';
    const keyBlack = cssVar('--key-black') || '#1a1a2e';
    const keyActive = cssVar('--key-active') || '#ff6b81';
    const keyBlackActive = cssVar('--key-black-active') || '#e94560';

    for (let i = 0; i < totalKeys; i++) {
      const midi = i + 21;
      const semi = midi % 12;
      const isBlack = blackSemitones.includes(semi);
      const x = i * kw;
      const active = this.activeNotes.has(midi);

      if (isBlack) {
        ctx.fillStyle = active ? keyBlackActive : keyBlack;
        ctx.fillRect(x, 0, kw * 0.7, h * 0.6);
      } else {
        ctx.fillStyle = active ? keyActive : keyWhite;
        ctx.fillRect(x, h * 0.6, kw - 0.5, h * 0.4);
      }
    }

    ctx.strokeStyle = cssVar('--accent') || '#e94560';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pw, 0);
    ctx.lineTo(pw, h);
    ctx.stroke();
  }

  getFraction(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
}

// -- Waterfall visualization (falling notes) ---------------------------------

interface ActiveNote {
  note: number;
  channel: number;
  velocity: number;
  startTime: number;
  endTime: number; // 0 while held
}

class WaterfallCanvas {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private activeNotes: ActiveNote[] = [];
  private finishedNotes: ActiveNote[] = [];
  private animId = 0;
  private running = false;
  private now = 0; // latest audio time from progress callback

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx2d.scale(devicePixelRatio, devicePixelRatio);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = 0; }
  }

  clear(): void {
    this.activeNotes = [];
    this.finishedNotes = [];
  }

  setTime(t: number): void { this.now = t; }

  noteOn(note: number, channel: number, velocity: number, time: number): void {
    this.activeNotes.push({ note, channel, velocity, startTime: time, endTime: 0 });
  }

  noteOff(note: number, channel: number): void {
    for (let i = this.activeNotes.length - 1; i >= 0; i--) {
      const n = this.activeNotes[i];
      if (n.note === note && n.channel === channel && n.endTime === 0) {
        n.endTime = this.now;
        this.finishedNotes.push(n);
        this.activeNotes.splice(i, 1);
        break;
      }
    }
  }

  private tick = (): void => {
    if (!this.running) return;
    this.draw();
    this.animId = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const ctx = this.ctx2d;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--bg-viz') || '#0a1628';
    ctx.fillRect(0, 0, w, h);

    // Draw grid lines
    const gridColor = cssVar('--wave-grid') || 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    // Horizontal grid every octave (12 semitones)
    const noteRange = 88;
    const noteMin = 21;
    const noteH = h / noteRange;
    for (let oct = 0; oct < 8; oct++) {
      const y = h - (oct * 12 * noteH);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const noteColor = cssVar('--waterfall-note') || 'rgba(233,69,96,0.8)';
    const trailColor = cssVar('--waterfall-trail') || 'rgba(100,149,237,0.5)';
    const visWindow = 4; // seconds of vertical history
    const now = this.now;

    // Prune old finished notes (older than visWindow)
    this.finishedNotes = this.finishedNotes.filter(n => n.endTime > now - visWindow);

    const drawNote = (n: ActiveNote): void => {
      const end = n.endTime || now;
      const topY = ((now - end) / visWindow) * h;
      const botY = ((now - n.startTime) / visWindow) * h;
      if (botY < 0 || topY > h) return;

      const x = ((n.note - noteMin) / noteRange) * w;
      const nw = Math.max(w / noteRange - 1, 2);
      const nh = Math.max(botY - topY, 2);

      if (n.endTime === 0) {
        // Active note — solid color + glow
        ctx.fillStyle = noteColor;
        ctx.fillRect(x, topY, nw, nh);
        ctx.shadowColor = noteColor;
        ctx.shadowBlur = 8;
        ctx.fillRect(x, topY, nw, nh);
        ctx.shadowBlur = 0;
      } else {
        // Finished note — fade trail based on age
        const age = now - n.endTime;
        const fadeRatio = 1 - (age / visWindow);
        const alpha = Math.max(0.05, fadeRatio * 0.7);
        // Parse trail color and apply dynamic alpha
        ctx.globalAlpha = alpha;
        ctx.fillStyle = trailColor;
        ctx.fillRect(x, topY, nw, nh);
        // Soft glow on recent trails
        if (fadeRatio > 0.6) {
          ctx.shadowColor = trailColor;
          ctx.shadowBlur = 4 * fadeRatio;
          ctx.fillRect(x, topY, nw, nh);
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
      }
    };

    for (const n of this.finishedNotes) drawNote(n);
    for (const n of this.activeNotes) drawNote(n);
  }

  getFraction(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
}

// -- Waveform visualization (AnalyserNode) -----------------------------------

class WaveformCanvas {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array<ArrayBuffer>;
  private animId = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, audioCtx: AudioContext, sourceNode: AudioNode) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d')!;
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.85;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    // Splice analyser between source and destination
    sourceNode.disconnect();
    sourceNode.connect(this.analyser);
    this.analyser.connect(audioCtx.destination);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx2d.scale(devicePixelRatio, devicePixelRatio);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = 0; }
    // Draw flat line when stopped
    this.drawFlat();
  }

  private tick = (): void => {
    if (!this.running) return;
    this.draw();
    this.animId = requestAnimationFrame(this.tick);
  };

  private drawFlat(): void {
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const ctx = this.ctx2d;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--bg-viz') || '#0a1628';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = cssVar('--wave-stroke') || '#e94560';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  private draw(): void {
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const ctx = this.ctx2d;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssVar('--bg-viz') || '#0a1628';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    const gridColor = cssVar('--wave-grid') || 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Get frequency data for bars + time domain for wave
    this.analyser.getByteTimeDomainData(this.dataArray);
    const bufLen = this.analyser.frequencyBinCount;
    const sliceWidth = w / bufLen;

    // Fill area under waveform
    const fillColor = cssVar('--wave-fill') || 'rgba(233,69,96,0.25)';
    const strokeColor = cssVar('--wave-stroke') || '#e94560';

    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(w, h / 2);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Stroke waveform line
    ctx.beginPath();
    x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Frequency bars overlay (subtle)
    this.analyser.getByteFrequencyData(this.dataArray);
    const barCount = 64;
    const barW = w / barCount;
    const step = Math.floor(bufLen / barCount);
    ctx.fillStyle = cssVar('--accent-dim') || 'rgba(233,69,96,0.3)';
    for (let i = 0; i < barCount; i++) {
      const val = this.dataArray[i * step];
      const barH = (val / 255) * h * 0.5;
      ctx.fillRect(i * barW, h - barH, barW - 1, barH);
    }
  }
}

// -- Theme management --------------------------------------------------------

function initThemes(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.theme-btn');
  const root = document.documentElement;

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      if (!theme) return;
      root.dataset.theme = theme;
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Persist in localStorage
      try { localStorage.setItem('midiocre-theme', theme); } catch { /* ok */ }
    });
  });

  // Restore saved theme
  try {
    const saved = localStorage.getItem('midiocre-theme');
    if (saved) {
      root.dataset.theme = saved;
      buttons.forEach(b => {
        b.classList.toggle('active', b.dataset.theme === saved);
      });
    }
  } catch { /* ok */ }
}

// -- Viz toggle management ---------------------------------------------------

type VizMode = 'piano' | 'waterfall' | 'waveform';

function initVizToggle(
  onSwitch: (mode: VizMode) => void,
): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.viz-toggle');
  const pianoEl = $('piano-canvas') as HTMLCanvasElement;
  const waterfallEl = $('waterfall-canvas') as HTMLCanvasElement;
  const waveformEl = $('waveform-canvas') as HTMLCanvasElement;

  const canvasMap: Record<VizMode, HTMLCanvasElement> = {
    piano: pianoEl, waterfall: waterfallEl, waveform: waveformEl,
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.viz as VizMode;
      if (!mode) return;

      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      for (const [key, canvas] of Object.entries(canvasMap)) {
        canvas.style.display = key === mode ? 'block' : 'none';
      }

      onSwitch(mode);
    });
  });
}

// -- Main demo initialization ------------------------------------------------

async function init(): Promise<void> {
  const config = await loadConfig();
  const player = new Midiocre(config);
  (window as any).player = player;

  // -- DOM refs --
  const status = $('status-text');
  const sf2Select = $('sf2-select') as HTMLSelectElement;
  const midiSelect = $('midi-select') as HTMLSelectElement;
  const instrumentSelect = $('instrument-select') as HTMLSelectElement;
  const btnPlayPause = $('btn-playpause') as HTMLButtonElement;
  const btnStop = $('btn-stop') as HTMLButtonElement;
  const btnPrev = $('btn-prev') as HTMLButtonElement;
  const btnNext = $('btn-next') as HTMLButtonElement;
  const chkLoop = $('chk-loop') as HTMLInputElement;
  const tempoSlider = $('tempo-slider') as HTMLInputElement;
  const tempoValue = $('tempo-value');
  const volumeSlider = $('volume-slider') as HTMLInputElement;
  const volumeValue = $('volume-value');
  const currentTimeEl = $('current-time');
  const totalTimeEl = $('total-time');
  const voiceCountEl = $('voice-count');
  const pianoCanvasEl = $('piano-canvas') as HTMLCanvasElement;
  const waterfallCanvasEl = $('waterfall-canvas') as HTMLCanvasElement;
  const waveformCanvasEl = $('waveform-canvas') as HTMLCanvasElement;

  // -- Viz instances --
  const pianoCanvas = new PianoCanvas(pianoCanvasEl);
  const waterfallCanvas = new WaterfallCanvas(waterfallCanvasEl);
  // WaveformCanvas needs audioContext + outputNode — created after first SF2 load
  let waveformCanvas: WaveformCanvas | null = null;
  let currentViz: VizMode = 'piano';

  function ensureWaveform(): void {
    if (waveformCanvas) return;
    waveformCanvas = new WaveformCanvas(waveformCanvasEl, player.audioContext, player.outputNode);
  }

  // -- Expose runtime API methods --
  (player as any).listSF2Files = () => config.sf2Files ?? [];
  (player as any).listMIDIFiles = () => config.midiFiles ?? [];

  // -- Populate dropdowns --
  function populateSelect(sel: HTMLSelectElement, items: string[], defaultVal?: string): void {
    sel.innerHTML = '';
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
      if (item === defaultVal) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  populateSelect(sf2Select, config.sf2Files ?? [], config.defaultSF2);
  populateSelect(midiSelect, config.midiFiles ?? [], config.defaultMIDI);

  // -- Initial slider values --
  volumeSlider.value = String(Math.round((config.volume ?? 0.8) * 100));
  volumeValue.textContent = `${volumeSlider.value}%`;
  tempoSlider.value = String(Math.round((config.tempo ?? 1.0) * 100));
  tempoValue.textContent = `${tempoSlider.value}%`;
  chkLoop.checked = config.loop ?? false;

  // -- Transport button state --
  let isPlaying = false;

  function updateTransportButtons(state: string): void {
    isPlaying = state === 'playing';
    btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
    btnPlayPause.title = isPlaying ? 'Pause' : 'Play';
    btnStop.disabled = state === 'stopped';
    // Next button is only enabled if there's a track after the current one
    const midiFiles = config.midiFiles ?? [];
    const currentIdx = midiFiles.indexOf(midiSelect.value);
    btnNext.disabled = currentIdx < 0 || currentIdx >= midiFiles.length - 1;
  }

  player.onStateChange((state) => {
    updateTransportButtons(state);
    if (state === 'stopped') {
      pianoCanvas.clearNotes();
      pianoCanvas.setProgress(0);
      waterfallCanvas.clear();
      waterfallCanvas.stop();
      waveformCanvas?.stop();
      currentTimeEl.textContent = '0:00';
      voiceCountEl.textContent = '';
    } else if (state === 'playing') {
      if (currentViz === 'waterfall') waterfallCanvas.start();
      if (currentViz === 'waveform') { ensureWaveform(); waveformCanvas!.start(); }
    } else if (state === 'paused') {
      waterfallCanvas.stop();
      waveformCanvas?.stop();
    }
  });

  player.onProgress((time, duration) => {
    currentTimeEl.textContent = formatTime(time);
    totalTimeEl.textContent = formatTime(duration);
    pianoCanvas.setProgress(duration > 0 ? time / duration : 0);
    waterfallCanvas.setTime(time);
  });

  player.onEvent((ev) => {
    if (ev.type === 0x90 && ev.data2 > 0) {
      pianoCanvas.noteOn(ev.data1);
      waterfallCanvas.noteOn(ev.data1, ev.channel ?? 0, ev.data2, waterfallCanvas['now'] || 0);
    } else if (ev.type === 0x80 || (ev.type === 0x90 && ev.data2 === 0)) {
      pianoCanvas.noteOff(ev.data1);
      waterfallCanvas.noteOff(ev.data1, ev.channel ?? 0);
    }
  });

  // -- Theme + Viz init --
  initThemes();
  initVizToggle((mode) => {
    currentViz = mode;
    // Manage animation loops based on active viz
    if (mode === 'waterfall') {
      waterfallCanvas.resize();
      waterfallCanvas.start();
      waveformCanvas?.stop();
    } else if (mode === 'waveform') {
      ensureWaveform();
      waveformCanvas!.resize();
      waveformCanvas!.start();
      waterfallCanvas.stop();
    } else {
      pianoCanvas.resize();
      waterfallCanvas.stop();
      waveformCanvas?.stop();
    }
  });

  // -- Load default SF2 + MIDI --
  async function loadDefaultAssets(): Promise<void> {
    const sf2Name = sf2Select.value || (config.sf2Files?.[0] ?? '');
    const midiName = midiSelect.value || (config.midiFiles?.[0] ?? '');

    if (sf2Name) {
      status.textContent = `Loading SoundFont: ${sf2Name}…`;
      try {
        await player.loadSF2(sf2Name);
        status.textContent = `Loaded: ${sf2Name}`;
        populateInstruments();
      } catch (e: any) {
        status.textContent = `Error loading SF2: ${e.message}`;
      }
    }

    if (midiName) {
      status.textContent = `Loading MIDI: ${midiName}…`;
      try {
        await player.loadMIDI(midiName);
        totalTimeEl.textContent = formatTime(player.duration);
        status.textContent = `Ready: ${midiName} (${formatTime(player.duration)})`;
      } catch (e: any) {
        status.textContent = `Error loading MIDI: ${e.message}`;
      }
    }
  }

  function populateInstruments(): void {
    instrumentSelect.innerHTML = '<option value="-1">Auto (per-channel)</option>';
    const presets = player.listPresets();
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = String(p.index);
      opt.textContent = `${String(p.bank).padStart(3, '0')}:${String(p.preset).padStart(3, '0')} ${p.name}`;
      instrumentSelect.appendChild(opt);
    }
  }

  // -- Event handlers --

  btnPlayPause.addEventListener('click', async () => {
    if (isPlaying) player.pause(); else await player.play();
  });
  btnStop.addEventListener('click', () => player.stop());

  // |< — restart current track (or go to previous if within first 2 seconds)
  btnPrev.addEventListener('click', async () => {
    const midiFiles = config.midiFiles ?? [];
    const currentIdx = midiFiles.indexOf(midiSelect.value);
    // If we're past 2 seconds, just restart; otherwise jump to previous track
    const state = player.getState();
    if (state.currentTime > 2 && player.duration > 0) {
      player.seek(0);
      pianoCanvas.clearNotes();
      waterfallCanvas.clear();
    } else if (currentIdx > 0) {
      // Jump to previous track
      midiSelect.value = midiFiles[currentIdx - 1];
      midiSelect.dispatchEvent(new Event('change'));
    } else {
      // Already at first track and near start — just seek to 0
      player.seek(0);
      pianoCanvas.clearNotes();
      waterfallCanvas.clear();
    }
  });

  // >| — jump to next track if one exists
  btnNext.addEventListener('click', async () => {
    const midiFiles = config.midiFiles ?? [];
    const currentIdx = midiFiles.indexOf(midiSelect.value);
    if (currentIdx >= 0 && currentIdx < midiFiles.length - 1) {
      const wasPlaying = isPlaying;
      midiSelect.value = midiFiles[currentIdx + 1];
      midiSelect.dispatchEvent(new Event('change'));
      // Auto-play the next track if we were playing
      if (wasPlaying) {
        // Small delay for MIDI load to complete before playing
        setTimeout(async () => await player.play(), 200);
      }
    }
  });
  chkLoop.addEventListener('change', () => { player.loop = chkLoop.checked; });

  tempoSlider.addEventListener('input', () => {
    const pct = Number(tempoSlider.value);
    player.tempo = pct / 100;
    tempoValue.textContent = `${pct}%`;
  });

  volumeSlider.addEventListener('input', () => {
    const pct = Number(volumeSlider.value);
    player.volume = pct / 100;
    volumeValue.textContent = `${pct}%`;
  });

  // Seamless SF2 hot-swap — no need to stop/restart playback
  sf2Select.addEventListener('change', async () => {
    const name = sf2Select.value;
    if (!name) return;
    status.textContent = `Switching SoundFont: ${name}…`;
    try {
      // loadSF2 now does hot-swap internally if transport is active
      await player.loadSF2(name);
      populateInstruments();
      status.textContent = `SoundFont switched: ${name}`;
    } catch (e: any) {
      status.textContent = `Error: ${e.message}`;
    }
  });

  midiSelect.addEventListener('change', async () => {
    const name = midiSelect.value;
    if (!name) return;
    player.stop();
    pianoCanvas.clearNotes();
    waterfallCanvas.clear();
    status.textContent = `Loading MIDI: ${name}…`;
    try {
      await player.loadMIDI(name);
      totalTimeEl.textContent = formatTime(player.duration);
      currentTimeEl.textContent = '0:00';
      pianoCanvas.setProgress(0);
      status.textContent = `Ready: ${name} (${formatTime(player.duration)})`;
    } catch (e: any) {
      status.textContent = `Error: ${e.message}`;
    }
  });

  instrumentSelect.addEventListener('change', () => {
    player.setInstrument(Number(instrumentSelect.value));
  });

  // Canvas click-to-seek (works on all viz modes)
  for (const el of [pianoCanvasEl, waterfallCanvasEl, waveformCanvasEl]) {
    el.addEventListener('click', (e) => {
      const rect = el.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const seekTime = fraction * player.duration;
      player.seek(seekTime);
      pianoCanvas.clearNotes();
      waterfallCanvas.clear();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  SoundFont Builder UI
  // ══════════════════════════════════════════════════════════════════

  interface CatalogPreset {
    index: number;
    bank: number;
    preset: number;
    name: string;
    zones: number;
  }

  interface CatalogEntry {
    filename: string;
    name: string;
    presetCount: number;
    presets: CatalogPreset[];
  }

  interface SelectionItem {
    sf2File: string;
    sf2Name: string;
    presetIndex: number;
    bank: number;
    preset: number;
    name: string;
  }

  const builderToggle = $('builder-toggle');
  const builderBody = $('builder-body');
  const builderArrow = builderToggle.querySelector('.builder-arrow')!;
  const catalogListEl = $('sf2-catalog-list');
  const selectionListEl = $('selection-list');
  const selectionCountEl = $('selection-count');
  const btnClearSelection = $('btn-clear-selection') as HTMLButtonElement;
  const btnBuildSF2 = $('btn-build-sf2') as HTMLButtonElement;
  const buildNameInput = $('sf2-build-name') as HTMLInputElement;
  const buildFilenameInput = $('sf2-build-filename') as HTMLInputElement;
  const buildEngineerInput = $('sf2-build-engineer') as HTMLInputElement;
  const buildCopyrightInput = $('sf2-build-copyright') as HTMLInputElement;
  const buildCommentsInput = $('sf2-build-comments') as HTMLInputElement;
  const buildOverwriteChk = $('sf2-build-overwrite') as HTMLInputElement;
  const buildResultEl = $('build-result');

  // Respect build-time flag so static Pages sites (no backend API) can
  // clearly show the builder as unavailable instead of attempting to
  // call /api/build-sf2 which won't exist on GitHub Pages.
  const builderEnabled = (config.enableSF2Builder ?? true) as boolean;

  if (!builderEnabled) {
    // show an explanatory hint and disable controls (keeps UI visible)
    const hint = document.createElement('div');
    hint.className = 'builder-hint';
    hint.textContent = 'SoundFont Builder is disabled on this deployed demo (no server-side API).';
    // replace sources pane content with the hint
    const sources = $('builder-sources');
    sources.innerHTML = '';
    sources.appendChild(hint);

    // disable interactive controls to avoid confusion
    btnBuildSF2.disabled = true;
    btnClearSelection.disabled = true;
    buildNameInput.disabled = true;
    buildFilenameInput.disabled = true;
    buildEngineerInput.disabled = true;
    buildCopyrightInput.disabled = true;
    buildCommentsInput.disabled = true;
    buildOverwriteChk.disabled = true;

    // visually mark the toggle as disabled and prevent open/close
    builderToggle.classList.add('disabled');
    builderToggle.title = 'SoundFont Builder is disabled in this build.';
    builderToggle.addEventListener('click', () => { /* no-op when disabled */ });
  }

  let catalog: CatalogEntry[] = [];
  const selection: SelectionItem[] = [];
  let builderOpen = false;

  // Toggle builder panel
  builderToggle.addEventListener('click', () => {
    if (!builderEnabled) return; // Prevent opening when disabled
    builderOpen = !builderOpen;
    builderBody.classList.toggle('open', builderOpen);
    builderArrow.classList.toggle('open', builderOpen);
    // Load catalog on first open
    if (builderOpen && catalog.length === 0) {
      loadCatalog();
    }
  });

  // Load the full SF2 catalog from the server
  async function loadCatalog(): Promise<void> {
    try {
      const resp = await fetch('/api/sf2-catalog');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      catalog = data.catalog;
      renderCatalog();
    } catch (e: any) {
      catalogListEl.innerHTML = `<div class="builder-hint">Failed to load catalog: ${e.message}</div>`;
    }
  }

  // Render the catalog tree (left panel)
  function renderCatalog(): void {
    catalogListEl.innerHTML = '';
    for (const entry of catalog) {
      const sf2El = document.createElement('div');
      sf2El.className = 'catalog-sf2';

      const headerEl = document.createElement('div');
      headerEl.className = 'catalog-sf2-header';

      const arrowEl = document.createElement('span');
      arrowEl.className = 'catalog-sf2-arrow';
      arrowEl.textContent = '▸';

      const nameEl = document.createElement('span');
      nameEl.textContent = entry.name || entry.filename;

      const countEl = document.createElement('span');
      countEl.className = 'catalog-sf2-count';
      countEl.textContent = `${entry.presetCount} presets`;

      const selectAllBtn = document.createElement('button');
      selectAllBtn.className = 'catalog-select-all';
      selectAllBtn.textContent = 'Select All';
      selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const p of entry.presets) {
          addToSelection(entry.filename, entry.name, p);
        }
        renderCatalog();
        renderSelection();
      });

      headerEl.appendChild(arrowEl);
      headerEl.appendChild(nameEl);
      headerEl.appendChild(countEl);
      headerEl.appendChild(selectAllBtn);

      const presetsEl = document.createElement('div');
      presetsEl.className = 'catalog-presets';

      headerEl.addEventListener('click', () => {
        arrowEl.classList.toggle('open');
        presetsEl.classList.toggle('open');
      });

      for (const p of entry.presets) {
        const presetEl = document.createElement('div');
        presetEl.className = 'catalog-preset';
        const isSelected = selection.some(
          s => s.sf2File === entry.filename && s.presetIndex === p.index
        );
        if (isSelected) presetEl.classList.add('selected');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isSelected;

        const idSpan = document.createElement('span');
        idSpan.className = 'preset-id';
        idSpan.textContent = `${String(p.bank).padStart(3, '0')}:${String(p.preset).padStart(3, '0')}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'preset-name';
        nameSpan.textContent = p.name;

        presetEl.appendChild(cb);
        presetEl.appendChild(idSpan);
        presetEl.appendChild(nameSpan);

        presetEl.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          cb.checked = !cb.checked;
          togglePresetSelection(entry.filename, entry.name, p, cb.checked);
          presetEl.classList.toggle('selected', cb.checked);
        });

        cb.addEventListener('change', () => {
          togglePresetSelection(entry.filename, entry.name, p, cb.checked);
          presetEl.classList.toggle('selected', cb.checked);
        });

        presetsEl.appendChild(presetEl);
      }

      sf2El.appendChild(headerEl);
      sf2El.appendChild(presetsEl);
      catalogListEl.appendChild(sf2El);
    }
  }

  function togglePresetSelection(sf2File: string, sf2Name: string, p: CatalogPreset, add: boolean): void {
    if (add) {
      addToSelection(sf2File, sf2Name, p);
    } else {
      removeFromSelection(sf2File, p.index);
    }
    renderSelection();
  }

  function addToSelection(sf2File: string, sf2Name: string, p: CatalogPreset): void {
    // Don't add duplicates
    if (selection.some(s => s.sf2File === sf2File && s.presetIndex === p.index)) return;
    selection.push({
      sf2File,
      sf2Name,
      presetIndex: p.index,
      bank: p.bank,
      preset: p.preset,
      name: p.name,
    });
  }

  function removeFromSelection(sf2File: string, presetIndex: number): void {
    const idx = selection.findIndex(s => s.sf2File === sf2File && s.presetIndex === presetIndex);
    if (idx >= 0) selection.splice(idx, 1);
  }

  // Render the selection list (right panel)
  function renderSelection(): void {
    selectionCountEl.textContent = `(${selection.length})`;
    btnClearSelection.disabled = selection.length === 0;
    btnBuildSF2.disabled = selection.length === 0 || !buildNameInput.value.trim();

    if (selection.length === 0) {
      selectionListEl.innerHTML = '<div class="builder-hint">Select presets from the left to add them here.</div>';
      return;
    }

    selectionListEl.innerHTML = '';
    for (const item of selection) {
      const el = document.createElement('div');
      el.className = 'selection-item';

      const sourceSpan = document.createElement('span');
      sourceSpan.className = 'sel-source';
      sourceSpan.textContent = item.sf2File.replace('.sf2', '');
      sourceSpan.title = item.sf2File;

      const presetSpan = document.createElement('span');
      presetSpan.className = 'sel-preset';
      presetSpan.textContent = `${String(item.bank).padStart(3, '0')}:${String(item.preset).padStart(3, '0')} ${item.name}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'sel-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        removeFromSelection(item.sf2File, item.presetIndex);
        renderSelection();
        renderCatalog(); // update checkboxes
      });

      el.appendChild(sourceSpan);
      el.appendChild(presetSpan);
      el.appendChild(removeBtn);
      selectionListEl.appendChild(el);
    }
  }

  // Clear all selections
  btnClearSelection.addEventListener('click', () => {
    selection.length = 0;
    renderSelection();
    renderCatalog();
  });

  // Auto-generate filename from name
  buildNameInput.addEventListener('input', () => {
    const name = buildNameInput.value.trim();
    if (name && !buildFilenameInput.dataset.userEdited) {
      buildFilenameInput.value = name.replace(/[^a-zA-Z0-9]/g, '_') + '.sf2';
    }
    btnBuildSF2.disabled = selection.length === 0 || !name;
  });

  buildFilenameInput.addEventListener('input', () => {
    buildFilenameInput.dataset.userEdited = 'true';
  });

  // Build the custom SF2
  btnBuildSF2.addEventListener('click', async () => {
    if (!builderEnabled) return; // Shouldn't happen since button is disabled, but safety check

    const name = buildNameInput.value.trim();
    const filename = buildFilenameInput.value.trim() || (name.replace(/[^a-zA-Z0-9]/g, '_') + '.sf2');

    if (!name || selection.length === 0) return;

    // Group selections by source SF2 file
    const groupedMap = new Map<string, number[]>();
    for (const item of selection) {
      if (!groupedMap.has(item.sf2File)) groupedMap.set(item.sf2File, []);
      groupedMap.get(item.sf2File)!.push(item.presetIndex);
    }

    const selections = [...groupedMap.entries()].map(([sf2File, presetIndices]) => ({
      sf2File,
      presetIndices,
    }));

    // Show building state
    buildResultEl.className = 'build-result building';
    buildResultEl.textContent = `🔨 Building "${name}" from ${selection.length} presets across ${selections.length} source(s)…`;
    buildResultEl.style.display = 'block';
    btnBuildSF2.disabled = true;

    try {
      const resp = await fetch('/api/build-sf2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          filename,
          engineers: buildEngineerInput.value.trim() || undefined,
          copyright: buildCopyrightInput.value.trim() || undefined,
          comments: buildCommentsInput.value.trim() || undefined,
          overwrite: buildOverwriteChk.checked,
          selections,
        }),
      });

      const data = await resp.json();

      if (resp.ok && data.success) {
        const sizeKB = (data.size / 1024).toFixed(1);
        buildResultEl.className = 'build-result success';
        buildResultEl.innerHTML =
          `✅ <strong>${data.filename}</strong> created successfully!<br>` +
          `${data.presets} presets · ${data.instruments} instruments · ${data.samples} samples · ${sizeKB} KB`;

        // Refresh the SF2 dropdown to include the new file
        const newFile = data.filename;
        if (!(config.sf2Files ?? []).includes(newFile)) {
          config.sf2Files = [...(config.sf2Files ?? []), newFile];
          populateSelect(sf2Select, config.sf2Files, sf2Select.value);
        }
        status.textContent = `SoundFont "${name}" built and saved as ${newFile}`;
      } else {
        buildResultEl.className = 'build-result error';
        buildResultEl.textContent = `❌ ${data.error || 'Unknown error'}`;
      }
    } catch (e: any) {
      buildResultEl.className = 'build-result error';
      buildResultEl.textContent = `❌ Network error: ${e.message}`;
    } finally {
      btnBuildSF2.disabled = selection.length === 0 || !buildNameInput.value.trim();
    }
  });

  // -- Start --
  await loadDefaultAssets();
  updateTransportButtons('stopped');
}

// DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
