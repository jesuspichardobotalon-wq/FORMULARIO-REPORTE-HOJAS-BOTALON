/**
 * BACKEND EN GOOGLE APPS SCRIPT
 * Sistema de Reportes Dinámico - EL BOTALÓN
 * Conexión a Google Sheets, Google Drive y Bot de Telegram (con ruteo por grupos)
 */

// =============================================================================
// 1. CONFIGURACIÓN GENERAL
// =============================================================================

// Token de tu Bot de Telegram (@Reportesformulariobotalonbot)
var BOT_TOKEN = PropertiesService.getScriptProperties().getProperty("BOT_TOKEN") || "9149895791:AAHym5YhB15TJqVXbOwAqUA6gU2XVzNPv0c";

// ID de la Hoja de Google Sheets: CONTROL Y REPORTES - EL BOTALÓN
var SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") || "1u2fkH3_IuaSZAW0NShFwDaDItGx4uXEf3X85cFykz7Q";

// ID de la Carpeta de Google Drive para respaldar fotos (Opcional, si se deja vacío crea una automáticamente)
var DRIVE_FOLDER_ID = PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_ID") || "";

// =============================================================================
// 2. CONFIGURACIÓN DE DESTINOS POR MÓDULO (GRUPOS DE TELEGRAM Y PESTAÑAS)
// =============================================================================
// Grupo: SOPORTE Y TELECOMUNICACIONES - BOTALON ARAURE (ID: -1004374950371)
var CHAT_ID_PRINCIPAL = "-1004374950371";

var CONFIG_DESTINOS = {
  "CONTROL_HOJAS": {
    chatId: CHAT_ID_PRINCIPAL,
    topicId: 26,
    sheetName: "CONTROL HOJAS"
  },
  "TRASLADOS_ENVIOS": {
    chatId: CHAT_ID_PRINCIPAL,
    topicId: 41,
    sheetName: "TRASLADOS Y ENVÍOS"
  },
  "REPORTE_SOPORTE": {
    chatId: CHAT_ID_PRINCIPAL,
    topicId: 3,
    sheetName: "SOPORTE DIARIO"
  },
  "INCIDENCIAS": {
    chatId: CHAT_ID_PRINCIPAL,
    topicId: 4,
    sheetName: "INCIDENCIAS"
  },
  "INVENTARIO": {
    chatId: CHAT_ID_PRINCIPAL,
    topicId: 5,
    sheetName: "INVENTARIO"
  }
};

// =============================================================================
// 3. CONTROLADORES HTTP (doGet / doPost)
// =============================================================================

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "activo",
    sistema: "EL BOTALÓN - Servidor de Reportes",
    fecha: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: "Sin datos recibidos en la petición." });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({ success: false, error: "Formato JSON inválido." });
    }

    var tipoReporte = data.tipo_reporte || "CONTROL_HOJAS";
    var configDestino = CONFIG_DESTINOS[tipoReporte] || CONFIG_DESTINOS["CONTROL_HOJAS"];

    // 1. Guardar fotos en Google Drive (si fueron adjuntadas)
    var driveFolderUrl = "";
    if (data.imagenes && data.imagenes.length > 0) {
      try {
        driveFolderUrl = guardarEnGoogleDrive(data, tipoReporte);
        data.drive_url = driveFolderUrl;
      } catch (eDrive) {
        Logger.log("Error al guardar en Google Drive: " + eDrive.toString());
      }
    }

    // 2. Guardar registro en Google Sheets
    var sheetGuardado = false;
    try {
      sheetGuardado = registrarEnGoogleSheet(data, tipoReporte, configDestino.sheetName);
    } catch (eSheet) {
      Logger.log("Error al registrar en Google Sheet: " + eSheet.toString());
    }

    // 3. Construir mensaje formateado para Telegram
    var mensajeTelegram = buildMessage(data, tipoReporte);

    // 4. Enviar mensaje a Telegram al grupo correspondiente
    var respuestaTelegram = sendTelegramMessage(mensajeTelegram, configDestino.chatId, configDestino.topicId);

    // 5. Enviar fotos adjuntas si existen y si el mensaje principal fue exitoso
    try {
      var jsonResp = JSON.parse(respuestaTelegram);
      if (jsonResp.ok && data.imagenes && data.imagenes.length > 0) {
        var replyId = jsonResp.result.message_id;
        sendTelegramPhotos(data.imagenes, configDestino.chatId, configDestino.topicId, replyId);
      }
    } catch (eFoto) {
      Logger.log("Error enviando fotos a Telegram: " + eFoto.toString());
    }

    return createJsonResponse({
      success: true,
      tipo_reporte: tipoReporte,
      sheet_guardado: sheetGuardado,
      drive_url: driveFolderUrl,
      telegram_ok: true
    });

  } catch (err) {
    Logger.log("Error general en doPost: " + err.toString());
    return createJsonResponse({ success: false, error: err.toString() });
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// 4. CONSTRUCCIÓN DE MENSAJES Y FORMATO PARA TELEGRAM (MODO HTML ROBUSTO)
// =============================================================================

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMessage(data, tipo) {
  var fechaDisplay = escapeHtml((data.fecha || "N/A").replace("T", " "));
  var responsable = escapeHtml(toUpperSafe(data.responsable || "N/A"));
  var sede = escapeHtml(toUpperSafe(data.sede || "EL BOTALÓN"));
  var driveLink = data.drive_url ? "\n📁 <b>FOTOS EN DRIVE:</b> <a href=\"" + data.drive_url + "\">ABRIR CARPETA</a>" : "";

  var titulo = "";
  var cuerpo = "";
  var tags = "#EL_BOTALON";
  var notaModulo = "";

  if (tipo === "CONTROL_HOJAS") {
    titulo = "📄 <b>[CONTROL DE HOJAS DESPACHADAS]</b>";
    tags += " #CONTROL_HOJAS #PAPELERIA";

    cuerpo =
      "🏢 <b>GALPÓN / DESTINO:</b> " + escapeHtml(toUpperSafe(data.hojas_area || "N/A")) + "\n" +
      "📦 <b>TIPO DE FORMATO:</b> " + escapeHtml(toUpperSafe(data.hojas_tipo || "N/A")) + "\n" +
      "🔢 <b>CANTIDAD:</b> " + escapeHtml(toUpperSafe(data.hojas_cantidad || "1")) + " (" + escapeHtml(toUpperSafe(data.hojas_unidad || "RESMAS")) + ")";

    if (data.hojas_nota) {
      notaModulo = "\n\n📝 <b>NOTA / DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.hojas_nota));
    }

  } else if (tipo === "TRASLADOS_ENVIOS") {
    titulo = "🚚 <b>[REPORTE DE TRASLADO / ENVÍO]</b>";
    tags += " #TRASLADOS #LOGISTICA";

    cuerpo =
      "📋 <b>TIPO MOVIMIENTO:</b> " + escapeHtml(toUpperSafe(data.traslado_tipo || "N/A")) + "\n" +
      "🏷️ <b>N° GUÍA/CONTROL:</b> " + escapeHtml(toUpperSafe(data.traslado_guia || "S/G")) + "\n" +
      "📍 <b>ORIGEN:</b> " + escapeHtml(toUpperSafe(data.traslado_origen || "N/A")) + "\n" +
      "🎯 <b>DESTINO:</b> " + escapeHtml(toUpperSafe(data.traslado_destino || "N/A")) + "\n" +
      "📦 <b>DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.traslado_descripcion || "N/A"));

    if (data.traslado_nota) {
      notaModulo = "\n\n📝 <b>NOTA / DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.traslado_nota));
    }

  } else if (tipo === "REPORTE_SOPORTE") {
    titulo = "🛠️ <b>[REPORTE DIARIO DE ACTIVIDADES DE SOPORTE]</b>";
    tags += " #SOPORTE_TECNICO #ACTIVIDADES_DIARIAS";

    cuerpo =
      "⏰ <b>TURNO:</b> " + escapeHtml(toUpperSafe(data.soporte_turno || "N/A")) + "\n" +
      "📡 <b>ESTADO DE SISTEMAS:</b> " + escapeHtml(toUpperSafe(data.soporte_estado_sistemas || "N/A")) + "\n\n" +
      "📋 <b>ACTIVIDADES REALIZADAS:</b>\n" + escapeHtml(toUpperSafe(data.soporte_actividades || "N/A"));

    if (data.soporte_nota) {
      notaModulo = "\n\n📝 <b>NOTA / DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.soporte_nota));
    }

  } else if (tipo === "INCIDENCIAS") {
    titulo = "⚠️ <b>[REPORTE DE INCIDENCIA / AVERÍA]</b>";
    tags += " #INCIDENCIAS #SOPORTE";

    cuerpo =
      "🚨 <b>PRIORIDAD:</b> " + escapeHtml(toUpperSafe(data.incidencia_prioridad || "N/A")) + "\n" +
      "📁 <b>CATEGORÍA:</b> " + escapeHtml(toUpperSafe(data.incidencia_categoria || "N/A")) + "\n" +
      "🏢 <b>GALPÓN / AFECTADO:</b> " + escapeHtml(toUpperSafe(data.incidencia_area || "N/A")) + "\n" +
      "📊 <b>ESTADO:</b> " + escapeHtml(toUpperSafe(data.incidencia_estado || "N/A")) + "\n\n" +
      "🔍 <b>DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.incidencia_descripcion || "N/A")) + "\n\n" +
      "🔧 <b>ACCIÓN / SOLUCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.incidencia_solucion || "EN DIAGNÓSTICO"));

    if (data.incidencia_nota) {
      notaModulo = "\n\n📝 <b>NOTA / DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.incidencia_nota));
    }

  } else if (tipo === "INVENTARIO") {
    titulo = "📦 <b>[MOVIMIENTO DE INVENTARIO]</b>";
    tags += " #INVENTARIO #STOCK";

    cuerpo =
      "🔄 <b>TIPO MOVIMIENTO:</b> " + escapeHtml(toUpperSafe(data.inv_tipo_mov || "N/A")) + "\n" +
      "📂 <b>CATEGORÍA:</b> " + escapeHtml(toUpperSafe(data.inv_categoria || "N/A")) + "\n" +
      "🏷️ <b>ARTÍCULO:</b> " + escapeHtml(toUpperSafe(data.inv_articulo || "N/A")) + "\n" +
      "🔢 <b>CANTIDAD:</b> " + escapeHtml(toUpperSafe(data.inv_cantidad || "0")) + "\n" +
      "📍 <b>UBICACIÓN / GALPÓN:</b> " + escapeHtml(toUpperSafe(data.inv_ubicacion || "N/A")) + "\n" +
      "📝 <b>MOTIVO:</b> " + escapeHtml(toUpperSafe(data.inv_motivo || "N/A"));

    if (data.inv_nota) {
      notaModulo = "\n\n📝 <b>NOTA / DESCRIPCIÓN:</b>\n" + escapeHtml(toUpperSafe(data.inv_nota));
    }
  }

  var msg =
    "🌾 " + titulo + "\n" +
    "🏢 <b>SEDE:</b> " + sede + "\n" +
    "──────────────────────────────\n" +
    "📅 <b>FECHA/HORA:</b> " + fechaDisplay + "\n" +
    "👤 <b>REGISTRADO POR:</b> " + responsable + "\n" +
    "──────────────────────────────\n" +
    cuerpo +
    notaModulo +
    driveLink + "\n" +
    "──────────────────────────────\n" +
    "🔍 <b>FILTROS:</b> " + tags;

  return msg;
}

function escapeMarkdown(text) {
  return escapeHtml(text);
}

// =============================================================================
// 5. REGISTRO EN GOOGLE SHEETS (MULTIPESTAÑA AUTOMÁTICA)
// =============================================================================

function getOrCreateSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
    } catch (e) {
      Logger.log("No se pudo abrir Spreadsheet por ID: " + e.toString());
    }
  }

  // Si está vinculado como script de hoja
  try {
    var activeSheet = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSheet) return activeSheet;
  } catch (e) { }

  // Buscar o crear por nombre
  var nombreLibro = "CONTROL Y REPORTES - EL BOTALÓN";
  var archivos = DriveApp.getFilesByName(nombreLibro);
  if (archivos.hasNext()) {
    var file = archivos.next();
    return SpreadsheetApp.open(file);
  } else {
    var nuevo = SpreadsheetApp.create(nombreLibro);
    return nuevo;
  }
}

function toUpperSafe(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.toUpperCase().trim();
  return val;
}

function registrarEnGoogleSheet(data, tipo, nombrePestana) {
  var ss = getOrCreateSpreadsheet();
  if (!ss) return false;

  var sheet = ss.getSheetByName(nombrePestana);

  // Definición de columnas según el módulo (EN MAYÚSCULAS)
  var headers = [];
  var rowValues = [];
  var fechaReg = new Date();

  if (tipo === "CONTROL_HOJAS") {
    headers = ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "GALPÓN / DESTINO", "TIPO DE HOJA", "UNIDAD", "CANTIDAD", "NOTA / DESCRIPCIÓN", "FOTOS DRIVE"];
    rowValues = [
      fechaReg,
      toUpperSafe(data.fecha),
      toUpperSafe(data.responsable),
      toUpperSafe(data.sede),
      toUpperSafe(data.hojas_area),
      toUpperSafe(data.hojas_tipo),
      toUpperSafe(data.hojas_unidad),
      toUpperSafe(data.hojas_cantidad),
      toUpperSafe(data.hojas_nota),
      data.drive_url || ""
    ];
  } else if (tipo === "TRASLADOS_ENVIOS") {
    headers = ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "TIPO MOVIMIENTO", "N° GUÍA/CONTROL", "ORIGEN", "DESTINO", "DESCRIPCIÓN ARTÍCULOS", "NOTA / OBSERVACIÓN", "FOTOS DRIVE"];
    rowValues = [
      fechaReg,
      toUpperSafe(data.fecha),
      toUpperSafe(data.responsable),
      toUpperSafe(data.sede),
      toUpperSafe(data.traslado_tipo),
      toUpperSafe(data.traslado_guia),
      toUpperSafe(data.traslado_origen),
      toUpperSafe(data.traslado_destino),
      toUpperSafe(data.traslado_descripcion),
      toUpperSafe(data.traslado_nota),
      data.drive_url || ""
    ];
  } else if (tipo === "REPORTE_SOPORTE") {
    headers = ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "TURNO", "ESTADO SISTEMAS", "ACTIVIDADES REALIZADAS", "NOTA / DESCRIPCIÓN", "FOTOS DRIVE"];
    rowValues = [
      fechaReg,
      toUpperSafe(data.fecha),
      toUpperSafe(data.responsable),
      toUpperSafe(data.sede),
      toUpperSafe(data.soporte_turno),
      toUpperSafe(data.soporte_estado_sistemas),
      toUpperSafe(data.soporte_actividades),
      toUpperSafe(data.soporte_nota),
      data.drive_url || ""
    ];
  } else if (tipo === "INCIDENCIAS") {
    headers = ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "PRIORIDAD", "CATEGORÍA", "GALPÓN / AFECTADO", "ESTADO", "DESCRIPCIÓN", "ACCIÓN/SOLUCIÓN", "NOTA / OBSERVACIÓN", "FOTOS DRIVE"];
    rowValues = [
      fechaReg,
      toUpperSafe(data.fecha),
      toUpperSafe(data.responsable),
      toUpperSafe(data.sede),
      toUpperSafe(data.incidencia_prioridad),
      toUpperSafe(data.incidencia_categoria),
      toUpperSafe(data.incidencia_area),
      toUpperSafe(data.incidencia_estado),
      toUpperSafe(data.incidencia_descripcion),
      toUpperSafe(data.incidencia_solucion),
      toUpperSafe(data.incidencia_nota),
      data.drive_url || ""
    ];
  } else if (tipo === "INVENTARIO") {
    headers = ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "TIPO MOVIMIENTO", "CATEGORÍA", "ARTÍCULO", "CANTIDAD", "UBICACIÓN / GALPÓN", "MOTIVO / USO", "NOTA / DESCRIPCIÓN", "FOTOS DRIVE"];
    rowValues = [
      fechaReg,
      toUpperSafe(data.fecha),
      toUpperSafe(data.responsable),
      toUpperSafe(data.sede),
      toUpperSafe(data.inv_tipo_mov),
      toUpperSafe(data.inv_categoria),
      toUpperSafe(data.inv_articulo),
      toUpperSafe(data.inv_cantidad),
      toUpperSafe(data.inv_ubicacion),
      toUpperSafe(data.inv_motivo),
      toUpperSafe(data.inv_nota),
      data.drive_url || ""
    ];
  }

  // Crear pestaña si no existe
  if (!sheet) {
    sheet = ss.insertSheet(nombrePestana);
    sheet.appendRow(headers);
    // Dar formato a los encabezados
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#1a56db");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  // Insertar la fila de datos
  sheet.appendRow(rowValues);
  return true;
}

// =============================================================================
// 6. ENVIOS A TELEGRAM API
// =============================================================================

function sendTelegramMessage(texto, chatId, topicId) {
  var url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";

  var payload = {
    chat_id: chatId,
    text: texto,
    parse_mode: "HTML"
  };

  if (topicId && topicId > 0) {
    payload.message_thread_id = parseInt(topicId);
  }

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  return response.getContentText();
}

function sendTelegramPhotos(imagenes, chatId, topicId, replyId) {
  var url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendPhoto";

  for (var i = 0; i < imagenes.length; i++) {
    try {
      var imgData = imagenes[i];
      if (!imgData || !imgData.base64) continue;

      var blob = Utilities.newBlob(
        Utilities.base64Decode(imgData.base64),
        imgData.mimeType || "image/jpeg",
        imgData.name || ("foto_" + (i + 1) + ".jpg")
      );

      var payload = {
        chat_id: chatId,
        photo: blob,
        reply_to_message_id: replyId
      };

      if (topicId && topicId > 0) {
        payload.message_thread_id = parseInt(topicId);
      }

      var options = {
        method: "post",
        payload: payload,
        muteHttpExceptions: true
      };

      UrlFetchApp.fetch(url, options);
    } catch (e) {
      Logger.log("Error al enviar foto " + i + ": " + e.toString());
    }
  }
}

// =============================================================================
// 7. RESPALDO DE FOTOS EN GOOGLE DRIVE
// =============================================================================

function guardarEnGoogleDrive(data, tipo) {
  if (!data || !data.imagenes || data.imagenes.length === 0) return "";

  var rootFolder;
  if (DRIVE_FOLDER_ID && DRIVE_FOLDER_ID.trim() !== "") {
    try {
      rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID.trim());
    } catch (errDrive) {
      Logger.log("Carpeta no encontrada por ID: " + errDrive.toString());
    }
  }

  if (!rootFolder) {
    var nombreCarpetaRaiz = "REPORTES EL BOTALÓN";
    var parentFolders = DriveApp.getFoldersByName(nombreCarpetaRaiz);
    if (parentFolders.hasNext()) {
      rootFolder = parentFolders.next();
    } else {
      rootFolder = DriveApp.createFolder(nombreCarpetaRaiz);
    }
  }

  var fechaStr = (data.fecha || "").replace(/[^0-9]/g, "").slice(0, 8);
  var folderName = tipo + " - " + (data.responsable || "REPORTE") + " (" + (fechaStr || "HOY") + ")";

  var subFolder = rootFolder.createFolder(folderName);

  for (var i = 0; i < data.imagenes.length; i++) {
    try {
      var imgObj = data.imagenes[i];
      if (!imgObj || !imgObj.base64) continue;
      var blob = Utilities.newBlob(
        Utilities.base64Decode(imgObj.base64),
        imgObj.mimeType || "image/jpeg",
        imgObj.name || ("evidencia_" + (i + 1) + ".jpg")
      );
      subFolder.createFile(blob);
    } catch (errFoto) {
      Logger.log("Error guardando foto " + i + ": " + errFoto.toString());
    }
  }

  return subFolder.getUrl();
}

// =============================================================================
// 8. FUNCIÓN DE PRUEBA DIRECTA
// =============================================================================

function probarReporteHojas() {
  var testData = {
    tipo_reporte: "CONTROL_HOJAS",
    fecha: "2026-11-09T14:30",
    responsable: "JESUS PICHARDO",
    sede: "ARAURE",
    hojas_area: "GALPÓN 1",
    hojas_tipo: "HOJA BLANCA CARTA",
    hojas_unidad: "RESMAS",
    hojas_cantidad: "3",
    hojas_nota: "ENTREGA DE PAPEL PARA CONTROL OPERATIVO DEL GALPÓN 1"
  };

  var configDestino = CONFIG_DESTINOS["CONTROL_HOJAS"];
  registrarEnGoogleSheet(testData, "CONTROL_HOJAS", configDestino.sheetName);
  var msg = buildMessage(testData, "CONTROL_HOJAS");
  var res = sendTelegramMessage(msg, configDestino.chatId, configDestino.topicId);
  Logger.log("Resultado Telegram: " + res);
}

// =============================================================================
// 9. FUNCIÓN AUTOMÁTICA PARA CREAR TODAS LAS PESTAÑAS Y DASHBOARD DE UN SOLO CLIC
// =============================================================================

function crearEstructuraCompletaDeGoogleSheets() {
  var ss = getOrCreateSpreadsheet();
  if (!ss) {
    Logger.log("❌ ERROR: NO SE PUDO ABRIR LA HOJA DE GOOGLE SHEETS.");
    return;
  }

  var pestanas = [
    {
      nombre: "CONTROL HOJAS",
      color: "#1a56db",
      headers: ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "GALPÓN / DESTINO", "TIPO DE HOJA", "UNIDAD", "CANTIDAD", "NOTA / DESCRIPCIÓN", "FOTOS DRIVE"]
    },
    {
      nombre: "TRASLADOS Y ENVÍOS",
      color: "#0891b2",
      headers: ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "TIPO MOVIMIENTO", "N° GUÍA/CONTROL", "ORIGEN", "DESTINO", "DESCRIPCIÓN ARTÍCULOS", "NOTA / OBSERVACIÓN", "FOTOS DRIVE"]
    },
    {
      nombre: "SOPORTE DIARIO",
      color: "#059669",
      headers: ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "TURNO", "ESTADO SISTEMAS", "ACTIVIDADES REALIZADAS", "NOTA / DESCRIPCIÓN", "FOTOS DRIVE"]
    },
    {
      nombre: "INCIDENCIAS",
      color: "#dc2626",
      headers: ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "PRIORIDAD", "CATEGORÍA", "GALPÓN / AFECTADO", "ESTADO", "DESCRIPCIÓN", "ACCIÓN/SOLUCIÓN", "NOTA / OBSERVACIÓN", "FOTOS DRIVE"]
    },
    {
      nombre: "INVENTARIO",
      color: "#7c3aed",
      headers: ["MARCA TEMPORAL", "FECHA/HORA REPORTE", "REGISTRADO POR", "SEDE", "TIPO MOVIMIENTO", "CATEGORÍA", "ARTÍCULO", "CANTIDAD", "UBICACIÓN / GALPÓN", "MOTIVO / USO", "NOTA / DESCRIPCIÓN", "FOTOS DRIVE"]
    }
  ];

  for (var i = 0; i < pestanas.length; i++) {
    var item = pestanas[i];
    var sheet = ss.getSheetByName(item.nombre);
    if (!sheet) {
      sheet = ss.insertSheet(item.nombre);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(item.headers);
    }
    var range = sheet.getRange(1, 1, 1, item.headers.length);
    range.setBackground(item.color);
    range.setFontColor("#ffffff");
    range.setFontWeight("bold");
    range.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }

  // CREAR PESTAÑA DASHBOARD RESUMEN
  var sheetDash = ss.getSheetByName("DASHBOARD");
  if (!sheetDash) {
    sheetDash = ss.insertSheet("DASHBOARD", 0);
  }

  if (sheetDash.getLastRow() === 0) {
    sheetDash.getRange("A1:D1").merge().setValue("🌾 DASHBOARD GENERAL - EL BOTALÓN")
      .setBackground("#111827").setFontColor("#ffffff").setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center");

    sheetDash.getRange("A3:B3").merge().setValue("📄 CONTROL DE HOJAS").setBackground("#1a56db").setFontColor("#ffffff").setFontWeight("bold");
    sheetDash.getRange("A4").setValue("TOTAL RESMAS DESPACHADAS:");
    sheetDash.getRange("B4").setFormula("=SUMIF('CONTROL HOJAS'!G2:G, \"*RESMA*\", 'CONTROL HOJAS'!H2:H)");
    sheetDash.getRange("A5").setValue("TOTAL DESPACHOS REGISTRADOS:");
    sheetDash.getRange("B5").setFormula("=COUNTA('CONTROL HOJAS'!A2:A)");

    sheetDash.getRange("A7:B7").merge().setValue("⚠️ INCIDENCIAS Y AVERÍAS").setBackground("#dc2626").setFontColor("#ffffff").setFontWeight("bold");
    sheetDash.getRange("A8").setValue("INCIDENCIAS ABIERTAS / EN PROCESO:");
    sheetDash.getRange("B8").setFormula("=COUNTIF('INCIDENCIAS'!H2:H, \"*ABIERTA*\")");
    sheetDash.getRange("A9").setValue("INCIDENCIAS RESUELTAS:");
    sheetDash.getRange("B9").setFormula("=COUNTIF('INCIDENCIAS'!H2:H, \"*RESUELTA*\")");
    sheetDash.getRange("A10").setValue("TOTAL INCIDENCIAS REGISTRADAS:");
    sheetDash.getRange("B10").setFormula("=COUNTA('INCIDENCIAS'!A2:A)");

    sheetDash.getRange("A12:B12").merge().setValue("📦 INVENTARIO Y MOVIMIENTOS").setBackground("#7c3aed").setFontColor("#ffffff").setFontWeight("bold");
    sheetDash.getRange("A13").setValue("TOTAL ENTRADAS / RECEPCIÓN:");
    sheetDash.getRange("B13").setFormula("=COUNTIF('INVENTARIO'!E2:E, \"*ENTRADA*\")");
    sheetDash.getRange("A14").setValue("TOTAL SALIDAS / DESPACHO:");
    sheetDash.getRange("B14").setFormula("=COUNTIF('INVENTARIO'!E2:E, \"*SALIDA*\")");

    sheetDash.getRange("A16:B16").merge().setValue("🚚 TRASLADOS Y ENVÍOS").setBackground("#0891b2").setFontColor("#ffffff").setFontWeight("bold");
    sheetDash.getRange("A17").setValue("TOTAL TRASLADOS REALIZADOS:");
    sheetDash.getRange("B17").setFormula("=COUNTA('TRASLADOS Y ENVÍOS'!A2:A)");

    sheetDash.getRange("A19:B19").merge().setValue("🛠️ SOPORTE TÉCNICO DIARIO").setBackground("#059669").setFontColor("#ffffff").setFontWeight("bold");
    sheetDash.getRange("A20").setValue("TOTAL JORNADAS REGISTRADAS:");
    sheetDash.getRange("B20").setFormula("=COUNTA('SOPORTE DIARIO'!A2:A)");

    sheetDash.setColumnWidth(1, 320);
    sheetDash.setColumnWidth(2, 120);
    sheetDash.getRange("B4:B20").setFontWeight("bold").setHorizontalAlignment("center");
  }

  Logger.log("✅ TODAS LAS PESTAÑAS Y EL DASHBOARD HAN SIDO CREADOS CON ÉXITO EN TU GOOGLE SHEETS: " + ss.getUrl());
}
