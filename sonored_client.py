#!/usr/bin/env python3
"""
SonoRed - Cliente para Raspberry Pi
Corre en cada parlante. Consulta el servidor cada 10 segundos
y reproduce el audio de la campaña asignada.

Instalación en el RPi:
  sudo apt-get install -y mpg123 python3-requests
  python3 sonored_client.py
"""

import time
import subprocess
import requests
import os
import hashlib
import tempfile
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('SonoRed')

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
# Cambia estos valores en cada Raspberry Pi
SERVER_URL  = "https://TU-APP.up.railway.app"   # URL de tu backend en Railway
SPEAKER_ID  = "RPi-001"                          # ID único de este parlante
CIRCUIT_ID  = "1"                                # ID del circuito al que pertenece
CHECK_EVERY = 10                                 # segundos entre cada consulta al servidor

# ─── Estado interno ───────────────────────────────────────────────────────────
current_audio_url = None
current_process   = None
audio_cache_dir   = tempfile.gettempdir()

def get_command():
    """Consulta al servidor qué debe reproducir este parlante."""
    try:
        url = f"{SERVER_URL}/api/speakers/{SPEAKER_ID}/command"
        resp = requests.get(url, params={"circuitId": CIRCUIT_ID}, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.warning(f"No se pudo contactar el servidor: {e}")
        return None

def report_played(campaign_id):
    """Reporta al servidor que se reprodujo el audio (cuenta plays)."""
    try:
        requests.post(
            f"{SERVER_URL}/api/speakers/{SPEAKER_ID}/played",
            json={"campaignId": campaign_id},
            timeout=5
        )
    except:
        pass  # No pasa nada si falla, seguimos tocando

def download_audio(url):
    """Descarga el audio y lo cachea localmente por su URL."""
    filename = hashlib.md5(url.encode()).hexdigest() + ".mp3"
    local_path = os.path.join(audio_cache_dir, filename)
    if os.path.exists(local_path):
        return local_path  # Ya está en caché
    log.info(f"Descargando audio: {url}")
    try:
        resp = requests.get(url, timeout=30, stream=True)
        resp.raise_for_status()
        with open(local_path, 'wb') as f:
            for chunk in resp.iter_content(1024 * 64):
                f.write(chunk)
        log.info(f"Audio guardado en {local_path}")
        return local_path
    except Exception as e:
        log.error(f"Error descargando audio: {e}")
        return None

def play_audio(local_path):
    """Reproduce el audio con mpg123 (instalado en el RPi)."""
    global current_process
    stop_audio()
    log.info(f"Reproduciendo: {local_path}")
    current_process = subprocess.Popen(
        ["mpg123", "-q", local_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

def stop_audio():
    """Detiene la reproducción actual."""
    global current_process
    if current_process and current_process.poll() is None:
        current_process.terminate()
        current_process = None

def is_playing():
    """Retorna True si hay audio reproduciéndose."""
    return current_process is not None and current_process.poll() is None

# ─── Loop principal ───────────────────────────────────────────────────────────
def main():
    global current_audio_url
    log.info(f"SonoRed cliente iniciado — Parlante: {SPEAKER_ID} | Circuito: {CIRCUIT_ID}")
    log.info(f"Servidor: {SERVER_URL}")

    while True:
        cmd = get_command()

        if cmd is None:
            # Sin conexión: seguir tocando lo que hay
            if not is_playing() and current_audio_url:
                local = download_audio(current_audio_url)
                if local:
                    play_audio(local)
            time.sleep(CHECK_EVERY)
            continue

        if cmd.get('command') == 'play':
            audio_url  = cmd['audio']['url']
            campaign   = cmd['campaign']

            # Si es un audio diferente al actual, cambiar
            if audio_url != current_audio_url:
                log.info(f"Nueva campaña: {campaign['name']}")
                current_audio_url = audio_url
                stop_audio()

            # Si no está tocando (terminó o fue detenido), reproducir de nuevo
            if not is_playing():
                local = download_audio(audio_url)
                if local:
                    play_audio(local)
                    report_played(campaign['id'])

        else:
            # idle: pausar si estaba tocando
            if is_playing():
                log.info("Sin campaña activa — pausando audio")
                stop_audio()
                current_audio_url = None

        time.sleep(CHECK_EVERY)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        stop_audio()
        log.info("Cliente detenido.")
