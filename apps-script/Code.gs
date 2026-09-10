/**
 * API de escritura para la planilla "Licitaciones viales NOA — seguimiento".
 *
 * La rutina diaria de Claude (cloud) no puede escribir en Sheets con el
 * conector de Drive, así que hace un POST acá. Este script agrega filas,
 * descarta duplicados y avisa si la planilla cambió de forma.
 *
 * POST (JSON):
 *   { "token": "...", "filas": [ { "organismo": "...", "numero": "...", ... } ] }
 *   → { "ok": true, "agregadas": n, "duplicadas": m, "descartadas": [...] }
 *   Con "simular": true no escribe nada: devuelve lo mismo más "previa" (las
 *   filas que habría agregado). Sirve para probar la conexión y el formato.
 *
 * Primera vez (sin token configurado todavía):
 *   { "accion": "configurar", "token": "..." }  → guarda el token. Solo funciona
 *   una vez; después de eso cualquier intento devuelve error.
 *
 * GET  → { "ok": true, "columnas": [...], "filas": n }  (diagnóstico, sin datos)
 */

var SHEET_ID = "1rRuO9riWbkwnebzwMioN5fPxDf0mtOKC5b4ec5QtWFE";
var HOJA = "Hoja 1";

var COLUMNAS = [
  "fecha_deteccion", "fuente", "jurisdiccion", "organismo", "numero", "objeto",
  "provincia_obra", "rubro", "presupuesto_oficial", "moneda", "fecha_apertura",
  "plazo_obra", "url", "relevancia", "notas", "estado_seguimiento"
];

/* ------------------------------------------------------------------ util */

function json_(obj, code) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function txt_(v) { return (v === null || v === undefined) ? "" : String(v).trim(); }
function norm_(v) { return txt_(v).toLowerCase().replace(/\s+/g, " "); }

function hoja_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(HOJA) || ss.getSheets()[0];
  return sh;
}

/** Lee la fila de encabezados y avisa si falta alguna columna esperada. */
function encabezados_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return { cols: [], faltan: COLUMNAS.slice() };
  var cols = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(norm_);
  var faltan = COLUMNAS.filter(function (c) { return cols.indexOf(c) < 0; });
  return { cols: cols, faltan: faltan };
}

function tokenGuardado_() {
  return PropertiesService.getScriptProperties().getProperty("TOKEN") || "";
}

/* ------------------------------------------------------------------ GET */

function doGet(e) {
  try {
    var sh = hoja_();
    var enc = encabezados_(sh);
    return json_({
      ok: enc.faltan.length === 0,
      columnas: enc.cols,
      faltan: enc.faltan,
      filas: Math.max(0, sh.getLastRow() - 1),
      token_configurado: !!tokenGuardado_()
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ------------------------------------------------------------------ POST */

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents || "{}");
  } catch (err) {
    return json_({ ok: false, error: "El cuerpo no es JSON valido" });
  }

  var guardado = tokenGuardado_();

  // Configuracion inicial: solo si todavia no hay token.
  if (body.accion === "configurar") {
    if (guardado) return json_({ ok: false, error: "Ya hay un token configurado" });
    var nuevo = txt_(body.token);
    if (nuevo.length < 24) return json_({ ok: false, error: "Token demasiado corto" });
    PropertiesService.getScriptProperties().setProperty("TOKEN", nuevo);
    return json_({ ok: true, mensaje: "Token configurado" });
  }

  if (!guardado) return json_({ ok: false, error: "El script todavia no tiene token configurado" });
  if (txt_(body.token) !== guardado) return json_({ ok: false, error: "Token invalido" });

  var filas = body.filas;
  if (!Array.isArray(filas) || !filas.length) {
    return json_({ ok: false, error: "Falta 'filas' (lista de objetos)" });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hoja_();
    var enc = encabezados_(sh);
    if (enc.faltan.length) {
      return json_({ ok: false, error: "A la planilla le faltan columnas", faltan: enc.faltan });
    }

    // Indice de lo ya cargado para no duplicar.
    var existentes = [];
    var n = sh.getLastRow();
    if (n > 1) existentes = sh.getRange(2, 1, n - 1, enc.cols.length).getValues();
    var iOrg = enc.cols.indexOf("organismo"), iNum = enc.cols.indexOf("numero"),
        iObj = enc.cols.indexOf("objeto"),    iApe = enc.cols.indexOf("fecha_apertura");
    var claves = {};
    existentes.forEach(function (r) { claveDe_(r[iOrg], r[iNum], r[iObj], r[iApe]).forEach(function (k) { claves[k] = 1; }); });

    var hoy = Utilities.formatDate(new Date(), "America/Argentina/Tucuman", "yyyy-MM-dd");
    var nuevas = [], duplicadas = 0, descartadas = [];

    filas.forEach(function (f, idx) {
      if (!f || typeof f !== "object") { descartadas.push({ fila: idx, motivo: "no es un objeto" }); return; }
      var o = {};
      Object.keys(f).forEach(function (k) { o[norm_(k).replace(/ /g, "_")] = f[k]; });

      if (!txt_(o.objeto) && !txt_(o.organismo)) {
        descartadas.push({ fila: idx, motivo: "sin objeto ni organismo" }); return;
      }
      var ks = claveDe_(o.organismo, o.numero, o.objeto, o.fecha_apertura);
      if (ks.some(function (k) { return claves[k]; })) { duplicadas++; return; }
      ks.forEach(function (k) { claves[k] = 1; });

      if (!txt_(o.fecha_deteccion)) o.fecha_deteccion = hoy;
      if (!txt_(o.estado_seguimiento)) o.estado_seguimiento = "nuevo";

      nuevas.push(enc.cols.map(function (c) { return c ? txt_(o[c]) : ""; }));
    });

    if (body.simular) {
      return json_({ ok: true, simulado: true, agregadas: nuevas.length, duplicadas: duplicadas,
                     descartadas: descartadas, previa: nuevas });
    }
    if (nuevas.length) {
      sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, enc.cols.length).setValues(nuevas);
    }
    return json_({ ok: true, agregadas: nuevas.length, duplicadas: duplicadas, descartadas: descartadas });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Claves de duplicado: (organismo+numero) y (objeto+fecha_apertura). */
function claveDe_(org, num, obj, ape) {
  var ks = [];
  if (txt_(org) && txt_(num)) ks.push("on|" + norm_(org) + "|" + norm_(num));
  if (txt_(obj) && txt_(ape)) ks.push("oa|" + norm_(obj) + "|" + norm_(ape));
  return ks;
}

/* --------------------------------------------------------- uso manual */

/**
 * Correr UNA vez desde el editor para autorizar el script (pide permiso
 * de Sheets). Solo verifica que puede leer la planilla.
 */
function verificar() {
  var sh = hoja_();
  var enc = encabezados_(sh);
  Logger.log("Hoja: %s | filas: %s | faltan: %s | token: %s",
    sh.getName(), sh.getLastRow() - 1, enc.faltan.join(",") || "ninguna",
    tokenGuardado_() ? "configurado" : "PENDIENTE");
}

/** Por si hay que rotar el token: borra el actual, despues se vuelve a 'configurar' por POST. */
function borrarToken() {
  PropertiesService.getScriptProperties().deleteProperty("TOKEN");
  Logger.log("Token borrado");
}
