// src/services/publish-pipeline.service.js
//
// Función única que encapsula TODO el pipeline de publicación de un item:
//   Vision → branch unknown → branch unsupported → catálogo → fallback free listing → DB updates
//
// Es llamada por:
//   - POST /api/publish/create        (1 item, sincrónico, devuelve respuesta al cliente)
//   - POST /api/publish/batch-form    (N items, en loop con throttle)
//
// Refactor del handler original del 30/04. La lógica es idéntica; solo se cambió:
//   - INSERT inicial: ahora acepta batch_id y batch_index opcionales
//   - return: en lugar de res.json(...) la función devuelve un objeto plano
//
// El handler /create se queda con las validaciones HTTP (multer, parseo de body)
// y con el wrapping en res.json/res.status.
 
import * as mlService from "./mercadolibre.service.js";
import pool from "../db.js";
import { analyzeImageWithVision } from "../routes/vision.routes.js";
import sharp from "sharp";
// ^ Si tu analyzeImageWithVision vive en otro path, ajustá el import.
//   En tu vision.routes.js actual está como función local; al extraerla acá
//   conviene moverla a un service compartido. Si todavía vive en vision.routes.js,
//   exportala desde ahí y cambiá este import a:
//     import { analyzeImageWithVision } from "../routes/vision.routes.js";
 
const SUPPORTED_FOR_PUBLISHING = [
  "action_figure",
  "comic",
  "trading_cards",
  "die_cast_vehicle",
  "collectible_decor",
];
 
const PUBLISH_FN_BY_TYPE = {
  comic: mlService.publishComicAsFreeListing,
  trading_cards: mlService.publishTradingCardAsFreeListing,
  die_cast_vehicle: mlService.publishDieCastAsFreeListing,
  collectible_decor: mlService.publishCollectibleDecorAsFreeListing,
  action_figure: mlService.publishProductAsFreeListing,
};
 
// Redimensiona y comprime una imagen antes de mandarla a Vision.
// Vision (Claude) tiene límite de 5MB por imagen y procesa internamente
// a ~1568px en el lado mayor, así que mandar más resolución es desperdicio.
// Esta función NO toca la imagen original; devuelve un buffer nuevo.
async function prepareImageForVision(imageBuffer) {
  return await sharp(imageBuffer)
    .rotate() // aplica rotación EXIF (importante para fotos de celular)
    .resize(2000, 2000, {
      fit: "inside",            // mantiene aspect ratio
      withoutEnlargement: true, // no agranda si ya es chica
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
/**
 * Procesa un único producto end-to-end.
 *
 * @param {Object} input
 * @param {Array<{buffer: Buffer, mimeType: string}>} input.images - Idealmente 3 imágenes.
 *        Si se pasa 1 sola, se duplica internamente a 3 (decisión MVP Fase 1).
 * @param {number} input.price - Precio en ARS, > 0.
 * @param {number} [input.stock=1]
 * @param {string|null} [input.userGtin=null]
 * @param {string|null} [input.userBrand=null]
 * @param {string|null} [input.userMaterial=null]
 * @param {string|null} [input.batchId=null]   - UUID del batch padre (null si vino de /create directo)
 * @param {number|null} [input.batchIndex=null] - Posición 0-based dentro del batch
 *
 * @returns {Promise<Object>} resultado con shape:
 *   {
 *     publicacion_id: number,
 *     status: 'publicado' | 'pendiente_manual' | 'error',
 *     ml_id?: string,
 *     permalink?: string,
 *     item_type?: string,
 *     type_confidence?: number,
 *     publication_type?: 'catalog' | 'free_listing',
 *     requiere_revision?: boolean,
 *     motivo_revision?: string | null,
 *     catalog_match?: string | null,
 *     vision_result?: object,
 *     error?: string,
 *   }
 *
 * Esta función NUNCA tira excepciones hacia afuera (excepto fallos de DB graves).
 * Cualquier error de Vision/ML se captura y se devuelve como { status: 'error' }.
 */
export async function processOneItem(input) {
  const {
    images,
    price,
    stock = 1,
    userGtin = null,
    userBrand = null,
    userMaterial = null,
    batchId = null,
    batchIndex = null,
  } = input;
 
  // Normalizar a 3 imágenes (si vino 1, duplicar — MVP Fase 1)
  let normalizedImages = images;
  if (images.length === 1) {
    normalizedImages = [images[0], images[0], images[0]];
  } else if (images.length === 2) {
    normalizedImages = [images[0], images[1], images[0]];
  }
 
  const primaryImage = normalizedImages[0];
  let publicacionId = null;
 
  try {
    // 1. INSERT inicial — garantiza trazabilidad ante cualquier fallo
    const insertResult = await pool.query(
      `INSERT INTO publicaciones_masivas (price, status, batch_id, batch_index, created_at)
       VALUES ($1, 'procesando', $2, $3, NOW())
       RETURNING id`,
      [price, batchId, batchIndex]
    );
    publicacionId = insertResult.rows[0].id;
 
    console.log(
      `[processOneItem] id=${publicacionId} batch=${batchId ?? "-"} idx=${batchIndex ?? "-"} arrancado`
    );
 
    // 2. Vision sobre la primera foto
  const visionImageBuffer = await prepareImageForVision(primaryImage.buffer);
const visionResult = await analyzeImageWithVision(
  visionImageBuffer,
  "image/jpeg" // sharp devuelve JPEG siempre
);
    const visionCommon = visionResult.common || {};
 
    console.log(
      `[processOneItem] id=${publicacionId} Vision: "${visionCommon.title_suggestion}" type=${visionResult.item_type} conf=${visionResult.type_confidence}%`
    );
 
    // 3. Branch: unknown
    if (visionResult.item_type === "unknown") {
      const motivo = visionResult.photo_quality_issue
        ? `Foto inutilizable: ${visionResult.photo_quality_issue}`
        : `Vision no pudo identificar el contenido`;
 
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
          motivo,
          visionResult.type_confidence ?? 0,
          visionResult,
          publicacionId,
        ]
      );
 
      return {
        publicacion_id: publicacionId,
        status: "pendiente_manual",
        item_type: visionResult.item_type,
        motivo_revision: motivo,
        vision_result: visionResult,
      };
    }
 
    // 4. Branch: tipo no soportado (no debería pasar hoy, los 5 están todos)
    if (!SUPPORTED_FOR_PUBLISHING.includes(visionResult.item_type)) {
      const motivo =
        `Tipo "${visionResult.item_type}" detectado (conf ${visionResult.type_confidence}%) ` +
        `pero falta implementar publicación automática.`;
 
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
          motivo,
          visionResult.type_confidence ?? 0,
          visionResult,
          publicacionId,
        ]
      );
 
      return {
        publicacion_id: publicacionId,
        status: "pendiente_manual",
        item_type: visionResult.item_type,
        type_confidence: visionResult.type_confidence,
        motivo_revision: motivo,
        vision_result: visionResult,
      };
    }
 
    // 5. Intentar match de catálogo ML
    const mlResponse = await mlService.publishProductFromJSON(
      {
        title: visionCommon.title_suggestion,
        price,
        stock,
        condition: "new",
        description: visionCommon.description,
        pictures: [],
      },
      visionResult
    );
 
    const visionDetectedNotNew =
      visionCommon.condition && visionCommon.condition !== "new";
    const lowConfidence = (visionResult.type_confidence ?? 0) < 70;
 
    // 6. Si no hubo match → fallback a free listing por categoría
    if (mlResponse.requiere_revision_manual) {
      const publishFn =
        PUBLISH_FN_BY_TYPE[visionResult.item_type] ||
        mlService.publishProductAsFreeListing;
 
      console.log(
        `[processOneItem] id=${publicacionId} Routing free listing → ${publishFn.name}`
      );
 
      const freeListingResponse = await publishFn(
        {
          title: visionCommon.title_suggestion,
          price,
          stock,
          condition: "new",
          description: visionCommon.description,
          gtin: userGtin,
          brand: userBrand,
          material: userMaterial,
        },
        normalizedImages,
        visionResult
      );
 
      const motivoFallback =
        `Publicación libre (sin catálogo ML). Vision conf: ${visionResult.type_confidence}%. ` +
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
 
      return {
        publicacion_id: publicacionId,
        status: "publicado",
        ml_id: freeListingResponse.id,
        permalink: freeListingResponse.permalink,
        publication_type: "free_listing",
        item_type: visionResult.item_type,
        type_confidence: visionResult.type_confidence,
        requiere_revision: true,
        motivo_revision: motivoFallback,
        vision_result: visionResult,
      };
    }
 
    // 7. Match de catálogo aceptado → publicación normal
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
 
    return {
      publicacion_id: publicacionId,
      status: "publicado",
      ml_id: mlResponse.id,
      permalink: mlResponse.permalink,
      publication_type: "catalog",
      item_type: visionResult.item_type,
      type_confidence: visionResult.type_confidence,
      requiere_revision: requiereRevision,
      motivo_revision: motivoRevision,
      catalog_match: mlResponse.catalog_match_name || null,
      vision_result: visionResult,
    };
 
  } catch (error) {
    console.error(`[processOneItem] id=${publicacionId} ERROR:`, error.message);
 
    if (publicacionId) {
      try {
        await pool.query(
          `UPDATE publicaciones_masivas
           SET status = 'error', error_msg = $1
           WHERE id = $2`,
          [error.message, publicacionId]
        );
      } catch (dbErr) {
        console.error(`[processOneItem] no se pudo escribir error en DB:`, dbErr.message);
      }
    }
 
    return {
      publicacion_id: publicacionId,
      status: "error",
      error: error.message,
    };
  }
}