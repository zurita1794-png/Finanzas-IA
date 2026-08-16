const http = require("http");

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "finanzas-ia-token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v26.0";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const WABA_ID = process.env.WABA_ID || "1363654319277230";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "1327077313815752";
const ZONA_HORARIA = "America/Mexico_City";
const SESION_MS = 2 * 60 * 60 * 1000;

const mensajesProcesados = new Map();
const sesiones = new Map();

const CAMPOS_REQUERIDOS = {
  Ingresos: ["Fecha de ingreso", "Tipo de ingreso", "Monto"],
  Pagos: ["Fecha de pago", "Concepto", "Periodo", "Monto", "Estado"],
  Super: [
    "Fecha de compra",
    "Producto",
    "Producto base",
    "Categoría",
    "Monto",
    "Tienda",
    "Cantidad",
    "Unidad",
    "Contenido por empaque",
    "Unidad de comparación"
  ]
};

const CAMPOS_CORRECCION_TICKET = [
  "Fecha de compra",
  "Producto",
  "Producto base",
  "Categoría",
  "Monto",
  "Tienda",
  "Cantidad",
  "Unidad",
  "Contenido por empaque",
  "Unidad de comparación",
  "Precio por unidad"
];

const SEPARADOR = "──────────";

function estaVacio(valor) {
  return valor === undefined || valor === null || String(valor).trim() === "";
}

function normalizar(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function guardarSesion(remitente, sesion) {
  sesiones.set(remitente, { ...sesion, actualizadoEn: Date.now() });
}

function obtenerSesion(remitente) {
  const sesion = sesiones.get(remitente);
  if (!sesion) return null;

  if (Date.now() - Number(sesion.actualizadoEn || 0) > SESION_MS) {
    sesiones.delete(remitente);
    return null;
  }

  return sesion;
}

function limpiarMensajesProcesados() {
  const limite = Date.now() - 6 * 60 * 60 * 1000;

  for (const [id, ts] of mensajesProcesados.entries()) {
    if (ts < limite) mensajesProcesados.delete(id);
  }

  if (mensajesProcesados.size > 1000) {
    const entradas = [...mensajesProcesados.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(-500);

    mensajesProcesados.clear();

    for (const [id, ts] of entradas) {
      mensajesProcesados.set(id, ts);
    }
  }
}

function fechaActualMexico() {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: ZONA_HORARIA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date());
}

function fechaISOActualMexico() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const obj = {};

  for (const p of partes) {
    if (p.type !== "literal") {
      obj[p.type] = p.value;
    }
  }

  return `${obj.year}-${obj.month}-${obj.day}`;
}

function mesActualMexico() {
  const texto = new Intl.DateTimeFormat("es-MX", {
    timeZone: ZONA_HORARIA,
    month: "long",
    year: "numeric"
  }).format(new Date());

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function finMesActualMexico() {
  const [anio, mes] = fechaISOActualMexico()
    .split("-")
    .map(Number);

  const ultimo = new Date(Date.UTC(anio, mes, 0));

  return (
    `${String(ultimo.getUTCDate()).padStart(2, "0")}/` +
    `${String(mes).padStart(2, "0")}/` +
    `${anio}`
  );
}

function formatearDinero(valor) {
  let n =
    typeof valor === "number"
      ? valor
      : Number(String(valor || "").replace(/[^0-9.-]/g, ""));

  if (!Number.isFinite(n)) {
    n = 0;
  }

  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(n);
}

function valorNumero(valor) {
  const n = Number(
    String(valor ?? "").replace(/[$,%\s]/g, "")
  );

  return Number.isFinite(n) ? n : 0;
}

function tituloHoja(sheet) {
  return sheet === "Super" ? "Súper" : sheet;
}

function valorVisible(valor, tipo = "texto") {
  if (estaVacio(valor)) {
    return "⚠️ Falta";
  }

  if (tipo === "dinero") {
    return formatearDinero(valor);
  }

  return String(valor);
}

function siguienteCampoFaltante(sheet, data) {
  return (CAMPOS_REQUERIDOS[sheet] || []).find(
    campo => estaVacio(data?.[campo])
  );
}

function camposFaltantesTicket(registros) {
  return CAMPOS_REQUERIDOS.Super.filter(
    campo =>
      registros.some(
        r => estaVacio(r?.[campo])
      )
  );
}

function descripcionCortaCampo(campo) {
  const mapa = {
    "Fecha de ingreso": "cuándo recibiste el dinero",
    "Tipo de ingreso": "sueldo, bono, vales…",
    "Fecha de pago": "cuándo salió el dinero",
    "Concepto": "qué pagaste",
    "Periodo": "mes al que corresponde",
    "Estado": "Pagado o Pendiente",
    "Fecha de compra": "día de la compra",
    "Producto": "marca o presentación",
    "Producto base": "tipo general, sin marca",
    "Categoría": "grupo del gasto",
    "Monto": "total pagado",
    "Tienda": "lugar de compra",
    "Cantidad": "número de empaques comprados",
    "Unidad": "paquete, caja, bolsa, botella…",
    "Contenido por empaque": "cuánto trae cada empaque",
    "Unidad de comparación": "rollo, litro, kg, pieza…",
    "Precio por unidad": "costo por unidad de comparación"
  };

  return mapa[campo] || "dato del registro";
}

function ejemploCortoCampo(campo) {
  const mapa = {
    "Fecha de ingreso": '"hoy" o "16/08/2026"',
    "Tipo de ingreso": "sueldo, bono, vales",
    "Fecha de pago": '"hoy" o "16/08/2026"',
    "Concepto": "luz, renta, internet",
    "Periodo": "Agosto 2026",
    "Estado": "Pagado / Pendiente",
    "Fecha de compra": '"hoy" o "16/08/2026"',
    "Producto": "Coca-Cola Zero 600 ml",
    "Producto base": "refresco",
    "Categoría": "bebidas",
    "Monto": "120 pesos",
    "Tienda": "Walmart",
    "Cantidad": "1",
    "Unidad": "paquete",
    "Contenido por empaque": "12 rollos → 12; 600 ml → 0.6",
    "Unidad de comparación": "rollo / litro / kilogramo / pieza",
    "Precio por unidad": "$10 por rollo"
  };

  return mapa[campo] || "";
}
function obtenerPregunta(sheet, campo, data = {}) {
  let titulo = `*${campo}* (${descripcionCortaCampo(campo)})`;
  let pregunta = `¿Cuál es el valor?`;

  if (campo === "Monto" && sheet === "Ingresos") {
    pregunta = `¿De cuánto fue${data["Tipo de ingreso"] ? ` el ${data["Tipo de ingreso"]}` : " el ingreso"}?`;
  } else if (campo === "Monto" && sheet === "Pagos") {
    pregunta = `¿Cuánto pagaste${data.Concepto ? ` de ${data.Concepto}` : ""}?`;
  } else if (campo === "Monto" && sheet === "Super") {
    pregunta = `¿Cuánto pagaste en total${data.Producto ? ` por ${data.Producto}` : ""}?`;
  } else if (campo === "Cantidad") {
    pregunta = "¿Cuántos empaques completos compraste?";
  } else if (campo === "Contenido por empaque") {
    pregunta = "¿Cuánto trae cada empaque?";
  } else if (campo === "Unidad de comparación") {
    pregunta = "¿Con qué unidad quieres comparar el precio?";
  }

  const ejemplo = ejemploCortoCampo(campo);

  return [
    `📝 ${titulo}`,
    pregunta,
    ejemplo ? `Ej.: ${ejemplo}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function esSaludoSimple(texto) {
  const t = normalizar(texto)
    .replace(/[!?.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (t.split(" ").filter(Boolean).length > 5) {
    return false;
  }

  return [
    "hola",
    "buenos dias",
    "buen dia",
    "buenas tardes",
    "buenas noches",
    "hey",
    "que tal",
    "que onda"
  ].some(
    s =>
      t === s ||
      t.startsWith(`${s} `)
  );
}

function esAyuda(texto) {
  const t = normalizar(texto);

  return [
    "ayuda",
    "menu",
    "que puedes hacer",
    "que sabes hacer"
  ].includes(t);
}

function respuestaAyuda() {
  return [
    "👋 *Finanzas IA*",
    "Escríbeme como hablas normalmente.",
    "",
    "🛒 *Súper*",
    '“Compré papel Regio en Walmart por 250.”',
    "",
    "💳 *Pagos*",
    '“Pagué la luz de julio, 850 pesos.”',
    "",
    "💰 *Ingresos*",
    '“Recibí mi sueldo de 18,000 hoy.”',
    "",
    "📊 *Reporte*",
    '“Mándame mi reporte de agosto.”',
    "",
    "🏦 *Ahorro*",
    '“Ahorra 10% de mi sueldo.”',
    "",
    "🎯 *Metas*",
    '“Quiero juntar 10,000 para diciembre.”',
    "",
    "Antes de guardar o eliminar algo, siempre te pediré confirmación."
  ].join("\n");
}

function respuestaSi(texto) {
  const t = normalizar(texto);

  return [
    "si",
    "confirmo",
    "confirmar",
    "ok",
    "okay",
    "correcto",
    "adelante",
    "guardalo",
    "hazlo"
  ].includes(t);
}

function respuestaNo(texto) {
  const t = normalizar(texto);

  return [
    "no",
    "cancelar",
    "cancela",
    "cancelalo"
  ].includes(t);
}

function quiereGuardarSinAhorro(texto) {
  const t = normalizar(texto);

  return (
    t.includes("sin ahorro") ||
    t.includes("no ahorrar") ||
    t.includes("nada de ahorro") ||
    t === "nada" ||
    t === "no"
  );
}

function camposParaResumen(sheet) {
  if (sheet === "Ingresos") {
    return [
      "Fecha de ingreso",
      "Tipo de ingreso",
      "Monto",
      "Forma de pago",
      "Notas"
    ];
  }

  if (sheet === "Pagos") {
    return [
      "Fecha de pago",
      "Concepto",
      "Periodo",
      "Monto",
      "Estado",
      "Forma de pago",
      "Notas"
    ];
  }

  return [
    "Fecha de compra",
    "Producto",
    "Producto base",
    "Categoría",
    "Monto",
    "Tienda",
    "Cantidad",
    "Unidad",
    "Contenido por empaque",
    "Unidad de comparación",
    "Precio por unidad",
    "Notas"
  ];
}

function formatearCampo(campo, valor) {
  if (estaVacio(valor)) {
    return "";
  }

  const dinero = [
    "Monto",
    "Precio por unidad",
    "Valor del ahorro",
    "Ahorro realizado",
    "Dinero libre"
  ].includes(campo);

  return `• ${campo}: ${
    dinero
      ? formatearDinero(valor)
      : valor
  }`;
}

function formatearRegistro(sheet, data) {
  return camposParaResumen(sheet)
    .map(
      campo =>
        formatearCampo(
          campo,
          data?.[campo]
        )
    )
    .filter(Boolean)
    .join("\n");
}

function resumenRegistroVisual(sheet, data) {
  const icono =
    sheet === "Ingresos"
      ? "💰"
      : sheet === "Pagos"
        ? "💳"
        : "🛒";

  return [
    `${icono} *${tituloHoja(sheet)}*`,
    SEPARADOR,
    formatearRegistro(sheet, data)
  ].join("\n");
}

function dividirMensaje(texto, limite = 3900) {
  const s = String(texto || "");

  if (s.length <= limite) {
    return [s];
  }

  const partes = [];
  let actual = "";

  for (const bloque of s.split("\n\n")) {
    const candidato =
      actual
        ? `${actual}\n\n${bloque}`
        : bloque;

    if (candidato.length <= limite) {
      actual = candidato;
      continue;
    }

    if (actual) {
      partes.push(actual);
    }

    if (bloque.length <= limite) {
      actual = bloque;
    } else {
      let resto = bloque;

      while (resto.length > limite) {
        let corte =
          resto.lastIndexOf(
            "\n",
            limite
          );

        if (corte < limite * 0.5) {
          corte = limite;
        }

        partes.push(
          resto.slice(
            0,
            corte
          )
        );

        resto = resto
          .slice(corte)
          .replace(
            /^\n+/,
            ""
          );
      }

      actual = resto;
    }
  }

  if (actual) {
    partes.push(actual);
  }

  return partes;
}
async function enviarMensajeWhatsApp(destinatario, texto) {
  const partes = dividirMensaje(texto);
  let ultimo = null;

  for (const parte of partes) {
    const respuesta = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
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
            body: parte
          }
        })
      }
    );

    const datos = await respuesta
      .json()
      .catch(() => ({}));

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

    ultimo = datos;
  }

  return ultimo;
}

function extraerJSON(texto) {
  const limpio = String(texto || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(limpio);
}

async function llamadaGemini({
  systemInstruction,
  parts,
  jsonMode = false
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "Falta GEMINI_API_KEY."
    );
  }

  const body = {
    system_instruction: {
      parts: [
        {
          text: systemInstruction
        }
      ]
    },

    contents: [
      {
        role: "user",
        parts
      }
    ]
  };

  if (jsonMode) {
    body.generationConfig = {
      responseMimeType:
        "application/json",
      temperature: 0.1
    };
  }

  const respuesta = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "x-goog-api-key":
          GEMINI_API_KEY
      },

      body:
        JSON.stringify(body)
    }
  );

  const datos = await respuesta
    .json()
    .catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(
      datos?.error?.message ||
      `Gemini respondió HTTP ${respuesta.status}`
    );

    error.status =
      respuesta.status;

    error.detalle =
      datos;

    throw error;
  }

  const texto =
    datos
      ?.candidates?.[0]
      ?.content?.parts
      ?.map(
        p => p.text
      )
      .filter(Boolean)
      .join("\n")
      .trim();

  if (!texto) {
    throw new Error(
      "Gemini no devolvió texto."
    );
  }

  return texto;
}

function instruccionesFinanzas(
  contextoRegistro = null
) {
  const hoy =
    fechaActualMexico();

  const mesActual =
    mesActualMexico();

  const contexto =
    contextoRegistro
      ? `
OPERACIÓN EN CURSO

Hoja:
${contextoRegistro.sheet}

Datos actuales:
${JSON.stringify(
  contextoRegistro.data || {}
)}

Campo faltante:
${
  siguienteCampoFaltante(
    contextoRegistro.sheet,
    contextoRegistro.data || {}
  ) || "ninguno"
}

Conserva los datos anteriores salvo que el usuario los corrija explícitamente.
`
      : "";

  return `
Eres Finanzas IA, un asistente personal de finanzas por WhatsApp.

RESPONDE ÚNICAMENTE JSON VÁLIDO.
No uses markdown.
No escribas nada fuera del JSON.

Fecha actual en Ciudad de México:
${hoy}

Mes actual:
${mesActual}

REGLAS:

- Entiende lenguaje natural.
- No exijas comandos exactos.
- Nunca inventes montos, tiendas, cantidades, fechas, periodos ni formas de pago.
- Sí puedes inferir Producto base y Categoría cuando sea obvio.
- Si no estás seguro, deja el campo vacío.
- Convierte hoy, ayer, mañana y fechas relativas a DD/MM/AAAA cuando sean claras.
- Si el usuario ya pagó algo, Estado puede ser Pagado.
- Si falta pagarlo, Estado puede ser Pendiente.
- Periodo de Pagos debe ser "Mes AAAA".
- Los montos son números sin signo de pesos.
- Nunca digas que algo ya se guardó o eliminó.
- El sistema hará la confirmación final.

HOJAS:

Ingresos:
Estado,
Fecha de ingreso,
Tipo de ingreso,
Monto,
Forma de pago,
Notas,
Registro de mensaje enviado.

Pagos:
Estado,
Fecha de pago,
Concepto,
Periodo,
Monto,
Forma de pago,
Notas,
Registro de mensaje enviado.

Super:
Estado,
Fecha de compra,
Producto,
Producto base,
Categoría,
Monto,
Tienda,
Cantidad,
Unidad,
Contenido por empaque,
Unidad de comparación,
Precio por unidad,
Notas,
Registro de mensaje enviado.

REGLAS DE SÚPER:

- Producto = artículo específico, marca o presentación.
Ejemplo: Coca-Cola Zero 600 ml.

- Producto base = tipo general comparable.
Ejemplo: refresco.

- Categoría = grupo general.
Ejemplo: bebidas.

- Cantidad = número de empaques completos comprados.
Ejemplo:
Un paquete de 12 rollos => Cantidad = 1.

- Unidad = tipo de empaque:
paquete,
caja,
bolsa,
botella,
lata,
pieza.

- Contenido por empaque = contenido de CADA empaque expresado en Unidad de comparación.

Ejemplos:

12 rollos:
Contenido por empaque = 12
Unidad de comparación = rollo

600 ml:
Contenido por empaque = 0.6
Unidad de comparación = litro

750 g:
Contenido por empaque = 0.75
Unidad de comparación = kilogramo

- No inventes Cantidad, Unidad, Contenido por empaque ni Unidad de comparación.
- Precio por unidad puede quedar vacío.
- El sistema lo calculará automáticamente.

ACCIONES POSIBLES:

1. REGISTRAR

{
  "accion": "registrar",
  "sheet": "Ingresos|Pagos|Super",
  "data": {},
  "respuesta": ""
}

2. ELIMINAR

{
  "accion": "eliminar",
  "sheet": "Ingresos|Pagos|Super",
  "buscar": "texto útil",
  "respuesta": ""
}

3. REPORTE

{
  "accion": "reporte",
  "mes": "Agosto 2026",
  "grafica": false,
  "respuesta": ""
}

4. HISTORIAL DE PRODUCTO

{
  "accion": "historial_producto",
  "producto": "Papel higiénico",
  "meses": 2,
  "respuesta": ""
}

5. CONFIGURAR AHORRO

{
  "accion": "configurar_ahorro",
  "tipoIngreso": "Sueldo",
  "modo": "Porcentaje|Monto fijo|Apagado",
  "valor": 10,
  "alcance": "permanente|este_mes|una_vez",
  "respuesta": ""
}

6. META DE AHORRO

{
  "accion": "meta_ahorro",
  "meta": "Fondo fin de año",
  "montoObjetivo": 10000,
  "fechaObjetivo": "31/12/2026",
  "respuesta": ""
}

7. VER METAS

{
  "accion": "metas_resumen",
  "respuesta": ""
}

8. CANCELAR

{
  "accion": "cancelar",
  "respuesta": "Operación cancelada."
}

9. CONVERSAR

{
  "accion": "conversar",
  "respuesta": "Respuesta breve, clara y natural."
}

${contexto}
`.trim();
}

async function interpretarConGemini(
  textoUsuario,
  contextoRegistro = null
) {
  const texto =
    await llamadaGemini({
      systemInstruction:
        instruccionesFinanzas(
          contextoRegistro
        ),

      parts: [
        {
          text:
            textoUsuario
        }
      ],

      jsonMode:
        true
    });

  console.log(
    "JSON Gemini:",
    texto
  );

  return extraerJSON(
    texto
  );
}

async function transcribirAudio(
  buffer,
  mimeType
) {
  return llamadaGemini({
    systemInstruction:
      "Transcribe este audio en español de forma fiel. Devuelve únicamente el texto transcrito, sin comentarios.",

    parts: [
      {
        inline_data: {
          mime_type:
            mimeType ||
            "audio/ogg",

          data:
            buffer.toString(
              "base64"
            )
        }
      },

      {
        text:
          "Conserva números, fechas, nombres de tiendas y cantidades con precisión."
      }
    ],

    jsonMode:
      false
  });
}

async function interpretarImagen(
  buffer,
  mimeType
) {
  const systemInstruction = `
Analiza una foto enviada a Finanzas IA.

RESPONDE ÚNICAMENTE JSON VÁLIDO.

Fecha actual:
${fechaActualMexico()}

Si es ticket de supermercado:

{
  "accion": "ticket_super",
  "tienda": "",
  "fecha": "",
  "total": 0,
  "items": [
    {
      "Producto": "",
      "Producto base": "",
      "Categoría": "",
      "Monto": 0,
      "Cantidad": "",
      "Unidad": "",
      "Contenido por empaque": "",
      "Unidad de comparación": "",
      "Precio por unidad": ""
    }
  ]
}

REGLAS:

- Extrae solo lo visible o inferible con seguridad.
- No inventes.
- Producto conserva marca o presentación cuando pueda identificarse.
- Producto base es el tipo general.
- Categoría es el grupo general.
- Cantidad es cuántos empaques completos se compraron.
- Unidad es paquete, caja, bolsa, botella, lata, pieza, etc.
- Contenido por empaque se expresa en una unidad práctica de comparación.

Ejemplos:

12 rollos:
Contenido por empaque = 12
Unidad de comparación = rollo

600 ml:
Contenido por empaque = 0.6
Unidad de comparación = litro

750 g:
Contenido por empaque = 0.75
Unidad de comparación = kilogramo

- Si no estás seguro de presentación, cantidad, unidad o contenido, déjalos vacíos.
- Deja Precio por unidad vacío.
- El sistema lo calculará.
- Fecha debe ser DD/MM/AAAA.
- Si no se ve, déjala vacía.
- Si no se identifica la tienda, déjala vacía.

Si es recibo o comprobante de pago:

{
  "accion": "ticket_pago",
  "data": {
    "Fecha de pago": "",
    "Concepto": "",
    "Periodo": "",
    "Monto": "",
    "Estado": ""
  }
}

- Si prueba que ya fue pagado:
Estado = Pagado.

- Si no demuestra pago:
deja Estado vacío.

Si no puedes clasificarlo:

{
  "accion": "imagen_desconocida",
  "descripcion": "qué alcanzas a leer"
}
`.trim();

  const texto =
    await llamadaGemini({
      systemInstruction,

      parts: [
        {
          inline_data: {
            mime_type:
              mimeType ||
              "image/jpeg",

            data:
              buffer.toString(
                "base64"
              )
          }
        },

        {
          text:
            "Extrae la información financiera siguiendo exactamente el esquema."
        }
      ],

      jsonMode:
        true
    });

  console.log(
    "JSON imagen Gemini:",
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
    ...(anteriores || {})
  };

  if (
    nuevos &&
    typeof nuevos === "object"
  ) {
    for (
      const [campo, valor]
      of Object.entries(nuevos)
    ) {
      if (
        !estaVacio(valor) ||
        valor === ""
      ) {
        resultado[campo] =
          valor;
      }
    }
  }

  return resultado;
}

function completarDatosCalculados(
  sheet,
  data,
  mensajeOriginal = ""
) {
  const resultado = {
    ...(data || {})
  };

  if (
    mensajeOriginal &&
    estaVacio(
      resultado[
        "Registro de mensaje enviado"
      ]
    )
  ) {
    resultado[
      "Registro de mensaje enviado"
    ] =
      mensajeOriginal;
  }

  if (
    sheet === "Super"
  ) {
    const monto =
      valorNumero(
        resultado.Monto
      );

    const cantidad =
      valorNumero(
        resultado.Cantidad
      );

    const contenido =
      valorNumero(
        resultado[
          "Contenido por empaque"
        ]
      );

    const unidades =
      cantidad *
      contenido;

    if (
      monto > 0 &&
      cantidad > 0 &&
      contenido > 0 &&
      unidades > 0
    ) {
      resultado[
        "Precio por unidad"
      ] =
        Math.round(
          (
            monto /
            unidades
          ) *
          100
        ) /
        100;
    } else if (
      [
        "",
        undefined,
        null
      ].includes(
        resultado[
          "Precio por unidad"
        ]
      )
    ) {
      resultado[
        "Precio por unidad"
      ] = "";
    }
  }

  return resultado;
}
async function llamarAppsScript(payload) {
  if (!APPS_SCRIPT_URL) throw new Error("Falta APPS_SCRIPT_URL.");
  if (!APPS_SCRIPT_SECRET) throw new Error("Falta APPS_SCRIPT_SECRET.");

  const respuesta = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      secret: APPS_SCRIPT_SECRET,
      ...payload
    }),
    redirect: "follow"
  });

  const texto = await respuesta.text();

  console.log(
    "Respuesta Apps Script:",
    texto
  );

  let datos;

  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error(
      "Apps Script no devolvió JSON. Respuesta: " +
      texto.slice(0, 200)
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

async function obtenerMediaWhatsApp(mediaId) {
  const respuesta = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    {
      headers: {
        Authorization:
          `Bearer ${WHATSAPP_TOKEN}`
      }
    }
  );

  const datos = await respuesta
    .json()
    .catch(() => ({}));

  if (
    !respuesta.ok ||
    !datos.url
  ) {
    throw new Error(
      datos?.error?.message ||
      "No pude obtener la URL del archivo de WhatsApp."
    );
  }

  const descarga = await fetch(
    datos.url,
    {
      headers: {
        Authorization:
          `Bearer ${WHATSAPP_TOKEN}`
      }
    }
  );

  if (!descarga.ok) {
    throw new Error(
      `No pude descargar el archivo de WhatsApp. HTTP ${descarga.status}`
    );
  }

  return {
    buffer:
      Buffer.from(
        await descarga.arrayBuffer()
      ),

    mimeType:
      datos.mime_type ||
      descarga.headers.get(
        "content-type"
      ) ||
      "application/octet-stream"
  };
}

const buscarParaEliminar =
  (sheet, buscar) =>
    llamarAppsScript({
      action: "buscar_eliminar",
      sheet,
      buscar
    });

const eliminarEnSheets =
  (sheet, seleccion) =>
    llamarAppsScript({
      action: "eliminar",
      sheet,
      fila: seleccion.fila,
      esperado: seleccion.data
    });

const guardarEnSheets =
  (sheet, data) =>
    llamarAppsScript({
      action: "registrar",
      sheet,
      data
    });

const buscarSimilares =
  (sheet, data) =>
    llamarAppsScript({
      action: "buscar_similares",
      sheet,
      data
    });

const consultarReporte =
  mes =>
    llamarAppsScript({
      action: "reporte",
      mes
    });

const consultarHistorialProducto =
  (producto, meses) =>
    llamarAppsScript({
      action:
        "historial_producto",
      producto,
      meses
    });

const listarConfig =
  () =>
    llamarAppsScript({
      action: "config_listar"
    });

const guardarConfig =
  data =>
    llamarAppsScript({
      action: "config_guardar",
      data
    });

const guardarAhorro =
  data =>
    llamarAppsScript({
      action: "ahorro_guardar",
      data
    });

const guardarMeta =
  data =>
    llamarAppsScript({
      action: "meta_guardar",
      data
    });

const consultarMetas =
  () =>
    llamarAppsScript({
      action: "metas_resumen"
    });

function fechaComparableDDMMYYYY(texto) {
  const m =
    String(texto || "")
      .match(
        /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
      );

  if (!m) {
    return null;
  }

  return (
    `${m[3]}-` +
    `${String(m[2]).padStart(2, "0")}-` +
    `${String(m[1]).padStart(2, "0")}`
  );
}

function reglaEstaVigente(regla) {
  const activo =
    normalizar(
      regla.Activo
    );

  if (
    activo &&
    [
      "no",
      "false",
      "inactivo",
      "apagado"
    ].includes(activo)
  ) {
    return false;
  }

  const hoy =
    fechaISOActualMexico();

  const desde =
    fechaComparableDDMMYYYY(
      regla.Desde
    );

  const hasta =
    fechaComparableDDMMYYYY(
      regla.Hasta
    );

  if (
    desde &&
    hoy < desde
  ) {
    return false;
  }

  if (
    hasta &&
    hoy > hasta
  ) {
    return false;
  }

  return true;
}

async function obtenerReglaAhorro(tipoIngreso) {
  const resultado =
    await listarConfig();

  const tipo =
    normalizar(
      tipoIngreso
    );

  const reglas =
    (
      resultado.registros ||
      []
    ).filter(
      r =>
        normalizar(r.Tipo) ===
          "ahorro" &&
        normalizar(r.Clave) ===
          tipo &&
        reglaEstaVigente(r)
    );

  return reglas.length
    ? reglas[
        reglas.length - 1
      ]
    : null;
}

function calcularAhorro(
  montoIngreso,
  modo,
  valor
) {
  const monto =
    valorNumero(
      montoIngreso
    );

  const v =
    valorNumero(
      valor
    );

  const m =
    normalizar(
      modo
    );

  if (
    m === "apagado"
  ) {
    return 0;
  }

  if (
    m === "porcentaje"
  ) {
    return (
      Math.round(
        (
          monto *
          v /
          100
        ) *
        100
      ) /
      100
    );
  }

  if (
    [
      "monto fijo",
      "monto"
    ].includes(m)
  ) {
    return (
      Math.round(
        v *
        100
      ) /
      100
    );
  }

  return 0;
}

function descripcionReglaAhorro(
  modo,
  valor
) {
  const m =
    normalizar(
      modo
    );

  if (
    m === "porcentaje"
  ) {
    return (
      `${valorNumero(valor)}%`
    );
  }

  if (
    [
      "monto fijo",
      "monto"
    ].includes(m)
  ) {
    return (
      formatearDinero(
        valor
      )
    );
  }

  return "Sin ahorro";
}

function detectarAhorroRapido(texto) {
  const t =
    normalizar(
      texto
    );

  const porcentaje =
    t.match(
      /(\d+(?:[.,]\d+)?)\s*%/
    );

  if (porcentaje) {
    return {
      modo:
        "Porcentaje",

      valor:
        Number(
          porcentaje[1]
            .replace(
              ",",
              "."
            )
        )
    };
  }

  const monto =
    String(texto)
      .match(
        /(?:\$|mxn\s*)?(\d[\d,.\s]*)\s*(?:pesos?)?/i
      );

  if (monto) {
    const n =
      Number(
        monto[1]
          .replace(
            /\s/g,
            ""
          )
          .replace(
            /,/g,
            ""
          )
      );

    if (
      Number.isFinite(n)
    ) {
      return {
        modo:
          "Monto fijo",

        valor:
          n
      };
    }
  }

  return null;
}

function detectarAlcance(texto) {
  const t =
    normalizar(
      texto
    );

  if (
    t.includes(
      "solo esta vez"
    ) ||
    t.includes(
      "esta vez"
    ) ||
    t.includes(
      "una vez"
    )
  ) {
    return "una_vez";
  }

  if (
    t.includes(
      "este mes"
    ) ||
    t.includes(
      "solo este mes"
    )
  ) {
    return "este_mes";
  }

  if (
    t.includes(
      "de ahora en adelante"
    ) ||
    t.includes(
      "a partir de hoy"
    ) ||
    t.includes(
      "siempre"
    ) ||
    t.includes(
      "permanente"
    )
  ) {
    return "permanente";
  }

  return null;
}

function construirConfigAhorro({
  tipoIngreso,
  modo,
  valor,
  alcance,
  mensajeOriginal
}) {
  const data = {
    Tipo:
      "Ahorro",

    Clave:
      tipoIngreso,

    Modo:
      modo,

    Valor:
      normalizar(
        modo
      ) ===
      "apagado"
        ? 0
        : valor,

    Desde:
      fechaActualMexico(),

    Hasta:
      "",

    Activo:
      "Sí",

    Notas:
      mensajeOriginal ||
      ""
  };

  if (
    alcance ===
    "este_mes"
  ) {
    data.Hasta =
      finMesActualMexico();
  }

  return data;
}

function resumenDuplicados(
  coincidencias
) {
  if (
    !coincidencias?.length
  ) {
    return "";
  }

  const lista =
    coincidencias
      .slice(
        0,
        3
      )
      .map(
        (
          item,
          i
        ) => {
          const d =
            item.data ||
            {};

          const nombre =
            d.Producto ||
            d.Concepto ||
            d[
              "Tipo de ingreso"
            ] ||
            d.ID ||
            "Registro";

          const fecha =
            d[
              "Fecha de compra"
            ] ||
            d[
              "Fecha de pago"
            ] ||
            d[
              "Fecha de ingreso"
            ] ||
            "";

          const monto =
            !estaVacio(
              d.Monto
            )
              ? ` · ${formatearDinero(
                  d.Monto
                )}`
              : "";

          return (
            `${i + 1}. ` +
            `${nombre}` +
            `${monto}` +
            `${
              fecha
                ? ` · ${fecha}`
                : ""
            }`
          );
        }
      )
      .join("\n");

  return (
    "\n\n⚠️ *Posible duplicado*\n" +
    lista +
    "\nSi confirmas, se guardará de todos modos."
  );
}

async function prepararConfirmacionRegistro(
  remitente,
  sheet,
  data,
  mensajeOriginal = ""
) {
  const completos =
    completarDatosCalculados(
      sheet,
      data,
      mensajeOriginal
    );

  const faltante =
    siguienteCampoFaltante(
      sheet,
      completos
    );

  if (faltante) {
    guardarSesion(
      remitente,
      {
        tipo:
          "registro",

        sheet,

        data:
          completos,

        mensajeOriginal
      }
    );

    return obtenerPregunta(
      sheet,
      faltante,
      completos
    );
  }

  let duplicados = [];

  try {
    const r =
      await buscarSimilares(
        sheet,
        completos
      );

    duplicados =
      r.coincidencias ||
      [];
  } catch (error) {
    console.error(
      "No se pudo revisar duplicados:",
      error
    );
  }

  let reglaAhorro =
    null;

  let ahorroCalculado =
    0;

  if (
    sheet ===
    "Ingresos"
  ) {
    try {
      reglaAhorro =
        await obtenerReglaAhorro(
          completos[
            "Tipo de ingreso"
          ]
        );

      if (reglaAhorro) {
        ahorroCalculado =
          calcularAhorro(
            completos.Monto,
            reglaAhorro.Modo,
            reglaAhorro.Valor
          );
      }
    } catch (error) {
      console.error(
        "No se pudo consultar regla de ahorro:",
        error
      );
    }
  }

  guardarSesion(
    remitente,
    {
      tipo:
        "registro_confirmacion",

      sheet,

      data:
        completos,

      mensajeOriginal,

      duplicados,

      reglaAhorro,

      ahorroCalculado
    }
  );

  let texto = [
    "✅ *Antes de guardar, revisa*",
    resumenRegistroVisual(
      sheet,
      completos
    )
  ].join("\n\n");

  if (
    sheet ===
    "Ingresos"
  ) {
    const tipo =
      completos[
        "Tipo de ingreso"
      ];

    if (
      reglaAhorro &&
      normalizar(
        reglaAhorro.Modo
      ) !==
        "apagado"
    ) {
      texto +=
        `\n\n🏦 *Ahorro*\n` +
        `Regla: ${descripcionReglaAhorro(
          reglaAhorro.Modo,
          reglaAhorro.Valor
        )}\n` +
        `Se separarían: ${formatearDinero(
          ahorroCalculado
        )}`;

    } else if (
      reglaAhorro
    ) {
      texto +=
        `\n\n🏦 *Ahorro*\n` +
        `Sin ahorro para ${tipo}.`;

    } else {
      texto +=
        `\n\n🏦 *Ahorro*\n` +
        `No hay regla para ${tipo}. Después de guardar puedes crear una.`;
    }
  }

  texto +=
    resumenDuplicados(
      duplicados
    );

  texto +=
    "\n\n¿Está correcto?\n✅ Sí\n✏️ No, corregir";

  return texto;
}

async function guardarAhorroDeIngreso(
  dataIngreso,
  monto,
  nota
) {
  if (
    valorNumero(
      monto
    ) <= 0
  ) {
    return null;
  }

  return guardarAhorro({
    Fecha:
      dataIngreso[
        "Fecha de ingreso"
      ],

    "Tipo de ingreso":
      dataIngreso[
        "Tipo de ingreso"
      ],

    Monto:
      monto,

    Meta:
      "",

    Notas:
      nota ||
      "Ahorro automático",

    "Registro de mensaje enviado":
      dataIngreso[
        "Registro de mensaje enviado"
      ] ||
      "",

    Estado:
      "Activo"
  });
}

async function procesarRegistroConfirmacion(
  textoUsuario,
  remitente,
  sesion
) {
  const t =
    normalizar(
      textoUsuario
    );

  if (
    t === "cancelar" ||
    t === "cancela"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      "Operación cancelada."
    );
  }

  if (
    t === "no"
  ) {
    guardarSesion(
      remitente,
      {
        tipo:
          "registro_correccion",

        sheet:
          sesion.sheet,

        data:
          sesion.data,

        mensajeOriginal:
          sesion.mensajeOriginal
      }
    );

    return [
      "✏️ *Vamos a corregir el registro*",
      "Dime qué dato cambia.",
      'Ej.: “monto 350” o “fecha mañana”.'
    ].join("\n");
  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {
    return (
      "Responde *sí* para guardar, *no* para corregir o *cancelar*."
    );
  }

  const resultado =
    await guardarEnSheets(
      sesion.sheet,
      sesion.data
    );

  if (
    sesion.sheet !==
    "Ingresos"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      `✅ Listo. Guardé el registro con ID *${resultado.id}*.`
    );
  }

  if (
    sesion.reglaAhorro
  ) {
    const ahorro =
      Number(
        sesion.ahorroCalculado ||
        0
      );

    if (
      normalizar(
        sesion.reglaAhorro.Modo
      ) !==
        "apagado" &&
      ahorro > 0
    ) {
      await guardarAhorroDeIngreso(
        sesion.data,
        ahorro,
        `Regla aplicada: ${descripcionReglaAhorro(
          sesion.reglaAhorro.Modo,
          sesion.reglaAhorro.Valor
        )}`
      );

      sesiones.delete(
        remitente
      );

      return (
        `✅ Ingreso guardado: *${resultado.id}*\n` +
        `🏦 Ahorro separado: *${formatearDinero(
          ahorro
        )}*`
      );
    }

    sesiones.delete(
      remitente
    );

    return (
      `✅ Ingreso guardado: *${resultado.id}*\n` +
      "🏦 La regla actual indica sin ahorro."
    );
  }

  guardarSesion(
    remitente,
    {
      tipo:
        "ahorro_sin_regla",

      ingreso:
        sesion.data,

      ingresoId:
        resultado.id
    }
  );

  return [
    `✅ Ingreso guardado: *${resultado.id}*`,
    "",
    `🏦 No tienes regla de ahorro para *${sesion.data["Tipo de ingreso"]}*.`,
    "¿Quieres crear una?",
    'Ej.: “10%”, “2000 pesos” o “no”.'
  ].join("\n");
}

async function procesarCorreccionRegistro(
  textoUsuario,
  remitente,
  sesion
) {
  if (
    normalizar(
      textoUsuario
    ) ===
    "cancelar"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      "Operación cancelada."
    );
  }

  const interpretacion =
    await interpretarConGemini(
      textoUsuario,
      {
        sheet:
          sesion.sheet,

        data:
          sesion.data
      }
    );

  if (
    interpretacion.accion ===
    "cancelar"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      "Operación cancelada."
    );
  }

  const nuevosDatos =
    completarDatosCalculados(
      sesion.sheet,
      combinarDatos(
        sesion.data,
        interpretacion.data ||
        {}
      ),
      sesion.mensajeOriginal
    );

  return prepararConfirmacionRegistro(
    remitente,
    sesion.sheet,
    nuevosDatos,
    sesion.mensajeOriginal
  );
}

async function procesarRegistroPendiente(
  textoUsuario,
  remitente,
  sesion
) {
  if (
    normalizar(
      textoUsuario
    ) ===
    "cancelar"
  ) {
    sesiones.delete(
      remitente
    );

    return (
      "Operación cancelada."
    );
  }

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
      "Operación cancelada."
    );
  }

  const nuevosDatos =
    completarDatosCalculados(
      sesion.sheet,
      combinarDatos(
        sesion.data,
        interpretacion.data ||
        {}
      ),
      sesion.mensajeOriginal ||
      textoUsuario
    );

  const faltante =
    siguienteCampoFaltante(
      sesion.sheet,
      nuevosDatos
    );

  if (faltante) {
    guardarSesion(
      remitente,
      {
        tipo:
          "registro",

        sheet:
          sesion.sheet,

        data:
          nuevosDatos,

        mensajeOriginal:
          sesion.mensajeOriginal
      }
    );

    return obtenerPregunta(
      sesion.sheet,
      faltante,
      nuevosDatos
    );
  }

  return prepararConfirmacionRegistro(
    remitente,
    sesion.sheet,
    nuevosDatos,
    sesion.mensajeOriginal
  );
}
async function procesarAhorroSinRegla(
  textoUsuario,
  remitente,
  sesion
) {
  if (
    quiereGuardarSinAhorro(
      textoUsuario
    )
  ) {
    sesiones.delete(
      remitente
    );

    return (
      "✅ Entendido. Este ingreso queda sin ahorro."
    );
  }

  const reglaRapida =
    detectarAhorroRapido(
      textoUsuario
    );

  if (!reglaRapida) {
    return [
      "🏦 *¿Cuánto quieres ahorrar?*",
      'Ej.: “10%” o “1500 pesos”.',
      'Si no quieres ahorrar, responde “no”.'
    ].join("\n");
  }

  const alcance =
    detectarAlcance(
      textoUsuario
    );

  if (!alcance) {
    guardarSesion(
      remitente,
      {
        tipo:
          "ahorro_alcance",

        ingreso:
          sesion.ingreso,

        ingresoId:
          sesion.ingresoId,

        regla:
          reglaRapida
      }
    );

    return [
      `🏦 Ahorro: *${descripcionReglaAhorro(
        reglaRapida.modo,
        reglaRapida.valor
      )}*`,
      "",
      "¿Durante cuánto tiempo?",
      "1. Solo esta vez",
      "2. Solo este mes",
      "3. De ahora en adelante"
    ].join("\n");
  }

  return aplicarAhorroNuevo(
    remitente,
    sesion.ingreso,
    reglaRapida,
    alcance
  );
}

async function procesarAhorroAlcance(
  textoUsuario,
  remitente,
  sesion
) {
  let alcance =
    detectarAlcance(
      textoUsuario
    );

  const t =
    normalizar(
      textoUsuario
    );

  if (!alcance) {
    if (t === "1") {
      alcance =
        "una_vez";
    }

    if (t === "2") {
      alcance =
        "este_mes";
    }

    if (t === "3") {
      alcance =
        "permanente";
    }
  }

  if (!alcance) {
    return [
      "Elige una opción:",
      "1. Solo esta vez",
      "2. Solo este mes",
      "3. De ahora en adelante"
    ].join("\n");
  }

  return aplicarAhorroNuevo(
    remitente,
    sesion.ingreso,
    sesion.regla,
    alcance
  );
}

async function aplicarAhorroNuevo(
  remitente,
  ingreso,
  regla,
  alcance
) {
  const monto =
    calcularAhorro(
      ingreso.Monto,
      regla.modo,
      regla.valor
    );

  if (monto <= 0) {
    sesiones.delete(
      remitente
    );

    return (
      "El ahorro calculado es $0.00. No hice ningún movimiento."
    );
  }

  if (
    alcance !==
    "una_vez"
  ) {
    await guardarConfig(
      construirConfigAhorro({
        tipoIngreso:
          ingreso[
            "Tipo de ingreso"
          ],

        modo:
          regla.modo,

        valor:
          regla.valor,

        alcance,

        mensajeOriginal:
          ingreso[
            "Registro de mensaje enviado"
          ] ||
          ""
      })
    );
  }

  await guardarAhorroDeIngreso(
    ingreso,
    monto,
    alcance ===
      "una_vez"
      ? "Ahorro solo para este ingreso"
      : `Nueva regla: ${descripcionReglaAhorro(
          regla.modo,
          regla.valor
        )}`
  );

  sesiones.delete(
    remitente
  );

  const alcanceTexto =
    alcance ===
      "una_vez"
      ? "Solo esta vez"
      : alcance ===
          "este_mes"
        ? "Durante este mes"
        : "De ahora en adelante";

  return [
    "✅ *Ahorro registrado*",
    SEPARADOR,
    `Monto: *${formatearDinero(
      monto
    )}*`,
    `Regla: ${descripcionReglaAhorro(
      regla.modo,
      regla.valor
    )}`,
    `Alcance: ${alcanceTexto}`
  ].join("\n");
}

function construirResumenConfiguracion(
  datos
) {
  const apagado =
    normalizar(
      datos.modo
    ) ===
    "apagado";

  return [
    "🏦 *Regla de ahorro*",
    SEPARADOR,
    `Ingreso: ${datos.tipoIngreso}`,
    apagado
      ? "Ahorro: Apagado"
      : `Ahorro: ${descripcionReglaAhorro(
          datos.modo,
          datos.valor
        )}`,
    `Alcance: ${
      datos.alcance ===
      "este_mes"
        ? "Solo este mes"
        : "De ahora en adelante"
    }`
  ].join("\n");
}

async function iniciarConfiguracionAhorro(
  interpretacion,
  remitente,
  textoOriginal
) {
  const tipoIngreso =
    String(
      interpretacion.tipoIngreso ||
      ""
    ).trim();

  const modo =
    String(
      interpretacion.modo ||
      ""
    ).trim();

  const alcance =
    interpretacion.alcance ||
    "permanente";

  if (!tipoIngreso) {
    return [
      "🏦 *¿Para qué ingreso?*",
      "Ej.: sueldo, bono o vales."
    ].join("\n");
  }

  if (
    ![
      "porcentaje",
      "monto fijo",
      "apagado"
    ].includes(
      normalizar(modo)
    )
  ) {
    return [
      "🏦 *¿Cómo quieres ahorrar?*",
      "• Porcentaje",
      "• Monto fijo",
      "• Apagar ahorro"
    ].join("\n");
  }

  if (
    normalizar(modo) !==
      "apagado" &&
    estaVacio(
      interpretacion.valor
    )
  ) {
    return [
      "🏦 *¿Cuánto quieres ahorrar?*",
      'Ej.: “10%” o “2000 pesos”.'
    ].join("\n");
  }

  if (
    alcance ===
    "una_vez"
  ) {
    return (
      "Para ahorrar solo una vez, indícalo cuando registremos ese ingreso."
    );
  }

  const datos = {
    tipoIngreso,
    modo,

    valor:
      normalizar(modo) ===
        "apagado"
        ? 0
        : interpretacion.valor,

    alcance,

    mensajeOriginal:
      textoOriginal
  };

  guardarSesion(
    remitente,
    {
      tipo:
        "config_ahorro_confirmacion",

      datos
    }
  );

  return [
    "✅ *Revisa antes de guardar*",
    "",
    construirResumenConfiguracion(
      datos
    ),
    "",
    "¿Está correcto?",
    "✅ Sí",
    "❌ No"
  ].join("\n");
}

async function procesarConfigAhorroConfirmacion(
  textoUsuario,
  remitente,
  sesion
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
      "No hice cambios en tu regla de ahorro."
    );
  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {
    return (
      "Responde *sí* para guardar o *no* para cancelar."
    );
  }

  await guardarConfig(
    construirConfigAhorro(
      sesion.datos
    )
  );

  sesiones.delete(
    remitente
  );

  return (
    "✅ Regla de ahorro guardada."
  );
}

async function iniciarMetaAhorro(
  interpretacion,
  remitente,
  textoOriginal
) {
  if (
    estaVacio(
      interpretacion.meta
    ) ||
    estaVacio(
      interpretacion.montoObjetivo
    ) ||
    estaVacio(
      interpretacion.fechaObjetivo
    )
  ) {
    return [
      "🎯 *Para crear una meta necesito:*",
      "• Qué quieres lograr",
      "• Cuánto quieres juntar",
      "• Para qué fecha",
      "",
      'Ej.: “Quiero juntar 10,000 para vacaciones en diciembre”.'
    ].join("\n");
  }

  const datos = {
    Meta:
      interpretacion.meta,

    "Monto objetivo":
      interpretacion.montoObjetivo,

    "Fecha objetivo":
      interpretacion.fechaObjetivo,

    Ahorrado:
      0,

    Estado:
      "Activa",

    Notas:
      textoOriginal ||
      ""
  };

  guardarSesion(
    remitente,
    {
      tipo:
        "meta_confirmacion",

      datos
    }
  );

  return [
    "🎯 *Nueva meta*",
    SEPARADOR,
    `Meta: ${datos.Meta}`,
    `Objetivo: ${formatearDinero(
      datos[
        "Monto objetivo"
      ]
    )}`,
    `Fecha: ${
      datos[
        "Fecha objetivo"
      ]
    }`,
    "",
    "¿Está correcto?",
    "✅ Sí",
    "❌ No"
  ].join("\n");
}

async function procesarMetaConfirmacion(
  textoUsuario,
  remitente,
  sesion
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
      "No guardé la meta."
    );
  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {
    return (
      "Responde *sí* para crear la meta o *no* para cancelar."
    );
  }

  const resultado =
    await guardarMeta(
      sesion.datos
    );

  sesiones.delete(
    remitente
  );

  return (
    `✅ Meta creada con ID *${resultado.id}*.`
  );
}

function formatearMetas(
  metas
) {
  if (
    !Array.isArray(
      metas
    ) ||
    metas.length === 0
  ) {
    return (
      "🎯 Todavía no tienes metas de ahorro."
    );
  }

  return [
    "🎯 *Mis metas de ahorro*",
    "",
    metas
      .map(
        (
          meta,
          i
        ) => {
          const avance =
            estaVacio(
              meta["Avance %"]
            )
              ? "0"
              : meta[
                  "Avance %"
                ];

          return [
            `${i + 1}. *${meta.Meta}*`,
            `Meta: ${formatearDinero(
              meta[
                "Monto objetivo"
              ]
            )}`,
            `Ahorrado: ${formatearDinero(
              meta[
                "Ahorro acumulado"
              ]
            )}`,
            `Avance: ${avance}%`,
            `Falta: ${formatearDinero(
              meta.Falta
            )}`,
            `Fecha: ${
              meta[
                "Fecha objetivo"
              ] ||
              "Sin fecha"
            }`
          ].join("\n");
        }
      )
      .join(
        `\n\n${SEPARADOR}\n\n`
      )
  ].join("\n");
}

function formatearHistorial(
  resultado
) {
  const registros =
    resultado.registros ||
    [];

  if (
    registros.length ===
    0
  ) {
    return (
      `No encontré compras de *${resultado.producto}* ` +
      `en los últimos ${resultado.meses} meses.`
    );
  }

  const lineas =
    registros.map(
      (
        r,
        i
      ) => {
        const unidad =
          r[
            "Unidad de comparación"
          ] ||
          r.Unidad ||
          "unidad";

        const precio =
          !estaVacio(
            r[
              "Precio por unidad"
            ]
          )
            ? `\nPrecio por ${unidad}: ${formatearDinero(
                r[
                  "Precio por unidad"
                ]
              )}`
            : "";

        return [
          `${i + 1}. *${r.Producto || resultado.producto}*`,
          `Fecha: ${
            r[
              "Fecha de compra"
            ] ||
            "—"
          }`,
          `Tienda: ${
            r.Tienda ||
            "—"
          }`,
          `Monto: ${formatearDinero(
            r.Monto
          )}${precio}`
        ].join("\n");
      }
    );

  return [
    `📈 *Historial · ${resultado.producto}*`,
    `Últimos ${resultado.meses} meses`,
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ].join("\n");
}

function formatearReporte(
  reporte
) {
  return [
    `📊 *Reporte · ${reporte.Mes}*`,
    SEPARADOR,
    "",
    "💰 *Entradas*",
    `Ingresos: ${formatearDinero(
      reporte[
        "Total de ingresos"
      ]
    )}`,
    "",
    "💸 *Salidas*",
    `Pagos: ${formatearDinero(
      reporte[
        "Total pagos"
      ]
    )}`,
    `Súper: ${formatearDinero(
      reporte[
        "Total super"
      ]
    )}`,
    `Otros gastos: ${formatearDinero(
      reporte[
        "Otros gastos"
      ]
    )}`,
    `Gastos totales: ${formatearDinero(
      reporte[
        "Gastos totales"
      ]
    )}`,
    "",
    "🏦 *Ahorro*",
    `Ahorro realizado: ${formatearDinero(
      reporte[
        "Ahorro realizado"
      ]
    )}`,
    "",
    "📌 *Situación actual*",
    `Pagos pendientes: ${formatearDinero(
      reporte[
        "Pagos pendientes"
      ]
    )}`,
    `Saldo: ${formatearDinero(
      reporte[
        "Saldo final"
      ]
    )}`,
    `Dinero libre: *${formatearDinero(
      reporte[
        "Dinero libre"
      ]
    )}*`
  ].join("\n");
}

async function procesarReporte(
  mes,
  quiereGrafica = false
) {
  const resultado =
    await consultarReporte(
      mes
    );

  const reportes =
    resultado.reportes ||
    [];

  if (
    reportes.length ===
    0
  ) {
    return (
      `📊 No encontré información para *${mes}*.`
    );
  }

  let texto =
    reportes
      .map(
        formatearReporte
      )
      .join(
        "\n\n"
      );

  if (
    quiereGrafica
  ) {
    texto +=
      "\n\n📈 El reporte usa estos mismos datos para la vista gráfica.";
  }

  return texto;
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
    coincidencias.length ===
    0
  ) {
    return (
      `🔎 No encontré registros que coincidan con *${buscar}* en ${tituloHoja(sheet)}.`
    );
  }

  if (
    coincidencias.length ===
    1
  ) {
    const seleccion =
      coincidencias[0];

    guardarSesion(
      remitente,
      {
        tipo:
          "eliminar_confirmacion",

        sheet,

        seleccion
      }
    );

    return [
      "🗑️ *Encontré este registro*",
      "",
      resumenRegistroVisual(
        sheet,
        seleccion.data
      ),
      "",
      "¿Quieres eliminarlo?",
      "✅ Sí",
      "❌ No"
    ].join("\n");
  }

  guardarSesion(
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
          [
            `*${indice + 1}.*`,
            formatearRegistro(
              sheet,
              item.data
            )
          ].join("\n")
      )
      .join(
        `\n\n${SEPARADOR}\n\n`
      );

  return [
    `🔎 Encontré *${coincidencias.length} registros*`,
    "",
    lista,
    "",
    "¿Cuál quieres eliminar?",
    "Responde con el número."
  ].join("\n");
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
      String(
        textoUsuario
      ).match(
        /\d+/
      );

    if (
      !coincidencia
    ) {
      return (
        `Escribe un número del 1 al ${sesion.coincidencias.length}.`
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

    guardarSesion(
      remitente,
      {
        tipo:
          "eliminar_confirmacion",

        sheet:
          sesion.sheet,

        seleccion
      }
    );

    return [
      "🗑️ *Voy a eliminar este registro*",
      "",
      resumenRegistroVisual(
        sesion.sheet,
        seleccion.data
      ),
      "",
      "¿Confirmas?",
      "✅ Sí",
      "❌ No"
    ].join("\n");
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
        "Responde *sí* para eliminar o *no* para cancelar."
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

    return [
      "✅ *Registro eliminado*",
      "",
      resumenRegistroVisual(
        sesion.sheet,
        resultado.eliminado
      )
    ].join("\n");
  }

  sesiones.delete(
    remitente
  );

  return (
    "Operación cancelada."
  );
}

function limpiarItemTicket(
  item,
  ticket
) {
  const data = {
    "Fecha de compra":
      ticket.fecha ||
      "",

    Producto:
      item.Producto ||
      "",

    "Producto base":
      item[
        "Producto base"
      ] ||
      "",

    Categoría:
      item.Categoría ||
      "",

    Monto:
      item.Monto ??
      "",

    Tienda:
      ticket.tienda ||
      "",

    Cantidad:
      item.Cantidad ??
      "",

    Unidad:
      item.Unidad ||
      "",

    "Contenido por empaque":
      item[
        "Contenido por empaque"
      ] ??
      "",

    "Unidad de comparación":
      item[
        "Unidad de comparación"
      ] ||
      "",

    "Precio por unidad":
      item[
        "Precio por unidad"
      ] ??
      "",

    Notas:
      "",

    "Registro de mensaje enviado":
      "Foto de ticket recibida por WhatsApp"
  };

  return completarDatosCalculados(
    "Super",
    data,
    "Foto de ticket recibida por WhatsApp"
  );
}

function valorTicket(
  valor,
  tipo = "texto"
) {
  if (
    estaVacio(
      valor
    )
  ) {
    return "⚠️ Falta";
  }

  if (
    tipo ===
    "dinero"
  ) {
    return formatearDinero(
      valor
    );
  }

  return String(
    valor
  );
}

function resumenTicketSuper(
  registros
) {
  if (
    !Array.isArray(
      registros
    ) ||
    registros.length ===
      0
  ) {
    return (
      "No hay productos para mostrar."
    );
  }

  const primero =
    registros[0] ||
    {};

  const cabecera = [
    "🧾 *Datos generales*",
    `Fecha de compra: ${valorTicket(
      primero[
        "Fecha de compra"
      ]
    )}`,
    `Tienda: ${valorTicket(
      primero.Tienda
    )}`
  ].join("\n");

  const productos =
    registros
      .map(
        (
          r,
          i
        ) => {
          const unidadComparacion =
            valorTicket(
              r[
                "Unidad de comparación"
              ]
            );

          return [
            `📦 *Producto ${i + 1}*`,
            `Producto: ${valorTicket(
              r.Producto
            )}`,
            `Producto base: ${valorTicket(
              r[
                "Producto base"
              ]
            )}`,
            `Categoría: ${valorTicket(
              r.Categoría
            )}`,
            `Monto: ${valorTicket(
              r.Monto,
              "dinero"
            )}`,
            `Cantidad: ${valorTicket(
              r.Cantidad
            )}`,
            `Unidad: ${valorTicket(
              r.Unidad
            )}`,
            `Contenido por empaque: ${valorTicket(
              r[
                "Contenido por empaque"
              ]
            )}`,
            `Unidad de comparación: ${unidadComparacion}`,
            `Precio por unidad: ${
              estaVacio(
                r[
                  "Precio por unidad"
                ]
              )
                ? "⚠️ Falta"
                : formatearDinero(
                    r[
                      "Precio por unidad"
                    ]
                  )
            }`
          ].join("\n");
        }
      )
      .join(
        `\n\n${SEPARADOR}\n\n`
      );

  return [
    cabecera,
    "",
    SEPARADOR,
    "",
    productos
  ].join("\n");
}

function camposConDatosTicket(
  registros
) {
  return CAMPOS_CORRECCION_TICKET.filter(
    campo =>
      registros.some(
        r =>
          !estaVacio(
            r[campo]
          )
      )
  );
}

function etiquetaCampoTicket(
  campo
) {
  if (
    campo ===
    "Monto"
  ) {
    return (
      "Monto"
    );
  }

  return campo;
}

function etiquetaCampoCorta(
  campo
) {
  const mapa = {
    "Fecha de compra":
      "Fecha de compra",

    Producto:
      "Producto (marca o presentación)",

    "Producto base":
      "Producto base (tipo general)",

    Categoría:
      "Categoría (grupo del gasto)",

    Monto:
      "Monto (total pagado)",

    Tienda:
      "Tienda",

    Cantidad:
      "Cantidad (empaques comprados)",

    Unidad:
      "Unidad (tipo de empaque)",

    "Contenido por empaque":
      "Contenido por empaque",

    "Unidad de comparación":
      "Unidad de comparación",

    "Precio por unidad":
      "Precio por unidad"
  };

  return (
    mapa[campo] ||
    campo
  );
}

function menuCorreccionTicket() {
  return [
    "✏️ *¿Qué quieres corregir?*",
    "",
    "1. Fecha de compra",
    "2. Producto (marca o presentación)",
    "3. Producto base (tipo general)",
    "4. Categoría (grupo del gasto)",
    "5. Monto (total pagado)",
    "6. Tienda",
    "7. Cantidad (empaques)",
    "8. Unidad (paquete, caja, botella…)",
    "9. Contenido por empaque",
    "10. Unidad de comparación",
    "11. Precio por unidad",
    "",
    "Puedes responder:",
    '• “2 y 4”',
    '• “producto y categoría”',
    '• “monto y tienda”',
    '• “solo monto está mal”',
    '• “cancelar”'
  ].join("\n");
}

function detectarCamposTicket(
  texto
) {
  const t =
    normalizar(
      texto
    );

  if (
    t.includes(
      "cancelar"
    ) ||
    t.includes(
      "cancela"
    )
  ) {
    return {
      accion:
        "cancelar",

      campos:
        []
    };
  }

  if (
    t.includes(
      "todo bien"
    ) ||
    t.includes(
      "ya esta bien"
    )
  ) {
    return {
      accion:
        "confirmar",

      campos:
        []
    };
  }

  const campos =
    new Set();

  const numeroACampo = {
    1:
      "Fecha de compra",

    2:
      "Producto",

    3:
      "Producto base",

    4:
      "Categoría",

    5:
      "Monto",

    6:
      "Tienda",

    7:
      "Cantidad",

    8:
      "Unidad",

    9:
      "Contenido por empaque",

    10:
      "Unidad de comparación",

    11:
      "Precio por unidad"
  };

  const numeros =
    t.match(
      /\b(?:11|10|[1-9])\b/g
    ) ||
    [];

  numeros.forEach(
    n => {
      const campo =
        numeroACampo[
          Number(n)
        ];

      if (campo) {
        campos.add(
          campo
        );
      }
    }
  );

  if (
    t.includes(
      "fecha"
    )
  ) {
    campos.add(
      "Fecha de compra"
    );
  }

  if (
    t.includes(
      "producto base"
    ) ||
    t.includes(
      "nombre base"
    )
  ) {
    campos.add(
      "Producto base"
    );
  }

  const sinProductoBase =
    t
      .replace(
        /producto base/g,
        ""
      )
      .replace(
        /nombre base/g,
        ""
      );

  if (
    sinProductoBase.includes(
      "producto"
    )
  ) {
    campos.add(
      "Producto"
    );
  }

  if (
    t.includes(
      "categoria"
    )
  ) {
    campos.add(
      "Categoría"
    );
  }

  if (
    t.includes(
      "tienda"
    )
  ) {
    campos.add(
      "Tienda"
    );
  }

  if (
    t.includes(
      "cantidad"
    )
  ) {
    campos.add(
      "Cantidad"
    );
  }

  const mencionaContenido =
    t.includes(
      "contenido por empaque"
    ) ||
    t.includes(
      "contenido del empaque"
    ) ||
    t.includes(
      "contenido empaque"
    );

  if (
    mencionaContenido
  ) {
    campos.add(
      "Contenido por empaque"
    );
  }

  const mencionaUnidadComparacion =
    t.includes(
      "unidad de comparacion"
    ) ||
    t.includes(
      "unidad comparacion"
    );

  if (
    mencionaUnidadComparacion
  ) {
    campos.add(
      "Unidad de comparación"
    );
  }

  const mencionaPrecioUnidad =
    t.includes(
      "precio por unidad"
    ) ||
    t.includes(
      "precio unitario"
    ) ||
    t.includes(
      "unitario"
    );

  if (
    mencionaPrecioUnidad
  ) {
    campos.add(
      "Precio por unidad"
    );
  }

  if (
    t.includes(
      "monto"
    ) ||
    t.includes(
      "precio total"
    ) ||
    (
      t.includes(
        "precio"
      ) &&
      !mencionaPrecioUnidad
    )
  ) {
    campos.add(
      "Monto"
    );
  }

  if (
    t.includes(
      "unidad"
    ) &&
    !mencionaUnidadComparacion &&
    !mencionaPrecioUnidad &&
    !mencionaContenido
  ) {
    campos.add(
      "Unidad"
    );
  }

  const hablaDeCorrectos =
    t.includes(
      "estan bien"
    ) ||
    t.includes(
      "esta bien"
    ) ||
    t.includes(
      "correctos"
    ) ||
    t.includes(
      "correcto"
    );

  return {
    accion:
      hablaDeCorrectos
        ? "correctos"
        : "corregir",

    campos:
      [...campos]
  };
}

function explicacionCorreccionCampo(
  campo
) {
  const mapa = {
    "Fecha de compra":
      'Ej.: “hoy” o “16/08/2026”.',

    Producto:
      "Producto = marca o presentación.\nEj.: Coca-Cola Zero 600 ml.",

    "Producto base":
      "Producto base = tipo general, sin marca.\nEj.: refresco.",

    Categoría:
      "Categoría = grupo del gasto.\nEj.: bebidas.",

    Monto:
      "Monto = total pagado por ese producto.\nEj.: 120 pesos.",

    Tienda:
      "Ej.: Walmart, Costco o Soriana.",

    Cantidad:
      "Cantidad = empaques completos comprados.\nEj.: un paquete de 12 rollos → 1.",

    Unidad:
      "Unidad = tipo de empaque.\nEj.: paquete, caja, bolsa o botella.",

    "Contenido por empaque":
      "Contenido de CADA empaque.\nEj.: 12 rollos → 12; 600 ml → 0.6.",

    "Unidad de comparación":
      "Unidad práctica para comparar.\nEj.: rollo, litro, kilogramo o pieza.",

    "Precio por unidad":
      "Costo por unidad de comparación.\nNormalmente se calcula automáticamente."
  };

  return (
    mapa[campo] ||
    ""
  );
}

function preguntaCorreccionCampo(
  campo,
  registros,
  posicion = 1,
  total = 1
) {
  const titulo =
    etiquetaCampoCorta(
      campo
    );

  const explicacion =
    explicacionCorreccionCampo(
      campo
    );

  const encabezado =
    total > 1
      ? `✏️ *Corrección ${posicion} de ${total}*`
      : "✏️ *Vamos a corregir*";

  if (
    campo ===
    "Fecha de compra"
  ) {
    return [
      encabezado,
      "",
      `Ahora: *${titulo}*`,
      explicacion,
      "",
      `Actual: ${valorTicket(
        registros[0]?.[
          "Fecha de compra"
        ]
      )}`,
      "",
      "¿Cuál es la fecha correcta?"
    ].join("\n");
  }

  if (
    campo ===
    "Tienda"
  ) {
    return [
      encabezado,
      "",
      `Ahora: *${titulo}*`,
      explicacion,
      "",
      `Actual: ${valorTicket(
        registros[0]?.Tienda
      )}`,
      "",
      "¿Cuál es la tienda correcta?"
    ].join("\n");
  }

  const actuales =
    registros
      .map(
        (
          r,
          i
        ) =>
          `${i + 1}. ${valorTicket(
            r[campo],
            [
              "Monto",
              "Precio por unidad"
            ].includes(
              campo
            )
              ? "dinero"
              : "texto"
          )}`
      )
      .join("\n");

  if (
    registros.length ===
    1
  ) {
    return [
      encabezado,
      "",
      `Ahora: *${titulo}*`,
      explicacion,
      "",
      `Actual: ${valorTicket(
        registros[0]?.[
          campo
        ],
        [
          "Monto",
          "Precio por unidad"
        ].includes(
          campo
        )
          ? "dinero"
          : "texto"
      )}`,
      "",
      "¿Cuál debe ser?"
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    encabezado,
    "",
    `Ahora: *${titulo}*`,
    explicacion,
    "",
    "*Valores actuales:*",
    actuales,
    "",
    "Escribe un valor por producto, uno por línea.",
    'Si alguno no cambia, escribe “igual”.'
  ]
    .filter(Boolean)
    .join("\n");
}

function extraerListaCorreccion(
  texto,
  cantidad
) {
  let valores =
    String(
      texto ||
      ""
    )
      .split(
        /\n|;/
      )
      .map(
        v =>
          v.trim()
      )
      .filter(Boolean)
      .map(
        v =>
          v
            .replace(
              /^\s*\d+\s*[.)\-:]\s*/,
              ""
            )
            .trim()
      );

  if (
    cantidad > 1 &&
    valores.length ===
      1
  ) {
    const numerados =
      String(
        texto ||
        ""
      )
        .split(
          /(?=\b\d+\s*[.)\-:]\s*)/
        )
        .map(
          v =>
            v.trim()
        )
        .filter(Boolean)
        .map(
          v =>
            v
              .replace(
                /^\s*\d+\s*[.)\-:]\s*/,
                ""
              )
              .trim()
        );

    if (
      numerados.length >
      1
    ) {
      valores =
        numerados;
    }
  }

  return valores;
}

function numeroTicketSeguro(
  texto
) {
  let s =
    String(
      texto ||
      ""
    )
      .trim()
      .replace(
        /\s/g,
        ""
      )
      .replace(
        /\$/g,
        ""
      );

  if (!s) {
    return null;
  }

  if (
    s.includes(",") &&
    s.includes(".")
  ) {
    s =
      s.replace(
        /,/g,
        ""
      );

  } else if (
    s.includes(",")
  ) {
    const partes =
      s.split(",");

    if (
      partes.length ===
        2 &&
      partes[1].length <=
        2
    ) {
      s =
        `${partes[0]}.${partes[1]}`;
    } else {
      s =
        s.replace(
          /,/g,
          ""
        );
    }
  }

  const m =
    s.match(
      /-?\d+(?:\.\d+)?/
    );

  if (!m) {
    return null;
  }

  const n =
    Number(
      m[0]
    );

  return Number.isFinite(
    n
  )
    ? n
    : null;
}
function siguienteCorreccionTicket(
  remitente,
  registros,
  camposPendientes,
  introduccion = false,
  totalCorrecciones = null,
  posicionCorreccion = 1
) {
  if (!camposPendientes.length) {
    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_confirmacion_final",

        registros
      }
    );

    return [
      resumenTicketSuper(
        registros
      ),
      "",
      "✅ *Revisión final*",
      "¿Está correcto?",
      "✅ Sí, guardar",
      "✏️ No, corregir"
    ].join("\n");
  }

  const total =
    totalCorrecciones ||
    camposPendientes.length;

  const [
    campoActual,
    ...restantes
  ] = camposPendientes;

  guardarSesion(
    remitente,
    {
      tipo:
        "ticket_super_corrigiendo",

      registros,

      campoActual,

      camposPendientes:
        restantes,

      totalCorrecciones:
        total,

      posicionCorreccion
    }
  );

  let pregunta =
    preguntaCorreccionCampo(
      campoActual,
      registros,
      posicionCorreccion,
      total
    );

  if (introduccion) {
    pregunta =
      pregunta.replace(
        /^✏️ \*[^\n]+\*\n\n/,
        ""
      );

    return [
      "✏️ *Vamos a corregir los campos incorrectos*",
      "",
      pregunta
    ].join("\n");
  }

  return pregunta;
}

async function aplicarCorreccionTicket(
  textoUsuario,
  campo,
  registros
) {
  const nuevos =
    registros.map(
      r => ({
        ...r
      })
    );

  const t =
    normalizar(
      textoUsuario
    );

  if (
    [
      "igual",
      "dejar igual",
      "sin cambio",
      "dejalo"
    ].includes(t)
  ) {
    return nuevos;
  }

  if (
    campo ===
    "Fecha de compra"
  ) {
    const interpretacion =
      await interpretarConGemini(
        `La fecha de compra correcta es ${textoUsuario}`,
        {
          sheet:
            "Super",

          data:
            nuevos[0]
        }
      );

    const fecha =
      interpretacion.data?.[
        "Fecha de compra"
      ];

    if (
      estaVacio(
        fecha
      )
    ) {
      throw new Error(
        "No pude interpretar esa fecha."
      );
    }

    nuevos.forEach(
      r => {
        r[
          "Fecha de compra"
        ] =
          fecha;
      }
    );

    return nuevos;
  }

  if (
    campo ===
    "Tienda"
  ) {
    const tienda =
      String(
        textoUsuario ||
        ""
      ).trim();

    if (!tienda) {
      throw new Error(
        "La tienda no puede quedar vacía."
      );
    }

    nuevos.forEach(
      r => {
        r.Tienda =
          tienda;
      }
    );

    return nuevos;
  }

  const valores =
    extraerListaCorreccion(
      textoUsuario,
      nuevos.length
    );

  if (
    nuevos.length > 1 &&
    valores.length !==
      nuevos.length
  ) {
    throw new Error(
      `Necesito ${nuevos.length} valores, uno por cada producto.`
    );
  }

  if (
    nuevos.length === 1 &&
    valores.length === 0
  ) {
    throw new Error(
      "No recibí el nuevo valor."
    );
  }

  const numerico = [
    "Monto",
    "Cantidad",
    "Contenido por empaque",
    "Precio por unidad"
  ].includes(
    campo
  );

  nuevos.forEach(
    (
      registro,
      indice
    ) => {
      const valor =
        valores[
          nuevos.length === 1
            ? 0
            : indice
        ];

      if (
        [
          "igual",
          "dejar igual",
          "sin cambio"
        ].includes(
          normalizar(
            valor
          )
        )
      ) {
        return;
      }

      if (numerico) {
        const numero =
          numeroTicketSeguro(
            valor
          );

        if (
          numero === null
        ) {
          throw new Error(
            `No pude interpretar el valor ${indice + 1} como número.`
          );
        }

        registro[campo] =
          numero;

      } else {
        registro[campo] =
          String(
            valor ||
            ""
          ).trim();
      }

      if (
        [
          "Monto",
          "Cantidad",
          "Contenido por empaque"
        ].includes(
          campo
        )
      ) {
        const monto =
          valorNumero(
            registro.Monto
          );

        const cantidad =
          valorNumero(
            registro.Cantidad
          );

        const contenido =
          valorNumero(
            registro[
              "Contenido por empaque"
            ]
          );

        registro[
          "Precio por unidad"
        ] =
          monto > 0 &&
          cantidad > 0 &&
          contenido > 0
            ? Math.round(
                (
                  monto /
                  (
                    cantidad *
                    contenido
                  )
                ) *
                100
              ) /
              100
            : "";
      }
    }
  );

  return nuevos;
}

function mensajeRevisionTicket(
  registros
) {
  return [
    "🧾 *Del ticket voy a registrar esto*",
    "",
    resumenTicketSuper(
      registros
    ),
    "",
    "¿Está correcto lo que leí?",
    "✅ Sí",
    "✏️ No, corregir"
  ].join("\n");
}

async function procesarImagenRecibida(
  mensaje,
  remitente
) {
  const mediaId =
    mensaje.image?.id;

  if (!mediaId) {
    return (
      "No pude identificar la imagen."
    );
  }

  const media =
    await obtenerMediaWhatsApp(
      mediaId
    );

  const analisis =
    await interpretarImagen(
      media.buffer,
      media.mimeType
    );

  if (
    analisis.accion ===
    "ticket_pago"
  ) {
    const data =
      completarDatosCalculados(
        "Pagos",
        analisis.data ||
        {},
        "Foto de recibo recibida por WhatsApp"
      );

    return prepararConfirmacionRegistro(
      remitente,
      "Pagos",
      data,
      "Foto de recibo recibida por WhatsApp"
    );
  }

  if (
    analisis.accion ===
    "ticket_super"
  ) {
    const items =
      Array.isArray(
        analisis.items
      )
        ? analisis.items
        : [];

    const registros =
      items
        .filter(
          item =>
            item &&
            typeof item ===
              "object" &&
            [
              "Producto",
              "Producto base",
              "Categoría",
              "Monto",
              "Cantidad",
              "Unidad",
              "Contenido por empaque",
              "Unidad de comparación"
            ].some(
              campo =>
                !estaVacio(
                  item[campo]
                )
            )
        )
        .map(
          item =>
            limpiarItemTicket(
              item,
              analisis
            )
        );

    if (
      !registros.length
    ) {
      return [
        "Pude ver el ticket, pero no pude leer con seguridad los productos.",
        "Prueba con otra foto o dime los datos por mensaje."
      ].join("\n");
    }

    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_revision",

        registros
      }
    );

    return mensajeRevisionTicket(
      registros
    );
  }

  return [
    "No pude identificar con seguridad el tipo de imagen.",
    analisis.descripcion
      ? `Alcancé a ver: ${analisis.descripcion}`
      : "",
    "Dime si quieres registrarlo en *Súper* o en *Pagos*."
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function guardarTicketSuper(
  remitente,
  registros
) {
  const ids = [];

  for (
    const registro
    of registros
  ) {
    const resultado =
      await guardarEnSheets(
        "Super",
        registro
      );

    ids.push(
      resultado.id
    );
  }

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Ticket guardado*",
    SEPARADOR,
    `Productos: ${ids.length}`,
    `IDs: ${ids.join(", ")}`
  ].join("\n");
}

async function procesarTicketPendiente(
  textoUsuario,
  remitente,
  sesion
) {
  const t =
    normalizar(
      textoUsuario
    );

  if (
    sesion.tipo ===
    "ticket_super_revision"
  ) {
    if (
      respuestaSi(
        textoUsuario
      )
    ) {
      const faltantes =
        camposFaltantesTicket(
          sesion.registros
        );

      if (
        faltantes.length
      ) {
        return siguienteCorreccionTicket(
          remitente,
          sesion.registros,
          faltantes,
          true
        );
      }

      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_confirmacion_final",

          registros:
            sesion.registros
        }
      );

      return [
        resumenTicketSuper(
          sesion.registros
        ),
        "",
        "✅ *Revisión final*",
        "¿Confirmas que lo guarde?",
        "✅ Sí",
        "✏️ No, corregir"
      ].join("\n");
    }

    if (
      t === "no" ||
      t.includes(
        "corregir"
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_elegir_correccion",

          registros:
            sesion.registros
        }
      );

      return menuCorreccionTicket();
    }

    if (
      t === "cancelar" ||
      t === "cancela"
    ) {
      sesiones.delete(
        remitente
      );

      return (
        "No guardé nada del ticket."
      );
    }

    return (
      "Responde *sí* si lo leído está correcto, *no* para corregir o *cancelar*."
    );
  }

  if (
    sesion.tipo ===
    "ticket_super_confirmacion_final"
  ) {
    if (
      respuestaSi(
        textoUsuario
      )
    ) {
      return guardarTicketSuper(
        remitente,
        sesion.registros
      );
    }

    if (
      t === "no" ||
      t.includes(
        "corregir"
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_elegir_correccion",

          registros:
            sesion.registros
        }
      );

      return menuCorreccionTicket();
    }

    if (
      t === "cancelar" ||
      t === "cancela"
    ) {
      sesiones.delete(
        remitente
      );

      return (
        "No guardé nada del ticket."
      );
    }

    return (
      "Responde *sí* para guardar, *no* para corregir o *cancelar*."
    );
  }

  if (
    sesion.tipo ===
    "ticket_super_elegir_correccion"
  ) {
    const seleccion =
      detectarCamposTicket(
        textoUsuario
      );

    if (
      seleccion.accion ===
      "cancelar"
    ) {
      sesiones.delete(
        remitente
      );

      return (
        "No guardé nada del ticket."
      );
    }

    if (
      seleccion.accion ===
      "confirmar"
    ) {
      const faltantes =
        camposFaltantesTicket(
          sesion.registros
        );

      if (
        faltantes.length
      ) {
        return siguienteCorreccionTicket(
          remitente,
          sesion.registros,
          faltantes,
          true
        );
      }

      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_confirmacion_final",

          registros:
            sesion.registros
        }
      );

      return [
        resumenTicketSuper(
          sesion.registros
        ),
        "",
        "✅ *Revisión final*",
        "¿Confirmas que lo guarde?",
        "✅ Sí",
        "✏️ No, corregir"
      ].join("\n");
    }

    if (
      !seleccion.campos.length
    ) {
      return menuCorreccionTicket();
    }

    let campos;

    if (
      seleccion.accion ===
      "correctos"
    ) {
      campos =
        CAMPOS_CORRECCION_TICKET.filter(
          campo =>
            !seleccion.campos.includes(
              campo
            )
        );

    } else {
      campos =
        seleccion.campos;
    }

    campos =
      CAMPOS_CORRECCION_TICKET.filter(
        campo =>
          campos.includes(
            campo
          )
      );

    if (
      !campos.length
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_confirmacion_final",

          registros:
            sesion.registros
        }
      );

      return [
        resumenTicketSuper(
          sesion.registros
        ),
        "",
        "✅ *Revisión final*",
        "¿Confirmas que lo guarde?",
        "✅ Sí",
        "✏️ No, corregir"
      ].join("\n");
    }

    return siguienteCorreccionTicket(
      remitente,
      sesion.registros,
      campos,
      true
    );
  }

  if (
    sesion.tipo ===
    "ticket_super_corrigiendo"
  ) {
    if (
      t === "cancelar" ||
      t === "cancela"
    ) {
      sesiones.delete(
        remitente
      );

      return (
        "No guardé nada del ticket."
      );
    }

    let registros;

    try {
      registros =
        await aplicarCorreccionTicket(
          textoUsuario,
          sesion.campoActual,
          sesion.registros
        );

    } catch (error) {
      return [
        `⚠️ ${error.message}`,
        "",
        preguntaCorreccionCampo(
          sesion.campoActual,
          sesion.registros,
          sesion.posicionCorreccion ||
            1,
          sesion.totalCorrecciones ||
            1
        )
      ].join("\n");
    }

    return siguienteCorreccionTicket(
      remitente,
      registros,
      sesion.camposPendientes ||
        [],
      false,
      sesion.totalCorrecciones ||
        null,
      (
        sesion.posicionCorreccion ||
        1
      ) + 1
    );
  }

  sesiones.delete(
    remitente
  );

  return (
    "Cancelé la lectura del ticket."
  );
}
async function procesarAudioRecibido(
  mensaje,
  remitente
) {
  const mediaId =
    mensaje.audio?.id;

  if (!mediaId) {
    return (
      "No pude identificar el audio."
    );
  }

  const media =
    await obtenerMediaWhatsApp(
      mediaId
    );

  const transcripcion =
    await transcribirAudio(
      media.buffer,
      media.mimeType
    );

  console.log(
    "Audio transcrito:",
    transcripcion
  );

  const respuesta =
    await procesarMensaje(
      transcripcion,
      remitente
    );

  return [
    `🎙️ *Entendí:* “${transcripcion}”`,
    "",
    respuesta
  ].join("\n");
}

function mensajeFalloIA(
  error
) {
  const status =
    Number(
      error?.status ||
      0
    );

  const texto =
    normalizar(
      error?.message ||
      ""
    );

  if (
    status === 429 ||
    texto.includes(
      "quota"
    ) ||
    texto.includes(
      "rate limit"
    )
  ) {
    return (
      "La IA alcanzó temporalmente su límite de uso. No guardé ni cambié nada. Intenta de nuevo más tarde."
    );
  }

  if (
    status === 401 ||
    status === 403
  ) {
    return (
      "La conexión con la IA necesita revisión. No guardé ni cambié nada."
    );
  }

  return (
    "La IA no pudo procesar el mensaje en este momento. No guardé ni cambié nada."
  );
}

async function procesarMensaje(
  textoUsuario,
  remitente
) {
  const texto =
    String(
      textoUsuario ||
      ""
    ).trim();

  if (!texto) {
    return (
      "No recibí texto. ¿Qué quieres registrar?"
    );
  }

  const sesion =
    obtenerSesion(
      remitente
    );

  if (sesion) {
    if (
      [
        "eliminar_seleccion",
        "eliminar_confirmacion"
      ].includes(
        sesion.tipo
      )
    ) {
      return procesarEliminacionPendiente(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "registro"
    ) {
      return procesarRegistroPendiente(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "registro_confirmacion"
    ) {
      return procesarRegistroConfirmacion(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "registro_correccion"
    ) {
      return procesarCorreccionRegistro(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "ahorro_sin_regla"
    ) {
      return procesarAhorroSinRegla(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "ahorro_alcance"
    ) {
      return procesarAhorroAlcance(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "config_ahorro_confirmacion"
    ) {
      return procesarConfigAhorroConfirmacion(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo ===
      "meta_confirmacion"
    ) {
      return procesarMetaConfirmacion(
        texto,
        remitente,
        sesion
      );
    }

    if (
      sesion.tipo.startsWith(
        "ticket_super_"
      )
    ) {
      return procesarTicketPendiente(
        texto,
        remitente,
        sesion
      );
    }
  }

  if (
    esSaludoSimple(
      texto
    )
  ) {
    return (
      "Hola 👋 ¿Qué quieres registrar o consultar de tus finanzas?"
    );
  }

  if (
    esAyuda(
      texto
    )
  ) {
    return respuestaAyuda();
  }

  let interpretacion;

  try {
    interpretacion =
      await interpretarConGemini(
        texto
      );

  } catch (error) {
    console.error(
      "Error Gemini:",
      error
    );

    return mensajeFalloIA(
      error
    );
  }

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
        "No pude identificar dónde guardar esa información."
      );
    }

    const data =
      completarDatosCalculados(
        sheet,
        interpretacion.data ||
        {},
        texto
      );

    return prepararConfirmacionRegistro(
      remitente,
      sheet,
      data,
      texto
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
        mesActualMexico(),
      Boolean(
        interpretacion.grafica
      )
    );
  }

  if (
    interpretacion.accion ===
    "historial_producto"
  ) {
    if (
      !interpretacion.producto
    ) {
      return (
        "¿De qué producto quieres consultar el historial?"
      );
    }

    const resultado =
      await consultarHistorialProducto(
        interpretacion.producto,
        interpretacion.meses ||
          2
      );

    return formatearHistorial(
      resultado
    );
  }

  if (
    interpretacion.accion ===
    "configurar_ahorro"
  ) {
    return iniciarConfiguracionAhorro(
      interpretacion,
      remitente,
      texto
    );
  }

  if (
    interpretacion.accion ===
    "meta_ahorro"
  ) {
    return iniciarMetaAhorro(
      interpretacion,
      remitente,
      texto
    );
  }

  if (
    interpretacion.accion ===
    "metas_resumen"
  ) {
    const resultado =
      await consultarMetas();

    return formatearMetas(
      resultado.metas ||
      []
    );
  }

  return (
    interpretacion.respuesta ||
    "¿En qué te ayudo?"
  );
}
async function suscribirWhatsApp() {
  if (!WHATSAPP_TOKEN || !WABA_ID) {
    console.log(
      "No se intentó suscribir WhatsApp porque falta token o WABA_ID."
    );

    return;
  }

  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/subscribed_apps?subscribed_fields=messages`,
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

    const datos = await respuesta
      .json()
      .catch(() => ({}));

    console.log(
      "Suscripción WhatsApp:",
      datos
    );

    if (!respuesta.ok) {
      console.error(
        "No se pudo suscribir WhatsApp:",
        datos
      );
    }

  } catch (error) {
    console.error(
      "Error al suscribir WhatsApp:",
      error
    );
  }
}

function normalizarRemitente(
  numero
) {
  if (!numero) {
    return "";
  }

  const limpio =
    String(
      numero
    ).replace(
      /\D/g,
      ""
    );

  if (
    limpio.startsWith(
      "521"
    )
  ) {
    return (
      "52" +
      limpio.slice(3)
    );
  }

  return limpio;
}

async function procesarMensajeWhatsApp(
  mensaje,
  remitente
) {
  if (
    mensaje.type ===
      "text" &&
    mensaje.text?.body
  ) {
    const texto =
      mensaje.text.body.trim();

    console.log(
      "Texto recibido:",
      texto
    );

    return procesarMensaje(
      texto,
      remitente
    );
  }

  if (
    mensaje.type ===
      "image" &&
    mensaje.image
  ) {
    console.log(
      "Imagen recibida:",
      mensaje.image.id
    );

    try {
      return await procesarImagenRecibida(
        mensaje,
        remitente
      );

    } catch (error) {
      console.error(
        "Error procesando imagen:",
        error
      );

      if (
        Number(
          error?.status ||
          0
        ) === 429
      ) {
        return (
          "Recibí la foto, pero la IA alcanzó temporalmente su límite. No guardé nada. Inténtalo después o dicta los datos."
        );
      }

      return (
        "Recibí la foto, pero no pude leerla correctamente. No guardé nada. Prueba con otra foto o dicta los datos."
      );
    }
  }

  if (
    mensaje.type ===
      "audio" &&
    mensaje.audio
  ) {
    console.log(
      "Audio recibido:",
      mensaje.audio.id
    );

    try {
      return await procesarAudioRecibido(
        mensaje,
        remitente
      );

    } catch (error) {
      console.error(
        "Error procesando audio:",
        error
      );

      if (
        Number(
          error?.status ||
          0
        ) === 429
      ) {
        return (
          "Recibí tu audio, pero la IA alcanzó temporalmente su límite. No guardé nada. Puedes escribir el mensaje."
        );
      }

      return (
        "Recibí tu audio, pero no pude entenderlo. No guardé nada. Intenta otra vez o escríbelo."
      );
    }
  }

  return (
    "Por ahora puedo recibir texto, fotos de tickets/recibos y mensajes de voz."
  );
}

async function manejarWebhook(
  payload
) {
  const value =
    payload?.entry?.[0]
      ?.changes?.[0]
      ?.value;

  const mensajes =
    value?.messages;

  if (
    !Array.isArray(
      mensajes
    ) ||
    !mensajes.length
  ) {
    return;
  }

  for (
    const mensaje
    of mensajes
  ) {
    if (!mensaje) {
      continue;
    }

    limpiarMensajesProcesados();

    if (
      mensaje.id &&
      mensajesProcesados.has(
        mensaje.id
      )
    ) {
      console.log(
        "Mensaje duplicado ignorado:",
        mensaje.id
      );

      continue;
    }

    if (
      mensaje.id
    ) {
      mensajesProcesados.set(
        mensaje.id,
        Date.now()
      );
    }

    const remitente =
      normalizarRemitente(
        mensaje.from
      );

    if (!remitente) {
      continue;
    }

    try {
      const respuesta =
        await procesarMensajeWhatsApp(
          mensaje,
          remitente
        );

      if (respuesta) {
        await enviarMensajeWhatsApp(
          remitente,
          respuesta
        );
      }

    } catch (error) {
      console.error(
        "Error procesando mensaje:",
        error
      );

      try {
        await enviarMensajeWhatsApp(
          remitente,
          "Ocurrió un problema. No guardé ni cambié nada. Inténtalo nuevamente."
        );

      } catch (errorEnvio) {
        console.error(
          "También falló el envío del mensaje de error:",
          errorEnvio
        );
      }
    }
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
        req.method ===
          "GET" &&
        url.pathname ===
          "/"
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        return res.end(
          "Finanzas IA V3 activo"
        );
      }

      if (
        req.method ===
          "GET" &&
        url.pathname ===
          "/health"
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );

        return res.end(
          JSON.stringify({
            ok: true,

            servicio:
              "Finanzas IA V3",

            whatsapp:
              Boolean(
                WHATSAPP_TOKEN
              ),

            gemini:
              Boolean(
                GEMINI_API_KEY
              ),

            appsScript:
              Boolean(
                APPS_SCRIPT_URL &&
                APPS_SCRIPT_SECRET
              )
          })
        );
      }

      if (
        req.method ===
          "GET" &&
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

        return res.end(
          `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Política de privacidad - Finanzas IA</title></head><body><h1>Política de privacidad</h1><p>Finanzas IA es una aplicación de uso personal.</p><p>Procesa únicamente la información necesaria para registrar y consultar información financiera enviada por el usuario.</p><p>La aplicación puede procesar mensajes de texto, imágenes y audios enviados voluntariamente mediante WhatsApp.</p><p>No vendemos información personal.</p><p>Los datos financieros se almacenan en una hoja privada de Google Sheets controlada por el propietario de la aplicación.</p><p>Contacto: zurita-17@hotmail.com</p></body></html>`
        );
      }

      if (
        req.method ===
          "GET" &&
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
          mode ===
            "subscribe" &&
          token ===
            VERIFY_TOKEN
        ) {
          res.writeHead(
            200,
            {
              "Content-Type":
                "text/plain; charset=utf-8"
            }
          );

          return res.end(
            challenge ||
            ""
          );
        }

        res.writeHead(
          403,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        return res.end(
          "Forbidden"
        );
      }

      if (
        req.method ===
          "POST" &&
        url.pathname ===
          "/webhook"
      ) {
        let body = "";

        req.on(
          "data",
          chunk => {
            body +=
              chunk;

            if (
              body.length >
              2_000_000
            ) {
              req.destroy();
            }
          }
        );

        req.on(
          "end",
          () => {
            let payload;

            try {
              payload =
                JSON.parse(
                  body
                );

            } catch (error) {
              console.error(
                "Webhook con JSON inválido:",
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

            manejarWebhook(
              payload
            ).catch(
              error =>
                console.error(
                  "Error general del webhook:",
                  error
                )
            );
          }
        );

        return;
      }

      res.writeHead(
        404,
        {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      );

      res.end(
        "Not found"
      );
    }
  );

server.on(
  "clientError",
  (
    error,
    socket
  ) => {
    console.error(
      "Error de cliente HTTP:",
      error
    );

    try {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\n\r\n"
      );

    } catch {}
  }
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Finanzas IA V3 activo en puerto ${PORT}`
    );

    console.log(
      `Modelo Gemini: ${GEMINI_MODEL}`
    );

    if (
      !WHATSAPP_TOKEN
    ) {
      console.error(
        "Falta WHATSAPP_TOKEN."
      );
    }

    if (
      !GEMINI_API_KEY
    ) {
      console.error(
        "Falta GEMINI_API_KEY."
      );
    }

    if (
      !APPS_SCRIPT_URL
    ) {
      console.error(
        "Falta APPS_SCRIPT_URL."
      );
    }

    if (
      !APPS_SCRIPT_SECRET
    ) {
      console.error(
        "Falta APPS_SCRIPT_SECRET."
      );
    }

    if (
      WHATSAPP_TOKEN
    ) {
      suscribirWhatsApp();
    }
  }
);