const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "finanzas-ia-token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log("Diagnóstico OpenAI:", {
  existe: Boolean(OPENAI_API_KEY),
  empiezaConSk: OPENAI_API_KEY?.startsWith("sk-"),
  longitud: OPENAI_API_KEY?.length
});

const WABA_ID = "1363654319277230";
const PHONE_NUMBER_ID = "1327077313815752";

// Evita responder dos veces al mismo mensaje si Meta lo reintenta.
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
// EXTRAER TEXTO DE UNA RESPUESTA DE OPENAI
// ----------------------------------------------------

function extraerTextoOpenAI(datos) {
  if (typeof datos.output_text === "string" && datos.output_text.trim()) {
    return datos.output_text.trim();
  }

  const partes = [];

  for (const item of datos.output || []) {
    if (item.type !== "message") {
      continue;
    }

    for (const contenido of item.content || []) {
      if (
        contenido.type === "output_text" &&
        typeof contenido.text === "string"
      ) {
        partes.push(contenido.text);
      }
    }
  }

  return partes.join("\n").trim();
}

// ----------------------------------------------------
// CONSULTAR A OPENAI
// ----------------------------------------------------

async function preguntarOpenAI(textoUsuario) {
  if (!OPENAI_API_KEY) {
    throw new Error("Falta la variable OPENAI_API_KEY.");
  }

  const respuesta = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        reasoning: {
          effort: "low"
        },
        instructions: `
Eres Finanzas IA, un asistente personal privado que funciona por WhatsApp.

Responde siempre en español.

Tu objetivo es ayudar a interpretar y organizar información personal relacionada con:
- pagos y gastos fijos;
- lista del supermercado;
- ingresos;
- consultas sobre esos datos;
- futuras funciones de organización financiera.

Habla de manera natural y breve porque tus respuestas llegan por WhatsApp.

Debes entender lenguaje cotidiano. Por ejemplo:
"Agrega un pago de luz de 535 pesos, septiembre, pendiente."
"Necesito comprar leche."
"Ya compré el jabón."
"Ya pagué internet, fueron 560 pesos."

IMPORTANTE:
En esta etapa todavía NO estás conectado a Google Sheets para guardar información.
Por eso nunca afirmes que un pago, producto o ingreso ya fue guardado.
Si el usuario pide registrar algo, confirma brevemente qué entendiste y que está listo para registrarse.

No inventes importes, fechas, productos, estados ni otra información que el usuario no haya dado.
Si falta un dato indispensable, pregunta solamente por ese dato.
        `.trim(),
        input: textoUsuario
      })
    }
  );

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    console.error(
      "Error OpenAI:",
      JSON.stringify(datos, null, 2)
    );

    throw new Error(
      datos?.error?.message ||
      `OpenAI respondió con HTTP ${respuesta.status}`
    );
  }

  const texto = extraerTextoOpenAI(datos);

  if (!texto) {
    console.error(
      "OpenAI no devolvió texto:",
      JSON.stringify(datos, null, 2)
    );

    throw new Error("OpenAI no devolvió una respuesta de texto.");
  }

  console.log("Respuesta IA:", texto);

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

      // Respondemos inmediatamente a Meta.
      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      res.end("EVENT_RECEIVED");

      try {
        const value =
          payload?.entry?.[0]?.changes?.[0]?.value;

        const mensaje =
          value?.messages?.[0];

        // Los eventos de entrega, lectura, etc.
        // no contienen un mensaje nuevo.
        if (!mensaje) {
          return;
        }

        // Evitar duplicados.
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

        // Corrección necesaria para el formato
        // del número mexicano recibido desde Meta.
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
        // OPENAI
        // --------------------------------------------

        try {
          const respuestaIA =
            await preguntarOpenAI(textoRecibido);

          await enviarMensajeWhatsApp(
            remitente,
            respuestaIA
          );
        } catch (error) {
          console.error(
            "Error usando OpenAI:",
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

    if (!OPENAI_API_KEY) {
      console.error(
        "Falta OPENAI_API_KEY."
      );
    } else {
      console.log(
        "OPENAI_API_KEY detectada."
      );
    }
  }
);
