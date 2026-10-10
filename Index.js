const http = require("http");

// ========================================
// CONFIGURACIÓN
// ========================================

const PORT =
  process.env.PORT ||
  10000;

const VERIFY_TOKEN =
  process.env.VERIFY_TOKEN ||
  "finanzas-ia-token";

const WHATSAPP_TOKEN =
  process.env.WHATSAPP_TOKEN;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL;

const APPS_SCRIPT_SECRET =
  process.env.APPS_SCRIPT_SECRET;

const GRAPH_VERSION =
  process.env.GRAPH_VERSION ||
  "v26.0";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.1-flash-lite";

const WABA_ID =
  process.env.WABA_ID ||
  "1363654319277230";

const PHONE_NUMBER_ID =
  process.env.PHONE_NUMBER_ID ||
  "1327077313815752";

const ZONA_HORARIA =
  "America/Mexico_City";

const SESION_MS =
  2 * 60 * 60 * 1000;

// ========================================
// ESTADO TEMPORAL
// ========================================

const mensajesProcesados =
  new Map();

const sesiones =
  new Map();

// ========================================
// CAMPOS REQUERIDOS
// ========================================

const CAMPOS_REQUERIDOS = {

  Ingresos: [
    "Fecha de ingreso",
    "Tipo de ingreso",
    "Monto"
  ],

  Pagos: [
    "Fecha de pago",
    "Concepto",
    "Periodo",
    "Monto",
    "Estado"
  ],

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

// ========================================
// CAMPOS PARA CORRECCIÓN DE TICKETS
// ========================================

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

// ========================================
// CONSTANTES DE MENSAJES
// ========================================

const SEPARADOR =
  "──────────";

// ========================================
// UTILIDADES BÁSICAS
// ========================================

function estaVacio(valor) {

  return (
    valor === undefined ||
    valor === null ||
    String(valor).trim() === ""
  );

}

function normalizar(valor) {

  return String(
    valor || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();

}

function guardarSesion(
  remitente,
  datos
) {

  sesiones.set(
    remitente,
    {
      ...datos,
      actualizado:
        Date.now()
    }
  );

}

function obtenerSesion(
  remitente
) {

  const sesion =
    sesiones.get(
      remitente
    );

  if (!sesion) {
    return null;
  }

  if (
    Date.now() -
      sesion.actualizado >
    SESION_MS
  ) {

    sesiones.delete(
      remitente
    );

    return null;
  }

  sesion.actualizado =
    Date.now();

  return sesion;

}

function limpiarMensajesProcesados() {

  const limite =
    Date.now() -
    30 * 60 * 1000;

  for (
    const [
      id,
      timestamp
    ]
    of mensajesProcesados
  ) {

    if (
      timestamp <
      limite
    ) {

      mensajesProcesados.delete(
        id
      );

    }

  }

}

// ========================================
// FECHAS MÉXICO
// ========================================

function fechaActualMexico() {

  return new Intl.DateTimeFormat(
    "es-MX",
    {
      timeZone:
        ZONA_HORARIA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(
    new Date()
  );

}

function mesActualMexico() {

  return new Intl.DateTimeFormat(
    "es-MX",
    {
      timeZone:
        ZONA_HORARIA,
      year: "numeric",
      month: "2-digit"
    }
  )
    .format(
      new Date()
    )
    .replace(
      "/",
      "-"
    );

}

function formatearDinero(
  valor
) {

  const numero =
    Number(
      valor
    );

  if (
    !Number.isFinite(
      numero
    )
  ) {

    return "$0.00";

  }

  return numero.toLocaleString(
    "es-MX",
    {
      style:
        "currency",
      currency:
        "MXN",
      minimumFractionDigits:
        2,
      maximumFractionDigits:
        2
    }
  );

}

function valorNumero(
  valor
) {

  if (
    typeof valor ===
    "number"
  ) {

    return valor;

  }

  const numero =
    Number(
      String(
        valor || ""
      )
        .replace(
          /[$,\s]/g,
          ""
        )
    );

  return Number.isFinite(
    numero
  )
    ? numero
    : 0;

}

// ========================================
// TEXTO
// ========================================

function tituloHoja(
  sheet
) {

  return String(
    sheet || ""
  )
    .trim();

}

function valorVisible(
  valor
) {

  if (
    valor ===
      undefined ||
    valor === null ||
    valor === ""
  ) {

    return "—";

  }

  return String(
    valor
  );

}

// ========================================
// RESPUESTAS SÍ / NO
// ========================================

function respuestaSi(
  texto
) {

  const valor =
    normalizar(
      texto
    );

  return [
    "si",
    "sí",
    "s",
    "yes",
    "ok",
    "correcto",
    "correcta",
    "confirmo",
    "confirmar",
    "dale",
    "hazlo"
  ].includes(
    valor
  );

}

function respuestaNo(
  texto
) {

  const valor =
    normalizar(
      texto
    );

  return [
    "no",
    "n",
    "cancelar",
    "cancela",
    "cancelado",
    "negativo"
  ].includes(
    valor
  );

}

// ========================================
// SALUDO / AYUDA
// ========================================

function esSaludoSimple(
  texto
) {

  const valor =
    normalizar(
      texto
    );

  return [
    "hola",
    "holaa",
    "holi",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "hey",
    "hello"
  ].includes(
    valor
  );

}

function esAyuda(
  texto
) {

  const valor =
    normalizar(
      texto
    );

  return (
    valor ===
      "ayuda" ||
    valor ===
      "help" ||
    valor ===
      "que puedes hacer" ||
    valor ===
      "que haces"
  );

}

function respuestaAyuda() {

  return [
    "🤖 *Puedo ayudarte con:*",
    "",
    "💰 *Ingresos*",
    "• Registrar ingresos",
    "• Consultar ingresos",
    "• Analizar meses y bonos",
    "",
    "💳 *Pagos*",
    "• Registrar pagos",
    "• Consultar gastos",
    "• Analizar pagos por mes o concepto",
    "",
    "🛒 *Súper*",
    "• Agregar productos a la lista",
    "• Ver tu lista pendiente",
    "• Registrar compras",
    "• Leer tickets",
    "• Consultar historial y precios",
    "",
    "💵 *Ahorros y metas*",
    "• Configurar ahorro",
    "• Registrar ahorros",
    "• Crear metas",
    "• Consultar metas",
    "",
    "📅 *Calendario*",
    "• Consultar eventos",
    "• Crear eventos",
    "• Eliminar eventos",
    "",
    "📊 *Análisis*",
    "• Comparar gastos",
    "• Consultar históricos",
    "• Buscar tendencias y patrones"
  ].join("\n");

}

// ========================================
// CAMPOS PARA RESUMEN
// ========================================

function camposParaResumen(
  sheet
) {

  if (
    sheet ===
    "Ingresos"
  ) {

    return [
      "Fecha de ingreso",
      "Tipo de ingreso",
      "Monto",
      "Notas"
    ];

  }

  if (
    sheet ===
    "Pagos"
  ) {

    return [
      "Fecha de pago",
      "Concepto",
      "Periodo",
      "Monto",
      "Estado",
      "Notas"
    ];

  }

  if (
    sheet ===
    "Super"
  ) {

    return [
      "Fecha de compra",
      "Producto",
      "Monto",
      "Tienda",
      "Cantidad",
      "Unidad",
      "Precio por unidad"
    ];

  }

  return [];

}

function formatearCampo(
  campo,
  valor
) {

  if (
    estaVacio(valor)
  ) {

    return "";

  }

  if (
    campo ===
      "Monto" ||
    campo ===
      "Precio por unidad"
  ) {

    return `${campo}: ${formatearDinero(
      valor
    )}`;

  }

  return `${campo}: ${valor}`;

}

function formatearRegistro(
  sheet,
  data
) {

  const campos =
    camposParaResumen(
      sheet
    );

  return campos
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

function resumenRegistroVisual(
  sheet,
  data
) {

  return [
    `📋 *${sheet}*`,
    SEPARADOR,
    formatearRegistro(
      sheet,
      data
    )
  ]
    .filter(Boolean)
    .join("\n");

}

// ========================================
// DIVIDIR MENSAJES LARGOS
// ========================================

function dividirMensaje(
  texto,
  maximo = 3500
) {

  const resultado = [];

  let restante =
    String(
      texto || ""
    );

  while (
    restante.length >
    maximo
  ) {

    let posicion =
      restante.lastIndexOf(
        "\n",
        maximo
      );

    if (
      posicion < 500
    ) {

      posicion =
        maximo;

    }

    resultado.push(
      restante.slice(
        0,
        posicion
      )
    );

    restante =
      restante.slice(
        posicion
      );

  }

  if (
    restante
  ) {

    resultado.push(
      restante
    );

  }

  return resultado;

}

// ========================================
// WHATSAPP — ENVÍO
// ========================================

async function enviarMensajeWhatsApp(
  remitente,
  texto
) {

  const mensajes =
    dividirMensaje(
      texto
    );

  for (
    const mensaje
    of mensajes
  ) {

    let destinatario =
      String(
        remitente || ""
      ).trim();

    let respuesta =
      await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
        {
          method:
            "POST",

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
                preview_url:
                  false,

                body:
                  mensaje
              }
            })
        }
      );

    let datos =
      await respuesta
        .json()
        .catch(
          () => ({})
        );

    /*
     * México:
     *
     * Meta puede entregar el número móvil mexicano
     * desde el webhook con formato 521XXXXXXXXXX,
     * mientras que el destinatario autorizado puede
     * estar registrado como 52XXXXXXXXXX.
     *
     * Si Meta devuelve 131030, probamos la variante
     * sin el "1" después de 52.
     */

    if (
      !respuesta.ok &&
      datos?.error?.code === 131030 &&
      /^521\d{10}$/.test(
        destinatario
      )
    ) {

      const varianteMexico =
        "52" +
        destinatario.slice(
          3
        );

      console.log(
        "WhatsApp 131030. Reintentando número mexicano:",
        {
          original:
            destinatario,

          variante:
            varianteMexico
        }
      );

      destinatario =
        varianteMexico;

      respuesta =
        await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
          {
            method:
              "POST",

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
                  preview_url:
                    false,

                  body:
                    mensaje
                }
              })
          }
        );

      datos =
        await respuesta
          .json()
          .catch(
            () => ({})
          );
    }

    console.log(
      "Respuesta WhatsApp:",
      datos
    );

    if (
      !respuesta.ok
    ) {

      const error =
        new Error(
          "Error enviando mensaje de WhatsApp"
        );

      error.status =
        respuesta.status;

      error.details =
        datos;

      throw error;

    }

  }

}
// ========================================
// JSON DE GEMINI
// ========================================

function extraerJSON(
  texto
) {

  const contenido =
    String(
      texto || ""
    )
      .trim()
      .replace(
        /^```json/i,
        ""
      )
      .replace(
        /^```/i,
        ""
      )
      .replace(
        /```$/i,
        ""
      )
      .trim();

  try {

    return JSON.parse(
      contenido
    );

  } catch {}

  const inicio =
    contenido.indexOf(
      "{"
    );

  const final =
    contenido.lastIndexOf(
      "}"
    );

  if (
    inicio === -1 ||
    final === -1 ||
    final <= inicio
  ) {

    throw new Error(
      "Gemini no devolvió JSON válido."
    );

  }

  return JSON.parse(
    contenido.slice(
      inicio,
      final + 1
    )
  );

}

// ========================================
// APPS SCRIPT
// ========================================

async function llamarAppsScript(
  payload
) {

  if (
    !APPS_SCRIPT_URL
  ) {

    throw new Error(
      "Falta APPS_SCRIPT_URL."
    );

  }

  if (
    !APPS_SCRIPT_SECRET
  ) {

    throw new Error(
      "Falta APPS_SCRIPT_SECRET."
    );

  }

  const respuesta =
    await fetch(
      APPS_SCRIPT_URL,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            secret:
              APPS_SCRIPT_SECRET,

            ...payload
          })
      }
    );

  const datos =
    await respuesta
      .json()
      .catch(
        () => ({})
      );

  if (
    !respuesta.ok
  ) {

    const error =
      new Error(
        "Error comunicando con Apps Script."
      );

    error.status =
      respuesta.status;

    error.details =
      datos;

    throw error;

  }

  if (
    datos &&
    datos.ok === false
  ) {

    const error =
      new Error(
        datos.error ||
        "Apps Script devolvió un error."
      );

    error.details =
      datos;

    throw error;

  }

  return datos;

}
// ========================================
// GEMINI
// ========================================

function instruccionesFinanzas() {

  return `
Eres el asistente personal de finanzas y calendario del usuario.

Tu función es interpretar mensajes de WhatsApp y devolver
EXCLUSIVAMENTE un objeto JSON válido.

Nunca inventes datos que el usuario no proporcionó.

ACCIONES DISPONIBLES:

1. registrar
2. eliminar
3. reporte
4. historial_producto
5. configurar_ahorro
6. meta_ahorro
7. metas_resumen

8. super_agregar_lista
9. super_ver_lista
10. super_eliminar_lista
11. super_comprar
12. super_historial
13. super_resumen_producto
14. super_comparar_producto

15. analisis_finanzas

16. calendario_ver
17. calendario_crear
18. calendario_eliminar

19. cancelar
20. conversar


========================================
SUPER — LISTA DE COMPRAS
========================================

Si el usuario dice cosas como:

"agrega papel de baño a la lista"
"pon leche en la lista del súper"
"necesito comprar huevos"
"agrega detergente"
"qué tengo que comprar"

NO debes tratarlo como una compra.

Usa:

super_agregar_lista

Para agregar un producto a la lista SOLO necesitamos el nombre
del producto.

NO preguntes precio.
NO preguntes cantidad.
NO preguntes tienda.
NO preguntes monto.
NO preguntes presentación.

Ejemplo:

Usuario:
"agrega papel de baño a la lista del súper"

Respuesta:

{
  "accion": "super_agregar_lista",
  "producto": "Papel de baño"
}


========================================
VER LISTA DEL SÚPER
========================================

Si el usuario dice:

"pásame mi lista"
"qué tengo pendiente del súper"
"qué me falta comprar"
"enséñame la lista del súper"

usa:

super_ver_lista

No incluyas productos históricos.
Solo debe mostrar productos pendientes.


========================================
QUITAR DE LA LISTA
========================================

Si el usuario dice:

"quita la leche de la lista"
"ya no necesito el papel"
"elimina huevos de mi lista"

usa:

super_eliminar_lista

Ejemplo:

{
  "accion": "super_eliminar_lista",
  "producto": "Leche"
}


========================================
COMPRAR UN PRODUCTO DE LA LISTA
========================================

Si el usuario indica que compró un producto que está
o debería estar en su lista:

"compré el papel de baño"
"ya compré la leche"
"compré papel de baño en Walmart por 120 pesos"

usa:

super_comprar

Extrae todos los datos que el usuario haya proporcionado.

Ejemplo:

{
  "accion": "super_comprar",
  "producto": "Papel de baño",
  "data": {
    "Producto": "Papel de baño",
    "Tienda": "Walmart",
    "Monto": 120
  }
}

NO inventes cantidad, unidad, tienda o precio.


========================================
HISTORIAL DEL SÚPER
========================================

Si el usuario pregunta:

"cuánto he pagado por papel de baño"
"enséñame mis compras de papel"
"historial del papel de baño"

usa:

super_historial


========================================
RESUMEN DE PRODUCTO
========================================

Si pregunta:

"cuánto gasto normalmente en papel"
"cuál es el precio promedio del papel"
"cómo ha estado el precio del papel"

usa:

super_resumen_producto


========================================
COMPARAR PRODUCTO
========================================

Si pregunta:

"dónde me ha salido más barato el papel"
"en qué tienda me sale más barato"
"compara el precio del papel"
"cuál ha sido el precio más barato del papel"

usa:

super_comparar_producto


========================================
ANÁLISIS FINANCIERO
========================================

Usa:

analisis_finanzas

cuando el usuario haga una pregunta que requiera analizar
datos históricos de Ingresos, Pagos, Super, Ahorros o Metas.

Ejemplos:

"¿en qué mes me pagaron más?"
"¿cuándo recibí bonos?"
"¿cuánto gasté en luz este año?"
"¿qué mes pagué menos?"
"¿en qué categoría gasto más?"
"¿cuánto he gastado este año?"
"¿dónde he gastado más dinero?"
"¿cuánto dinero recibí en bonos?"

En este caso NO inventes la respuesta.

Devuelve la pregunta dentro del JSON para que el sistema
consulte los datos reales en Google Sheets.

Ejemplo:

{
  "accion": "analisis_finanzas",
  "pregunta": "¿En qué mes me pagaron más?"
}


========================================
INGRESOS
========================================

Si el usuario proporciona un ingreso:

"me pagaron 25000 de nómina"
"recibí un bono de 5000"

usa:

registrar

sheet:

Ingresos

========================================
PAGOS
========================================

Si el usuario dice:

"pagué 800 de luz"
"registré el pago de internet"

usa:

registrar

sheet:

Pagos


========================================
ELIMINAR
========================================

Si pide eliminar un registro existente:

usa:

eliminar

Nunca elimines directamente.
El sistema pedirá confirmación.


========================================
REPORTES
========================================

Si pide un reporte:

"reporte de septiembre"
"resumen de este mes"
"reporte de agosto"

usa:

reporte


========================================
AHORROS
========================================

Si quiere configurar reglas de ahorro:

configurar_ahorro

Si quiere crear una meta:

meta_ahorro

Si quiere consultar sus metas:

metas_resumen


========================================
CALENDARIO
========================================

CONSULTAR CALENDARIO

Si el usuario quiere consultar sus eventos:

"consulta mi calendario"
"qué tengo en mi calendario"
"qué eventos tengo"
"qué tengo mañana"
"qué tengo esta semana"
"muéstrame mis eventos"

usa:

calendario_ver

Si el usuario proporciona un periodo, conserva esa información
en el JSON.

Ejemplo sin periodo:

{
  "accion": "calendario_ver"
}

Ejemplo con fechas:

{
  "accion": "calendario_ver",
  "timeMin": "2026-10-09T00:00:00",
  "timeMax": "2026-10-10T00:00:00"
}

Si el usuario indica una cantidad máxima de eventos:

{
  "accion": "calendario_ver",
  "maxResults": 20
}

Nunca inventes fechas.


========================================
BUSCAR EVENTO
========================================

Si el usuario quiere encontrar un evento específico:

"busca mi reunión"
"encuentra el evento de mañana"
"busca el evento llamado reunión"

usa:

calendario_buscar

Ejemplo:

{
  "accion": "calendario_buscar",
  "buscar": "reunión"
}


========================================
CREAR EVENTO
========================================

Si el usuario quiere crear un evento:

"crea una reunión mañana a las 10"
"agenda una cita el viernes"
"pon una reunión con Luis"

usa:

calendario_crear

Extrae solamente los datos proporcionados.

Ejemplo:

{
  "accion": "calendario_crear",
  "data": {
    "titulo": "Reunión",
    "fecha": "2026-10-09",
    "horaInicio": "10:00"
  }
}

Nunca inventes datos faltantes.


========================================
ELIMINAR EVENTO
========================================

Si el usuario quiere eliminar un evento:

"elimina la reunión"
"borra mi cita"
"quita el evento de mañana"

usa:

calendario_eliminar

Si proporciona un ID:

{
  "accion": "calendario_eliminar",
  "eventId": "ID_DEL_EVENTO"
}

Si proporciona solamente el nombre:

{
  "accion": "calendario_eliminar",
  "buscar": "reunión"
}

Nunca elimines directamente.
El sistema pedirá confirmación.



========================================
CANCELAR
========================================

Si el usuario dice:

"cancelar"
"olvídalo"
"ya no"
"cancela"

usa:

cancelar


========================================
CONVERSACIÓN
========================================

Si solamente está conversando o la intención no corresponde
a ninguna acción anterior:

usa:

conversar


========================================
FORMATO
========================================

Siempre devuelve JSON válido.

Para registrar:

{
  "accion": "registrar",
  "sheet": "Ingresos",
  "data": {}
}

o:

{
  "accion": "registrar",
  "sheet": "Pagos",
  "data": {}
}

Para Super:

{
  "accion": "super_agregar_lista",
  "producto": "..."
}

Para análisis:

{
  "accion": "analisis_finanzas",
  "pregunta": "..."
}

No agregues explicaciones fuera del JSON.
`;
}

async function llamadaGemini(
  prompt
) {

  if (
    !GEMINI_API_KEY
  ) {

    throw new Error(
      "Falta GEMINI_API_KEY."
    );

  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const respuesta =
    await fetch(
      url,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            contents: [
              {
                role:
                  "user",

                parts: [
                  {
                    text:
                      prompt
                  }
                ]
              }
            ],

            generationConfig: {
              temperature:
                0.1,

              responseMimeType:
                "application/json"
            }
          })
      }
    );

  const datos =
    await respuesta
      .json()
      .catch(
        () => ({})
      );

  if (
    !respuesta.ok
  ) {

    const error =
      new Error(
        "Error llamando a Gemini."
      );

    error.status =
      respuesta.status;

    error.details =
      datos;

    throw error;

  }

  const texto =
    datos
      ?.candidates?.[0]
      ?.content?.parts?.[0]
      ?.text;

  if (
    !texto
  ) {

    throw new Error(
      "Gemini no devolvió contenido."
    );

  }

  return texto;

}

async function interpretarConGemini(
  texto
) {

  const ahora = new Date();

  const hoyISO =
    ahora.toLocaleDateString(
      "en-CA",
      { timeZone: "America/Mexico_City" }
    );

  const hoyTexto =
    ahora.toLocaleDateString(
      "es-MX",
      {
        timeZone: "America/Mexico_City",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }
    );

  const prompt = [
    instruccionesFinanzas(),

    "",

    "FECHA ACTUAL (zona America/Mexico_City):",
    `Hoy es ${hoyTexto} (${hoyISO}).`,
    "Usa esta fecha como referencia para 'hoy', 'mañana', 'esta semana', 'este mes', etc.",
    "Nunca inventes otro año ni otra fecha base.",
    "Para timeMin y timeMax usa formato YYYY-MM-DDTHH:mm:ss sin zona horaria ni 'Z'.",

    "",

    "MENSAJE DEL USUARIO:",

    texto,

    "",

    "Devuelve únicamente el JSON correspondiente."
  ].join("\n");

  const respuesta =
    await llamadaGemini(
      prompt
    );

  return extraerJSON(
    respuesta
  );

}
// ========================================
// APPS SCRIPT — INGRESOS Y PAGOS
// ========================================

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


// ========================================
// SUPER — LISTA PENDIENTE
// ========================================

const superAgregarLista =
  data =>
    llamarAppsScript({
      action: "super_agregar_lista",
      data
    });

const superVerLista =
  () =>
    llamarAppsScript({
      action: "super_ver_lista"
    });

const superBuscarPendiente =
  producto =>
    llamarAppsScript({
      action: "super_buscar_pendiente",
      producto
    });

const superEliminarLista =
  idLista =>
    llamarAppsScript({
      action: "super_eliminar_lista",
      idLista
    });


// ========================================
// SUPER — COMPRAS
// ========================================

const superRegistrarCompra =
  data =>
    llamarAppsScript({
      action: "super_registrar_compra",
      data
    });

const superActualizarCompra =
  (fila, data, esperado) =>
    llamarAppsScript({
      action: "super_actualizar_compra",
      fila,
      data,
      esperado
    });

const superRegistrarCompraVinculada =
  (idLista, data) =>
    llamarAppsScript({
      action:
        "super_registrar_compra_vinculada",
      idLista,
      data
    });

const superVincularCompra =
  (idLista, idCompra) =>
    llamarAppsScript({
      action:
        "super_vincular_compra",
      idLista,
      idCompra
    });


// ========================================
// SUPER — HISTORIAL Y ANÁLISIS
// ========================================

const superHistorial =
  (producto, meses) =>
    llamarAppsScript({
      action: "super_historial",
      producto,
      meses
    });

const superResumenProducto =
  producto =>
    llamarAppsScript({
      action:
        "super_resumen_producto",
      producto
    });

const superCompararProducto =
  producto =>
    llamarAppsScript({
      action:
        "super_comparar_producto",
      producto
    });


// ========================================
// ANÁLISIS FINANCIERO
// ========================================

const analizarFinanzas =
  pregunta =>
    llamarAppsScript({
      action:
        "analisis_finanzas",
      pregunta
    });


// ========================================
// AHORRO
// ========================================

const listarConfig =
  () =>
    llamarAppsScript({
      action:
        "config_listar"
    });

const guardarConfig =
  data =>
    llamarAppsScript({
      action:
        "config_guardar",
      data
    });

const guardarAhorro =
  data =>
    llamarAppsScript({
      action:
        "ahorro_guardar",
      data
    });

const guardarMeta =
  data =>
    llamarAppsScript({
      action:
        "meta_guardar",
      data
    });

const consultarMetas =
  () =>
    llamarAppsScript({
      action:
        "metas_resumen"
    });


// ========================================
// CALENDARIO
// ========================================

const calendarioListar =
  (
    timeMin,
    timeMax,
    maxResults
  ) =>
    llamarAppsScript({

      action:
        "calendar_list",

      payload: {

        timeMin,

        timeMax,

        maxResults

      }

    });


const calendarioBuscar =
  (
    buscar,
    timeMin,
    timeMax,
    maxResults
  ) =>
    llamarAppsScript({

      action:
        "calendar_search",

      payload: {

        buscar,

        timeMin,

        timeMax,

        maxResults

      }

    });


const calendarioCrear =
  data =>
    llamarAppsScript({

      action:
        "calendar_create",

      payload: {

        data

      }

    });


const calendarioEliminarEvento =
  eventId =>
    llamarAppsScript({

      action:
        "calendar_delete",

      payload: {

        eventId

      }

    });


// ========================================
// HISTORIAL GENERAL DE PRODUCTOS
// ========================================

const consultarHistorialProducto =
  (
    producto,
    meses
  ) =>
    llamarAppsScript({
      action:
        "historial_producto",

      producto,

      meses
    });
// ========================================
// DATOS CALCULADOS
// ========================================

function combinarDatos(
  anteriores,
  nuevos
) {

  const resultado = {
    ...(anteriores || {})
  };

  if (
    nuevos &&
    typeof nuevos ===
      "object"
  ) {

    for (
      const [
        campo,
        valor
      ]
      of Object.entries(
        nuevos
      )
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
  textoOriginal = ""
) {

  const resultado = {
    ...(data || {})
  };

  if (
    sheet !==
    "Super"
  ) {

    return resultado;

  }

  if (
    estaVacio(
      resultado["Producto base"]
    ) &&
    !estaVacio(
      resultado.Producto
    )
  ) {

    resultado["Producto base"] =
      resultado.Producto;

  }

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

  if (
    monto > 0 &&
    cantidad > 0 &&
    contenido > 0
  ) {

    resultado[
      "Precio por unidad"
    ] =
      monto /
      (
        cantidad *
        contenido
      );

  } else if (
    monto > 0 &&
    cantidad > 0 &&
    estaVacio(
      resultado[
        "Precio por unidad"
      ]
    )
  ) {

    resultado[
      "Precio por unidad"
    ] =
      monto /
      cantidad;

  }

  return resultado;

}


// ========================================
// FECHAS Y PERIODOS
// ========================================

function fechaComparableDDMMYYYY(
  valor
) {

  if (
    !valor
  ) {

    return null;

  }

  const texto =
    String(
      valor
    ).trim();

  let match =
    texto.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );

  if (
    match
  ) {

    return new Date(
      Number(
        match[3]
      ),
      Number(
        match[2]
      ) - 1,
      Number(
        match[1]
      )
    );

  }

  match =
    texto.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

  if (
    match
  ) {

    return new Date(
      Number(
        match[1]
      ),
      Number(
        match[2]
      ) - 1,
      Number(
        match[3]
      )
    );

  }

  const fecha =
    new Date(
      valor
    );

  return Number.isNaN(
    fecha.getTime()
  )
    ? null
    : fecha;

}


// ========================================
// RESUMEN DE HISTORIAL
// ========================================

function formatearHistorial(
  resultado
) {

  const registros =
    resultado?.registros ||
    resultado?.historial ||
    [];

  if (
    !Array.isArray(
      registros
    ) ||
    registros.length === 0
  ) {

    return (
      "🔎 No encontré historial para ese producto."
    );

  }

  const producto =
    resultado.producto ||
    registros[0]?.Producto ||
    registros[0]?.[
      "Producto base"
    ] ||
    "Producto";

  const lineas =
    registros.map(
      (registro, indice) => {

        const fecha =
          registro[
            "Fecha de compra"
          ] ||
          registro.Fecha ||
          "";

        const tienda =
          registro.Tienda ||
          "";

        const monto =
          registro.Monto;

        const precio =
          registro[
            "Precio por unidad"
          ];

        return [
          `*${indice + 1}.* ${fecha}`,
          tienda
            ? `Tienda: ${tienda}`
            : "",
          monto !== undefined &&
          monto !== ""
            ? `Total: ${formatearDinero(
                monto
              )}`
            : "",
          precio !== undefined &&
          precio !== ""
            ? `Precio unitario: ${formatearDinero(
                precio
              )}`
            : ""
        ]
          .filter(Boolean)
          .join("\n");

      }
    );

  return [
    `🛒 *Historial: ${producto}*`,
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ].join("\n");

}


// ========================================
// FORMATEAR REPORTE
// ========================================

function formatearReporte(
  resultado
) {

  const reportes =
    resultado?.reportes ||
    [];

  if (
    !reportes.length
  ) {

    return (
      "📊 No encontré información para ese periodo."
    );

  }

  const lineas =
    reportes.map(
      reporte =>
        [
          `📅 *${reporte.Mes || reporte.mes || "Periodo"}*`,

          reporte[
            "Total de ingresos"
          ] !== undefined
            ? `Ingresos: ${formatearDinero(
                reporte[
                  "Total de ingresos"
                ]
              )}`
            : "",

          reporte[
            "Total pagos"
          ] !== undefined
            ? `Pagos: ${formatearDinero(
                reporte[
                  "Total pagos"
                ]
              )}`
            : "",

          reporte[
            "Total super"
          ] !== undefined
            ? `Súper: ${formatearDinero(
                reporte[
                  "Total super"
                ]
              )}`
            : "",

          reporte[
            "Gastos totales"
          ] !== undefined
            ? `Gastos totales: ${formatearDinero(
                reporte[
                  "Gastos totales"
                ]
              )}`
            : "",

          reporte[
            "Saldo final"
          ] !== undefined
            ? `Saldo: ${formatearDinero(
                reporte[
                  "Saldo final"
                ]
              )}`
            : ""
        ]
          .filter(Boolean)
          .join("\n")
    );

  return [
    "📊 *Reporte financiero*",
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ].join("\n");

}
// ========================================
// SUPER — LISTA PENDIENTE
// ========================================

function resumenNuevaListaSuper(
  data
) {

  return [
    "🛒 *Agregar a la lista del súper*",
    SEPARADOR,
    `Producto: *${
      data.Producto ||
      data["Producto base"] ||
      "—"
    }*`,
    data.Categoría
      ? `Categoría: ${data.Categoría}`
      : "",
    data.Notas
      ? `Notas: ${data.Notas}`
      : "",
    "",
    "¿Lo agrego a tu lista?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}

function formatearListaSuper(
  resultado
) {

  const lista =
    resultado?.registros ||
    resultado?.lista ||
    resultado?.pendientes ||
    [];

  if (
    !Array.isArray(lista) ||
    lista.length === 0
  ) {

    return [
      "🛒 *Lista del súper*",
      "",
      "No tienes productos pendientes."
    ].join("\n");

  }

  const lineas =
    lista.map(
      (item, indice) => {

        const producto =
          item.Producto ||
          item["Producto base"] ||
          "Producto";

        return `${indice + 1}. *${producto}*`;

      }
    );

  return [
    "🛒 *Lista del súper*",
    "",
    lineas.join("\n")
  ].join("\n");

}


// ========================================
// AGREGAR A LISTA
// ========================================

async function iniciarAgregarListaSuper(
  interpretacion,
  remitente
) {

  const producto =
    String(
      interpretacion?.producto ||
      interpretacion?.data?.Producto ||
      ""
    ).trim();

  if (!producto) {

    return (
      "¿Qué producto quieres agregar a la lista del súper?"
    );

  }

  const data = {

    Producto:
      producto,

    "Producto base":
      interpretacion?.productoBase ||
      interpretacion?.data?.[
        "Producto base"
      ] ||
      producto,

    Categoría:
      interpretacion?.categoria ||
      interpretacion?.data?.Categoría ||
      "",

    Notas:
      interpretacion?.notas ||
      interpretacion?.data?.Notas ||
      ""

  };

  // Primero verificamos si ya existe
  // para evitar duplicados.

  const resultado =
    await superBuscarPendiente(
      producto
    );

  const coincidencias =
    resultado?.coincidencias ||
    [];

  if (
    coincidencias.length > 0
  ) {

    const existente =
      coincidencias[0]?.data ||
      {};

    guardarSesion(
      remitente,
      {
        tipo:
          "super_lista_duplicado_confirmacion",

        existente,

        data
      }
    );

    return [
      "🛒 *El producto ya está en tu lista*",
      "",
      `Producto: *${
        existente.Producto ||
        existente["Producto base"] ||
        producto
      }*`,
      "",
      "¿Quieres agregarlo nuevamente?",
      "✅ Sí",
      "❌ No"
    ].join("\n");

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "super_lista_confirmacion",

      data
    }
  );

  return resumenNuevaListaSuper(
    data
  );

}


// ========================================
// CONFIRMAR AGREGAR A LISTA
// ========================================

async function procesarSuperListaConfirmacion(
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
      "❌ No agregué el producto a la lista."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para agregarlo o *no* para cancelar."
    );

  }

  const resultado =
    await superAgregarLista(
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Producto agregado a la lista*",
    "",
    `🛒 *${
      sesion.data.Producto
    }*`,
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// DUPLICADO EN LISTA
// ========================================

async function procesarSuperListaDuplicado(
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
      "❌ No agregué otro elemento."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para agregarlo nuevamente o *no* para cancelar."
    );

  }

  const resultado =
    await superAgregarLista(
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Agregado nuevamente a la lista*",
    "",
    `🛒 *${
      sesion.data.Producto
    }*`,
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// COMPRA DE PRODUCTO PENDIENTE
// ========================================

function resumenCompraSuper(
  data
) {

  return [
    "🛒 *Compra detectada*",
    SEPARADOR,

    `Producto: *${
      data.Producto ||
      data["Producto base"] ||
      "—"
    }*`,

    data["Fecha de compra"]
      ? `Fecha: ${data["Fecha de compra"]}`
      : "",

    data.Monto !== undefined &&
    data.Monto !== ""
      ? `Monto: ${formatearDinero(
          data.Monto
        )}`
      : "",

    data.Tienda
      ? `Tienda: ${data.Tienda}`
      : "",

    data.Cantidad !== undefined &&
    data.Cantidad !== ""
      ? `Cantidad: ${data.Cantidad}`
      : "",

    data.Unidad
      ? `Unidad: ${data.Unidad}`
      : "",

    data[
      "Contenido por empaque"
    ]
      ? `Contenido: ${
          data[
            "Contenido por empaque"
          ]
        }`
      : "",

    data[
      "Precio por unidad"
    ] !== undefined &&
    data[
      "Precio por unidad"
    ] !== ""
      ? `Precio por unidad: ${formatearDinero(
          data[
            "Precio por unidad"
          ]
        )}`
      : "",

    "",
    "¿Los datos son correctos?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


async function iniciarCompraSuper(
  interpretacion,
  remitente,
  textoOriginal
) {

  const producto =
    String(
      interpretacion?.producto ||
      interpretacion?.data?.Producto ||
      ""
    ).trim();

  if (!producto) {

    return (
      "¿Qué producto compraste?"
    );

  }

  const resultado =
    await superBuscarPendiente(
      producto
    );

  const coincidencias =
    resultado?.coincidencias ||
    [];

  if (
    coincidencias.length === 0
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "super_compra_nuevo_confirmacion",

        interpretacion,

        textoOriginal
      }
    );

    return [
      `🔎 No encontré *${producto}* en tu lista pendiente.`,
      "",
      "Puedo registrarlo como una compra nueva.",
      "",
      "¿Quieres registrarlo?",
      "✅ Sí",
      "❌ No"
    ].join("\n");

  }

  if (
    coincidencias.length > 1
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "super_compra_seleccion",

        coincidencias,

        interpretacion,

        textoOriginal
      }
    );

    const lista =
      coincidencias
        .map(
          (item, indice) => {

            const data =
              item.data ||
              {};

            return [
              `*${indice + 1}.*`,
              data.Producto ||
              data["Producto base"] ||
              "Producto"
            ].join(" ");

          }
        )
        .join("\n");

    return [
      "🛒 *Encontré varios productos pendientes*",
      "",
      lista,
      "",
      "¿Cuál compraste?",
      "Responde con el número."
    ].join("\n");

  }

  const pendiente =
    coincidencias[0]?.data ||
    {};

  const data =
    completarDatosCalculados(
      "Super",
      {
        ...(interpretacion.data ||
          {}),

        Producto:
          interpretacion.data?.Producto ||
          pendiente.Producto ||
          producto,

        "Producto base":
          interpretacion.data?.[
            "Producto base"
          ] ||
          pendiente[
            "Producto base"
          ] ||
          pendiente.Producto ||
          producto
      },
      textoOriginal
    );

  guardarSesion(
    remitente,
    {
      tipo:
        "super_compra_confirmacion",

      idLista:
        pendiente.ID,

      pendiente,

      data,

      textoOriginal
    }
  );

  return resumenCompraSuper(
    data
  );

}


// ========================================
// CONFIRMAR COMPRA VINCULADA
// ========================================

async function procesarCompraSuperConfirmacion(
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
      "❌ No registré la compra."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para registrar la compra o *no* para cancelar."
    );

  }

  const resultado =
    await superRegistrarCompraVinculada(
      sesion.idLista,
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Compra registrada*",
    "",
    `Producto: *${
      sesion.data.Producto
    }*`,
    resultado.compra?.id
      ? `ID compra: ${resultado.compra.id}`
      : "",
    "🛒 El producto quedó marcado como *Comprado*."
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// SELECCIONAR PRODUCTO PENDIENTE
// ========================================

async function procesarSuperCompraSeleccion(
  textoUsuario,
  remitente,
  sesion
) {

  const match =
    String(
      textoUsuario
    ).match(
      /\d+/
    );

  if (!match) {

    return `Responde con un número del 1 al ${sesion.coincidencias.length}.`;

  }

  const numero =
    Number(
      match[0]
    );

  if (
    numero < 1 ||
    numero >
      sesion.coincidencias.length
  ) {

    return `Elige un número del 1 al ${sesion.coincidencias.length}.`;

  }

  const pendiente =
    sesion.coincidencias[
      numero - 1
    ]?.data ||
    {};

  const interpretacion =
    sesion.interpretacion ||
    {};

  const data =
    completarDatosCalculados(
      "Super",
      {
        ...(interpretacion.data ||
          {}),

        Producto:
          interpretacion.data?.Producto ||
          pendiente.Producto,

        "Producto base":
          interpretacion.data?.[
            "Producto base"
          ] ||
          pendiente[
            "Producto base"
          ] ||
          pendiente.Producto
      },
      sesion.textoOriginal
    );

  guardarSesion(
    remitente,
    {
      tipo:
        "super_compra_confirmacion",

      idLista:
        pendiente.ID,

      pendiente,

      data,

      textoOriginal:
        sesion.textoOriginal
    }
  );

  return resumenCompraSuper(
    data
  );

}


// ========================================
// COMPRA NUEVA NO EN LISTA
// ========================================

async function procesarCompraSuperNueva(
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
      "❌ No registré la compra."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para registrarla o *no* para cancelar."
    );

  }

  const interpretacion =
    sesion.interpretacion ||
    {};

  const data =
    completarDatosCalculados(
      "Super",
      interpretacion.data ||
      {},
      sesion.textoOriginal
    );

  if (
    estaVacio(
      data.Producto
    )
  ) {

    sesiones.delete(
      remitente
    );

    return (
      "No pude identificar el producto. No registré nada."
    );

  }

  const resultado =
    await superRegistrarCompra(
      data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Compra registrada*",
    "",
    `Producto: *${
      data.Producto
    }*`,
    resultado.id
      ? `ID compra: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}
// ========================================
// SUPER — CONSULTAS
// ========================================

async function consultarListaSuper() {

  const resultado =
    await superVerLista();

  return formatearListaSuper(
    resultado
  );

}


// ========================================
// HISTORIAL DE PRODUCTO
// ========================================

async function consultarHistorialSuper(
  producto,
  meses
) {

  if (
    !producto
  ) {

    return (
      "¿De qué producto quieres consultar el historial?"
    );

  }

  const resultado =
    await superHistorial(
      producto,
      meses
    );

  return formatearHistorial(
    resultado
  );

}


// ========================================
// RESUMEN DE PRODUCTO
// ========================================

function formatearResumenProducto(
  resultado
) {

  if (
    !resultado ||
    resultado.error
  ) {

    return (
      "🔎 No encontré información suficiente para ese producto."
    );

  }

  const producto =
    resultado.producto ||
    resultado.Producto ||
    "Producto";

  const compras =
    resultado.compras ??
    resultado.totalCompras ??
    resultado.total ??
    0;

  const gasto =
    resultado.gastoTotal ??
    resultado.totalGastado ??
    resultado.montoTotal ??
    0;

  const promedio =
    resultado.precioPromedio ??
    resultado.promedio ??
    null;

  const minimo =
    resultado.precioMinimo ??
    resultado.minimo ??
    null;

  const maximo =
    resultado.precioMaximo ??
    resultado.maximo ??
    null;

  const tienda =
    resultado.tiendaMasBarata ??
    resultado.mejorTienda ??
    "";

  return [
    `🛒 *Resumen: ${producto}*`,
    SEPARADOR,

    `Compras: ${compras}`,

    gasto !== null &&
    gasto !== undefined
      ? `Gasto total: ${formatearDinero(
          gasto
        )}`
      : "",

    promedio !== null &&
    promedio !== undefined
      ? `Precio promedio: ${formatearDinero(
          promedio
        )}`
      : "",

    minimo !== null &&
    minimo !== undefined
      ? `Precio más bajo: ${formatearDinero(
          minimo
        )}`
      : "",

    maximo !== null &&
    maximo !== undefined
      ? `Precio más alto: ${formatearDinero(
          maximo
        )}`
      : "",

    tienda
      ? `Tienda más barata: *${tienda}*`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


async function consultarResumenSuper(
  producto
) {

  if (
    !producto
  ) {

    return (
      "¿De qué producto quieres consultar el resumen?"
    );

  }

  const resultado =
    await superResumenProducto(
      producto
    );

  return formatearResumenProducto(
    resultado
  );

}


// ========================================
// COMPARACIÓN DE PRODUCTO
// ========================================

function formatearComparacionProducto(
  resultado
) {

  if (
    !resultado ||
    resultado.error
  ) {

    return (
      "🔎 No encontré suficiente información para comparar ese producto."
    );

  }

  const producto =
    resultado.producto ||
    resultado.Producto ||
    "Producto";

  const comparaciones =
    resultado.comparaciones ||
    resultado.tiendas ||
    resultado.resultados ||
    [];

  if (
    !Array.isArray(
      comparaciones
    ) ||
    comparaciones.length === 0
  ) {

    return [
      `🛒 *Comparación: ${producto}*`,
      "",
      "No encontré suficientes compras para comparar tiendas."
    ].join("\n");

  }

  const lineas =
    comparaciones.map(
      (item, indice) => {

        const tienda =
          item.tienda ||
          item.Tienda ||
          "Tienda";

        const promedio =
          item.precioPromedio ??
          item.promedio ??
          item.precio ??
          null;

        const minimo =
          item.precioMinimo ??
          item.minimo ??
          null;

        const compras =
          item.compras ??
          item.totalCompras ??
          null;

        return [
          `*${indice + 1}. ${tienda}*`,

          promedio !== null
            ? `Promedio: ${formatearDinero(
                promedio
              )}`
            : "",

          minimo !== null
            ? `Mínimo: ${formatearDinero(
                minimo
              )}`
            : "",

          compras !== null
            ? `Compras: ${compras}`
            : ""
        ]
          .filter(Boolean)
          .join("\n");

      }
    );

  return [
    `🛒 *Comparación: ${producto}*`,
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ].join("\n");

}


async function compararSuper(
  producto
) {

  if (
    !producto
  ) {

    return (
      "¿Qué producto quieres comparar?"
    );

  }

  const resultado =
    await superCompararProducto(
      producto
    );

  return formatearComparacionProducto(
    resultado
  );

}


// ========================================
// ELIMINAR PRODUCTO DE LA LISTA
// ========================================

async function iniciarEliminarListaSuper(
  interpretacion,
  remitente
) {

  const producto =
    String(
      interpretacion?.producto ||
      ""
    ).trim();

  const idLista =
    String(
      interpretacion?.idLista ||
      ""
    ).trim();

  if (
    idLista
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "super_eliminar_confirmacion",

        idLista,

        producto:
          producto ||
          "Producto"
      }
    );

    return [
      "🗑️ *Eliminar producto de la lista*",
      "",
      `Producto: *${
        producto ||
        "Producto"
      }*`,
      "",
      "¿Confirmas que quieres eliminarlo?",
      "✅ Sí",
      "❌ No"
    ].join("\n");

  }

  if (
    !producto
  ) {

    return (
      "¿Qué producto quieres eliminar de la lista del súper?"
    );

  }

  const resultado =
    await superBuscarPendiente(
      producto
    );

  const coincidencias =
    resultado?.coincidencias ||
    [];

  if (
    coincidencias.length === 0
  ) {

    return [
      "🛒 No encontré ese producto en tu lista pendiente.",
      "",
      `Producto buscado: *${producto}*`
    ].join("\n");

  }

  if (
    coincidencias.length > 1
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "super_eliminar_seleccion",

        coincidencias
      }
    );

    const lista =
      coincidencias.map(
        (item, indice) => {

          const data =
            item.data ||
            {};

          return `${indice + 1}. *${
            data.Producto ||
            data["Producto base"] ||
            "Producto"
          }*`;

        }
      );

    return [
      "🗑️ *Encontré varios productos*",
      "",
      lista.join("\n"),
      "",
      "¿Cuál quieres eliminar?",
      "Responde con el número."
    ].join("\n");

  }

  const pendiente =
    coincidencias[0]?.data ||
    {};

  guardarSesion(
    remitente,
    {
      tipo:
        "super_eliminar_confirmacion",

      idLista:
        pendiente.ID,

      producto:
        pendiente.Producto ||
        pendiente["Producto base"] ||
        producto
    }
  );

  return [
    "🗑️ *Eliminar producto de la lista*",
    "",
    `Producto: *${
      pendiente.Producto ||
      pendiente["Producto base"] ||
      producto
    }*`,
    "",
    "¿Confirmas que quieres eliminarlo?",
    "✅ Sí",
    "❌ No"
  ].join("\n");

}


// ========================================
// CONFIRMAR ELIMINACIÓN
// ========================================

async function procesarEliminarListaSuperConfirmacion(
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
      "❌ No eliminé el producto."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para eliminarlo o *no* para cancelar."
    );

  }

  const resultado =
    await superEliminarLista(
      sesion.idLista
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Producto eliminado de la lista*",
    "",
    `🛒 ${
      sesion.producto ||
      "Producto"
    }`
  ].join("\n");

}


// ========================================
// SELECCIÓN PARA ELIMINAR
// ========================================

async function procesarEliminarListaSuperSeleccion(
  textoUsuario,
  remitente,
  sesion
) {

  const match =
    String(
      textoUsuario
    ).match(
      /\d+/
    );

  if (!match) {

    return `Responde con un número del 1 al ${sesion.coincidencias.length}.`;

  }

  const numero =
    Number(
      match[0]
    );

  if (
    numero < 1 ||
    numero >
      sesion.coincidencias.length
  ) {

    return `Elige un número del 1 al ${sesion.coincidencias.length}.`;

  }

  const pendiente =
    sesion.coincidencias[
      numero - 1
    ]?.data ||
    {};

  guardarSesion(
    remitente,
    {
      tipo:
        "super_eliminar_confirmacion",

      idLista:
        pendiente.ID,

      producto:
        pendiente.Producto ||
        pendiente["Producto base"] ||
        "Producto"
    }
  );

  return [
    "🗑️ *Eliminar producto de la lista*",
    "",
    `Producto: *${
      pendiente.Producto ||
      pendiente["Producto base"] ||
      "Producto"
    }*`,
    "",
    "¿Confirmas que quieres eliminarlo?",
    "✅ Sí",
    "❌ No"
  ].join("\n");

}
// ========================================
// REGISTRO — INGRESOS Y PAGOS
// ========================================

function obtenerHojaRegistro(
  interpretacion
) {

  const hoja =
    interpretacion?.sheet ||
    interpretacion?.hoja ||
    "";

  const normalizada =
    normalizar(
      hoja
    );

  if (
    normalizada ===
      "ingresos" ||
    normalizada ===
      "ingreso"
  ) {
    return "Ingresos";
  }

  if (
    normalizada ===
      "pagos" ||
    normalizada ===
      "pago"
  ) {
    return "Pagos";
  }

  return null;
}


// ========================================
// VALIDAR CAMPOS
// ========================================

function validarCamposRegistro(
  sheet,
  data
) {

  const requeridos =
    CAMPOS_REQUERIDOS[
      sheet
    ] || [];

  const faltantes =
    requeridos.filter(
      campo =>
        estaVacio(
          data?.[campo]
        )
    );

  return faltantes;

}


// ========================================
// CONSTRUIR DATOS DEL REGISTRO
// ========================================

function prepararDatosRegistro(
  sheet,
  interpretacion
) {

  const data = {
    ...(interpretacion?.data ||
      {})
  };

  if (
    sheet ===
    "Ingresos"
  ) {

    if (
      estaVacio(
        data["Fecha de ingreso"]
      )
    ) {

      data[
        "Fecha de ingreso"
      ] =
        fechaActualMexico();

    }

  }

  if (
    sheet ===
    "Pagos"
  ) {

    if (
      estaVacio(
        data["Fecha de pago"]
      )
    ) {

      data[
        "Fecha de pago"
      ] =
        fechaActualMexico();

    }

    if (
      estaVacio(
        data.Estado
      )
    ) {

      data.Estado =
        "Pagado";

    }

  }

  return data;

}


// ========================================
// RESUMEN DE CONFIRMACIÓN
// ========================================

function resumenRegistroConfirmacion(
  sheet,
  data
) {

  return [
    `📋 *Confirmar registro en ${sheet}*`,
    SEPARADOR,
    formatearRegistro(
      sheet,
      data
    ),
    "",
    "¿Los datos son correctos?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// INICIAR REGISTRO
// ========================================

async function iniciarRegistro(
  interpretacion,
  remitente,
  textoOriginal
) {

  const sheet =
    obtenerHojaRegistro(
      interpretacion
    );

  if (!sheet) {

    return (
      "No pude determinar si quieres registrar un ingreso o un pago."
    );

  }

  const data =
    prepararDatosRegistro(
      sheet,
      interpretacion
    );

  const faltantes =
    validarCamposRegistro(
      sheet,
      data
    );

  if (
    faltantes.length > 0
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "registro_datos_faltantes",

        sheet,

        data,

        faltantes,

        textoOriginal
      }
    );

    return [
      `📝 Para registrar este ${sheet === "Ingresos" ? "ingreso" : "pago"} me falta:`,

      "",
      ...faltantes.map(
        campo =>
          `• ${campo}`
      ),

      "",
      "Puedes enviarme esos datos en un solo mensaje."
    ].join("\n");

  }

  // Revisamos posibles duplicados
  // antes de pedir la confirmación final.

  let similares = null;

  try {

    similares =
      await buscarSimilares(
        sheet,
        data
      );

  } catch (
    error
  ) {

    // Si la búsqueda de similares
    // falla, no bloqueamos el registro.
    // La confirmación sigue siendo obligatoria.

    similares = null;

  }

  const coincidencias =
    similares?.coincidencias ||
    similares?.similares ||
    [];

  if (
    Array.isArray(
      coincidencias
    ) &&
    coincidencias.length > 0
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "registro_duplicado_confirmacion",

        sheet,

        data,

        coincidencias,

        textoOriginal
      }
    );

    const resumen =
      coincidencias
        .slice(
          0,
          3
        )
        .map(
          (item, indice) =>
            [
              `${indice + 1}.`,
              formatearRegistro(
                sheet,
                item.data ||
                  item
              )
            ].join("\n")
        )
        .join(
          `\n\n${SEPARADOR}\n\n`
        );

    return [
      `⚠️ *Encontré un posible registro duplicado en ${sheet}*`,
      "",
      resumen,
      "",
      "¿Quieres registrarlo de todas formas?",
      "✅ Sí",
      "❌ No"
    ].join("\n");

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "registro_confirmacion",

      sheet,

      data,

      textoOriginal
    }
  );

  return resumenRegistroConfirmacion(
    sheet,
    data
  );

}


// ========================================
// CONFIRMAR REGISTRO
// ========================================

async function procesarRegistroConfirmacion(
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
      "❌ No registré nada."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para registrar los datos o *no* para cancelar."
    );

  }

  const data =
    prepararDatosRegistro(
      sesion.sheet,
      sesion.data
    );

  const resultado =
    await guardarEnSheets(
      sesion.sheet,
      data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Registro guardado*",
    "",
    resumenRegistroVisual(
      sesion.sheet,
      data
    ),
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONFIRMAR POSIBLE DUPLICADO
// ========================================

async function procesarRegistroDuplicado(
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
      "❌ No registré el nuevo movimiento."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para registrarlo de todas formas o *no* para cancelar."
    );

  }

  const data =
    prepararDatosRegistro(
      sesion.sheet,
      sesion.data
    );

  const resultado =
    await guardarEnSheets(
      sesion.sheet,
      data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Registro guardado*",
    "",
    resumenRegistroVisual(
      sesion.sheet,
      data
    ),
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// COMPLETAR DATOS FALTANTES
// ========================================

async function procesarDatosFaltantesRegistro(
  textoUsuario,
  remitente,
  sesion
) {

  const nuevaInterpretacion =
    await interpretarConGemini(
      [
        "Necesito completar un registro existente.",
        "",
        `Hoja: ${sesion.sheet}`,
        "",
        "Datos que ya tengo:",
        JSON.stringify(
          sesion.data
        ),
        "",
        "Campos que faltan:",
        JSON.stringify(
          sesion.faltantes
        ),
        "",
        "Mensaje nuevo del usuario:",
        textoUsuario,
        "",
        "Devuelve un JSON con:",
        "",
        '{',
        '  "action": "completar",',
        '  "data": {',
        '    "...": "..."',
        "  }",
        "}",
        "",
        "No inventes datos."
      ].join("\n")
    );

  const nuevosDatos =
    nuevaInterpretacion?.data ||
    {};

  const data =
    combinarDatos(
      sesion.data,
      nuevosDatos
    );

  const faltantes =
    validarCamposRegistro(
      sesion.sheet,
      data
    );

  if (
    faltantes.length > 0
  ) {

    guardarSesion(
      remitente,
      {
        ...sesion,

        data,

        faltantes
      }
    );

    return [
      "Todavía me falta:",
      "",
      ...faltantes.map(
        campo =>
          `• ${campo}`
      )
    ].join("\n");

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "registro_confirmacion",

      sheet:
        sesion.sheet,

      data,

      textoOriginal:
        sesion.textoOriginal
    }
  );

  return resumenRegistroConfirmacion(
    sesion.sheet,
    data
  );

}
// ========================================
// ELIMINAR INGRESOS / PAGOS
// ========================================

async function iniciarEliminarRegistro(
  interpretacion,
  remitente
) {

  const sheet =
    obtenerHojaRegistro(
      interpretacion
    );

  if (!sheet) {

    return (
      "No pude determinar si quieres eliminar un ingreso o un pago."
    );

  }

  const buscar =
    String(
      interpretacion?.buscar ||
      interpretacion?.texto ||
      interpretacion?.criterio ||
      ""
    ).trim();

  if (!buscar) {

    return [
      `¿Qué ${sheet === "Ingresos" ? "ingreso" : "pago"} quieres eliminar?`,
      "",
      "Puedes indicarme el concepto, fecha, monto o ID."
    ].join("\n");

  }

  const resultado =
    await buscarParaEliminar(
      sheet,
      buscar
    );

  const coincidencias =
    resultado?.coincidencias ||
    resultado?.resultados ||
    [];

  if (
    coincidencias.length === 0
  ) {

    return [
      `🔎 No encontré un registro en *${sheet}* con ese criterio.`,
      "",
      `Búsqueda: ${buscar}`
    ].join("\n");

  }

  if (
    coincidencias.length > 1
  ) {

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
        .slice(
          0,
          10
        )
        .map(
          (item, indice) => {

            const data =
              item.data ||
              item;

            return [
              `*${indice + 1}.*`,
              formatearRegistro(
                sheet,
                data
              )
            ]
              .filter(Boolean)
              .join("\n");

          }
        );

    return [
      `🗑️ *Encontré varios registros en ${sheet}*`,
      "",
      lista.join(
        `\n\n${SEPARADOR}\n\n`
      ),
      "",
      "¿Cuál quieres eliminar?",
      "Responde con el número."
    ].join("\n");

  }

  const seleccion =
    coincidencias[0];

  const data =
    seleccion.data ||
    seleccion;

  guardarSesion(
    remitente,
    {
      tipo:
        "eliminar_confirmacion",

      sheet,

      seleccion: {
        fila:
          seleccion.fila,

        data
      }
    }
  );

  return [
    `🗑️ *Eliminar registro de ${sheet}*`,
    SEPARADOR,
    formatearRegistro(
      sheet,
      data
    ),
    "",
    "¿Confirmas que quieres eliminarlo?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// SELECCIONAR REGISTRO A ELIMINAR
// ========================================

async function procesarEliminarSeleccion(
  textoUsuario,
  remitente,
  sesion
) {

  const match =
    String(
      textoUsuario
    ).match(
      /\d+/
    );

  if (!match) {

    return `Responde con un número del 1 al ${sesion.coincidencias.length}.`;

  }

  const numero =
    Number(
      match[0]
    );

  if (
    numero < 1 ||
    numero >
      sesion.coincidencias.length
  ) {

    return `Elige un número del 1 al ${sesion.coincidencias.length}.`;

  }

  const seleccion =
    sesion.coincidencias[
      numero - 1
    ];

  const data =
    seleccion.data ||
    seleccion;

  guardarSesion(
    remitente,
    {
      tipo:
        "eliminar_confirmacion",

      sheet:
        sesion.sheet,

      seleccion: {
        fila:
          seleccion.fila,

        data
      }
    }
  );

  return [
    `🗑️ *Eliminar registro de ${sesion.sheet}*`,
    SEPARADOR,
    formatearRegistro(
      sesion.sheet,
      data
    ),
    "",
    "¿Confirmas que quieres eliminarlo?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONFIRMAR ELIMINACIÓN
// ========================================

async function procesarEliminarConfirmacion(
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
      "❌ No eliminé el registro."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para eliminarlo o *no* para cancelar."
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
    `Hoja: ${sesion.sheet}`,
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// REPORTES
// ========================================

async function ejecutarReporte(
  interpretacion
) {

  const mes =
    interpretacion?.mes ||
    interpretacion?.periodo ||
    "";

  const resultado =
    await consultarReporte(
      mes
    );

  return formatearReporte(
    resultado
  );

}


// ========================================
// HISTORIAL DE PRODUCTO
// ========================================

async function ejecutarHistorialProducto(
  interpretacion
) {

  const producto =
    String(
      interpretacion?.producto ||
      ""
    ).trim();

  const meses =
    interpretacion?.meses ||
    interpretacion?.periodo ||
    "";

  return consultarHistorialSuper(
    producto,
    meses
  );

}
// ========================================
// AHORROS
// ========================================

function resumenAhorroConfirmacion(
  data
) {

  return [
    "💵 *Confirmar ahorro*",
    SEPARADOR,

    data.Fecha
      ? `Fecha: ${data.Fecha}`
      : "",

    data["Tipo de ingreso"]
      ? `Tipo de ingreso: ${data["Tipo de ingreso"]}`
      : "",

    data.Monto !== undefined &&
    data.Monto !== ""
      ? `Monto: ${formatearDinero(
          data.Monto
        )}`
      : "",

    data.Meta
      ? `Meta: ${data.Meta}`
      : "",

    data.Notas
      ? `Notas: ${data.Notas}`
      : "",

    "",
    "¿Los datos son correctos?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


async function iniciarRegistroAhorro(
  interpretacion,
  remitente
) {

  const data = {
    ...(interpretacion?.data ||
      {})
  };

  if (
    estaVacio(
      data.Fecha
    )
  ) {

    data.Fecha =
      fechaActualMexico();

  }

  if (
    estaVacio(
      data.Monto
    )
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "ahorro_datos_faltantes",

        data,

        faltantes: [
          "Monto"
        ]
      }
    );

    return [
      "💵 ¿Cuánto dinero quieres registrar como ahorro?"
    ].join("\n");

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "ahorro_confirmacion",

      data
    }
  );

  return resumenAhorroConfirmacion(
    data
  );

}


// ========================================
// COMPLETAR AHORRO
// ========================================

async function procesarDatosFaltantesAhorro(
  textoUsuario,
  remitente,
  sesion
) {

  const interpretacion =
    await interpretarConGemini(
      [
        "Necesito completar un registro de ahorro.",
        "",
        "Datos existentes:",
        JSON.stringify(
          sesion.data
        ),
        "",
        "Campos faltantes:",
        JSON.stringify(
          sesion.faltantes
        ),
        "",
        "Nuevo mensaje del usuario:",
        textoUsuario,
        "",
        "Devuelve únicamente:",
        '{',
        '  "action": "completar",',
        '  "data": {}',
        "}",
        "",
        "No inventes datos."
      ].join("\n")
    );

  const data =
    combinarDatos(
      sesion.data,
      interpretacion?.data ||
        {}
    );

  if (
    estaVacio(
      data.Monto
    )
  ) {

    guardarSesion(
      remitente,
      {
        ...sesion,
        data,
        faltantes: [
          "Monto"
        ]
      }
    );

    return (
      "Necesito saber el monto del ahorro."
    );

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "ahorro_confirmacion",

      data
    }
  );

  return resumenAhorroConfirmacion(
    data
  );

}


// ========================================
// CONFIRMAR AHORRO
// ========================================

async function procesarAhorroConfirmacion(
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
      "❌ No registré el ahorro."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para registrar el ahorro o *no* para cancelar."
    );

  }

  const resultado =
    await guardarAhorro(
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Ahorro registrado*",
    "",
    sesion.data.Monto !== undefined
      ? `Monto: ${formatearDinero(
          sesion.data.Monto
        )}`
      : "",
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONFIGURAR AHORRO
// ========================================

function resumenConfiguracionAhorro(
  data
) {

  return [
    "⚙️ *Confirmar configuración de ahorro*",
    SEPARADOR,

    data.Tipo
      ? `Tipo: ${data.Tipo}`
      : "",

    data.Clave
      ? `Clave: ${data.Clave}`
      : "",

    data.Modo
      ? `Modo: ${data.Modo}`
      : "",

    data.Valor !== undefined &&
    data.Valor !== ""
      ? `Valor: ${data.Valor}`
      : "",

    data.Desde
      ? `Desde: ${data.Desde}`
      : "",

    data.Hasta
      ? `Hasta: ${data.Hasta}`
      : "",

    data.Activo !== undefined
      ? `Activo: ${
          data.Activo
            ? "Sí"
            : "No"
        }`
      : "",

    data.Notas
      ? `Notas: ${data.Notas}`
      : "",

    "",
    "¿Los datos son correctos?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


async function iniciarConfigurarAhorro(
  interpretacion,
  remitente
) {

  const data = {
    ...(interpretacion?.data ||
      {})
  };

  guardarSesion(
    remitente,
    {
      tipo:
        "config_ahorro_confirmacion",

      data
    }
  );

  return resumenConfiguracionAhorro(
    data
  );

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
      "❌ No cambié la configuración de ahorro."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para guardar la configuración o *no* para cancelar."
    );

  }

  const resultado =
    await guardarConfig(
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Configuración de ahorro guardada*",
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// METAS
// ========================================

function resumenMetaConfirmacion(
  data
) {

  return [
    "🎯 *Confirmar meta de ahorro*",
    SEPARADOR,

    data.Meta
      ? `Meta: *${data.Meta}*`
      : "",

    data[
      "Monto objetivo"
    ] !== undefined &&
    data[
      "Monto objetivo"
    ] !== ""
      ? `Monto objetivo: ${formatearDinero(
          data[
            "Monto objetivo"
          ]
        )}`
      : "",

    data[
      "Fecha objetivo"
    ]
      ? `Fecha objetivo: ${
          data[
            "Fecha objetivo"
          ]
        }`
      : "",

    data.Ahorrado !== undefined &&
    data.Ahorrado !== ""
      ? `Ahorrado actualmente: ${formatearDinero(
          data.Ahorrado
        )}`
      : "",

    data.Estado
      ? `Estado: ${data.Estado}`
      : "",

    data.Notas
      ? `Notas: ${data.Notas}`
      : "",

    "",
    "¿Los datos son correctos?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


async function iniciarMetaAhorro(
  interpretacion,
  remitente
) {

  const data = {
    ...(interpretacion?.data ||
      {})
  };

  if (
    estaVacio(
      data.Ahorrado
    )
  ) {

    data.Ahorrado =
      0;

  }

  if (
    estaVacio(
      data.Estado
    )
  ) {

    data.Estado =
      "Activa";

  }

  const faltantes = [];

  if (
    estaVacio(
      data.Meta
    )
  ) {

    faltantes.push(
      "Meta"
    );

  }

  if (
    estaVacio(
      data[
        "Monto objetivo"
      ]
    )
  ) {

    faltantes.push(
      "Monto objetivo"
    );

  }

  if (
    faltantes.length > 0
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "meta_datos_faltantes",

        data,

        faltantes
      }
    );

    return [
      "🎯 Para crear la meta me falta:",
      "",
      ...faltantes.map(
        campo =>
          `• ${campo}`
      )
    ].join("\n");

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "meta_confirmacion",

      data
    }
  );

  return resumenMetaConfirmacion(
    data
  );

}


// ========================================
// COMPLETAR META
// ========================================

async function procesarDatosFaltantesMeta(
  textoUsuario,
  remitente,
  sesion
) {

  const interpretacion =
    await interpretarConGemini(
      [
        "Necesito completar una meta de ahorro.",
        "",
        "Datos existentes:",
        JSON.stringify(
          sesion.data
        ),
        "",
        "Campos faltantes:",
        JSON.stringify(
          sesion.faltantes
        ),
        "",
        "Nuevo mensaje del usuario:",
        textoUsuario,
        "",
        "Devuelve únicamente:",
        '{',
        '  "action": "completar",',
        '  "data": {}',
        "}",
        "",
        "No inventes datos."
      ].join("\n")
    );

  const data =
    combinarDatos(
      sesion.data,
      interpretacion?.data ||
        {}
    );

  const faltantes = [];

  if (
    estaVacio(
      data.Meta
    )
  ) {

    faltantes.push(
      "Meta"
    );

  }

  if (
    estaVacio(
      data[
        "Monto objetivo"
      ]
    )
  ) {

    faltantes.push(
      "Monto objetivo"
    );

  }

  if (
    faltantes.length > 0
  ) {

    guardarSesion(
      remitente,
      {
        ...sesion,
        data,
        faltantes
      }
    );

    return [
      "Todavía me falta:",
      "",
      ...faltantes.map(
        campo =>
          `• ${campo}`
      )
    ].join("\n");

  }

  if (
    estaVacio(
      data.Ahorrado
    )
  ) {

    data.Ahorrado =
      0;

  }

  if (
    estaVacio(
      data.Estado
    )
  ) {

    data.Estado =
      "Activa";

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "meta_confirmacion",

      data
    }
  );

  return resumenMetaConfirmacion(
    data
  );

}


// ========================================
// CONFIRMAR META
// ========================================

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
      "❌ No creé la meta."
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
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Meta creada*",
    "",
    `🎯 *${
      sesion.data.Meta
    }*`,
    `Objetivo: ${formatearDinero(
      sesion.data[
        "Monto objetivo"
      ]
    )}`,
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONSULTAR METAS
// ========================================

async function ejecutarMetasResumen() {

  const resultado =
    await consultarMetas();

  const metas =
    resultado?.metas ||
    resultado?.registros ||
    [];

  if (
    !Array.isArray(metas) ||
    metas.length === 0
  ) {

    return [
      "🎯 *Mis metas*",
      "",
      "No tienes metas registradas."
    ].join("\n");

  }

  const lineas =
    metas.map(
      (meta, indice) => {

        const nombre =
          meta.Meta ||
          "Meta";

        const objetivo =
          valorNumero(
            meta[
              "Monto objetivo"
            ]
          );

        const ahorrado =
          valorNumero(
            meta.Ahorrado
          );

        const porcentaje =
          objetivo > 0
            ? (
                ahorrado /
                objetivo
              ) *
              100
            : 0;

        return [
          `🎯 *${indice + 1}. ${nombre}*`,
          `Ahorrado: ${formatearDinero(
            ahorrado
          )}`,
          `Objetivo: ${formatearDinero(
            objetivo
          )}`,
          `Avance: ${porcentaje.toFixed(
            1
          )}%`,
          meta[
            "Fecha objetivo"
          ]
            ? `Fecha objetivo: ${
                meta[
                  "Fecha objetivo"
                ]
              }`
            : "",
          meta.Estado
            ? `Estado: ${meta.Estado}`
            : ""
        ]
          .filter(Boolean)
          .join("\n");

      }
    );

  return [
    "🎯 *Mis metas*",
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ].join("\n");

}
// ========================================
// CALENDARIO
// ========================================

function resumenEvento(
  data
) {

  return [
    data.titulo ||
    data.title ||
    data.Titulo
      ? `📅 *${
          data.titulo ||
          data.title ||
          data.Titulo
        }*`
      : "",

    data.fecha
      ? `Fecha: ${data.fecha}`
      : data.start
        ? `Inicio: ${data.start}`
        : "",

    data.hora
      ? `Hora: ${data.hora}`
      : "",

    data.fin
      ? `Fin: ${data.fin}`
      : data.end
        ? `Fin: ${data.end}`
        : "",

    data.duracion
      ? `Duración: ${data.duracion}`
      : "",

    data.ubicacion
      ? `Lugar: ${data.ubicacion}`
      : "",

    data.descripcion
      ? `Descripción: ${data.descripcion}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONSULTAR CALENDARIO
// ========================================
function horaMX(iso) {

  if (!iso) return "";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleString(
    "es-MX",
    {
      timeZone: "America/Mexico_City",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }
  );

}
function formatearEventosCalendario(
  resultado
) {

  const eventos =
    resultado?.eventos ||
    resultado?.events ||
    resultado?.registros ||
    [];

  if (
    !Array.isArray(eventos) ||
    eventos.length === 0
  ) {

    return [
      "📅 *Calendario*",
      "",
      "No encontré eventos para ese periodo."
    ].join("\n");

  }

  const lineas =
    eventos.map(
      (evento, indice) => {

        const titulo =
          evento.titulo ||
          evento.title ||
          evento.Titulo ||
          "Evento";

        const inicio =
          evento.inicio ||
          evento.start ||
          evento.fecha ||
          "";

        const fin =
          evento.fin ||
          evento.end ||
          "";

        const lugar =
          evento.ubicacion ||
          evento.location ||
          "";

        return [
          `*${indice + 1}. ${titulo}*`,
          inicio
            ? `Inicio: ${horaMX(inicio)}`
            : "",
          fin
            ? `Fin: ${horaMX(fin)}`
            : "",
          lugar
            ? `Lugar: ${lugar}`
            : ""
        ]
          .filter(Boolean)
          .join("\n");

      }
    );

  return [
    "📅 *Calendario*",
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ].join("\n");

}


// ========================================
// VER CALENDARIO
// ========================================

async function ejecutarCalendarioVer(
  interpretacion
) {

  console.log("CALENDARIO INTERPRETACION:", JSON.stringify(interpretacion));

  const resultado =
    await calendarioListar(
      interpretacion?.timeMin ||
        interpretacion?.desde ||
        "",
      interpretacion?.timeMax ||
        interpretacion?.hasta ||
        "",
      interpretacion?.maxResults ||
        20
    );

    return formatearEventosCalendario(
    resultado?.resultado || resultado
  );

}


// ========================================
// BUSCAR EVENTO
// ========================================

async function ejecutarCalendarioBuscar(
  interpretacion
) {

  const buscar =
    String(
      interpretacion?.buscar ||
      interpretacion?.texto ||
      interpretacion?.evento ||
      ""
    ).trim();

  if (!buscar) {

    return (
      "¿Qué evento quieres buscar?"
    );

  }

  const resultado =
    await calendarioBuscar(
      buscar,
      interpretacion?.timeMin ||
        interpretacion?.desde ||
        "",
      interpretacion?.timeMax ||
        interpretacion?.hasta ||
        "",
      interpretacion?.maxResults ||
        20
    );

  return formatearEventosCalendario(
    resultado
  );

}


// ========================================
// CREAR EVENTO
// ========================================

async function iniciarCrearEvento(
  interpretacion,
  remitente
) {

  const data = {
    ...(interpretacion?.data ||
      {})
  };

  const faltantes = [];

  if (
    estaVacio(
      data.titulo
    ) &&
    estaVacio(
      data.title
    ) &&
    estaVacio(
      data.Titulo
    )
  ) {

    faltantes.push(
      "Título del evento"
    );

  }

  if (
    estaVacio(
      data.fecha
    ) &&
    estaVacio(
      data.start
    )
  ) {

    faltantes.push(
      "Fecha"
    );

  }

  if (
    faltantes.length > 0
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "calendario_datos_faltantes",

        data,

        faltantes
      }
    );

    return [
      "📅 Para crear el evento me falta:",
      "",
      ...faltantes.map(
        campo =>
          `• ${campo}`
      )
    ].join("\n");

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "calendario_crear_confirmacion",

      data
    }
  );

  return [
    "📅 *Confirmar evento*",
    SEPARADOR,
    resumenEvento(
      data
    ),
    "",
    "¿Quieres crear este evento?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONFIRMAR CREACIÓN
// ========================================

async function procesarCrearEventoConfirmacion(
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
      "❌ No creé el evento."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para crear el evento o *no* para cancelar."
    );

  }

  const resultado =
    await calendarioCrear(
      sesion.data
    );

  sesiones.delete(
    remitente
  );

  return [
    "✅ *Evento creado*",
    "",
    resumenEvento(
      sesion.data
    ),
    resultado.id
      ? `ID: ${resultado.id}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// ELIMINAR EVENTO
// ========================================

async function iniciarEliminarEvento(
  interpretacion,
  remitente
) {

  const eventId =
    String(
      interpretacion?.eventId ||
      interpretacion?.id ||
      ""
    ).trim();

  if (
    eventId
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "calendario_eliminar_confirmacion",

        eventId,

        evento:
          interpretacion?.data ||
          {}
      }
    );

    return [
      "🗑️ *Eliminar evento*",
      SEPARADOR,
      resumenEvento(
        interpretacion?.data ||
        {}
      ),
      "",
      "¿Confirmas que quieres eliminarlo?",
      "✅ Sí",
      "❌ No"
    ]
      .filter(Boolean)
      .join("\n");

  }

  const buscar =
    String(
      interpretacion?.buscar ||
      interpretacion?.evento ||
      ""
    ).trim();

  if (!buscar) {

    return (
      "¿Qué evento quieres eliminar? Indícame el nombre o una parte del título."
    );

  }

  const resultado =
    await calendarioBuscar(
      buscar,
      interpretacion?.timeMin ||
        interpretacion?.desde ||
        "",
      interpretacion?.timeMax ||
        interpretacion?.hasta ||
        "",
      20
    );

  const eventos =
    resultado?.eventos ||
    resultado?.events ||
    [];

  if (
    !Array.isArray(eventos) ||
    eventos.length === 0
  ) {

    return [
      "🔎 No encontré ese evento.",
      "",
      `Búsqueda: ${buscar}`
    ].join("\n");

  }

  if (
    eventos.length > 1
  ) {

    guardarSesion(
      remitente,
      {
        tipo:
          "calendario_eliminar_seleccion",

        eventos
      }
    );

    const lista =
      eventos.map(
        (evento, indice) => {

          const titulo =
            evento.titulo ||
            evento.title ||
            evento.Titulo ||
            "Evento";

          const inicio =
            evento.inicio ||
            evento.start ||
            evento.fecha ||
            "";

          return `${indice + 1}. *${titulo}*${
            inicio
              ? ` — ${inicio}`
              : ""
          }`;

        }
      );

    return [
      "🗑️ *Encontré varios eventos*",
      "",
      lista.join("\n"),
      "",
      "¿Cuál quieres eliminar?",
      "Responde con el número."
    ].join("\n");

  }

  const evento =
    eventos[0];

  const id =
    evento.eventId ||
    evento.id ||
    evento.ID;

  if (!id) {

    return (
      "Encontré el evento, pero no recibí su ID. No eliminé nada."
    );

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "calendario_eliminar_confirmacion",

      eventId:
        id,

      evento
    }
  );

  return [
    "🗑️ *Eliminar evento*",
    SEPARADOR,
    resumenEvento(
      evento
    ),
    "",
    "¿Confirmas que quieres eliminarlo?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// SELECCIONAR EVENTO
// ========================================

async function procesarCalendarioEliminarSeleccion(
  textoUsuario,
  remitente,
  sesion
) {

  const match =
    String(
      textoUsuario
    ).match(
      /\d+/
    );

  if (!match) {

    return `Responde con un número del 1 al ${sesion.eventos.length}.`;

  }

  const numero =
    Number(
      match[0]
    );

  if (
    numero < 1 ||
    numero >
      sesion.eventos.length
  ) {

    return `Elige un número del 1 al ${sesion.eventos.length}.`;

  }

  const evento =
    sesion.eventos[
      numero - 1
    ];

  const id =
    evento.eventId ||
    evento.id ||
    evento.ID;

  if (!id) {

    return (
      "No pude identificar el ID de ese evento. No eliminé nada."
    );

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "calendario_eliminar_confirmacion",

      eventId:
        id,

      evento
    }
  );

  return [
    "🗑️ *Eliminar evento*",
    SEPARADOR,
    resumenEvento(
      evento
    ),
    "",
    "¿Confirmas que quieres eliminarlo?",
    "✅ Sí",
    "❌ No"
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// CONFIRMAR ELIMINACIÓN DE EVENTO
// ========================================

async function procesarEliminarEventoConfirmacion(
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
      "❌ No eliminé el evento."
    );

  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return (
      "Responde *sí* para eliminar el evento o *no* para cancelar."
    );

  }

  await calendarioEliminarEvento(
    sesion.eventId
  );

  sesiones.delete(
    remitente
  );

  return (
    "✅ *Evento eliminado del calendario.*"
  );

}
// ========================================
// ANÁLISIS FINANCIERO
// ========================================

function formatearAnalisisFinanzas(
  resultado
) {

  if (
    !resultado ||
    resultado.error
  ) {

    return (
      "📊 No encontré información suficiente para responder esa pregunta."
    );

  }

  const respuesta =
    resultado.respuesta ||
    resultado.answer ||
    resultado.mensaje;

  if (
    respuesta
  ) {

    return String(
      respuesta
    );

  }

  const pregunta =
    resultado.pregunta ||
    "";

  const datos =
    resultado.datos ||
    resultado.resultados ||
    resultado.registros ||
    [];

  if (
    !Array.isArray(
      datos
    ) ||
    datos.length === 0
  ) {

    return [
      "📊 *Análisis financiero*",
      "",
      "No encontré datos suficientes para responder.",
      pregunta
        ? `\nPregunta: ${pregunta}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");

  }

  const lineas =
    datos.map(
      (item, indice) => {

        if (
          typeof item ===
          "string"
        ) {

          return `${indice + 1}. ${item}`;

        }

        const campos =
          Object.entries(
            item
          )
            .map(
              ([campo, valor]) => {

                if (
                  valor ===
                    undefined ||
                  valor ===
                    null ||
                  valor ===
                    ""
                ) {

                  return "";

                }

                const numero =
                  Number(
                    String(
                      valor
                    )
                      .replace(
                        /[$,\s]/g,
                        ""
                      )
                  );

                if (
                  Number.isFinite(
                    numero
                  ) &&
                  (
                    normalizar(
                      campo
                    ).includes(
                      "monto"
                    ) ||
                    normalizar(
                      campo
                    ).includes(
                      "total"
                    ) ||
                    normalizar(
                      campo
                    ).includes(
                      "precio"
                    ) ||
                    normalizar(
                      campo
                    ).includes(
                      "gasto"
                    ) ||
                    normalizar(
                      campo
                    ).includes(
                      "saldo"
                    )
                  )
                ) {

                  return `${campo}: ${formatearDinero(
                    numero
                  )}`;

                }

                return `${campo}: ${valor}`;

              }
            )
            .filter(Boolean);

        return [
          `*${indice + 1}.*`,
          ...campos
        ].join("\n");

      }
    );

  return [
    "📊 *Análisis financiero*",
    pregunta
      ? `\nPregunta: ${pregunta}`
      : "",
    "",
    lineas.join(
      `\n\n${SEPARADOR}\n\n`
    )
  ]
    .filter(Boolean)
    .join("\n");

}


// ========================================
// EJECUTAR ANÁLISIS
// ========================================

async function ejecutarAnalisisFinanzas(
  interpretacion
) {

  const pregunta =
    String(
      interpretacion?.pregunta ||
      interpretacion?.consulta ||
      interpretacion?.texto ||
      ""
    ).trim();

  if (
    !pregunta
  ) {

    return (
      "¿Qué quieres analizar?"
    );

  }

  const resultado =
    await analizarFinanzas(
      pregunta
    );

  return formatearAnalisisFinanzas(
    resultado
  );

}


// ========================================
// ANÁLISIS DE INGRESOS
// ========================================

async function ejecutarAnalisisIngresos(
  interpretacion
) {

  const pregunta =
    String(
      interpretacion?.pregunta ||
      ""
    ).trim();

  const resultado =
    await analizarFinanzas(
      pregunta ||
      "Analiza los ingresos registrados y encuentra los meses, tipos de ingreso y montos más relevantes."
    );

  return formatearAnalisisFinanzas(
    resultado
  );

}


// ========================================
// ANÁLISIS DE PAGOS
// ========================================

async function ejecutarAnalisisPagos(
  interpretacion
) {

  const pregunta =
    String(
      interpretacion?.pregunta ||
      ""
    ).trim();

  const resultado =
    await analizarFinanzas(
      pregunta ||
      "Analiza los pagos registrados y encuentra los meses, conceptos y montos más relevantes."
    );

  return formatearAnalisisFinanzas(
    resultado
  );

}


// ========================================
// ANÁLISIS DEL SÚPER
// ========================================

async function ejecutarAnalisisSuper(
  interpretacion
) {

  const pregunta =
    String(
      interpretacion?.pregunta ||
      ""
    ).trim();

  const resultado =
    await analizarFinanzas(
      pregunta ||
      "Analiza los gastos del súper registrados y encuentra tendencias, precios y tiendas relevantes."
    );

  return formatearAnalisisFinanzas(
    resultado
  );

}
// ========================================
// PROCESAMIENTO DE SESIONES
// ========================================

async function procesarSesionPendiente(
  textoUsuario,
  remitente,
  sesion
) {

  switch (
    sesion.tipo
  ) {

    // ==================================
    // SUPER — AGREGAR
    // ==================================

    case "super_lista_confirmacion":

      return procesarSuperListaConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "super_lista_duplicado_confirmacion":

      return procesarSuperListaDuplicado(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // SUPER — COMPRAR
    // ==================================

    case "super_compra_confirmacion":

      return procesarCompraSuperConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "super_compra_seleccion":

      return procesarSuperCompraSeleccion(
        textoUsuario,
        remitente,
        sesion
      );


    case "super_compra_nuevo_confirmacion":

      return procesarCompraSuperNueva(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // SUPER — ELIMINAR
    // ==================================

    case "super_eliminar_confirmacion":

      return procesarEliminarListaSuperConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "super_eliminar_seleccion":

      return procesarEliminarListaSuperSeleccion(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // REGISTRO — INGRESOS / PAGOS
    // ==================================

    case "registro_confirmacion":

      return procesarRegistroConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "registro_duplicado_confirmacion":

      return procesarRegistroDuplicado(
        textoUsuario,
        remitente,
        sesion
      );


    case "registro_datos_faltantes":

      return procesarDatosFaltantesRegistro(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // ELIMINAR INGRESOS / PAGOS
    // ==================================

    case "eliminar_confirmacion":

      return procesarEliminarConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "eliminar_seleccion":

      return procesarEliminarSeleccion(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // AHORRO
    // ==================================

    case "ahorro_confirmacion":

      return procesarAhorroConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "ahorro_datos_faltantes":

      return procesarDatosFaltantesAhorro(
        textoUsuario,
        remitente,
        sesion
      );


    case "config_ahorro_confirmacion":

      return procesarConfigAhorroConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // METAS
    // ==================================

    case "meta_confirmacion":

      return procesarMetaConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "meta_datos_faltantes":

      return procesarDatosFaltantesMeta(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // CALENDARIO
    // ==================================

    case "calendario_crear_confirmacion":

      return procesarCrearEventoConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "calendario_eliminar_confirmacion":

      return procesarEliminarEventoConfirmacion(
        textoUsuario,
        remitente,
        sesion
      );


    case "calendario_eliminar_seleccion":

      return procesarCalendarioEliminarSeleccion(
        textoUsuario,
        remitente,
        sesion
      );


    // ==================================
    // CASO DESCONOCIDO
    // ==================================

    default:

      sesiones.delete(
        remitente
      );

      return null;

  }

}


// ========================================
// CANCELAR SESIÓN
// ========================================

function cancelarSesion(
  remitente
) {

  if (
    sesiones.has(
      remitente
    )
  ) {

    sesiones.delete(
      remitente
    );

    return true;

  }

  return false;

}
// ========================================
// ROUTER PRINCIPAL
// ========================================

async function ejecutarInterpretacion(
  interpretacion,
  remitente,
  textoOriginal
) {

  const accion =
    normalizar(
      interpretacion?.action ||
      interpretacion?.accion ||
      ""
    );

  switch (accion) {

    // ==================================
    // REGISTRAR
    // ==================================

    case "registrar":

      return iniciarRegistro(
        interpretacion,
        remitente,
        textoOriginal
      );


    // ==================================
    // ELIMINAR
    // ==================================

    case "eliminar":

      return iniciarEliminarRegistro(
        interpretacion,
        remitente
      );


    // ==================================
    // REPORTE
    // ==================================

    case "reporte":

      return ejecutarReporte(
        interpretacion
      );


    // ==================================
    // HISTORIAL PRODUCTO
    // ==================================

    case "historial_producto":

      return ejecutarHistorialProducto(
        interpretacion
      );


    // ==================================
    // SUPER — AGREGAR LISTA
    // ==================================

    case "super_agregar_lista":

      return iniciarAgregarListaSuper(
        interpretacion,
        remitente
      );


    // ==================================
    // SUPER — VER LISTA
    // ==================================

    case "super_ver_lista":

      return consultarListaSuper();


    // ==================================
    // SUPER — ELIMINAR LISTA
    // ==================================

    case "super_eliminar_lista":

      return iniciarEliminarListaSuper(
        interpretacion,
        remitente
      );


    // ==================================
    // SUPER — COMPRAR
    // ==================================

    case "super_comprar":

      return iniciarCompraSuper(
        interpretacion,
        remitente,
        textoOriginal
      );


    // ==================================
    // SUPER — HISTORIAL
    // ==================================

    case "super_historial":

      return consultarHistorialSuper(
        interpretacion?.producto,
        interpretacion?.meses ||
        interpretacion?.periodo
      );


    // ==================================
    // SUPER — RESUMEN
    // ==================================

    case "super_resumen_producto":

      return consultarResumenSuper(
        interpretacion?.producto
      );


    // ==================================
    // SUPER — COMPARAR
    // ==================================

    case "super_comparar_producto":

      return compararSuper(
        interpretacion?.producto
      );


    // ==================================
    // ANÁLISIS FINANCIERO
    // ==================================

    case "analisis_finanzas":

      return ejecutarAnalisisFinanzas(
        interpretacion
      );


    // ==================================
    // CONFIGURAR AHORRO
    // ==================================

    case "configurar_ahorro":

      return iniciarConfigurarAhorro(
        interpretacion,
        remitente
      );


    // ==================================
    // REGISTRAR AHORRO
    // ==================================

    case "registrar_ahorro":

      return iniciarRegistroAhorro(
        interpretacion,
        remitente
      );


    // ==================================
    // META
    // ==================================

    case "meta_ahorro":

      return iniciarMetaAhorro(
        interpretacion,
        remitente
      );


    // ==================================
    // METAS — RESUMEN
    // ==================================

    case "metas_resumen":

      return ejecutarMetasResumen();


    // ==================================
    // CALENDARIO — VER
    // ==================================

    case "calendario_ver":

      return ejecutarCalendarioVer(
        interpretacion
      );


    // ==================================
    // CALENDARIO — BUSCAR
    // ==================================

    case "calendario_buscar":

      return ejecutarCalendarioBuscar(
        interpretacion
      );


    // ==================================
    // CALENDARIO — CREAR
    // ==================================

    case "calendario_crear":

      return iniciarCrearEvento(
        interpretacion,
        remitente
      );


    // ==================================
    // CALENDARIO — ELIMINAR
    // ==================================

    case "calendario_eliminar":

      return iniciarEliminarEvento(
        interpretacion,
        remitente
      );


    // ==================================
    // CANCELAR
    // ==================================

    case "cancelar":

      cancelarSesion(
        remitente
      );

      return (
        "❌ Operación cancelada."
      );


    // ==================================
    // CONVERSACIÓN
    // ==================================

    case "conversar":

      return (
        interpretacion.respuesta ||
        interpretacion.mensaje ||
        "Claro. ¿En qué te puedo ayudar?"
      );


    // ==================================
    // ACCIÓN DESCONOCIDA
    // ==================================

    default:

      return [
        "No estoy seguro de qué acción quieres realizar.",
        "",
        "Puedes decirme, por ejemplo:",
        "• registra mi sueldo de $25,000",
        "• agrega papel de baño a la lista",
        "• pásame mi lista del súper",
        "• ¿en qué mes gasté más?",
        "• ¿qué tengo en mi calendario?"
      ].join("\n");

  }

}
// ========================================
// ADAPTADOR — HISTORIAL DEL SÚPER
// ========================================

async function consultarHistorialSuper(
  producto,
  meses
) {

  if (
    estaVacio(producto)
  ) {

    return (
      "¿De qué producto quieres consultar el historial?"
    );

  }

  const resultado =
    await superHistorial(
      producto,
      meses
    );

  return formatearHistorial(
    resultado
  );

}


// ========================================
// PROCESAR MENSAJE DEL USUARIO
// ========================================

async function procesarMensaje(
  remitente,
  textoUsuario,
  messageId
) {

  const texto =
    String(
      textoUsuario || ""
    ).trim();

  if (
    !texto
  ) {

    return;

  }


  // ==================================
  // EVITAR MENSAJES DUPLICADOS
  // ==================================

  if (
    messageId &&
    mensajesProcesados.has(
      messageId
    )
  ) {

    return;

  }

  if (
    messageId
  ) {

    mensajesProcesados.set(
      messageId,
      Date.now()
    );

  }

  limpiarMensajesProcesados();


  // ==================================
  // CANCELACIÓN DIRECTA
  // ==================================

  if (
    respuestaNo(texto) &&
    obtenerSesion(remitente)
  ) {

    cancelarSesion(
      remitente
    );

    await enviarMensajeWhatsApp(
      remitente,
      "❌ Operación cancelada."
    );

    return;

  }


  // ==================================
  // SALUDO
  // ==================================

  if (
    esSaludoSimple(texto) &&
    !obtenerSesion(remitente)
  ) {

    await enviarMensajeWhatsApp(
      remitente,
      [
        "Hola 👋",
        "",
        "Soy tu asistente de finanzas y calendario.",
        "",
        "Puedes decirme qué necesitas o escribir *ayuda* para ver las opciones."
      ].join("\n")
    );

    return;

  }


  // ==================================
  // AYUDA
  // ==================================

  if (
    esAyuda(texto) &&
    !obtenerSesion(remitente)
  ) {

    await enviarMensajeWhatsApp(
      remitente,
      respuestaAyuda()
    );

    return;

  }


  // ==================================
  // SESIÓN PENDIENTE
  // ==================================

  const sesion =
    obtenerSesion(
      remitente
    );

  if (
    sesion
  ) {

    const respuesta =
      await procesarSesionPendiente(
        texto,
        remitente,
        sesion
      );

    if (
      respuesta
    ) {

      await enviarMensajeWhatsApp(
        remitente,
        respuesta
      );

    }

    return;

  }


  // ==================================
  // GEMINI
  // ==================================

  let interpretacion;

  try {

    interpretacion =
      await interpretarConGemini(
        texto
      );
console.log(
  "INTERPRETACION GEMINI:",
  JSON.stringify(
    interpretacion,
    null,
    2
  )
);
  } catch (
    error
  ) {

    console.error(
      "Error interpretando mensaje:",
      error
    );

    await enviarMensajeWhatsApp(
      remitente,
      "⚠️ No pude interpretar tu mensaje en este momento. Intenta nuevamente."
    );

    return;

  }


  // ==================================
  // EJECUTAR ACCIÓN
  // ==================================

  try {

    const respuesta =
      await ejecutarInterpretacion(
        interpretacion,
        remitente,
        texto
      );

    if (
      respuesta
    ) {

      await enviarMensajeWhatsApp(
        remitente,
        respuesta
      );

    }

  } catch (
    error
  ) {

    console.error(
      "Error ejecutando acción:",
      error
    );

    console.error(
      "Detalles:",
      error.details ||
      ""
    );

    sesiones.delete(
      remitente
    );

    await enviarMensajeWhatsApp(
      remitente,
      [
        "⚠️ Ocurrió un problema al procesar la operación.",
        "",
        "No hice ningún cambio si la operación todavía no había sido confirmada.",
        "",
        "Intenta nuevamente."
      ].join("\n")
    );

  }

}
// ========================================
// WHATSAPP — MEDIA
// ========================================

async function obtenerMediaWhatsApp(
  mediaId
) {

  if (
    !mediaId
  ) {
    throw new Error(
      "Falta el ID del archivo multimedia."
    );
  }

  if (
    !WHATSAPP_TOKEN
  ) {
    throw new Error(
      "Falta WHATSAPP_TOKEN."
    );
  }


  // ==================================
  // OBTENER INFORMACIÓN DEL ARCHIVO
  // ==================================

  const respuestaInfo =
    await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
      {
        method:
          "GET",
        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

  const info =
    await respuestaInfo
      .json()
      .catch(
        () => ({})
      );

  if (
    !respuestaInfo.ok
  ) {

    const error =
      new Error(
        "No se pudo obtener la información del archivo de WhatsApp."
      );

    error.status =
      respuestaInfo.status;

    error.details =
      info;

    throw error;

  }


  if (
    !info.url
  ) {

    throw new Error(
      "WhatsApp no devolvió una URL para el archivo."
    );

  }


  // ==================================
  // DESCARGAR ARCHIVO
  // ==================================

  const respuestaArchivo =
    await fetch(
      info.url,
      {
        method:
          "GET",
        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

  if (
    !respuestaArchivo.ok
  ) {

    const detalles =
      await respuestaArchivo
        .text()
        .catch(
          () => ""
        );

    const error =
      new Error(
        "No se pudo descargar el archivo de WhatsApp."
      );

    error.status =
      respuestaArchivo.status;

    error.details =
      detalles;

    throw error;

  }


  const buffer =
    Buffer.from(
      await respuestaArchivo.arrayBuffer()
    );


  return {
    mediaId,
    mimeType:
      info.mime_type ||
      "",
    sha256:
      info.sha256 ||
      "",
    fileSize:
      info.file_size ||
      buffer.length,
    buffer
  };

}


// ========================================
// IDENTIFICAR TIPO DE MEDIA
// ========================================

function obtenerTipoMedia(
  mensaje
) {

  if (
    mensaje?.image
  ) {

    return {
      tipo:
        "image",
      mediaId:
        mensaje.image.id,
      mimeType:
        mensaje.image.mime_type ||
        "image/jpeg",
      caption:
        mensaje.image.caption ||
        ""
    };

  }


  if (
    mensaje?.document
  ) {

    return {
      tipo:
        "document",
      mediaId:
        mensaje.document.id,
      mimeType:
        mensaje.document.mime_type ||
        "",
      nombre:
        mensaje.document.filename ||
        "",
      caption:
        mensaje.document.caption ||
        ""
    };

  }


  if (
    mensaje?.audio
  ) {

    return {
      tipo:
        "audio",
      mediaId:
        mensaje.audio.id,
      mimeType:
        mensaje.audio.mime_type ||
        "",
      voice:
        mensaje.audio.voice ||
        false
    };

  }


  return null;

}


// ========================================
// MENSAJE DE MEDIA
// ========================================

async function procesarMediaWhatsApp(
  remitente,
  mensaje,
  messageId
) {

  const media =
    obtenerTipoMedia(
      mensaje
    );

  if (
    !media
  ) {

    return false;

  }


  // ==================================
  // IMAGEN
  // ==================================

  if (
    media.tipo ===
    "image"
  ) {

    try {

      const archivo =
        await obtenerMediaWhatsApp(
          media.mediaId
        );

      await enviarMensajeWhatsApp(
        remitente,
        [
          "📷 Recibí tu imagen.",
          "",
          "Estoy preparando la lectura del ticket.",
          "",
          "Todavía no voy a registrar ninguna compra hasta mostrarte los datos y pedirte confirmación."
        ].join("\n")
      );


      guardarSesion(
        remitente,
        {
          tipo:
            "media_recibida",
          mediaTipo:
            "image",
          mediaId:
            archivo.mediaId,
          mimeType:
            archivo.mimeType,
          buffer:
            archivo.buffer,
          messageId:
            messageId || ""
        }
      );


      return true;

    } catch (
      error
    ) {

      console.error(
        "Error procesando imagen:",
        error
      );

      await enviarMensajeWhatsApp(
        remitente,
        "⚠️ Recibí la imagen, pero no pude descargarla correctamente."
      );

      return true;

    }

  }


  // ==================================
  // AUDIO
  // ==================================

  if (
    media.tipo ===
    "audio"
  ) {

    await enviarMensajeWhatsApp(
      remitente,
      "🎤 Recibí tu audio. La transcripción de voz se conectará en la siguiente etapa."
    );

    return true;

  }


  // ==================================
  // DOCUMENTO
  // ==================================

  if (
    media.tipo ===
    "document"
  ) {

    await enviarMensajeWhatsApp(
      remitente,
      [
        "📎 Recibí el archivo.",
        "",
        `Nombre: ${media.nombre || "archivo"}`,
        "",
        "Por ahora el procesamiento de tickets se realizará mediante imagen."
      ].join("\n")
    );

    return true;

  }


  return false;

}
// ========================================
// GEMINI VISION — TICKET
// ========================================

function instruccionesTicket() {

  return `
Eres un sistema de lectura de tickets de supermercado.

Analiza la imagen del ticket y devuelve EXCLUSIVAMENTE
un objeto JSON válido.

NO inventes información.

Si un dato no puede leerse claramente, utiliza null.

OBJETIVO:

Extraer cada producto comprado que aparezca en el ticket.

Para cada producto intenta obtener:

- Producto
- Producto base
- Categoría
- Monto
- Cantidad
- Unidad
- Contenido por empaque
- Unidad de comparación
- Precio por unidad

REGLAS:

1. Producto debe contener el nombre tal como aparece en el ticket,
   pero limpiando códigos internos innecesarios.

2. Producto base debe ser una versión normalizada del producto.
   Por ejemplo:
   "PAPEL HIG. KLEENEX 12 ROLLOS"
   puede convertirse en
   "Papel higiénico Kleenex".

3. No inventes marca, presentación o cantidad si no aparecen.

4. Monto debe ser el precio total de esa línea.

5. Si existe una cantidad explícita, colócala en Cantidad.

6. Si existe una unidad como pieza, paquete, kg, litro, etc.,
   colócala en Unidad.

7. Si aparece una presentación como 12 rollos, 500 g, 1 L, etc.,
   intenta colocar el valor numérico en Contenido por empaque
   y la unidad correspondiente en Unidad de comparación.

8. Precio por unidad debe calcularse únicamente cuando los datos
   disponibles permitan calcularlo con seguridad.

9. No confundas descuentos, subtotales, impuestos o totales
   con productos.

10. No incluyas:
    - subtotal
    - IVA
    - impuestos
    - total de la compra
    - cambio
    - efectivo recibido

11. Si el ticket contiene varias líneas del mismo producto,
    conserva las líneas separadas si tienen precios diferentes.

12. Si la imagen no parece ser un ticket de compra,
    devuelve productos como arreglo vacío.

FORMATO OBLIGATORIO:

{
  "tipo": "ticket",
  "fecha": null,
  "tienda": null,
  "moneda": "MXN",
  "productos": [
    {
      "Producto": "",
      "Producto base": "",
      "Categoría": "",
      "Monto": null,
      "Cantidad": null,
      "Unidad": "",
      "Contenido por empaque": null,
      "Unidad de comparación": "",
      "Precio por unidad": null,
      "Notas": ""
    }
  ],
  "total_ticket": null
}

IMPORTANTE:

total_ticket es únicamente informativo.

NO debe utilizarse para crear una compra.

Cada producto debe conservar su propio Monto.
`;
}


// ========================================
// ENVIAR IMAGEN A GEMINI
// ========================================

async function analizarTicketConGemini(
  archivo
) {

  if (
    !GEMINI_API_KEY
  ) {

    throw new Error(
      "Falta GEMINI_API_KEY."
    );

  }

  if (
    !archivo ||
    !archivo.buffer
  ) {

    throw new Error(
      "No hay imagen disponible para analizar."
    );

  }


  const base64 =
    archivo.buffer.toString(
      "base64"
    );

  const mimeType =
    archivo.mimeType ||
    "image/jpeg";


  const prompt = [
    instruccionesTicket(),
    "",
    "Analiza ahora la imagen adjunta.",
    "Devuelve únicamente el JSON."
  ].join("\n");


  const respuesta =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            contents: [
              {
                role:
                  "user",

                parts: [
                  {
                    text:
                      prompt
                  },
                  {
                    inlineData: {
                      mimeType,
                      data:
                        base64
                    }
                  }
                ]
              }
            ],

            generationConfig: {
              temperature:
                0.1,

              responseMimeType:
                "application/json"
            }
          })
      }
    );


  const datos =
    await respuesta
      .json()
      .catch(
        () => ({})
      );


  if (
    !respuesta.ok
  ) {

    const error =
      new Error(
        "Gemini no pudo analizar el ticket."
      );

    error.status =
      respuesta.status;

    error.details =
      datos;

    throw error;

  }


  const texto =
    datos
      ?.candidates?.[0]
      ?.content?.parts?.[0]
      ?.text;


  if (
    !texto
  ) {

    throw new Error(
      "Gemini no devolvió información del ticket."
    );

  }


  return extraerJSON(
    texto
  );

}


// ========================================
// NORMALIZAR PRODUCTOS DEL TICKET
// ========================================

function normalizarProductoTicket(
  producto
) {

  const resultado = {
    Producto:
      producto?.Producto ||
      "",
    "Producto base":
      producto?.["Producto base"] ||
      producto?.Producto ||
      "",
    Categoría:
      producto?.Categoría ||
      "",
    Monto:
      producto?.Monto ??
      "",
    Cantidad:
      producto?.Cantidad ??
      "",
    Unidad:
      producto?.Unidad ||
      "",
    "Contenido por empaque":
      producto?.["Contenido por empaque"] ??
      "",
    "Unidad de comparación":
      producto?.["Unidad de comparación"] ||
      "",
    "Precio por unidad":
      producto?.["Precio por unidad"] ??
      "",
    Notas:
      producto?.Notas ||
      ""
  };

  return completarDatosCalculados(
    "Super",
    resultado
  );

}
// ========================================
// TICKET — COMPARAR CON LISTA PENDIENTE
// ========================================

function similitudProductos(
  productoA,
  productoB
) {

  const a =
    normalizar(
      productoA
    );

  const b =
    normalizar(
      productoB
    );

  if (
    !a ||
    !b
  ) {
    return 0;
  }

  if (
    a === b
  ) {
    return 1;
  }

  if (
    a.includes(b) ||
    b.includes(a)
  ) {
    return 0.9;
  }

  const palabrasA =
    a
      .split(/\s+/)
      .filter(
        palabra =>
          palabra.length > 2
      );

  const palabrasB =
    b
      .split(/\s+/)
      .filter(
        palabra =>
          palabra.length > 2
      );

  if (
    !palabrasA.length ||
    !palabrasB.length
  ) {
    return 0;
  }

  let coincidencias = 0;

  for (
    const palabra
    of palabrasA
  ) {

    if (
      palabrasB.includes(
        palabra
      )
    ) {

      coincidencias++;

    }

  }

  const porcentaje =
    coincidencias /
    Math.max(
      palabrasA.length,
      palabrasB.length
    );

  return porcentaje;
}


// ========================================
// BUSCAR COINCIDENCIA PARA PRODUCTO
// ========================================

function encontrarCoincidenciasTicket(
  productoTicket,
  pendientes
) {

  const nombreTicket =
    productoTicket?.["Producto base"] ||
    productoTicket?.Producto ||
    "";

  const resultados =
    pendientes
      .map(
        pendiente => {

          const nombrePendiente =
            pendiente?.data?.["Producto base"] ||
            pendiente?.data?.Producto ||
            "";

          const nivel =
            similitudProductos(
              nombreTicket,
              nombrePendiente
            );

          return {
            pendiente,
            nivel
          };

        }
      )
      .filter(
        resultado =>
          resultado.nivel >=
          0.5
      )
      .sort(
        (
          a,
          b
        ) =>
          b.nivel -
          a.nivel
      );

  return resultados;

}


// ========================================
// CLASIFICAR TICKET
// ========================================

async function clasificarTicket(
  ticket
) {

  const respuesta =
    await superVerLista();

  const pendientes =
    Array.isArray(
      respuesta?.pendientes
    )
      ? respuesta.pendientes
      : Array.isArray(
          respuesta?.lista
        )
        ? respuesta.lista
        : [];

  const productos =
    Array.isArray(
      ticket?.productos
    )
      ? ticket.productos
      : [];

  const enLista = [];
  const fueraDeLista = [];

  for (
    const producto
    of productos
  ) {

    const normalizado =
      normalizarProductoTicket(
        producto
      );

    const coincidencias =
      encontrarCoincidenciasTicket(
        normalizado,
        pendientes
      );

    if (
      coincidencias.length
    ) {

      const mejor =
        coincidencias[0];

      enLista.push({
        ticket:
          normalizado,
        coincidencia:
          mejor.pendiente,
        nivel:
          mejor.nivel,
        alternativas:
          coincidencias
            .slice(
              1,
              4
            )
      });

    } else {

      fueraDeLista.push(
        normalizado
      );

    }

  }

  return {
    tienda:
      ticket?.tienda ||
      ticket?.Tienda ||
      "",

    fecha:
      ticket?.fecha ||
      ticket?.["Fecha de compra"] ||
      "",

    total_ticket:
      ticket?.total_ticket ??
      "",

    enLista,

    fueraDeLista
  };

}


// ========================================
// FORMATEAR PROPUESTA DEL TICKET
// ========================================

function formatearPropuestaTicket(
  clasificacion
) {

  const lineas = [];

  lineas.push(
    "🧾 *Leí tu ticket.*"
  );

  if (
    clasificacion.tienda
  ) {

    lineas.push(
      `Tienda: ${clasificacion.tienda}`
    );

  }

  if (
    clasificacion.fecha
  ) {

    lineas.push(
      `Fecha: ${clasificacion.fecha}`
    );

  }

  lineas.push("");

  // ==================================
  // PRODUCTOS DE LA LISTA
  // ==================================

  if (
    clasificacion.enLista.length
  ) {

    lineas.push(
      "✅ *Productos que estaban en tu lista:*"
    );

    clasificacion.enLista.forEach(
      (
        item,
        indice
      ) => {

        const producto =
          item.ticket;

        const pendiente =
          item.coincidencia?.data ||
          {};

        lineas.push(
          [
            `${indice + 1}. ${producto.Producto || "Producto"}`,
            producto.Monto !== ""
              ? `   ${formatearDinero(producto.Monto)}`
              : "",
            pendiente.Producto &&
            normalizar(
              pendiente.Producto
            ) !==
            normalizar(
              producto.Producto
            )
              ? `   Coincide con: ${pendiente.Producto}`
              : ""
          ]
            .filter(Boolean)
            .join("\n")
        );

      }
    );

    lineas.push("");

  }


  // ==================================
  // PRODUCTOS FUERA DE LA LISTA
  // ==================================

  if (
    clasificacion.fueraDeLista.length
  ) {

    lineas.push(
      "🆕 *Productos que no estaban en tu lista:*"
    );

    clasificacion.fueraDeLista.forEach(
      (
        producto,
        indice
      ) => {

        lineas.push(
          [
            `${indice + 1}. ${producto.Producto || "Producto"}`,
            producto.Monto !== ""
              ? `   ${formatearDinero(producto.Monto)}`
              : ""
          ]
            .filter(Boolean)
            .join("\n")
        );

      }
    );

    lineas.push("");

  }


  if (
    !clasificacion.enLista.length &&
    !clasificacion.fueraDeLista.length
  ) {

    lineas.push(
      "No pude identificar productos en el ticket."
    );

    return lineas.join(
      "\n"
    );

  }


  lineas.push(
    "¿Quieres que registre estas compras?"
  );

  if (
    clasificacion.fueraDeLista.length
  ) {

    lineas.push(
      "",
      "Los productos que no estaban en tu lista *no se agregarán automáticamente*."
    );

    lineas.push(
      "Si también quieres registrarlos, dímelo y te mostraré una segunda confirmación."
    );

  }

  return lineas.join(
    "\n"
  );

}
// ========================================
// TICKET — CONFIRMACIÓN
// ========================================

async function iniciarProcesamientoTicket(
  remitente,
  ticket,
  messageId
) {

  const clasificacion =
    await clasificarTicket(
      ticket
    );

  if (
    !clasificacion.enLista.length &&
    !clasificacion.fueraDeLista.length
  ) {

    return (
      "🧾 No pude identificar productos en el ticket."
    );

  }

  guardarSesion(
    remitente,
    {
      tipo:
        "ticket_confirmacion",

      clasificacion,

      ticket,

      messageId:
        messageId || ""
    }
  );

  return formatearPropuestaTicket(
    clasificacion
  );

}


// ========================================
// EJECUTAR COMPRA DESDE TICKET
// ========================================

async function registrarProductosTicket(
  remitente,
  sesion
) {

  const clasificacion =
    sesion.clasificacion;

  const registrados = [];
  const errores = [];

  for (
    const item
    of clasificacion.enLista
  ) {

    try {

      const pendiente =
        item.coincidencia?.data;

      const idLista =
        pendiente?.ID;

      if (
        !idLista
      ) {

        errores.push(
          item.ticket?.Producto ||
          "Producto sin ID"
        );

        continue;

      }

      const resultado =
        await superRegistrarCompraVinculada(
          idLista,
          completarDatosCalculados(
            "Super",
            {
              ...item.ticket,
              Tienda:
                item.ticket.Tienda ||
                clasificacion.tienda ||
                "",
              "Fecha de compra":
                item.ticket[
                  "Fecha de compra"
                ] ||
                clasificacion.fecha ||
                fechaActualMexico()
            }
          )
        );

      registrados.push(
        resultado
      );

    } catch (
      error
    ) {

      console.error(
        "Error registrando producto del ticket:",
        error
      );

      errores.push(
        item.ticket?.Producto ||
        "Producto"
      );

    }

  }


  // ==================================
  // LIMPIAR SESIÓN
  // ==================================

  sesiones.delete(
    remitente
  );


  // ==================================
  // RESPUESTA
  // ==================================

  const lineas = [
    "✅ *Ticket procesado.*",
    ""
  ];


  if (
    registrados.length
  ) {

    lineas.push(
      `Compras registradas: ${registrados.length}`
    );

    registrados.forEach(
      resultado => {

        const producto =
          resultado?.compra?.data?.Producto ||
          resultado?.vinculacion?.productoCompra ||
          "Producto";

        const monto =
          resultado?.compra?.data?.Monto;

        lineas.push(
          monto !== undefined &&
          monto !== ""
            ? `• ${producto} — ${formatearDinero(monto)}`
            : `• ${producto}`
        );

      }
    );

  }


  if (
    clasificacion.fueraDeLista.length
  ) {

    lineas.push(
      "",
      "🆕 *Productos fuera de tu lista:*"
    );

    clasificacion.fueraDeLista.forEach(
      producto => {

        lineas.push(
          `• ${producto.Producto || "Producto"} — no registrado`
        );

      }
    );

    lineas.push(
      "",
      "No los agregué porque no estaban en tu lista."
    );

  }


  if (
    errores.length
  ) {

    lineas.push(
      "",
      "⚠️ No pude registrar:",
      ...errores.map(
        producto =>
          `• ${producto}`
      )
    );

  }


  return lineas.join(
    "\n"
  );

}


// ========================================
// PROCESAR CONFIRMACIÓN DEL TICKET
// ========================================

async function procesarTicketConfirmacion(
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
      "❌ No registré ninguna compra del ticket."
    );

  }


  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return [
      "Necesito que me confirmes.",
      "",
      "Responde *sí* para registrar las compras de tu lista o *no* para cancelar."
    ].join("\n");

  }


  return registrarProductosTicket(
    remitente,
    sesion
  );

}


// ========================================
// TICKET — PRODUCTOS FUERA DE LISTA
// ========================================

function resumenProductosFueraLista(
  productos
) {

  if (
    !Array.isArray(
      productos
    ) ||
    !productos.length
  ) {

    return "";

  }

  return [
    "🆕 *Productos que no estaban en tu lista:*",
    "",
    ...productos.map(
      (
        producto,
        indice
      ) =>
        [
          `${indice + 1}. ${producto.Producto || "Producto"}`,
          producto.Monto !== ""
            ? `   ${formatearDinero(producto.Monto)}`
            : ""
        ]
          .filter(Boolean)
          .join("\n")
    ),
    "",
    "¿Quieres registrar también estos productos?"
  ].join("\n");

}


// ========================================
// REGISTRAR PRODUCTOS FUERA DE LISTA
// ========================================

async function registrarProductosFueraLista(
  remitente,
  sesion
) {

  const productos =
    sesion.clasificacion
      ?.fueraDeLista ||
    [];

  if (
    !productos.length
  ) {

    sesiones.delete(
      remitente
    );

    return (
      "No hay productos nuevos para registrar."
    );

  }


  const registrados = [];
  const errores = [];


  for (
    const producto
    of productos
  ) {

    try {

      const data =
        completarDatosCalculados(
          "Super",
          {
            ...producto,

            Tienda:
              producto.Tienda ||
              sesion.clasificacion
                ?.tienda ||
              "",

            "Fecha de compra":
              producto[
                "Fecha de compra"
              ] ||
              sesion.clasificacion
                ?.fecha ||
              fechaActualMexico()
          }
        );


      const resultado =
        await superRegistrarCompra(
          data
        );


      registrados.push(
        resultado
      );

    } catch (
      error
    ) {

      console.error(
        "Error registrando producto nuevo:",
        error
      );

      errores.push(
        producto.Producto ||
        "Producto"
      );

    }

  }


  sesiones.delete(
    remitente
  );


  const lineas = [
    "✅ *Productos adicionales registrados.*",
    ""
  ];


  if (
    registrados.length
  ) {

    registrados.forEach(
      resultado => {

        const producto =
          resultado?.data?.Producto ||
          "Producto";

        const monto =
          resultado?.data?.Monto;

        lineas.push(
          monto !== undefined &&
          monto !== ""
            ? `• ${producto} — ${formatearDinero(monto)}`
            : `• ${producto}`
        );

      }
    );

  }


  if (
    errores.length
  ) {

    lineas.push(
      "",
      "⚠️ No pude registrar:",
      ...errores.map(
        producto =>
          `• ${producto}`
      )
    );

  }


  return lineas.join(
    "\n"
  );

}


// ========================================
// PROCESAR CONFIRMACIÓN DE NUEVOS
// ========================================

async function procesarTicketNuevosConfirmacion(
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
      "👍 De acuerdo. Los productos nuevos no fueron registrados."
    );

  }


  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return [
      "Necesito que me confirmes.",
      "",
      "Responde *sí* para registrarlos o *no* para dejarlos fuera."
    ].join("\n");

  }


  return registrarProductosFueraLista(
    remitente,
    sesion
  );

}
// ========================================
// PROCESAR IMAGEN COMO TICKET
// ========================================

async function procesarImagenComoTicket(
  remitente,
  archivo,
  messageId
) {

  try {

    // ==================================
    // LEER TICKET
    // ==================================

    const ticket =
      await analizarTicketConGemini(
        archivo
      );


    // ==================================
    // VALIDAR RESULTADO
    // ==================================

    if (
      !ticket ||
      !Array.isArray(
        ticket.productos
      ) ||
      !ticket.productos.length
    ) {

      await enviarMensajeWhatsApp(
        remitente,
        [
          "🧾 Recibí el ticket, pero no pude identificar productos.",
          "",
          "Si la foto está borrosa, intenta enviarla nuevamente con mejor iluminación."
        ].join("\n")
      );

      return;

    }


    // ==================================
    // PREPARAR SESIÓN
    // ==================================

    const respuesta =
      await iniciarProcesamientoTicket(
        remitente,
        ticket,
        messageId
      );


    // ==================================
    // ENVIAR PROPUESTA
    // ==================================

    if (
      respuesta
    ) {

      await enviarMensajeWhatsApp(
        remitente,
        respuesta
      );

    }

  } catch (
    error
  ) {

    console.error(
      "Error procesando ticket:",
      error
    );

    console.error(
      "Detalles del ticket:",
      error.details ||
      ""
    );


    sesiones.delete(
      remitente
    );


    await enviarMensajeWhatsApp(
      remitente,
      [
        "⚠️ No pude leer correctamente el ticket.",
        "",
        "No registré ninguna compra.",
        "",
        "Puedes intentar enviarme una foto más clara."
      ].join("\n")
    );

  }

}


// ========================================
// REEMPLAZAR PROCESAMIENTO DE IMAGEN
// ========================================

async function procesarImagenRecibida(
  remitente,
  mensaje,
  messageId
) {

  const media =
    obtenerTipoMedia(
      mensaje
    );


  if (
    !media ||
    media.tipo !==
      "image"
  ) {

    return false;

  }


  try {

    const archivo =
      await obtenerMediaWhatsApp(
        media.mediaId
      );


    await procesarImagenComoTicket(
      remitente,
      archivo,
      messageId
    );


    return true;

  } catch (
    error
  ) {

    console.error(
      "Error obteniendo imagen:",
      error
    );


    await enviarMensajeWhatsApp(
      remitente,
      [
        "⚠️ Recibí la imagen, pero no pude procesarla.",
        "",
        "No registré ninguna compra."
      ].join("\n")
    );


    return true;

  }

}
// ========================================
// TICKET — CONFIRMACIÓN COMPLETA
// ========================================

async function finalizarTicketConLista(
  remitente,
  sesion
) {

  const clasificacion =
    sesion.clasificacion;

  const registrados = [];
  const errores = [];

  for (
    const item
    of clasificacion.enLista
  ) {

    try {

      const pendiente =
        item.coincidencia?.data;

      const idLista =
        pendiente?.ID;

      if (
        !idLista
      ) {

        errores.push(
          item.ticket?.Producto ||
          "Producto sin ID"
        );

        continue;

      }

      const data =
        completarDatosCalculados(
          "Super",
          {
            ...item.ticket,

            Tienda:
              item.ticket.Tienda ||
              clasificacion.tienda ||
              "",

            "Fecha de compra":
              item.ticket[
                "Fecha de compra"
              ] ||
              clasificacion.fecha ||
              fechaActualMexico()
          }
        );

      const resultado =
        await superRegistrarCompraVinculada(
          idLista,
          data
        );

      registrados.push(
        resultado
      );

    } catch (
      error
    ) {

      console.error(
        "Error registrando producto del ticket:",
        error
      );

      errores.push(
        item.ticket?.Producto ||
        "Producto"
      );

    }

  }


  // ==================================
  // ¿HAY PRODUCTOS FUERA DE LA LISTA?
  // ==================================

  if (
    clasificacion.fueraDeLista.length
  ) {

    guardarSesion(
      remitente,
      {
        ...sesion,

        tipo:
          "ticket_nuevos_confirmacion",

        registrados,

        errores
      }
    );

    const lineas = [
      "✅ *Productos de tu lista registrados:*",
      ""
    ];


    registrados.forEach(
      resultado => {

        const producto =
          resultado?.compra?.data?.Producto ||
          resultado?.vinculacion?.productoCompra ||
          "Producto";

        const monto =
          resultado?.compra?.data?.Monto;

        lineas.push(
          monto !== undefined &&
          monto !== ""
            ? `• ${producto} — ${formatearDinero(monto)}`
            : `• ${producto}`
        );

      }
    );


    if (
      errores.length
    ) {

      lineas.push(
        "",
        "⚠️ No pude registrar:",
        ...errores.map(
          producto =>
            `• ${producto}`
        )
      );

    }


    lineas.push(
      "",
      resumenProductosFueraLista(
        clasificacion.fueraDeLista
      )
    );


    return lineas.join(
      "\n"
    );

  }


  // ==================================
  // NO HAY PRODUCTOS NUEVOS
  // ==================================

  sesiones.delete(
    remitente
  );


  const lineas = [
    "✅ *Ticket procesado.*",
    ""
  ];


  if (
    registrados.length
  ) {

    lineas.push(
      `Compras registradas: ${registrados.length}`
    );

    registrados.forEach(
      resultado => {

        const producto =
          resultado?.compra?.data?.Producto ||
          resultado?.vinculacion?.productoCompra ||
          "Producto";

        const monto =
          resultado?.compra?.data?.Monto;

        lineas.push(
          monto !== undefined &&
          monto !== ""
            ? `• ${producto} — ${formatearDinero(monto)}`
            : `• ${producto}`
        );

      }
    );

  }


  if (
    errores.length
  ) {

    lineas.push(
      "",
      "⚠️ No pude registrar:",
      ...errores.map(
        producto =>
          `• ${producto}`
      )
    );

  }


  return lineas.join(
    "\n"
  );

}


// ========================================
// CONFIRMACIÓN DE PRODUCTOS DE LA LISTA
// ========================================

async function procesarTicketConfirmacionCompleta(
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
      "❌ No registré ninguna compra del ticket."
    );

  }


  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return [
      "Necesito que me confirmes.",
      "",
      "Responde *sí* para registrar las compras de tu lista o *no* para cancelar."
    ].join("\n");

  }


  return finalizarTicketConLista(
    remitente,
    sesion
  );

}


// ========================================
// CONFIRMACIÓN DE PRODUCTOS NUEVOS
// ========================================

async function procesarTicketNuevosConfirmacionCompleta(
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

    return [
      "✅ Las compras que estaban en tu lista quedaron registradas.",
      "",
      "🆕 Los productos que no estaban en tu lista no fueron registrados."
    ].join("\n");

  }


  if (
    !respuestaSi(
      textoUsuario
    )
  ) {

    return [
      "Necesito que me confirmes.",
      "",
      "Responde *sí* para registrar también los productos nuevos o *no* para dejarlos fuera."
    ].join("\n");

  }


  const resultado =
    await registrarProductosFueraLista(
      remitente,
      sesion
    );

  return resultado;

}


// ========================================
// AGREGAR TIPOS DE SESIÓN DEL TICKET
// ========================================

const procesarSesionPendienteOriginal =
  procesarSesionPendiente;

async function procesarSesionPendiente(
  textoUsuario,
  remitente,
  sesion
) {

  if (
    sesion.tipo ===
    "ticket_confirmacion"
  ) {

    return procesarTicketConfirmacionCompleta(
      textoUsuario,
      remitente,
      sesion
    );

  }


  if (
    sesion.tipo ===
    "ticket_nuevos_confirmacion"
  ) {

    return procesarTicketNuevosConfirmacionCompleta(
      textoUsuario,
      remitente,
      sesion
    );

  }


  return procesarSesionPendienteOriginal(
    textoUsuario,
    remitente,
    sesion
  );

}
// ========================================
// PROCESAR MENSAJE MULTIMEDIA
// ========================================

async function procesarMensajeWhatsApp(
  remitente,
  mensaje,
  messageId
) {

  const media =
    obtenerTipoMedia(
      mensaje
    );

  if (
    !media
  ) {

    return false;

  }


  // ==================================
  // IMAGEN
  // ==================================

  if (
    media.tipo ===
    "image"
  ) {

    await procesarImagenRecibida(
      remitente,
      mensaje,
      messageId
    );

    return true;

  }


  // ==================================
  // AUDIO
  // ==================================

  if (
    media.tipo ===
    "audio"
  ) {

    await procesarMediaWhatsApp(
      remitente,
      mensaje,
      messageId
    );

    return true;

  }


  // ==================================
  // DOCUMENTO
  // ==================================

  if (
    media.tipo ===
    "document"
  ) {

    await procesarMediaWhatsApp(
      remitente,
      mensaje,
      messageId
    );

    return true;

  }


  return false;

}


// ========================================
// ENTRADA ÚNICA DE WHATSAPP
// ========================================

async function procesarEntradaWhatsApp(
  mensaje
) {

  const remitente =
    mensaje?.from;
  
console.log(
  "DESTINATARIO RECIBIDO DE META:",
  remitente
);
  const messageId =
    mensaje?.id;

  if (
    !remitente ||
    !messageId
  ) {

    return;

  }


  // ==================================
  // EVITAR DUPLICADOS
  // ==================================

  if (
    mensajesProcesados.has(
      messageId
    )
  ) {

    return;

  }


  // ==================================
  // MEDIA
  // ==================================

  const procesadoComoMedia =
    await procesarMensajeWhatsApp(
      remitente,
      mensaje,
      messageId
    );

  if (
    procesadoComoMedia
  ) {

    mensajesProcesados.set(
      messageId,
      Date.now()
    );

    return;

  }


  // ==================================
  // TEXTO
  // ==================================

  if (
    mensaje?.type ===
    "text"
  ) {

    const texto =
      mensaje?.text?.body ||
      "";

    await procesarMensaje(
      remitente,
      texto,
      messageId
    );

    return;

  }


  // ==================================
  // TIPO NO SOPORTADO
  // ==================================

  await enviarMensajeWhatsApp(
    remitente,
    [
      "⚠️ Recibí tu mensaje, pero todavía no puedo procesar ese tipo de archivo.",
      "",
      "Por ahora puedo trabajar con texto e imágenes."
    ].join("\n")
  );

}
// ========================================
// SEGURIDAD — META WEBHOOK
// ========================================

const crypto =
  require("crypto");


function obtenerFirmaMeta(
  req
) {

  const firma =
    req.headers[
      "x-hub-signature-256"
    ];

  if (
    !firma
  ) {

    return null;

  }

  return firma;

}


function validarFirmaMeta(
  req,
  rawBody
) {

  const firma =
    obtenerFirmaMeta(
      req
    );

  if (
    !firma
  ) {

    return false;

  }

  const prefijo =
    "sha256=";

  if (
    !firma.startsWith(
      prefijo
    )
  ) {

    return false;

  }

  const firmaRecibida =
    firma.slice(
      prefijo.length
    );


  if (
    !firmaRecibida
  ) {

    return false;

  }


  const appSecret =
    process.env.META_APP_SECRET;

  if (
    !appSecret
  ) {

    console.error(
      "Falta META_APP_SECRET."
    );

    return false;

  }


  const hash =
    crypto
      .createHmac(
        "sha256",
        appSecret
      )
      .update(
        rawBody
      )
      .digest(
        "hex"
      );


  const esperado =
    Buffer.from(
      hash,
      "utf8"
    );

  const recibido =
    Buffer.from(
      firmaRecibida,
      "utf8"
    );


  if (
    esperado.length !==
    recibido.length
  ) {

    return false;

  }


  return crypto.timingSafeEqual(
    esperado,
    recibido
  );

}


// ========================================
// LEER BODY RAW
// ========================================

function leerBody(
  req
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const partes = [];

      let tamano = 0;

      const MAX_BODY =
        15 * 1024 * 1024;


      req.on(
        "data",
        chunk => {

          tamano +=
            chunk.length;

          if (
            tamano >
            MAX_BODY
          ) {

            reject(
              new Error(
                "El cuerpo de la solicitud es demasiado grande."
              )
            );

            req.destroy();

            return;

          }

          partes.push(
            chunk
          );

        }
      );


      req.on(
        "end",
        () => {

          resolve(
            Buffer.concat(
              partes
            )
          );

        }
      );


      req.on(
        "error",
        reject
      );

    }
  );

}


// ========================================
// RESPUESTAS HTTP
// ========================================

function responderJSON(
  res,
  status,
  datos
) {

  const cuerpo =
    JSON.stringify(
      datos
    );

  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",
      "Cache-Control":
        "no-store"
    }
  );

  res.end(
    cuerpo
  );

}


function responderTexto(
  res,
  status,
  texto
) {

  res.writeHead(
    status,
    {
      "Content-Type":
        "text/plain; charset=utf-8",
      "Cache-Control":
        "no-store"
    }
  );

  res.end(
    texto
  );

}


// ========================================
// VERIFICACIÓN DEL WEBHOOK
// ========================================

function verificarWebhookMeta(
  url,
  res
) {

  const modo =
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
    modo ===
      "subscribe" &&
    token ===
      VERIFY_TOKEN &&
    challenge
  ) {

    responderTexto(
      res,
      200,
      challenge
    );

    return true;

  }


  responderTexto(
    res,
    403,
    "Forbidden"
  );

  return true;

}


// ========================================
// EXTRAER MENSAJES DE META
// ========================================

function extraerMensajesWhatsApp(
  datos
) {

  const mensajes = [];


  const entradas =
    Array.isArray(
      datos?.entry
    )
      ? datos.entry
      : [];


  for (
    const entrada
    of entradas
  ) {

    const cambios =
      Array.isArray(
        entrada?.changes
      )
        ? entrada.changes
        : [];


    for (
      const cambio
      of cambios
    ) {

      const value =
        cambio?.value;

      const mensajesValue =
        Array.isArray(
          value?.messages
        )
          ? value.messages
          : [];


      for (
        const mensaje
        of mensajesValue
      ) {

        mensajes.push(
          mensaje
        );

      }

    }

  }


  return mensajes;

}


// ========================================
// PROCESAR WEBHOOK POST
// ========================================

async function procesarWebhookPost(
  req,
  res
) {

  let rawBody;


  try {

    rawBody =
      await leerBody(
        req
      );

  } catch (
    error
  ) {

    console.error(
      "Error leyendo webhook:",
      error
    );

    responderJSON(
      res,
      400,
      {
        error:
          "invalid_body"
      }
    );

    return;

  }


  // ==================================
  // VALIDAR FIRMA
  // ==================================

  if (
    !validarFirmaMeta(
      req,
      rawBody
    )
  ) {

    responderJSON(
      res,
      401,
      {
        error:
          "invalid_signature"
      }
    );

    return;

  }


  let datos;


  try {

    datos =
      JSON.parse(
        rawBody.toString(
          "utf8"
        )
      );

  } catch (
    error
  ) {

    responderJSON(
      res,
      400,
      {
        error:
          "invalid_json"
      }
    );

    return;

  }


  const mensajes =
    extraerMensajesWhatsApp(
      datos
    );


  // ==================================
  // RESPONDER RÁPIDO A META
  // ==================================

  responderJSON(
    res,
    200,
    {
      ok:
        true
    }
  );


  // ==================================
  // PROCESAR EN SEGUNDO PLANO
  // ==================================

  for (
    const mensaje
    of mensajes
  ) {

    try {

      await procesarEntradaWhatsApp(
        mensaje
      );

    } catch (
      error
    ) {

      console.error(
        "Error procesando mensaje de WhatsApp:",
        error
      );

    }

  }

}
// ========================================
// SERVIDOR HTTP
// ========================================

const servidor =
  http.createServer(
    async (
      req,
      res
    ) => {

      try {

        const url =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );
// ==================================
// PRUEBA — APPS SCRIPT
// ==================================

if (
  req.method === "GET" &&
  url.pathname === "/test-apps-script"
) {

  try {

    const resultado =
      await llamarAppsScript({
       action: "super_ver_lista"
      });

    responderJSON(
      res,
      200,
      {
        ok: true,
        origen: "Render",
        destino: "Apps Script",
        resultado
      }
    );

  } catch (error) {

    console.error(
      "Error en prueba Apps Script:",
      error
    );

    responderJSON(
      res,
      500,
      {
        ok: false,
        error:
          error.message,
        detalles:
          error.details ||
          null
      }
    );

  }

  return;
}

        // ==================================
        // HEALTH CHECK
        // ==================================

        if (
          req.method ===
            "GET" &&
          url.pathname ===
            "/"
        ) {

          responderJSON(
            res,
            200,
            {
              ok:
                true,
              servicio:
                "Asistente Finanzas WhatsApp",
              fecha:
                new Date().toISOString()
            }
          );

          return;

        }


        // ==================================
        // WEBHOOK GET — META
        // ==================================

        if (
          req.method ===
            "GET" &&
          url.pathname ===
            "/webhook"
        ) {

          verificarWebhookMeta(
            url,
            res
          );

          return;

        }


        // ==================================
        // WEBHOOK POST — META
        // ==================================

        if (
          req.method ===
            "POST" &&
          url.pathname ===
            "/webhook"
        ) {

          await procesarWebhookPost(
            req,
            res
          );

          return;

        }


        // ==================================
        // RUTA NO ENCONTRADA
        // ==================================

        responderJSON(
          res,
          404,
          {
            error:
              "not_found"
          }
        );

      } catch (
        error
      ) {

        console.error(
          "Error del servidor:",
          error
        );


        if (
          !res.headersSent
        ) {

          responderJSON(
            res,
            500,
            {
              error:
                "internal_server_error"
            }
          );

        }

      }

    }
  );


// ========================================
// INICIAR SERVIDOR
// ========================================

servidor.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Servidor iniciado en puerto ${PORT}`
    );

    console.log(
      `Webhook disponible en /webhook`
    );

    console.log(
      `Zona horaria: ${ZONA_HORARIA}`
    );

  }
);
