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

/*
  Guarda temporalmente una conversación pendiente
  para cada número de WhatsApp.
*/
const conversaciones = new Map();

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

function siguienteCampoFaltante(sheet, data) {
  const campos =
    CAMPOS_REQUERIDOS[sheet] || [];

  return campos.find(
    campo => estaVacio(data[campo])
  );
}

function obtenerPregunta(sheet, campo, data) {
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

  if (sheet === "Ingresos") {
    if (campo === "Monto") {
      return `¿Cuál es el monto de ${data.Concepto}?`;
    }
  }

  return `¿Cuál es el valor de ${campo}?`;
}

async function enviarMensajeWhatsApp(
  destinatario,
  texto
) {
  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: destinatario,
          type: "text",
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

    return datos;

  } catch (error) {
    console.error(
      "Error enviando WhatsApp:",
      error
    );
  }
}

function extraerJSON(texto) {
  const limpio = texto
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(limpio);
}

function fechaActualMexico() {
  return new Intl.DateTimeFormat(
    "es-MX",
    {
      timeZone: "America/Mexico_City",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  ).format(new Date());
}

async function interpretarConGemini(
  textoUsuario,
  contextoActual = null
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "Falta GEMINI_API_KEY."
    );
  }

  const hoy =
    fechaActualMexico();

  const campoEsperado =
    contextoActual
      ? siguienteCampoFaltante(
          contextoActual.sheet,
          contextoActual.data
        )
      : null;

  const instrucciones = `
Eres Finanzas IA, un asistente personal privado que funciona por WhatsApp.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.
No uses markdown.
No escribas nada fuera del JSON.

Fecha actual en Ciudad de México:
${hoy}

HOJAS DISPONIBLES:

Super:
Producto, Fecha, Cantidad, Costo, Estado

Pagos:
Servicio, Fecha, Monto, Notas, Estado

Ingresos:
Concepto, Fecha, Monto

IMPORTANTE:

- El campo ID NO lo generas tú.
- Google Sheets genera y reutiliza los ID.
- No inventes ningún dato.
- No completes automáticamente campos faltantes.
- Solo registra valores que el usuario haya dicho.
- Si el usuario dice "hoy", puedes convertirlo a la fecha actual.
- Si dice "sin notas", usa exactamente "Sin notas".
- No supongas Estado.
- No supongas Cantidad.
- No supongas Costo.
- No supongas Fecha.
- No supongas Monto.

Si ya existe una conversación pendiente, interpreta el nuevo mensaje como respuesta al campo que se está preguntando.

Por ejemplo:
Si el campo esperado es Cantidad y responde "2",
debes devolver Cantidad = "2".

Si el campo esperado es Costo y responde "35 pesos",
debes devolver Costo = "35".

Si el campo esperado es Estado y responde "pendiente",
debes devolver Estado = "Pendiente".

Si el campo esperado es Fecha y responde "hoy",
debes devolver Fecha = "${hoy}".

FORMATO DE RESPUESTA:

Para registrar o continuar un registro:

{
  "accion": "registrar",
  "sheet": "Super",
  "data": {
    "Producto": ""
  },
  "respuesta": ""
}

Usa únicamente los campos que realmente hayas entendido.

Para cancelar un registro:

{
  "accion": "cancelar",
  "respuesta": "Registro cancelado."
}

Para una conversación que no sea un registro:

{
  "accion": "conversar",
  "respuesta": "..."
}

Si existe una conversación pendiente:
- conserva la misma hoja;
- conserva todos los datos anteriores;
- agrega únicamente la nueva información;
- si el usuario corrige explícitamente un dato anterior, puedes modificarlo.
`.trim();

  let entrada;

  if (contextoActual) {
    entrada = `
REGISTRO PENDIENTE:

Hoja:
${contextoActual.sheet}

Datos actuales:
${JSON.stringify(contextoActual.data)}

Campo que estamos esperando:
${campoEsperado}

Nuevo mensaje del usuario:
${textoUsuario}
`.trim();
  } else {
    entrada = textoUsuario;
  }

  const respuesta = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",

        "x-goog-api-key":
          GEMINI_API_KEY
      },

      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: instrucciones
            }
          ]
        },

        contents: [
          {
            role: "user",
            parts: [
              {
                text: entrada
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
      JSON.stringify(datos, null, 2)
    );

    throw new Error(
      datos?.error?.message ||
      `Gemini respondió con HTTP ${respuesta.status}`
    );
  }

  const texto =
    datos?.candidates?.[0]
      ?.content?.parts
      ?.map(parte => parte.text)
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

  return extraerJSON(texto);
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
        resultado[campo] = valor;
      }
    }
  }

  return resultado;
}

async function guardarEnSheets(
  sheet,
  data
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

  const respuesta = await fetch(
    APPS_SCRIPT_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        secret:
          APPS_SCRIPT_SECRET,

        sheet,
        data
      }),

      redirect: "follow"
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
      "Google Sheets rechazó el registro."
    );
  }

  return datos;
}

async function procesarMensaje(
  textoUsuario,
  remitente
) {
  const contextoActual =
    conversaciones.get(remitente)
    || null;

  const interpretacion =
    await interpretarConGemini(
      textoUsuario,
      contextoActual
    );

  if (
    interpretacion.accion ===
    "cancelar"
  ) {
    conversaciones.delete(
      remitente
    );

    return (
      interpretacion.respuesta ||
      "Registro cancelado."
    );
  }

  if (contextoActual) {
    const nuevosDatos =
      combinarDatos(
        contextoActual.data,
        interpretacion.data || {}
      );

    const sesion = {
      sheet:
        contextoActual.sheet,

      data:
        nuevosDatos
    };

    const faltante =
      siguienteCampoFaltante(
        sesion.sheet,
        sesion.data
      );

    if (faltante) {
      conversaciones.set(
        remitente,
        sesion
      );

      return obtenerPregunta(
        sesion.sheet,
        faltante,
        sesion.data
      );
    }

    const resultado =
      await guardarEnSheets(
        sesion.sheet,
        sesion.data
      );

    conversaciones.delete(
      remitente
    );

    if (
      sesion.sheet === "Super"
    ) {
      return (
        `Listo. Guardé ${sesion.data.Producto} ` +
        `con ID ${resultado.id}.`
      );
    }

    if (
      sesion.sheet === "Pagos"
    ) {
      return (
        `Listo. Guardé ${sesion.data.Servicio} ` +
        `con ID ${resultado.id}.`
      );
    }

    if (
      sesion.sheet === "Ingresos"
    ) {
      return (
        `Listo. Guardé ${sesion.data.Concepto} ` +
        `con ID ${resultado.id}.`
      );
    }

    return "Listo. Quedó guardado.";
  }

  if (
    interpretacion.accion ===
    "registrar"
  ) {
    const sheet =
      interpretacion.sheet;

    if (
      !CAMPOS_REQUERIDOS[sheet]
    ) {
      return (
        "No pude identificar dónde guardar ese registro."
      );
    }

    const sesion = {
      sheet,
      data:
        interpretacion.data || {}
    };

    const faltante =
      siguienteCampoFaltante(
        sheet,
        sesion.data
      );

    if (faltante) {
      conversaciones.set(
        remitente,
        sesion
      );

      return obtenerPregunta(
        sheet,
        faltante,
        sesion.data
      );
    }

    const resultado =
      await guardarEnSheets(
        sheet,
        sesion.data
      );

    if (sheet === "Super") {
      return (
        `Listo. Guardé ${sesion.data.Producto} ` +
        `con ID ${resultado.id}.`
      );
    }

    if (sheet === "Pagos") {
      return (
        `Listo. Guardé ${sesion.data.Servicio} ` +
        `con ID ${resultado.id}.`
      );
    }

    if (sheet === "Ingresos") {
      return (
        `Listo. Guardé ${sesion.data.Concepto} ` +
        `con ID ${resultado.id}.`
      );
    }
  }

  return (
    interpretacion.respuesta ||
    "¿En qué te ayudo?"
  );
}

async function suscribirWhatsApp() {
  try {
    const respuesta = await fetch(
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

      const url = new URL(
        req.url,
        `http://${req.headers.host}`
      );

      if (
        req.method === "GET" &&
        url.pathname === "/privacy"
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
        url.pathname === "/webhook"
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
        url.pathname === "/webhook"
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
                payload?.entry?.[0]
                  ?.changes?.[0]
                  ?.value;

              const mensaje =
                value?.messages?.[0];

              if (!mensaje) {
                return;
              }

              if (
                mensaje.id &&
                mensajesProcesados.has(
                  mensaje.id
                )
              ) {
                return;
              }

              if (mensaje.id) {
                mensajesProcesados.add(
                  mensaje.id
                );

                if (
                  mensajesProcesados.size >
                  500
                ) {
                  mensajesProcesados.clear();
                }
              }

              const remitente =
                mensaje.from?.startsWith(
                  "521"
                )
                  ? `52${mensaje.from.slice(3)}`
                  : mensaje.from;

              if (
                mensaje.type !== "text" ||
                !mensaje.text?.body ||
                !remitente
              ) {
                return;
              }

              const textoRecibido =
                mensaje.text.body.trim();

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

                await enviarMensajeWhatsApp(
                  remitente,
                  "Recibí tu mensaje, pero hubo un problema al procesarlo. Revisa los logs de Finanzas IA."
                );
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
      res.end("Not found");
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
