// --- 1. GESTIÓN DE USUARIOS PERSISTENTES ---
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
}

function hasAssignedName(userObj, email) {
  return Boolean(userObj && userObj.nombre && userObj.nombre.trim() !== "" && userObj.nombre.trim().toLowerCase() !== email.toLowerCase());
}

// --- 2. DATOS INICIALES DE EDIFICIOS ---
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
  },
  {
    id: "ed2",
    calle: "Montes de Oca",
    numero: "120",
    timbres: [
      { id: "t5", depto: "PB A", estado: "disponible", ultimaVisita: 0 },
      { id: "t6", depto: "1° A", estado: "disponible", ultimaVisita: 1720000000000 }
    ]
  }
];

let currentUser = JSON.parse(localStorage.getItem("session_user")) || null;
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

// --- 3. NAVEGACIÓN ENTRE PANTALLAS ---
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function init() {
  if (currentUser) {
    const users = getUsersDB();
    if (users[currentUser.email]) {
      currentUser.rol = users[currentUser.email].rol;
      currentUser.nombre = users[currentUser.email].nombre;
      localStorage.setItem("session_user", JSON.stringify(currentUser));
    }
    if (!hasAssignedName(currentUser, currentUser.email)) {
      localStorage.removeItem("session_user");
      currentUser = null;
    } else {
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

document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = emailInput.value.trim().toLowerCase();
  const pass = document.getElementById("login-pass").value;
  const nombreIngresado = nameInput.value.trim();
  const errorEl = document.getElementById("login-error");

  const users = getUsersDB();
  const existingUser = users[email];

  if (existingUser) {
    if (existingUser.pass !== pass) {
      errorEl.textContent = "Contraseña incorrecta para este correo.";
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
    localStorage.setItem("session_user", JSON.stringify(currentUser));
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
    localStorage.setItem("session_user", JSON.stringify(currentUser));
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

document.getElementById("reset-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("reset-email").value.trim().toLowerCase();
  const newPass = document.getElementById("reset-new-pass").value;
  const confirmPass = document.getElementById("reset-confirm-pass").value;
  const msgEl = document.getElementById("reset-msg");

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
  localStorage.removeItem("session_user");
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

function ejecutarBusqueda() {
  const calleBuscada = normalizeText(document.getElementById("input-calle").value);
  const numeroBuscado = normalizeText(document.getElementById("input-numero").value);
  const feedback = document.getElementById("search-feedback");

  if (!calleBuscada || !numeroBuscado) {
    feedback.textContent = "Escribí calle y número.";
    document.getElementById("timbres-container").classList.add("hidden");
    return;
  }

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
      : `Última vez: ${new Date(t.ultimaVisita).toLocaleDateString()} ${new Date(t.ultimaVisita).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

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

window.marcarTimbre = function (timbreId, accion) {
  const db = getDB();
  const building = db.buildings.find((b) => b.id === selectedBuildingId);
  const timbre = building.timbres.find((t) => t.id === timbreId);

  if (accion === "visitado") {
    timbre.ultimaVisita = Date.now();
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
  syncToGoogleSheets();
};

document.getElementById("btn-open-admin").addEventListener("click", () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  showScreen("admin-screen");
  updateBuildingPreview();
  renderUsersAdmin();
  renderLogs();
});

document.getElementById("btn-back-app").addEventListener("click", () => {
  showApp();
});

document.getElementById("btn-reset-dates")?.addEventListener("click", () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  if (!confirm("⚠️ ¿Reiniciar todas las fechas de todos los edificios a 'Nunca tocado'?")) return;

  const db = getDB();
  db.buildings.forEach((b) => {
    b.timbres.forEach((t) => {
      t.ultimaVisita = 0;
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
  syncToGoogleSheets();
  
  alert("✅ Historial de fechas reiniciado correctamente.");
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

document.getElementById("add-building-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentUser || currentUser.rol !== "admin") return;

  const calle = document.getElementById("new-calle").value.trim();
  const numero = document.getElementById("new-numero").value.trim();
  const etiquetas = generateDeptoLabels();

  const timbres = etiquetas.map((depto, idx) => ({
    id: `t_${Date.now()}_${idx}`,
    depto,
    estado: "disponible",
    ultimaVisita: 0
  }));

  const db = getDB();
  db.buildings.push({ id: `ed_${Date.now()}`, calle, numero, timbres });
  saveDB(db);
  updateCalleSuggestions();

  e.target.reset();
  updateBuildingPreview();
  syncToGoogleSheets();
  alert(`✅ Edificio creado con ${timbres.length} timbres y sincronizado con Google Sheets.`);
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

// --- 10. GOOGLE SHEETS (SINCRONIZACIÓN REAL CON TODAS LAS CARACTERÍSTICAS) ---
// ⚠️ REEMPLAZÁ ESTA URL CON LA DE TU IMPLEMENTACIÓN DE GOOGLE APPS SCRIPT (termina en /exec)
const GOOGLE_SCRIPT_URL = "https://script.google.com/u/0/home/projects/16HLTh-lkBd4cig0DqhAsNPg7m0BBmQwDnxO2e9RMo0jxsiOQ3vSQJQJg/edit";

function syncToGoogleSheets() {
  const activePractice = currentUser && currentUser.rol === "admin" && isPracticeMode;
  if (activePractice) return; // En modo práctica no modifica la nube

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
        : new Date(t.ultimaVisita).toLocaleString();

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

  localStorage.setItem("virtual_sheets_data", JSON.stringify(rows));

  if (GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/")) {
    fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ rows })
    }).catch((err) => console.error("Error sincronizando con Google Sheets:", err));
  }
}

window.abrirGoogleSheetsNube = function () {
  syncToGoogleSheets();
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