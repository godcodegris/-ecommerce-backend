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

Clasificá en EXACTAMENTE UNO de estos 6 tipos:

- "action_figure": figuras de personajes identificables (Marvel, DC, anime, videojuegos, películas, series). Incluye Funkos, Nendoroids, figuras articuladas, statues con personaje, vinyl figures. También figuras vintage aunque no tengan marca clara, si son claramente personajes o están articuladas. **PRIORIDAD MÁXIMA**: si reconocés un personaje o franquicia, ES action_figure, sin importar el material (metal, bronce, resina, mármol, lo que sea). Una figura de Iron Man de bronce NO es decor — es action_figure.

- "comic": cómics, revistas, mangas, historietas. Single issues en formato grapa, también TPB y tapa dura. Tienen portada con título e ilustración, y páginas internas tipo libro grapado o cosido. ATENCIÓN: muchos cómics vienen en bolsa plástica transparente (mylar) con cartón rígido atrás (backing board). Eso sigue siendo un cómic, no te confundas con el reflejo del plástico.

- "trading_cards": cartas individuales de juegos coleccionables (TCG). Magic The Gathering, Pokémon TCG, Yu-Gi-Oh!. Formato cartón rectangular plastificado, generalmente en sleeve o toploader, a veces sueltas o en lotes. NO confundir con cómics: un cómic es un libro grapado con páginas; una carta TCG es UN cartón rectangular individual. Si ves un mazo, lote o pack de cartas TCG también va acá. **IMPORTANTE**: solo aceptamos Magic, Pokémon TCG y Yu-Gi-Oh!. Si es una carta de otra cosa (Dragon Ball Super CG, deportivas, Topps, sticker album), NO la clasifiques como trading_cards — usá collectible_decor.

- "die_cast_vehicle": autos, camiones, motos en miniatura (Hot Wheels, Matchbox, Bburago, Maisto, Minichamps, Greenlight, etc.). Vehículos a escala, generalmente metálicos. Incluye también réplicas no-marca (bootlegs / genéricos sin logo de fabricante claro) — esos van con manufacturer=null e is_likely_bootleg=true.

- "collectible_decor": items coleccionables que NO encajan en los 4 anteriores Y que NO representan un personaje/franquicia identificable. Estatuas decorativas de animales genéricos, abstractos, motivos religiosos o étnicos, bustos genéricos, dioramas sin personaje, placas, jarrones decorativos, esculturas artesanales. Este NO es el bucket por defecto: solo va acá si claramente es decorativo Y no hay personaje/franquicia reconocible.

- "unknown": SOLO para casos donde la foto es inutilizable. Ejemplos: imagen borrosa al punto de no distinguir nada, foto totalmente oscura o sobreexpuesta, captura de pantalla sin producto, imagen corrupta. Si dudás entre dos tipos pero podés ver el producto, NO uses unknown — elegí el más probable.

REGLAS DE DESEMPATE ENTRE TIPOS (en orden de prioridad):
1. Si reconocés un PERSONAJE o FRANQUICIA identificable (Marvel, DC, Star Wars, anime, videojuegos, etc.) → "action_figure". La franquicia gana sobre el material y el formato.
2. Si es un libro/revista grapado o TPB con páginas → "comic".
3. Si es UNA carta rectangular de Magic/Pokémon/Yu-Gi-Oh → "trading_cards".
4. Si es un vehículo a escala (auto, camión, moto) → "die_cast_vehicle".
5. Si es un objeto coleccionable/decorativo SIN personaje ni franquicia reconocible → "collectible_decor".
6. Si la foto es inutilizable → "unknown".

Casos específicos:
- Figura articulada con accesorios secundarios → "action_figure".
- Vehículo a escala con mini-figura del piloto → "die_cast_vehicle".
- Cómic con figura de regalo adjunta → "comic".
- Busto/estatua de personaje identificable (Iron Man, Goku) sin articulación → "action_figure".
- Busto/estatua de animal o motivo genérico sin personaje → "collectible_decor".
- Carta de Dragon Ball Super, deportivas, álbum Panini → "collectible_decor" (NO trading_cards, no soportamos esas brands).

REGLA ANTI-FALSO-POSITIVO CRÍTICA:
- Una figura de un personaje conocido NUNCA es collectible_decor, aunque sea de bronce, mármol, resina o metal. La franquicia siempre gana al material.
- Una carta TCG NUNCA es comic. Un cómic NUNCA es trading_cards.
- Si dudás entre action_figure y collectible_decor, default a action_figure cuando hay cualquier indicio de personaje.

═══════════════════════════════════════════
PASO 2 — EXTRAER ATRIBUTOS
═══════════════════════════════════════════

Solo completá el bloque correspondiente al item_type que elegiste. Los otros 4 bloques de tipo dejalos como null entero (ej: "comic": null).

El bloque "common" se completa siempre, excepto si item_type es "unknown".

REGLA CRÍTICA — NO INVENTAR NOMBRES PROPIOS:
Los campos character, manufacturer, franchise, product_line, alphanumeric_model (en figuras), publisher, title, writer, artist (en cómics), card_name, set_name (en cartas), vehicle_brand, vehicle_model (en autitos), theme (en decor) son NOMBRES PROPIOS y NO se inventan.

Solo completalos si:
- Ves el nombre escrito explícitamente en la foto (en caja, base, sticker, logo), O
- Reconocés con certeza visual fuerte (silueta inconfundible, paleta característica, diseño icónico de un personaje famoso).

Ante la mínima duda → null. Es preferible dejar el campo vacío que poner un nombre equivocado.

DESCRIPCIÓN (description en common) — REGLA ANTI-INVENCIÓN EXTENDIDA:
Escribí 3-5 oraciones para la descripción de ML. Estilo informativo y descriptivo, sin adjetivos de marketing ("increíble", "hermoso", "imperdible", "único"). Mencioná: tipo de producto, personaje/franquicia si aplica, material, dimensiones, estado, y características destacables.

CRÍTICO: La descripción NO puede contener nombres propios (personajes, marcas, franquicias, líneas) que NO hayas completado en los campos de atributos correspondientes.

CONDITION:
- "new": caja cerrada/sellada, sin daños visibles
- "used": producto fuera de caja o con signos leves de uso
- "damaged": daños visibles importantes

ESCALA DE CONFIDENCE (type_confidence):
- 90-100: estoy seguro. Veo logos claros, texto identificable, o características visuales inconfundibles.
- 70-89: alta probabilidad. Características visuales fuertes pero sin texto confirmatorio.
- 50-69: probable pero hay ambigüedad.
- 30-49: zona gris.
- <30: estoy adivinando.

REGLAS ESPECÍFICAS DE CÓMICS:
- title: el título de la serie SIN el número (ej: "The Amazing Spider-Man", "Fierro").
- issue_number: solo el número, sin el "#".
- publisher: editorial real visible. Si no la ves, null.
- genre: "Interés general" para superhéroes/aventura/sci-fi, "Infantil" para Disney/infantil, "Arte" para historieta de autor.
- format: "single_issue" para grapa, "magazine" para revistas tipo Fierro.

REGLAS ESPECÍFICAS DE FIGURAS:
- is_bobblehead: true SOLO si la cabeza está montada sobre resorte y oscila. Funko Pop NO son bobbleheads.
- is_articulated: true si ves articulaciones. false si es estática. null si no se determina.
- is_exclusive: true SOLO si ves sticker o marca de exclusividad explícita.
- alphanumeric_model: número o código identificatorio visible.

REGLAS ESPECÍFICAS DE TRADING CARDS:
- brand: SOLO uno de estos tres valores exactos: "Magic The Gathering", "Pokémon", "Yu-Gi-Oh!". Si la carta no es de ninguno de los tres, devolvé null Y volvé al PASO 1 reclasificando como collectible_decor.
- card_name: el nombre del personaje/criatura/hechizo en la carta (ej: "Charizard", "Black Lotus", "Dark Magician"). Si no lo ves claro, null.
- set_name: nombre de la expansión/set si es visible (ej: "Base Set", "Alpha", "Legend of Blue Eyes"). Null si no lo ves.
- language: "Español", "Inglés", "Japonés" según el idioma de la carta. Null si no se puede determinar.
- is_foil: true si la carta tiene acabado holográfico/foil visible. false si es regular. null si no se puede determinar.
- units_per_pack: 1 si es carta individual, N si es lote/pack de N cartas. Default 1.

REGLAS ESPECÍFICAS DE DIE-CAST:
- manufacturer: marca del fabricante del juguete (Hot Wheels, Matchbox, Bburago, Maisto, Greenlight, etc.). Si no ves logo o marca clara → null.
- is_likely_bootleg: true si el vehículo parece copia genérica sin marca (sin logo de fabricante visible, plástico de baja calidad, sin packaging de marca, copia evidente de un Hot Wheels). false si tiene marca clara.
- scale: escala visible (ej: "1:64", "1:43", "1:24", "1:18"). Si no la ves, estimá basándote en proporciones (un Hot Wheels estándar es 1:64).
- vehicle_brand: marca del auto real (Ford, Chevrolet, Dodge, Ferrari, etc.). Solo si la ves o la reconocés con certeza.
- vehicle_model: modelo del auto (Mustang, Camaro, Charger). Solo si lo ves o lo reconocés con certeza.
- color: color principal del vehículo.
- units_per_pack: 1 default, N si es un set/pack.

REGLAS ESPECÍFICAS DE COLLECTIBLE DECOR:
- subtype: "estatua", "busto", "figurín", "diorama", "placa", "jarrón", etc.
- theme: tema general SIN inventar franquicia (ej: "elefante", "abstracto", "religioso", "animales", "africano"). Si reconocés franquicia → reclasificá como action_figure.
- material: enum CERRADO. Elegí UNO de: "Arcilla", "Barbotina", "Bronce", "Madera", "Mármol", "Vidrio", "Yeso", "Metal", "Resina", "Cerámica", "Porcelana". Si no estás seguro o es plástico/PVC/otro material, devolvé null (lo va a marcar para revisión manual).

FÓRMULA DE TÍTULO (title_suggestion, max 60 caracteres):
- action_figure: "[Tipo] [Personaje] [Línea] [Fabricante] [#Modelo] [Escala] [Altura]cm"
- comic: "[Título] #[Número] [Editorial] [Año] [Idioma]"
- trading_cards: "[Brand] [Card Name] [Set] [Idioma]" Ej: "Pokémon Charizard Base Set Inglés"
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
    "brand": "Magic The Gathering" | "Pokémon" | "Yu-Gi-Oh!" | null,
    "card_name": <string o null>,
    "set_name": <string o null>,
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
3. ¿Si vi una carta TCG no-Magic/Pokémon/Yu-Gi-Oh, la mandé a collectible_decor (no trading_cards)?
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

    const SUPPORTED_FOR_PUBLISHING = ["action_figure", "comic", "trading_cards"]; // figuras, cómics y cartas TCG
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
           // Routing por item_type: cada tipo tiene su propia función de publicación
        // Routing por item_type: cada tipo tiene su propia función de publicación
        const publishFnByType = {
          "comic": mlService.publishComicAsFreeListing,
          "trading_cards": mlService.publishTradingCardAsFreeListing,
          "action_figure": mlService.publishProductAsFreeListing,
        };
        const publishFn = publishFnByType[visionResult.item_type] || mlService.publishProductAsFreeListing;
        console.log(`[publish/create] Routing item_type="${visionResult.item_type}" → ${publishFn.name}`);

        const freeListingResponse = await publishFn(
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
