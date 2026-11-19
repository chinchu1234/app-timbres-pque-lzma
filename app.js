// ⚠️ REEMPLAZÁ ESTA URL CON LA DE TU APLICACIÓN WEB DE GOOGLE APPS SCRIPT (termina en /exec)
const GOOGLE_SCRIPT_URL = "https://script.google.com/u/0/home/projects/16HLTh-lkBd4cig0DqhAsNPg7m0BBmQwDnxO2e9RMo0jxsiOQ3vSQJQJg/edit";

// --- PERSISTENCIA REFORZADA DE SESIÓN (LOCALSTORAGE + COOKIE 365 DÍAS) ---
function savePersistentSession(userObj) {
  const jsonStr = JSON.stringify(userObj);
  localStorage.setItem("session_user", jsonStr);
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `timbres_session=${encodeURIComponent(jsonStr)}; expires=${expires}; path=/; SameSite=Lax`;
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

// --- 1. GESTIÓN DE USUARIOS ---
const DEFAULT_USERS = {
  "admin@app.com": { pass: "1234", nombre: "Administrador Principal", rol: "admin" }
};

function getUsersDB() {
  let users = JSON.parse(localStorage.getItem("registered_users"));
  if (!users) {
    users = DEFAULT_USERS;
    localStorage.setItem("registered_users", JSON.stringify(users));
  }
  return users;
}

function saveUsersDB(users) {
  localStorage.setItem("registered_users", JSON.stringify(users));
  syncUsersToCloud(users);
}

function hasAssignedName(userObj, email) {
  return Boolean(userObj && userObj.nombre && userObj.nombre.trim() !== "" && userObj.nombre.trim().toLowerCase() !== email.toLowerCase());
}

// --- 2. DATOS INICIALES ---
const INITIAL_BUILDINGS = [
  {
    id: "ed1",
    calle: "Montes de Oca",
    numero: "70",
    timbres: [
      { id: "t1", depto: "1° A", estado: "disponible", ultimaVisita: 1700000000000 },
      { id: "t2", depto: "1° B", estado: "disponible", ultimaVisita: 1710000000000 },
      { id: "t3", depto: "2° A", estado: "no_tocar", ultimaVisita: 1705000000000 },
      { id: "t4", depto: "4° A", estado: "disponible", ultimaVisita: 0 }
    ]
  }
];

let currentUser = getPersistentSession();
let isPracticeMode = false;
let selectedBuildingId = null;

function getDB() {
  const activePractice = currentUser && currentUser.rol === "admin" && isPracticeMode;
  const key = activePractice ? `db_practice_${currentUser.email}` : "db_real";
  let data = JSON.parse(localStorage.getItem(key));
  if (!data) {
    data = { buildings: JSON.parse(JSON.stringify(INITIAL_BUILDINGS)), logs: [] };
    localStorage.setItem(key, JSON.stringify(data));
  }
  return data;
}

function saveDB(data) {
  const activePractice = currentUser && currentUser.rol === "admin" && isPracticeMode;
  const key = activePractice ? `db_practice_${currentUser.email}` : "db_real";
  localStorage.setItem(key, JSON.stringify(data));
}

// --- SINCRONIZACIÓN DE LECTURA DESDE GOOGLE SHEETS ---
async function loadFromGoogleSheets() {
  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) return;

  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=load`);
    const json = await res.json();

    if (json.status === "ok") {
      if (json.users && Object.keys(json.users).length > 0) {
        localStorage.setItem("registered_users", JSON.stringify(json.users));
      }

      if (json.timbres && json.timbres.length > 0) {
        const mapEdificios = {};
        json.timbres.forEach((row, index) => {
          const key = `${row.calle.trim().toLowerCase()}_${row.numero.trim().toLowerCase()}`;
          if (!mapEdificios[key]) {
            mapEdificios[key] = {
              id: `ed_cloud_${Object.keys(mapEdificios).length + 1}`,
              territorio: row.territorio || "XX",
              manzana: row.manzana || "XX",
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

          mapEdificios[key].timbres.push({
            id: `t_cloud_${index}`,
            depto: row.timbre,
            estado: row.estado === "no_tocar" ? "no_tocar" : (row.estado === "visitado" ? "visitado" : "disponible"),
            ultimaVisita: timestamp,
            ultimaVisitaTexto: row.ultimaVisita
          });
        });

        const currentReal = JSON.parse(localStorage.getItem("db_real")) || { buildings: [], logs: [] };
        currentReal.buildings = Object.values(mapEdificios);
        localStorage.setItem("db_real", JSON.stringify(currentReal));
      }
    }
  } catch (err) {
    console.warn("No se pudo descargar desde la nube, usando caché local:", err);
  }
}

// --- 3. NAVEGACIÓN ENTRE PANTALLAS ---
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

async function init() {
  // 1. Si ya hay sesión guardada en el celular, entra AL INSTANTE sin esperar red
  if (currentUser && hasAssignedName(currentUser, currentUser.email)) {
    showApp();
  }

  // 2. Descarga actualizaciones de la nube en segundo plano
  await loadFromGoogleSheets();

  // 3. Revalida rol/nombre actualizado desde la nube
  if (currentUser) {
    const users = getUsersDB();
    if (users[currentUser.email]) {
      currentUser.rol = users[currentUser.email].rol;
      currentUser.nombre = users[currentUser.email].nombre;
      savePersistentSession(currentUser);
      showApp();
    }
  }
  updateBuildingPreview();
}

// --- 4. LOGIN Y REGISTRO INTELIGENTE ---
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
    submitBtn.textContent = userRecord ? "Guardar Nombre e Ingresar" : "Registrarme e Ingresar";
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
      alert("⚠️ Contraseña incorrecta. Verificá tu clave.");
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
      errorEl.textContent = "Es un correo nuevo. Completá tu Nombre y Apellido.";
      return;
    }

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
  alert("✅ Contraseña actualizada con éxito.");
  e.target.reset();
  showScreen("login-screen");
});

document.getElementById("btn-logout").addEventListener("click", () => {
  clearPersistentSession();
  currentUser = null;
  isPracticeMode = false;
  location.reload();
});

function showApp() {
  showScreen("app-screen");
  document.getElementById("user-display").textContent = `Hola, ${currentUser.nombre}!`;
  document.getElementById("role-badge").textContent = currentUser.rol.toUpperCase();

  const btnAdmin = document.getElementById("btn-open-admin");
  const btnPractice = document.getElementById("btn-toggle-practice");

  if (currentUser.rol === "admin") {
    btnAdmin.classList.remove("hidden");
    btnPractice.classList.remove("hidden");
  } else {
    btnAdmin.classList.add("hidden");
    btnPractice.classList.add("hidden");
    isPracticeMode = false;
    document.getElementById("practice-banner").classList.add("hidden");
  }
  updateCalleSuggestions();
}

document.getElementById("btn-toggle-practice").addEventListener("click", (e) => {
  if (!currentUser || currentUser.rol !== "admin") return;

  isPracticeMode = !isPracticeMode;
  e.target.textContent = `Modo Práctica: ${isPracticeMode ? "ON" : "OFF"}`;
  e.target.classList.toggle("on", isPracticeMode);
  document.getElementById("practice-banner").classList.toggle("hidden", !isPracticeMode);
  selectedBuildingId = null;
  document.getElementById("timbres-container").classList.add("hidden");
  document.getElementById("input-calle").value = "";
  document.getElementById("input-numero").value = "";
  document.getElementById("search-feedback").textContent = "";
  updateCalleSuggestions();
});

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
    feedback.textContent = "Escribí calle y número.";
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
    const fechaTexto = t.ultimaVisita === 0
      ? "Nunca tocado"
      : (t.ultimaVisitaTexto && t.ultimaVisitaTexto !== "Nunca tocado"
          ? `Última vez: ${t.ultimaVisitaTexto}`
          : `Última vez: ${new Date(t.ultimaVisita).toLocaleDateString()} ${new Date(t.ultimaVisita).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);

    const isNoTocar = t.estado === "no_tocar";

    list.innerHTML += `
      <div class="timbre-item ${isNoTocar ? "no-tocar" : ""}">
        <div class="timbre-info">
          <strong>${t.depto} ${isNoTocar ? "(NO TOCAR)" : ""}</strong>
          <span>${fechaTexto}</span>
        </div>
        <div class="timbre-actions">
          ${!isNoTocar ? `
            <button class="btn-visitado" onclick="marcarTimbre('${t.id}', 'visitado')">Ya visitado</button>
            <button class="btn-no-tocar" onclick="marcarTimbre('${t.id}', 'no_tocar')">No tocar</button>
          ` : `
            <button class="btn-habilitar" onclick="marcarTimbre('${t.id}', 'habilitar')">Habilitar</button>
          `}
        </div>
      </div>
    `;
  });
}

window.marcarTimbre = async function (timbreId, accion) {
  const db = getDB();
  const building = db.buildings.find((b) => b.id === selectedBuildingId);
  const timbre = building.timbres.find((t) => t.id === timbreId);

  if (accion === "visitado") {
    timbre.ultimaVisita = Date.now();
    timbre.ultimaVisitaTexto = new Date(timbre.ultimaVisita).toLocaleString();
    timbre.estado = "visitado";
  } else if (accion === "no_tocar") {
    timbre.estado = "no_tocar";
  } else if (accion === "habilitar") {
    timbre.estado = "disponible";
  }

  db.logs.unshift({
    fecha: new Date().toLocaleString(),
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: `${building.calle} ${building.numero}`,
    timbre: timbre.depto,
    accion: accion.toUpperCase()
  });

  saveDB(db);
  renderTimbres();
  await syncToGoogleSheets();
};

document.getElementById("btn-open-admin").addEventListener("click", async () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  showScreen("admin-screen");
  updateBuildingPreview();
  await loadFromGoogleSheets();
  renderUsersAdmin();
  renderLogs();
});

document.getElementById("btn-back-app").addEventListener("click", () => {
  showApp();
});

document.getElementById("btn-reset-dates")?.addEventListener("click", async () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  if (!confirm("⚠️ ¿Reiniciar todas las fechas de todos los edificios a 'Nunca tocado'?")) return;

  const db = getDB();
  db.buildings.forEach((b) => {
    b.timbres.forEach((t) => {
      t.ultimaVisita = 0;
      t.ultimaVisitaTexto = "Nunca tocado";
      t.estado = "disponible";
    });
  });

  db.logs.unshift({
    fecha: new Date().toLocaleString(),
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: "TODOS",
    timbre: "SISTEMA",
    accion: "REINICIO TOTAL DE FECHAS"
  });

  saveDB(db);
  renderLogs();
  const ok = await syncToGoogleSheets(true);
  
  if (ok) {
    alert("✅ Historial reiniciado y actualizado en Google Sheets.");
  }
});

function generateDeptoLabels() {
  const inicio = parseInt(document.getElementById("piso-inicio").value, 10) || 1;
  const fin = parseInt(document.getElementById("piso-fin").value, 10) || 1;
  const porPiso = parseInt(document.getElementById("deptos-por-piso").value, 10) || 1;
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

function updateBuildingPreview() {
  const preview = document.getElementById("preview-timbres");
  if (!preview) return;
  const lista = generateDeptoLabels();
  preview.innerHTML = `Se generarán <strong>${lista.length} timbres</strong> (ej. ${lista.slice(0, 5).join(", ")}...).`;
}

["piso-inicio", "piso-fin", "deptos-por-piso", "formato-depto", "incluir-pb"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", updateBuildingPreview);
});

document.getElementById("add-building-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || currentUser.rol !== "admin") return;

  const calle = document.getElementById("new-calle").value.trim();
  const numero = document.getElementById("new-numero").value.trim();
  const etiquetas = generateDeptoLabels();

  const timbres = etiquetas.map((depto, idx) => ({
    id: `t_${Date.now()}_${idx}`,
    depto,
    estado: "disponible",
    ultimaVisita: 0,
    ultimaVisitaTexto: "Nunca tocado"
  }));

  const db = getDB();
  db.buildings.push({ id: `ed_${Date.now()}`, calle, numero, timbres });
  saveDB(db);
  updateCalleSuggestions();

  e.target.reset();
  updateBuildingPreview();

  const ok = await syncToGoogleSheets(true);
  if (ok) {
    alert(`✅ Edificio creado con ${timbres.length} timbres y guardado en Google Sheets.`);
  }
});

function renderUsersAdmin() {
  if (!currentUser || currentUser.rol !== "admin") return;

  const users = getUsersDB();
  const tbody = document.getElementById("users-tbody");
  const emails = Object.keys(users).sort();

  tbody.innerHTML = emails.map((email) => {
    const u = users[email];
    const isAdmin = u.rol === "admin";
    const isSelf = currentUser.email === email;
    const isRootAdmin = email === "admin@app.com";

    let accionHTML = isSelf ? `<small>Tu cuenta</small>` : isRootAdmin ? `<small>Protegido</small>` : `
      <button type="button" class="btn-table ${isAdmin ? "btn-no-tocar" : "btn-visitado"}" onclick="toggleUserRole('${email}')">
        ${isAdmin ? "Quitar Admin" : "Hacer Admin"}
      </button>`;

    return `
      <tr>
        <td><strong>${u.nombre || "Sin nombre"}</strong></td>
        <td>${email}</td>
        <td><span class="badge">${u.rol.toUpperCase()}</span></td>
        <td>${accionHTML}</td>
      </tr>
    `;
  }).join("");
}

window.toggleUserRole = function (email) {
  if (!currentUser || currentUser.rol !== "admin") return;
  const users = getUsersDB();
  users[email].rol = users[email].rol === "admin" ? "usuario" : "admin";
  saveUsersDB(users);
  renderUsersAdmin();
  alert(`✅ Permisos actualizados para ${email}.`);
};

function renderLogs() {
  const db = getDB();
  const users = getUsersDB();
  const tbody = document.getElementById("logs-tbody");

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
    : '<tr><td colspan="5">Sin movimientos.</td></tr>';
}

// --- 10. GOOGLE SHEETS (ESCRITURA EN LA NUBE) ---
async function syncUsersToCloud(users) {
  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) return;
  try {
    const formBody = new URLSearchParams();
    formBody.append("payload", JSON.stringify({ users }));
    await fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", body: formBody });
  } catch (err) {
    console.error("Error guardando usuarios en la nube:", err);
  }
}

async function syncToGoogleSheets(mostrarAlertas = false) {
  const activePractice = currentUser && currentUser.rol === "admin" && isPracticeMode;
  if (activePractice) return false;

  const db = getDB();
  const edificiosOrdenados = [...db.buildings].sort((a, b) => {
    const cmpCalle = a.calle.localeCompare(b.calle);
    return cmpCalle !== 0 ? cmpCalle : a.numero.localeCompare(b.numero, undefined, { numeric: true });
  });

  let rows = [];
  edificiosOrdenados.forEach((ed) => {
    ed.timbres.forEach((t) => {
      const fechaTexto = t.ultimaVisita === 0
        ? "Nunca tocado"
        : (t.ultimaVisitaTexto || new Date(t.ultimaVisita).toLocaleString());

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
      alert("⚠️ Edificio guardado localmente, pero falta configurar GOOGLE_SCRIPT_URL en app.js.");
    }
    return false;
  }

  try {
    const formBody = new URLSearchParams();
    formBody.append("payload", JSON.stringify({ rows }));

    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: formBody
    });
    return true;
  } catch (err) {
    console.error("Error sincronizando con Google Sheets:", err);
    if (mostrarAlertas) {
      alert("❌ Error de red al intentar enviar los datos a Google Sheets.");
    }
    return false;
  }
}

window.abrirGoogleSheetsNube = async function () {
  await syncToGoogleSheets(false);
  window.open("https://docs.google.com/spreadsheets/d/1hhcXRf3TQuNS1VZ9FnTC98H5goBkOlxBrKZeAlTtHuE/edit?gid=0#gid=0", "_blank");
};

// --- 11. ACCESIBILIDAD (A- / A+) ---
const MIN_FONT = 15;
const MAX_FONT = 24;
let currentFontSize = parseInt(localStorage.getItem("custom_font_size"), 10) || 17;

function applyFontSize(size) {
  currentFontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, size));
  document.documentElement.style.fontSize = `${currentFontSize}px`;
  localStorage.setItem("custom_font_size", currentFontSize);
}

applyFontSize(currentFontSize);

document.getElementById("btn-font-dec")?.addEventListener("click", () => applyFontSize(currentFontSize - 1.5));
document.getElementById("btn-font-inc")?.addEventListener("click", () => applyFontSize(currentFontSize + 1.5));

init();