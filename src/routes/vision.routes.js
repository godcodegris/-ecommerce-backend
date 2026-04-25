import express from "express";
import multer from "multer";


const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máx
});

const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const DEBUG_ENDPOINTS_ENABLED = process.env.NODE_ENV !== "production";

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
    "approx_width_cm": número estimado de ancho en centímetros | null,
    "approx_depth_cm": número estimado de profundidad en centímetros | null,
    "is_exclusive": true | false,
    "exclusive_store": "tienda de exclusividad si aplica (ej: Pop In A Box, GameStop)" | null,
    "year": "año de lanzamiento si visible" | null,
    "estimated_category": "categoría aproximada (ej: figura_accion, funko_pop, card_tcg, comic, figura_articulada, vintage)",
    "is_articulated": true | false | null,
    "is_bobblehead": true | false,
    "has_remote_control": true | false,
    "has_lights": true | false | null,
    "has_interchangeable_parts": true | false | null,
    "includes_accessories": true | false,
    "is_collectible": true,
    "scale": "escala si visible en caja (ej: 1:6, 1:12)" | null,
    "play_type": "tipo de juego/uso (ej: Coleccionable, Acción, Decorativo)" | null,
    "power_type": "tipo de alimentación si aplica (ej: Pilas, No requiere)" | null,
    "recommended_age": número entero de edad mínima recomendada en años | null
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
- "is_collectible": siempre true (estás analizando coleccionables).
- "is_bobblehead": true solo si la cabeza es desproporcionadamente grande respecto al cuerpo Y se ve que oscila/está montada en resorte (típico de Funko Pop, McFarlane Sportspicks).
- "is_articulated": true si ves articulaciones en hombros/codos/rodillas/cintura. false si es claramente estática (Funko Pop estándar, estatua). null si no podés determinarlo.
- "has_remote_control": true solo si ves un control remoto en la foto o en la caja como accesorio.
- "has_lights" y "power_type": null a menos que sea OBVIO (ej: lightsaber con LED visible, robot con pantalla).
- "includes_accessories": true si ves armas, capas, bases, manos extra, o cualquier ítem adicional al personaje.
- "scale": null a menos que veas claramente "1:6", "1:12", "1/6" en la caja o el producto.
- "approx_width_cm" y "approx_depth_cm": estimación basada en proporciones típicas. Si solo ves la figura de frente, profundidad ≈ ancho/2.
- "recommended_age": 14+ para coleccionables detallados (Funko Pop, McFarlane), 4+ para juguetes robustos. null si no estás seguro.

IMPORTANTE: Devolvé SOLO el JSON, sin backticks, sin "aquí tienes:", sin explicaciones adicionales.`;

/**
 * Función reutilizable: recibe un Buffer de imagen y su mime type,
 * devuelve el JSON parseado de Vision.
 * Usada por el endpoint /analyze Y por el orquestador /api/publish/create.
 */
export const analyzeImageWithVision = async (imageBuffer, mimeType) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY no configurada");
  }

  const base64Image = imageBuffer.toString("base64");

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
                media_type: mimeType,
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
    throw new Error(`Claude API: ${data.error?.message || "error desconocido"}`);
  }

  const responseText = data.content?.[0]?.text || "";
  console.log("[analyzeImageWithVision] Respuesta raw:", responseText.substring(0, 200));

  const cleanText = responseText.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleanText);
  } catch (parseErr) {
    throw new Error(`Claude devolvió formato inválido: ${responseText.substring(0, 200)}`);
  }
};

// Endpoint HTTP (ahora es un wrapper simple sobre la función pura) — UNA SOLA foto
router.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió imagen (campo 'image' requerido)" });
    }
    const result = await analyzeImageWithVision(req.file.buffer, req.file.mimetype);
    return res.json(result);
  } catch (error) {
    console.error("[vision/analyze] Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ===== Orquestador end-to-end: 3 fotos -> Vision -> publicar en ML + DB =====
router.post("/create", upload.array("images", 3), async (req, res) => {
  let publicacionId = null;

  // Imports dinámicos (mantengo tu patrón existente)
  const mlService = await import("../services/mercadolibre.service.js");
  const pool = (await import("../db.js")).default;

  try {
    // 1. Validar entrada
    if (!req.files || req.files.length !== 3) {
      return res.status(400).json({
        error: `Se requieren exactamente 3 imágenes (campo 'images'). Recibidas: ${req.files?.length || 0}`,
      });
    }
    const images = req.files.map(f => ({ buffer: f.buffer, mimeType: f.mimetype }));
    const primaryImage = images[0]; // la primera es la "hero" — solo esta va a Vision

    const price = parseFloat(req.body.price);
    if (!price || price <= 0) {
      return res.status(400).json({ error: "price es requerido y debe ser > 0" });
    }

    const stock = parseInt(req.body.stock) || 1;

    // 2. INSERT inicial — garantiza trazabilidad ante cualquier fallo
    const insertResult = await pool.query(
      `INSERT INTO publicaciones_masivas (price, status, created_at) 
       VALUES ($1, 'procesando', NOW()) RETURNING id`,
      [price]
    );
    publicacionId = insertResult.rows[0].id;
    console.log(`[publish/create] Registro inicial creado: id=${publicacionId}`);

    // 3. Analizar imagen con Vision (solo la primera foto)
    console.log("[publish/create] Iniciando análisis con Vision...");
    const visionResult = await analyzeImageWithVision(primaryImage.buffer, primaryImage.mimeType);
    console.log(`[publish/create] Vision detectó: "${visionResult.title}" (${visionResult.condition_detected}, ${visionResult.confidence}%)`);

    // 4. Publicar en ML — SIEMPRE como "new" por limitación de la API
    const mlResponse = await mlService.publishProductFromJSON({
      title: visionResult.title,
      price,
      stock,
      condition: "new",
      description: visionResult.description,
      pictures: [],
    }, visionResult);

    // 5. Flags de revisión
    const visionDetectedNotNew = visionResult.condition_detected !== "new";
    const lowConfidence = visionResult.confidence < 70;

    // Caso A: no se encontró match de catálogo → intentar fallback libre
    if (mlResponse.requiere_revision_manual) {
      console.log("[publish/create] Sin catálogo. Intentando fallback libre...");

      try {
        const freeListingResponse = await mlService.publishProductAsFreeListing(
          {
            title: visionResult.title,
            price,
            stock,
            condition: "new",
            description: visionResult.description,
          },
          images,
          visionResult
        );

        // Fallback libre exitoso → publicado con requiere_revision=true
        const motivoFallback = 
          `Publicación libre (sin catálogo ML). Vision confidence: ${visionResult.confidence}%. ` +
          `Revisar atributos en ML web.`;

        await pool.query(
          `UPDATE publicaciones_masivas SET 
            titulo = $1, ml_id = $2, status = $3, permalink = $4, 
            condition = $5, requiere_revision = $6, motivo_revision = $7, 
            confianza_condicion = $8, vision_result = $9
           WHERE id = $10`,
          [
            visionResult.title,
            freeListingResponse.id,
            "ok",
            freeListingResponse.permalink,
            "new",
            true,
            motivoFallback,
            visionResult.confidence,
            visionResult,
            publicacionId,
          ]
        );

        console.log(`[publish/create] ✅ Publicado vía fallback libre: ${freeListingResponse.id}`);

        return res.json({
          status: "publicado",
          id: publicacionId,
          ml_id: freeListingResponse.id,
          permalink: freeListingResponse.permalink,
          requiere_revision: true,
          motivo_revision: motivoFallback,
          publication_type: "free_listing",
          vision_result: visionResult,
        });
      } catch (fallbackError) {
        // Fallback libre también falló → queda pendiente_manual
        console.error("[publish/create] Fallback libre falló:", fallbackError.message);

        const motivoCompleto = 
          `Sin match catálogo + fallback libre falló: ${fallbackError.message}`;

        await pool.query(
          `UPDATE publicaciones_masivas SET 
            titulo = $1, status = $2, condition = $3, 
            requiere_revision = $4, motivo_revision = $5, 
            confianza_condicion = $6, vision_result = $7
           WHERE id = $8`,
          [
            visionResult.title,
            "pendiente_manual",
            "new",
            true,
            motivoCompleto,
            visionResult.confidence,
            visionResult,
            publicacionId,
          ]
        );

        return res.json({
          status: "pendiente_manual",
          id: publicacionId,
          motivo: motivoCompleto,
          vision_result: visionResult,
        });
      }
    }

    // Caso B: publicado OK
    const motivosRevision = [];
    if (visionDetectedNotNew) {
      motivosRevision.push(`Vision detectó "${visionResult.condition_detected}"`);
    }
    if (lowConfidence) {
      motivosRevision.push(`Confianza baja (${visionResult.confidence}%)`);
    }

    const requiereRevision = motivosRevision.length > 0;
    const motivoRevision = requiereRevision ? motivosRevision.join(" | ") : null;

    await pool.query(
      `UPDATE publicaciones_masivas SET 
        titulo = $1, ml_id = $2, status = $3, permalink = $4, 
        condition = $5, requiere_revision = $6, motivo_revision = $7, 
        confianza_condicion = $8, vision_result = $9
       WHERE id = $10`,
      [
        visionResult.title,
        mlResponse.id,
        "ok",
        mlResponse.permalink,
        "new",
        requiereRevision,
        motivoRevision,
        visionResult.confidence,
        visionResult,
        publicacionId,
      ]
    );

    return res.json({
      status: "publicado",
      id: publicacionId,
      ml_id: mlResponse.id,
      permalink: mlResponse.permalink,
      requiere_revision: requiereRevision,
      motivo_revision: motivoRevision,
      catalog_match: mlResponse.catalog_match_name || null,
      vision_result: visionResult,
    });
  } catch (error) {
    console.error("[publish/create] Error:", error.message);

    // Si ya habíamos creado el registro, lo marcamos como error
    if (publicacionId) {
      try {
        await pool.query(
          `UPDATE publicaciones_masivas SET status = 'error', error_msg = $1 WHERE id = $2`,
          [error.message, publicacionId]
        );
      } catch (dbError) {
        console.error("[publish/create] Error al marcar fallo en DB:", dbError.message);
      }
    }

    return res.status(500).json({ 
      error: error.message, 
      id: publicacionId 
    });
  }
});

// ===== ENDPOINTS DEBUG — solo disponibles fuera de producción =====
if (DEBUG_ENDPOINTS_ENABLED) {
  router.post("/test-upload", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No se recibió imagen" });
      }

      const mlService = await import("../services/mercadolibre.service.js");

      console.log("[test-upload] Subiendo imagen a ML...");
      const result = await mlService.uploadImageToML(
        req.file.buffer,
        req.file.mimetype
      );
      console.log(`[test-upload] picture_id recibido: ${result.id}`);

      return res.json({
        success: true,
        picture_id: result.id,
        preview_url: result.url,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
      });
    } catch (error) {
      console.error("[test-upload] Error:", error.message);
      return res.status(500).json({ error: error.message });
    }
  });

  router.get("/debug-attrs/:categoryId", async (req, res) => {
    try {
      const mlService = await import("../services/mercadolibre.service.js");
      const token = await mlService.getValidToken();

      const resp = await fetch(
        `https://api.mercadolibre.com/categories/${req.params.categoryId}/attributes`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resp.json();

      const targets = ["BRAND", "MANUFACTURER", "COLLECTION", "EMPTY_GTIN_REASON", "VALUE_ADDED_TAX", "IMPORT_DUTY", "MATERIAL", "MODEL"];
      const filtered = data
        .filter(a => targets.includes(a.id))
        .map(a => ({
          id: a.id,
          name: a.name,
          tags: a.tags,
          value_type: a.value_type,
          values: a.values?.slice(0, 10) || null,
        }));

      return res.json({ category: req.params.categoryId, attributes: filtered });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get("/debug-item/:mlId", async (req, res) => {
    try {
      const mlService = await import("../services/mercadolibre.service.js");
      const data = await mlService.debugGetItem(req.params.mlId);

      return res.json({
        ml_id: data.id,
        title: data.title,
        family_name: data.family_name,
        catalog_product_id: data.catalog_product_id,
        catalog_listing: data.catalog_listing,
        domain_id: data.domain_id,
        category_id: data.category_id,
        description_field: data.description,
        attributes_count: data.attributes?.length,
        pictures_count: data.pictures?.length,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get("/debug-description/:mlId", async (req, res) => {
    try {
      const mlService = await import("../services/mercadolibre.service.js");
      const data = await mlService.debugGetDescription(req.params.mlId);
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  console.log("[vision.routes] ⚠️  Debug endpoints habilitados (NODE_ENV != production)");
}

export default router;