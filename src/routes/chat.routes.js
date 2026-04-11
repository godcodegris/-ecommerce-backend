import { Router } from "express";
import fetch from "node-fetch";
import pool from "../db.js";

const router = Router();

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
        system: `Analizá el mensaje del usuario y devolvé SOLO un JSON sin backticks ni formato markdown, con este formato exacto:
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
    const limpio = texto.replace(/```json|```/g, "").trim();
    return JSON.parse(limpio);
  } catch (error) {
    console.error("Error detectando intención:", error);
    return { categoria: null, busqueda: null };
  }
};

const buscarProductos = async (categoria, busqueda) => {
  try {
    if (!categoria && !busqueda) return null;

    let query;
    let params;

    if (categoria && busqueda) {
      query = `
        SELECT id, title, price, available_quantity
        FROM ml_products 
        WHERE categoria = $1
        AND LOWER(title) LIKE $2
        AND available_quantity > 0
        ORDER BY price ASC
        LIMIT 5
      `;
      params = [categoria, `%${busqueda.toLowerCase()}%`];
    } else if (categoria) {
      query = `
        SELECT id, title, price, available_quantity
        FROM ml_products 
        WHERE categoria = $1
        AND available_quantity > 0
        ORDER BY price ASC
        LIMIT 5
      `;
      params = [categoria];
    } else {
      query = `
        SELECT id, title, price, available_quantity
        FROM ml_products 
        WHERE LOWER(title) LIKE $1
        AND available_quantity > 0
        ORDER BY price ASC
        LIMIT 5
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

  const { categoria, busqueda } = await detectarIntencion(ultimoMensaje);
  console.log(`Intención detectada → categoría: ${categoria}, búsqueda: ${busqueda}`);

  const productos = await buscarProductos(categoria, busqueda);
  console.log(`Productos encontrados: ${productos?.length || 0}`);

  let contextoProductos = "";
  if (productos && productos.length > 0) {
    contextoProductos = `\n\nProductos reales disponibles en stock${categoria ? ` (${categoria})` : ""}:\n`;
    productos.forEach(p => {
      contextoProductos += `- ${p.title} | $${Number(p.price).toLocaleString("es-AR")} | Stock: ${p.available_quantity} unidades | Ver en tienda: https://thundera.store/producto/${p.id}\n`;
    });
    contextoProductos += "\nMencioná 2 o 3 productos con su precio real y link a la tienda. NUNCA inventes productos ni precios que no estén en esta lista.";
  }

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

REGLAS IMPORTANTES:
- Respondé siempre en español
- Sé amable, breve y natural
- NUNCA inventes productos, precios ni stock
- Si tenés productos en el contexto mencioná 2 o 3 con su precio real y link
- Si no hay productos disponibles decí que no tenés en stock y sugerí contactar por WhatsApp
- Los links de productos siempre deben ser de thundera.store${contextoProductos}`,
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