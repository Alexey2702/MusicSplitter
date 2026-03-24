# 🎵 MusicSplitter

CLI tool for separating audio tracks into stems using AI ([Demucs htdemucs model](https://github.com/facebookresearch/demucs)).

Splits any audio file into 4 components: **vocals, drums, bass, other instruments**.

## Requirements

- Python 3.9+
- PyTorch
- Demucs

## Installation

```bash
git clone https://github.com/your-username/musicsplitter.git
cd musicsplitter

python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

pip install torch demucs librosa soundfile tqdm
```

## Usage

Edit the paths at the bottom of `Main.py`:

```python
input_file = "/path/to/your/song.mp3"
output_folder = "/path/to/output"
```

Then run:

```bash
python Main.py
```

## Output

Four WAV files saved to the output folder:

- `vocals.wav`
- `drums.wav`
- `bass.wav`
- `other.wav`

## Notes

- First run downloads the `htdemucs` model (~300MB)
- Processing runs on CPU by default; GPU speeds it up significantly
- Supports MP3, WAV, FLAC, OGG, M4A

## License

MIT
