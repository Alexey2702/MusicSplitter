import webview
import threading
from flask import Flask, request, jsonify, send_from_directory
import os
import json

from Main import separate_audio_with_progress

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
    output_dir = data.get('output_dir')

    if not input_path or not os.path.exists(input_path):
        return jsonify({"error": "Файл не найден"}), 400

    if separation_state["running"]:
        return jsonify({"error": "Разделение уже запущено"}), 400

    def run():
        separation_state.update({"running": True, "progress": 0, "done": False, "error": None, "output_dir": output_dir})
        try:
            separate_audio_with_progress(input_path, output_dir, progress_callback=progress_callback)
            separation_state.update({"running": False, "done": True, "progress": 100})
        except Exception as e:
            separation_state.update({"running": False, "error": str(e), "done": True})

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "started"})

def progress_callback(stage, progress, message=""):
    separation_state["stage"] = stage
    separation_state["progress"] = progress
    separation_state["message"] = message

@flask_app.route('/api/progress')
def get_progress():
    return jsonify(separation_state)

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

@flask_app.route('/api/stems_list')
def stems_list():
    output_dir = request.args.get('dir')
    if not output_dir or not os.path.exists(output_dir):
        return jsonify({"stems": []})
    stems = [f for f in os.listdir(output_dir) if f.endswith('.wav')]
    return jsonify({"stems": stems, "dir": output_dir})

# --- Запуск ---

def start_flask():
    flask_app.run(port=5050, debug=False, use_reloader=False)

if __name__ == '__main__':
    t = threading.Thread(target=start_flask, daemon=True)
    t.start()

    webview.create_window(
        'Musician Assistant',
        'http://localhost:5050',
        width=1200,
        height=800,
        min_size=(900, 600),
        background_color='#0a0a0f'
    )
    webview.start()
