require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Asegurar que la carpeta uploads existe ───────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Base de datos (archivo JSON) ─────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'db.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) return getDefaultDB();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return getDefaultDB(); }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getDefaultDB() {
  return {
    circuits: [
      { id: '1', name: 'Circuito Norte', description: 'Tiendas zona norte de Quito', active: true, campaignId: null, createdAt: new Date().toISOString() },
      { id: '2', name: 'Circuito Sur',   description: 'Tiendas zona sur de Quito',   active: true, campaignId: null, createdAt: new Date().toISOString() }
    ],
    campaigns: [],
    audios: [],
    speakers: []
  };
}

// ─── Rutas: Health ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'SonoRed API', version: '1.0.0' });
});

// ─── Rutas: Circuitos ─────────────────────────────────────────────────────────
app.get('/api/circuits', (req, res) => {
  const db = readDB();
  res.json(db.circuits);
});

app.post('/api/circuits', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  const db = readDB();
  const circuit = { id: Date.now().toString(), name, description: description || '', active: true, campaignId: null, createdAt: new Date().toISOString() };
  db.circuits.push(circuit);
  writeDB(db);
  res.status(201).json(circuit);
});

app.put('/api/circuits/:id', (req, res) => {
  const db = readDB();
  const idx = db.circuits.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Circuito no encontrado' });
  db.circuits[idx] = { ...db.circuits[idx], ...req.body, id: req.params.id };
  writeDB(db);
  res.json(db.circuits[idx]);
});

// Asignar campaña a un circuito (el más usado desde el dashboard)
app.post('/api/circuits/:id/campaign', (req, res) => {
  const { campaignId } = req.body;
  const db = readDB();
  const circuit = db.circuits.find(c => c.id === req.params.id);
  if (!circuit) return res.status(404).json({ error: 'Circuito no encontrado' });
  if (campaignId) {
    const campaign = db.campaigns.find(c => c.id === campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
  }
  circuit.campaignId = campaignId || null;
  circuit.updatedAt = new Date().toISOString();
  writeDB(db);
  // Notificar a todos los parlantes de este circuito (via polling)
  res.json({ ok: true, circuit, message: campaignId ? 'Campaña asignada' : 'Campaña removida' });
});

app.delete('/api/circuits/:id', (req, res) => {
  const db = readDB();
  db.circuits = db.circuits.filter(c => c.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ─── Rutas: Campañas ──────────────────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  const db = readDB();
  res.json(db.campaigns);
});

app.post('/api/campaigns', (req, res) => {
  const { name, brand, audioId, circuitId } = req.body;
  if (!name || !brand) return res.status(400).json({ error: 'Nombre y marca son requeridos' });
  const db = readDB();
  if (audioId && !db.audios.find(a => a.id === audioId)) {
    return res.status(400).json({ error: 'Audio no encontrado' });
  }
  const campaign = { id: Date.now().toString(), name, brand, audioId: audioId || null, circuitId: circuitId || null, plays: 0, active: true, createdAt: new Date().toISOString() };
  db.campaigns.push(campaign);
  writeDB(db);
  res.status(201).json(campaign);
});

app.put('/api/campaigns/:id', (req, res) => {
  const db = readDB();
  const idx = db.campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Campaña no encontrada' });
  db.campaigns[idx] = { ...db.campaigns[idx], ...req.body, id: req.params.id };
  writeDB(db);
  res.json(db.campaigns[idx]);
});

app.delete('/api/campaigns/:id', (req, res) => {
  const db = readDB();
  db.campaigns = db.campaigns.filter(c => c.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ─── Rutas: Audios (subida de archivos) ───────────────────────────────────────
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const clean = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + clean);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-wav'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos MP3, WAV u OGG'));
    }
  }
});

app.get('/api/audios', (req, res) => {
  const db = readDB();
  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  const audios = db.audios.map(a => ({ ...a, url: `${base}/uploads/${a.filename}` }));
  res.json(audios);
});

app.post('/api/audios/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  const { brand, name } = req.body;
  const db = readDB();
  const audio = {
    id: Date.now().toString(),
    name: name || req.file.originalname,
    brand: brand || 'Sin marca',
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
    uploadedAt: new Date().toISOString()
  };
  db.audios.push(audio);
  writeDB(db);
  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.status(201).json({ ...audio, url: `${base}/uploads/${audio.filename}` });
});

app.delete('/api/audios/:id', (req, res) => {
  const db = readDB();
  const audio = db.audios.find(a => a.id === req.params.id);
  if (!audio) return res.status(404).json({ error: 'Audio no encontrado' });
  const filePath = path.join(__dirname, 'uploads', audio.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.audios = db.audios.filter(a => a.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ─── Rutas: Parlantes (Raspberry Pi) ─────────────────────────────────────────

// El Raspberry Pi llama a esto cada 10 segundos para saber qué reproducir
app.get('/api/speakers/:speakerId/command', (req, res) => {
  const { speakerId } = req.params;
  const { circuitId } = req.query; // el RPi envía su circuitId al hacer el heartbeat
  const db = readDB();

  // Registrar/actualizar el parlante
  let speaker = db.speakers.find(s => s.id === speakerId);
  if (!speaker) {
    speaker = { id: speakerId, circuitId: circuitId || null, online: true, lastSeen: new Date().toISOString(), ip: req.ip };
    db.speakers.push(speaker);
  } else {
    speaker.online = true;
    speaker.lastSeen = new Date().toISOString();
    speaker.ip = req.ip;
    if (circuitId) speaker.circuitId = circuitId;
  }
  writeDB(db);

  // Buscar qué campaña tiene asignada el circuito del parlante
  if (!speaker.circuitId) return res.json({ command: 'idle', message: 'Sin circuito asignado' });

  const circuit = db.circuits.find(c => c.id === speaker.circuitId);
  if (!circuit || !circuit.active) return res.json({ command: 'idle', message: 'Circuito inactivo' });
  if (!circuit.campaignId) return res.json({ command: 'idle', message: 'Sin campaña activa' });

  const campaign = db.campaigns.find(c => c.id === circuit.campaignId);
  if (!campaign || !campaign.active) return res.json({ command: 'idle', message: 'Campaña inactiva' });
  if (!campaign.audioId) return res.json({ command: 'idle', message: 'Sin audio en campaña' });

  const audio = db.audios.find(a => a.id === campaign.audioId);
  if (!audio) return res.json({ command: 'idle', message: 'Audio no encontrado' });

  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.json({
    command: 'play',
    campaign: { id: campaign.id, name: campaign.name },
    audio: { id: audio.id, name: audio.name, url: `${base}/uploads/${audio.filename}` }
  });
});

// El RPi reporta que reprodujo el audio (para contar plays)
app.post('/api/speakers/:speakerId/played', (req, res) => {
  const { campaignId } = req.body;
  const db = readDB();
  const campaign = db.campaigns.find(c => c.id === campaignId);
  if (campaign) { campaign.plays = (campaign.plays || 0) + 1; writeDB(db); }
  res.json({ ok: true });
});

// Lista de parlantes (para el dashboard)
app.get('/api/speakers', (req, res) => {
  const db = readDB();
  // Marcar offline si no han hecho heartbeat en más de 30 segundos
  const now = Date.now();
  db.speakers.forEach(s => {
    if (s.lastSeen && now - new Date(s.lastSeen).getTime() > 30000) s.online = false;
  });
  writeDB(db);
  res.json(db.speakers);
});

app.put('/api/speakers/:id', (req, res) => {
  const db = readDB();
  const speaker = db.speakers.find(s => s.id === req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Parlante no encontrado' });
  Object.assign(speaker, req.body, { id: req.params.id });
  writeDB(db);
  res.json(speaker);
});

// ─── Ruta: Estadísticas generales (dashboard) ─────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = readDB();
  const now = Date.now();
  const onlineSpeakers = db.speakers.filter(s => s.online && s.lastSeen && now - new Date(s.lastSeen).getTime() < 30000).length;
  res.json({
    totalSpeakers: db.speakers.length,
    onlineSpeakers,
    totalCircuits: db.circuits.length,
    activeCircuits: db.circuits.filter(c => c.active && c.campaignId).length,
    totalCampaigns: db.campaigns.length,
    activeCampaigns: db.campaigns.filter(c => c.active && c.circuitId).length,
    totalAudios: db.audios.length,
    totalPlays: db.campaigns.reduce((sum, c) => sum + (c.plays || 0), 0)
  });
});

// ─── Errores ──────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`✅ SonoRed API corriendo en http://localhost:${PORT}`);
});
