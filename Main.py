import torch
from demucs.pretrained import get_model
from demucs.apply import apply_model
import os
import librosa
import numpy as np
import soundfile as sf
from tqdm import tqdm
import time


class ProgressTracker:
    def __init__(self):
        self.progress = 0
        self.stages = {
            'loading_model': 5,
            'loading_audio': 10,
            'preprocessing': 15,
            'separation': 70,
            'saving': 100
        }
        self.current_stage = None

    def update_progress(self, stage, message=None):
        self.current_stage = stage
        self.progress = self.stages[stage]
        if message:
            print(f"📊 [{self.progress}%] {message}")
        else:
            print(f"📊 [{self.progress}%] {stage.replace('_', ' ').title()}")


def separate_audio_with_progress(input_path, output_dir, progress_callback=None):
    """
    Разделяет аудиофайл на вокал и инструменталы с отображением прогресса
    """
    def _cb(stage, progress, message=""):
        if progress_callback:
            progress_callback(stage, progress, message)

    tracker = ProgressTracker()

    # Создаем директорию для результатов
    os.makedirs(output_dir, exist_ok=True)

    # 1. Загрузка модели
    tracker.update_progress('loading_model', "Загрузка модели Demucs...")
    _cb('loading_model', 5, "Загрузка модели Demucs...")
    try:
        model = get_model('htdemucs')
        model.eval()
        tracker.update_progress('loading_model', "✅ Модель загружена успешно")
        _cb('loading_model', 10, "Модель загружена")
        time.sleep(0.5)
    except Exception as e:
        print(f"❌ Ошибка загрузки модели: {e}")
        return

    # 2. Загрузка аудио
    tracker.update_progress('loading_audio', "Загрузка аудио файла...")
    _cb('loading_audio', 15, "Загрузка аудио...")
    try:
        y, sr = librosa.load(input_path, sr=None, mono=False)
        tracker.update_progress('loading_audio', f"✅ Аудио загружено: {len(y) / sr:.1f} сек, {sr} Hz")
        _cb('loading_audio', 25, f"Аудио загружено")

        if len(y.shape) == 1:
            y = np.vstack([y, y])

        wav = torch.from_numpy(y).float()
        time.sleep(0.5)

    except Exception as e:
        print(f"❌ Ошибка загрузки аудио: {e}")
        return

    # 3. Препроцессинг
    tracker.update_progress('preprocessing', "Подготовка данных...")
    _cb('preprocessing', 30, "Подготовка данных...")
    time.sleep(0.5)

    # 4. Разделение с прогресс-баром
    tracker.update_progress('separation', "Начинаем разделение аудио...")
    _cb('separation', 35, "Разделение аудио...")

    try:
        # Создаем кастомный прогресс-бар для разделения
        separation_progress = tqdm(
            total=100,
            desc="🎵 Разделение",
            unit="%",
            bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt}%"
        )

        # Функция для обновления прогресса (заглушка, т.к. apply_model не предоставляет прогресс)
        def update_separation_progress():
            for i in range(100):
                time.sleep(0.02)  # Имитация прогресса
                separation_progress.update(1)
                separation_progress.set_postfix({"статус": "обработка"})

        # Запускаем разделение в отдельном потоке с прогрессом
        import threading

        progress_thread = threading.Thread(target=update_separation_progress)
        progress_thread.start()

        with torch.no_grad():
            sources = apply_model(model, wav[None], device='cpu')[0]

        progress_thread.join()
        separation_progress.close()

        tracker.update_progress('separation', "✅ Разделение завершено!")
        _cb('separation', 80, "Разделение завершено")

    except Exception as e:
        print(f"❌ Ошибка при разделении: {e}")
        return

    # 5. Сохранение результатов
    tracker.update_progress('saving', "Сохранение результатов...")
    _cb('saving', 85, "Сохранение файлов...")

    stems = ['drums', 'bass', 'other', 'vocals']
    saving_progress = tqdm(
        stems,
        desc="💾 Сохранение",
        unit="файл",
        bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt}"
    )

    for stem in saving_progress:
        output_path = os.path.join(output_dir, f"{stem}.wav")
        source = sources[stems.index(stem)]
        audio_data = source.numpy()

        if len(audio_data.shape) > 1 and audio_data.shape[0] > 1:
            audio_data = audio_data.T

        sf.write(output_path, audio_data, sr)
        saving_progress.set_postfix({"файл": f"{stem}.wav"})
        _cb('saving', 85 + int((stems.index(stem) + 1) / len(stems) * 15), f"Сохранено: {stem}.wav")

    saving_progress.close()

    print(f"\n🎉 Все файлы сохранены в: {output_dir}")
    print("\n📊 Результаты разделения:")
    for stem in stems:
        file_path = os.path.join(output_dir, f"{stem}.wav")
        if os.path.exists(file_path):
            file_size = os.path.getsize(file_path) / 1024 / 1024
            print(f"   • {stem}.wav - {file_size:.1f} MB")


def estimate_separation_time(audio_length_seconds):
    """Оценивает время разделения на основе длины аудио"""
    # Примерная оценка: 1x реального времени на CPU
    estimated_time = audio_length_seconds * 1.2
    minutes = int(estimated_time // 60)
    seconds = int(estimated_time % 60)
    return f"⏱️ Примерное время: {minutes} мин {seconds} сек"


# Использование
if __name__ == "__main__":
    input_file = "/Users/admin/Desktop/рабочий стол/Мои проеты Abletone/Nobody /v1c044g50000d6heh0vog65nb311uoig.MP3"
    output_folder = "/Users/admin/Desktop/песни/separated_results"

    print("🎵 Запуск разделения аудио с прогресс-баром")
    print("=" * 50)

    # Предварительная оценка времени
    try:
        y, sr = librosa.load(input_file, sr=None, mono=False)
        audio_length = len(y) / sr
        print(f"📀 Длина аудио: {audio_length:.1f} секунд")
        print(estimate_separation_time(audio_length))
    except:
        print("📀 Длина аудио: вычисляется...")

    print("=" * 50)

    separate_audio_with_progress(input_file, output_folder)