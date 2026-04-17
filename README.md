# SonoRed — Backend

Red de audio publicitario para tiendas de barrio.  
Este servidor controla qué audio suena en cada parlante de tu red.

---

## ¿Cómo funciona?

```
[Dashboard web] → [Este servidor] → [Raspberry Pi en tienda] → [Parlante]
```

1. Subes un audio MP3 al servidor
2. Creas una campaña y la asignas a un circuito (grupo de tiendas)
3. Cada Raspberry Pi pregunta al servidor cada 10 segundos: "¿qué reproduzco?"
4. El servidor responde con la URL del audio y el RPi lo toca en loop

---

## PASO 1 — Subir a GitHub (gratis)

1. Ve a **github.com** y crea una cuenta si no tienes
2. Crea un repositorio nuevo llamado `sonored-backend`
3. Sube estos archivos (arrastra y suelta en la web de GitHub):
   - `index.js`
   - `package.json`
   - `.gitignore`
   - `.env.example`
   - `sonored_client.py`
4. **No subas** `.env` ni `db.json` ni la carpeta `uploads/`

---

## PASO 2 — Deployar en Railway (gratis)

1. Ve a **railway.app** y crea una cuenta con tu cuenta de GitHub
2. Clic en **"New Project"** → **"Deploy from GitHub repo"**
3. Selecciona el repositorio `sonored-backend`
4. Railway detecta automáticamente que es Node.js y lo despliega
5. Ve a **Settings → Variables** y agrega:
   ```
   BASE_URL = https://TU-APP.up.railway.app
   ```
   (Railway te da la URL exacta en la pestaña "Domains")
6. Espera 1-2 minutos y tu API estará viva en esa URL

### Verificar que funciona:
Abre en el navegador: `https://TU-APP.up.railway.app/`  
Debes ver: `{"status":"ok","app":"SonoRed API","version":"1.0.0"}`

---

## PASO 3 — Configurar un Raspberry Pi

### En cada Raspberry Pi que instales en una tienda:

```bash
# 1. Instalar dependencias
sudo apt-get update
sudo apt-get install -y mpg123 python3-pip
pip3 install requests

# 2. Copiar el cliente
# (copia el archivo sonored_client.py al RPi via USB o SSH)

# 3. Editar la configuración (las primeras líneas del archivo)
nano sonored_client.py
```

Cambia estas 3 líneas:
```python
SERVER_URL = "https://TU-APP.up.railway.app"   # ← tu URL de Railway
SPEAKER_ID = "RPi-001"                          # ← ID único por tienda (RPi-001, RPi-002...)
CIRCUIT_ID = "1"                               # ← ID del circuito (ver en el dashboard)
```

```bash
# 4. Probar
python3 sonored_client.py

# 5. Hacer que arranque automático al encender el RPi
sudo nano /etc/systemd/system/sonored.service
```

Pega esto en el archivo:
```ini
[Unit]
Description=SonoRed Audio Client
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/sonored_client.py
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable sonored
sudo systemctl start sonored
```

---

## API — Referencia rápida

| Método | Ruta | Qué hace |
|--------|------|----------|
| GET | `/api/circuits` | Lista todos los circuitos |
| POST | `/api/circuits` | Crear circuito |
| POST | `/api/circuits/:id/campaign` | Asignar campaña a circuito |
| GET | `/api/campaigns` | Lista campañas |
| POST | `/api/campaigns` | Crear campaña |
| GET | `/api/audios` | Lista audios |
| POST | `/api/audios/upload` | Subir MP3 |
| GET | `/api/speakers` | Ver estado de parlantes |
| GET | `/api/stats` | Estadísticas generales |
| GET | `/api/speakers/:id/command` | (RPi) Pedir comando |
| POST | `/api/speakers/:id/played` | (RPi) Reportar reproducción |

---

## Flujo típico de uso

1. **Subir audio**: `POST /api/audios/upload` con el MP3 como form-data
2. **Crear campaña**: `POST /api/campaigns` con `{ name, brand, audioId }`
3. **Activar en circuito**: `POST /api/circuits/1/campaign` con `{ campaignId: "123" }`
4. Los RPi detectan el cambio en los próximos 10 segundos y empiezan a sonar

---

## Cambiar campaña (lo más común)

Solo llama:
```
POST /api/circuits/1/campaign
{ "campaignId": "ID_DE_LA_NUEVA_CAMPAÑA" }
```

Todos los parlantes del circuito cambian en menos de 10 segundos. ✅
