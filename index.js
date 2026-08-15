const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "finanzas-ia-token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

const WABA_ID = "1363654319277230";
const PHONE_NUMBER_ID = "1327077313815752";

const mensajesProcesados = new Set();

async function enviarMensajeWhatsApp(destinatario, texto) {
  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: destinatario,
          type: "text",
          text: { body: texto }
        })
      }
    );

    const datos = await respuesta.json();
    console.log("Respuesta WhatsApp:", datos);
    return datos;
  } catch (error) {
    console.error("Error enviando WhatsApp:", error);
  }
}

function extraerJSON(texto) {
  const limpio = texto
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(limpio);
}

async function interpretarConGemini(textoUsuario) {
  if (!GEMINI_API_KEY) {
    throw new Error("Falta GEMINI_API_KEY.");
  }

  const instrucciones = `
Eres Finanzas IA, un asistente personal privado por WhatsApp.

Responde SIEMPRE únicamente con JSON válido.
No uses markdown.
No escribas texto fuera del JSON.

Debes interpretar mensajes relacionados con estas hojas:

1. Pagos
Columnas exactas:
ID, Fecha, Servicio, Monto, Notas, Estado

2. Super
Columnas exactas:
ID, Fecha, Producto, Cantidad, Costo, Estado

3. Ingresos
Columnas exactas:
ID, Fecha, Sueldo, Vales restaurante, Vales comida

Por ahora solo puedes REGISTRAR nuevas filas.

Si el usuario quiere registrar un pago, devuelve:
{
  "accion": "registrar",
  "sheet": "Pagos",
  "data": {
    "ID": "",
    "Fecha": "",
    "Servicio": "",
    "Monto": "",
    "Notas": "",
    "Estado": ""
  },
  "respuesta": ""
}

Si quiere agregar algo al supermercado:
{
  "accion": "registrar",
  "sheet": "Super",
  "data": {
    "ID": "",
    "Fecha": "",
    "Producto": "",
    "Cantidad": "",
    "Costo": "",
    "Estado": ""
  },
  "respuesta": ""
}

Si quiere registrar ingresos:
{
  "accion": "registrar",
  "sheet": "Ingresos",
  "data": {
    "ID": "",
    "Fecha": "",
    "Sueldo": "",
    "Vales restaurante": "",
    "Vales comida": ""
  },
  "respuesta": ""
}

Reglas:
- No inventes datos.
- Fecha debe usar formato DD/MM/YYYY cuando el usuario la indique claramente.
- Si no menciona fecha, usa la fecha de hoy: 15/08/2026.
- Para Pagos genera ID con formato P- seguido de la hora actual aproximada o un número aleatorio corto.
- Para Super genera ID con formato S- seguido de un número aleatorio corto.
- Para Ingresos genera ID con formato I- seguido de un número aleatorio corto.
- Si en Super no menciona cantidad, usa 1.
- Si agrega algo al Super y no dice que ya lo compró, Estado debe ser "Pendiente".
- Si registra un pago y dice que ya pagó, Estado debe ser "Pagado".
- Si falta un dato indispensable, devuelve accion "preguntar" y explica solamente qué falta en "respuesta".
- Si el mensaje no corresponde a un registro nuevo, devuelve accion "conversar" y responde brevemente en "respuesta".
`.trim();

  const respuesta = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: instrucciones }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: textoUsuario }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    }
  );

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error("Error Gemini:", JSON.stringify(datos, null, 2));
    throw new Error(
      datos?.error?.message ||
      `Gemini respondió con HTTP ${respuesta.status}`
    );
  }

  const texto =
    datos?.candidates?.[0]?.content?.parts
      ?.map(parte => parte.text)
      .filter(Boolean)
      .join("\n")
      .trim();

  if (!texto) {
    throw new Error("Gemini no devolvió texto.");
  }

  console.log("JSON Gemini:", texto);

  return extraerJSON(texto);
}

async function guardarEnSheets(sheet, data) {
  if (!APPS_SCRIPT_URL) {
    throw new Error("Falta APPS_SCRIPT_URL.");
  }

  if (!APPS_SCRIPT_SECRET) {
    throw new Error("Falta APPS_SCRIPT_SECRET.");
  }

  const respuesta = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      secret: APPS_SCRIPT_SECRET,
      sheet,
      data
    }),
    redirect: "follow"
  });

  const texto = await respuesta.text();

  console.log("Respuesta Apps Script:", texto);

  let datos;

  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error(
      "Apps Script no devolvió JSON. Revisa los permisos de la aplicación web."
    );
  }

  if (!datos.ok) {
    throw new Error(
      datos.error || "Google Sheets rechazó el registro."
    );
  }

  return datos;
}

async function procesarMensaje(textoUsuario) {
  const interpretacion =
    await interpretarConGemini(textoUsuario);

  if (interpretacion.accion === "registrar") {
    await guardarEnSheets(
      interpretacion.sheet,
      interpretacion.data
    );

    if (interpretacion.sheet === "Pagos") {
      return `Listo. Registré ${interpretacion.data.Servicio || "el pago"} en Pagos.`;
    }

    if (interpretacion.sheet === "Super") {
      return `Listo. Agregué ${interpretacion.data.Producto || "el producto"} a Super.`;
    }

    if (interpretacion.sheet === "Ingresos") {
      return "Listo. Registré el ingreso.";
    }

    return "Listo. Quedó registrado.";
  }

  return (
    interpretacion.respuesta ||
    "No pude interpretar ese mensaje."
  );
}

async function suscribirWhatsApp() {
  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/v26.0/${WABA_ID}/subscribed_apps?subscribed_fields=messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const datos = await respuesta.json();
    console.log("Suscripción WhatsApp:", datos);
  } catch (error) {
    console.error("Error al suscribir WhatsApp:", error);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  if (
    req.method === "GET" &&
    url.pathname === "/privacy"
  ) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

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
      url.searchParams.get("hub.mode");

    const token =
      url.searchParams.get("hub.verify_token");

    const challenge =
      url.searchParams.get("hub.challenge");

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN
    ) {
      console.log(
        "Webhook verificado correctamente."
      );

      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      return res.end(challenge || "");
    }

    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (
    req.method === "POST" &&
    url.pathname === "/webhook"
  ) {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", async () => {
      let payload;

      try {
        payload = JSON.parse(body);

        console.log(
          "Webhook recibido:",
          JSON.stringify(payload, null, 2)
        );
      } catch (error) {
        console.error("JSON inválido:", error);

        res.writeHead(200, {
          "Content-Type": "text/plain"
        });

        return res.end("EVENT_RECEIVED");
      }

      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      res.end("EVENT_RECEIVED");

      try {
        const value =
          payload?.entry?.[0]?.changes?.[0]?.value;

        const mensaje =
          value?.messages?.[0];

        if (!mensaje) return;

        if (
          mensaje.id &&
          mensajesProcesados.has(mensaje.id)
        ) {
          console.log(
            "Mensaje duplicado ignorado:",
            mensaje.id
          );
          return;
        }

        if (mensaje.id) {
          mensajesProcesados.add(mensaje.id);

          if (mensajesProcesados.size > 500) {
            mensajesProcesados.clear();
          }
        }

        const remitente =
          mensaje.from?.startsWith("521")
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
            await procesarMensaje(textoRecibido);

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
    });

    return;
  }

  if (
    req.method === "GET" &&
    url.pathname === "/"
  ) {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    return res.end("Finanzas IA activo");
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Servidor activo en puerto ${PORT}`
    );

    if (!WHATSAPP_TOKEN) {
      console.error("Falta WHATSAPP_TOKEN.");
    } else {
      suscribirWhatsApp();
    }

    if (!GEMINI_API_KEY) {
      console.error("Falta GEMINI_API_KEY.");
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
