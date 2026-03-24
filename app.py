import webview
import threading
from flask import Flask, request, jsonify, send_from_directory
import os
import json

from Main import separate_audio_with_progress, separate_two_stems
import soundfile as sf

flask_app = Flask(__name__, template_folder='templates', static_folder='static')

# --- Analysis cache (JSON file-based DB) ---
import threading as _threading

_CACHE_PATH = os.path.join(os.path.dirname(__file__), '.analysis_cache.json')
_cache_lock = _threading.Lock()
_KEY_STRENGTH_THRESHOLD = 0.75  # re-analyze if confidence below this

def _load_cache():
    try:
        with open(_CACHE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def _save_cache(cache):
    with open(_CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

def _cache_get(path):
    """Return cached result if valid (file unchanged, key_strength sufficient)."""
    with _cache_lock:
        cache = _load_cache()
        entry = cache.get(path)
        if not entry:
            return None
        # Invalidate if file was modified
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return None
        if abs(entry.get('_mtime', 0) - mtime) > 1:
            return None
        # Re-analyze if key confidence was low
        if entry.get('key_strength', 0) < _KEY_STRENGTH_THRESHOLD:
            return None
        return entry

def _cache_set(path, data):
    with _cache_lock:
        cache = _load_cache()
        try:
            data['_mtime'] = os.path.getmtime(path)
        except OSError:
            pass
        cache[path] = data
        _save_cache(cache)

# --- Хранилище прогресса ---
separation_state = {
    "running": False,
    "progress": 0,
    "stage": "",
    "done": False,
    "error": None,
    "output_dir": None
}

# --- Маршруты ---

@flask_app.route('/')
def index():
    return send_from_directory('templates', 'index.html')

@flask_app.route('/api/separate', methods=['POST'])
def separate():
    data = request.json
    input_path = data.get('input_path')
    output_dir = data.get('output_dir')   # может быть None — спросим после
    mode = data.get('mode', '4stem')      # '4stem' или '2stem'

    if not input_path or not os.path.exists(input_path):
        return jsonify({"error": "Файл не найден"}), 400

    if separation_state["running"]:
        return jsonify({"error": "Разделение уже запущено"}), 400

    def run():
        separation_state.update({
            "running": True, "progress": 0, "done": False,
            "error": None, "output_dir": output_dir, "mode": mode,
            "result": None
        })
        try:
            if mode == '2stem':
                result = separate_two_stems(input_path, progress_callback=progress_callback)
                if result is None:
                    raise Exception("Ошибка разделения")
                # Сохраняем в памяти до выбора папки
                separation_state["result"] = result
                separation_state.update({"running": False, "done": True, "progress": 100,
                                         "needs_save": True})
            else:
                if not output_dir:
                    raise Exception("Не указана папка для сохранения")
                separate_audio_with_progress(input_path, output_dir, progress_callback=progress_callback)
                separation_state.update({"running": False, "done": True, "progress": 100,
                                         "needs_save": False})
        except Exception as e:
            separation_state.update({"running": False, "error": str(e), "done": True})

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "started"})


@flask_app.route('/api/save_two_stems', methods=['POST'])
def save_two_stems():
    """Сохраняет 2-stem результат в выбранную папку"""
    data = request.json
    output_dir = data.get('output_dir')

    if not output_dir:
        return jsonify({"error": "Не указана папка"}), 400

    result = separation_state.get("result")
    if result is None:
        return jsonify({"error": "Нет данных для сохранения"}), 400

    try:
        os.makedirs(output_dir, exist_ok=True)
        vocals, instrumental, sr = result
        sf.write(os.path.join(output_dir, 'vocals.wav'), vocals, sr)
        sf.write(os.path.join(output_dir, 'instrumental.wav'), instrumental, sr)
        separation_state["output_dir"] = output_dir
        separation_state["needs_save"] = False
        separation_state["result"] = None
        return jsonify({"status": "saved", "dir": output_dir})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def progress_callback(stage, progress, message=""):
    separation_state["stage"] = stage
    separation_state["progress"] = progress
    separation_state["message"] = message

@flask_app.route('/api/progress')
def get_progress():
    # result содержит numpy arrays — не сериализуемы, исключаем
    safe = {k: v for k, v in separation_state.items() if k != 'result'}
    return jsonify(safe)

@flask_app.route('/api/open_file_dialog')
def open_file_dialog():
    window = webview.active_window()
    result = window.create_file_dialog(
        webview.OPEN_DIALOG,
        allow_multiple=False,
        file_types=('Audio Files (*.mp3;*.wav;*.flac;*.aiff;*.m4a)', 'All files (*.*)')
    )
    if result:
        return jsonify({"path": result[0]})
    return jsonify({"path": None})

@flask_app.route('/api/open_folder_dialog')
def open_folder_dialog():
    window = webview.active_window()
    result = window.create_file_dialog(webview.FOLDER_DIALOG)
    if result:
        return jsonify({"path": result[0]})
    return jsonify({"path": None})

@flask_app.route('/api/open_stem')
def open_stem():
    import subprocess, sys
    path = request.args.get('path')
    if path and os.path.exists(path):
        if sys.platform == 'darwin':
            subprocess.Popen(['open', '-R', path])
        elif sys.platform == 'win32':
            subprocess.Popen(['explorer', '/select,', path])
        else:
            subprocess.Popen(['xdg-open', os.path.dirname(path)])
    return jsonify({"ok": True})

AUDIO_EXTS = {'.mp3', '.wav', '.flac', '.aiff', '.aif', '.m4a', '.ogg', '.opus'}

@flask_app.route('/api/fs/list')
def fs_list():
    path = request.args.get('path', os.path.expanduser('~'))
    try:
        entries = []
        with os.scandir(path) as it:
            for e in sorted(it, key=lambda x: (not x.is_dir(), x.name.lower())):
                if e.name.startswith('.'):
                    continue
                if not e.is_dir():
                    ext = os.path.splitext(e.name)[1].lower()
                    if ext not in AUDIO_EXTS:
                        continue
                try:
                    stat = e.stat()
                    entries.append({
                        'name': e.name,
                        'path': e.path,
                        'is_dir': e.is_dir(),
                        'size': stat.st_size if not e.is_dir() else None,
                        'modified': stat.st_mtime,
                    })
                except PermissionError:
                    pass
        # breadcrumb
        parts = []
        p = path
        while True:
            head, tail = os.path.split(p)
            parts.insert(0, {'name': tail or p, 'path': p})
            if head == p:
                break
            p = head
        return jsonify({'entries': entries, 'path': path, 'breadcrumb': parts})
    except PermissionError:
        return jsonify({'error': 'Нет доступа'}), 403

@flask_app.route('/api/fs/search')
def fs_search():
    query = request.args.get('q', '').lower()
    if not query or len(query) < 2:
        return jsonify({'results': []})
    start = os.path.expanduser('~')
    results = []
    try:
        for root, dirs, files in os.walk(start):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            if len(results) >= 30:
                break
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in AUDIO_EXTS and query in f.lower():
                    results.append({'name': f, 'path': os.path.join(root, f)})
                    if len(results) >= 30:
                        break
    except Exception:
        pass
    return jsonify({'results': results})

@flask_app.route('/api/fs/rename', methods=['POST'])
def fs_rename():
    data = request.json
    src, dst_name = data.get('path'), data.get('new_name')
    dst = os.path.join(os.path.dirname(src), dst_name)
    try:
        os.rename(src, dst)
        return jsonify({'ok': True, 'new_path': dst})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@flask_app.route('/api/fs/delete', methods=['POST'])
def fs_delete():
    import shutil
    path = request.json.get('path')
    try:
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@flask_app.route('/api/fs/mkdir', methods=['POST'])
def fs_mkdir():
    path = request.json.get('path')
    try:
        os.makedirs(path, exist_ok=True)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@flask_app.route('/api/stream')
def stream_audio():
    from flask import send_file
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({"error": "Файл не найден"}), 404
    return send_file(path, mimetype='audio/wav', conditional=True)

@flask_app.route('/api/fs/quickloc')
def fs_quickloc():
    loc = request.args.get('loc', 'home')
    home = os.path.expanduser('~')
    paths = {
        'home':      home,
        'desktop':   os.path.join(home, 'Desktop'),
        'downloads': os.path.join(home, 'Downloads'),
        'documents': os.path.join(home, 'Documents'),
        'music':     os.path.join(home, 'Music'),
    }
    path = paths.get(loc, home)
    if not os.path.exists(path):
        path = home
    return jsonify({'path': path})

CAMELOT_MAP = {
    # Minor (A)
    'abm': '1A', 'g#m': '1A',
    'ebm': '2A', 'd#m': '2A',
    'bbm': '3A', 'a#m': '3A',
    'fm':  '4A',
    'cm':  '5A',
    'gm':  '6A',
    'dm':  '7A',
    'am':  '8A',
    'em':  '9A',
    'bm':  '10A',
    'f#m': '11A', 'gbm': '11A',
    'dbm': '12A', 'c#m': '12A',
    # Major (B)
    'b':   '1B',
    'f#':  '2B', 'gb':  '2B',
    'db':  '3B', 'c#':  '3B',
    'ab':  '4B', 'g#':  '4B',
    'eb':  '5B', 'd#':  '5B',
    'bb':  '6B', 'a#':  '6B',
    'f':   '7B',
    'c':   '8B',
    'g':   '9B',
    'd':   '10B',
    'a':   '11B',
    'e':   '12B',
}

def _to_camelot(key_note, scale):
    raw = key_note.strip().lower()
    suffix = 'm' if scale == 'minor' else ''
    lookup = raw + suffix
    return CAMELOT_MAP.get(lookup, '?')

@flask_app.route('/api/analyze')
def analyze_track():
    import librosa
    import numpy as np
    import essentia.standard as es

    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({'error': 'Файл не найден'}), 404

    # ── Cache lookup ──
    cached = _cache_get(path)
    if cached:
        result = {k: v for k, v in cached.items() if not k.startswith('_')}
        result['cached'] = True
        return jsonify(result)

    try:
        # ── Load & normalize via librosa ──
        y, sr = librosa.load(path, sr=44100, mono=True)
        peak = np.max(np.abs(y))
        if peak > 0:
            y = y / peak * 0.9

        # Use middle 60% of track — skip intro/outro which confuse beat trackers
        total = len(y)
        start = int(total * 0.20)
        end   = int(total * 0.80)
        y_mid = y[start:end]
        audio = y_mid.astype(np.float32)

        # ── BPM: multi-method voting ──

        # Method 1: Essentia RhythmExtractor2013
        rhythm = es.RhythmExtractor2013(method='multifeature')
        bpm_e, ticks_e, conf_e, _, bpm_candidates = rhythm(audio)
        bpm_e = float(bpm_e)

        # Method 2: Essentia PercivalBpmEstimator (more robust on electronic/pop)
        percival = es.PercivalBpmEstimator(sampleRate=44100)
        bpm_p = float(percival(audio))

        # Method 3: librosa beat_track with percussive component for cleaner onsets
        y_perc = librosa.effects.percussive(y_mid, margin=3.0)
        onset_env = librosa.onset.onset_strength(y=y_perc, sr=sr, aggregate=np.median)
        tempo_lr = librosa.feature.tempo(onset_envelope=onset_env, sr=sr)
        bpm_l = float(np.atleast_1d(tempo_lr)[0])

        # Collect all candidates including Essentia's internal candidates
        candidates = [bpm_e, bpm_p, bpm_l]
        if bpm_candidates is not None and len(bpm_candidates) > 0:
            candidates += [float(b) for b in bpm_candidates[:4]]

        # Expand candidates with ×2 and ×0.5 harmonics only
        expanded = []
        for b in candidates:
            if b > 0:
                expanded.append(b)
                expanded.append(b * 2)
                expanded.append(b / 2)

        # Filter to musical range 60–200 BPM
        expanded = [b for b in expanded if 60 <= b <= 200]

        # Score: how many others are within 2%
        def score(bpm_val):
            return sum(1 for b in expanded if abs(b - bpm_val) / bpm_val < 0.02)

        best_bpm = max(expanded, key=score) if expanded else bpm_e

        # Pick the harmonic variant closest to the raw Essentia estimate (most reliable)
        # This avoids ×1.5 confusion (e.g. 105 vs 157, 96 vs 144)
        raw_ref = (bpm_e + bpm_p) / 2  # average of two Essentia methods
        harmonic_alts = [best_bpm, best_bpm * 2, best_bpm / 2]
        harmonic_alts = [b for b in harmonic_alts if 60 <= b <= 200]

        # Among harmonics with score >= best - 1, pick closest to raw_ref
        top_score = score(best_bpm)
        candidates_final = [b for b in harmonic_alts if score(b) >= top_score - 1]
        best_bpm = min(candidates_final, key=lambda b: abs(b - raw_ref))

        bpm = round(best_bpm)

        # ── Key via multi-profile voting ──
        # Run 4 profiles and pick the one with highest strength
        key_profiles = ['temperley', 'krumhansl', 'edma', 'bgate']
        key_results = []
        for profile in key_profiles:
            ke = es.KeyExtractor(profileType=profile, sampleRate=44100)
            kn, sc, st = ke(audio)
            key_results.append((kn, sc, float(st)))

        # Also run on harmonic-only signal (removes percussion noise)
        y_harm = librosa.effects.harmonic(y_mid, margin=4.0)
        audio_harm = y_harm.astype(np.float32)
        for profile in ['temperley', 'edma']:
            ke = es.KeyExtractor(profileType=profile, sampleRate=44100)
            kn, sc, st = ke(audio_harm)
            key_results.append((kn, sc, float(st) * 1.2))  # boost harmonic results

        # Vote: group by (note, scale), sum their strengths
        from collections import defaultdict
        vote_scores = defaultdict(float)
        for kn, sc, st in key_results:
            vote_scores[(kn, sc)] += st

        best_key = max(vote_scores, key=vote_scores.__getitem__)
        key_note, scale = best_key
        strength = vote_scores[best_key] / len(key_results)

        scale_ru = {'major': 'мажор', 'minor': 'минор'}.get(scale, scale)
        key_str  = f'{key_note} {scale_ru}'

        # ── Energy ──
        rms = librosa.feature.rms(y=y_mid)[0]
        energy_pct = min(100, int(np.percentile(rms, 95) * 2000))

        result = {
            'bpm':          bpm,
            'key':          key_str,
            'key_note':     key_note,
            'mode':         scale,
            'key_strength': round(float(strength), 2),
            'energy':       energy_pct,
            'camelot':      _to_camelot(key_note, scale),
        }
        _cache_set(path, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@flask_app.route('/api/stems_list')
def stems_list():
    output_dir = request.args.get('dir')
    mode = request.args.get('mode', '4stem')
    if not output_dir or not os.path.exists(output_dir):
        return jsonify({"stems": []})

    if mode == '2stem':
        expected = ['vocals.wav', 'instrumental.wav']
    else:
        expected = ['drums.wav', 'bass.wav', 'other.wav', 'vocals.wav']

    stems = [f for f in expected if os.path.exists(os.path.join(output_dir, f))]
    return jsonify({"stems": stems, "dir": output_dir})

# --- Запуск ---

def start_flask():
    print("[Flask] Запуск на порту 5050...")
    try:
        flask_app.run(port=5050, debug=False, use_reloader=False)
    except Exception as e:
        print(f"[Flask] ОШИБКА: {e}")

if __name__ == '__main__':
    print("[App] Старт приложения")
    t = threading.Thread(target=start_flask, daemon=True)
    t.start()

    import time
    print("[App] Ждём Flask...")
    time.sleep(2)

    # Проверяем что Flask отвечает
    import urllib.request
    try:
        urllib.request.urlopen('http://localhost:5050/', timeout=5)
        print("[App] Flask отвечает — открываем окно")
    except Exception as e:
        print(f"[App] Flask НЕ отвечает: {e}")

    print("[App] Создаём окно pywebview")
    try:
        webview.create_window(
            'Musician Assistant',
            'http://localhost:5050',
            width=1200,
            height=800,
            min_size=(900, 600),
            background_color='#0a0a0f'
        )
        print("[App] Запускаем webview.start()")
        webview.start()
        print("[App] webview завершён")
    except Exception as e:
        print(f"[App] ОШИБКА webview: {e}")
