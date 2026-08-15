const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN =
  process.env.VERIFY_TOKEN || "finanzas-ia-token";

const WHATSAPP_TOKEN =
  process.env.WHATSAPP_TOKEN;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL;

const APPS_SCRIPT_SECRET =
  process.env.APPS_SCRIPT_SECRET;

const WABA_ID = "1363654319277230";
const PHONE_NUMBER_ID = "1327077313815752";

const mensajesProcesados = new Set();
const sesiones = new Map();

const CAMPOS_REQUERIDOS = {
  Super: [
    "Producto",
    "Fecha",
    "Cantidad",
    "Costo",
    "Estado"
  ],

  Pagos: [
    "Servicio",
    "Fecha",
    "Monto",
    "Notas",
    "Estado"
  ],

  Ingresos: [
    "Concepto",
    "Fecha",
    "Monto"
  ]
};

function estaVacio(valor) {
  return (
    valor === undefined ||
    valor === null ||
    String(valor).trim() === ""
  );
}

function normalizar(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function siguienteCampoFaltante(
  sheet,
  data
) {
  const campos =
    CAMPOS_REQUERIDOS[sheet] || [];

  return campos.find(
    campo =>
      estaVacio(data[campo])
  );
}

function obtenerPregunta(
  sheet,
  campo,
  data
) {
  if (campo === "Fecha") {
    return "¿Qué fecha le pongo?";
  }

  if (sheet === "Super") {
    if (campo === "Cantidad") {
      return `¿Qué cantidad de ${data.Producto} quieres registrar?`;
    }

    if (campo === "Costo") {
      return `¿Cuál es el costo de ${data.Producto}?`;
    }

    if (campo === "Estado") {
      return "¿Cuál es el estado? Por ejemplo: Pendiente o Comprado.";
    }
  }

  if (sheet === "Pagos") {
    if (campo === "Monto") {
      return `¿Cuál es el monto de ${data.Servicio}?`;
    }

    if (campo === "Notas") {
      return '¿Qué nota quieres agregar? Si no necesitas una, responde "sin notas".';
    }

    if (campo === "Estado") {
      return "¿Cuál es el estado del pago? Por ejemplo: Pendiente, Por pagar o Pagado.";
    }
  }

  if (
    sheet === "Ingresos" &&
    campo === "Monto"
  ) {
    return `¿Cuál es el monto de ${data.Concepto}?`;
  }

  return `¿Cuál es el valor de ${campo}?`;
}

function fechaActualMexico() {
  return new Intl.DateTimeFormat(
    "es-MX",
    {
      timeZone:
        "America/Mexico_City",

      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  ).format(new Date());
}

function mesActualMexico() {
  const texto =
    new Intl.DateTimeFormat(
      "es-MX",
      {
        timeZone:
          "America/Mexico_City",

        month: "long",
        year: "numeric"
      }
    ).format(new Date());

  return (
    texto.charAt(0).toUpperCase() +
    texto.slice(1)
  );
}

function formatearDinero(valor) {
  let numero = valor;

  if (
    typeof numero !== "number"
  ) {
    numero =
      Number(
        String(valor || "")
          .replace(
            /[^0-9.-]/g,
            ""
          )
      );
  }

  if (
    !Number.isFinite(numero)
  ) {
    numero = 0;
  }

  return new Intl.NumberFormat(
    "es-MX",
    {
      style: "currency",
      currency: "MXN"
    }
  ).format(numero);
}

function formatearRegistro(data) {
  return Object.entries(data)
    .map(
      ([campo, valor]) => {

        if (
          campo === "Monto" ||
          campo === "Costo"
        ) {
          return (
            `${campo}: ` +
            formatearDinero(
              valor
            )
          );
        }

        return (
          `${campo}: ${valor}`
        );
      }
    )
    .join("\n");
}

function formatearReporte(
  reporte
) {
  return [
    `📊 ${reporte.Mes}`,

    `Ingresos: ${
      formatearDinero(
        reporte.Ingresos
      )
    }`,

    `Pagos realizados: ${
      formatearDinero(
        reporte[
          "Pagos realizados"
        ]
      )
    }`,

    `Súper comprado: ${
      formatearDinero(
        reporte[
          "Súper comprado"
        ]
      )
    }`,

    `Gastos totales: ${
      formatearDinero(
        reporte[
          "Gastos totales"
        ]
      )
    }`,

    `Saldo: ${
      formatearDinero(
        reporte.Saldo
      )
    }`,

    `Pagos pendientes: ${
      formatearDinero(
        reporte[
          "Pagos pendientes"
        ]
      )
    }`
  ].join("\n");
}

async function enviarMensajeWhatsApp(
  destinatario,
  texto
) {
  const respuesta =
    await fetch(
      `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            messaging_product:
              "whatsapp",

            to:
              destinatario,

            type:
              "text",

            text: {
              body: texto
            }
          })
      }
    );

  const datos =
    await respuesta.json();

  console.log(
    "Respuesta WhatsApp:",
    datos
  );

  if (!respuesta.ok) {
    throw new Error(
      datos?.error?.message ||
      `WhatsApp respondió HTTP ${respuesta.status}`
    );
  }

  return datos;
}

function extraerJSON(texto) {
  const limpio =
    String(texto || "")
      .replace(
        /```json/gi,
        ""
      )
      .replace(
        /```/g,
        ""
      )
      .trim();

  return JSON.parse(limpio);
}

async function interpretarConGemini(
  textoUsuario,
  contextoRegistro = null
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "Falta GEMINI_API_KEY."
    );
  }

  const hoy =
    fechaActualMexico();

  const mesActual =
    mesActualMexico();

  const campoEsperado =
    contextoRegistro
      ? siguienteCampoFaltante(
          contextoRegistro.sheet,
          contextoRegistro.data
        )
      : null;

  const instrucciones = `
Eres Finanzas IA, un asistente personal privado que funciona por WhatsApp.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.
No uses markdown.
No escribas nada fuera del JSON.

Fecha actual: ${hoy}
Mes actual: ${mesActual}

HOJAS DISPONIBLES:

Super:
Producto, Fecha, Cantidad, Costo, Estado

Pagos:
Servicio, Fecha, Monto, Notas, Estado

Ingresos:
Concepto, Fecha, Monto

REGLAS PARA REGISTRAR:

- Nunca generes ID.
- Google Sheets administra y reutiliza los ID.
- No inventes ningún dato.
- No completes campos faltantes automáticamente.
- Solo usa información que el usuario haya dado.
- Si el usuario dice "hoy", usa ${hoy}.
- Si dice "sin notas", usa "Sin notas".
- No supongas Fecha.
- No supongas Cantidad.
- No supongas Costo.
- No supongas Monto.
- No supongas Notas.
- No supongas Estado.

PARA REGISTRAR:

{
  "accion": "registrar",
  "sheet": "Super",
  "data": {
    "Producto": "Arroz"
  },
  "respuesta": ""
}

PARA ELIMINAR:

Nunca confirmes tú la eliminación.
Solo identifica la hoja y qué debe buscarse.

Ejemplo:
"borra jabón del súper"

{
  "accion": "eliminar",
  "sheet": "Super",
  "buscar": "jabón",
  "respuesta": ""
}

Ejemplo:
"elimina el pago de internet"

{
  "accion": "eliminar",
  "sheet": "Pagos",
  "buscar": "internet",
  "respuesta": ""
}

Ejemplo:
"borra I-01"

{
  "accion": "eliminar",
  "sheet": "Ingresos",
  "buscar": "I-01",
  "respuesta": ""
}

PARA REPORTE MENSUAL:

Ejemplos:
"mi reporte de agosto"
"cuánto gasté este mes"
"cuánto me queda en agosto"
"reporte mensual"

Devuelve:

{
  "accion": "reporte",
  "mes": "Agosto 2026",
  "respuesta": ""
}

Si dice "este mes" o no menciona mes,
usa ${mesActual}.

Si menciona un mes pero no año,
usa el año actual.

PARA CANCELAR:

{
  "accion": "cancelar",
  "respuesta": "Operación cancelada."
}

PARA CONVERSACIÓN NORMAL:

{
  "accion": "conversar",
  "respuesta": "..."
}

SI HAY UN REGISTRO PENDIENTE:

- conserva la misma hoja;
- conserva todos los datos anteriores;
- interpreta el nuevo mensaje como respuesta al campo esperado;
- agrega solamente la nueva información;
- si el usuario corrige explícitamente un dato anterior, puedes modificarlo.
`.trim();

  let entrada;

  if (contextoRegistro) {
    entrada = `
REGISTRO PENDIENTE:

Hoja:
${contextoRegistro.sheet}

Datos actuales:
${JSON.stringify(
  contextoRegistro.data
)}

Campo esperado:
${campoEsperado}

Nuevo mensaje:
${textoUsuario}
`.trim();

  } else {
    entrada =
      textoUsuario;
  }

  const respuesta =
    await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY
        },

        body:
          JSON.stringify({
            system_instruction: {
              parts: [
                {
                  text:
                    instrucciones
                }
              ]
            },

            contents: [
              {
                role: "user",

                parts: [
                  {
                    text:
                      entrada
                  }
                ]
              }
            ],

            generationConfig: {
              responseMimeType:
                "application/json"
            }
          })
      }
    );

  const datos =
    await respuesta.json();

  if (!respuesta.ok) {
    console.error(
      "Error Gemini:",
      JSON.stringify(
        datos,
        null,
        2
      )
    );

    throw new Error(
      datos?.error?.message ||
      `Gemini respondió con HTTP ${respuesta.status}`
    );
  }

  const texto =
    datos?.candidates?.[0]
      ?.content?.parts
      ?.map(
        parte =>
          parte.text
      )
      .filter(Boolean)
      .join("\n")
      .trim();

  if (!texto) {
    throw new Error(
      "Gemini no devolvió texto."
    );
  }

  console.log(
    "JSON Gemini:",
    texto
  );

  return extraerJSON(
    texto
  );
}

function combinarDatos(
  anteriores,
  nuevos
) {
  const resultado = {
    ...anteriores
  };

  if (
    nuevos &&
    typeof nuevos === "object"
  ) {
    for (
      const [campo, valor]
      of Object.entries(nuevos)
    ) {
      if (!estaVacio(valor)) {
        resultado[campo] =
          valor;
      }
    }
  }

  return resultado;
}

async function llamarAppsScript(
  payload
) {
  if (!APPS_SCRIPT_URL) {
    throw new Error(
      "Falta APPS_SCRIPT_URL."
    );
  }

  if (!APPS_SCRIPT_SECRET) {
    throw new Error(
      "Falta APPS_SCRIPT_SECRET."
    );
  }

  const respuesta =
    await fetch(
      APPS_SCRIPT_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            secret:
              APPS_SCRIPT_SECRET,

            ...payload
          }),

        redirect:
          "follow"
      }
    );

  const texto =
    await respuesta.text();

  console.log(
    "Respuesta Apps Script:",
    texto
  );

  let datos;

  try {
    datos =
      JSON.parse(texto);

  } catch {
    throw new Error(
      "Apps Script no devolvió JSON."
    );
  }

  if (!datos.ok) {
    throw new Error(
      datos.error ||
      "Apps Script rechazó la operación."
    );
  }

  return datos;
}

async function guardarEnSheets(
  sheet,
  data
) {
  return llamarAppsScript({
    action:
      "registrar",

    sheet,
    data
  });
}

async function buscarParaEliminar(
  sheet,
  buscar
) {
  return llamarAppsScript({
    action:
      "buscar_eliminar",

    sheet,
    buscar
  });
}

async function eliminarEnSheets(
  sheet,
  seleccion
) {
  return llamarAppsScript({
    action:
      "eliminar",

    sheet,

    fila:
      seleccion.fila,

    esperado:
      seleccion.data
  });
}

async function consultarReporte(
  mes
) {
  return llamarAppsScript({
    action:
      "reporte",

    mes
  });
}

function respuestaSi(texto) {
  const t =
    normalizar(texto);

  return (
    [
      "si",
      "confirmo",
      "confirmar",
      "ok",
      "adelante"
    ].includes(t) ||

    t.includes(
      "borralo"
    ) ||

    t.includes(
      "eliminalo"
    )
  );
}

function respuestaNo(texto) {
  const t =
    normalizar(texto);

  return [
    "no",
    "cancelar",
    "cancela",
    "cancelalo"
  ].includes(t);
}

async function procesarEliminacionPendiente(
  textoUsuario,
  remitente,
  sesion
) {
  if (
    sesion.tipo ===
    "eliminar_seleccion"
  ) {
    if (
      respuestaNo(
        textoUsuario
      )
    ) {
      sesiones.delete(
        remitente
      );

      return (
        "Eliminación cancelada."
      );
    }

    const coincidencia =
      String(textoUsuario)
        .match(/\d+/);

    if (!coincidencia) {
      return (
        `Dime el número del registro que quieres eliminar, del 1 al ${sesion.coincidencias.length}.`
      );
    }

    const numero =
      Number(
        coincidencia[0]
      );

    if (
      numero < 1 ||
      numero >
        sesion.coincidencias.length
    ) {
      return (
        `Elige un número del 1 al ${sesion.coincidencias.length}.`
      );
    }

    const seleccion =
      sesion.coincidencias[
        numero - 1
      ];

    sesiones.set(
      remitente,
      {
        tipo:
          "eliminar_confirmacion",

        sheet:
          sesion.sheet,

        seleccion
      }
    );

    return (
      "Voy a eliminar este registro:\n\n" +
      formatearRegistro(
        seleccion.data
      ) +
      "\n\n¿Confirmas? Responde sí o no."
    );
  }

  if (
    sesion.tipo ===
    "eliminar_confirmacion"
  ) {
    if (
      respuestaNo(
        textoUsuario
      )
    ) {
      sesiones.delete(
        remitente
      );

      return (
        "Eliminación cancelada."
      );
    }

    if (
      !respuestaSi(
        textoUsuario
      )
    ) {
      return (
        "Necesito tu confirmación. Responde sí para eliminarlo o no para cancelar."
      );
    }

    const resultado =
      await eliminarEnSheets(
        sesion.sheet,
        sesion.seleccion
      );

    sesiones.delete(
      remitente
    );

    return (
      "Listo. Eliminé este registro:\n\n" +
      formatearRegistro(
        resultado.eliminado
      )
    );
  }

  sesiones.delete(
    remitente
  );

  return (
    "La operación fue cancelada."
  );
}

async function iniciarEliminacion(
  sheet,
  buscar,
  remitente
) {
  const resultado =
    await buscarParaEliminar(
      sheet,
      buscar
    );

  const coincidencias =
    resultado.coincidencias ||
    [];

  if (
    coincidencias.length === 0
  ) {
    return (
      `No encontré ningún registro que coincida con "${buscar}" en ${sheet}.`
    );
  }

  if (
    coincidencias.length === 1
  ) {
    const seleccion =
      coincidencias[0];

    sesiones.set(
      remitente,
      {
        tipo:
          "eliminar_confirmacion",

        sheet,

        seleccion
      }
    );

    return (
      "Encontré este registro:\n\n" +
      formatearRegistro(
        seleccion.data
      ) +
      "\n\n¿Quieres eliminarlo? Responde sí o no."
    );
  }

  sesiones.set(
    remitente,
    {
      tipo:
        "eliminar_seleccion",

      sheet,

      coincidencias
    }
  );

  const lista =
    coincidencias
      .map(
        (
          item,
          indice
        ) =>
          `${indice + 1}.\n${formatearRegistro(
            item.data
          )}`
      )
      .join("\n\n");

  return (
    `Encontré ${coincidencias.length} registros:\n\n` +
    lista +
    "\n\n¿Cuál quieres eliminar? Responde con el número."
  );
}

async function procesarReporte(
  mes
) {
  const resultado =
    await consultarReporte(
      mes
    );

  const reportes =
    resultado.reportes ||
    [];

  if (
    reportes.length === 0
  ) {
    return (
      `No encontré información para ${mes}.`
    );
  }

  return reportes
    .map(
      reporte =>
        formatearReporte(
          reporte
        )
    )
    .join("\n\n");
}

async function procesarRegistroPendiente(
  textoUsuario,
  remitente,
  sesion
) {
  const interpretacion =
    await interpretarConGemini(
      textoUsuario,
      sesion
    );

  if (
    interpretacion.accion ===
    "cancelar"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      interpretacion.respuesta ||
      "Operación cancelada."
    );
  }

  const nuevosDatos =
    combinarDatos(
      sesion.data,
      interpretacion.data || {}
    );

  const nuevaSesion = {
    tipo:
      "registro",

    sheet:
      sesion.sheet,

    data:
      nuevosDatos
  };

  const faltante =
    siguienteCampoFaltante(
      nuevaSesion.sheet,
      nuevaSesion.data
    );

  if (faltante) {
    sesiones.set(
      remitente,
      nuevaSesion
    );

    return obtenerPregunta(
      nuevaSesion.sheet,
      faltante,
      nuevaSesion.data
    );
  }

  const resultado =
    await guardarEnSheets(
      nuevaSesion.sheet,
      nuevaSesion.data
    );

  sesiones.delete(
    remitente
  );

  return (
    `Listo. Quedó guardado con ID ${resultado.id}.`
  );
}

async function procesarMensaje(
  textoUsuario,
  remitente
) {
  const sesion =
    sesiones.get(
      remitente
    );

  if (
    sesion &&
    (
      sesion.tipo ===
        "eliminar_seleccion" ||

      sesion.tipo ===
        "eliminar_confirmacion"
    )
  ) {
    return (
      procesarEliminacionPendiente(
        textoUsuario,
        remitente,
        sesion
      )
    );
  }

  if (
    sesion?.tipo ===
    "registro"
  ) {
    return (
      procesarRegistroPendiente(
        textoUsuario,
        remitente,
        sesion
      )
    );
  }

  const interpretacion =
    await interpretarConGemini(
      textoUsuario
    );

  if (
    interpretacion.accion ===
    "cancelar"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      interpretacion.respuesta ||
      "Operación cancelada."
    );
  }

  if (
    interpretacion.accion ===
    "registrar"
  ) {
    const sheet =
      interpretacion.sheet;

    if (
      !CAMPOS_REQUERIDOS[
        sheet
      ]
    ) {
      return (
        "No pude identificar dónde guardar ese registro."
      );
    }

    const nuevaSesion = {
      tipo:
        "registro",

      sheet,

      data:
        interpretacion.data ||
        {}
    };

    const faltante =
      siguienteCampoFaltante(
        sheet,
        nuevaSesion.data
      );

    if (faltante) {
      sesiones.set(
        remitente,
        nuevaSesion
      );

      return obtenerPregunta(
        sheet,
        faltante,
        nuevaSesion.data
      );
    }

    const resultado =
      await guardarEnSheets(
        sheet,
        nuevaSesion.data
      );

    return (
      `Listo. Quedó guardado con ID ${resultado.id}.`
    );
  }

  if (
    interpretacion.accion ===
    "eliminar"
  ) {
    if (
      !interpretacion.sheet ||
      !interpretacion.buscar
    ) {
      return (
        "Necesito saber qué registro quieres eliminar."
      );
    }

    return iniciarEliminacion(
      interpretacion.sheet,
      interpretacion.buscar,
      remitente
    );
  }

  if (
    interpretacion.accion ===
    "reporte"
  ) {
    return procesarReporte(
      interpretacion.mes ||
      mesActualMexico()
    );
  }

  return (
    interpretacion.respuesta ||
    "¿En qué te ayudo?"
  );
}

async function suscribirWhatsApp() {
  try {
    const respuesta =
      await fetch(
        `https://graph.facebook.com/v26.0/${WABA_ID}/subscribed_apps?subscribed_fields=messages`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${WHATSAPP_TOKEN}`,

            "Content-Type":
              "application/json"
          }
        }
      );

    const datos =
      await respuesta.json();

    console.log(
      "Suscripción WhatsApp:",
      datos
    );

  } catch (error) {
    console.error(
      "Error al suscribir WhatsApp:",
      error
    );
  }
}

const server =
  http.createServer(
    (req, res) => {

      const url =
        new URL(
          req.url,
          `http://${req.headers.host}`
        );

      if (
        req.method === "GET" &&
        url.pathname ===
          "/privacy"
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8"
          }
        );

        return res.end(`
          <h1>Política de privacidad</h1>
          <p>Esta aplicación es de uso personal y procesa únicamente la información necesaria para su funcionamiento.</p>
          <p>No vendemos ni compartimos datos personales con terceros.</p>
          <p>Contacto: zurita-17@hotmail.com</p>
        `);
      }

      if (
        req.method === "GET" &&
        url.pathname ===
          "/webhook"
      ) {
        const mode =
          url.searchParams.get(
            "hub.mode"
          );

        const token =
          url.searchParams.get(
            "hub.verify_token"
          );

        const challenge =
          url.searchParams.get(
            "hub.challenge"
          );

        if (
          mode === "subscribe" &&
          token === VERIFY_TOKEN
        ) {
          console.log(
            "Webhook verificado correctamente."
          );

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/plain"
            }
          );

          return res.end(
            challenge || ""
          );
        }

        res.writeHead(403);

        return res.end(
          "Forbidden"
        );
      }

      if (
        req.method === "POST" &&
        url.pathname ===
          "/webhook"
      ) {
        let body = "";

        req.on(
          "data",
          chunk => {
            body += chunk;
          }
        );

        req.on(
          "end",
          async () => {
            let payload;

            try {
              payload =
                JSON.parse(body);

              console.log(
                "Webhook recibido:",
                JSON.stringify(
                  payload,
                  null,
                  2
                )
              );

            } catch (error) {
              console.error(
                "JSON inválido:",
                error
              );

              res.writeHead(
                200,
                {
                  "Content-Type":
                    "text/plain"
                }
              );

              return res.end(
                "EVENT_RECEIVED"
              );
            }

            res.writeHead(
              200,
              {
                "Content-Type":
                  "text/plain"
              }
            );

            res.end(
              "EVENT_RECEIVED"
            );

            try {
              const value =
                payload
                  ?.entry?.[0]
                  ?.changes?.[0]
                  ?.value;

              const mensaje =
                value
                  ?.messages?.[0];

              if (!mensaje) {
                return;
              }

              if (
                mensaje.id &&
                mensajesProcesados
                  .has(
                    mensaje.id
                  )
              ) {
                console.log(
                  "Mensaje duplicado ignorado:",
                  mensaje.id
                );

                return;
              }

              if (mensaje.id) {
                mensajesProcesados
                  .add(
                    mensaje.id
                  );

                if (
                  mensajesProcesados
                    .size > 500
                ) {
                  mensajesProcesados
                    .clear();
                }
              }

              const remitente =
                mensaje.from
                  ?.startsWith(
                    "521"
                  )
                  ? `52${mensaje.from.slice(3)}`
                  : mensaje.from;

              if (
                mensaje.type !==
                  "text" ||

                !mensaje.text
                  ?.body ||

                !remitente
              ) {
                return;
              }

              const textoRecibido =
                mensaje.text.body
                  .trim();

              console.log(
                "Mensaje recibido:",
                textoRecibido
              );

              try {
                const respuestaIA =
                  await procesarMensaje(
                    textoRecibido,
                    remitente
                  );

                await enviarMensajeWhatsApp(
                  remitente,
                  respuestaIA
                );

              } catch (error) {
                console.error(
                  "Error procesando IA/Sheets:",
                  error
                );

                try {
                  await enviarMensajeWhatsApp(
                    remitente,
                    "Recibí tu mensaje, pero hubo un problema al procesarlo. Revisa los logs de Finanzas IA."
                  );

                } catch (
                  errorEnvio
                ) {
                  console.error(
                    "Error enviando mensaje de error:",
                    errorEnvio
                  );
                }
              }

            } catch (error) {
              console.error(
                "Error procesando mensaje:",
                error
              );
            }
          }
        );

        return;
      }

      if (
        req.method === "GET" &&
        url.pathname === "/"
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        return res.end(
          "Finanzas IA activo"
        );
      }

      res.writeHead(404);

      res.end(
        "Not found"
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Servidor activo en puerto ${PORT}`
    );

    if (!WHATSAPP_TOKEN) {
      console.error(
        "Falta WHATSAPP_TOKEN."
      );

    } else {
      suscribirWhatsApp();
    }

    if (!GEMINI_API_KEY) {
      console.error(
        "Falta GEMINI_API_KEY."
      );

    } else {
      console.log(
        "GEMINI_API_KEY detectada."
      );
    }

    if (!APPS_SCRIPT_URL) {
      console.error(
        "Falta APPS_SCRIPT_URL."
      );
    }

    if (!APPS_SCRIPT_SECRET) {
      console.error(
        "Falta APPS_SCRIPT_SECRET."
      );
    }
  }
);
