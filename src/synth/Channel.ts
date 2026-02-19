// Midiocre — MIDI channel state

export class Channel {
  program: number = 0;
  bank: number = 0;
  volume: number = 100;       // CC 7
  expression: number = 127;    // CC 11
  pan: number = 64;            // CC 10 (64 = center)
  pitchBend: number = 8192;    // 14-bit center
  pitchBendRange: number = 2;  // semitones (default ±2)
  sustain: boolean = false;    // CC 64
  modWheel: number = 0;        // CC 1

  /** Calculated gain from volume + expression (0–1) */
  get gain(): number {
    return (this.volume / 127) * (this.expression / 127);
  }

  /** Calculated pitch bend in semitones */
  get pitchBendSemitones(): number {
    return ((this.pitchBend - 8192) / 8192) * this.pitchBendRange;
  }

  /** Calculated pan position (-1 to 1) */
  get panPosition(): number {
    return (this.pan - 64) / 64;
  }

  /** Reset to default state */
  reset(): void {
    this.program = 0;
    this.bank = 0;
    this.volume = 100;
    this.expression = 127;
    this.pan = 64;
    this.pitchBend = 8192;
    this.pitchBendRange = 2;
    this.sustain = false;
    this.modWheel = 0;
  }

  /** Process a CC message */
  handleCC(controller: number, value: number): void {
    switch (controller) {
      case 1:  this.modWheel = value; break;
      case 7:  this.volume = value; break;
      case 10: this.pan = value; break;
      case 11: this.expression = value; break;
      case 64: this.sustain = value >= 64; break;
      case 121: this.reset(); break; // Reset All Controllers
    }
  }
}
