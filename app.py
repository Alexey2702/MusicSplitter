import webview
import threading
from flask import Flask, request, jsonify, send_from_directory
import os
import json

from Main import separate_audio_with_progress, separate_two_stems
import soundfile as sf

flask_app = Flask(__name__, template_folder='templates', static_folder='static')

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

@flask_app.route('/api/stems_list')
def stems_list():
    output_dir = request.args.get('dir')
    if not output_dir or not os.path.exists(output_dir):
        return jsonify({"stems": []})
    stems = [f for f in os.listdir(output_dir) if f.endswith('.wav')]
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
