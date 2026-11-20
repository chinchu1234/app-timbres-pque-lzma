const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwmd0WrB8JrmiVfQkJS-4SQ_e6ceZRJ5NCj8S3LLA-cT9JRQwKQPwG2X0eVeP1xP2bK/exec";
                          
// --- PERSISTENCIA PERMANENTE DE SESION (LOCALSTORAGE + COOKIE HASTA 2099) ---
function savePersistentSession(userObj) {
  const jsonStr = JSON.stringify(userObj);
  localStorage.setItem("session_user", jsonStr);
  document.cookie = `timbres_session=${encodeURIComponent(jsonStr)}; expires=Fri, 31 Dec 2099 23:59:59 GMT; path=/; SameSite=Lax`;
}

function getPersistentSession() {
  const fromLocal = localStorage.getItem("session_user");
  if (fromLocal) {
    try { return JSON.parse(fromLocal); } catch (e) {}
  }
  const match = document.cookie.match(/(?:^|;\s*)timbres_session=([^;]*)/);
  if (match && match[1]) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      localStorage.setItem("session_user", JSON.stringify(parsed));
      return parsed;
    } catch (e) {}
  }
  return null;
}

function clearPersistentSession() {
  localStorage.removeItem("session_user");
  document.cookie = "timbres_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
}

// --- 1. GESTION DE USUARIOS Y ELIMINACION DEFINITIVA ---
const DEFAULT_USERS = {
  "admin@app.com": { pass: "1234", nombre: "Administrador Principal", rol: "admin" }
};

function getDeletedUsersList() {
  try {
    const arr = JSON.parse(localStorage.getItem("deleted_users_list"));
    return Array.isArray(arr) ? arr.map((e) => e.trim().toLowerCase()) : [];
  } catch (e) {
    return [];
  }
}

function saveDeletedUsersList(list) {
  const clean = [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => e && e !== "admin@app.com"))];
  localStorage.setItem("deleted_users_list", JSON.stringify(clean));
  return clean;
}

function getUsersDB() {
  let users = null;
  try {
    users = JSON.parse(localStorage.getItem("registered_users"));
  } catch (e) {}

  if (!users || typeof users !== "object") {
    users = { ...DEFAULT_USERS };
  }

  const deletedList = getDeletedUsersList();
  Object.keys(users).forEach((key) => {
    if (deletedList.includes(key.trim().toLowerCase())) {
      delete users[key];
    }
  });

  if (!users["admin@app.com"]) {
    users["admin@app.com"] = DEFAULT_USERS["admin@app.com"];
  }
  localStorage.setItem("registered_users", JSON.stringify(users));
  return users;
}

function saveUsersDB(users, replaceAll = false, deletedEmail = null) {
  let deletedList = getDeletedUsersList();
  if (deletedEmail) {
    deletedList = saveDeletedUsersList([...deletedList, deletedEmail]);
  }

  const rawFinal = replaceAll ? { ...users } : { ...getUsersDB(), ...users };
  const finalUsers = {};

  Object.keys(rawFinal).forEach((key) => {
    const cleanKey = key.trim().toLowerCase();
    if (!deletedList.includes(cleanKey)) {
      finalUsers[cleanKey] = rawFinal[key];
    }
  });

  if (!finalUsers["admin@app.com"]) {
    finalUsers["admin@app.com"] = DEFAULT_USERS["admin@app.com"];
  }
  localStorage.setItem("registered_users", JSON.stringify(finalUsers));
  syncUsersToCloud(finalUsers, replaceAll, deletedEmail);
}

function hasAssignedName(userObj, email) {
  return Boolean(
    userObj &&
    userObj.nombre &&
    userObj.nombre.trim() !== "" &&
    userObj.nombre.trim().toLowerCase() !== email.toLowerCase()
  );
}

// --- 2. DATOS INICIALES Y ALMACENAMIENTO DE EDIFICIOS ---
const INITIAL_BUILDINGS = [
  {
    id: "ed1",
    calle: "Montes de Oca",
    numero: "70",
    timbres: [
      { id: "t1", depto: "1° A", estado: "disponible", ultimaVisita: 1700000000000, ultimaVisitaTexto: "Nunca tocado" },
      { id: "t2", depto: "1° B", estado: "disponible", ultimaVisita: 1710000000000, ultimaVisitaTexto: "Nunca tocado" },
      { id: "t3", depto: "2° A", estado: "no_tocar", ultimaVisita: 1705000000000, ultimaVisitaTexto: "Nunca tocado" },
      { id: "t4", depto: "4° A", estado: "disponible", ultimaVisita: 0, ultimaVisitaTexto: "Nunca tocado" }
    ]
  }
];

let currentUser = getPersistentSession();
let selectedBuildingId = null;
let draftTimbres = [];
let editingBuildingId = null;
let dragSourceIndex = null;
let dragContext = null;

function getDB() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem("db_real"));
  } catch (e) {}

  if (!data || !Array.isArray(data.buildings)) {
    data = { buildings: JSON.parse(JSON.stringify(INITIAL_BUILDINGS)), logs: [] };
    localStorage.setItem("db_real", JSON.stringify(data));
  }
  if (!Array.isArray(data.logs)) {
    data.logs = [];
  }
  return data;
}

function saveDB(data) {
  localStorage.setItem("db_real", JSON.stringify(data));
}

// --- SINCRONIZACION DE LECTURA DESDE GOOGLE SHEETS ---
async function loadFromGoogleSheets() {
  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) return;

  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=load`);
    const json = await res.json();

    if (json.status === "ok") {
      if (json.users && typeof json.users === "object") {
        const deletedList = getDeletedUsersList();
        const cloudUsers = {};
        Object.keys(json.users).forEach((email) => {
          const cleanEmail = email.trim().toLowerCase();
          if (!deletedList.includes(cleanEmail)) {
            cloudUsers[cleanEmail] = json.users[email];
          }
        });
        if (!cloudUsers["admin@app.com"]) {
          cloudUsers["admin@app.com"] = DEFAULT_USERS["admin@app.com"];
        }
        localStorage.setItem("registered_users", JSON.stringify(cloudUsers));
      }

      const currentReal = getDB();

      if (Array.isArray(json.timbres)) {
        const mapEdificios = {};
        currentReal.buildings.forEach((b) => {
          const key = `${b.calle.trim().toLowerCase()}_${b.numero.trim().toLowerCase()}`;
          mapEdificios[key] = b;
        });

        const cloudEdificios = {};
        json.timbres.forEach((row, index) => {
          const key = `${row.calle.trim().toLowerCase()}_${row.numero.trim().toLowerCase()}`;
          if (!cloudEdificios[key]) {
            cloudEdificios[key] = {
              id: mapEdificios[key]?.id || `ed_cloud_${Object.keys(cloudEdificios).length + 1}`,
              territorio: row.territorio || mapEdificios[key]?.territorio || "XX",
              manzana: row.manzana || mapEdificios[key]?.manzana || "XX",
              calle: row.calle.trim(),
              numero: row.numero.trim(),
              timbres: []
            };
          }

          let timestamp = 0;
          if (row.ultimaVisita && row.ultimaVisita !== "Nunca tocado") {
            const parsed = Date.parse(row.ultimaVisita);
            timestamp = isNaN(parsed) ? Date.now() - (json.timbres.length - index) * 1000 : parsed;
          }

          const estadoNorm = String(row.estado || "").toLowerCase();
          cloudEdificios[key].timbres.push({
            id: `t_cloud_${index}`,
            depto: row.timbre,
            estado: estadoNorm === "no_tocar" ? "no_tocar" : (estadoNorm === "visitado" ? "visitado" : "disponible"),
            ultimaVisita: timestamp,
            ultimaVisitaTexto: row.ultimaVisita || "Nunca tocado"
          });
        });

        currentReal.buildings = Object.values(cloudEdificios);
      }

      if (Array.isArray(json.logs)) {
        currentReal.logs = json.logs;
      }

      localStorage.setItem("db_real", JSON.stringify(currentReal));
    }
  } catch (err) {
    console.warn("Usando respaldo local:", err);
  }
}

// --- 3. NAVEGACION ENTRE PANTALLAS ---
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

async function init() {
  regenerateDraftTimbres();

  if (currentUser && currentUser.email) {
    const cleanEmail = currentUser.email.trim().toLowerCase();
    const deletedList = getDeletedUsersList();
    if (deletedList.includes(cleanEmail)) {
      clearPersistentSession();
      currentUser = null;
      showScreen("login-screen");
    } else {
      const users = getUsersDB();
      if (users[cleanEmail]) {
        showApp();
      } else {
        clearPersistentSession();
        currentUser = null;
      }
    }
  }

  await loadFromGoogleSheets();

  if (currentUser) {
    const cleanEmail = currentUser.email.trim().toLowerCase();
    const users = getUsersDB();
    if (users[cleanEmail]) {
      currentUser.rol = users[cleanEmail].rol;
      currentUser.nombre = users[cleanEmail].nombre;
      savePersistentSession(currentUser);
      showApp();
    } else {
      clearPersistentSession();
      currentUser = null;
      showScreen("login-screen");
    }
  }
}

// --- 4. LOGIN Y REGISTRO ---
const emailInput = document.getElementById("login-email");
const nameGroup = document.getElementById("name-field-group");
const nameInput = document.getElementById("login-name");
const submitBtn = document.getElementById("btn-login-submit");

function checkEmailNeedsName() {
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    nameGroup.classList.add("hidden");
    nameInput.required = false;
    submitBtn.textContent = "Ingresar";
    return;
  }

  const users = getUsersDB();
  const userRecord = users[email];

  if (!userRecord || !hasAssignedName(userRecord, email)) {
    nameGroup.classList.remove("hidden");
    nameInput.required = true;
    submitBtn.textContent = userRecord ? "Guardar nombre e ingresar" : "Registrarme e ingresar";
  } else {
    nameGroup.classList.add("hidden");
    nameInput.required = false;
    nameInput.value = "";
    submitBtn.textContent = "Ingresar";
  }
}

if (emailInput) {
  emailInput.addEventListener("input", checkEmailNeedsName);
  emailInput.addEventListener("blur", checkEmailNeedsName);
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim().toLowerCase();
  const pass = document.getElementById("login-pass").value;
  const nombreIngresado = nameInput.value.trim();
  const errorEl = document.getElementById("login-error");

  submitBtn.disabled = true;
  submitBtn.textContent = "Conectando...";

  await loadFromGoogleSheets();
  const users = getUsersDB();
  const existingUser = users[email];

  submitBtn.disabled = false;

  if (existingUser) {
    if (existingUser.pass !== pass) {
      errorEl.textContent = "Contraseña incorrecta para este correo.";
      submitBtn.textContent = "Ingresar";
      return;
    }

    if (!hasAssignedName(existingUser, email)) {
      if (!nombreIngresado) {
        nameGroup.classList.remove("hidden");
        nameInput.required = true;
        nameInput.focus();
        errorEl.textContent = "Completá tu Nombre y Apellido para continuar.";
        return;
      }
      existingUser.nombre = nombreIngresado;
      saveUsersDB(users);
    }

    currentUser = { email, ...existingUser };
    savePersistentSession(currentUser);
    errorEl.textContent = "";
    showApp();
  } else {
    if (!nombreIngresado) {
      nameGroup.classList.remove("hidden");
      nameInput.required = true;
      nameInput.focus();
      errorEl.textContent = "Es tu primera vez. Completá tu Nombre y Apellido para quedar registrado.";
      return;
    }

    saveDeletedUsersList(getDeletedUsersList().filter((em) => em !== email));

    const newUser = { pass, nombre: nombreIngresado, rol: "usuario" };
    users[email] = newUser;
    saveUsersDB(users);

    currentUser = { email, ...newUser };
    savePersistentSession(currentUser);
    errorEl.textContent = "";
    showApp();
  }
});

document.getElementById("btn-go-reset").addEventListener("click", () => {
  document.getElementById("reset-msg").textContent = "";
  document.getElementById("reset-form").reset();
  showScreen("reset-screen");
});

document.getElementById("btn-cancel-reset").addEventListener("click", () => {
  showScreen("login-screen");
});

document.getElementById("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("reset-email").value.trim().toLowerCase();
  const newPass = document.getElementById("reset-new-pass").value;
  const confirmPass = document.getElementById("reset-confirm-pass").value;
  const msgEl = document.getElementById("reset-msg");

  await loadFromGoogleSheets();
  const users = getUsersDB();
  if (!users[email]) {
    msgEl.textContent = "Ese correo electrónico no está registrado.";
    return;
  }

  if (newPass !== confirmPass) {
    msgEl.textContent = "Las contraseñas no coinciden.";
    return;
  }

  users[email].pass = newPass;
  saveUsersDB(users);
  alert("Contraseña actualizada.");
  e.target.reset();
  showScreen("login-screen");
});

document.getElementById("btn-logout").addEventListener("click", () => {
  clearPersistentSession();
  currentUser = null;
  location.reload();
});

function showApp() {
  showScreen("app-screen");
  document.getElementById("user-display").textContent = `Hola, ${currentUser.nombre}!`;
  document.getElementById("role-badge").textContent = currentUser.rol.toUpperCase();

  const btnAdmin = document.getElementById("btn-open-admin");
  if (currentUser.rol === "admin") {
    btnAdmin.classList.remove("hidden");
  } else {
    btnAdmin.classList.add("hidden");
  }
  updateCalleSuggestions();
}

function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function updateCalleSuggestions() {
  const db = getDB();
  const datalist = document.getElementById("datalist-calles");
  const callesUnicas = [...new Set(db.buildings.map((b) => b.calle))].sort();
  datalist.innerHTML = callesUnicas.map((c) => `<option value="${c}">`).join("");
}

async function ejecutarBusqueda() {
  const calleBuscada = normalizeText(document.getElementById("input-calle").value);
  const numeroBuscado = normalizeText(document.getElementById("input-numero").value);
  const feedback = document.getElementById("search-feedback");

  if (!calleBuscada || !numeroBuscado) {
    feedback.textContent = "Completá calle y número.";
    document.getElementById("timbres-container").classList.add("hidden");
    return;
  }

  feedback.textContent = "Buscando...";
  await loadFromGoogleSheets();
  updateCalleSuggestions();

  const db = getDB();
  const match = db.buildings.find(
    (b) => normalizeText(b.calle).includes(calleBuscada) && normalizeText(b.numero) === numeroBuscado
  );

  if (match) {
    feedback.textContent = "";
    selectedBuildingId = match.id;
    renderTimbres();
  } else {
    selectedBuildingId = null;
    document.getElementById("timbres-container").classList.add("hidden");
    feedback.textContent = "No se encontró ningún edificio con esa dirección.";
  }
}

document.getElementById("btn-search-building").addEventListener("click", ejecutarBusqueda);
document.getElementById("input-calle").addEventListener("keypress", (e) => { if (e.key === "Enter") ejecutarBusqueda(); });
document.getElementById("input-numero").addEventListener("keypress", (e) => { if (e.key === "Enter") ejecutarBusqueda(); });

function renderTimbres() {
  const db = getDB();
  const building = db.buildings.find((b) => b.id === selectedBuildingId);
  if (!building) return;

  document.getElementById("timbres-container").classList.remove("hidden");
  document.getElementById("building-title").textContent = `${building.calle} ${building.numero}`;

  const sorted = [...building.timbres].sort((a, b) => {
    if (a.estado === "no_tocar" && b.estado !== "no_tocar") return 1;
    if (a.estado !== "no_tocar" && b.estado === "no_tocar") return -1;
    return a.ultimaVisita - b.ultimaVisita;
  });

  const list = document.getElementById("timbres-list");
  list.innerHTML = "";

  sorted.forEach((t) => {
    const hasFecha = t.ultimaVisitaTexto && t.ultimaVisitaTexto !== "Nunca tocado";
    const fechaTexto = hasFecha
      ? `Último registro: ${t.ultimaVisitaTexto}`
      : (t.ultimaVisita === 0
          ? "Sin registros previos"
          : `Último registro: ${new Date(t.ultimaVisita).toLocaleDateString()} ${new Date(t.ultimaVisita).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);

    const isNoTocar = t.estado === "no_tocar";

    list.innerHTML += `
      <div class="timbre-item ${isNoTocar ? "no-tocar" : ""}">
        <div class="timbre-info">
          <strong>${t.depto} ${isNoTocar ? "— NO TOCAR" : ""}</strong>
          <span>${fechaTexto}</span>
        </div>
        <div class="timbre-actions">
          ${!isNoTocar ? `
            <button type="button" class="btn-visitado" onclick="marcarTimbre('${t.id}', 'visitado')">Visitado</button>
            <button type="button" class="btn-no-tocar" onclick="marcarTimbre('${t.id}', 'no_tocar')">No tocar</button>
          ` : `
            <button type="button" class="btn-habilitar" onclick="marcarTimbre('${t.id}', 'habilitar')">Habilitar</button>
          `}
        </div>
      </div>
    `;
  });
}

function formatFechaRegistro(ts) {
  const d = new Date(ts);
  const fecha = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fecha} ${hora}`;
}

// --- REGISTRAR VISITADO / NO TOCAR / HABILITAR EN HISTORIAL Y NUBE ---
window.marcarTimbre = async function (timbreId, accion) {
  const db = getDB();
  const building = db.buildings.find((b) => b.id === selectedBuildingId);
  if (!building) return;
  const timbre = building.timbres.find((t) => t.id === timbreId);
  if (!timbre) return;

  const ahora = Date.now();
  const fechaFormateada = formatFechaRegistro(ahora);

  if (accion === "visitado") {
    timbre.ultimaVisita = ahora;
    timbre.ultimaVisitaTexto = fechaFormateada;
    timbre.estado = "visitado";
  } else if (accion === "no_tocar") {
    timbre.ultimaVisita = ahora;
    timbre.ultimaVisitaTexto = fechaFormateada;
    timbre.estado = "no_tocar";
  } else if (accion === "habilitar") {
    timbre.ultimaVisita = ahora;
    timbre.ultimaVisitaTexto = fechaFormateada;
    timbre.estado = "disponible";
  }

  db.logs.unshift({
    fecha: fechaFormateada,
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: `${building.calle} ${building.numero}`,
    timbre: timbre.depto,
    accion: accion === "visitado" ? "VISITADO" : (accion === "no_tocar" ? "NO TOCAR" : "HABILITADO")
  });

  saveDB(db);
  renderTimbres();
  renderLogs();
  await syncToGoogleSheets(false, true);
};

// --- 8. PANEL DE ADMINISTRADOR ---
document.getElementById("btn-open-admin").addEventListener("click", async () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  showScreen("admin-screen");
  if (draftTimbres.length === 0) regenerateDraftTimbres();
  renderDraftTimbres();
  renderBuildingsAdmin();
  renderUsersAdmin();
  renderLogs();
  await loadFromGoogleSheets();
  renderBuildingsAdmin();
  renderUsersAdmin();
  renderLogs();
});

document.getElementById("btn-back-app").addEventListener("click", () => {
  showApp();
});

document.getElementById("btn-reset-dates")?.addEventListener("click", async () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  if (!confirm("¿Reiniciar todas las fechas de los edificios a 'Nunca tocado' y limpiar el historial?")) return;

  const db = getDB();
  db.buildings.forEach((b) => {
    b.timbres.forEach((t) => {
      t.ultimaVisita = 0;
      t.ultimaVisitaTexto = "Nunca tocado";
      t.estado = "disponible";
    });
  });

  // Elimina todos los registros anteriores y deja únicamente esta interacción
  db.logs = [
    {
      fecha: formatFechaRegistro(Date.now()),
      usuario: currentUser.nombre,
      email: currentUser.email,
      edificio: "TODOS",
      timbre: "SISTEMA",
      accion: "REINICIO DE FECHAS (DATOS ELIMINADOS)"
    }
  ];

  saveDB(db);
  renderLogs();
  const ok = await syncToGoogleSheets(true, true);
  refreshSheetIframe();

  if (ok) {
    alert("Fechas reiniciadas y registros anteriores eliminados.");
  }
});

// --- GENERADOR BASE + EDICION Y REORDENAMIENTO DE TIMBRES ---
function generateDeptoLabels() {
  const inicio = parseInt(document.getElementById("piso-inicio").value, 10) || 1;
  const fin = parseInt(document.getElementById("piso-fin").value, 10) || 1;
  const porPiso = Math.max(0, parseInt(document.getElementById("deptos-por-piso").value, 10) || 0);
  const formato = document.getElementById("formato-depto").value;
  const incluirPB = document.getElementById("incluir-pb").checked;

  const etiquetas = [];
  const getSufijo = (idx) => formato === "letras" ? String.fromCharCode(65 + idx) : String(idx + 1);

  if (incluirPB) {
    for (let d = 0; d < porPiso; d++) etiquetas.push(`PB ${getSufijo(d)}`);
  }
  for (let piso = inicio; piso <= fin; piso++) {
    for (let d = 0; d < porPiso; d++) etiquetas.push(`${piso}° ${getSufijo(d)}`);
  }
  return etiquetas;
}

function regenerateDraftTimbres() {
  draftTimbres = generateDeptoLabels();
  renderDraftTimbres();
}

function renderDraftTimbres() {
  const countEl = document.getElementById("preview-timbres-count");
  const container = document.getElementById("draft-timbres-list");
  if (!countEl || !container) return;

  countEl.textContent = `Timbres a crear: ${draftTimbres.length}`;
  container.innerHTML = draftTimbres.length
    ? draftTimbres.map((label, idx) => `
        <span
          class="timbre-chip"
          draggable="true"
          data-idx="${idx}"
          ondragstart="handleChipDragStart(event, 'draft', ${idx})"
          ondragover="handleChipDragOver(event)"
          ondragleave="handleChipDragLeave(event)"
          ondrop="handleChipDrop(event, 'draft', ${idx})"
          ondragend="handleChipDragEnd(event)"
        >
          <button type="button" class="chip-move" onclick="moveDraftTimbre(${idx}, -1)" ${idx === 0 ? "disabled" : ""} title="Mover antes">←</button>
          <span class="chip-label">${label}</span>
          <button type="button" class="chip-move" onclick="moveDraftTimbre(${idx}, 1)" ${idx === draftTimbres.length - 1 ? "disabled" : ""} title="Mover después">→</button>
          <button type="button" class="chip-remove" onclick="removeDraftTimbre(${idx})" title="Quitar timbre">×</button>
        </span>
      `).join("")
    : '<span class="legend">Sin timbres en la lista. Agregá alguno abajo.</span>';
}

window.moveDraftTimbre = function (idx, direction) {
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= draftTimbres.length) return;
  const [moved] = draftTimbres.splice(idx, 1);
  draftTimbres.splice(targetIdx, 0, moved);
  renderDraftTimbres();
};

window.removeDraftTimbre = function (idx) {
  draftTimbres.splice(idx, 1);
  renderDraftTimbres();
};

// --- ARRASTRAR Y SOLTAR BLOQUES (DRAG & DROP) ---
window.handleChipDragStart = function (e, context, idx) {
  dragSourceIndex = idx;
  dragContext = context;
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
};

window.handleChipDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
};

window.handleChipDragLeave = function (e) {
  e.currentTarget.classList.remove("drag-over");
};

window.handleChipDragEnd = function (e) {
  e.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".timbre-chip").forEach((el) => el.classList.remove("drag-over", "dragging"));
};

window.handleChipDrop = async function (e, context, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  if (dragSourceIndex === null || dragContext !== context || dragSourceIndex === targetIdx) return;

  if (context === "draft") {
    const [moved] = draftTimbres.splice(dragSourceIndex, 1);
    draftTimbres.splice(targetIdx, 0, moved);
    renderDraftTimbres();
  } else if (context === "edit" && editingBuildingId) {
    await reorderBuildingTimbre(editingBuildingId, dragSourceIndex, targetIdx);
  }

  dragSourceIndex = null;
  dragContext = null;
};

function addCustomDraftTimbre() {
  const input = document.getElementById("custom-timbre-input");
  const val = input.value.trim();
  if (!val) return;

  if (draftTimbres.some((t) => normalizeText(t) === normalizeText(val))) {
    alert("Ese timbre ya está en la lista.");
    return;
  }

  draftTimbres.push(val);
  input.value = "";
  renderDraftTimbres();
}

document.getElementById("btn-add-custom-timbre")?.addEventListener("click", addCustomDraftTimbre);
document.getElementById("custom-timbre-input")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addCustomDraftTimbre();
  }
});

["piso-inicio", "piso-fin", "deptos-por-piso", "formato-depto", "incluir-pb"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", regenerateDraftTimbres);
});

document.getElementById("add-building-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || currentUser.rol !== "admin") return;

  if (draftTimbres.length === 0) {
    alert("Agregá al menos un timbre antes de guardar el edificio.");
    return;
  }

  const calle = document.getElementById("new-calle").value.trim();
  const numero = document.getElementById("new-numero").value.trim();
  const etiquetas = [...draftTimbres];

  const db = getDB();
  const existingIdx = db.buildings.findIndex(
    (b) => normalizeText(b.calle) === normalizeText(calle) && normalizeText(b.numero) === normalizeText(numero)
  );

  const nuevosTimbres = etiquetas.map((depto, idx) => ({
    id: `t_${Date.now()}_${idx}`,
    depto,
    estado: "disponible",
    ultimaVisita: 0,
    ultimaVisitaTexto: "Nunca tocado"
  }));

  if (existingIdx !== -1) {
    const existentesDeptos = new Set(db.buildings[existingIdx].timbres.map((t) => normalizeText(t.depto)));
    nuevosTimbres.forEach((nt) => {
      if (!existentesDeptos.has(normalizeText(nt.depto))) {
        db.buildings[existingIdx].timbres.push(nt);
      }
    });
  } else {
    db.buildings.push({
      id: `ed_${Date.now()}`,
      calle,
      numero,
      timbres: nuevosTimbres
    });
  }

  saveDB(db);
  updateCalleSuggestions();
  renderBuildingsAdmin();

  e.target.reset();
  regenerateDraftTimbres();

  const ok = await syncToGoogleSheets(true, false);
  refreshSheetIframe();

  if (ok) {
    alert(`Edificio ${calle} ${numero} guardado y sincronizado en el orden elegido.`);
  }
});

// --- GESTION, EDICION, REORDENAMIENTO Y ELIMINACION DE EDIFICIOS ---
function renderBuildingsAdmin() {
  if (!currentUser || currentUser.rol !== "admin") return;
  const tbody = document.getElementById("buildings-tbody");
  if (!tbody) return;

  const db = getDB();
  const ordenados = [...db.buildings].sort((a, b) => {
    const cmp = a.calle.localeCompare(b.calle);
    return cmp !== 0 ? cmp : a.numero.localeCompare(b.numero, undefined, { numeric: true });
  });

  tbody.innerHTML = ordenados.length
    ? ordenados.map((b) => `
        <tr>
          <td><strong>${b.calle} ${b.numero}</strong></td>
          <td>${b.timbres.length} timbres</td>
          <td>
            <div class="user-actions-cell">
              <button type="button" class="btn-table btn-habilitar" onclick="abrirEditorTimbres('${b.id}')">
                Editar timbres
              </button>
              <button type="button" class="btn-table btn-no-tocar" onclick="eliminarEdificio('${b.id}')">
                Eliminar
              </button>
            </div>
          </td>
        </tr>
      `).join("")
    : '<tr><td colspan="3">No hay edificios registrados.</td></tr>';

  if (editingBuildingId) {
    renderEditBuildingPanel();
  }
}

window.abrirEditorTimbres = function (buildingId) {
  editingBuildingId = buildingId;
  renderEditBuildingPanel();
};

function renderEditBuildingPanel() {
  const panel = document.getElementById("edit-building-panel");
  const title = document.getElementById("edit-building-title");
  const chips = document.getElementById("edit-building-chips");
  if (!panel || !title || !chips) return;

  const db = getDB();
  const building = db.buildings.find((b) => b.id === editingBuildingId);
  if (!building) {
    panel.classList.add("hidden");
    editingBuildingId = null;
    return;
  }

  panel.classList.remove("hidden");
  title.textContent = `Editando timbres: ${building.calle} ${building.numero} (${building.timbres.length})`;

  chips.innerHTML = building.timbres.length
    ? building.timbres.map((t, idx) => `
        <span
          class="timbre-chip"
          draggable="true"
          data-idx="${idx}"
          ondragstart="handleChipDragStart(event, 'edit', ${idx})"
          ondragover="handleChipDragOver(event)"
          ondragleave="handleChipDragLeave(event)"
          ondrop="handleChipDrop(event, 'edit', ${idx})"
          ondragend="handleChipDragEnd(event)"
        >
          <button type="button" class="chip-move" onclick="moveExistingTimbre('${building.id}', ${idx}, -1)" ${idx === 0 ? "disabled" : ""} title="Mover antes">←</button>
          <span class="chip-label">${t.depto}</span>
          <button type="button" class="chip-move" onclick="moveExistingTimbre('${building.id}', ${idx}, 1)" ${idx === building.timbres.length - 1 ? "disabled" : ""} title="Mover después">→</button>
          <button type="button" class="chip-remove" onclick="quitarTimbreEdificio('${building.id}', '${t.id}')" title="Quitar timbre">×</button>
        </span>
      `).join("")
    : '<span class="legend">Este edificio no tiene timbres.</span>';
}

async function reorderBuildingTimbre(buildingId, fromIdx, toIdx) {
  const db = getDB();
  const building = db.buildings.find((b) => b.id === buildingId);
  if (!building) return;
  if (toIdx < 0 || toIdx >= building.timbres.length) return;

  const [moved] = building.timbres.splice(fromIdx, 1);
  building.timbres.splice(toIdx, 0, moved);

  saveDB(db);
  renderEditBuildingPanel();
  await syncToGoogleSheets(false, false);
  refreshSheetIframe();
}

window.moveExistingTimbre = async function (buildingId, idx, direction) {
  await reorderBuildingTimbre(buildingId, idx, idx + direction);
};

document.getElementById("btn-close-edit-building")?.addEventListener("click", () => {
  editingBuildingId = null;
  document.getElementById("edit-building-panel")?.classList.add("hidden");
});

window.quitarTimbreEdificio = async function (buildingId, timbreId) {
  if (!currentUser || currentUser.rol !== "admin") return;

  const db = getDB();
  const building = db.buildings.find((b) => b.id === buildingId);
  if (!building) return;

  const timbre = building.timbres.find((t) => t.id === timbreId);
  if (!timbre) return;

  if (!confirm(`¿Quitar el timbre "${timbre.depto}" de ${building.calle} ${building.numero}?`)) return;

  building.timbres = building.timbres.filter((t) => t.id !== timbreId);

  db.logs.unshift({
    fecha: formatFechaRegistro(Date.now()),
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: `${building.calle} ${building.numero}`,
    timbre: timbre.depto,
    accion: "TIMBRE QUITADO"
  });

  saveDB(db);
  renderBuildingsAdmin();
  renderLogs();
  if (selectedBuildingId === buildingId) renderTimbres();

  await syncToGoogleSheets(false, true);
  refreshSheetIframe();
};

async function agregarTimbreEdificioExistente() {
  if (!currentUser || currentUser.rol !== "admin" || !editingBuildingId) return;

  const input = document.getElementById("edit-custom-timbre-input");
  const depto = input.value.trim();
  if (!depto) return;

  const db = getDB();
  const building = db.buildings.find((b) => b.id === editingBuildingId);
  if (!building) return;

  if (building.timbres.some((t) => normalizeText(t.depto) === normalizeText(depto))) {
    alert("Ese timbre ya existe en este edificio.");
    return;
  }

  building.timbres.push({
    id: `t_${Date.now()}`,
    depto,
    estado: "disponible",
    ultimaVisita: 0,
    ultimaVisitaTexto: "Nunca tocado"
  });

  db.logs.unshift({
    fecha: formatFechaRegistro(Date.now()),
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: `${building.calle} ${building.numero}`,
    timbre: depto,
    accion: "TIMBRE AGREGADO"
  });

  input.value = "";
  saveDB(db);
  renderBuildingsAdmin();
  renderLogs();
  if (selectedBuildingId === editingBuildingId) renderTimbres();

  await syncToGoogleSheets(false, true);
  refreshSheetIframe();
}

document.getElementById("btn-save-edit-timbre")?.addEventListener("click", agregarTimbreEdificioExistente);
document.getElementById("edit-custom-timbre-input")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    agregarTimbreEdificioExistente();
  }
});

window.eliminarEdificio = async function (buildingId) {
  if (!currentUser || currentUser.rol !== "admin") return;

  const db = getDB();
  const target = db.buildings.find((b) => b.id === buildingId);
  if (!target) return;

  const confirmar = confirm(`¿Eliminar "${target.calle} ${target.numero}" y sus ${target.timbres.length} timbres de la aplicación y de Google Sheets?`);
  if (!confirmar) return;

  db.buildings = db.buildings.filter((b) => b.id !== buildingId);

  if (selectedBuildingId === buildingId) {
    selectedBuildingId = null;
    document.getElementById("timbres-container")?.classList.add("hidden");
  }
  if (editingBuildingId === buildingId) {
    editingBuildingId = null;
    document.getElementById("edit-building-panel")?.classList.add("hidden");
  }

  db.logs.unshift({
    fecha: formatFechaRegistro(Date.now()),
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: `${target.calle} ${target.numero}`,
    timbre: "TODOS",
    accion: "EDIFICIO ELIMINADO"
  });

  saveDB(db);
  updateCalleSuggestions();
  renderBuildingsAdmin();
  renderLogs();

  const ok = await syncToGoogleSheets(true, true);
  refreshSheetIframe();

  if (ok) {
    alert(`Se eliminó "${target.calle} ${target.numero}" de la aplicación y de la planilla.`);
  }
};

// --- 9. TABLA DE USUARIOS REGISTRADOS Y PERMISOS (ORDENADOS POR ROL + ELIMINAR DEFINITIVO) ---
function renderUsersAdmin() {
  if (!currentUser || currentUser.rol !== "admin") return;

  const users = getUsersDB();
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;

  const emails = Object.keys(users).sort((a, b) => {
    const roleA = users[a].rol === "admin" ? 0 : 1;
    const roleB = users[b].rol === "admin" ? 0 : 1;
    if (roleA !== roleB) return roleA - roleB;

    const nameA = (users[a].nombre || a).toLowerCase();
    const nameB = (users[b].nombre || b).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  tbody.innerHTML = emails.map((email) => {
    const u = users[email];
    const isAdmin = u.rol === "admin";
    const isSelf = currentUser.email.toLowerCase() === email.toLowerCase();
    const isRootAdmin = email.toLowerCase() === "admin@app.com";
    const nombreUsuario = u.nombre && u.nombre.trim() !== "" ? u.nombre : "Sin nombre";

    let accionHTML = "";
    if (isRootAdmin) {
      accionHTML = `<span class="legend">Principal</span>`;
    } else if (isSelf) {
      accionHTML = `<span class="legend">Tu cuenta</span>`;
    } else {
      accionHTML = `
        <div class="user-actions-cell">
          <button
            type="button"
            class="btn-table ${isAdmin ? "btn-habilitar" : "btn-visitado"}"
            onclick="toggleUserRole('${email}')"
          >
            ${isAdmin ? "Quitar Admin" : "Hacer Admin"}
          </button>
          <button
            type="button"
            class="btn-table btn-no-tocar"
            onclick="eliminarUsuario('${email}')"
          >
            Eliminar
          </button>
        </div>
      `;
    }

    return `
      <tr>
        <td><strong>${nombreUsuario}</strong></td>
        <td>${email}</td>
        <td><span class="badge">${isAdmin ? "ADMIN" : "USUARIO"}</span></td>
        <td>${accionHTML}</td>
      </tr>
    `;
  }).join("");
}

window.toggleUserRole = async function (email) {
  if (!currentUser || currentUser.rol !== "admin") return;
  const users = getUsersDB();
  if (!users[email]) return;

  const nuevoRol = users[email].rol === "admin" ? "usuario" : "admin";
  users[email].rol = nuevoRol;
  saveUsersDB(users, false, null);
  renderUsersAdmin();

  const accionTexto = nuevoRol === "admin" ? "Permisos de administrador asignados a" : "Permisos de administrador retirados a";
  alert(`${accionTexto} ${users[email].nombre || email}.`);
};

window.eliminarUsuario = async function (email) {
  if (!currentUser || currentUser.rol !== "admin") return;
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === "admin@app.com" || cleanEmail === currentUser.email.toLowerCase()) return;

  const users = getUsersDB();
  const target = users[cleanEmail] || users[email];
  if (!target) return;

  const confirmar = confirm(`¿Eliminar para siempre del registro al usuario "${target.nombre || email}" (${email})?`);
  if (!confirmar) return;

  delete users[cleanEmail];
  delete users[email];
  saveUsersDB(users, true, cleanEmail);

  renderUsersAdmin();
  alert(`Usuario "${target.nombre || email}" eliminado para siempre.`);
};

function renderLogs() {
  const db = getDB();
  const users = getUsersDB();
  const tbody = document.getElementById("logs-tbody");
  if (!tbody) return;

  tbody.innerHTML = db.logs.length
    ? db.logs.map((l) => {
        const userRecord = (l.email && users[l.email]) || users[l.usuario];
        const nombreMostrar = userRecord && userRecord.nombre ? userRecord.nombre : l.usuario;
        return `
          <tr>
            <td>${l.fecha}</td>
            <td><strong>${nombreMostrar}</strong></td>
            <td>${l.edificio}</td>
            <td>${l.timbre}</td>
            <td>${l.accion}</td>
          </tr>
        `;
      }).join("")
    : '<tr><td colspan="5">Sin movimientos registrados.</td></tr>';
}

// --- 10. GOOGLE SHEETS (ESCRITURA EN LA NUBE) ---
async function syncUsersToCloud(users, replaceAll = false, deletedEmail = null) {
  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) return;
  try {
    const formBody = new URLSearchParams();
    formBody.append("payload", JSON.stringify({
      users,
      replaceUsers: replaceAll,
      deletedEmail: deletedEmail || ""
    }));
    await fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", body: formBody });
  } catch (err) {
    console.error("Error guardando usuarios:", err);
  }
}

async function syncToGoogleSheets(mostrarAlertas = false, syncLogs = false) {
  const db = getDB();
  const edificiosOrdenados = [...db.buildings].sort((a, b) => {
    const cmpCalle = a.calle.localeCompare(b.calle);
    return cmpCalle !== 0 ? cmpCalle : a.numero.localeCompare(b.numero, undefined, { numeric: true });
  });

  let rows = [];
  edificiosOrdenados.forEach((ed) => {
    ed.timbres.forEach((t) => {
      const fechaTexto = t.ultimaVisitaTexto && t.ultimaVisitaTexto !== ""
        ? t.ultimaVisitaTexto
        : (t.ultimaVisita === 0 ? "Nunca tocado" : formatFechaRegistro(t.ultimaVisita));

      rows.push({
        territorio: ed.territorio || "XX",
        manzana: ed.manzana || "XX",
        calle: ed.calle,
        numero: ed.numero,
        timbre: t.depto,
        estado: t.estado.toUpperCase(),
        ultimaVisita: fechaTexto
      });
    });
  });

  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) {
    if (mostrarAlertas) {
      alert("Guardado localmente. Falta configurar GOOGLE_SCRIPT_URL en app.js.");
    }
    return false;
  }

  try {
    const payloadObj = { rows };
    if (syncLogs) {
      payloadObj.logs = db.logs;
    }

    const formBody = new URLSearchParams();
    formBody.append("payload", JSON.stringify(payloadObj));

    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: formBody
    });
    return true;
  } catch (err) {
    console.error("Error sincronizando con Google Sheets:", err);
    if (mostrarAlertas) {
      alert("Error de conexión al sincronizar con la planilla.");
    }
    return false;
  }
}

function refreshSheetIframe() {
  const iframe = document.getElementById("google-sheet-iframe");
  if (iframe) {
    iframe.src = `https://docs.google.com/spreadsheets/d/1hhcXRf3TQuNS1VZ9FnTC98H5goBkOlxBrKZeAlTtHuE/htmlembed?gid=0&single=true&widget=false&headers=false&t=${Date.now()}`;
  }
}

document.getElementById("btn-refresh-sheet")?.addEventListener("click", async () => {
  await syncToGoogleSheets(false, true);
  refreshSheetIframe();
});

window.abrirGoogleSheetsNube = async function () {
  await syncToGoogleSheets(false, true);
  window.open("https://docs.google.com/spreadsheets/d/1hhcXRf3TQuNS1VZ9FnTC98H5goBkOlxBrKZeAlTtHuE/edit?gid=0#gid=0", "_blank");
};

// --- 11. ACCESIBILIDAD (A- / A+ EN TODAS LAS INTERFACES) ---
const MIN_FONT = 14;
const MAX_FONT = 22;
let currentFontSize = parseInt(localStorage.getItem("custom_font_size"), 10) || 16;

function applyFontSize(size) {
  currentFontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, size));
  document.documentElement.style.fontSize = `${currentFontSize}px`;
  localStorage.setItem("custom_font_size", currentFontSize);
}

applyFontSize(currentFontSize);

document.querySelectorAll(".btn-font-dec").forEach((btn) => {
  btn.addEventListener("click", () => applyFontSize(currentFontSize - 1.5));
});

document.querySelectorAll(".btn-font-inc").forEach((btn) => {
  btn.addEventListener("click", () => applyFontSize(currentFontSize + 1.5));
});

init();