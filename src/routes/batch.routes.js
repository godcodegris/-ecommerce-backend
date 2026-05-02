// src/routes/batch.routes.js
//
// Endpoints:
//   POST /api/publish/batch-form        → recibe N fotos+precios, devuelve batch_id, dispara loop async
//   GET  /api/publish/batch-status/:id  → estado del batch (para polling cada 2s desde el frontend)
//
// Helper exportado:
//   cleanupOrphanedBatches()  → llamar al boot del server para marcar batches huérfanos
//
// Contrato del request a /batch-form (multipart/form-data):
//   - Campo "photo" repetido N veces (un archivo por item)
//   - Campo "prices" como string JSON con array de precios paralelo a las fotos
//     ej: prices='[8000, 8500, 12000]'
//
// Notas:
//   - El loop usa setImmediate (fire and forget) en el mismo proceso Node.
//     Si Railway reinicia mid-batch, los items que faltan quedan sin procesar
//     y el batch queda marcado como 'interrumpido' por el cleanup.
//   - Throttle de 500ms entre items para no saturar rate limit de ML.
//   - Máx 50 items por batch.

import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import pool from "../db.js";
import { processOneItem } from "../services/publish-pipeline.service.js";

const router = express.Router();

const MAX_ITEMS_PER_BATCH = 50;
const THROTTLE_MS = 500;

// Multer con storage en memoria.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB por archivo
    files: MAX_ITEMS_PER_BATCH,
  },
});

// ─────────────────────────────────────────────────────────────────
// POST /api/publish/batch-form
// ─────────────────────────────────────────────────────────────────
router.post("/batch-form", upload.any(), async (req, res) => {
  try {
    // 1. Parsear items del multipart
    let items;
    try {
      items = parseBatchItems(req.files, req.body);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }

    if (items.length === 0) {
      return res.status(400).json({
        error: "No se recibieron items válidos. Formato esperado: campo 'photo' repetido + campo 'prices' como JSON array.",
      });
    }

    if (items.length > MAX_ITEMS_PER_BATCH) {
      return res.status(400).json({
        error: `Máximo ${MAX_ITEMS_PER_BATCH} items por lote. Recibidos: ${items.length}`,
      });
    }

    // Validar que cada item tenga precio válido
    for (const [idx, item] of items.entries()) {
      if (!item.price || item.price <= 0) {
        return res.status(400).json({
          error: `Item ${idx}: precio inválido o faltante`,
        });
      }
      if (!item.photo) {
        return res.status(400).json({
          error: `Item ${idx}: foto faltante`,
        });
      }
    }

    // 2. Crear registro del batch
    const batchId = randomUUID();
    await pool.query(
      `INSERT INTO publicaciones_batch (id, total, status)
       VALUES ($1, $2, 'procesando')`,
      [batchId, items.length]
    );

    console.log(`[batch-form] batch=${batchId} creado con ${items.length} items`);

    // 3. Disparar loop async (fire and forget) y responder inmediatamente
    setImmediate(() => processBatch(batchId, items));

    return res.status(202).json({
      batch_id: batchId,
      total: items.length,
      status: "queued",
    });

  } catch (err) {
    console.error("[batch-form] error inesperado:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/publish/batch-status/:id
// ─────────────────────────────────────────────────────────────────
router.get("/batch-status/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const batchResult = await pool.query(
      `SELECT id, total, processed, succeeded, failed, status, created_at, finished_at
       FROM publicaciones_batch WHERE id = $1`,
      [id]
    );

    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: "batch_id no encontrado" });
    }

    const batch = batchResult.rows[0];

    // Traer los items del batch en orden
    const itemsResult = await pool.query(
      `SELECT id, batch_index, titulo, ml_id, permalink, status,
              requiere_revision, motivo_revision, error_msg
       FROM publicaciones_masivas
       WHERE batch_id = $1
       ORDER BY batch_index ASC NULLS LAST, id ASC`,
      [id]
    );

    return res.json({
      batch_id: batch.id,
      total: batch.total,
      processed: batch.processed,
      succeeded: batch.succeeded,
      failed: batch.failed,
      status: batch.status,
      created_at: batch.created_at,
      finished_at: batch.finished_at,
      items: itemsResult.rows,
    });

  } catch (err) {
    console.error("[batch-status] error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Parsea el multipart al formato esperado.
 *
 * Contrato:
 *   - files: campo "photo" repetido N veces
 *   - body.prices: JSON string con array de precios paralelo a las fotos
 *     ej: prices='[8000, 8500, 12000]'
 */
function parseBatchItems(files, body) {
  const photos = (files || []).filter(f => f.fieldname === "photo");

  let prices = [];
  if (body?.prices) {
    try {
      prices = JSON.parse(body.prices);
      if (!Array.isArray(prices)) {
        throw new Error("'prices' debe ser un array JSON");
      }
    } catch (err) {
      throw new Error(`No se pudo parsear 'prices' como JSON: ${err.message}`);
    }
  }

  if (photos.length !== prices.length) {
    throw new Error(
      `Cantidad de fotos (${photos.length}) no coincide con cantidad de precios (${prices.length})`
    );
  }

  return photos.map((file, idx) => ({
    photo: { buffer: file.buffer, mimeType: file.mimetype },
    price: parseFloat(prices[idx]),
  }));
}

/**
 * Loop principal del batch. Procesa items secuencialmente con throttle.
 * Se ejecuta en background vía setImmediate.
 */
async function processBatch(batchId, items) {
  console.log(`[processBatch] batch=${batchId} arrancando ${items.length} items`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    try {
      const result = await processOneItem({
        images: [item.photo], // 1 foto, processOneItem la duplica a 3
        price: item.price,
        stock: 1,
        batchId,
        batchIndex: i,
      });

      if (result.status === "publicado") succeeded++;
      else if (result.status === "error") failed++;
      // 'pendiente_manual' no cuenta como succeeded ni como failed estricto

    } catch (err) {
      // processOneItem captura sus propios errores, pero por las dudas
      console.error(`[processBatch] batch=${batchId} item=${i} excepción no capturada:`, err);
      failed++;
    }

    // Actualizar progreso después de cada item
    try {
      await pool.query(
        `UPDATE publicaciones_batch
         SET processed = $1, succeeded = $2, failed = $3
         WHERE id = $4`,
        [i + 1, succeeded, failed, batchId]
      );
    } catch (dbErr) {
      console.error(`[processBatch] no se pudo actualizar progreso:`, dbErr.message);
    }

    // Throttle entre items (excepto después del último)
    if (i < items.length - 1) {
      await sleep(THROTTLE_MS);
    }
  }

  // Marcar batch como completado
  try {
    await pool.query(
      `UPDATE publicaciones_batch
       SET status = 'completado', finished_at = NOW()
       WHERE id = $1`,
      [batchId]
    );
  } catch (dbErr) {
    console.error(`[processBatch] no se pudo marcar completado:`, dbErr.message);
  }

  console.log(
    `[processBatch] batch=${batchId} terminado. ok=${succeeded} fail=${failed} total=${items.length}`
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Llamar al arrancar el server (desde app.js, después de conectar DB).
 * Marca como 'interrumpido' cualquier batch que haya quedado en 'procesando'
 * por reinicio de Railway o crash del proceso.
 */
export async function cleanupOrphanedBatches() {
  try {
    const result = await pool.query(
      `UPDATE publicaciones_batch
       SET status = 'interrumpido', finished_at = NOW()
       WHERE status = 'procesando'
       RETURNING id`
    );
    if (result.rows.length > 0) {
      console.log(
        `[cleanupOrphanedBatches] ${result.rows.length} batch(es) marcados como interrumpidos:`,
        result.rows.map(r => r.id).join(", ")
      );
    }
  } catch (err) {
    console.error("[cleanupOrphanedBatches] falló:", err.message);
  }
}

export default router;