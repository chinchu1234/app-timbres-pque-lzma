const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyRlDIVgIm8NSDPljb_afo48OIIMxmdmV4vmJ5N-_a89EEJ0yhskWL0TJvqv8BtX16t/exec";

// --- PERSISTENCIA PERMANENTE DE SESION ---
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

const DEFAULT_USERS = {
  "admin@app.com": { pass: "1234", nombre: "Administrador Principal", rol: "admin" }
};

function getUsersDB() {
  let users = null;
  try {
    users = JSON.parse(localStorage.getItem("registered_users"));
  } catch (e) {}

  if (!users || typeof users !== "object") {
    users = { ...DEFAULT_USERS };
  }
  if (!users["admin@app.com"]) {
    users["admin@app.com"] = DEFAULT_USERS["admin@app.com"];
  }
  localStorage.setItem("registered_users", JSON.stringify(users));
  return users;
}

function saveUsersDB(users) {
  const merged = { ...getUsersDB(), ...users };
  localStorage.setItem("registered_users", JSON.stringify(merged));
  syncUsersToCloud(merged);
}

function hasAssignedName(userObj, email) {
  return Boolean(
    userObj &&
    userObj.nombre &&
    userObj.nombre.trim() !== "" &&
    userObj.nombre.trim().toLowerCase() !== email.toLowerCase()
  );
}

const INITIAL_BUILDINGS = [ //almaceno los datitos iniciales de los edificios
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
let isPracticeMode = false;
let selectedBuildingId = null;

function getDB() {
  const activePractice = currentUser && currentUser.rol === "admin" && isPracticeMode;
  const key = activePractice ? `db_practice_${currentUser.email}` : "db_real";
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(key));
  } catch (e) {}

  if (!data || !Array.isArray(data.buildings)) {
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

async function loadFromGoogleSheets() { // Esto es para el google sheets (ver)
  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) return;

  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=load`);
    const json = await res.json();

    if (json.status === "ok") {
      // 1. Fusionar usuarios registrados
      if (json.users && Object.keys(json.users).length > 0) {
        const localUsers = getUsersDB();
        const mergedUsers = { ...localUsers };
        Object.keys(json.users).forEach((email) => {
          const cleanEmail = email.trim().toLowerCase();
          mergedUsers[cleanEmail] = {
            ...(localUsers[cleanEmail] || {}),
            ...json.users[email]
          };
        });
        localStorage.setItem("registered_users", JSON.stringify(mergedUsers));
      }

      if (Array.isArray(json.timbres)) {
        const currentReal = getDB();
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
        localStorage.setItem("db_real", JSON.stringify(currentReal));
      }
    }
  } catch (err) {
    console.warn("Usando respaldo local:", err);
  }
}


function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

async function init() {
  if (currentUser && currentUser.email) {
    const users = getUsersDB();
    if (!users[currentUser.email]) {
      users[currentUser.email] = {
        pass: currentUser.pass || "1234",
        nombre: currentUser.nombre || currentUser.email,
        rol: currentUser.rol || "usuario"
      };
      saveUsersDB(users);
    }
    showApp();
  }

  await loadFromGoogleSheets();

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

// registro permanente de usuario en celu
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
  isPracticeMode = false;
  location.reload();
});

function showApp() {
  showScreen("app-screen");
  document.getElementById("user-display").textContent = currentUser.nombre;
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
  e.target.textContent = `Práctica: ${isPracticeMode ? "ON" : "OFF"}`;
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

window.marcarTimbre = async function (timbreId, accion) {
  const db = getDB();
  const building = db.buildings.find((b) => b.id === selectedBuildingId);
  const timbre = building.timbres.find((t) => t.id === timbreId);

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
  await syncToGoogleSheets();
};

document.getElementById("btn-open-admin").addEventListener("click", async () => {
  if (!currentUser || currentUser.rol !== "admin") return;
  showScreen("admin-screen");
  updateBuildingPreview();
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
  if (!confirm("¿Reiniciar todas las fechas de los edificios a 'Nunca tocado'?")) return;

  const db = getDB();
  db.buildings.forEach((b) => {
    b.timbres.forEach((t) => {
      t.ultimaVisita = 0;
      t.ultimaVisitaTexto = "Nunca tocado";
      t.estado = "disponible";
    });
  });

  db.logs.unshift({
    fecha: formatFechaRegistro(Date.now()),
    usuario: currentUser.nombre,
    email: currentUser.email,
    edificio: "TODOS",
    timbre: "SISTEMA",
    accion: "REINICIO DE FECHAS"
  });

  saveDB(db);
  renderLogs();
  const ok = await syncToGoogleSheets(true);
  refreshSheetIframe();

  if (ok) {
    alert("Fechas reiniciadas y actualizadas en la planilla.");
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
  preview.innerHTML = `Se generarán <strong>${lista.length} timbres</strong> (${lista.slice(0, 5).join(", ")}...).`;
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
  updateBuildingPreview();

  const ok = await syncToGoogleSheets(true);
  refreshSheetIframe();

  if (ok) {
    alert(`Edificio ${calle} ${numero} guardado y sincronizado en la planilla.`);
  }
});

// es para sacar edificios en caso de error de tipeo (ver)
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
            <button type="button" class="btn-table btn-no-tocar" onclick="eliminarEdificio('${b.id}')">
              Eliminar
            </button>
          </td>
        </tr>
      `).join("")
    : '<tr><td colspan="3">No hay edificios registrados.</td></tr>';
}

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

  const ok = await syncToGoogleSheets(true);
  refreshSheetIframe();

  if (ok) {
    alert(`Se eliminó "${target.calle} ${target.numero}" de la aplicación y de la planilla.`);
  }
};

// --- 9. TABLA DE USUARIOS REGISTRADOS Y PERMISOS ---
function renderUsersAdmin() {
  if (!currentUser || currentUser.rol !== "admin") return;

  const users = getUsersDB();
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;

  const emails = Object.keys(users).sort((a, b) => {
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
        <button
          type="button"
          class="btn-table ${isAdmin ? "btn-no-tocar" : "btn-visitado"}"
          onclick="toggleUserRole('${email}')"
        >
          ${isAdmin ? "Quitar Admin" : "Hacer Admin"}
        </button>
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
  saveUsersDB(users);
  renderUsersAdmin();

  const accionTexto = nuevoRol === "admin" ? "Permisos de administrador asignados a" : "Permisos de administrador retirados a";
  alert(`${accionTexto} ${users[email].nombre || email}.`);
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

async function syncUsersToCloud(users) {
  if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) return;
  try {
    const formBody = new URLSearchParams();
    formBody.append("payload", JSON.stringify({ users }));
    await fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", body: formBody });
  } catch (err) {
    console.error("Error guardando usuarios:", err);
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
      alert("Error de conexión al sincronizar con la planilla.");
    }
    return false;
  }
}

function refreshSheetIframe() {
  const iframe = document.getElementById("google-sheet-iframe");
  if (iframe) {
    iframe.src = `https://docs.google.com/spreadsheets/d/1hhcXRf3TQuNS1VZ9FnTC98H5goBkOlxBrKZeAlTtHuE/htmlembed?widget=true&headers=false&t=${Date.now()}`;
  }
}

document.getElementById("btn-refresh-sheet")?.addEventListener("click", async () => {
  await syncToGoogleSheets(false);
  refreshSheetIframe();
});

window.abrirGoogleSheetsNube = async function () {
  await syncToGoogleSheets(false);
  window.open("https://docs.google.com/spreadsheets/d/1hhcXRf3TQuNS1VZ9FnTC98H5goBkOlxBrKZeAlTtHuE/edit?gid=0#gid=0", "_blank");
};

// --- 11. ACCESIBILIDAD (A- / A+) ---
const MIN_FONT = 14;
const MAX_FONT = 22;
let currentFontSize = parseInt(localStorage.getItem("custom_font_size"), 10) || 16;

function applyFontSize(size) {
  currentFontSize = Math.min(MAX_FONT, Math.max(MIN_FONT, size));
  document.documentElement.style.fontSize = `${currentFontSize}px`;
  localStorage.setItem("custom_font_size", currentFontSize);
}

applyFontSize(currentFontSize);

document.getElementById("btn-font-dec")?.addEventListener("click", () => applyFontSize(currentFontSize - 1.5));
document.getElementById("btn-font-inc")?.addEventListener("click", () => applyFontSize(currentFontSize + 1.5));

init();