import express from "express";

const router = express.Router();

router.get("/attrs/:categoryId", async (req, res) => {
  try {
    const mlService = await import("../services/mercadolibre.service.js");

    // Reutilizamos uploadImageToML para ver que el servicio carga bien
    // pero lo que necesitamos es llamar a /categories/:id/attributes con token válido.
    // Como getValidToken no está exportado, pedimos a publishProductFromJSON que falle
    // y usamos otra ruta: hacemos el fetch directo usando el token vía loadTokensFromDB.

    const { loadTokensFromDB } = mlService;
    await loadTokensFromDB();

    // Hack: leer el token desde la DB directamente
    const pool = (await import("../db.js")).default;
    const result = await pool.query(
      `SELECT access_token FROM ml_tokens ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(500).json({ error: "No hay tokens en DB" });
    }

    const token = result.rows[0].access_token;

    const resp = await fetch(
      `https://api.mercadolibre.com/categories/${req.params.categoryId}/attributes`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await resp.json();

    if (!Array.isArray(data)) {
      return res.status(500).json({ error: "ML no devolvió array", raw: data });
    }

    const targets = [
      "BRAND",
      "MANUFACTURER",
      "COLLECTION",
      "EMPTY_GTIN_REASON",
      "VALUE_ADDED_TAX",
      "IMPORT_DUTY",
      "MATERIAL",
      "MODEL",
    ];

    const filtered = data
      .filter(a => targets.includes(a.id))
      .map(a => ({
        id: a.id,
        name: a.name,
        tags: a.tags,
        value_type: a.value_type,
        values: a.values?.slice(0, 15) || null,
      }));

    return res.json({ category: req.params.categoryId, attributes: filtered });
  } catch (err) {
    console.error("[debug/attrs] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;