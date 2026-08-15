const SPREADSHEET_ID =
  "1-5gZyFmGaE042r5wJEikPG2ixkbFCFWnYQiMnHHy12w";

const CONFIG_HOJAS = {
  Super: {
    campoClave: "Producto",
    prefijo: "S"
  },
  Pagos: {
    campoClave: "Servicio",
    prefijo: "P"
  },
  Ingresos: {
    campoClave: "Concepto",
    prefijo: "I"
  }
};

function doGet() {
  return respuestaJSON({
    ok: true,
    mensaje: "Finanzas IA Google Sheets activo"
  });
}

function doPost(e) {
  try {
    const datos = JSON.parse(
      e.postData.contents || "{}"
    );

    verificarSecreto(datos.secret);

    const accion =
      datos.action || "registrar";

    if (accion === "registrar") {
      return respuestaJSON(
        registrar(datos.sheet, datos.data)
      );
    }

    if (accion === "buscar_eliminar") {
      return respuestaJSON(
        buscarParaEliminar(
          datos.sheet,
          datos.buscar
        )
      );
    }

    if (accion === "eliminar") {
      return respuestaJSON(
        eliminarRegistro(
          datos.sheet,
          datos.fila,
          datos.esperado
        )
      );
    }

    if (accion === "reporte") {
      actualizarReporteMensual();

      return respuestaJSON(
        obtenerReporte(datos.mes)
      );
    }

    if (accion === "actualizar_reporte") {
      actualizarReporteMensual();

      return respuestaJSON({
        ok: true,
        mensaje: "Reporte actualizado"
      });
    }

    throw new Error(
      `Acción no reconocida: ${accion}`
    );

  } catch (error) {
    return respuestaJSON({
      ok: false,
      error: error.message
    });
  }
}

function verificarSecreto(
  secretoRecibido
) {
  const secretoGuardado =
    PropertiesService
      .getScriptProperties()
      .getProperty("API_SECRET");

  if (!secretoGuardado) {
    throw new Error(
      "Falta configurar API_SECRET."
    );
  }

  if (
    secretoRecibido !==
    secretoGuardado
  ) {
    throw new Error(
      "Acceso no autorizado."
    );
  }
}

function registrar(
  nombreHoja,
  datos
) {
  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    if (!nombreHoja) {
      throw new Error(
        "Falta indicar la hoja."
      );
    }

    if (
      !datos ||
      typeof datos !== "object"
    ) {
      throw new Error(
        "Faltan los datos."
      );
    }

    const config =
      CONFIG_HOJAS[nombreHoja];

    if (!config) {
      throw new Error(
        `La hoja "${nombreHoja}" no está configurada.`
      );
    }

    const archivo =
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    const hoja =
      archivo.getSheetByName(
        nombreHoja
      );

    if (!hoja) {
      throw new Error(
        `No existe la hoja "${nombreHoja}".`
      );
    }

    const encabezados =
      obtenerEncabezados(hoja);

    const valorClave =
      String(
        datos[config.campoClave] || ""
      ).trim();

    if (!valorClave) {
      throw new Error(
        `Falta "${config.campoClave}".`
      );
    }

    const id =
      obtenerIdPermanente(
        nombreHoja,
        hoja,
        encabezados,
        config,
        valorClave
      );

    const datosFinales = {
      ...datos,
      ID: id
    };

    const nuevaFila =
      encabezados.map(
        encabezado =>
          prepararValor(
            encabezado,
            datosFinales[encabezado]
          )
      );

    hoja.appendRow(nuevaFila);

    actualizarReporteMensual();

    return {
      ok: true,
      hoja: nombreHoja,
      id: id,
      fila: hoja.getLastRow()
    };

  } finally {
    lock.releaseLock();
  }
}

function obtenerIdPermanente(
  nombreHoja,
  hoja,
  encabezados,
  config,
  valorClave
) {
  const properties =
    PropertiesService
      .getScriptProperties();

  const nombrePropiedad =
    `ID_MAP_${nombreHoja.toUpperCase()}`;

  let mapa = {};

  try {
    mapa = JSON.parse(
      properties.getProperty(
        nombrePropiedad
      ) || "{}"
    );
  } catch {
    mapa = {};
  }

  const columnaId =
    encabezados.indexOf("ID");

  const columnaClave =
    encabezados.indexOf(
      config.campoClave
    );

  if (
    columnaId === -1 ||
    columnaClave === -1
  ) {
    throw new Error(
      "Faltan columnas necesarias para los ID."
    );
  }

  const ultimaFila =
    hoja.getLastRow();

  if (ultimaFila > 1) {
    const registros =
      hoja.getRange(
        2,
        1,
        ultimaFila - 1,
        encabezados.length
      ).getDisplayValues();

    registros.forEach(fila => {
      const clave =
        normalizarTexto(
          fila[columnaClave]
        );

      const id =
        String(
          fila[columnaId] || ""
        ).trim();

      if (
        clave &&
        id &&
        !mapa[clave]
      ) {
        mapa[clave] = id;
      }
    });
  }

  const claveNueva =
    normalizarTexto(valorClave);

  if (mapa[claveNueva]) {
    properties.setProperty(
      nombrePropiedad,
      JSON.stringify(mapa)
    );

    return mapa[claveNueva];
  }

  let mayor = 0;

  Object.values(mapa)
    .forEach(id => {
      const numero =
        extraerNumeroId(
          id,
          config.prefijo
        );

      if (numero > mayor) {
        mayor = numero;
      }
    });

  if (ultimaFila > 1) {
    const ids =
      hoja.getRange(
        2,
        columnaId + 1,
        ultimaFila - 1,
        1
      ).getDisplayValues().flat();

    ids.forEach(id => {
      const numero =
        extraerNumeroId(
          id,
          config.prefijo
        );

      if (numero > mayor) {
        mayor = numero;
      }
    });
  }

  const siguiente =
    mayor + 1;

  const nuevoId =
    `${config.prefijo}-${String(
      siguiente
    ).padStart(2, "0")}`;

  mapa[claveNueva] =
    nuevoId;

  properties.setProperty(
    nombrePropiedad,
    JSON.stringify(mapa)
  );

  return nuevoId;
}

function extraerNumeroId(
  id,
  prefijo
) {
  const patron =
    new RegExp(
      `^${prefijo}-(\\d+)$`,
      "i"
    );

  const coincidencia =
    String(id || "")
      .trim()
      .match(patron);

  if (!coincidencia) {
    return 0;
  }

  return Number(
    coincidencia[1]
  );
}

function buscarParaEliminar(
  nombreHoja,
  buscar
) {
  if (!CONFIG_HOJAS[nombreHoja]) {
    throw new Error(
      "Solo se pueden eliminar registros de Super, Pagos o Ingresos."
    );
  }

  const archivo =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );

  const hoja =
    archivo.getSheetByName(
      nombreHoja
    );

  if (!hoja) {
    throw new Error(
      `No existe la hoja "${nombreHoja}".`
    );
  }

  const encabezados =
    obtenerEncabezados(hoja);

  const config =
    CONFIG_HOJAS[nombreHoja];

  const indiceClave =
    encabezados.indexOf(
      config.campoClave
    );

  const indiceId =
    encabezados.indexOf("ID");

  const ultimaFila =
    hoja.getLastRow();

  if (ultimaFila <= 1) {
    return {
      ok: true,
      coincidencias: []
    };
  }

  const registros =
    hoja.getRange(
      2,
      1,
      ultimaFila - 1,
      encabezados.length
    ).getDisplayValues();

  const buscado =
    normalizarTexto(buscar);

  let encontrados =
    registros
      .map((fila, indice) => ({
        fila: indice + 2,
        valores: fila
      }))
      .filter(item => {
        const clave =
          normalizarTexto(
            item.valores[
              indiceClave
            ]
          );

        const id =
          normalizarTexto(
            item.valores[
              indiceId
            ]
          );

        return (
          clave === buscado ||
          id === buscado
        );
      });

  if (
    encontrados.length === 0
  ) {
    encontrados =
      registros
        .map((fila, indice) => ({
          fila: indice + 2,
          valores: fila
        }))
        .filter(item => {
          const clave =
            normalizarTexto(
              item.valores[
                indiceClave
              ]
            );

          return clave.includes(
            buscado
          );
        });
  }

  const coincidencias =
    encontrados.map(item => {
      const registro = {};

      encabezados.forEach(
        (encabezado, indice) => {
          registro[encabezado] =
            item.valores[indice];
        }
      );

      return {
        fila: item.fila,
        data: registro
      };
    });

  return {
    ok: true,
    hoja: nombreHoja,
    coincidencias
  };
}

function eliminarRegistro(
  nombreHoja,
  numeroFila,
  esperado
) {
  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    if (!CONFIG_HOJAS[nombreHoja]) {
      throw new Error(
        "Hoja no válida para eliminar."
      );
    }

    const fila =
      Number(numeroFila);

    if (
      !Number.isInteger(fila) ||
      fila < 2
    ) {
      throw new Error(
        "Fila no válida."
      );
    }

    const archivo =
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );

    const hoja =
      archivo.getSheetByName(
        nombreHoja
      );

    if (
      !hoja ||
      fila > hoja.getLastRow()
    ) {
      throw new Error(
        "El registro ya no existe."
      );
    }

    const encabezados =
      obtenerEncabezados(hoja);

    const valores =
      hoja.getRange(
        fila,
        1,
        1,
        encabezados.length
      ).getDisplayValues()[0];

    const actual = {};

    encabezados.forEach(
      (encabezado, indice) => {
        actual[encabezado] =
          valores[indice];
      }
    );

    if (
      esperado &&
      typeof esperado === "object"
    ) {
      for (
        const encabezado
        of encabezados
      ) {
        const a =
          normalizarComparacion(
            actual[encabezado]
          );

        const b =
          normalizarComparacion(
            esperado[encabezado]
          );

        if (a !== b) {
          throw new Error(
            "El registro cambió antes de eliminarse. Vuelve a buscarlo."
          );
        }
      }
    }

    hoja.deleteRow(fila);

    actualizarReporteMensual();

    return {
      ok: true,
      eliminado: actual
    };

  } finally {
    lock.releaseLock();
  }
}

function actualizarReporteMensual() {
  const archivo =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );

  const hojaReporte =
    archivo.getSheetByName(
      "Reporte mensual"
    );

  if (!hojaReporte) {
    return;
  }

  const resumen = {};

  function asegurarMes(clave) {
    if (!resumen[clave]) {
      resumen[clave] = {
        ingresos: 0,
        pagos: 0,
        super: 0,
        pendientes: 0
      };
    }

    return resumen[clave];
  }

  procesarIngresos(
    archivo,
    asegurarMes
  );

  procesarPagos(
    archivo,
    asegurarMes
  );

  procesarSuper(
    archivo,
    asegurarMes
  );

  const encabezados = [
    "Mes",
    "Ingresos",
    "Pagos realizados",
    "Súper comprado",
    "Gastos totales",
    "Saldo",
    "Pagos pendientes"
  ];

  hojaReporte
    .getRange(
      1,
      1,
      1,
      encabezados.length
    )
    .setValues([
      encabezados
    ]);

  const ultimaFila =
    hojaReporte.getLastRow();

  if (ultimaFila > 1) {
    hojaReporte
      .getRange(
        2,
        1,
        ultimaFila - 1,
        encabezados.length
      )
      .clearContent();
  }

  const meses =
    Object.keys(resumen).sort();

  if (meses.length === 0) {
    return;
  }

  const filas =
    meses.map(clave => {
      const mes =
        resumen[clave];

      const gastos =
        mes.pagos +
        mes.super;

      const saldo =
        mes.ingresos -
        gastos;

      return [
        nombreMes(clave),
        mes.ingresos,
        mes.pagos,
        mes.super,
        gastos,
        saldo,
        mes.pendientes
      ];
    });

  hojaReporte
    .getRange(
      2,
      1,
      filas.length,
      encabezados.length
    )
    .setValues(filas);
}

function procesarIngresos(
  archivo,
  asegurarMes
) {
  const hoja =
    archivo.getSheetByName(
      "Ingresos"
    );

  if (!hoja) return;

  const registros =
    obtenerRegistros(hoja);

  registros.forEach(registro => {
    const clave =
      obtenerClaveMes(
        registro.Fecha
      );

    if (!clave) return;

    asegurarMes(clave)
      .ingresos +=
        numeroDesdeValor(
          registro.Monto
        );
  });
}

function procesarPagos(
  archivo,
  asegurarMes
) {
  const hoja =
    archivo.getSheetByName(
      "Pagos"
    );

  if (!hoja) return;

  const registros =
    obtenerRegistros(hoja);

  registros.forEach(registro => {
    const clave =
      obtenerClaveMes(
        registro.Fecha
      );

    if (!clave) return;

    const monto =
      numeroDesdeValor(
        registro.Monto
      );

    const estado =
      normalizarTexto(
        registro.Estado
      );

    if (
      estado === "pagado" ||
      estado === "pagada"
    ) {
      asegurarMes(clave)
        .pagos += monto;
    }

    if (
      estado === "pendiente" ||
      estado === "por pagar" ||
      estado === "pendiente de pago"
    ) {
      asegurarMes(clave)
        .pendientes += monto;
    }
  });
}

function procesarSuper(
  archivo,
  asegurarMes
) {
  const hoja =
    archivo.getSheetByName(
      "Super"
    );

  if (!hoja) return;

  const registros =
    obtenerRegistros(hoja);

  registros.forEach(registro => {
    const clave =
      obtenerClaveMes(
        registro.Fecha
      );

    if (!clave) return;

    const estado =
      normalizarTexto(
        registro.Estado
      );

    if (
      estado === "comprado" ||
      estado === "comprada"
    ) {
      asegurarMes(clave)
        .super +=
          numeroDesdeValor(
            registro.Costo
          );
    }
  });
}

function obtenerReporte(mesSolicitado) {
  const archivo =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );

  const hoja =
    archivo.getSheetByName(
      "Reporte mensual"
    );

  if (!hoja) {
    throw new Error(
      'No existe "Reporte mensual".'
    );
  }

  const registros =
    obtenerRegistros(hoja);

  if (
    !mesSolicitado ||
    String(mesSolicitado).trim() === ""
  ) {
    return {
      ok: true,
      reportes: registros
    };
  }

  const buscado =
    normalizarTexto(
      mesSolicitado
    );

  const encontrados =
    registros.filter(
      registro =>
        normalizarTexto(
          registro.Mes
        ).includes(buscado)
    );

  return {
    ok: true,
    reportes: encontrados
  };
}

function obtenerRegistros(hoja) {
  const ultimaFila =
    hoja.getLastRow();

  const encabezados =
    obtenerEncabezados(hoja);

  if (ultimaFila <= 1) {
    return [];
  }

  const valores =
    hoja.getRange(
      2,
      1,
      ultimaFila - 1,
      encabezados.length
    ).getValues();

  return valores.map(fila => {
    const registro = {};

    encabezados.forEach(
      (encabezado, indice) => {
        registro[encabezado] =
          fila[indice];
      }
    );

    return registro;
  });
}

function obtenerEncabezados(hoja) {
  const ultimaColumna =
    hoja.getLastColumn();

  if (ultimaColumna === 0) {
    throw new Error(
      `La hoja "${hoja.getName()}" no tiene encabezados.`
    );
  }

  return hoja
    .getRange(
      1,
      1,
      1,
      ultimaColumna
    )
    .getDisplayValues()[0]
    .map(
      valor =>
        String(valor).trim()
    );
}

function prepararValor(
  encabezado,
  valor
) {
  if (
    valor === undefined ||
    valor === null
  ) {
    return "";
  }

  if (
    encabezado === "Monto" ||
    encabezado === "Costo"
  ) {
    return numeroDesdeValor(valor);
  }

  if (
    encabezado === "Cantidad"
  ) {
    const numero =
      numeroDesdeValor(valor);

    return Number.isNaN(numero)
      ? valor
      : numero;
  }

  return valor;
}

function numeroDesdeValor(valor) {
  if (
    typeof valor === "number"
  ) {
    return valor;
  }

  let texto =
    String(valor || "")
      .trim()
      .replace(/\s/g, "")
      .replace(/MXN/gi, "")
      .replace(/\$/g, "");

  if (!texto) {
    return 0;
  }

  texto =
    texto.replace(
      /[^0-9,.\-]/g,
      ""
    );

  if (
    texto.includes(",") &&
    texto.includes(".")
  ) {
    if (
      texto.lastIndexOf(".") >
      texto.lastIndexOf(",")
    ) {
      texto =
        texto.replace(/,/g, "");
    } else {
      texto =
        texto.replace(/\./g, "")
          .replace(",", ".");
    }
  } else if (
    texto.includes(",")
  ) {
    const partes =
      texto.split(",");

    if (
      partes.length === 2 &&
      partes[1].length <= 2
    ) {
      texto =
        partes[0] +
        "." +
        partes[1];
    } else {
      texto =
        texto.replace(/,/g, "");
    }
  }

  const numero =
    Number(texto);

  return Number.isFinite(numero)
    ? numero
    : 0;
}

function obtenerClaveMes(valor) {
  if (
    valor instanceof Date &&
    !isNaN(valor)
  ) {
    return Utilities.formatDate(
      valor,
      Session.getScriptTimeZone(),
      "yyyy-MM"
    );
  }

  const texto =
    String(valor || "").trim();

  let coincidencia =
    texto.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

  if (coincidencia) {
    return (
      coincidencia[3] +
      "-" +
      String(
        coincidencia[2]
      ).padStart(2, "0")
    );
  }

  coincidencia =
    texto.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

  if (coincidencia) {
    return (
      coincidencia[1] +
      "-" +
      String(
        coincidencia[2]
      ).padStart(2, "0")
    );
  }

  return null;
}

function nombreMes(clave) {
  const partes =
    clave.split("-");

  const año =
    Number(partes[0]);

  const mes =
    Number(partes[1]);

  const nombres = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
  ];

  return (
    `${nombres[mes - 1]} ${año}`
  );
}

function normalizarTexto(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}

function normalizarComparacion(
  valor
) {
  return String(
    valor === undefined ||
    valor === null
      ? ""
      : valor
  ).trim();
}

function respuestaJSON(objeto) {
  return ContentService
    .createTextOutput(
      JSON.stringify(objeto)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}
