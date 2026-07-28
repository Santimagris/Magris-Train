const $ = (s, el = document) => el.querySelector(s);
const api = (url, opts) => fetch(url, opts).then(r => r.json());

let USERS = [], EXERCISES = [], SETS = [], BW = [];
let currentUser = null, currentDay = 'A';

const fmtDate = v => new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(v));
const fmtTime = v => new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' }).format(new Date(v));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- Bootstrap ----------
async function boot() {
  const data = await api('/api/bootstrap');
  USERS = data.users; EXERCISES = data.exercises;
  const saved = Number(localStorage.getItem('gt_user'));
  currentUser = USERS.find(u => u.id === saved)?.id || USERS[0].id;
  renderUserSeg();
  await reloadUserData();
  renderTrain();
  wireNav();
}

function renderUserSeg() {
  $('#userseg').innerHTML = USERS.map(u =>
    `<button data-u="${u.id}" class="${u.id === currentUser ? 'on' : ''}"><span class="dot"></span>${u.name}</button>`
  ).join('');
  $('#userseg').querySelectorAll('button').forEach(b =>
    b.onclick = () => switchUser(Number(b.dataset.u)));
  const name = USERS.find(u => u.id === currentUser)?.name || '';
  $('#histUser').textContent = name;
  $('#wUser').textContent = name;
  $('#expUser').textContent = name;
}

async function switchUser(id) {
  currentUser = id;
  localStorage.setItem('gt_user', id);
  renderUserSeg();
  await reloadUserData();
  renderTrain(); renderHist(); renderWeight();
}

async function reloadUserData() {
  [SETS, BW] = await Promise.all([
    api('/api/sets?user_id=' + currentUser),
    api('/api/bodyweight?user_id=' + currentUser),
  ]);
}

// ---------- Entrenar ----------
function lastFor(exId) {
  const rows = SETS.filter(s => s.exercise_id === exId);
  if (!rows.length) return null;
  const maxT = Math.max(...rows.map(r => new Date(r.logged_at).getTime()));
  const sessionRows = rows.filter(r => new Date(r.logged_at).getTime() === maxT)
    .sort((a, b) => (a.set_number || 0) - (b.set_number || 0));
  // sesión previa para comparar peso máximo
  const prevTimes = [...new Set(rows.map(r => new Date(r.logged_at).getTime()))].sort((a, b) => b - a);
  let up = false;
  if (prevTimes.length > 1) {
    const maxNow = Math.max(...sessionRows.map(r => Number(r.weight)));
    const prevRows = rows.filter(r => new Date(r.logged_at).getTime() === prevTimes[1]);
    const maxPrev = Math.max(...prevRows.map(r => Number(r.weight)));
    up = maxNow > maxPrev;
  }
  return { rows: sessionRows, date: maxT, up, top: Math.max(...sessionRows.map(r => Number(r.weight))) };
}

function renderTrain() {
  const list = EXERCISES.filter(e => e.day === currentDay);
  $('#exlist').innerHTML = list.map(ex => {
    const last = lastFor(ex.id);
    let lastHtml = '<span style="opacity:.7">Sin registros todavía</span>';
    if (last) {
      const sets = last.rows.map(r => `${Number(r.weight)}×${r.reps}`).join(' · ');
      lastHtml = `Último: <b>${sets}</b> · ${fmtDate(last.date)}` + (last.up ? ' <span class="pr">▲ subiste</span>' : '');
    }
    const rows = [1, 2, 3].map(n =>
      `<div class="sn">${n}</div>
       <input inputmode="decimal" data-ex="${ex.id}" data-set="${n}" data-f="w" placeholder="${last ? Number(last.top) : 'kg'}">
       <input inputmode="numeric" data-ex="${ex.id}" data-set="${n}" data-f="r" placeholder="reps">`
    ).join('');
    return `<div class="card">
      <div class="ex-top"><div class="ex-name">${ex.name}</div><div class="ex-scheme">${ex.scheme}</div></div>
      <div class="last" id="last-${ex.id}">${lastHtml}</div>
      <div class="setgrid"><div></div><div class="h">Peso</div><div class="h">Reps</div>${rows}</div>
      <textarea class="exnotes" data-ex="${ex.id}" placeholder="Notas (opcional): sensación, molestia, etc."></textarea>
      <button class="savebtn" data-ex="${ex.id}">Guardar ${ex.name.split(' ')[0].toLowerCase()}</button>
    </div>`;
  }).join('');

  $('#exlist').querySelectorAll('.savebtn').forEach(b =>
    b.onclick = () => saveExercise(Number(b.dataset.ex), b));
}

async function saveExercise(exId, btn) {
  const entries = [1, 2, 3].map(n => {
    const w = $(`input[data-ex="${exId}"][data-set="${n}"][data-f="w"]`).value.trim().replace(',', '.');
    const r = $(`input[data-ex="${exId}"][data-set="${n}"][data-f="r"]`).value.trim();
    return { set_number: n, weight: w, reps: r };
  });
  const notes = $(`textarea[data-ex="${exId}"]`).value.trim();
  const valid = entries.filter(e => e.weight && e.reps);
  if (!valid.length) { toast('Cargá al menos una serie'); return; }

  const res = await api('/api/sets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: currentUser, exercise_id: exId, entries: valid, notes }),
  });
  if (res.error) { toast('Error: ' + res.error); return; }

  btn.classList.add('ok'); btn.textContent = '✓ Guardado';
  toast('Registrado ✓');
  await reloadUserData();
  // limpiar reps, refrescar "último"
  $(`textarea[data-ex="${exId}"]`).value = '';
  [1, 2, 3].forEach(n => { $(`input[data-ex="${exId}"][data-set="${n}"][data-f="r"]`).value = ''; });
  setTimeout(() => renderTrain(), 700);
}

// ---------- Historial ----------
function renderHist() {
  const box = $('#histlist');
  if (!SETS.length) { box.innerHTML = '<div class="empty">Todavía no hay entrenamientos registrados.</div>'; return; }
  // agrupar por (timestamp + ejercicio)
  const groups = {};
  SETS.forEach(s => {
    const key = new Date(s.logged_at).getTime() + '|' + s.exercise_id;
    (groups[key] ||= { ex: s.exercise, day: s.day, at: s.logged_at, exId: s.exercise_id, sets: [], note: s.notes });
    groups[key].sets.push(s);
  });
  const arr = Object.values(groups).sort((a, b) => new Date(b.at) - new Date(a.at));
  box.innerHTML = arr.map(g => {
    const sets = g.sets.sort((a, b) => (a.set_number || 0) - (b.set_number || 0))
      .map(s => `<li>${Number(s.weight)}×${s.reps}</li>`).join('');
    return `<div class="session">
      <div class="sh">
        <div><div class="sd">${fmtDate(g.at)} · ${fmtTime(g.at)}</div><div class="sx">${g.ex}</div></div>
        <span class="badge">Día ${g.day}</span>
      </div>
      <ul>${sets}</ul>
      ${g.note ? `<div class="note">“${g.note}”</div>` : ''}
      <div style="text-align:right;margin-top:9px"><button class="del" data-at="${g.at}" data-ex="${g.exId}">Borrar</button></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.del').forEach(b => b.onclick = () => delSession(b.dataset.at, b.dataset.ex));
}

async function delSession(at, exId) {
  if (!confirm('¿Borrar este registro?')) return;
  await fetch(`/api/session?user_id=${currentUser}&exercise_id=${exId}&logged_at=${encodeURIComponent(at)}`, { method: 'DELETE' });
  toast('Borrado');
  await reloadUserData(); renderHist(); renderTrain();
}

// ---------- Peso corporal ----------
async function saveBW() {
  const w = $('#bwInput').value.trim().replace(',', '.');
  if (!w) { toast('Ingresá el peso'); return; }
  const res = await api('/api/bodyweight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: currentUser, weight: w }),
  });
  if (res.error) { toast('Error: ' + res.error); return; }
  $('#bwInput').value = '';
  toast('Peso guardado ✓');
  await reloadUserData(); renderWeight();
}

function renderWeight() {
  const stat = $('#bwStat'), list = $('#bwList');
  if (!BW.length) {
    stat.innerHTML = ''; list.innerHTML = '<div class="empty">Sin pesajes todavía. Cargá tu primer peso.</div>';
    return;
  }
  const sorted = [...BW].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at));
  const first = Number(sorted[0].weight), last = Number(sorted[sorted.length - 1].weight);
  const diff = (last - first).toFixed(1);
  const diffCls = diff <= 0 ? 'down' : '';
  stat.innerHTML = `
    <div class="b"><div class="v">${first}</div><div class="l">Inicial</div></div>
    <div class="b"><div class="v">${last}</div><div class="l">Actual</div></div>
    <div class="b"><div class="v ${diffCls}">${diff > 0 ? '+' : ''}${diff}</div><div class="l">Diferencia</div></div>`;
  list.innerHTML = BW.map(b =>
    `<div class="bwitem"><div><span class="w">${Number(b.weight)} kg</span></div>
     <div style="display:flex;align-items:center;gap:10px"><span class="d">${fmtDate(b.logged_at)}</span>
     <button class="del" data-id="${b.id}">✕</button></div></div>`
  ).join('');
  list.querySelectorAll('.del').forEach(b => b.onclick = async () => {
    if (!confirm('¿Borrar este pesaje?')) return;
    await fetch('/api/bodyweight/' + b.dataset.id, { method: 'DELETE' });
    await reloadUserData(); renderWeight(); toast('Borrado');
  });
}

// ---------- Navegación ----------
function wireNav() {
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    const p = b.dataset.p;
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('on'));
    $('#p-' + p).classList.add('on');
    document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    if (p === 'hist') renderHist();
    if (p === 'weight') renderWeight();
    window.scrollTo(0, 0);
  });
  document.querySelectorAll('.seg [data-day]').forEach(b => b.onclick = () => {
    currentDay = b.dataset.day;
    $('#tabA').classList.toggle('on', currentDay === 'A');
    $('#tabB').classList.toggle('on', currentDay === 'B');
    renderTrain();
  });
  $('#bwSave').onclick = saveBW;
  $('#bwInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveBW(); });
  $('#expBtn').onclick = () => { window.location = '/api/export/' + currentUser; };
}

boot();
