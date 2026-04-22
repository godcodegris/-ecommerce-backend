import express from "express";
import multer from "multer";

const router = express.Router();

// Multer en memoria (la imagen no se guarda en disco, va directo a Claude)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máx
});

const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929"; // Sonnet para Vision

const SYSTEM_PROMPT = `Sos un experto en coleccionables (Funkos, figuras, cards, cómics, vintage) que trabaja para Thundera Store, una tienda argentina.

Tu tarea: analizar la foto de un producto y devolver un JSON con esta estructura EXACTA, sin texto adicional:

{
  "title": "título limpio y canónico, estilo MercadoLibre",
  "condition_detected": "new" | "used" | "damaged",
  "confidence": número entre 0 y 100,
  "description": "párrafo descriptivo de 3-5 oraciones, para publicación en MercadoLibre",
  "attributes": {
    "brand": "marca del producto (ej: Funko, McFarlane, Hasbro, Mattel)" | null,
    "line": "línea específica (ej: Pop!, Legacy, Marvel Legends)" | null,
    "character": "personaje representado (ej: Spider-Man, Batman, Goku)" | null,
    "collection": "colección a la que pertenece (ej: Marvel, DC, Star Wars)" | null,
    "alphanumeric_model": "número o código del coleccionable si aplica (ej: 593, MM-142)" | null,
    "material": "material principal si es evidente (ej: PVC, resina, vinilo, papel)" | null,
    "package_condition": "sealed_box | open_box | loose | no_package",
    "approx_height_cm": número estimado en centímetros | null,
    "is_exclusive": true | false,
    "exclusive_store": "tienda de exclusividad si aplica (ej: Pop In A Box, GameStop)" | null,
    "year": "año de lanzamiento si visible" | null,
    "estimated_category": "categoría aproximada (ej: figura_accion, funko_pop, card_tcg, comic, figura_articulada, vintage)"
  }
}

Reglas para el título:
- Estilo: "Funko Pop Spider-Man 593" o "Figura McFarlane Batman Who Laughs 7 Pulgadas"
- Sin adjetivos de marketing ("increíble", "hermoso", etc.)
- Si es coleccionable con número, incluilo
- Máximo 60 caracteres

Reglas para condition_detected:
- "new": caja cerrada, sin daños, producto aparentemente sin abrir
- "used": producto fuera de caja o con signos leves de uso (polvo, marcas menores)
- "damaged": daños visibles importantes (caja aplastada, figura rota, etc.)

Reglas para confidence:
- 90-100: producto claramente identificable, condición evidente
- 70-89: identificación clara pero alguna ambigüedad en detalles
- 50-69: identificación parcial o condición dudosa
- <50: foto poco clara o producto desconocido

Reglas para attributes:
- Devolvé null solo si el atributo NO es inferible de la foto. No inventes.
- "package_condition" siempre se debe poder inferir viendo la foto.
- "estimated_category" siempre se debe poder inferir.
- "is_exclusive": true solo si ves sticker/marca de exclusividad explícita.

IMPORTANTE: Devolvé SOLO el JSON, sin backticks, sin "aquí tienes:", sin explicaciones adicionales.`;

router.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió imagen (campo 'image' requerido)" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });
    }

    // Convertir la imagen a base64 para mandarla a Claude
    const base64Image = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype; // "image/jpeg", "image/png", etc.

    // Llamada a la API de Claude
    const response = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: "Analizá esta foto del producto y devolvé el JSON.",
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.type === "error") {
      console.error("[vision/analyze] Error de Claude:", data.error);
      return res.status(500).json({ error: `Claude API: ${data.error?.message || "error desconocido"}` });
    }

    // Extraer el texto de la respuesta
    const responseText = data.content?.[0]?.text || "";
    console.log("[vision/analyze] Respuesta raw:", responseText.substring(0, 300));

    // Parsear JSON (por si Claude mete backticks sin querer, los sacamos)
    const cleanText = responseText.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch (parseErr) {
      console.error("[vision/analyze] No se pudo parsear JSON:", cleanText);
      return res.status(500).json({
        error: "Claude devolvió formato inválido",
        raw: responseText,
      });
    }

    return res.json(parsed);
  } catch (error) {
    console.error("[vision/analyze] Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;