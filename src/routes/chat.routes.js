import { Router } from "express";
import fetch from "node-fetch";
import pool from "../db.js";

const router = Router();

// Primera llamada: detectar intención del usuario
const detectarIntencion = async (mensaje) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        system: `Analizá el mensaje del usuario y devolvé SOLO un JSON con este formato exacto, sin texto adicional:
{"categoria": "nombre_categoria_o_null", "busqueda": "palabra_clave_o_null"}

Las categorías disponibles son: "Figuras de Acción", "Funkos", "Comics y Revistas", "Vintage", "Cards", null.

Ejemplos:
- "tenés algo de marvel?" → {"categoria": "Figuras de Acción", "busqueda": "marvel"}
- "busco funkos de disney" → {"categoria": "Funkos", "busqueda": "disney"}
- "qué comics tienen?" → {"categoria": "Comics y Revistas", "busqueda": null}
- "algo para regalar" → {"categoria": null, "busqueda": null}
- "cuánto sale el envío?" → {"categoria": null, "busqueda": null}`,
        messages: [{ role: "user", content: mensaje }]
      })
    });

    const data = await response.json();
    const texto = data.content[0].text.trim();
    return JSON.parse(texto);
  } catch (error) {
    console.error("Error detectando intención:", error);
    return { categoria: null, busqueda: null };
  }
};

// Buscar productos relevantes en la DB
const buscarProductos = async (categoria, busqueda) => {
  try {
    if (!categoria && !busqueda) return null;

    let query;
    let params;

    if (categoria && busqueda) {
      query = `
        SELECT title, price, available_quantity, permalink 
        FROM ml_products 
        WHERE categoria = $1
        AND LOWER(title) LIKE $2
        AND available_quantity > 0
        ORDER BY price ASC
        LIMIT 8
      `;
      params = [categoria, `%${busqueda.toLowerCase()}%`];
    } else if (categoria) {
      query = `
        SELECT title, price, available_quantity, permalink 
        FROM ml_products 
        WHERE categoria = $1
        AND available_quantity > 0
        ORDER BY price ASC
        LIMIT 8
      `;
      params = [categoria];
    } else {
      query = `
        SELECT title, price, available_quantity, permalink 
        FROM ml_products 
        WHERE LOWER(title) LIKE $1
        AND available_quantity > 0
        ORDER BY price ASC
        LIMIT 8
      `;
      params = [`%${busqueda.toLowerCase()}%`];
    }

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error("Error buscando productos:", error);
    return null;
  }
};

router.post("/", async (req, res) => {
  const { mensajes } = req.body;

  if (!mensajes || !Array.isArray(mensajes)) {
    return res.status(400).json({ error: "Mensajes inválidos" });
  }

  const ultimoMensaje = mensajes[mensajes.length - 1]?.content || "";

  // Primera llamada: detectar intención
  const { categoria, busqueda } = await detectarIntencion(ultimoMensaje);
  console.log(`Intención detectada → categoría: ${categoria}, búsqueda: ${busqueda}`);

  // Buscar productos relevantes
  const productos = await buscarProductos(categoria, busqueda);
  console.log(`Productos encontrados: ${productos?.length || 0}`);

  // Armar contexto de productos
  let contextoProductos = "";
  if (productos && productos.length > 0) {
    contextoProductos = `\n\nProductos disponibles en stock${categoria ? ` (${categoria})` : ""}:\n`;
    productos.forEach(p => {
      contextoProductos += `- ${p.title} | $${Number(p.price).toLocaleString("es-AR")} | Stock: ${p.available_quantity} unidades | ${p.permalink}\n`;
    });
    contextoProductos += "\nMencioná 2 o 3 productos relevantes con su precio y link. No listes todos.";
  }

  // Segunda llamada: responder al usuario
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: `Sos el asistente virtual de Thundera Store, una tienda de coleccionables ubicada en Av. Corrientes 1372, Local 15, CABA, Argentina.

Información:
- WhatsApp: 1127435579
- Instagram: @thundera.ia
- Horario: Lunes a Sábado
- Transferencia: alias elojodethundera.mp
- MercadoPago: link.mercadopago.com.ar/thundera
- 10% de descuento comprando en el sitio web

Instrucciones:
- Respondé siempre en español
- Sé amable, breve y natural
- Si tenés productos relevantes mencioná 2 o 3 con precio y link
- Si no hay stock de lo que buscan sugerí alternativas o que consulten por WhatsApp
- No inventes productos${contextoProductos}`,
        messages: mensajes
      })
    });

    const data = await response.json();
    res.json({ respuesta: data.content[0].text });

  } catch (error) {
    console.error("Error chat:", error);
    res.status(500).json({ error: "Error al procesar el mensaje" });
  }
});

export default router;