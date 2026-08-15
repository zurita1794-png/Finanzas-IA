const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "finanzas-ia-token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const WABA_ID = "1363654319277230";
const PHONE_NUMBER_ID = "1327077313815752";

const mensajesProcesados = new Set();

// ----------------------------------------------------
// ENVIAR MENSAJE POR WHATSAPP
// ----------------------------------------------------

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
          text: {
            body: texto
          }
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

// ----------------------------------------------------
// CONSULTAR GEMINI
// ----------------------------------------------------

async function preguntarGemini(textoUsuario) {
  if (!GEMINI_API_KEY) {
    throw new Error("Falta la variable GEMINI_API_KEY.");
  }

  const instrucciones = `
Eres Finanzas IA, un asistente personal privado que funciona por WhatsApp.

Responde siempre en español.

Tu objetivo es ayudar a interpretar y organizar información personal relacionada con:
- pagos y gastos fijos;
- lista del supermercado;
- ingresos;
- consultas sobre esos datos;
- futuras funciones de organización financiera.

Habla de manera natural, clara y breve porque tus respuestas llegan por WhatsApp.

Debes entender lenguaje cotidiano. Ejemplos:
"Agrega un pago de luz de 535 pesos, septiembre, pendiente."
"Necesito comprar leche."
"Ya compré el jabón."
"Ya pagué internet, fueron 560 pesos."

IMPORTANTE:
Todavía NO estás conectado a Google Sheets para guardar información.
Nunca afirmes que algo fue guardado si todavía no lo fue.

Si el usuario pide registrar algo:
1. identifica qué quiere registrar;
2. resume brevemente los datos entendidos;
3. indica que está listo para registrarse.

No inventes importes, fechas, productos, estados ni otros datos.
Si falta un dato indispensable, pregunta únicamente por ese dato.
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
                text: textoUsuario
              }
            ]
          }
        ]
      })
    }
  );

  const datos = await respuesta.json();

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
    datos?.candidates?.[0]?.content?.parts
      ?.map(parte => parte.text)
      .filter(Boolean)
      .join("\n")
      .trim();

  if (!texto) {
    console.error(
      "Gemini no devolvió texto:",
      JSON.stringify(datos, null, 2)
    );

    throw new Error(
      "Gemini no devolvió una respuesta de texto."
    );
  }

  console.log("Respuesta Gemini:", texto);

  return texto;
}

// ----------------------------------------------------
// SUSCRIBIR APP A WHATSAPP
// ----------------------------------------------------

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
    console.error(
      "Error al suscribir WhatsApp:",
      error
    );
  }
}

// ----------------------------------------------------
// SERVIDOR
// ----------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  // ------------------------------------------------
  // POLÍTICA DE PRIVACIDAD
  // ------------------------------------------------

  if (
    req.method === "GET" &&
    url.pathname === "/privacy"
  ) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    return res.end(`
      <h1>Política de privacidad</h1>
      <p>
        Esta aplicación es de uso personal y procesa únicamente
        la información necesaria para su funcionamiento.
      </p>
      <p>
        No vendemos ni compartimos datos personales con terceros.
      </p>
      <p>
        Contacto: zurita-17@hotmail.com
      </p>
    `);
  }

  // ------------------------------------------------
  // VERIFICACIÓN DEL WEBHOOK
  // ------------------------------------------------

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

  // ------------------------------------------------
  // RECIBIR WHATSAPP
  // ------------------------------------------------

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
        console.error(
          "JSON inválido:",
          error
        );

        res.writeHead(200, {
          "Content-Type": "text/plain"
        });

        return res.end("EVENT_RECEIVED");
      }

      // Responder rápido a Meta.
      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      res.end("EVENT_RECEIVED");

      try {
        const value =
          payload?.entry?.[0]?.changes?.[0]?.value;

        const mensaje =
          value?.messages?.[0];

        if (!mensaje) {
          return;
        }

        // Evitar mensajes duplicados.
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

        // Corrección del formato mexicano.
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

        console.log(
          "Número remitente:",
          remitente
        );

        // --------------------------------------------
        // GEMINI
        // --------------------------------------------

        try {
          const respuestaIA =
            await preguntarGemini(textoRecibido);

          await enviarMensajeWhatsApp(
            remitente,
            respuestaIA
          );
        } catch (error) {
          console.error(
            "Error usando Gemini:",
            error
          );

          await enviarMensajeWhatsApp(
            remitente,
            "Recibí tu mensaje, pero la IA tuvo un problema al procesarlo. Revisa los logs de Finanzas IA."
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

  // ------------------------------------------------
  // PÁGINA PRINCIPAL
  // ------------------------------------------------

  if (
    req.method === "GET" &&
    url.pathname === "/"
  ) {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    return res.end(
      "Finanzas IA activo"
    );
  }

  // ------------------------------------------------
  // NO ENCONTRADO
  // ------------------------------------------------

  res.writeHead(404);

  res.end("Not found");
});

// ----------------------------------------------------
// INICIAR SERVIDOR
// ----------------------------------------------------

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
  }
);
