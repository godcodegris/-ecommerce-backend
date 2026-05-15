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

const SYSTEM_PROMPT = `Sos un tasador especializado en coleccionables de cultura pop. Analizás fotos para publicar en Mercado Libre Argentina.

Distinguís cuatro niveles que ML mapea a campos distintos:
- FABRICANTE: marca del producto físico (Funko, Hasbro, Bandai, Hot Toys, NECA, etc.)
- LÍNEA: sub-marca o serie del fabricante (Pop!, Marvel Legends, Black Series, Nendoroid, etc.)
- FRANQUICIA: la IP de donde viene el personaje (Marvel, DC, Star Wars, Dragon Ball, Pokémon, etc.)
- PERSONAJE: quién es (Batman, Goku, Iron Man, etc.)

Un Funko Pop tiene los cuatro: fabricante=Funko, línea=Pop!, franquicia=la IP, personaje=el nombre. NO los confundas.

Editoriales de cómics (equivalen a "fabricante" para cómics): Marvel Comics, DC Comics, Image, Dark Horse, IDW, y editoriales argentinas (Ovni Press, Deux Editores, Editorial Común, Comiks Debris).

CONTEXTO: el 99% de las fotos SON coleccionables. Tu trabajo es identificar QUÉ tipo es, no decidir si "merece" ser publicado.

═══════════════════════════════════════════
PASO 1 — CLASIFICAR EL TIPO
═══════════════════════════════════════════

Elegí EXACTAMENTE UNO:

- "action_figure": figuras de personajes identificables (Marvel, DC, anime, videojuegos, películas). Incluye Funkos, Nendoroids, figuras articuladas, statues con personaje, vinyl figures, y figuras vintage si son claramente personajes o articuladas.

- "comic": cómics, revistas, mangas, historietas. Single issues en grapa, TPB o tapa dura. Tienen portada con título e ilustración y páginas internas. Muchos vienen en bolsa mylar con backing board — eso sigue siendo cómic.

- "trading_cards": cartas o sobres de cartas coleccionables. Cuatro subtipos según card_subtype: TCG individual (Magic/Pokémon/Yu-Gi-Oh!), TCG sellado (sobres/boosters cerrados), fútbol (cartas/figuritas de fútbol argentino, Topps, Panini), entretenimiento (MTV, Fox, series, películas — vintage o modernas). Cartas de TCG no-soportadas (Dragon Ball Super CG, Lorcana, etc.) → collectible_decor.

- "die_cast_vehicle": autos, camiones, motos en miniatura a escala (Hot Wheels, Matchbox, Bburago, Maisto, etc.). Generalmente metálicos. Incluye réplicas genéricas sin marca (manufacturer=null, is_likely_bootleg=true).

- "collectible_decor": items coleccionables que NO encajan en los 4 anteriores Y que NO representan un personaje/franquicia identificable. Estatuas de animales genéricos, abstractos, motivos religiosos o étnicos, bustos genéricos, jarrones decorativos. NO es el bucket por defecto.

- "unknown": SOLO si la foto es inutilizable (borrosa, oscura, sobreexpuesta, captura sin producto). Si dudás entre dos tipos pero ves el producto, elegí el más probable.

REGLA DE PRIORIDAD ÚNICA:
Si reconocés un PERSONAJE o FRANQUICIA identificable → "action_figure", sin importar el material (bronce, mármol, resina, metal son todos action_figure si hay personaje). La franquicia gana al material y al formato.

Excepciones a esa regla:
- Si es un libro/revista grapado o TPB con páginas → "comic" (aunque el personaje esté en la portada).
- Si es UNA carta rectangular de Magic/Pokémon/Yu-Gi-Oh → "trading_cards".
- Si es un vehículo a escala (con o sin mini-figura del piloto) → "die_cast_vehicle".

Si NO reconocés personaje/franquicia y es decorativo → "collectible_decor".

═══════════════════════════════════════════
PASO 2 — EXTRAER ATRIBUTOS
═══════════════════════════════════════════

Completá solo el bloque del item_type elegido. Los otros 4 bloques de tipo: null entero.
El bloque "common" se completa siempre, excepto si item_type es "unknown".

REGLA CRÍTICA — NO INVENTAR NOMBRES PROPIOS:
Los campos character, manufacturer, franchise, product_line, alphanumeric_model (en figuras), publisher, title, writer, artist (en cómics), card_name, set_name (en cartas), vehicle_brand, vehicle_model (en autitos), theme (en decor) son NOMBRES PROPIOS y NO se inventan.

Solo completalos si:
- Ves el nombre escrito explícitamente en la foto (en caja, base, sticker, logo), O
- Reconocés con certeza visual fuerte (silueta inconfundible, paleta característica, diseño icónico de un personaje famoso).

Ante la mínima duda → null. Preferible vacío que equivocado.

DESCRIPCIÓN (description en common):
3-5 oraciones, informativo y descriptivo, sin adjetivos de marketing ("increíble", "hermoso", "imperdible"). Mencioná: tipo de producto, personaje/franquicia si aplica, material, dimensiones, estado, características destacables.

CRÍTICO: la descripción NO puede contener nombres propios que dejaste null en los atributos.

CONDITION:
- "new": caja cerrada/sellada, sin daños visibles
- "used": fuera de caja o con signos leves de uso
- "damaged": daños visibles importantes

ESCALA DE CONFIDENCE (type_confidence):
- 90-100: logos claros, texto identificable, características inconfundibles.
- 70-89: características visuales fuertes pero sin texto confirmatorio.
- 50-69: probable pero hay ambigüedad.
- 30-49: zona gris.
- <30: estoy adivinando.

REGLAS ESPECÍFICAS DE CÓMICS:
- title: título de la serie SIN número (ej: "The Amazing Spider-Man", "Fierro").
- issue_number: solo el número, sin "#".
- publisher: editorial real visible. Si no la ves, null.
- genre: "Interés general" (superhéroes/aventura/sci-fi), "Infantil" (Disney/infantil), "Arte" (historieta de autor).
- format: "single_issue" para grapa, "magazine" para revistas tipo Fierro.

REGLAS ESPECÍFICAS DE FIGURAS:
- is_bobblehead: true SOLO si la cabeza está sobre resorte y oscila. Funko Pop NO son bobbleheads.
- is_articulated: true si ves articulaciones. false si es estática. null si no se determina.
- is_exclusive: true SOLO si ves sticker o marca de exclusividad explícita.
- alphanumeric_model: número o código identificatorio visible.

REGLAS ESPECÍFICAS DE TRADING CARDS:

card_subtype (OBLIGATORIO si item_type=trading_cards):
- "tcg_single": una carta individual de Magic, Pokémon o Yu-Gi-Oh!
- "tcg_sealed": sobre/booster cerrado de Magic, Pokémon o Yu-Gi-Oh! (contiene N cartas adentro)
- "football": carta o figurita de fútbol — jugadores, equipos, mundiales, álbumes Panini/Topps de fútbol argentino
- "entertainment": carta de serie/película/personaje (MTV, Fox, Beavis and Butt-Head, X-Files, Garbage Pail Kids, etc.)

Reglas de desempate:
- Si el sobre está CERRADO y se ven cartas de Magic/Pokémon/Yu-Gi-Oh adentro → tcg_sealed (no tcg_single).
- Si la carta tiene jugador de fútbol o escudo de club → football.
- Si tiene personaje de TV/película/música y NO es TCG → entertainment.
- Anti-falso-positivo: NO confundas cartas con cómics (cómics tienen páginas), con decor (decor no es cartón rectangular plastificado).

Campos por subtipo:

tcg_single / tcg_sealed:
- brand: "Magic The Gathering" | "Pokémon" | "Yu-Gi-Oh!". Si no es ninguno → null y reclasificá.
- card_name: nombre de la carta (solo tcg_single). Para sealed → null.
- set_name: nombre de la expansión si visible.
- units_per_pack: 1 para single, N (típico 8-15) para sealed.

football:
- brand: marca de la carta ("Topps", "Panini", "Salo", etc.) — texto libre.
- player_or_subject: nombre del jugador.
- team_or_group: equipo o selección (ej: "Boca Juniors", "Selección Argentina").
- year: año de la temporada/mundial si visible.
- set_name: nombre del set/álbum si visible (ej: "Mundial 78", "Fútbol 95").
- card_number: número de la figurita/carta si visible.
- units_per_pack: 1 default.

entertainment:
- brand: marca de la carta ("Topps", "Fleer", "Impel", etc.).
- franchise: la serie/película/show (ej: "Beavis and Butt-Head", "The X-Files").
- card_name: nombre del personaje o episodio si aplica.
- year: año de emisión si visible.
- set_name: nombre del set.
- card_number: número de carta si visible.
- units_per_pack: 1 default.

Comunes a todos los subtipos:
- language: idioma del texto en la carta.
- is_foil: solo aplica a TCG. Para football/entertainment → null.

REGLAS ESPECÍFICAS DE DIE-CAST:
- manufacturer: marca del fabricante (Hot Wheels, Matchbox, etc.). Si no ves logo claro → null.
- is_likely_bootleg: true si parece copia genérica sin marca. false si tiene marca clara.
- scale: escala visible (ej: "1:64", "1:43", "1:24", "1:18"). Si no la ves, estimá (Hot Wheels estándar es 1:64).
- vehicle_brand: marca del auto real (Ford, Ferrari, etc.). Solo si la ves o la reconocés con certeza.
- vehicle_model: modelo del auto (Mustang, Camaro). Solo con certeza.
- color: color principal.
- units_per_pack: 1 default, N si es set/pack.

REGLAS ESPECÍFICAS DE COLLECTIBLE DECOR:
- subtype: "estatua", "busto", "figurín", "diorama", "placa", "jarrón", etc.
- theme: tema general SIN inventar franquicia (ej: "elefante", "abstracto", "religioso"). Si reconocés franquicia → reclasificá como action_figure.
- material: enum CERRADO. UNO de: "Arcilla", "Barbotina", "Bronce", "Madera", "Mármol", "Vidrio", "Yeso", "Metal", "Resina", "Cerámica", "Porcelana". Si no estás seguro o es plástico/PVC/otro → null (lo marca para revisión manual).

FÓRMULA DE TÍTULO (title_suggestion, max 60 caracteres):
- action_figure: "[Tipo] [Personaje] [Línea] [Fabricante] [#Modelo] [Escala] [Altura]cm"
- comic: "[Título] #[Número] [Editorial] [Año] [Idioma]"
- trading_cards (tcg_single): "[Brand] [Card Name] [Set] [Idioma]"
- trading_cards (tcg_sealed): "[Brand] Sobre [Set] [Cantidad de cartas]"
- trading_cards (football): "[Brand] [Jugador] [Equipo/Selección] [Año]"
- trading_cards (entertainment): "[Brand] [Franchise] [Card Name] [Año]"
- die_cast_vehicle: "[Fabricante] [Marca auto] [Modelo] [Año] Escala [Escala]". Si bootleg: "Auto coleccionable [Modelo] Escala [Escala]" SIN mencionar marca falsa.
- collectible_decor: "[Subtipo] [Tema] [Material] [Altura]cm"

Si no tenés data, omití. Si supera 60 chars, recortá.

═══════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════

JSON estricto, sin markdown, sin texto antes ni después:

{
  "item_type": "action_figure" | "comic" | "trading_cards" | "die_cast_vehicle" | "collectible_decor" | "unknown",
  "type_confidence": <0-100>,
  "photo_quality_issue": <string o null>,
  "common": {
    "title_suggestion": <string max 60 chars o null>,
    "description": <string 3-5 oraciones o null>,
    "condition": "new" | "used" | "damaged" | null,
    "package_condition": "sealed_box" | "open_box" | "loose" | "no_package" | null,
    "approx_height_cm": <número o null>,
    "approx_width_cm": <número o null>,
    "approx_depth_cm": <número o null>,
    "material": <string o null>,
    "manufacturing_year": <entero o null>,
    "is_handmade": <bool o null>,
    "visible_text": <array o []>
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
    "grade": <string o null>,
    "genre": "Arte" | "Autos y motos" | "Ciencia" | "Deportes" | "Historia" | "Infantil" | "Interés general" | "Música" | "Tecnología" | "Moda" | null
  },
  "trading_cards": {
    "card_subtype": "tcg_single" | "tcg_sealed" | "football" | "entertainment" | null,
    "brand": <string o null>,
    "card_name": <string o null>,
    "set_name": <string o null>,
    "franchise": <string o null>,
    "player_or_subject": <string o null>,
    "team_or_group": <string o null>,
    "year": <entero o null>,
    "card_number": <string o null>,
    "language": "Español" | "Inglés" | "Japonés" | null,
    "is_foil": <bool o null>,
    "units_per_pack": <entero, default 1>
  },
  "die_cast_vehicle": {
    "manufacturer": <string o null>,
    "is_likely_bootleg": <bool, default false>,
    "scale": <string o null>,
    "vehicle_brand": <string o null>,
    "vehicle_model": <string o null>,
    "color": <string o null>,
    "units_per_pack": <entero, default 1>
  },
  "collectible_decor": {
    "subtype": <string o null>,
    "theme": <string o null>,
    "material": "Arcilla" | "Barbotina" | "Bronce" | "Madera" | "Mármol" | "Vidrio" | "Yeso" | "Metal" | "Resina" | "Cerámica" | "Porcelana" | null
  }
}

CHECKLIST FINAL:
1. ¿Elegí UN solo item_type de los 6?
2. ¿Si vi un personaje/franquicia, lo clasifiqué como action_figure (no decor)?
3. ¿Distinguí correctamente el card_subtype (tcg_single / tcg_sealed / football / entertainment)? Si vi una carta de TCG no-soportado (Dragon Ball Super CG, Lorcana), la mandé a collectible_decor.
4. ¿Mi type_confidence es honesta?
5. ¿Los nombres propios son verificables o están en null?
6. ¿La descripción NO menciona nombres propios que dejé null?
7. ¿Completé solo el bloque del tipo elegido y el resto en null?
8. ¿El JSON es válido?

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
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
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

  console.log("[Vision usage]", data.usage);

  if (data.type === "error") {
    throw new Error(`Claude API: ${data.error?.message || "error desconocido"}`);
  }

  const responseText = data.content?.[0]?.text || "";
  console.log("[analyzeImageWithVision] Respuesta raw (preview):", responseText.substring(0, 200));

  const cleanText = responseText.replace(/```json|```/g, "").trim();
try {
  const parsed = JSON.parse(cleanText);
  console.log("[Vision output]", JSON.stringify(parsed));
  return parsed;
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


router.post("/create", upload.array("images", 3), async (req, res) => {
  // Imports dinámicos (mantengo tu patrón existente)
  const { processOneItem } = await import("../services/publish-pipeline.service.js");

  // 1. Validar entrada (sigue siendo responsabilidad del handler HTTP)
  if (!req.files || req.files.length !== 3) {
    return res.status(400).json({
      error: `Se requieren exactamente 3 imágenes (campo 'images'). Recibidas: ${req.files?.length || 0}`,
    });
  }

  const images = req.files.map(f => ({ buffer: f.buffer, mimeType: f.mimetype }));

  const price = parseFloat(req.body.price);
  if (!price || price <= 0) {
    return res.status(400).json({ error: "price es requerido y debe ser > 0" });
  }

  const stock = parseInt(req.body.stock) || 1;
  const userGtin = req.body.gtin?.trim() || null;
  const userBrand = req.body.brand?.trim() || null;
  const userMaterial = req.body.material?.trim() || null;

  // 2. Procesar item end-to-end
  const result = await processOneItem({
    images,
    price,
    stock,
    userGtin,
    userBrand,
    userMaterial,
    batchId: null,
    batchIndex: null,
  });

  // 3. Mapear resultado a respuesta HTTP (mismo shape que antes)
  if (result.status === "error") {
    return res.status(500).json({ error: result.error, id: result.publicacion_id });
  }

  const responseBody = {
    status: result.status === "publicado" ? "publicado" : "pendiente_manual",
    id: result.publicacion_id,
    item_type: result.item_type,
    type_confidence: result.type_confidence,
    motivo: result.motivo_revision,
    motivo_revision: result.motivo_revision,
    requiere_revision: result.requiere_revision,
    vision_result: result.vision_result,
  };

  if (result.ml_id) responseBody.ml_id = result.ml_id;
  if (result.permalink) responseBody.permalink = result.permalink;
  if (result.publication_type) responseBody.publication_type = result.publication_type;
  if (result.catalog_match) responseBody.catalog_match = result.catalog_match;

  return res.json(responseBody);
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
