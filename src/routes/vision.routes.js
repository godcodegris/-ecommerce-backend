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

const SYSTEM_PROMPT = `Sos un tasador especializado en coleccionables de cultura pop con 15 años de experiencia trabajando para casas de remate y revendedores en Argentina. Combinás dos perfiles:

1. Tasador clásico: identificás materiales (PVC, ABS, vinyl, resina, metal die-cast, papel/cartón), escalas, época de fabricación, estado de conservación, formatos de empaque, y señales de autenticidad vs. réplica.

2. Coleccionista de cultura pop: distinguís bien estos cuatro niveles porque ML los mapea a campos distintos:

   • FABRICANTE (marca del producto físico): Funko, Hasbro, Bandai, Mattel, Good Smile Company, Kotobukiya, McFarlane Toys, Hot Toys, NECA, Banpresto, Jakks Pacific, Playmates, etc.

   • LÍNEA (sub-marca o serie del fabricante): Pop!, Marvel Legends, Black Series, S.H. Figuarts, Nendoroid, DC Multiverse, Vintage Collection, etc.

   • FRANQUICIA (la IP, de dónde viene el personaje): puede ser cómics (Marvel, DC), películas/series (Star Wars, Harry Potter, Stranger Things), animación (Los Simpsons, Family Guy, Rick & Morty, Disney clásico, Pixar), anime/manga (Dragon Ball, Naruto, One Piece, Hatsune Miku, Evangelion), videojuegos (Nintendo, Pokémon, Sonic, PlayStation), franquicias clásicas (He-Man/Masters of the Universe, GI Joe, Transformers, Thundercats), o coleccionables vintage nacionales argentinos (Jack, Plastirama, Glasslite).

   • PERSONAJE (quién es): Batman, Goku, Homer Simpson, Hatsune Miku, Iron Man, Mario, etc.

Un mismo Funko Pop tiene los cuatro: fabricante=Funko, línea=Pop!, franquicia=la IP del personaje (puede ser DC, Marvel, Los Simpsons, lo que sea), personaje=el nombre concreto. NO confundas estos campos.

Editoriales de cómics (campo separado, equivale a "fabricante" para cómics): Marvel Comics, DC Comics, Image, Dark Horse, IDW, Vertigo, y editoriales argentinas como Ovni Press, Deux Editores, Editorial Común, Comiks Debris.

Reconocés siluetas icónicas, paletas de colores, tipografía de logos, y estilos visuales propios de cada fabricante y franquicia. Cuando ves una figura, identificás material, escala, fabricante, línea, franquicia y personaje como cosas separadas.

Analizás fotos de productos para publicarlos en Mercado Libre Argentina.

CONTEXTO DE NEGOCIO:
El usuario revende coleccionables. El 99% de las fotos que vas a recibir SON coleccionables de algún tipo. Tu trabajo es identificar QUÉ tipo es, no decidir si "merece" ser publicado.

═══════════════════════════════════════════
PASO 1 — CLASIFICAR EL TIPO DE ITEM
═══════════════════════════════════════════

Clasificá en EXACTAMENTE UNO de estos 5 tipos:

- "action_figure": figuras de personajes identificables (Marvel, DC, anime, videojuegos, películas, series). Incluye Funkos, Nendoroids, figuras articuladas, statues con personaje, vinyl figures. También figuras vintage aunque no tengan marca clara, si son claramente personajes o están articuladas.

- "comic": cómics, revistas, mangas, historietas. Single issues en formato grapa, también TPB y tapa dura. Tienen portada con título e ilustración. ATENCIÓN: muchos cómics vienen en bolsa plástica transparente (mylar) con cartón rígido atrás (backing board). Eso sigue siendo un cómic, no te confundas con el reflejo del plástico.

- "die_cast_vehicle": autos, camiones, motos en miniatura (Hot Wheels, Matchbox, Bburago, Maisto, Minichamps, Greenlight, etc.). Vehículos a escala, generalmente metálicos.

- "collectible_decor": items coleccionables que NO encajan en los 3 anteriores. Estatuas decorativas sin personaje claro de marca, bustos genéricos, dioramas, placas, posters enmarcados, figuras artesanales, esculturas decorativas, items de merchandising no-figura. Este es el bucket por defecto cuando es claramente un objeto coleccionable o decorativo pero no podés ubicarlo en otro tipo.

- "unknown": SOLO para casos donde la foto es inutilizable. Ejemplos: imagen borrosa al punto de no distinguir nada, foto totalmente oscura o sobreexpuesta, captura de pantalla sin producto, imagen corrupta. NO uses "unknown" porque no reconozcas el producto — para eso está "collectible_decor". Solo "unknown" si la imagen en sí no permite ver nada.

REGLAS DE DESEMPATE ENTRE TIPOS:
1. Si el producto principal es una figura articulada/de personaje, aunque venga con accesorios secundarios → "action_figure".
2. Si el producto principal es un vehículo a escala, aunque incluya una mini-figura del piloto → "die_cast_vehicle".
3. Si es un cómic con figura coleccionable adjunta de regalo → "comic".
4. Si es un busto, estatua decorativa o figurín SIN articulación y SIN personaje claramente identificable → "collectible_decor".
5. Si es un busto o estatua de personaje claramente identificable (Iron Man, Goku, etc.), aunque no tenga articulación → "action_figure".

REGLAS DE DESEMPATE ENTRE FRANQUICIAS:
1. Cuando dudés entre franquicias parecidas, priorizá la más específica que puedas verificar visualmente en la foto.
2. Si reconocés la franquicia general pero no la línea específica, completá franchise y dejá product_line en null.

═══════════════════════════════════════════
PASO 2 — EXTRAER ATRIBUTOS
═══════════════════════════════════════════

Solo completá el bloque correspondiente al item_type que elegiste. Los otros 3 bloques de tipo dejalos como null entero (ej: "comic": null).

El bloque "common" se completa siempre, excepto si item_type es "unknown".

REGLA CRÍTICA — NO INVENTAR NOMBRES PROPIOS:
Los campos character, manufacturer, franchise, product_line, alphanumeric_model (en figuras), publisher, title, writer, artist (en cómics), car_brand, car_model, model_maker (en autitos) son NOMBRES PROPIOS y NO se inventan.

Solo completalos si:
- Ves el nombre escrito explícitamente en la foto (en caja, base, sticker, logo), O
- Reconocés con certeza visual fuerte (silueta inconfundible, paleta característica, diseño icónico de un personaje famoso).

Ante la mínima duda → null. Es preferible dejar el campo vacío que poner un nombre equivocado.

DESCRIPCIÓN (description en common) — REGLA ANTI-INVENCIÓN EXTENDIDA:
Escribí 3-5 oraciones para la descripción de ML. Estilo informativo y descriptivo, sin adjetivos de marketing ("increíble", "hermoso", "imperdible", "único"). Mencioná: tipo de producto, personaje/franquicia si aplica, material, dimensiones, estado, y características destacables.

CRÍTICO: La descripción NO puede contener nombres propios (personajes, marcas, franquicias, líneas) que NO hayas completado en los campos de atributos correspondientes. Si dejaste character=null porque no lo identificaste, NO lo inventes en la descripción. Mejor descripción genérica ("Figura coleccionable de PVC de 18cm de altura, articulada, con accesorios incluidos") que descripción con nombre equivocado.

CONDITION:
- "new": caja cerrada/sellada, sin daños visibles, producto aparentemente sin abrir
- "used": producto fuera de caja o con signos leves de uso (polvo, marcas menores)
- "damaged": daños visibles importantes (caja aplastada, figura rota, pintura saltada, partes faltantes)

ESCALA DE CONFIDENCE (type_confidence):
- 90-100: estoy seguro. Veo logos claros, texto identificable, o características visuales inconfundibles.
- 70-89: alta probabilidad. Características visuales fuertes pero sin texto confirmatorio.
- 50-69: probable pero hay ambigüedad. Es la opción más razonable entre varias posibles.
- 30-49: zona gris. Clasifiqué como collectible_decor por defecto porque no encaja claro en otro tipo.
- <30: estoy adivinando. Casi llega a unknown.

REGLAS DE DIMENSIONES:
- approx_width_cm y approx_depth_cm: estimación basada en proporciones típicas. Si solo ves la figura de frente, profundidad ≈ ancho/2.

REGLAS ESPECÍFICAS DE FIGURAS:
- is_bobblehead: true SOLO si la cabeza está montada sobre un resorte y oscila visiblemente. Los Funko Pop NO son bobbleheads aunque tengan cabeza grande — son vinyl figures estáticas. McFarlane Sportspicks sí suelen ser bobbleheads.
- is_articulated: true si ves articulaciones en hombros/codos/rodillas/cintura. false si es claramente estática (Funko Pop estándar, estatua). null si no podés determinarlo.
- is_exclusive: true SOLO si ves sticker o marca de exclusividad explícita (ej: "Pop In A Box Exclusive", "GameStop Exclusive", "SDCC 2023").
- alphanumeric_model: número o código identificatorio del coleccionable, visible en caja o base. Ej: "593" para Funko Pop Spider-Man, "MM-142" para McFarlane.

FÓRMULA DE TÍTULO (title_suggestion, max 60 caracteres):
Construí el título poniendo primero los keywords más buscables. Sin adjetivos de marketing.

- action_figure: "[Tipo] [Personaje] [Línea] [Fabricante] [#Modelo] [Escala] [Altura]cm"
  Ej: "Funko Pop Spider-Man 593 Marvel"
  Ej: "Figura Hatsune Miku Racing 2016 Good Smile 1:8 23cm"

- comic: "[Título] #[Número] [Editorial] [Año] [Idioma]"
  Ej: "Amazing Spider-Man #300 Marvel 1988 Inglés"

- die_cast_vehicle: "[Fabricante] [Marca auto] [Modelo] [Año] Escala [Escala]"
  Ej: "Hot Wheels Ford Mustang GT 1969 Escala 1:64"

- collectible_decor: "[Subtipo] [Tema/Personaje] [Material] [Altura]cm"
  Ej: "Estatua Elefante Resina Decorativo 18cm"

Si no tenés data para algún campo, omitilo (no pongas "null" ni "Sin marca"). Si supera 60 caracteres, recortá los menos importantes.

═══════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════

JSON estricto, sin markdown, sin texto antes ni después:

{
  "item_type": "action_figure" | "comic" | "die_cast_vehicle" | "collectible_decor" | "unknown",
  "type_confidence": <0-100>,
  "photo_quality_issue": <string describiendo problema de calidad de foto, o null>,
  "common": {
    "title_suggestion": <string max 60 chars o null>,
    "description": <string 3-5 oraciones para descripción ML, o null>,
    "condition": "new" | "used" | "damaged" | null,
    "package_condition": "sealed_box" | "open_box" | "loose" | "no_package" | null,
    "approx_height_cm": <número o null>,
    "approx_width_cm": <número o null>,
    "approx_depth_cm": <número o null>,
    "material": <string o null>,
    "manufacturing_year": <entero o null>,
    "is_handmade": <bool o null>,
    "visible_text": <array de strings o []>
  },
  "action_figure": {
    "character": <string o null>,
    "franchise": <string o null>,
    "manufacturer": <string o null>,
    "product_line": <string o null>,
    "alphanumeric_model": <string o null>,
    "scale": <string o null>,
    "is_exclusive": <bool o null>,
    "exclusive_store": <string o null>,
    "is_articulated": <bool o null>,
    "is_bobblehead": <bool o null>,
    "has_remote_control": <bool o null>,
    "has_lights": <bool o null>,
    "has_interchangeable_parts": <bool o null>,
    "includes_accessories": <bool o null>,
    "play_type": <string o null>,
    "power_type": <string o null>,
    "recommended_age": <entero o null>
  },
  "comic": {
    "title": <string o null>,
    "issue_number": <string o null>,
    "publisher": <string o null>,
    "year": <entero o null>,
    "language": "es" | "en" | "pt" | "jp" | null,
    "format": "single_issue" | "tpb" | "hardcover" | "magazine" | null,
    "writer": <string o null>,
    "artist": <string o null>,
    "variant_cover": <bool o null>,
    "is_graded": <bool o null>,
    "grade": <string o null>
  },
  "die_cast_vehicle": {
    "car_brand": <string o null, marca del auto real ej "Ford">,
    "car_model": <string o null, modelo del auto ej "Mustang GT">,
    "model_maker": <string o null, fabricante del juguete ej "Hot Wheels">,
    "scale": <string o null, ej "1:64">,
    "car_year": <entero o null, año del auto real, NO del juguete>,
    "has_original_box": <bool o null>,
    "is_limited_edition": <bool o null>
  },
  "collectible_decor": {
    "subtype": <string o null, ej "busto", "diorama", "estatua", "figurín">,
    "theme": <string o null, ej "Star Wars", "Marvel", "animales", "fantasía">
  }
}

CHECKLIST FINAL ANTES DE RESPONDER:
1. ¿Elegí UN solo item_type de los 5?
2. ¿Mi type_confidence refleja honestamente lo que vi (no inflada)?
3. ¿Los nombres propios que puse son verificables visualmente o los dejé en null?
4. ¿Distinguí bien fabricante / línea / franquicia / personaje (no los mezclé)?
5. ¿La descripción NO menciona nombres propios que dejé en null en los atributos?
6. ¿Completé solo el bloque del tipo elegido y dejé los otros 3 en null?
7. ¿El JSON es válido (sin comas finales, sin comentarios, sin markdown)?

Devolvé SOLO el JSON.`;

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
      max_tokens: 1800,
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

    // Aliases por bloque del schema (estilo opción B, consistente en todo el proyecto)
    const visionCommon = visionResult.common || {};
    const visionAF = visionResult.action_figure || {};

    console.log(`[publish/create] Vision detectó: "${visionCommon.title_suggestion}" (item_type=${visionResult.item_type}, condition=${visionCommon.condition}, confidence=${visionResult.type_confidence}%)`);

    // 3.b. Branch por item_type
    // - unknown: foto inutilizable, no publicar, marcar pendiente_manual
    // - tipos no soportados todavía (comic, die_cast_vehicle, collectible_decor): guardar pendiente_manual
    // - action_figure: flujo completo de publicación
    if (visionResult.item_type === "unknown") {
      const motivoUnknown = visionResult.photo_quality_issue
        ? `Foto inutilizable: ${visionResult.photo_quality_issue}`
        : `Vision no pudo identificar el contenido de la foto`;

      console.log(`[publish/create] ⚠️ Item type unknown. ${motivoUnknown}`);

      await pool.query(
        `UPDATE publicaciones_masivas SET 
          titulo = $1, status = $2, condition = $3, 
          requiere_revision = $4, motivo_revision = $5, 
          confianza_condicion = $6, vision_result = $7
         WHERE id = $8`,
        [
          visionCommon.title_suggestion || "Producto no identificado",
          "pendiente_manual",
          "new",
          true,
          motivoUnknown,
          visionResult.type_confidence ?? 0,
          visionResult,
          publicacionId,
        ]
      );

      return res.json({
        status: "pendiente_manual",
        id: publicacionId,
        item_type: visionResult.item_type,
        motivo: motivoUnknown,
        vision_result: visionResult,
      });
    }

    const SUPPORTED_FOR_PUBLISHING = ["action_figure"]; // hoy solo figuras se publican automáticamente
    if (!SUPPORTED_FOR_PUBLISHING.includes(visionResult.item_type)) {
      const motivoTipoNoImpl = `Tipo "${visionResult.item_type}" detectado correctamente (confidence ${visionResult.type_confidence}%) pero falta implementar publicación automática para este tipo.`;

      console.log(`[publish/create] ℹ️ ${motivoTipoNoImpl}`);

      await pool.query(
        `UPDATE publicaciones_masivas SET 
          titulo = $1, status = $2, condition = $3, 
          requiere_revision = $4, motivo_revision = $5, 
          confianza_condicion = $6, vision_result = $7
         WHERE id = $8`,
        [
          visionCommon.title_suggestion || `Producto tipo ${visionResult.item_type}`,
          "pendiente_manual",
          "new",
          true,
          motivoTipoNoImpl,
          visionResult.type_confidence ?? 0,
          visionResult,
          publicacionId,
        ]
      );

      return res.json({
        status: "pendiente_manual",
        id: publicacionId,
        item_type: visionResult.item_type,
        type_confidence: visionResult.type_confidence,
        motivo: motivoTipoNoImpl,
        vision_result: visionResult,
      });
    }

    // 4. Publicar en ML — SIEMPRE como "new" por limitación de la API
    const mlResponse = await mlService.publishProductFromJSON({
      title: visionCommon.title_suggestion,
      price,
      stock,
      condition: "new",
      description: visionCommon.description,
      pictures: [],
    }, visionResult);

    // 5. Flags de revisión
    const visionDetectedNotNew = visionCommon.condition && visionCommon.condition !== "new";
    const lowConfidence = (visionResult.type_confidence ?? 0) < 70;

    // Caso A: no se encontró match de catálogo → intentar fallback libre
    if (mlResponse.requiere_revision_manual) {
      console.log("[publish/create] Sin catálogo. Intentando fallback libre...");

      try {
        const freeListingResponse = await mlService.publishProductAsFreeListing(
          {
            title: visionCommon.title_suggestion,
            price,
            stock,
            condition: "new",
            description: visionCommon.description,
          },
          images,
          visionResult
        );

        // Fallback libre exitoso → publicado con requiere_revision=true
        const motivoFallback = 
          `Publicación libre (sin catálogo ML). Vision confidence: ${visionResult.type_confidence}%. ` +
          `Revisar atributos en ML web.`;

        await pool.query(
          `UPDATE publicaciones_masivas SET 
            titulo = $1, ml_id = $2, status = $3, permalink = $4, 
            condition = $5, requiere_revision = $6, motivo_revision = $7, 
            confianza_condicion = $8, vision_result = $9
           WHERE id = $10`,
          [
            visionCommon.title_suggestion,
            freeListingResponse.id,
            "ok",
            freeListingResponse.permalink,
            "new",
            true,
            motivoFallback,
            visionResult.type_confidence ?? 0,
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
            visionCommon.title_suggestion,
            "pendiente_manual",
            "new",
            true,
            motivoCompleto,
            visionResult.type_confidence ?? 0,
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
      motivosRevision.push(`Vision detectó "${visionCommon.condition}"`);
    }
    if (lowConfidence) {
      motivosRevision.push(`Confianza baja (${visionResult.type_confidence}%)`);
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
        visionCommon.title_suggestion,
        mlResponse.id,
        "ok",
        mlResponse.permalink,
        "new",
        requiereRevision,
        motivoRevision,
        visionResult.type_confidence ?? 0,
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

// ===== INSPECTOR DE ITEMS — disponible siempre, devuelve JSON completo autenticado =====
router.get("/inspect-item/:mlId", async (req, res) => {
  try {
    const mlService = await import("../services/mercadolibre.service.js");
    const data = await mlService.debugGetItem(req.params.mlId);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
