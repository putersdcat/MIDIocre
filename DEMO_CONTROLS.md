# Midiocre Player Demo Controls

Documentation for the demo UI (src/demo/index.html — served at / by the dev server).

## Core controls

- Transport: Play / Pause / Stop / Previous / Next
- Tempo slider (10%–300%)
- Volume slider (0–100%)
- SoundFont dropdown (select from /SoundFonts)
- MIDI dropdown (select from /DemoMidiFiles)
- Instrument dropdown (preset-level selection; `Auto` uses per-channel program changes)
- Loop checkbox
- Theme picker (choose UI color theme)
- Visualization toolbar: Piano / Waterfall / Waveform
- Piano / Waterfall / Waveform canvases (visualization + click-to-seek)
- Progress bar, time display and live voice count
- SF2 Builder: pick presets from available SoundFonts and export a custom .sf2 from the demo UI

## Paths & configuration

The demo resolves configuration in this order (highest precedence last):
1. Built-in defaults
2. `demo-player.config.json`
3. `window.MidiocrePlayerConfig`
4. `window.player.configure(...)`

Default demo paths in this repo:
- SF2: `/SoundFonts`
- MIDI: `/DemoMidiFiles`

## Seeking

Click any visualization canvas (piano, waterfall, or waveform) to seek the demo to that timeline position.

## Runtime API (demo)

- `window.player.listSF2Files()`
- `window.player.listMIDIFiles()`
- `window.player.getConfig()`
- `window.player.configure({...})`
- `window.player.getState()` / `window.player.restoreState(state)`
- `window.player.audioContext` — AudioContext instance (available after SF2 load)
- `window.player.outputNode` — output/destination node (useful for AnalyserNode wiring)

## Hot-swap behavior

Selecting a new SoundFont in the UI calls `loadSF2` and preserves playback context by default. If playback is active the API performs a non-destructive hot-swap (the synth attempts to match the selected instrument in the new SF2, allows existing voices from the old SF2 to finish naturally, and routes new notes to the new SoundFont).

## SF2 Builder (demo)

The built-in SF2 Builder in the demo lets you browse presets from available SoundFonts, select presets to include, and produce a custom .sf2 file. Use the builder panel to set metadata (name, engineer, copyright, comments) and then click "Build SoundFont".

## Notes & troubleshooting

- Waveform visualization requires access to `window.player.audioContext` and `window.player.outputNode` — these are available once an SF2 has been loaded.
- The demo UI mirrors the library API and is intended for experimentation and quick validation; use the CLI (`dist/cli/sf2cli.mjs`) for scripted/production operations.
