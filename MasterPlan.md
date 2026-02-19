# Midiocre — Master One-Shot Build Prompt (for a highly capable dev agent)

You are a highly capable autonomous development agent. Build **Midiocre** end-to-end in one pass.

## 1) Mission

Create a **standalone, high-performance, modular, browser-first MIDI playback library** named **Midiocre** (TypeScript + HTML5 + CSS).

The intended use is easy integration into other web apps (especially browser games) as a lightweight background music system with minimal code bloat and minimal runtime overhead.

Tone note: the name “Midiocre” is intentionally humorous; implementation quality should be the opposite—lean, robust, and production-grade.

---

## 2) Hard constraints

1. **No external MIDI playback engines/parsers/synth libraries.**
	- Implement MIDI + SoundFont support directly in this codebase.
2. **Spec compliance is a core requirement** (not best effort).
3. **Browser runtime target** for playback library.
4. **TypeScript-first** codebase.
5. **Modular architecture** with clear boundaries between parser, scheduler, synth/voice engine, SF2 handling, and UI demo.
6. Development assets in these folders are for build/test/demo only and **must not be bundled into the distributable package by default**:
	- `SoundFonts/`
	- `DemoMidiFiles/`
7. Include a **separate TypeScript CLI utility** for SoundFont 2 inspection/manipulation.

---

## 3) Source materials you must honor

Treat these repository docs as normative references and implement accordingly:

- `TechnicalSpecifications/midiformat.txt`
- `TechnicalSpecifications/MIDI_1.0_Detailed_Specification_V4.2.1_96-1-4.txt`
- `TechnicalSpecifications/SFSPEC21.txt`
- `DEMO_CONTROLS.md`

Also use:

- `SoundFonts/*.sf2` files for development/test validation.
- `DemoMidiFiles/*.mid` for playback validation.

---

## 4) Required feature set — core Midiocre library

### A. MIDI file parser + timeline model

Implement robust parsing for Standard MIDI Files:

- Chunks: `MThd`, `MTrk`, unknown chunk skipping.
- Header parsing: format 0/1/2, track count, division.
- Delta-time VLQ parsing/writing.
- Running status.
- Channel messages (note on/off, program change, CC, pitch bend, etc.).
- SysEx events (`F0`, `F7`) handling at parse level.
- Meta events, including at minimum:
  - Track name
  - Tempo (`FF 51`)
  - Time signature (`FF 58`)
  - Key signature (`FF 59`)
  - End of track (`FF 2F`)
- Tempo map construction and tick↔time conversion.
- Seek-safe event timeline representation.

### B. Playback scheduler + transport

Implement a reliable playback transport with:

- Play / pause / stop.
- Looping.
- Seeking by timeline position.
- Real-time tempo scaling (global tempo multiplier).
- Stable scheduling with low jitter using Web Audio timebase.
- State serialization/restoration (`getState` / `restoreState`) for demo parity.

### C. Synth/voice layer using SF2 data

Implement a practical browser synthesizer path that can render from SF2 instrument data:

- Load and parse SF2 (RIFF `sfbk`) with correct chunk/sub-chunk expectations.
- Respect fixed ordering requirements for `pdta` hydra sub-chunks.
- Graceful handling of unknown/extra INFO sub-chunks.
- Instrument/preset/program selection (bank/program aware where available).
- Polyphonic voice handling with voice allocation/stealing strategy.
- Envelope and basic articulation support sufficient for convincing playback.
- Per-channel volume and master volume.

### D. Public API surface (library)

Design a clean API meant for host app integration. Include at least:

- Loading:
  - MIDI from URL/ArrayBuffer/File
  - SF2 from URL/ArrayBuffer/File
- Transport:
  - `play()`, `pause()`, `stop()`, `seek()`, loop control
- Controls:
  - tempo and volume setters/getters
- Discovery helpers:
  - list available MIDI/SF2 in demo-config context
- Introspection/state:
  - `getConfig()`, `configure(...)`, `getState()`, `restoreState(...)`

Keep API documented in code and README.

---

## 5) Required feature set — demo browser player

Create a small demo player app that demonstrates library capabilities and implements `DEMO_CONTROLS.md` behavior:

### UI controls

- Play / Pause / Stop
- Tempo slider
- Volume slider
- SoundFont dropdown
- MIDI dropdown
- Instrument dropdown (sample-level selection)
- Loop checkbox
- Progress + time display

### Config precedence and defaults

Implement config source priority exactly:

1. Built-in defaults
2. `demo-player.config.json`
3. `window.MidiocrePlayerConfig`
4. `window.player.configure(...)`

Default demo paths:

- SF2: `/SoundFonts`
- MIDI: `/DemoMidiFiles`

### Runtime API highlights (demo/global)

Expose and support:

- `window.player.listSF2Files()`
- `window.player.listMIDIFiles()`
- `window.player.getConfig()`
- `window.player.configure(...)`
- `window.player.getState()` / `restoreState(...)`

### Seek behavior

- Clicking the piano canvas seeks by timeline position.

### Hot swap behavior

- Selecting a new SF2 calls `loadSF2` with context preservation by default.

---

## 6) Required feature set — SF2 CLI utility (TypeScript, backend/Node style)

Implement a CLI utility focused on SoundFont 2 interrogation and manipulation.

### CLI goals

1. **Inspect / list internals**
	- Print INFO metadata.
	- List presets, instruments, zones, samples.
	- Show mapping relationships (preset -> instrument -> sample).
2. **Extract selected voices/components**
	- Allow selecting by preset/instrument/sample identifiers.
3. **Repack/build new custom `.sf2`**
	- Build minimal custom SF2 from selected assets.
	- Preserve structural correctness of RIFF and `pdta` references.
4. **General convenience operations**
	- Human-readable summaries.
	- Optional JSON output mode for tooling.

### CLI quality bar

- Deterministic output.
- Helpful errors for malformed/structurally unsound SF2.
- Validation checks for dangling indices/references.

---

## 7) Architecture and implementation expectations

Use clear modules with separation of concerns, e.g.:

- `midi/` parser + event model + tempo map
- `sf2/` RIFF + hydra parser + builder utilities
- `synth/` voices, envelopes, mixing path
- `engine/` scheduler + transport
- `api/` public facade
- `demo/` browser UI shell
- `cli/` sf2 manipulation commands

Additional expectations:

- Strict TypeScript typing.
- Avoid global mutable state where unnecessary.
- Defensive parsing and bounds checks.
- Performance-aware allocations in hot paths.
- Keep runtime dependencies minimal.

---

## 8) Non-goals / scope boundaries

- Do not implement unrelated DAW/editor features.
- Do not bloat with framework-heavy UI.
- Do not require external services.
- Do not include large demo assets in published package artifacts.

---

## 9) Build + developer experience

Provide a clean project setup with:

- Scripts for build, dev demo serve, lint/typecheck, and tests/sanity checks.
- One-command way to run demo locally.
- One-command way to run CLI examples.

Include concise documentation:

- Root README with quick start and integration snippet.
- API reference summary.
- CLI usage examples.

---

## 10) Validation requirements (must execute)

Before finalizing, run sanity checks that demonstrate:

1. Demo loads and plays at least one provided MIDI.
2. SoundFont switching works during session and preserves context.
3. Tempo and volume controls affect playback as expected.
4. Seek works from piano-canvas interaction path.
5. CLI can:
	- inspect a provided SF2,
	- list internals,
	- extract selected voice components,
	- repack a valid custom SF2.

Keep checks focused and meaningful; avoid unnecessary test bloat.

---

## 11) Deliverable format (important)

Return:

1. A brief architecture summary.
2. Full file tree created/updated.
3. Complete source code for all required files.
4. Build/run commands.
5. Short validation report showing what passed.
6. Notes on any unavoidable spec tradeoffs (if any), with rationale.

Assume this is a one-shot implementation request: make pragmatic choices, keep code lean, and prioritize correctness + performance.

---

## 12) Project identity

Project/library name: **Midiocre**

Design principle: **“Mediocre by name, excellent by implementation.”**