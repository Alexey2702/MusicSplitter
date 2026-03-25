# 🎵 MusicAI

Desktop app for musicians — stem splitting, BPM & key detection, audio file manager.

Built with Python (Flask + pywebview) and vanilla JS.

## Features

- **Stem Splitter** — split any track into vocals/instrumental (2-stem) or drums/bass/other/vocals (4-stem) using [Demucs htdemucs](https://github.com/facebookresearch/demucs)
- **Mixer view** — after splitting, each stem gets its own waveform with Mute, Solo and volume controls
- **BPM detection** — multi-method voting (Essentia RhythmExtractor + PercivalBpmEstimator + librosa), analyzes middle 60% of track to avoid intro/outro noise
- **Key detection** — multi-profile voting across 4 Essentia profiles (temperley, krumhansl, edma, bgate) + harmonic signal boost; falls back to librosa chroma if Essentia unavailable
- **Camelot wheel** — click the key badge to toggle between note name and Camelot code (e.g. `Am минор` ↔ `8A`)
- **Analysis cache** — results stored in `.analysis_cache.json`, invalidated on file change; re-analyzes if key confidence < 75%
- **File manager** — browse, play, rename, delete audio files; quick access to Desktop/Downloads/Music
- **Bottom player bar** — shows BPM and key for currently playing track

## Requirements

- Python 3.9+
- macOS or Windows 10/11

## Installation

```bash
git clone <repo>
cd musicai

python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

pip install torch demucs librosa soundfile tqdm flask pywebview
```

### Optional (macOS, improves BPM/key accuracy significantly)

```bash
pip install essentia
```

On Windows, essentia is not available via PyPI — the app falls back to librosa automatically.

## Run

```bash
python app.py
```

First run downloads the `htdemucs` model (~300MB).

## Supported formats

MP3 · WAV · FLAC · AIFF · M4A · OGG · OPUS

## Notes

- Processing runs on CPU by default; GPU speeds it up significantly
- Analysis cache is saved to `.analysis_cache.json` in the project root (gitignored)
- On Windows, pywebview uses EdgeWebView2 (built into Windows 10/11, no extra install needed)

## License

MIT
