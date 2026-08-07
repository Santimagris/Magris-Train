const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const pool = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const TZ = 'America/Argentina/Buenos_Aires';

// ---------- Datos semilla ----------
const USERS = ['Santino', 'Gino'];
const EXERCISES = [
  ['A', 'Sentadilla con barra', '3 × 6-8', 1],
  ['A', 'Press de banca plano', '3 × 8-10', 2],
  ['A', 'Remo con barra o polea', '3 × 8-10', 3],
  ['A', 'Press militar con mancuernas', '3 × 10-12', 4],
  ['A', 'Curl de bíceps', '3 × 10-12', 5],
  ['A', 'Plancha abdominal', '3 × 30-45 s', 6],
  ['A', 'Tríceps francés con barra Z', '3 × 10-12', 7],
  ['B', 'Peso muerto rumano', '3 × 6-8', 1],
  ['B', 'Press inclinado con mancuernas', '3 × 8-10', 2],
  ['B', 'Jalón al pecho (polea)', '3 × 10-12', 3],
  ['B', 'Prensa de piernas', '3 × 10-12', 4],
  ['B', 'Elevaciones laterales', '3 × 12-15', 5],
  ['B', 'Tríceps en polea con soga', '3 × 12-15', 6],
  ['B', 'Curl martillo con mancuernas', '3 × 10-12', 7],
];

// ---------- Init de la base de datos ----------
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS exercises (
      id SERIAL PRIMARY KEY,
      day TEXT NOT NULL,
      name TEXT NOT NULL,
      scheme TEXT,
      sort_order INT,
      UNIQUE (day, name)
    );
    CREATE TABLE IF NOT EXISTS sets (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      exercise_id INT REFERENCES exercises(id) ON DELETE CASCADE,
      set_number INT,
      weight NUMERIC,
      reps INT,
      notes TEXT,
      logged_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bodyweight (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      weight NUMERIC NOT NULL,
      notes TEXT,
      logged_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sets_user ON sets(user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bw_user ON bodyweight(user_id, logged_at DESC);
  `);

  for (const n of USERS) {
    await pool.query('INSERT INTO users(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [n]);
  }
  // Migración: renombrar el tríceps del Día A a francés (solo si aún no tiene series, para no dejar duplicado)
  await pool.query(`
    UPDATE exercises SET name='Tríceps francés con barra Z', scheme='3 × 10-12'
    WHERE day='A' AND name='Tríceps en polea'
      AND NOT EXISTS (SELECT 1 FROM sets s WHERE s.exercise_id = exercises.id)
      AND NOT EXISTS (SELECT 1 FROM exercises e2 WHERE e2.day='A' AND e2.name='Tríceps francés con barra Z')
  `);
  for (const [day, name, scheme, order] of EXERCISES) {
    await pool.query(
      'INSERT INTO exercises(day, name, scheme, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (day, name) DO NOTHING',
      [day, name, scheme, order]
    );
  }
  console.log('Base de datos lista.');
}

// ---------- Helpers de fecha (zona Argentina) ----------
const dFull = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
const dDate = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short' });
const dTime = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, timeStyle: 'short' });
const fmtDate = (v) => dDate.format(new Date(v));
const fmtTime = (v) => dTime.format(new Date(v));

// ---------- API ----------
app.get('/api/bootstrap', async (req, res) => {
  try {
    const users = (await pool.query('SELECT id, name FROM users ORDER BY id')).rows;
    const exercises = (await pool.query('SELECT id, day, name, scheme, sort_order FROM exercises ORDER BY day, sort_order')).rows;
    res.json({ users, exercises });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Guardar las series de un ejercicio (fecha/hora automática server-side)
app.post('/api/sets', async (req, res) => {
  try {
    const { user_id, exercise_id, entries, notes } = req.body;
    if (!user_id || !exercise_id || !Array.isArray(entries)) return res.status(400).json({ error: 'Datos incompletos' });
    const valid = entries.filter(e => e.weight !== '' && e.weight != null && e.reps !== '' && e.reps != null);
    if (!valid.length) return res.status(400).json({ error: 'Cargá al menos una serie con peso y reps' });

    const ph = [], vals = [];
    let i = 1;
    for (const e of valid) {
      ph.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`);
      vals.push(user_id, exercise_id, e.set_number || null, e.weight, e.reps, notes || null);
    }
    // now() es constante dentro de la sentencia => todas las series comparten el mismo timestamp (misma sesión)
    const q = `INSERT INTO sets(user_id, exercise_id, set_number, weight, reps, notes) VALUES ${ph.join(',')} RETURNING id, logged_at`;
    const r = await pool.query(q, vals);
    res.json({ ok: true, inserted: r.rowCount, logged_at: r.rows[0].logged_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sets', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Falta user_id' });
    const r = await pool.query(
      `SELECT s.id, s.exercise_id, e.name AS exercise, e.day, e.scheme, s.set_number, s.weight, s.reps, s.notes, s.logged_at
       FROM sets s JOIN exercises e ON e.id = s.exercise_id
       WHERE s.user_id = $1
       ORDER BY s.logged_at DESC, e.sort_order, s.set_number`,
      [user_id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sets/:id', async (req, res) => {
  try { await pool.query('DELETE FROM sets WHERE id = $1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Borrado por lista de IDs (confiable). Sirve para borrar un ejercicio o un día entero.
app.post('/api/sets/delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Sin IDs para borrar' });
    const clean = ids.map(Number).filter(n => Number.isInteger(n));
    await pool.query('DELETE FROM sets WHERE id = ANY($1::int[])', [clean]);
    res.json({ ok: true, deleted: clean.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bodyweight', async (req, res) => {
  try {
    const { user_id, weight, notes } = req.body;
    if (!user_id || weight === '' || weight == null) return res.status(400).json({ error: 'Falta el peso' });
    const r = await pool.query('INSERT INTO bodyweight(user_id, weight, notes) VALUES ($1,$2,$3) RETURNING id, logged_at', [user_id, weight, notes || null]);
    res.json({ ok: true, id: r.rows[0].id, logged_at: r.rows[0].logged_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bodyweight', async (req, res) => {
  try {
    const { user_id } = req.query;
    const r = await pool.query('SELECT id, weight, notes, logged_at FROM bodyweight WHERE user_id=$1 ORDER BY logged_at DESC', [user_id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bodyweight/:id', async (req, res) => {
  try { await pool.query('DELETE FROM bodyweight WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Exportar Excel completo ----------
app.get('/api/export/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const u = (await pool.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0];
    if (!u) return res.status(404).send('Usuario no encontrado');

    const sets = (await pool.query(
      `SELECT e.name AS exercise, e.day, e.scheme, s.set_number, s.weight, s.reps, s.notes, s.logged_at
       FROM sets s JOIN exercises e ON e.id=s.exercise_id
       WHERE s.user_id=$1 ORDER BY s.logged_at ASC, e.sort_order, s.set_number`, [userId])).rows;
    const bw = (await pool.query('SELECT weight, notes, logged_at FROM bodyweight WHERE user_id=$1 ORDER BY logged_at ASC', [userId])).rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gym Tracker';
    wb.created = new Date();

    const header = (ws, cols) => {
      ws.columns = cols;
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12924E' } };
      ws.getRow(1).alignment = { vertical: 'middle' };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };

    // Hoja 1: Resumen
    const wsR = wb.addWorksheet('Resumen');
    header(wsR, [{ header: 'Métrica', key: 'k', width: 34 }, { header: 'Valor', key: 'v', width: 40 }]);
    const sessions = new Set(sets.map(s => fmtDate(s.logged_at))).size;
    const bwFirst = bw[0], bwLast = bw[bw.length - 1];
    const rows = [
      ['Usuario', u.name],
      ['Exportado', dFull.format(new Date())],
      ['Series registradas (total)', sets.length],
      ['Sesiones de entrenamiento', sessions],
      ['Primer registro', sets.length ? fmtDate(sets[0].logged_at) : '—'],
      ['Último registro', sets.length ? fmtDate(sets[sets.length - 1].logged_at) : '—'],
      ['Pesajes corporales', bw.length],
      ['Peso inicial (kg)', bwFirst ? Number(bwFirst.weight) : '—'],
      ['Peso actual (kg)', bwLast ? Number(bwLast.weight) : '—'],
      ['Diferencia de peso (kg)', (bwFirst && bwLast) ? (Number(bwLast.weight) - Number(bwFirst.weight)).toFixed(1) : '—'],
    ];
    rows.forEach(r => wsR.addRow({ k: r[0], v: r[1] }));

    // Hoja 2: Entrenamientos (TODAS las series)
    const wsE = wb.addWorksheet('Entrenamientos');
    header(wsE, [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Hora', key: 'hora', width: 8 },
      { header: 'Día', key: 'dia', width: 6 },
      { header: 'Ejercicio', key: 'ej', width: 30 },
      { header: 'Esquema', key: 'sc', width: 12 },
      { header: 'Serie', key: 'serie', width: 7 },
      { header: 'Peso (kg)', key: 'peso', width: 10 },
      { header: 'Reps', key: 'reps', width: 7 },
      { header: 'Notas', key: 'notas', width: 30 },
    ]);
    sets.forEach(s => wsE.addRow({
      fecha: fmtDate(s.logged_at), hora: fmtTime(s.logged_at), dia: s.day, ej: s.exercise,
      sc: s.scheme, serie: s.set_number, peso: Number(s.weight), reps: s.reps, notas: s.notes || '',
    }));

    // Hoja 3: Progresión por ejercicio
    const wsP = wb.addWorksheet('Progresión');
    header(wsP, [
      { header: 'Ejercicio', key: 'ej', width: 30 },
      { header: 'Día', key: 'dia', width: 6 },
      { header: '1ª fecha', key: 'f1', width: 12 },
      { header: '1er peso máx', key: 'p1', width: 12 },
      { header: 'Última fecha', key: 'f2', width: 12 },
      { header: 'Último peso máx', key: 'p2', width: 14 },
      { header: 'Mejor peso', key: 'best', width: 11 },
      { header: 'Sesiones', key: 'ses', width: 9 },
    ]);
    const byEx = {};
    sets.forEach(s => {
      (byEx[s.exercise] ||= { day: s.day, rows: [] }).rows.push(s);
    });
    Object.entries(byEx).forEach(([ex, d]) => {
      const times = [...new Set(d.rows.map(r => new Date(r.logged_at).getTime()))].sort((a, b) => a - b);
      const maxAt = (t) => Math.max(...d.rows.filter(r => new Date(r.logged_at).getTime() === t).map(r => Number(r.weight)));
      wsP.addRow({
        ej: ex, dia: d.day,
        f1: fmtDate(times[0]), p1: maxAt(times[0]),
        f2: fmtDate(times[times.length - 1]), p2: maxAt(times[times.length - 1]),
        best: Math.max(...d.rows.map(r => Number(r.weight))),
        ses: times.length,
      });
    });

    // Hoja 4: Peso corporal
    const wsB = wb.addWorksheet('Peso corporal');
    header(wsB, [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Hora', key: 'hora', width: 8 },
      { header: 'Peso (kg)', key: 'peso', width: 10 },
      { header: 'Notas', key: 'notas', width: 30 },
    ]);
    bw.forEach(b => wsB.addRow({ fecha: fmtDate(b.logged_at), hora: fmtTime(b.logged_at), peso: Number(b.weight), notas: b.notes || '' }));

    const safe = u.name.replace(/[^a-z0-9]/gi, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="entrenamiento_${safe}_${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).send('Error al exportar: ' + e.message); }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

init()
  .then(() => app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`)))
  .catch(err => { console.error('Fallo al iniciar:', err); process.exit(1); });
