#!/usr/bin/env python3
"""
SonoRed - Cliente para Raspberry Pi CON SENSOR PIR
El audio suena cuando el sensor detecta una persona.

Instalación en el RPi:
  sudo apt-get install -y mpg123 python3-requests RPi.GPIO
  python3 sonored_client.py

Conexión del sensor PIR:
  PIR VCC  → Pin 2  (5V)
  PIR GND  → Pin 6  (GND)
  PIR OUT  → Pin 11 (GPIO 17)
"""

import time
import subprocess
import requests
import os
import hashlib
import tempfile
import logging
import RPi.GPIO as GPIO

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('SonoRed')

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
SERVER_URL      = "https://TU-APP.up.railway.app"  # URL de tu backend en Railway
SPEAKER_ID      = "RPi-001"                         # ID único de este parlante
CIRCUIT_ID      = "1"                               # ID del circuito
CHECK_EVERY     = 30                                # segundos entre consultas al servidor
SENSOR_PIN      = 17                                # GPIO pin del sensor PIR
COOLDOWN        = 15                                # segundos de espera entre reproducciones

# ─── Setup GPIO ───────────────────────────────────────────────────────────────
GPIO.setmode(GPIO.BCM)
GPIO.setup(SENSOR_PIN, GPIO.IN)

# ─── Estado interno ───────────────────────────────────────────────────────────
current_audio_url  = None
current_process    = None
last_played        = 0
audio_cache_dir    = tempfile.gettempdir()

def get_command():
    try:
        url = f"{SERVER_URL}/api/speakers/{SPEAKER_ID}/command"
        resp = requests.get(url, params={"circuitId": CIRCUIT_ID}, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.warning(f"Sin conexión al servidor: {e}")
        return None

def report_played(campaign_id):
    try:
        requests.post(
            f"{SERVER_URL}/api/speakers/{SPEAKER_ID}/played",
            json={"campaignId": campaign_id},
            timeout=5
        )
    except:
        pass

def download_audio(url):
    filename = hashlib.md5(url.encode()).hexdigest() + ".mp3"
    local_path = os.path.join(audio_cache_dir, filename)
    if os.path.exists(local_path):
        return local_path
    log.info(f"Descargando audio: {url}")
    try:
        resp = requests.get(url, timeout=30, stream=True)
        resp.raise_for_status()
        with open(local_path, 'wb') as f:
            for chunk in resp.iter_content(1024 * 64):
                f.write(chunk)
        return local_path
    except Exception as e:
        log.error(f"Error descargando audio: {e}")
        return None

def play_audio(local_path):
    global current_process
    stop_audio()
    log.info(f"Reproduciendo: {local_path}")
    current_process = subprocess.Popen(
        ["mpg123", "-q", local_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

def stop_audio():
    global current_process
    if current_process and current_process.poll() is None:
        current_process.terminate()
        current_process = None

def is_playing():
    return current_process is not None and current_process.poll() is None

def person_detected():
    return GPIO.input(SENSOR_PIN) == GPIO.HIGH

# ─── Loop principal ───────────────────────────────────────────────────────────
def main():
    global current_audio_url, last_played
    log.info(f"SonoRed CON SENSOR iniciado — Parlante: {SPEAKER_ID} | GPIO: {SENSOR_PIN}")

    cmd = None
    last_server_check = 0

    while True:
        now = time.time()

        # Consultar servidor cada CHECK_EVERY segundos
        if now - last_server_check > CHECK_EVERY:
            cmd = get_command()
            last_server_check = now
            if cmd and cmd.get('command') == 'play':
                current_audio_url = cmd['audio']['url']
                download_audio(current_audio_url)  # pre-descarga en caché
                log.info(f"Campaña lista: {cmd['campaign']['name']}")

        # Si no hay campaña activa, no hacer nada
        if not cmd or cmd.get('command') != 'play':
            time.sleep(0.2)
            continue

        # Detectar presencia
        if person_detected():
            cooldown_ok = (now - last_played) > COOLDOWN
            if cooldown_ok and not is_playing():
                log.info("Persona detectada — reproduciendo audio")
                local = download_audio(current_audio_url)
                if local:
                    play_audio(local)
                    report_played(cmd['campaign']['id'])
                    last_played = now

        time.sleep(0.1)  # revisar sensor 10 veces por segundo

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        stop_audio()
        GPIO.cleanup()
        log.info("Cliente detenido.")
