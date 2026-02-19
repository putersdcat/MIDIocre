Pre job setup.... 

---------------------
Via GitHub Copilot Chat: GPT-5.2-Codex
---------------------

I need you to formulate a comprehensive prompt from the information attached and goals described below, remember you are not actioning on this, just researching and writing the prompt...

"I am about to give to a very highly capable development copilot llm agent. the end goal is to one-shot an entire specifications compliant in browser, type-script, html5, css base midi playback library, that is made to be very modular, and fully featured, and easy to integrate as a background music midi player in other web app projects. Only as a pure demonstration of the library's abilities the package will also include a small browser based player with the capabilities described here `DEMO_CONTROLS.md`. The library is called Midiocre, a play on words and a combination of MIDI and Mediocre, this should be funny because when its done it should be nothing but Mediocre, it will be a super lean, no nonsense, highly performant in browser midi playback library perfect for integration into browser games that need the midi playback with zero performance setbacks or code bloat from external library's. With that said a core tenant of the development is that it is completely a standalone one off implementation of the midi standards as documented in the repository `TechnicalSpecifications` and to further assist in the development and testing both Sound Font 2 files, `SoundFonts` and some Midi format music files `DemoMidiFiles` are included for the development phase, but will not be part of the final package. However we will by the end be able to make a very focused custom SoundFont file that will be comprised of a selection of a few of the best sounding waveforms in the collection of SoundFont files included here. So as a side function the library will have the utility to be able to cut out specific SoundFont "voices" and to then pack them back into new custom sound font files (.sf2), and this sub utility can be done in a type script CLI style backend utility. It should also touch on the interrogation and listing of SoundFont files internal data structures and generally allow for the convenient and logical manipulation of the sound font 2 format like any common CLI utility for specialized file container format would."

Please output your prompt answer as a single markdown file in the root of this workspace.

#codebase #listDirectory 
---------------------
Via GitHub Copilot Chat: Claude Opus 4.6
---------------------

Please fully deliver the scope of work mapped out in the attached `MasterPlan.md`. Do not take any breaks, just work continuously and autonomously until the project is 100% delivered as specified or die trying.

#codebase #listDirectory 

---------------------
Steering, injection 1... <pasted screenshot of previous failed attempt>
---------------------
here is a similar project that looks a little cooler, could you also add this interesting waveform visual or something like it as an optional thing to toggle betweent that and the piano, and also a couple color themes, and 
---------------------

---------------------
Steering, injection 2...
---------------------
also can you please be sure to validate and document well the use of the soundfont editing tools, and as a PoC please make a custom sound font Sf2 file with at least 50 voices (10 from each current file) in it, pick your favorite, based on whats needed to play these files and whatever else smells good to you! then test load that sf2 file in the app validate with playwright. this is the one we will package with the library.
---------------------

---------------------
Steering, injection 3...
---------------------
also the hot swapping currently can handle jumping from one instrument in a soundfont file to the next, but try and make it alos able to jump from one soundfont file to the next, with out restarting the midi file, this would be very usefull in the library for restoring state, it will need some buffer time for sure after the new wound font file is selected, but thats ok as long as it gets picked up a few seconds later without interrupt, and it coule try and select the matching insrument in the next sound file if auto is not selected on the first, otherwise fall back or default to auto.
---------------------

---------------------
Steering, injection 4...
---------------------
can you please add the buttons like |< and >| wrapping the play and pause, and combine the play and pause buttons into one. these other requested buttons are for return to start of current track, or jump to next track if one exists....
---------------------

---------------------
Shit, I was too, slow  this was new prompted sessing 3x credits gone ;-(
---------------------
also once you get all the library functions for authoring custom soundfont files, and for manipulating existing ones, can you please build into the demo player UI a way to generate a "Selecion" list of sound fonts, that could then be used to construct the calls needed to constuct a new custom sound font library from selected "Insruments" of the sound font files loaded, and then offer a way in the demo web UI to actually author the custom sound font library in the frontend, giving it a name etc. and then it will create it in the soundfont directory in the backend. basically using the web app as a demo and GUI for the soundfont editing and authoring abilities in the backend library code. 
---------------------

---------------------
Steering, injection 1...
---------------------
see AllThemProoompts.md