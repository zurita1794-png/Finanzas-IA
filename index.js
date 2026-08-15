const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "finanzas-ia-token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = "1363654319277230";
async function suscribirWhatsApp() {
  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/${WABA_ID}/subscribed_apps?subscribed_fields=messages`,
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

suscribirWhatsApp();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
if (req.method === "GET" && url.pathname === "/privacy") {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  return res.end(`
    <h1>Política de privacidad</h1>
    <p>Esta aplicación es de uso personal y procesa únicamente la información necesaria para su funcionamiento.</p>
    <p>No vendemos ni compartimos datos personales con terceros.</p>
    <p>Contacto: zurita-17@hotmail.com</p>
  `);
}
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(challenge || "");
    }

    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        console.log("Webhook recibido:", JSON.parse(body));
      } catch {
        console.log("Webhook recibido:", body);
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("EVENT_RECEIVED");
    });

    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Finanzas IA activo");
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
