const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "finanzas-ia-token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

const WABA_ID = "1363654319277230";
const PHONE_NUMBER_ID = "1327077313815752";

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
    console.error("Error al suscribir WhatsApp:", error);
  }
}

// ----------------------------------------------------
// SERVIDOR
// ----------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ------------------------------------------------
  // POLÍTICA DE PRIVACIDAD
  // ------------------------------------------------

  if (req.method === "GET" && url.pathname === "/privacy") {
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
  // VERIFICACIÓN DEL WEBHOOK DE META
  // ------------------------------------------------

  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado correctamente.");

      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      return res.end(challenge || "");
    }

    res.writeHead(403);

    return res.end("Forbidden");
  }

  // ------------------------------------------------
  // RECIBIR MENSAJES DE WHATSAPP
  // ------------------------------------------------

  if (req.method === "POST" && url.pathname === "/webhook") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
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

      // Respondemos inmediatamente a Meta
      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      res.end("EVENT_RECEIVED");

      // ------------------------------------------------
      // EXTRAER EL MENSAJE
      // ------------------------------------------------

      try {
        const value =
          payload?.entry?.[0]?.changes?.[0]?.value;

        const mensaje =
          value?.messages?.[0];

        // Algunos webhooks son solo estados:
        // enviado, entregado, leído, etc.
        if (!mensaje) {
          return;
        }

        const remitente = mensaje.from?.startsWith("521")
  ? `52${mensaje.from.slice(3)}`
  : mensaje.from;

        if (
          mensaje.type === "text" &&
          mensaje.text?.body &&
          remitente
        ) {
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
          // RESPUESTA DE PRUEBA
          // --------------------------------------------

          enviarMensajeWhatsApp(
            remitente,
            `Recibí: ${textoRecibido}`
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

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    return res.end("Finanzas IA activo");
  }

  // ------------------------------------------------
  // RUTA NO ENCONTRADA
  // ------------------------------------------------

  res.writeHead(404);

  res.end("Not found");
});

// ----------------------------------------------------
// INICIAR SERVIDOR
// ----------------------------------------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor activo en puerto ${PORT}`);

  if (WHATSAPP_TOKEN) {
    suscribirWhatsApp();
  } else {
    console.error(
      "Falta la variable WHATSAPP_TOKEN."
    );
  }
});
