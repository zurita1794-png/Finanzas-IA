const http = require("http");

const PORT = process.env.PORT || 10000;

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

const mensajesProcesados =
  new Map();

const sesiones =
  new Map();

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
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}

function guardarSesion(
  remitente,
  sesion
) {
  sesiones.set(
    remitente,
    {
      ...sesion,
      actualizadoEn:
        Date.now()
    }
  );
}

function obtenerSesion(
  remitente
) {
  const sesion =
    sesiones.get(remitente);

  if (!sesion) {
    return null;
  }

  if (
    Date.now() -
      Number(
        sesion.actualizadoEn ||
        0
      ) >
    SESION_MS
  ) {
    sesiones.delete(
      remitente
    );

    return null;
  }

  return sesion;
}

function limpiarMensajesProcesados() {
  const limite =
    Date.now() -
    6 * 60 * 60 * 1000;

  for (
    const [id, ts]
    of mensajesProcesados.entries()
  ) {
    if (ts < limite) {
      mensajesProcesados.delete(
        id
      );
    }
  }

  if (
    mensajesProcesados.size >
    1000
  ) {
    const entradas = [
      ...mensajesProcesados.entries()
    ]
      .sort(
        (a, b) =>
          a[1] - b[1]
      )
      .slice(-500);

    mensajesProcesados.clear();

    for (
      const [id, ts]
      of entradas
    ) {
      mensajesProcesados.set(
        id,
        ts
      );
    }
  }
}

function fechaActualMexico() {
  return new Intl.DateTimeFormat(
    "es-MX",
    {
      timeZone:
        ZONA_HORARIA,

      day:
        "2-digit",

      month:
        "2-digit",

      year:
        "numeric"
    }
  ).format(
    new Date()
  );
}

function mesActualMexico() {
  const texto =
    new Intl.DateTimeFormat(
      "es-MX",
      {
        timeZone:
          ZONA_HORARIA,

        month:
          "long",

        year:
          "numeric"
      }
    ).format(
      new Date()
    );

  return (
    texto.charAt(0).toUpperCase() +
    texto.slice(1)
  );
}

function fechaISOActualMexico() {
  const partes =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          ZONA_HORARIA,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    ).formatToParts(
      new Date()
    );

  const obj = {};

  for (
    const p
    of partes
  ) {
    if (
      p.type !==
      "literal"
    ) {
      obj[p.type] =
        p.value;
    }
  }

  return (
    `${obj.year}-` +
    `${obj.month}-` +
    `${obj.day}`
  );
}

function finMesActualMexico() {
  const hoy =
    fechaISOActualMexico();

  const [
    anio,
    mes
  ] =
    hoy
      .split("-")
      .map(Number);

  const ultimo =
    new Date(
      Date.UTC(
        anio,
        mes,
        0
      )
    );

  const d =
    String(
      ultimo.getUTCDate()
    ).padStart(
      2,
      "0"
    );

  return (
    `${d}/` +
    `${String(mes).padStart(2, "0")}/` +
    `${anio}`
  );
}

function formatearDinero(
  valor
) {
  let numero =
    valor;

  if (
    typeof numero !==
    "number"
  ) {
    numero =
      Number(
        String(
          valor || ""
        ).replace(
          /[^0-9.-]/g,
          ""
        )
      );
  }

  if (
    !Number.isFinite(
      numero
    )
  ) {
    numero = 0;
  }

  return new Intl.NumberFormat(
    "es-MX",
    {
      style:
        "currency",

      currency:
        "MXN"
    }
  ).format(
    numero
  );
}

function valorNumero(
  valor
) {
  const n =
    Number(
      String(
        valor ?? ""
      ).replace(
        /[$,%\s]/g,
        ""
      )
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

function siguienteCampoFaltante(
  sheet,
  data
) {
  const campos =
    CAMPOS_REQUERIDOS[
      sheet
    ] || [];

  return campos.find(
    campo =>
      estaVacio(
        data[campo]
      )
  );
}

function obtenerPregunta(
  sheet,
  campo,
  data
) {
  if (campo === "Fecha de ingreso") {
    return (
      '¿Qué fecha le pongo al ingreso?\n' +
      'Ejemplos: "hoy", "ayer" o "16/08/2026".'
    );
  }

  if (campo === "Tipo de ingreso") {
    return (
      "¿Qué tipo de ingreso es?\n" +
      "Ejemplos: sueldo, bono, vales, comisión, premio de puntualidad o ingreso extraordinario."
    );
  }

  if (
    sheet === "Ingresos" &&
    campo === "Monto"
  ) {
    return (
      `¿De cuánto fue el ingreso${
        data["Tipo de ingreso"]
          ? ` de ${data["Tipo de ingreso"]}`
          : ""
      }?\n` +
      'Ejemplo: "18,000 pesos".'
    );
  }

  if (campo === "Fecha de pago") {
    return (
      '¿Qué fecha le pongo al pago?\n' +
      'Ejemplos: "hoy", "ayer" o "16/08/2026".'
    );
  }

  if (campo === "Concepto") {
    return (
      "¿Qué pago es?\n" +
      "Ejemplos: luz, internet, renta, teléfono, tarjeta o seguro."
    );
  }

  if (campo === "Periodo") {
    return (
      "¿A qué periodo corresponde ese pago?\n" +
      'Ejemplos: "Agosto 2026" o "Julio 2026".'
    );
  }

  if (
    sheet === "Pagos" &&
    campo === "Monto"
  ) {
    return (
      `¿Cuál es el monto${
        data.Concepto
          ? ` de ${data.Concepto}`
          : ""
      }?\n` +
      'Ejemplo: "850 pesos".'
    );
  }

  if (
    sheet === "Pagos" &&
    campo === "Estado"
  ) {
    return (
      "¿Cuál es el estado del pago?\n" +
      'Ejemplos: "Pagado" si ya salió el dinero o "Pendiente" si todavía falta pagarlo.'
    );
  }

  if (campo === "Fecha de compra") {
    return (
      '¿Qué fecha le pongo a la compra?\n' +
      'Ejemplos: "hoy", "ayer" o "16/08/2026".'
    );
  }

  if (campo === "Producto") {
    return (
      "¿Cuál es el producto específico?\n" +
      "Pon la marca o nombre concreto.\n" +
      "Ejemplos: Coca-Cola Zero, Galletas Marías Gamesa o Papel Higiénico Regio."
    );
  }

  if (campo === "Producto base") {
    return (
      "¿Cuál es el producto base?\n" +
      "Es el tipo general, sin marca ni presentación, para comparar precios después.\n" +
      "Ejemplos: refresco, galletas, papel higiénico, leche o agua mineral."
    );
  }

  if (campo === "Categoría") {
    return (
      "¿En qué categoría va?\n" +
      "Es el grupo general del gasto.\n" +
      "Ejemplos: bebidas, higiene, limpieza, despensa, lácteos o farmacia."
    );
  }

  if (
    sheet === "Super" &&
    campo === "Monto"
  ) {
    return (
      `¿Cuánto pagaste en total por ${
        data.Producto || "ese producto"
      }?\n` +
      'Ejemplo: "120 pesos".'
    );
  }

  if (campo === "Tienda") {
    return (
      "¿En qué tienda lo compraste?\n" +
      "Ejemplos: Walmart, Costco, Soriana, Chedraui o Farmacia Guadalajara."
    );
  }

  if (campo === "Cantidad") {
    return (
      "¿Cuántos empaques o productos completos compraste?\n" +
      "No cuentes aquí las piezas que vienen dentro del empaque.\n" +
      "Ejemplos: 1 paquete, 2 cajas o 3 botellas.\n" +
      'Si compraste un paquete de 12 rollos, responde "1".'
    );
  }

  if (campo === "Unidad") {
    return (
      "¿Cuál es el tipo de empaque o unidad que compraste?\n" +
      "Ejemplos: paquete, caja, bolsa, botella, lata o pieza."
    );
  }

  if (campo === "Contenido por empaque") {
    return (
      "¿Cuánto contenido trae cada empaque?\n" +
      "Ejemplos:\n" +
      "• Paquete de 12 rollos → 12\n" +
      "• Caja de 24 latas → 24\n" +
      "• Paquete con 6 litros → 6\n" +
      "• Bolsa de 750 g comparada por kilogramo → 0.75"
    );
  }

  if (campo === "Unidad de comparación") {
    return (
      "¿Con qué unidad quieres comparar el precio?\n" +
      "Usa una unidad práctica.\n" +
      "Ejemplos: rollo, litro, kilogramo, pieza o lata.\n" +
      "Papel higiénico → rollo; leche → litro; arroz → kilogramo."
    );
  }

  return `¿Cuál es el valor de ${campo}?`;
}

function esSaludoSimple(
  texto
) {
  const t =
    normalizar(texto)
      .replace(
        /[!?.,]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const palabras =
    t
      .split(" ")
      .filter(Boolean);

  if (
    palabras.length >
    5
  ) {
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
      t.startsWith(
        `${s} `
      )
  );
}

function esAyuda(
  texto
) {
  const t =
    normalizar(texto);

  return (
    t === "ayuda" ||
    t === "menu" ||
    t ===
      "que puedes hacer" ||
    t ===
      "que sabes hacer"
  );
}

function respuestaAyuda() {
  return [
    "Puedes escribirme de forma natural. Por ejemplo:",
    "",
    '• "Compré papel en Walmart por 250 pesos hoy."',
    '• "Pagué la luz de julio, fueron 850 pesos."',
    '• "Recibí mi sueldo de 18,000 hoy."',
    '• "Borra jabón de 250."',
    '• "Mándame mi reporte de agosto."',
    '• "Compara el precio del papel de los últimos 2 meses."',
    '• "Quiero ahorrar 10% de mi sueldo."',
    '• "Quiero juntar 10,000 para diciembre."',
    "",
    "Antes de guardar o eliminar algo, siempre te pediré confirmación."
  ].join("\n");
}

function respuestaSi(
  texto
) {
  const t =
    normalizar(texto);

  return [
    "si",
    "sí",
    "confirmo",
    "confirmar",
    "ok",
    "okay",
    "correcto",
    "adelante",
    "guardalo",
    "guárdalo",
    "hazlo"
  ]
    .map(
      normalizar
    )
    .includes(t);
}

function respuestaNo(
  texto
) {
  const t =
    normalizar(texto);

  return [
    "no",
    "cancelar",
    "cancela",
    "cancelalo",
    "cancélalo"
  ]
    .map(
      normalizar
    )
    .includes(t);
}

function quiereGuardarSinAhorro(
  texto
) {
  const t =
    normalizar(texto);

  return (
    t.includes(
      "sin ahorro"
    ) ||

    t.includes(
      "no ahorrar"
    ) ||

    t.includes(
      "nada de ahorro"
    ) ||

    t === "nada" ||

    t === "no"
  );
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
      "Precio por unidad" ||

    campo ===
      "Valor del ahorro" ||

    campo ===
      "Ahorro realizado" ||

    campo ===
      "Dinero libre"
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
      "Forma de pago",
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

function formatearRegistro(
  sheet,
  data
) {
  return camposParaResumen(
    sheet
  )
    .map(
      campo =>
        formatearCampo(
          campo,
          data[campo]
        )
    )
    .filter(Boolean)
    .join("\n");
}

function tituloHoja(
  sheet
) {
  if (
    sheet ===
    "Super"
  ) {
    return "Súper";
  }

  return sheet;
}

async function enviarMensajeWhatsApp(
  destinatario,
  texto
) {
  const respuesta =
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
              body:
                String(
                  texto
                ).slice(
                  0,
                  4096
                )
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

  console.log(
    "Respuesta WhatsApp:",
    datos
  );

  if (
    !respuesta.ok
  ) {
    throw new Error(
      datos?.error
        ?.message ||

      `WhatsApp respondió HTTP ${respuesta.status}`
    );
  }

  return datos;
}

function extraerJSON(
  texto
) {
  const limpio =
    String(
      texto || ""
    )
      .replace(
        /```json/gi,
        ""
      )
      .replace(
        /```/g,
        ""
      )
      .trim();

  return JSON.parse(
    limpio
  );
}

async function llamadaGemini({
  systemInstruction,
  parts,
  jsonMode = false
}) {
  if (
    !GEMINI_API_KEY
  ) {
    throw new Error(
      "Falta GEMINI_API_KEY."
    );
  }

  const body = {
    system_instruction: {
      parts: [
        {
          text:
            systemInstruction
        }
      ]
    },

    contents: [
      {
        role:
          "user",

        parts
      }
    ]
  };

  if (
    jsonMode
  ) {
    body.generationConfig = {
      responseMimeType:
        "application/json",

      temperature:
        0.1
    };
  }

  const respuesta =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY
        },

        body:
          JSON.stringify(
            body
          )
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
        datos?.error
          ?.message ||

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
        parte =>
          parte.text
      )
      .filter(Boolean)
      .join("\n")
      .trim();

  if (
    !texto
  ) {
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
Hay una operación en curso.

Hoja actual:
${contextoRegistro.sheet}

Datos actuales:
${JSON.stringify(
  contextoRegistro.data ||
  {}
)}

Campo que falta:
${
  siguienteCampoFaltante(
    contextoRegistro.sheet,
    contextoRegistro.data ||
      {}
  ) ||
  "ninguno"
}

El nuevo mensaje puede:
- contestar el campo faltante;
- corregir uno o más datos anteriores;
- agregar notas o información opcional.

Conserva los datos anteriores salvo que el usuario los corrija explícitamente.
`
      : "";

  return `
Eres Finanzas IA, un asistente personal de finanzas que funciona por WhatsApp.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.
No uses markdown.
No escribas nada fuera del JSON.

Fecha actual en Ciudad de México:
${hoy}

Mes actual:
${mesActual}

Tu trabajo es ENTENDER lenguaje natural.
El usuario no tiene que usar comandos exactos.

REGLAS GENERALES:

- Nunca inventes montos, tiendas, cantidades, fechas, periodos o formas de pago.
- Sí puedes inferir "Producto base" y "Categoría" cuando sea obvio a partir del producto.
- Si no estás seguro, deja ese campo vacío para que el sistema pregunte.
- Convierte "hoy", "ayer", "mañana", "el próximo viernes", etc. a una fecha exacta DD/MM/AAAA.
- Si una expresión de fecha es realmente ambigua, deja la fecha vacía.
- Si el usuario dice que YA pagó algo, Estado puede ser "Pagado".
- Si dice que lo pagará después o que está pendiente, Estado puede ser "Pendiente".
- En Ingresos y Super no necesitas inventar Estado.
- Si menciona un mes sin año, usa el año actual.
- Periodo de Pagos debe quedar como "Mes AAAA", por ejemplo "Julio 2026".
- "Fecha de pago" es cuándo salió el dinero.
- "Periodo" es el mes al que corresponde el pago.
- No confundas fecha con producto, concepto o monto.
- Los montos deben ser números, sin signo de pesos.
- "sin notas" significa Notas = "".
- Si el usuario pide cambiar o corregir un dato, devuelve el registro completo actualizado.
- Nunca confirmes que algo se guardó o eliminó. El sistema hará la confirmación final.

HOJAS Y CAMPOS:

Ingresos:
Estado,
Fecha de ingreso,
Tipo de ingreso,
Monto,
Forma de pago,
Notas,
Registro de mensaje enviado

Pagos:
Estado,
Fecha de pago,
Concepto,
Periodo,
Monto,
Forma de pago,
Notas,
Registro de mensaje enviado

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
Registro de mensaje enviado

REGLAS ESPECÍFICAS PARA SUPER:
- Producto es el artículo específico, incluyendo marca o presentación cuando se conozca. Ejemplos: "Coca-Cola Zero 600 ml", "Papel Higiénico Regio 12 rollos".
- Producto base es el artículo general que sirve para comparar. Ejemplos: "Refresco", "Papel higiénico", "Leche".
- Categoría es el grupo general del gasto. Ejemplos: "Bebidas", "Higiene", "Lácteos", "Despensa".
- Cantidad es el número de empaques o productos completos comprados. Ejemplo: si compró 1 paquete de 12 rollos, Cantidad = 1.
- Unidad es el tipo de empaque comprado. Ejemplos: paquete, caja, bolsa, botella, lata, pieza.
- Contenido por empaque indica cuánto trae CADA empaque expresado en la Unidad de comparación.
- Ejemplo: paquete de 12 rollos => Contenido por empaque = 12 y Unidad de comparación = "rollo".
- Ejemplo: botella de 600 ml => Contenido por empaque = 0.6 y Unidad de comparación = "litro".
- Ejemplo: bolsa de 750 g => Contenido por empaque = 0.75 y Unidad de comparación = "kilogramo".
- Unidad de comparación debe ser una unidad práctica para comparar precios: rollo, litro, kilogramo, pieza, lata, etc.
- No inventes Cantidad, Unidad, Contenido por empaque ni Unidad de comparación si el usuario no los dijo o no pueden inferirse con seguridad.
- Precio por unidad puede quedar vacío; el sistema lo calculará automáticamente.

1) REGISTRAR

{
  "accion": "registrar",
  "sheet": "Ingresos|Pagos|Super",
  "data": {},
  "respuesta": ""
}

Ejemplos:

"Compré papel Regio de 12 rollos en Walmart por 250 hoy"

=> Super.
Producto puede conservar marca/presentación.
Producto base debe ser "Papel higiénico".
Categoría puede inferirse como "Higiene".

"Ya pagué la luz de julio, 850 pesos, hoy"

=> Pagos.
Concepto "Luz".
Periodo debe incluir mes y año.
Estado "Pagado".

"Me depositaron mi sueldo hoy, 18000"

=> Ingresos.
Tipo de ingreso "Sueldo".

2) ELIMINAR

{
  "accion": "eliminar",
  "sheet": "Ingresos|Pagos|Super",
  "buscar": "texto útil para buscar",
  "respuesta": ""
}

Si el usuario dice "borra jabón 250",
normalmente corresponde a Super.

No elijas cuál registro borrar si puede haber varios.

3) REPORTE

{
  "accion": "reporte",
  "mes": "Agosto 2026",
  "grafica": true,
  "respuesta": ""
}

Usa grafica=true si pide gráfica, visual, imagen o reporte visual.

Si dice "este mes",
usa ${mesActual}.

4) HISTORIAL DE PRECIO

{
  "accion": "historial_producto",
  "producto": "Papel higiénico",
  "meses": 2,
  "respuesta": ""
}

5) CONFIGURAR AHORRO

{
  "accion": "configurar_ahorro",
  "tipoIngreso": "Sueldo",
  "modo": "Porcentaje|Monto fijo|Apagado",
  "valor": 10,
  "alcance": "permanente|este_mes|una_vez",
  "respuesta": ""
}

Ejemplos:

"De ahora en adelante ahorra 15% de mi sueldo"

=> Porcentaje,
valor 15,
permanente.

"Este mes ahorra 2000 de mi bono"

=> Monto fijo,
valor 2000,
este_mes.

"Ya no quiero ahorrar de mis vales"

=> Apagado,
valor 0,
permanente.

6) META DE AHORRO

{
  "accion": "meta_ahorro",
  "meta": "Fondo fin de año",
  "montoObjetivo": 10000,
  "fechaObjetivo": "31/12/2026",
  "respuesta": ""
}

Si dice "para fin de año",
usa 31/12 del año actual.

7) VER METAS

{
  "accion": "metas_resumen",
  "respuesta": ""
}

8) CANCELAR

{
  "accion": "cancelar",
  "respuesta": "Operación cancelada."
}

9) CONVERSACIÓN NORMAL

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
          "Transcribe el mensaje de voz. Conserva números, fechas, nombres de tiendas y cantidades con precisión."
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
  const hoy =
    fechaActualMexico();

  const mes =
    mesActualMexico();

  const systemInstruction = `
Analiza una foto enviada a un asistente de finanzas personales.

RESPONDE ÚNICAMENTE JSON VÁLIDO.

Fecha actual:
${hoy}

Mes actual:
${mes}

Si es un ticket de supermercado, devuelve:

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

Reglas para ticket_super:
- Extrae solo información que realmente se vea o que pueda inferirse con seguridad.
- No inventes productos, precios, cantidades, contenido ni presentaciones.
- Producto conserva marca y presentación cuando puedan identificarse. Ejemplo: "Coca-Cola Zero 600 ml".
- Producto base es el producto general sin marca ni presentación. Ejemplo: "Refresco".
- Categoría es el grupo general. Ejemplo: "Bebidas".
- Cantidad es cuántos empaques o productos completos se compraron.
- Ejemplo: 1 paquete de 12 rollos => Cantidad = 1.
- Unidad es el tipo de empaque comprado: paquete, caja, bolsa, botella, lata, pieza, etc.
- Contenido por empaque es cuánto trae CADA empaque expresado en la Unidad de comparación.
- Ejemplo: paquete de 12 rollos => Contenido por empaque = 12 y Unidad de comparación = "rollo".
- Ejemplo: botella de 600 ml => Contenido por empaque = 0.6 y Unidad de comparación = "litro".
- Ejemplo: bolsa de 750 g => Contenido por empaque = 0.75 y Unidad de comparación = "kilogramo".
- Usa unidades prácticas para comparar precios; evita unidades diminutas como mililitro cuando sea más útil comparar por litro.
- Si la presentación no puede determinarse con seguridad, deja Cantidad, Unidad, Contenido por empaque o Unidad de comparación vacíos según corresponda.
- Deja Precio por unidad vacío. El sistema lo calculará automáticamente usando Monto, Cantidad y Contenido por empaque.
- Fecha debe ser DD/MM/AAAA.
- Si no se ve la fecha, déjala vacía.
- Si no se ve la tienda, déjala vacía.

Si es un recibo o comprobante de un servicio/pago, devuelve:

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

- Si el documento acredita que ya fue pagado, Estado puede ser "Pagado".
- Si es solo un recibo por pagar y no demuestra pago, deja Estado vacío.
- Periodo debe ser "Mes AAAA" cuando pueda determinarse.

Si no puedes clasificarlo con seguridad:

{
  "accion": "imagen_desconocida",
  "descripcion": "explica brevemente qué alcanzas a leer"
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
            "Extrae la información financiera de esta imagen siguiendo exactamente el esquema indicado."
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
    typeof nuevos ===
      "object"
  ) {
    for (
      const [campo, valor]
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
      JSON.parse(
        texto
      );
  } catch {
    throw new Error(
      "Apps Script no devolvió JSON. Respuesta: " +
      texto.slice(
        0,
        200
      )
    );
  }

  if (
    !datos.ok
  ) {
    throw new Error(
      datos.error ||
      "Apps Script rechazó la operación."
    );
  }

  return datos;
}

async function obtenerMediaWhatsApp(
  mediaId
) {
  const respuesta =
    await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
      {
        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

  const datos =
    await respuesta
      .json()
      .catch(
        () => ({})
      );

  if (
    !respuesta.ok ||
    !datos.url
  ) {
    throw new Error(
      datos?.error
        ?.message ||

      "No pude obtener la URL del archivo de WhatsApp."
    );
  }

  const descarga =
    await fetch(
      datos.url,
      {
        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

  if (
    !descarga.ok
  ) {
    throw new Error(
      `No pude descargar el archivo de WhatsApp. HTTP ${descarga.status}`
    );
  }

  const arrayBuffer =
    await descarga.arrayBuffer();

  return {
    buffer:
      Buffer.from(
        arrayBuffer
      ),

    mimeType:
      datos.mime_type ||
      descarga.headers.get(
        "content-type"
      ) ||
      "application/octet-stream"
  };
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

async function buscarSimilares(
  sheet,
  data
) {
  return llamarAppsScript({
    action:
      "buscar_similares",

    sheet,
    data
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

async function consultarHistorialProducto(
  producto,
  meses
) {
  return llamarAppsScript({
    action:
      "historial_producto",

    producto,
    meses
  });
}

async function listarConfig() {
  return llamarAppsScript({
    action:
      "config_listar"
  });
}

async function guardarConfig(
  data
) {
  return llamarAppsScript({
    action:
      "config_guardar",

    data
  });
}

async function guardarAhorro(
  data
) {
  return llamarAppsScript({
    action:
      "ahorro_guardar",

    data
  });
}

async function guardarMeta(
  data
) {
  return llamarAppsScript({
    action:
      "meta_guardar",

    data
  });
}

async function consultarMetas() {
  return llamarAppsScript({
    action:
      "metas_resumen"
  });
}

function fechaComparableDDMMYYYY(
  texto
) {
  const m =
    String(
      texto || ""
    ).match(
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

function reglaEstaVigente(
  regla
) {
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
    ].includes(
      activo
    )
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

async function obtenerReglaAhorro(
  tipoIngreso
) {
  const resultado =
    await listarConfig();

  const registros =
    resultado.registros ||
    [];

  const tipo =
    normalizar(
      tipoIngreso
    );

  const reglas =
    registros.filter(
      r => {
        return (
          normalizar(
            r.Tipo
          ) ===
            "ahorro" &&

          normalizar(
            r.Clave
          ) ===
            tipo &&

          reglaEstaVigente(
            r
          )
        );
      }
    );

  if (
    !reglas.length
  ) {
    return null;
  }

  return reglas[
    reglas.length - 1
  ];
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
    m ===
    "porcentaje"
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
    m ===
      "monto fijo" ||
    m ===
      "monto"
  ) {
    return (
      Math.round(
        v * 100
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
    m ===
    "porcentaje"
  ) {
    return (
      `${valorNumero(valor)}%`
    );
  }

  if (
    m ===
      "monto fijo" ||
    m ===
      "monto"
  ) {
    return formatearDinero(
      valor
    );
  }

  return "Sin ahorro";
}

function detectarAhorroRapido(
  texto
) {
  const t =
    normalizar(
      texto
    );

  const porcentaje =
    t.match(
      /(\d+(?:[.,]\d+)?)\s*%/
    );

  if (
    porcentaje
  ) {
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
    String(
      texto
    ).match(
      /(?:\$|mxn\s*)?(\d[\d,.\s]*)\s*(?:pesos?)?/i
    );

  if (
    monto
  ) {
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
      Number.isFinite(
        n
      )
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

function detectarAlcance(
  texto
) {
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
    !coincidencias
      ?.length
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
              ? ` - ${formatearDinero(
                  d.Monto
                )}`
              : "";

          return (
            `${i + 1}. ` +
            `${nombre}` +
            `${monto}` +
            `${
              fecha
                ? ` - ${fecha}`
                : ""
            }`
          );
        }
      )
      .join("\n");

  return (
    "\n\n⚠️ Encontré un posible duplicado:\n" +
    lista +
    "\nSi lo confirmas, se guardará de todos modos."
  );
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

    const unidadesComparables =
      cantidad *
      contenido;

    if (
      monto > 0 &&
      cantidad > 0 &&
      contenido > 0 &&
      unidadesComparables > 0
    ) {
      resultado[
        "Precio por unidad"
      ] =
        Math.round(
          (
            monto /
            unidadesComparables
          ) *
          100
        ) /
        100;
    }
  }

  return resultado;
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

  let reglaAhorro = null;
  let ahorroCalculado = 0;

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

      if (
        reglaAhorro
      ) {
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

  let texto =
    `Antes de guardar, revisa:\n\n` +
    `${tituloHoja(sheet)}\n` +
    `${formatearRegistro(
      sheet,
      completos
    )}`;

  if (
    sheet ===
    "Ingresos"
  ) {
    const tipo =
      completos[
        "Tipo de ingreso"
      ];

    if (
      reglaAhorro
    ) {
      if (
        normalizar(
          reglaAhorro.Modo
        ) ===
        "apagado"
      ) {
        texto +=
          `\n\nAhorro: actualmente no estás ahorrando de ${tipo}.`;

      } else {
        texto +=
          `\n\nAhorro actual para ${tipo}: ` +
          `${descripcionReglaAhorro(
            reglaAhorro.Modo,
            reglaAhorro.Valor
          )}.`;

        texto +=
          `\nDe este ingreso se separarían ` +
          `${formatearDinero(
            ahorroCalculado
          )}.`;
      }

    } else {
      texto +=
        `\n\nActualmente no tienes una regla de ahorro para ${tipo}.`;

      texto +=
        ` Después de guardar te preguntaré si quieres crear una.`;
    }
  }

  texto +=
    resumenDuplicados(
      duplicados
    );

  texto +=
    "\n\n¿Está correcto? Responde sí o no.";

  return texto;
}

async function guardarAhorroDeIngreso(
  dataIngreso,
  monto,
  nota
) {
  if (
    valorNumero(monto) <=
    0
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
  if (
    respuestaNo(
      textoUsuario
    )
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

    return (
      "De acuerdo. Dime qué dato quieres corregir. " +
      'Por ejemplo: "el monto es 350" o "la fecha es mañana".'
    );
  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {
    return (
      "Necesito tu confirmación. " +
      "Responde sí si está correcto o no si quieres cambiar algo."
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
      `Listo. Guardé el registro con ID ${resultado.id}.`
    );
  }

  if (
    sesion.reglaAhorro
  ) {
    const modo =
      normalizar(
        sesion.reglaAhorro.Modo
      );

    const ahorro =
      Number(
        sesion.ahorroCalculado ||
        0
      );

    if (
      modo !==
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
        `Listo. Guardé el ingreso con ID ${resultado.id}.` +
        `\nTambién separé ${formatearDinero(
          ahorro
        )} como ahorro.`
      );
    }

    sesiones.delete(
      remitente
    );

    return (
      `Listo. Guardé el ingreso con ID ${resultado.id}. ` +
      "La regla actual indica que no se haga ahorro."
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

  return (
    `Listo. Guardé el ingreso con ID ${resultado.id}.\n\n` +
    `No tienes una regla de ahorro para ${
      sesion.data[
        "Tipo de ingreso"
      ]
    }.\n` +
    "¿Quieres crear una ahora?\n\n" +
    'Puedes responder, por ejemplo, "10%", "2000 pesos" o "no".'
  );
}

async function procesarCorreccionRegistro(
  textoUsuario,
  remitente,
  sesion
) {
  if (
    respuestaNo(
      textoUsuario
    ) ||
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
      "Perfecto. Este ingreso queda sin ahorro."
    );
  }

  const reglaRapida =
    detectarAhorroRapido(
      textoUsuario
    );

  if (
    !reglaRapida
  ) {
    return (
      "No alcancé a identificar el ahorro. " +
      'Puedes decir "10%", "1500 pesos" o "no".'
    );
  }

  const alcance =
    detectarAlcance(
      textoUsuario
    );

  if (
    !alcance
  ) {
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

    return (
      `Entendí ${descripcionReglaAhorro(
        reglaRapida.modo,
        reglaRapida.valor
      )}.\n\n` +
      "¿Quieres usarlo solo esta vez, solo este mes o de ahora en adelante?"
    );
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
  const alcance =
    detectarAlcance(
      textoUsuario
    );

  if (
    !alcance
  ) {
    return (
      'Respóndeme "solo esta vez", "este mes" o "de ahora en adelante".'
    );
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

  if (
    monto <= 0
  ) {
    sesiones.delete(
      remitente
    );

    return (
      "El ahorro calculado es $0.00, así que no hice ningún movimiento."
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

  let texto =
    `Perfecto. Separé ${formatearDinero(
      monto
    )} de este ingreso.`;

  if (
    alcance ===
    "este_mes"
  ) {
    texto +=
      "\nLa misma regla se usará durante este mes.";

  } else if (
    alcance ===
    "permanente"
  ) {
    texto +=
      "\nLa dejé como regla de ahora en adelante.";

  } else {
    texto +=
      "\nLa regla fue solo para esta vez.";
  }

  return texto;
}

function construirResumenConfiguracion(
  datos
) {
  const modo =
    datos.modo;

  if (
    normalizar(
      modo
    ) ===
      "apagado"
  ) {
    return (
      `Tipo de ingreso: ${datos.tipoIngreso}\n` +
      "Ahorro: apagado\n" +
      `Alcance: ${datos.alcance}`
    );
  }

  return (
    `Tipo de ingreso: ${datos.tipoIngreso}\n` +
    `Ahorro: ${descripcionReglaAhorro(
      modo,
      datos.valor
    )}\n` +
    `Alcance: ${
      datos.alcance ===
      "este_mes"
        ? "solo este mes"
        : "de ahora en adelante"
    }`
  );
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

  if (
    !tipoIngreso
  ) {
    return (
      "¿Para qué tipo de ingreso quieres definir el ahorro? " +
      "Por ejemplo: sueldo, bono o vales."
    );
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
    return (
      "Dime si quieres ahorrar un porcentaje, un monto fijo o apagar el ahorro."
    );
  }

  if (
    alcance ===
    "una_vez"
  ) {
    return (
      "Si quieres ahorrar solo una vez, hazlo cuando registremos ese ingreso. " +
      "Así sabré exactamente a qué ingreso aplicarlo."
    );
  }

  const datos = {
    tipoIngreso,

    modo,

    valor:
      normalizar(
        modo
      ) ===
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

  return (
    "Voy a dejar la regla así:\n\n" +
    construirResumenConfiguracion(
      datos
    ) +
    "\n\n¿Está correcto? Responde sí o no."
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
      "No hice cambios en tu regla de ahorro."
    );
  }

  if (
    !respuestaSi(
      textoUsuario
    )
  ) {
    return (
      "Responde sí para guardar la regla o no para cancelar."
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
    "Listo. La nueva regla de ahorro quedó guardada."
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
    return (
      "Para crear la meta necesito saber qué quieres ahorrar, cuánto quieres juntar y para qué fecha."
    );
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

  return (
    "Voy a crear esta meta:\n\n" +
    `Meta: ${datos.Meta}\n` +
    `Objetivo: ${formatearDinero(
      datos[
        "Monto objetivo"
      ]
    )}\n` +
    `Fecha: ${
      datos[
        "Fecha objetivo"
      ]
    }\n\n` +
    "¿Está correcto? Responde sí o no."
  );
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
      "Responde sí para crear la meta o no para cancelar."
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
    `Listo. Creé la meta con ID ${resultado.id}.`
  );
}

function formatearMetas(
  metas
) {
  if (
    !metas ||
    metas.length ===
      0
  ) {
    return (
      "Todavía no tienes metas de ahorro."
    );
  }

  return metas
    .map(
      meta => {
        return [
          `🎯 ${meta.Meta}`,
          `Meta: ${formatearDinero(
            meta[
              "Monto objetivo"
            ]
          )}`,
          `Llevas: ${formatearDinero(
            meta[
              "Ahorro acumulado"
            ]
          )}`,
          `Avance: ${
            meta[
              "Avance %"
            ]
          }%`,
          `Falta: ${formatearDinero(
            meta.Falta
          )}`,
          `Fecha objetivo: ${
            meta[
              "Fecha objetivo"
            ] ||
            "Sin fecha"
          }`
        ].join("\n");
      }
    )
    .join("\n\n");
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
      `No encontré compras de "${resultado.producto}" ` +
      `en los últimos ${resultado.meses} meses.`
    );
  }

  const lineas =
    registros.map(
      r => {
        let texto =
          `${r[
            "Fecha de compra"
          ]} — ` +
          `${r.Tienda ||
            "Tienda no indicada"} — ` +
          `${formatearDinero(
            r.Monto
          )}`;

        if (
          !estaVacio(
            r[
              "Precio por unidad"
            ]
          )
        ) {
          texto +=
            ` — ${formatearDinero(
              r[
                "Precio por unidad"
              ]
            )} por ${
              r.Unidad ||
              "unidad"
            }`;
        }

        return texto;
      }
    );

  return (
    `Historial de ${resultado.producto} ` +
    `— últimos ${resultado.meses} meses:\n\n` +
    lineas.join("\n")
  );
}

function formatearReporte(
  reporte
) {
  return [
    `📊 Reporte — ${reporte.Mes}`,
    "",
    `Ingresos: ${formatearDinero(
      reporte[
        "Total de ingresos"
      ]
    )}`,
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
    `Saldo: ${formatearDinero(
      reporte[
        "Saldo final"
      ]
    )}`,
    `Pagos pendientes: ${formatearDinero(
      reporte[
        "Pagos pendientes"
      ]
    )}`,
    `Ahorro realizado: ${formatearDinero(
      reporte[
        "Ahorro realizado"
      ]
    )}`,
    `Dinero libre: ${formatearDinero(
      reporte[
        "Dinero libre"
      ]
    )}`
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
      `No encontré información para ${mes}.`
    );
  }

  let texto =
    reportes
      .map(
        formatearReporte
      )
      .join("\n\n");

  if (
    quiereGrafica
  ) {
    texto +=
      "\n\nLa información visual se generará con estos mismos datos. " +
      "Si la gráfica no está disponible, este resumen siempre seguirá funcionando.";
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
      `No encontré ningún registro que coincida con "${buscar}" en ${tituloHoja(
        sheet
      )}.`
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

    return (
      "Encontré este registro:\n\n" +
      formatearRegistro(
        sheet,
        seleccion.data
      ) +
      "\n\n¿Quieres eliminarlo? Responde sí o no."
    );
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
          `${indice + 1}.\n` +
          formatearRegistro(
            sheet,
            item.data
          )
      )
      .join(
        "\n\n"
      );

  return (
    `Encontré ${coincidencias.length} registros:\n\n` +
    lista +
    "\n\n¿Cuál quieres eliminar? Responde con el número."
  );
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
        `Dime el número del registro que quieres eliminar, ` +
        `del 1 al ${sesion.coincidencias.length}.`
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

    return (
      "Voy a eliminar este registro:\n\n" +
      formatearRegistro(
        sesion.sheet,
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
      "Listo. Marqué como eliminado este registro:\n\n" +
      formatearRegistro(
        sesion.sheet,
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
            !estaVacio(
              item.Producto
            ) &&
            !estaVacio(
              item.Monto
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
      registros.length ===
      0
    ) {
      return (
        "Pude ver el ticket, pero no pude leer con suficiente seguridad los productos y sus precios. " +
        "Puedes mandarme una foto más clara o dictarme los datos."
      );
    }

    if (
      registros.some(
        r =>
          estaVacio(
            r[
              "Fecha de compra"
            ]
          )
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_fecha",

          registros
        }
      );

      return (
        `Pude leer ${registros.length} producto(s), pero no alcanzo a ver bien la fecha.\n` +
        "¿Qué fecha le pongo?"
      );
    }

    if (
      registros.some(
        r =>
          estaVacio(
            r.Tienda
          )
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_tienda",

          registros
        }
      );

      return (
        `Pude leer ${registros.length} producto(s), pero no alcanzo a identificar bien la tienda.\n` +
        "¿En qué tienda fue?"
      );
    }

    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_confirmacion",

        registros
      }
    );

    return (
      "Del ticket voy a registrar esto:\n\n" +
      resumenTicketSuper(
        registros
      ) +
      "\n\n¿Está correcto? Responde sí o no."
    );
  }

  return (
    `No pude identificar con seguridad si la imagen es un ticket del súper o un recibo de pago.` +
    `${
      analisis.descripcion
        ? `\n\nAlcancé a ver: ${analisis.descripcion}`
        : ""
    }\n\n` +
    "Dime si quieres registrarlo en Súper o en Pagos."
  );
}

function valorTicket(valor, tipo = "texto") {
  if (estaVacio(valor)) return "—";
  if (tipo === "dinero") return formatearDinero(valor);
  return String(valor);
}

function resumenTicketSuper(registros) {
  if (!Array.isArray(registros) || registros.length === 0) {
    return "No hay productos para mostrar.";
  }

  const primero = registros[0] || {};

  const cabecera = [
    `Fecha de compra: ${valorTicket(primero["Fecha de compra"])}`,
    `Tienda: ${valorTicket(primero.Tienda)}`
  ].join("\n");

  const productos = registros
    .map((r, i) =>
      [
        `Producto ${i + 1}`,
        `Producto: ${valorTicket(r.Producto)}`,
        `Producto base: ${valorTicket(r["Producto base"])}`,
        `Categoría: ${valorTicket(r.Categoría)}`,
        `Monto total: ${valorTicket(r.Monto, "dinero")}`,
        `Cantidad comprada: ${valorTicket(r.Cantidad)}`,
        `Unidad de compra: ${valorTicket(r.Unidad)}`,
        `Contenido por empaque: ${valorTicket(r["Contenido por empaque"])}`,
        `Unidad de comparación: ${valorTicket(r["Unidad de comparación"])}`,
        `Precio por unidad de comparación: ${
          estaVacio(r["Precio por unidad"])
            ? "—"
            : formatearDinero(r["Precio por unidad"])
        }`
      ].join("\n")
    )
    .join("\n\n");

  return `${cabecera}\n\n${productos}`;
}

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

function camposConDatosTicket(registros) {
  return CAMPOS_CORRECCION_TICKET.filter(campo =>
    registros.some(r => !estaVacio(r[campo]))
  );
}

function menuCorreccionTicket() {
  return [
    "¿Qué quieres corregir?",
    "",
    "1. Fecha de compra",
    "2. Producto",
    "3. Producto base",
    "4. Categoría",
    "5. Precio / Monto",
    "6. Tienda",
    "7. Cantidad",
    "8. Unidad",
    "9. Contenido por empaque",
    "10. Unidad de comparación",
    "11. Precio por unidad",
    "",
    "Puedes responder, por ejemplo:",
    '• "2 y 4"',
    '• "producto y categoría"',
    '• "contenido por empaque y unidad de comparación"',
    '• "solo precio y tienda están bien"',
    '• "cancelar"'
  ].join("\n");
}

function detectarCamposTicket(texto) {
  const t = normalizar(texto);

  if (
    t.includes("cancelar") ||
    t.includes("cancela")
  ) {
    return {
      accion: "cancelar",
      campos: []
    };
  }

  if (
    t.includes("todo bien") ||
    t.includes("ya esta bien")
  ) {
    return {
      accion: "confirmar",
      campos: []
    };
  }

  const campos = new Set();

  const numeroACampo = {
    1: "Fecha de compra",
    2: "Producto",
    3: "Producto base",
    4: "Categoría",
    5: "Monto",
    6: "Tienda",
    7: "Cantidad",
    8: "Unidad",
    9: "Contenido por empaque",
    10: "Unidad de comparación",
    11: "Precio por unidad"
  };

  const numeros =
    t.match(/\b(?:10|11|[1-9])\b/g) || [];

  numeros.forEach(n => {
    const campo =
      numeroACampo[Number(n)];

    if (campo) {
      campos.add(campo);
    }
  });

  if (t.includes("fecha")) {
    campos.add("Fecha de compra");
  }

  if (
    t.includes("producto base") ||
    t.includes("nombre base")
  ) {
    campos.add("Producto base");
  }

  const sinProductoBase = t
    .replace(/producto base/g, "")
    .replace(/nombre base/g, "");

  if (
    sinProductoBase.includes("producto")
  ) {
    campos.add("Producto");
  }

  if (t.includes("categoria")) {
    campos.add("Categoría");
  }

  if (t.includes("tienda")) {
    campos.add("Tienda");
  }

  if (t.includes("cantidad")) {
    campos.add("Cantidad");
  }

  const mencionaContenidoEmpaque =
    t.includes("contenido por empaque") ||
    t.includes("contenido del empaque") ||
    t.includes("contenido empaque");

  if (mencionaContenidoEmpaque) {
    campos.add(
      "Contenido por empaque"
    );
  }

  const mencionaUnidadComparacion =
    t.includes("unidad de comparacion") ||
    t.includes("unidad comparacion");

  if (mencionaUnidadComparacion) {
    campos.add(
      "Unidad de comparación"
    );
  }

  const mencionaPrecioUnidad =
    t.includes("precio por unidad") ||
    t.includes("precio unitario") ||
    t.includes("unitario");

  if (mencionaPrecioUnidad) {
    campos.add(
      "Precio por unidad"
    );
  }

  if (
    t.includes("monto") ||
    t.includes("precio total") ||
    (
      t.includes("precio") &&
      !mencionaPrecioUnidad
    )
  ) {
    campos.add("Monto");
  }

  if (
    t.includes("unidad") &&
    !mencionaPrecioUnidad &&
    !mencionaUnidadComparacion
  ) {
    campos.add("Unidad");
  }

  const hablaDeCorrectos =
    t.includes("estan bien") ||
    t.includes("esta bien") ||
    t.includes("correctos") ||
    t.includes("correcto");

  return {
    accion:
      hablaDeCorrectos
        ? "correctos"
        : "corregir",

    campos:
      [...campos].filter(Boolean)
  };
}

  

function etiquetaCampoTicket(campo) {
  if (campo === "Monto") {
    return "Precio / Monto";
  }

  return campo;
}

function preguntaCorreccionCampo(
  campo,
  registros
) {
  if (campo === "Fecha de compra") {
    return (
      "¿Cuál es la fecha correcta de la compra?\n" +
      'Ejemplos: "hoy", "ayer" o "16/08/2026".'
    );
  }

  if (campo === "Tienda") {
    return (
      `Tienda actual: ${
        valorTicket(
          registros[0]?.Tienda
        )
      }\n` +
      "¿Cuál es la tienda correcta?\n" +
      "Ejemplos: Walmart, Costco, Soriana, Chedraui o Farmacia Guadalajara."
    );
  }

  const actuales =
    registros
      .map(
        (r, i) =>
          `${i + 1}. ${
            valorTicket(
              r[campo],
              campo === "Monto" ||
              campo === "Precio por unidad"
                ? "dinero"
                : "texto"
            )
          }`
      )
      .join("\n");

  let explicacion = "";

  if (campo === "Producto") {
    explicacion =
      "Producto es el artículo específico, con marca o presentación.\n" +
      "Ejemplos: Coca-Cola Zero 600 ml, Galletas Marías Gamesa, Papel Higiénico Regio 12 rollos.";
  }

  if (campo === "Producto base") {
    explicacion =
      "Producto base es el artículo general, sin marca ni presentación, para comparar compras después.\n" +
      "Ejemplos: refresco, galletas, papel higiénico, leche, agua mineral.";
  }

  if (campo === "Categoría") {
    explicacion =
      "Categoría es el grupo general del gasto.\n" +
      "Ejemplos: bebidas, higiene, limpieza, despensa, lácteos, farmacia.";
  }

  if (campo === "Monto") {
    explicacion =
      "Monto es el total pagado por ese producto o renglón del ticket.\n" +
      'Ejemplo: "120 pesos".';
  }

  if (campo === "Cantidad") {
    explicacion =
      "Cantidad es cuántos empaques o productos completos compraste.\n" +
      "No cuentes aquí las piezas que vienen dentro del empaque.\n" +
      'Ejemplo: 1 paquete de 12 rollos → responde "1".';
  }

  if (campo === "Unidad") {
    explicacion =
      "Unidad es el tipo de empaque o presentación que compraste.\n" +
      "Ejemplos: paquete, caja, bolsa, botella, lata, pieza.";
  }

  if (campo === "Contenido por empaque") {
    explicacion =
      "Contenido por empaque indica cuánto trae CADA empaque, expresado en la unidad que usarás para comparar.\n" +
      "Ejemplos:\n" +
      "• Paquete de 12 rollos → 12\n" +
      "• Caja de 24 latas → 24\n" +
      "• Botella de 600 ml comparada por litro → 0.6\n" +
      "• Bolsa de 750 g comparada por kilogramo → 0.75";
  }

  if (campo === "Unidad de comparación") {
    explicacion =
      "Unidad de comparación es la medida práctica con la que quieres comparar precios.\n" +
      "Ejemplos: rollo, litro, kilogramo, pieza o lata.\n" +
      "Papel higiénico → rollo; leche → litro; arroz → kilogramo.";
  }

  if (campo === "Precio por unidad") {
    explicacion =
      "Precio por unidad es el costo por la unidad de comparación.\n" +
      "Normalmente el sistema lo calcula automáticamente.\n" +
      "Ejemplo: 1 paquete de 12 rollos por $120 → $10 por rollo.";
  }

  if (registros.length === 1) {
    return [
      `${etiquetaCampoTicket(campo)} actual: ${
        valorTicket(
          registros[0]?.[campo],
          campo === "Monto" ||
          campo === "Precio por unidad"
            ? "dinero"
            : "texto"
        )
      }`,
      "",
      explicacion,
      "",
      "¿Cuál debe ser?"
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Vamos a corregir: ${etiquetaCampoTicket(campo)}`,
    "",
    explicacion,
    "",
    "Valores actuales:",
    actuales,
    "",
    "Escribe los valores correctos, uno por línea y en el mismo orden.",
    'Si alguno debe quedarse igual, escribe "igual".'
  ]
    .filter(Boolean)
    .join("\n");
}

function extraerListaCorreccion(
  texto,
  cantidad
) {
  let valores =
    String(texto || "")
      .split(/\n|;/)
      .map(v => v.trim())
      .filter(Boolean)
      .map(v =>
        v
          .replace(
            /^\s*\d+\s*[.\)\-:]\s*/,
            ""
          )
          .trim()
      );

  if (
    cantidad > 1 &&
    valores.length === 1
  ) {
    const numerados =
      String(texto || "")
        .split(
          /(?=\b\d+\s*[.\)\-:]\s*)/
        )
        .map(v => v.trim())
        .filter(Boolean)
        .map(v =>
          v
            .replace(
              /^\s*\d+\s*[.\)\-:]\s*/,
              ""
            )
            .trim()
        );

    if (numerados.length > 1) {
      valores = numerados;
    }
  }

  return valores;
}

function numeroTicketSeguro(texto) {
  let s =
    String(texto || "")
      .trim()
      .replace(/\s/g, "");

  if (!s) return null;

  s =
    s.replace(/\$/g, "");

  if (
    s.includes(",") &&
    s.includes(".")
  ) {
    s =
      s.replace(/,/g, "");

  } else if (s.includes(",")) {
    const partes =
      s.split(",");

    if (
      partes.length === 2 &&
      partes[1].length <= 2
    ) {
      s =
        `${partes[0]}.${partes[1]}`;

    } else {
      s =
        s.replace(/,/g, "");
    }
  }

  const m =
    s.match(
      /-?\d+(?:\.\d+)?/
    );

  if (!m) return null;

  const n =
    Number(m[0]);

  return Number.isFinite(n)
    ? n
    : null;
}

function siguienteCorreccionTicket(
  remitente,
  registros,
  camposPendientes
) {
  if (!camposPendientes.length) {
    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_confirmacion",

        registros
      }
    );

    return (
      "Así quedaría el ticket:\n\n" +
      resumenTicketSuper(
        registros
      ) +
      "\n\n¿Está correcto? Responde sí o no."
    );
  }

  const [
    campoActual,
    ...restantes
  ] =
    camposPendientes;

  guardarSesion(
    remitente,
    {
      tipo:
        "ticket_super_corrigiendo",

      registros,

      campoActual,

      camposPendientes:
        restantes
    }
  );

  return preguntaCorreccionCampo(
    campoActual,
    registros
  );
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

    const f =
      interpretacion.data?.[
        "Fecha de compra"
      ];

    if (estaVacio(f)) {
      throw new Error(
        "No pude interpretar esa fecha."
      );
    }

    nuevos.forEach(
      r =>
        r[
          "Fecha de compra"
        ] = f
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
      r =>
        r.Tienda =
          tienda
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

  const numerico =
    [
      "Monto",
      "Cantidad",
      "Contenido por empaque",
      "Precio por unidad"
    ].includes(
      campo
    );

  nuevos.forEach(
    (r, i) => {
      const valor =
        valores[
          nuevos.length === 1
            ? 0
            : i
        ];

      const nv =
        normalizar(
          valor
        );

      if (
        [
          "igual",
          "dejar igual",
          "sin cambio"
        ].includes(nv)
      ) {
        return;
      }

      if (numerico) {
        const n =
          numeroTicketSeguro(
            valor
          );

        if (n === null) {
          throw new Error(
            `No pude interpretar el valor ${i + 1} como número.`
          );
        }

        r[campo] =
          n;

      } else {
        r[campo] =
          String(
            valor || ""
          ).trim();
      }

      if (
        [
          "Monto",
          "Cantidad",
          "Contenido por empaque"
        ].includes(campo)
      ) {
        const monto =
          valorNumero(
            r.Monto
          );

        const cantidad =
          valorNumero(
            r.Cantidad
          );

        const contenido =
          valorNumero(
            r[
              "Contenido por empaque"
            ]
          );

        if (
          monto > 0 &&
          cantidad > 0 &&
          contenido > 0
        ) {
          r[
            "Precio por unidad"
          ] =
            Math.round(
              (
                monto /
                (
                  cantidad *
                  contenido
                )
              ) *
              100
            ) /
            100;

        } else {
          r[
            "Precio por unidad"
          ] = "";
        }
      }
    }
  );

  return nuevos;
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
        analisis.data || {},
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
            !estaVacio(
              item.Producto
            ) &&
            !estaVacio(
              item.Monto
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
      registros.length === 0
    ) {
      return (
        "Pude ver el ticket, pero no pude leer con suficiente seguridad los productos y sus precios. " +
        "Puedes mandarme una foto más clara o dictarme los datos."
      );
    }

    if (
      registros.some(
        r =>
          estaVacio(
            r[
              "Fecha de compra"
            ]
          )
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_fecha",

          registros
        }
      );

      return (
        `Pude leer ${registros.length} producto(s), pero no alcanzo a ver bien la fecha.\n` +
        "¿Qué fecha le pongo?"
      );
    }

    if (
      registros.some(
        r =>
          estaVacio(
            r.Tienda
          )
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_tienda",

          registros
        }
      );

      return (
        `Pude leer ${registros.length} producto(s), pero no alcanzo a identificar bien la tienda.\n` +
        "¿En qué tienda fue?"
      );
    }
const camposFaltantes =
  CAMPOS_REQUERIDOS.Super.filter(
    campo =>
      registros.some(
        r =>
          estaVacio(
            r[campo]
          )
      )
  );

if (
  camposFaltantes.length
) {
  return siguienteCorreccionTicket(
    remitente,
    registros,
    camposFaltantes
  );
}
    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_confirmacion",

        registros
      }
    );

    return (
      "Del ticket voy a registrar esto:\n\n" +
      resumenTicketSuper(
        registros
      ) +
      "\n\n¿Está correcto? Responde sí o no."
    );
  }

  return (
    "No pude identificar con seguridad si la imagen es un ticket del súper o un recibo de pago." +
    (
      analisis.descripcion
        ? `\n\nAlcancé a ver: ${analisis.descripcion}`
        : ""
    ) +
    "\n\nDime si quieres registrarlo en Súper o en Pagos."
  );
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
    "ticket_super_fecha"
  ) {
    const interpretacion =
      await interpretarConGemini(
        `La fecha es ${textoUsuario}`,
        {
          sheet:
            "Super",

          data:
            sesion.registros[0]
        }
      );

    const f =
      interpretacion.data?.[
        "Fecha de compra"
      ];

    if (
      estaVacio(f)
    ) {
      return (
        'No pude interpretar esa fecha. Dímela otra vez, por ejemplo: "hoy" o "16/08/2026".'
      );
    }

    const registros =
      sesion.registros.map(
        r => ({
          ...r,

          "Fecha de compra":
            f
        })
      );

    if (
      registros.some(
        r =>
          estaVacio(
            r.Tienda
          )
      )
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_tienda",

          registros
        }
      );

      return (
        "Perfecto. ¿En qué tienda fue la compra?"
      );
    }
const camposFaltantes =
  CAMPOS_REQUERIDOS.Super.filter(
    campo =>
      registros.some(
        r =>
          estaVacio(
            r[campo]
          )
      )
  );

if (camposFaltantes.length) {
  return siguienteCorreccionTicket(
    remitente,
    registros,
    camposFaltantes
  );
}
    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_confirmacion",

        registros
      }
    );

    return (
      "Del ticket voy a registrar esto:\n\n" +
      resumenTicketSuper(
        registros
      ) +
      "\n\n¿Está correcto? Responde sí o no."
    );
  }

  if (
    sesion.tipo ===
    "ticket_super_tienda"
  ) {
    const tienda =
      String(
        textoUsuario ||
        ""
      ).trim();

    if (!tienda) {
      return (
        "Dime el nombre de la tienda."
      );
    }

    const registros =
      sesion.registros.map(
        r => ({
          ...r,

          Tienda:
            tienda
        })
      );
const camposFaltantes =
  CAMPOS_REQUERIDOS.Super.filter(
    campo =>
      registros.some(
        r =>
          estaVacio(
            r[campo]
          )
      )
  );

if (camposFaltantes.length) {
  return siguienteCorreccionTicket(
    remitente,
    registros,
    camposFaltantes
  );
}
    guardarSesion(
      remitente,
      {
        tipo:
          "ticket_super_confirmacion",

        registros
      }
    );

    return (
      "Del ticket voy a registrar esto:\n\n" +
      resumenTicketSuper(
        registros
      ) +
      "\n\n¿Está correcto? Responde sí o no."
    );
  }

  if (
    sesion.tipo ===
    "ticket_super_confirmacion"
  ) {
    if (
      respuestaSi(
        textoUsuario
      )
    ) {
      const ids = [];

      for (
        const registro
        of sesion.registros
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

      return (
        `Listo. Guardé ${ids.length} producto(s) del ticket.\n` +
        `IDs: ${ids.join(", ")}`
      );
    }

    if (
      respuestaNo(
        textoUsuario
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

      return (
        menuCorreccionTicket()
      );
    }

    return (
      "Responde sí si todo está correcto o no si quieres corregir algo."
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
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_confirmacion",

          registros:
            sesion.registros
        }
      );

      return (
        "Perfecto. Revisa una última vez:\n\n" +
        resumenTicketSuper(
          sesion.registros
        ) +
        "\n\n¿Está correcto? Responde sí o no."
      );
    }

    if (
      !seleccion.campos.length
    ) {
      return (
        menuCorreccionTicket()
      );
    }

    let campos;

    if (
      seleccion.accion ===
      "correctos"
    ) {
      const disponibles =
        camposConDatosTicket(
          sesion.registros
        );

      campos =
        disponibles.filter(
          c =>
            !seleccion.campos.includes(
              c
            )
        );

    } else {
      campos =
        seleccion.campos;
    }

    campos =
      CAMPOS_CORRECCION_TICKET
        .filter(
          c =>
            campos.includes(
              c
            )
        );

    if (
      !campos.length
    ) {
      guardarSesion(
        remitente,
        {
          tipo:
            "ticket_super_confirmacion",

          registros:
            sesion.registros
        }
      );

      return (
        "Entonces no tengo nada más que corregir. Revisa una última vez:\n\n" +
        resumenTicketSuper(
          sesion.registros
        ) +
        "\n\n¿Está correcto? Responde sí o no."
      );
    }

    return siguienteCorreccionTicket(
      remitente,
      sesion.registros,
      campos
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
      return (
        `${error.message}\n\n` +
        preguntaCorreccionCampo(
          sesion.campoActual,
          sesion.registros
        )
      );
    }

    return siguienteCorreccionTicket(
      remitente,
      registros,
      sesion.camposPendientes ||
        []
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

  return (
    `🎙️ Entendí: "${transcripcion}"\n\n` +
    respuesta
  );
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
      "Recibí tu mensaje, pero Gemini alcanzó temporalmente su límite de uso. " +
      "No guardé ni cambié nada. Puedes intentar de nuevo más tarde."
    );
  }

  if (
    status === 401 ||
    status === 403
  ) {
    return (
      "Recibí tu mensaje, pero la conexión con Gemini necesita revisión. " +
      "No guardé ni cambié nada."
    );
  }

  return (
    "Recibí tu mensaje, pero la IA no pudo procesarlo en este momento. " +
    "No guardé ni cambié nada."
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
      sesion.tipo ===
        "eliminar_seleccion" ||
      sesion.tipo ===
        "eliminar_confirmacion"
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
  if (
    !WHATSAPP_TOKEN ||
    !WABA_ID
  ) {
    console.log(
      "No se intentó suscribir WhatsApp porque falta token o WABA_ID."
    );

    return;
  }

  try {
    const respuesta =
      await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/subscribed_apps?subscribed_fields=messages`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${WHATSAPP_TOKEN}`,

            "Content-Type":
              "application/json"
          }
        }
      );

    const datos =
      await respuesta
        .json()
        .catch(
          () => ({})
        );

    console.log(
      "Suscripción WhatsApp:",
      datos
    );

    if (
      !respuesta.ok
    ) {
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
    String(numero)
      .replace(
        /\D/g,
        ""
      );

  /*
    Algunos números mexicanos
    pueden llegar como 521...
    Los normalizamos a 52...
  */
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
      mensaje.text.body
        .trim();

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

      const status =
        Number(
          error?.status ||
          0
        );

      if (
        status === 429
      ) {
        return (
          "Recibí la foto, pero Gemini alcanzó temporalmente su límite gratuito. " +
          "No guardé nada. Puedes intentarlo después o decirme los datos manualmente."
        );
      }

      return (
        "Recibí la foto, pero no pude leerla correctamente. " +
        "No guardé nada. Puedes intentar con otra foto o dictarme los datos."
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

      const status =
        Number(
          error?.status ||
          0
        );

      if (
        status === 429
      ) {
        return (
          "Recibí tu audio, pero Gemini alcanzó temporalmente su límite gratuito. " +
          "No guardé nada. Puedes escribirme el mensaje o intentarlo después."
        );
      }

      return (
        "Recibí tu audio, pero no pude entenderlo correctamente. " +
        "No guardé nada. Puedes intentar otra vez o escribirme el mensaje."
      );
    }
  }

  return (
    "Por ahora puedo recibir texto, fotos de tickets o recibos y mensajes de voz."
  );
}

async function manejarWebhook(
  payload
) {
  const value =
    payload
      ?.entry?.[0]
      ?.changes?.[0]
      ?.value;

  const mensajes =
    value?.messages;

  if (
    !Array.isArray(
      mensajes
    ) ||
    mensajes.length ===
      0
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

    if (
      !remitente
    ) {
      console.log(
        "Mensaje sin remitente."
      );

      continue;
    }

    try {
      const respuesta =
        await procesarMensajeWhatsApp(
          mensaje,
          remitente
        );

      if (
        respuesta
      ) {
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
          "Recibí tu mensaje, pero ocurrió un problema. No guardé ni cambié nada. Inténtalo nuevamente."
        );

      } catch (
        errorEnvio
      ) {
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

      /*
        Página principal.
        Sirve también para comprobar
        que Render está vivo.
      */
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

      /*
        Health check.
      */
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
            ok:
              true,

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

      /*
        Política de privacidad.
      */
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

        return res.end(`
          <!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Política de privacidad - Finanzas IA</title>
          </head>
          <body>
            <h1>Política de privacidad</h1>
            <p>
              Finanzas IA es una aplicación de uso personal.
            </p>
            <p>
              Procesa únicamente la información necesaria
              para registrar y consultar información financiera
              enviada por el usuario.
            </p>
            <p>
              La aplicación puede procesar mensajes de texto,
              imágenes y audios enviados voluntariamente
              mediante WhatsApp.
            </p>
            <p>
              No vendemos información personal.
            </p>
            <p>
              Los datos financieros se almacenan en
              una hoja privada de Google Sheets
              controlada por el propietario de la aplicación.
            </p>
            <p>
              Contacto: zurita-17@hotmail.com
            </p>
          </body>
          </html>
        `);
      }

      /*
        Verificación inicial
        del webhook de Meta.
      */
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
          console.log(
            "Webhook verificado correctamente."
          );

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

      /*
        Recepción de mensajes
        desde WhatsApp.
      */
      if (
        req.method ===
          "POST" &&
        url.pathname ===
          "/webhook"
      ) {
        let body =
          "";

        req.on(
          "data",
          chunk => {
            body +=
              chunk;

            /*
              Evita recibir cuerpos
              exageradamente grandes.
            */
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

            /*
              Meta necesita recibir
              respuesta rápidamente.

              Confirmamos primero
              y procesamos después.
            */
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

            console.log(
              "Webhook recibido:",
              JSON.stringify(
                payload
              )
            );

            manejarWebhook(
              payload
            ).catch(
              error => {
                console.error(
                  "Error general del webhook:",
                  error
                );
              }
            );
          }
        );

        return;
      }

      /*
        Cualquier otra ruta.
      */
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

    } catch {
      // Nada adicional.
    }
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

    } else {
      console.log(
        "WHATSAPP_TOKEN detectado."
      );
    }

    if (
      !GEMINI_API_KEY
    ) {
      console.error(
        "Falta GEMINI_API_KEY."
      );

    } else {
      console.log(
        "GEMINI_API_KEY detectada."
      );
    }

    if (
      !APPS_SCRIPT_URL
    ) {
      console.error(
        "Falta APPS_SCRIPT_URL."
      );

    } else {
      console.log(
        "APPS_SCRIPT_URL detectada."
      );
    }

    if (
      !APPS_SCRIPT_SECRET
    ) {
      console.error(
        "Falta APPS_SCRIPT_SECRET."
      );

    } else {
      console.log(
        "APPS_SCRIPT_SECRET detectado."
      );
    }

    if (
      !VERIFY_TOKEN
    ) {
      console.error(
        "Falta VERIFY_TOKEN."
      );
    }

    /*
      Intentamos mantener
      la aplicación suscrita
      a los mensajes de WhatsApp.
    */
    if (
      WHATSAPP_TOKEN
    ) {
      suscribirWhatsApp();
    }
  }
);
