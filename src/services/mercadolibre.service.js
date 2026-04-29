import { randomBytes, createHash } from "crypto";
import pool from "../db.js";

const ML_BASE = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.ar/authorization";
const ML_TOKEN = "https://api.mercadolibre.com/oauth/token";

const generateCodeVerifier = () => randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier) =>
  createHash("sha256").update(verifier).digest("base64url");

let tokens = {};

export const loadTokensFromDB = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM ml_tokens ORDER BY created_at DESC LIMIT 1`
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      tokens = {
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        expires_in: 21600,
        created_at: row.created_at.getTime(),
      };
      console.log("Token cargado desde DB");
    } else {
      console.log("No hay tokens guardados en DB");
    }
  } catch (error) {
    console.error("Error cargando tokens desde DB:", error);
  }
};

const getEnv = () => {
  return {
    clientId: process.env.ML_CLIENT_ID,
    clientSecret: process.env.ML_CLIENT_SECRET,
    redirectUri: process.env.ML_REDIRECT_URI,
  };
};

export const getAuthUrl = () => {
  const { clientId, redirectUri } = getEnv();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");
  const url = `${ML_AUTH}?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  return { url, codeVerifier, state };
};

export const exchangeCode = async (code, codeVerifier) => {
  const { clientId, clientSecret, redirectUri } = getEnv();
  try {
    const response = await fetch(ML_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    const result = await pool.query(
      `INSERT INTO ml_tokens (access_token, refresh_token, expires_at) VALUES ($1,$2,$3) RETURNING id`,
      [data.access_token, data.refresh_token, expiresAt]
    );
    console.log("INSERT ejecutado. ID creado:", result.rows[0]?.id);
    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: data.user_id,
      expires_in: data.expires_in,
      created_at: Date.now(),
    };
    return tokens;
  } catch (error) {
    console.error("Error exchanging code:", error);
    throw error;
  }
};

export const refreshToken = async () => {
  const { clientId, clientSecret } = getEnv();
  try {
    const response = await fetch(ML_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
      }),
    });
    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await pool.query(
      `UPDATE ml_tokens SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = (SELECT id FROM ml_tokens ORDER BY created_at DESC LIMIT 1)`,
      [data.access_token, data.refresh_token, expiresAt]
    );
    tokens = { ...tokens, access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, created_at: Date.now() };
    return tokens.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
};

const getValidToken = async () => {
  const now = Date.now();
  const elapsed = (now - tokens.created_at) / 1000;
  if (elapsed > tokens.expires_in - 60) {
    return await refreshToken();
  }
  return tokens.access_token;
};

export const getUserProfile = async () => {
  const token = await getValidToken();
  const response = await fetch(`${ML_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await response.json();
};

export const getUserProducts = async (userId, offset = 0, limit = 50) => {
  const token = await getValidToken();
  const response = await fetch(
    `${ML_BASE}/users/${userId}/items/search?offset=${offset}&limit=${limit}&status=active`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json();
  console.log(`ML items/search offset=${offset} total=${data.paging?.total} resultados=${data.results?.length}`);
  return data;
};

export const getProductDetail = async (itemId) => {
  const token = await getValidToken();
  const response = await fetch(`${ML_BASE}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await response.json();
};

export const getProductsBatch = async (itemIds) => {
  const token = await getValidToken();
  const idsParam = itemIds.join(",");
  const response = await fetch(`${ML_BASE}/items?ids=${idsParam}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await response.json();
};

export const getAllUserProducts = async (userId) => {
  const allProducts = [];
  let offset = 0;
  const limit = 50;
  let hasMore = true;
  while (hasMore) {
    const result = await getUserProducts(userId, offset, limit);
    if (result.results && result.results.length > 0) {
      const chunks = [];
      for (let i = 0; i < result.results.length; i += 20) {
        chunks.push(result.results.slice(i, i + 20));
      }
      for (const chunk of chunks) {
        const details = await getProductsBatch(chunk);
        const detailsArray = Array.isArray(details) ? details : [];
        for (const item of detailsArray) {
          if (item.body) {
            allProducts.push({
              id: item.body.id,
              nombre: item.body.title,
              descripcion: item.body.title,
              precio: item.body.price,
              imagen: item.body.thumbnail,
              moneda: item.body.currency_id,
              stock: item.body.available_quantity,
              estado: item.body.status,
              permalink: item.body.permalink,
              categoria: item.body.category_id,
            });
          }
        }
      }
      offset += limit;
      hasMore = result.results.length === limit;
    } else {
      hasMore = false;
    }
  }
  return allProducts;
};

export const saveProductsToDB = async (products) => {
  const results = { insertados: 0, actualizados: 0, eliminados: 0, errores: [] };
  for (const p of products) {
    try {
      const existing = await pool.query(`SELECT id FROM ml_products WHERE ml_id = $1`, [p.id]);
      await pool.query(
        `INSERT INTO ml_products (ml_id, title, price, currency_id, available_quantity, permalink, thumbnail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ml_id) DO UPDATE SET
           title = EXCLUDED.title, price = EXCLUDED.price, currency_id = EXCLUDED.currency_id,
           available_quantity = EXCLUDED.available_quantity, permalink = EXCLUDED.permalink, thumbnail = EXCLUDED.thumbnail`,
        [p.id, p.nombre, p.precio, p.moneda, p.stock, p.permalink, p.imagen]
      );
      if (existing.rows.length > 0) { results.actualizados++; } else { results.insertados++; }
    } catch (err) {
      results.errores.push({ producto: p.nombre, error: err.message });
    }
  }
  const mlIds = products.map(p => p.id);
  if (mlIds.length > 0) {
    const deleted = await pool.query(`DELETE FROM ml_products WHERE ml_id != ALL($1::text[]) RETURNING ml_id`, [mlIds]);
    results.eliminados = deleted.rowCount;
  }
  return results;
};
export const searchCatalogProduct = async (query) => {
  const token = await getValidToken();

  const response = await fetch(
    `https://api.mercadolibre.com/products/search?site_id=MLA&q=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await response.json();

  if (data.code === "PA_UNAUTHORIZED_RESULT_FROM_POLICIES") {
    throw new Error("Token de ML sin permisos para buscar en catálogo");
  }

  if (!data.results || data.results.length === 0) {
    return null;
  }

  // Devuelve el primer resultado con su catalog_product_id y nombre
  return {
    catalog_product_id: data.results[0].id,
    name: data.results[0].name,
    all_results: data.results.slice(0, 5).map((r) => ({
      id: r.id,
      name: r.name,
    })),
  };
};

const normalizar = (str) =>
  str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // saca acentos
    .replace(/[^\w\s]/g, " ") // saca guiones, comas, etc
    .replace(/\s+/g, " ")
    .trim();

const calcularSimilitud = (str1, str2) => {
  const s1 = normalizar(str1);
  const s2 = normalizar(str2);
  const words1 = s1.split(" ").filter(w => w.length > 2);
  if (words1.length === 0) return 0;
  const coincidencias = words1.filter(word => s2.includes(word)).length;
  return coincidencias / words1.length;
};
export const publishProductFromJSON = async (productData, visionResult = null) => {
  const token = await getValidToken();
  
  // Reglas estrictas para aceptar match de catálogo (evita publicar productos como si fueran otros)
  const UMBRAL_SIMILITUD = 0.75;        // antes 0.6 — más exigente
  const MIN_VISION_CONFIDENCE = 80;     // Vision debe estar bastante seguro
  const REQUIERE_BRAND_O_MODEL = true;  // producto debe tener marca o número identificable

  // 1. Buscar en catálogo
  let catalogMatch = null;
  let similitud = 0;
  let rechazoMotivo = null;

  try {
    const searchResult = await searchCatalogProduct(productData.title);
    if (searchResult && searchResult.all_results.length > 0) {
      similitud = calcularSimilitud(productData.title, searchResult.name);
      console.log(
        `[publishProductFromJSON] Búsqueda "${productData.title}" -> match "${searchResult.name}" (similitud: ${similitud.toFixed(2)})`
      );

      // Aplicar reglas estrictas
      // Aliases por bloque del schema (estilo opción B, consistente con vision.routes.js)
      const visionAF = visionResult?.action_figure || {};

      const cumpleSimilitud = similitud >= UMBRAL_SIMILITUD;
      const cumpleConfidence = !visionResult || visionResult.type_confidence >= MIN_VISION_CONFIDENCE;
      const tieneIdentificador = !visionResult || !REQUIERE_BRAND_O_MODEL ||
        (visionAF.manufacturer || visionAF.alphanumeric_model);

      if (cumpleSimilitud && cumpleConfidence && tieneIdentificador) {
        catalogMatch = searchResult;
        console.log(`[publishProductFromJSON] ✅ Match de catálogo aceptado`);
      } else {
        // Armar motivo de rechazo para debug/logging
        const razones = [];
        if (!cumpleSimilitud) razones.push(`similitud ${similitud.toFixed(2)} < ${UMBRAL_SIMILITUD}`);
        if (!cumpleConfidence) razones.push(`vision confidence ${visionResult.type_confidence} < ${MIN_VISION_CONFIDENCE}`);
        if (!tieneIdentificador) razones.push(`sin manufacturer ni alphanumeric_model`);
        rechazoMotivo = razones.join(" | ");
        console.log(`[publishProductFromJSON] ❌ Match rechazado: ${rechazoMotivo}`);
      }
    }
  } catch (err) {
    console.warn("[publishProductFromJSON] Search de catálogo falló:", err.message);
  }

  // 2. Si no hay match de catálogo (o fue rechazado) -> pendiente / fallback libre
  if (!catalogMatch) {
    return {
      requiere_revision_manual: true,
      motivo: "sin_match_catalogo",
      mensaje: rechazoMotivo
        ? `Match de catálogo rechazado: ${rechazoMotivo}`
        : `No se encontró match de catálogo para "${productData.title}"`,
    };
  }

  // 3. Traer info del catálogo para obtener category_id
  // Obtener category_id del catálogo (necesario para el POST)
  let categoryIdFromCatalog = null;
  try {
    const catalogInfo = await getCatalogProductInfo(catalogMatch.catalog_product_id);

    // ML no siempre expone category_id en /products/:id. Probamos campos directos primero.
    categoryIdFromCatalog =
      catalogInfo.category_id ||
      catalogInfo.settings?.category_id ||
      null;

    // Fallback: domain_discovery mapea título -> category_id (es lo que usa ML web).
    if (!categoryIdFromCatalog) {
      const discoveryResp = await fetch(
        `${ML_BASE}/sites/MLA/domain_discovery/search?limit=1&q=${encodeURIComponent(productData.title)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const discoveryData = await discoveryResp.json();
      if (Array.isArray(discoveryData) && discoveryData.length > 0) {
        categoryIdFromCatalog = discoveryData[0].category_id || null;
      }
    }
  } catch (err) {
    console.warn("[publishProductFromJSON] No se pudo obtener category_id:", err.message);
  }

  // 4. Publicar con catalog_product_id + category_id
  const item = {
    catalog_product_id: catalogMatch.catalog_product_id,
    catalog_listing: true,
    price: productData.price,
    currency_id: "ARS",
    available_quantity: productData.stock || 1,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_pro",
    condition: productData.condition || "new",
  };

  if (categoryIdFromCatalog) {
    item.category_id = categoryIdFromCatalog;
  }

  // Pictures solo si hay (ML puede tomar las del catálogo si no mandás)
  if (productData.pictures && productData.pictures.length > 0) {
    item.pictures = productData.pictures.map(url => ({ source: url }));
  }

  const response = await fetch(`${ML_BASE}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `ML Error: ${data.message} — ${JSON.stringify(data.cause)}`
    );
  }

  return {
    ...data,
    catalog_match_name: catalogMatch.name,
  };
};

/**
 * Publica un producto en MercadoLibre como publicación LIBRE (sin catálogo).
 * Se usa como fallback cuando no hay match de catálogo.
 * 
 * Sube la foto del usuario a ML y arma el payload con atributos inferidos por Vision.
 * 
 * @param {Object} productData - { title, price, stock, condition, description }
 * @param {Buffer} imageBuffer - Buffer de la imagen del usuario
 * @param {string} mimeType - MIME type de la imagen
 * @param {Object} visionResult - Resultado completo de Claude Vision (para atributos)
 * @returns {Promise<Object>} item publicado con ml_id, permalink, etc.
 * 
 * */
// ============================================================================
// HELPER: armar descripción enriquecida
// Bloque 1: descripción de Vision mejorada con Claude (tono conservado, mejor SEO)
// Bloque 2: atributos técnicos en bullets
// Bloque 3: disclaimer condicional (solo si vintage/usado)
// ============================================================================
const improveDescriptionWithClaude = async (rawDescription, visionAttrs) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[improveDescription] ANTHROPIC_API_KEY no configurada, devuelvo texto original");
    return rawDescription;
  }

  // visionAttrs ahora viene como merge de visionCommon + visionAF
  const character = visionAttrs.character || "el producto";
  const franchise = visionAttrs.franchise || "";
  const manufacturer = visionAttrs.manufacturer || "";

  const prompt = `Sos un copywriter especializado en publicaciones de coleccionables en MercadoLibre Argentina.

Te paso una descripción generada por IA y necesito que la mejores:

DESCRIPCIÓN ORIGINAL:
"${rawDescription}"

CONTEXTO:
- Personaje: ${character}
- Franquicia: ${franchise}
- Fabricante: ${manufacturer}

INSTRUCCIONES:
- Conservá el tono informativo y el contenido factual
- Mejorá redacción y fluidez
- Agregá 1-2 palabras clave útiles para SEO en MercadoLibre (ej: "coleccionable", "original", "nostalgia", el nombre del personaje)
- Máximo 4 oraciones, mínimo 2
- Sin emojis, sin frases de marketing exagerado ("increíble", "imperdible")
- Sin listas ni bullets, solo párrafo corrido
- Devolvé SOLO el texto mejorado, sin comillas, sin "aquí tienes:", sin nada extra`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.type === "error") {
      console.warn("[improveDescription] Claude error, uso original:", data.error?.message);
      return rawDescription;
    }
    const improved = data.content?.[0]?.text?.trim() || rawDescription;
    console.log("[improveDescription] ✅ Texto mejorado");
    return improved;
  } catch (err) {
    console.warn("[improveDescription] Falló, uso original:", err.message);
    return rawDescription;
  }
};

const buildEnrichedDescription = async (productData, visionResult) => {
  // Aliases por bloque del schema nuevo
  const visionCommon = visionResult?.common || {};
  const visionAF = visionResult?.action_figure || {};

  const rawText = visionCommon.description || productData.description || "Producto coleccionable.";

  // BLOQUE 1: descripción narrativa mejorada
  // Pasamos un merge de common + AF para que improveDescription tenga todo el contexto
  const improvedText = await improveDescriptionWithClaude(rawText, { ...visionCommon, ...visionAF });

  // BLOQUE 2: atributos técnicos
  const techLines = [];
  if (visionAF.manufacturer) techLines.push(`<strong>Marca:</strong> ${visionAF.manufacturer}`);
  if (visionAF.character) techLines.push(`<strong>Personaje:</strong> ${visionAF.character}`);
  if (visionAF.franchise) techLines.push(`<strong>Colección:</strong> ${visionAF.franchise}`);
  if (visionAF.product_line) techLines.push(`<strong>Línea:</strong> ${visionAF.product_line}`);
  if (visionAF.alphanumeric_model) techLines.push(`<strong>Modelo:</strong> ${visionAF.alphanumeric_model}`);
  if (visionCommon.material) techLines.push(`<strong>Material:</strong> ${visionCommon.material}`);
  if (visionCommon.approx_height_cm) techLines.push(`<strong>Altura aproximada:</strong> ${visionCommon.approx_height_cm} cm`);
  if (visionCommon.manufacturing_year) techLines.push(`<strong>Año:</strong> ${visionCommon.manufacturing_year}`);

  const packageMap = {
    sealed_box: "Caja sellada original",
    open_box: "Con caja, abierta",
    loose: "Sin caja (loose)",
    no_package: "Sin empaque",
  };
  if (visionCommon.package_condition && packageMap[visionCommon.package_condition]) {
    techLines.push(`<strong>Estado del empaque:</strong> ${packageMap[visionCommon.package_condition]}`);
  }

  const techBlock = techLines.length > 0
    ? `<br><br><strong>--- DETALLES ---</strong><br>${techLines.join("<br>")}`
    : "";

  // BLOQUE 3: disclaimer condicional (solo vintage / usado)
  const detectedCondition = visionCommon.condition;
  const isVintageOrUsed = detectedCondition === "used" || detectedCondition === "damaged";

  const disclaimer = isVintageOrUsed
    ? `<br><br><strong>--- IMPORTANTE ---</strong><br>Producto usado/vintage. Las fotos forman parte de la descripción y reflejan el estado real del producto. Ante cualquier duda, consultá antes de comprar.`
    : "";

  const htmlContent = `<p>${improvedText}</p>${techBlock}${disclaimer}`;
  const plainContent = htmlContent
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  return {
    plain_text: plainContent,
    html: htmlContent,
  };
};
export const publishProductAsFreeListing = async (
  productData,
  images,
  visionResult
) => {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("publishProductAsFreeListing requiere al menos 1 imagen en `images`");
  }
  const token = await getValidToken();

  // Identificador único corto para evitar agrupación de variantes en ML
  // Toma los últimos 5 dígitos del timestamp → ej: "47321"
  const uniqueId = Date.now().toString().slice(-5);

  // ========================================================================
  // 1. DISCOVERY: pedir top 5 y elegir una categoría "buena"
  // ========================================================================
  console.log("[publishAsFreeListing] Buscando categoría...");
  const discoveryResp = await fetch(
    `${ML_BASE}/sites/MLA/domain_discovery/search?limit=5&q=${encodeURIComponent(productData.title)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const discoveryData = await discoveryResp.json();

  if (!Array.isArray(discoveryData) || discoveryData.length === 0) {
    throw new Error("domain_discovery no devolvió categorías");
  }

  // Dominios "buenos" para figuras/coleccionables (en orden de preferencia)
  const PREFERRED_DOMAINS = [
    "MLA-ACTION_FIGURES",
    "MLA-COLLECTIBLE_FIGURES",
    "MLA-DOLLS",
    "MLA-DOLL_AND_ACTION_FIGURE_SETS",
  ];

  // Dominios a evitar para coleccionables
  const BLOCKED_DOMAINS = [
    "MLA-SCULPTURES_AND_STATUES",
  ];

  // Buscar preferido en orden
  let chosen = null;
  for (const preferred of PREFERRED_DOMAINS) {
    const match = discoveryData.find(d => d.domain_id === preferred);
    if (match) {
      chosen = match;
      break;
    }
  }

  // Si no hay preferido, tomar el primero que no esté bloqueado
  if (!chosen) {
    chosen = discoveryData.find(d => !BLOCKED_DOMAINS.includes(d.domain_id));
  }

  // Último recurso: el top match (podría ser bloqueado, pero mejor eso que nada)
  if (!chosen) {
    chosen = discoveryData[0];
    console.warn(`[publishAsFreeListing] ⚠️ Usando categoría bloqueada ${chosen.domain_id} como último recurso`);
  }

  const categoryId = chosen.category_id;
  console.log(`[publishAsFreeListing] ✅ Categoría elegida: ${categoryId} (${chosen.category_name}) — domain: ${chosen.domain_id}`);

  // ========================================================================
  // 2. Subir las fotos del usuario (Promise.allSettled — tolera fallas parciales)
  // ========================================================================
  console.log(`[publishAsFreeListing] Subiendo ${images.length} foto(s)...`);
  const uploadResults = await Promise.allSettled(
    images.map(img => uploadPictureToML(img.buffer, img.mimeType))
  );

  const successfulIds = [];
  const failedIndexes = [];
  uploadResults.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value) {
      const id = typeof r.value === "object" ? r.value.id : r.value;
      if (id) successfulIds.push(id);
      else failedIndexes.push(idx);
    } else {
      failedIndexes.push(idx);
      console.error(`[publishAsFreeListing] ❌ Foto ${idx + 1} falló:`, r.reason?.message || r.reason);
    }
  });

  if (successfulIds.length === 0) {
    throw new Error(`Todas las ${images.length} fotos fallaron al subirse a ML`);
  }

  if (failedIndexes.length > 0) {
    console.warn(
      `[publishAsFreeListing] ⚠️ ${failedIndexes.length}/${images.length} fotos fallaron. ` +
      `Publicando con ${successfulIds.length} foto(s).`
    );
  } else {
    console.log(`[publishAsFreeListing] ✅ ${successfulIds.length} fotos subidas correctamente`);
  }

  // ========================================================================
  // 3. Construir atributos combinando: pre-rellenados de discovery + Vision + defaults
  // ========================================================================
  // Aliases por bloque del schema nuevo (consistente con vision.routes.js)
  const visionCommon = visionResult?.common || {};
  const visionAF = visionResult?.action_figure || {};
  const preFilled = chosen.attributes || [];

  // Lista de atributos "inseguros" que ML pre-rellena asumiendo el catalog de
  // un producto premium, pero que pueden no coincidir con el producto físico real.
  // Para estos: solo confiamos en lo que Vision detectó. Si Vision dice null, omitimos.
  const UNSAFE_PREFILLED = new Set([
    "BRAND",
    "MANUFACTURER",
    "LINE",
    "MODEL",
    "ALPHANUMERIC_MODEL",
    "CHARACTER_VERSION",
    "MATERIAL",
  ]);

  // Empezamos con los atributos que ML pre-rellenó, EXCLUYENDO los inseguros.
  // Descartamos value_id (rompe agrupación a catálogo) y filtramos por categoría.
  const attributesMap = new Map();
  preFilled.forEach(a => {
    if (UNSAFE_PREFILLED.has(a.id)) {
      console.log(`[publishAsFreeListing] ⚠️ Descartando pre-rellenado inseguro: ${a.id}=${a.value_name}`);
      return;
    }
    if (a.value_name) {
      attributesMap.set(a.id, { id: a.id, value_name: a.value_name });
    }
  });

  // Helper para agregar si no existe ya
  const addIfMissing = (attr) => {
    if (!attributesMap.has(attr.id)) {
      attributesMap.set(attr.id, attr);
    }
  };

  // Completar con Vision SOLO si Vision realmente detectó algo (no null)
  // Excepción: si el producto viene loose (sin caja), NO confiamos en la marca
  // porque no podemos verificar autenticidad. Mandamos "Sin marca" para evitar
  // que ML exija GTIN obligatorio (lo activan ciertas marcas conocidas).
  const isLoose = visionCommon.package_condition === "loose";
  if (visionAF.manufacturer && !isLoose) {
    addIfMissing({ id: "BRAND", value_name: visionAF.manufacturer });
  } else if (isLoose && visionAF.manufacturer) {
    console.log(`[publishAsFreeListing] ℹ️ Producto loose, ignorando manufacturer="${visionAF.manufacturer}" detectado por Vision (evita exigencia de GTIN)`);
  }

  if (visionAF.alphanumeric_model) {
    addIfMissing({ id: "MODEL", value_name: visionAF.alphanumeric_model });
    addIfMissing({ id: "ALPHANUMERIC_MODEL", value_name: visionAF.alphanumeric_model });
  }
  if (visionAF.character) addIfMissing({ id: "CHARACTER", value_name: visionAF.character });
  if (visionAF.franchise) addIfMissing({ id: "COLLECTION", value_name: visionAF.franchise });
  if (visionAF.product_line) addIfMissing({ id: "LINE", value_name: visionAF.product_line });

  if (visionCommon.material) {
    addIfMissing({ id: "MATERIAL", value_name: visionCommon.material });
    addIfMissing({ id: "MATERIALS", value_name: visionCommon.material });
  }

  // === Atributos secundarios para mejorar ranking ===
  // Dimensiones del producto (distintas de SELLER_PACKAGE_*)
  if (visionCommon.approx_height_cm) addIfMissing({ id: "HEIGHT", value_name: `${visionCommon.approx_height_cm} cm` });
  if (visionCommon.approx_width_cm) addIfMissing({ id: "WIDTH", value_name: `${visionCommon.approx_width_cm} cm` });
  if (visionCommon.approx_depth_cm) addIfMissing({ id: "DEPTH", value_name: `${visionCommon.approx_depth_cm} cm` });

  // Edad recomendada
  if (visionAF.recommended_age) {
    addIfMissing({ id: "MIN_AGE_RECOMMENDED", value_name: String(visionAF.recommended_age) });
    addIfMissing({ id: "RECOMMENDED_AGE", value_name: String(visionAF.recommended_age) });
  }

  // Booleanos detectados con certeza → "Sí" o "No"
  // Solo mandamos si Vision dio true/false explícito (no null)
  if (visionAF.is_articulated === true) addIfMissing({ id: "IS_ARTICULATED", value_name: "Sí" });
  else if (visionAF.is_articulated === false) addIfMissing({ id: "IS_ARTICULATED", value_name: "No" });

  if (visionAF.is_bobblehead === true) addIfMissing({ id: "IS_BOBBLE_HEAD", value_name: "Sí" });
  else if (visionAF.is_bobblehead === false) addIfMissing({ id: "IS_BOBBLE_HEAD", value_name: "No" });

  if (visionAF.has_remote_control === true) addIfMissing({ id: "WITH_REMOTE_CONTROL", value_name: "Sí" });
  else if (visionAF.has_remote_control === false) addIfMissing({ id: "WITH_REMOTE_CONTROL", value_name: "No" });

  if (visionAF.includes_accessories === true) addIfMissing({ id: "INCLUDES_ACCESSORIES", value_name: "Sí" });
  else if (visionAF.includes_accessories === false) addIfMissing({ id: "INCLUDES_ACCESSORIES", value_name: "No" });

  if (visionAF.has_interchangeable_parts === true) addIfMissing({ id: "WITH_INTERCHANGEABLE_PARTS", value_name: "Sí" });
  else if (visionAF.has_interchangeable_parts === false) addIfMissing({ id: "WITH_INTERCHANGEABLE_PARTS", value_name: "No" });

  if (visionAF.has_lights === true) addIfMissing({ id: "WITH_LIGHTS", value_name: "Sí" });
  else if (visionAF.has_lights === false) addIfMissing({ id: "WITH_LIGHTS", value_name: "No" });

  // Es coleccionable: siempre Sí (estás vendiendo coleccionables)
  addIfMissing({ id: "IS_COLLECTIBLE", value_name: "Sí" });

  // Texto libre solo si Vision detectó
  if (visionAF.scale) addIfMissing({ id: "SCALE", value_name: visionAF.scale });
  if (visionAF.play_type) addIfMissing({ id: "PLAY_TYPE", value_name: visionAF.play_type });
  if (visionAF.power_type) addIfMissing({ id: "POWER_TYPE", value_name: visionAF.power_type });

  // Año de fabricación
  if (visionCommon.manufacturing_year) {
    addIfMissing({ id: "MANUFACTURING_YEAR", value_name: String(visionCommon.manufacturing_year) });
  }

  // Fallbacks finales para atributos que ML suele exigir como obligatorios.
  // Si llegamos acá sin marca, mandamos "Sin marca" (más honesto que inventar).
  // Si llegamos sin modelo, mandamos "N/A".
  // Esto se ejecuta DESPUÉS de los Vision-detected, así que no pisa nada bueno.
  addIfMissing({ id: "BRAND", value_name: "Sin marca" });
  addIfMissing({ id: "MODEL", value_name: "N/A" });
  addIfMissing({ id: "ALPHANUMERIC_MODEL", value_name: "N/A" });
  // Fallback nuevo para COLLECTION — ML lo exige como obligatorio en MLA3422.
  // Si Vision no detectó franchise, mandamos "Otra" para no bloquear publicación.
  addIfMissing({ id: "COLLECTION", value_name: "Otra" });

  // Obligatorios con value_id conocidos (de debug)
  addIfMissing({ id: "EMPTY_GTIN_REASON", value_id: "17055160" });  // "El producto no tiene código registrado"
  addIfMissing({ id: "VALUE_ADDED_TAX", value_id: "48405909" });     // "21 %"
  addIfMissing({ id: "IMPORT_DUTY", value_id: "49553239" });          // "0 %"

  // Dimensiones de paquete (defaults para figura ~10cm)
  addIfMissing({ id: "SELLER_PACKAGE_HEIGHT", value_name: "15 cm" });
  addIfMissing({ id: "SELLER_PACKAGE_WIDTH", value_name: "10 cm" });
  addIfMissing({ id: "SELLER_PACKAGE_LENGTH", value_name: "15 cm" });
  addIfMissing({ id: "SELLER_PACKAGE_WEIGHT", value_name: "200 g" });

  const attributes = Array.from(attributesMap.values());

  // ========================================================================
  // 4. Payload — omitimos title (ML lo arma desde family_name + attributes)
  // ========================================================================
  // Armar descripción enriquecida (Vision mejorado + atributos + disclaimer)
  console.log("[publishAsFreeListing] Generando descripción enriquecida...");
  const enrichedDescription = await buildEnrichedDescription(productData, visionResult);

  // family_name único — combina personaje + datos distintivos + ID corto
  // El ID al final garantiza que ML no agrupe esta publicación con otras del mismo personaje.
  const baseFamily = visionAF.character || visionAF.franchise || "Figura coleccionable";
  const distinctiveBits = [
    visionAF.alphanumeric_model,
    visionCommon.manufacturing_year,
    visionAF.manufacturer,
  ].filter(Boolean).join(" ");

  const familyName = distinctiveBits
    ? `${baseFamily} ${distinctiveBits} #${uniqueId}`
    : `${baseFamily} #${uniqueId}`;

  console.log(`[publishAsFreeListing] family_name único: "${familyName}"`);

  const item = {
    family_name: familyName,
    category_id: categoryId,
    price: productData.price,
    currency_id: "ARS",
    available_quantity: productData.stock || 1,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_pro",
    condition: productData.condition || "new",
    description: enrichedDescription,
    pictures: successfulIds.map(id => ({ id })),
    attributes: attributes,
    shipping: {
      mode: "me2",
      local_pick_up: true,
      free_shipping: false,
      tags: ["self_service_in"],
    },
  };

  console.log("[publishAsFreeListing] PAYLOAD enviado:", JSON.stringify(item, null, 2));

  // ========================================================================
  // 5. Publicar
  // ========================================================================
  const response = await fetch(`${ML_BASE}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error(`[publishAsFreeListing] ❌ ML rechazó. Consultando atributos obligatorios de ${categoryId}...`);

    try {
      const attrsResp = await fetch(
        `${ML_BASE}/categories/${categoryId}/attributes`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const attrsData = await attrsResp.json();
      const requiredAttrs = Array.isArray(attrsData)
        ? attrsData.filter(a => a.tags?.required || a.tags?.catalog_required || a.tags?.conditional_required)
        : [];

      console.error(`[publishAsFreeListing] Atributos obligatorios de ${categoryId}:`);
      requiredAttrs.forEach(a => {
        console.error(`  - ${a.id} (${a.name}) — tags: ${JSON.stringify(a.tags)}`);
      });
    } catch (attrErr) {
      console.error("[publishAsFreeListing] No pude consultar attrs:", attrErr.message);
    }

    console.error(`[publishAsFreeListing] Respuesta completa de ML:`, JSON.stringify(data, null, 2));

    throw new Error(
      `ML rechazó publicación libre: ${data.message || data.error} — ${JSON.stringify(data.cause || data)}`
    );
  }

  console.log(`[publishAsFreeListing] ✅ Publicado: ${data.id}`);

  // ========================================================================
  // 6. SEGUNDA LLAMADA: setear descripción en el endpoint específico de ML
  // ML acepta description en el POST inicial pero NO la guarda. Hay que
  // llamar al endpoint /items/{id}/description aparte para que la persista.
  // ========================================================================
  try {
    // ML rechaza el campo html aquí. Solo aceptamos plain_text limpio.
    const plainTextOnly = typeof enrichedDescription === "object"
      ? enrichedDescription.plain_text
      : enrichedDescription;

    const descBody = { plain_text: plainTextOnly };

    const descResp = await fetch(`${ML_BASE}/items/${data.id}/description`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(descBody),
    });

    if (descResp.ok) {
      console.log(`[publishAsFreeListing] ✅ Descripción seteada en ${data.id}`);
    } else {
      const descErr = await descResp.json();
      console.error(`[publishAsFreeListing] ⚠️ Descripción falló:`, JSON.stringify(descErr));
      // No lanzamos error — el item ya está publicado, solo le falta descripción.
    }
  } catch (descErr) {
    console.error(`[publishAsFreeListing] ⚠️ Excepción seteando descripción:`, descErr.message);
  }

  return {
    ...data,
    publication_type: "free_listing",
    category_id: categoryId,
  };
};
export const getTokens = () => tokens;
export const setTokens = (newTokens) => { tokens = newTokens; };
export const getListingTypes = async (categoryId) => {
  const token = await getValidToken();
  const response = await fetch(
    `${ML_BASE}/sites/MLA/listing_types?category_id=${categoryId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return await response.json();
};
export const getCatalogProductInfo = async (catalogProductId) => {
  const token = await getValidToken();
  const response = await fetch(`${ML_BASE}/products/${catalogProductId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await response.json();
};

// ============================================================================
// DEBUG: inspeccionar lo que ML guardó de un item ya publicado
// ============================================================================
export const debugGetItem = async (mlId) => {
  const token = await getValidToken();
  const response = await fetch(`${ML_BASE}/items/${mlId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await response.json();
};

export const debugGetDescription = async (mlId) => {
  const token = await getValidToken();
  const response = await fetch(`${ML_BASE}/items/${mlId}/description`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await response.json();
};

/**
 * Sube una imagen a MercadoLibre y devuelve el picture_id
 * que después se usa al crear una publicación libre.
 * 
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} mimeType - MIME type (ej: "image/jpeg", "image/png")
 * @returns {Promise<string>} picture_id generado por ML
 */
export const uploadPictureToML = async (imageBuffer, mimeType) => {
  const token = await getValidToken();

  // ML espera multipart/form-data con un campo "file"
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: mimeType });
  
  // Nombre del archivo (ML lo requiere, aunque sea genérico)
  const extension = mimeType.split("/")[1] || "jpg";
  formData.append("file", blob, `upload.${extension}`);

  const response = await fetch(`${ML_BASE}/pictures/items/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // ⚠️ NO poner Content-Type manual — fetch lo setea automáticamente 
      // con el boundary correcto cuando usás FormData
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || !data.id) {
    throw new Error(
      `Upload de imagen a ML falló: ${data.message || JSON.stringify(data)}`
    );
  }

  console.log(`[uploadPictureToML] Imagen subida: id=${data.id}`);
  return data.id;
};

export const validateItem = async (itemData) => {
  const token = await getValidToken();
  const response = await fetch(`${ML_BASE}/items/validate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(itemData),
  });
  const text = await response.text();
  return { status: response.status, body: text };
};

export const publicarMasivo = async (productos, descripcionDefault) => {
  const resultados = { publicados: [], fallidos: [], pendientes_revision: [] };

  for (const producto of productos) {
    const descripcion = producto.descripcion || descripcionDefault;
    const conditionFinal = "new";
    const requiereRevision = producto.condition === "used";
    const motivoRevision = requiereRevision
      ? "condicion original: usado, publicado como nuevo para revision posterior"
      : null;

    try {
      const productData = {
        title: producto.title,
        price: producto.price,
        stock: producto.stock || 1,
        condition: conditionFinal,
        description: descripcion,
        pictures: producto.pictures || [],
        attributes: producto.attributes || [],
        category_id: producto.category_id,
      };

     const mlResponse = await publishProductFromJSON(productData);

      // Caso: no se encontró match de catálogo -> pendiente manual
      if (mlResponse.requiere_revision_manual) {
        await pool.query(
          `INSERT INTO publicaciones_masivas 
           (titulo, status, condition, price, requiere_revision, motivo_revision)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            producto.title,
            "pendiente_manual",
            conditionFinal,
            producto.price,
            true,
            mlResponse.motivo,
          ]
        );
        resultados.pendientes_revision.push({
          title: producto.title,
          motivo: mlResponse.mensaje,
        });
        continue;
      }

      // Caso: publicado ok
      await pool.query(
        `INSERT INTO publicaciones_masivas 
         (titulo, ml_id, status, permalink, condition, price, requiere_revision, motivo_revision, confianza_condicion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          producto.title,
          mlResponse.id,
          "ok",
          mlResponse.permalink,
          conditionFinal,
          producto.price,
          requiereRevision,
          motivoRevision,
          requiereRevision ? 60 : 95,
        ]
      );

      const entry = { title: producto.title, ml_id: mlResponse.id, permalink: mlResponse.permalink };
      if (requiereRevision) {
        resultados.pendientes_revision.push({ ...entry, motivo: motivoRevision });
      } else {
        resultados.publicados.push(entry);
      }

    } catch (error) {
      await pool.query(
        `INSERT INTO publicaciones_masivas (titulo, status, error_msg, condition, price)
         VALUES ($1,$2,$3,$4,$5)`,
        [producto.title, "error", error.message, conditionFinal, producto.price]
      );
      resultados.fallidos.push({ title: producto.title, error: error.message });
    }
  }

  return resultados;
};
/**
 * Sube una imagen a MercadoLibre y devuelve el picture_id.
 * Se usa para el fallback de publicación libre.
 */
export const uploadImageToML = async (imageBuffer, mimetype = "image/jpeg") => {
  const token = await getValidToken();
  
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: mimetype });
  formData.append("file", blob, "image.jpg");

  const response = await fetch("https://api.mercadolibre.com/pictures/items/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[uploadImageToML] ❌ Error ML:", data);
    throw new Error(`ML upload failed: ${JSON.stringify(data)}`);
  }

  console.log("[uploadImageToML] ✅ Imagen subida, picture_id:", data.id);

  return {
    id: data.id,
    url: data.variations?.[0]?.url || null
  };
};


// ============================================================================
// PUBLICACIÓN DE CÓMICS — flujo dedicado para item_type="comic"
// Categoría hardcodeada: MLA1955 (Revistas), porque domain_discovery devuelve
// resultados inservibles para cómics (los manda a Trading Cards, Ebooks, etc).
// ============================================================================

const COMIC_CATEGORY_ID = "MLA1955"; // Revistas — bucket donde ML mete cómics
const TRADING_CARDS_CATEGORY_ID = "MLA3390";

// Mapping de brand del enum de Vision al value_id del enum de ML
const TCG_BRAND_VALUE_IDS = {
  "Magic The Gathering": "15877174",
  "Pokémon": null,        // ML acepta "Pokémon" como string libre, sin value_id forzado
  "Yu-Gi-Oh!": null
};
/**
 * Construye el array de atributos para publicar un cómic en MLA1955.
 * Combina valores detectados por Vision + hardcodes para campos fijos.
 */
const buildComicAttributes = (visionResult) => {
  const c = visionResult?.comic || {};
  const attrs = [];

  // === Atributos requeridos (catalog_required / required) ===

  // MAGAZINE_NAME: nombre de la serie/revista
  if (c.title) {
    attrs.push({ id: "MAGAZINE_NAME", value_name: c.title });
  } else {
    attrs.push({ id: "MAGAZINE_NAME", value_name: "Sin nombre" });
  }

  // PUBLISHER (editorial) y BRAND (marca) — en cómics suelen coincidir
  const publisherValue = c.publisher || "Sin editorial";
  attrs.push({ id: "PUBLISHER", value_name: publisherValue });
  attrs.push({ id: "BRAND", value_name: publisherValue });

  // MODEL: en revistas ML usa "Revista" como string genérico
  attrs.push({ id: "MODEL", value_name: "Revista" });

  // FORMAT: hardcode "Físico" (id 2431740)
  attrs.push({ id: "FORMAT", value_id: "2431740" });

  // GENRE: "Interés general" como fallback
  attrs.push({ id: "GENRE", value_name: c.genre || "Interés general" });

  // UNITS_PER_PACK: por default 1
  attrs.push({ id: "UNITS_PER_PACK", value_name: "1" });

 // GTIN vacío + razón
  // ML exige GTIN explícito como conditional_required para marcas conocidas (Konami, WotC).
  // El campo es multivalued, hay que mandarlo como `values: []` (array vacío) + EMPTY_GTIN_REASON.
  attrs.push({ id: "GTIN", values: [] });
  attrs.push({ id: "EMPTY_GTIN_REASON", value_id: "17055160" });

  // Impuestos (igual que figuras)
  attrs.push({ id: "VALUE_ADDED_TAX", value_id: "48405909" }); // "21 %"
  attrs.push({ id: "IMPORT_DUTY", value_id: "49553239" }); // "0 %"

  // === Atributos opcionales pero útiles para SEO/ranking ===

  if (c.issue_number) {
    attrs.push({ id: "ISSUE_NUMBER", value_name: c.issue_number });
  }

  if (c.year) {
    attrs.push({ id: "PUBLICATION_YEAR", value_name: String(c.year) });
  }

  if (c.language) {
    const langMap = { es: "Español", en: "Inglés", pt: "Portugués", jp: "Japonés" };
    attrs.push({ id: "LANGUAGE", value_name: langMap[c.language] || "Español" });
  }

  if (c.writer) attrs.push({ id: "AUTHOR", value_name: c.writer });
  if (c.artist) attrs.push({ id: "ILLUSTRATOR", value_name: c.artist });

  // Dimensiones del paquete (obligatorias en MLA1955)
  // Defaults razonables para un cómic single issue
  attrs.push({ id: "SELLER_PACKAGE_HEIGHT", value_name: "1 cm" });
  attrs.push({ id: "SELLER_PACKAGE_WIDTH", value_name: "17 cm" });
  attrs.push({ id: "SELLER_PACKAGE_LENGTH", value_name: "26 cm" });
  attrs.push({ id: "SELLER_PACKAGE_WEIGHT", value_name: "150 g" });

  return attrs;
};
/**
 * Construye los atributos de ML para una carta TCG (MLA3390).
 * Atributos requeridos: BRAND, CARD_DECKS_NUMBER, GTIN, EMPTY_GTIN_REASON,
 * VALUE_ADDED_TAX, IMPORT_DUTY.
 */
const buildTradingCardAttributes = (visionResult) => {
  const tc = visionResult?.trading_cards || {};
  const attrs = [];

  // BRAND — required
  if (tc.brand) {
    const brandAttr = { id: "BRAND", value_name: tc.brand };
    if (TCG_BRAND_VALUE_IDS[tc.brand]) {
      brandAttr.value_id = TCG_BRAND_VALUE_IDS[tc.brand];
    }
    attrs.push(brandAttr);
  }

  // CARD_DECKS_NUMBER — default 1, override si lote
  const decks = tc.units_per_pack && tc.units_per_pack > 0 ? tc.units_per_pack : 1;
  attrs.push({ id: "CARD_DECKS_NUMBER", value_name: String(decks) });

  // GTIN vacío + razón
  attrs.push({ id: "EMPTY_GTIN_REASON", value_id: "17055160" });

  // Fiscal monotributo / exento
  attrs.push({ id: "VALUE_ADDED_TAX", value_id: "55043032" }); // "Exento"
  attrs.push({ id: "IMPORT_DUTY", value_id: "49553239" });     // "0 %"

  // Opcionales
  if (tc.language) attrs.push({ id: "LANGUAGE", value_name: tc.language });
  if (tc.is_foil === true) attrs.push({ id: "IS_FOIL_CARD", value_name: "Sí" });
  else if (tc.is_foil === false) attrs.push({ id: "IS_FOIL_CARD", value_name: "No" });
  if (tc.card_name) attrs.push({ id: "TRADING_CARD_NAME", value_name: tc.card_name });

  // Dimensiones de paquete (defaults para carta TCG individual)
  attrs.push({ id: "SELLER_PACKAGE_HEIGHT", value_name: "1 cm" });
  attrs.push({ id: "SELLER_PACKAGE_WIDTH", value_name: "7 cm" });
  attrs.push({ id: "SELLER_PACKAGE_LENGTH", value_name: "10 cm" });
  attrs.push({ id: "SELLER_PACKAGE_WEIGHT", value_name: "20 g" });

  return attrs;
};

/**
 * Publica un cómic en MercadoLibre como publicación libre.
 * Categoría forzada: MLA1955 (Revistas).
 */
export const publishComicAsFreeListing = async (productData, images, visionResult) => {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("publishComicAsFreeListing requiere al menos 1 imagen");
  }

  const token = await getValidToken();
  const visionCommon = visionResult?.common || {};
  const visionComic = visionResult?.comic || {};

  // ID único para evitar agrupación de variantes
  const uniqueId = Date.now().toString().slice(-5);

  console.log(`[publishComicAsFreeListing] Categoría forzada: ${COMIC_CATEGORY_ID} (Revistas)`);

  // 1. Subir fotos (mismo patrón que figuras)
  console.log(`[publishComicAsFreeListing] Subiendo ${images.length} foto(s)...`);
  const uploadResults = await Promise.allSettled(
    images.map(img => uploadPictureToML(img.buffer, img.mimeType))
  );

  const successfulIds = [];
  uploadResults.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value) {
      const id = typeof r.value === "object" ? r.value.id : r.value;
      if (id) successfulIds.push(id);
    } else {
      console.error(`[publishComicAsFreeListing] ❌ Foto ${idx + 1} falló:`, r.reason?.message || r.reason);
    }
  });

  if (successfulIds.length === 0) {
    throw new Error(`Todas las ${images.length} fotos fallaron al subirse a ML`);
  }

  console.log(`[publishComicAsFreeListing] ✅ ${successfulIds.length}/${images.length} fotos subidas`);

  // 2. Construir atributos
  const attributes = buildComicAttributes(visionResult);

  // 3. Construir family_name único
  const baseFamily = visionComic.title || "Revista coleccionable";
  const issueBit = visionComic.issue_number ? ` #${visionComic.issue_number}` : "";
  const yearBit = visionComic.year ? ` ${visionComic.year}` : "";
  const familyName = `${baseFamily}${issueBit}${yearBit} #${uniqueId}`;

  console.log(`[publishComicAsFreeListing] family_name: "${familyName}"`);

  // 4. Construir descripción (versión simple — sin Claude por ahora, podemos mejorar después)
  const descriptionParts = [];
  if (visionCommon.description) {
    descriptionParts.push(visionCommon.description);
  } else {
    descriptionParts.push("Revista/cómic coleccionable.");
  }

  const techLines = [];
  if (visionComic.title) techLines.push(`Título: ${visionComic.title}`);
  if (visionComic.issue_number) techLines.push(`Número: ${visionComic.issue_number}`);
  if (visionComic.publisher) techLines.push(`Editorial: ${visionComic.publisher}`);
  if (visionComic.year) techLines.push(`Año: ${visionComic.year}`);
  if (visionComic.language) {
    const langMap = { es: "Español", en: "Inglés", pt: "Portugués", jp: "Japonés" };
    techLines.push(`Idioma: ${langMap[visionComic.language] || visionComic.language}`);
  }
  if (visionComic.writer) techLines.push(`Guionista: ${visionComic.writer}`);
  if (visionComic.artist) techLines.push(`Dibujante: ${visionComic.artist}`);

  if (techLines.length > 0) {
    descriptionParts.push("\n--- DETALLES ---\n" + techLines.join("\n"));
  }

  // Disclaimer si es vintage/usado (Vision detectó condition != new)
  if (visionCommon.condition === "used" || visionCommon.condition === "damaged") {
    descriptionParts.push(
      "\n--- IMPORTANTE ---\nProducto usado/vintage. Las fotos forman parte de la descripción y reflejan el estado real. Ante cualquier duda, consultá antes de comprar."
    );
  }

  const plainDescription = descriptionParts.join("\n");

  // 5. Payload
  const item = {
    family_name: familyName,
    category_id: COMIC_CATEGORY_ID,
    price: productData.price,
    currency_id: "ARS",
    available_quantity: productData.stock || 1,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_pro",
    condition: productData.condition || "new", // siempre "new" para evitar rechazo
    pictures: successfulIds.map(id => ({ id })),
    attributes: attributes,
    shipping: {
      mode: "me2",
      local_pick_up: true,
      free_shipping: false,
      tags: ["self_service_in"],
    },
  };

  console.log("[publishComicAsFreeListing] PAYLOAD:", JSON.stringify(item, null, 2));

  // 6. Publicar
  const response = await fetch(`${ML_BASE}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error("[publishComicAsFreeListing] ❌ ML rechazó:", JSON.stringify(data, null, 2));
    throw new Error(
      `ML rechazó publicación de cómic: ${data.message || data.error} — ${JSON.stringify(data.cause || data)}`
    );
  }

  console.log(`[publishComicAsFreeListing] ✅ Publicado: ${data.id}`);

  // 7. Setear descripción aparte (mismo workaround que figuras)
  try {
    const descResp = await fetch(`${ML_BASE}/items/${data.id}/description`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plain_text: plainDescription }),
    });

    if (descResp.ok) {
      console.log(`[publishComicAsFreeListing] ✅ Descripción seteada en ${data.id}`);
    } else {
      const descErr = await descResp.json();
      console.error(`[publishComicAsFreeListing] ⚠️ Descripción falló:`, JSON.stringify(descErr));
    }
  } catch (descErr) {
    console.error(`[publishComicAsFreeListing] ⚠️ Excepción seteando descripción:`, descErr.message);
  }

  return {
    ...data,
    publication_type: "free_listing",
    category_id: COMIC_CATEGORY_ID,
    item_type: "comic",
  };
};
/**
 * Publica una carta TCG como free listing en MLA3390.
 */
export const publishTradingCardAsFreeListing = async (productData, images, visionResult) => {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("publishTradingCardAsFreeListing requiere al menos 1 imagen");
  }

  const tc = visionResult?.trading_cards || {};
  if (!tc.brand) {
    throw new Error("Trading card sin brand identificada — debería haber ido a revisión manual");
  }

  const token = await getValidToken();
  const visionCommon = visionResult?.common || {};
  const uniqueId = Date.now().toString().slice(-5);

  console.log(`[publishTradingCardAsFreeListing] Categoría forzada: ${TRADING_CARDS_CATEGORY_ID} (Cartas TCG)`);

  // 1. Subir fotos
  console.log(`[publishTradingCardAsFreeListing] Subiendo ${images.length} foto(s)...`);
  const uploadResults = await Promise.allSettled(
    images.map(img => uploadPictureToML(img.buffer, img.mimeType))
  );

  const successfulIds = [];
  uploadResults.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value) {
      const id = typeof r.value === "object" ? r.value.id : r.value;
      if (id) successfulIds.push(id);
    } else {
      console.error(`[publishTradingCardAsFreeListing] ❌ Foto ${idx + 1} falló:`, r.reason?.message || r.reason);
    }
  });

  if (successfulIds.length === 0) {
    throw new Error(`Todas las ${images.length} fotos fallaron al subirse a ML`);
  }

  console.log(`[publishTradingCardAsFreeListing] ✅ ${successfulIds.length}/${images.length} fotos subidas`);

  // 2. Atributos
  const attributes = buildTradingCardAttributes(visionResult);

  // 3. family_name único
  const baseFamily = `${tc.brand} ${tc.card_name || "Carta TCG"}`;
  const setBit = tc.set_name ? ` ${tc.set_name}` : "";
  const familyName = `${baseFamily}${setBit} #${uniqueId}`;

  console.log(`[publishTradingCardAsFreeListing] family_name: "${familyName}"`);

  // 4. Descripción
  const descriptionParts = [];
  if (visionCommon.description) {
    descriptionParts.push(visionCommon.description);
  } else {
    descriptionParts.push(`Carta coleccionable de ${tc.brand}.`);
  }

  const techLines = [];
  if (tc.brand) techLines.push(`Marca: ${tc.brand}`);
  if (tc.card_name) techLines.push(`Carta: ${tc.card_name}`);
  if (tc.set_name) techLines.push(`Set/Expansión: ${tc.set_name}`);
  if (tc.language) techLines.push(`Idioma: ${tc.language}`);
  if (tc.is_foil === true) techLines.push(`Foil: Sí`);
  if (tc.units_per_pack && tc.units_per_pack > 1) techLines.push(`Cantidad: ${tc.units_per_pack} cartas`);

  if (techLines.length > 0) {
    descriptionParts.push("\n--- DETALLES ---\n" + techLines.join("\n"));
  }

  if (visionCommon.condition === "used" || visionCommon.condition === "damaged") {
    descriptionParts.push(
      "\n--- IMPORTANTE ---\nLas fotos forman parte de la descripción y reflejan el estado real. Ante cualquier duda, consultá antes de comprar."
    );
  }

  const plainDescription = descriptionParts.join("\n");

  // 5. Payload
  const item = {
    family_name: familyName,
    category_id: TRADING_CARDS_CATEGORY_ID,
    price: productData.price,
    currency_id: "ARS",
    available_quantity: productData.stock || 1,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_pro",
    condition: productData.condition || "new",
    pictures: successfulIds.map(id => ({ id })),
    attributes: attributes,
    shipping: {
      mode: "me2",
      local_pick_up: true,
      free_shipping: false,
      tags: ["self_service_in"],
    },
  };

  console.log("[publishTradingCardAsFreeListing] PAYLOAD:", JSON.stringify(item, null, 2));

  // 6. Publicar
  const response = await fetch(`${ML_BASE}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error("[publishTradingCardAsFreeListing] ❌ ML rechazó:", JSON.stringify(data, null, 2));
    throw new Error(
      `ML rechazó publicación de carta TCG: ${data.message || data.error} — ${JSON.stringify(data.cause || data)}`
    );
  }

  console.log(`[publishTradingCardAsFreeListing] ✅ Publicado: ${data.id}`);

  // 7. Setear descripción aparte
  try {
    const descResp = await fetch(`${ML_BASE}/items/${data.id}/description`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plain_text: plainDescription }),
    });

    if (descResp.ok) {
      console.log(`[publishTradingCardAsFreeListing] ✅ Descripción seteada en ${data.id}`);
    } else {
      const descErr = await descResp.json();
      console.error(`[publishTradingCardAsFreeListing] ⚠️ Descripción falló:`, JSON.stringify(descErr));
    }
  } catch (descErr) {
    console.error(`[publishTradingCardAsFreeListing] ⚠️ Excepción seteando descripción:`, descErr.message);
  }

  return {
    ...data,
    publication_type: "free_listing",
    category_id: TRADING_CARDS_CATEGORY_ID,
    item_type: "trading_cards",
  };
};
// ============================================================================
// DEBUG / UTILITY: Descubrimiento de categorías y atributos de ML
// Se usa para descubrir category_id y atributos requeridos antes de
// implementar nuevos flujos (comic, die_cast_vehicle, collectible_decor).
// ============================================================================

/**
 * Descubre el category_id que ML asigna a partir de un título.
 * @param {string} q - Título del producto (ej: "Fierro Revista Comic Argentina")
 * @param {number} limit - Cantidad de resultados (default 3, máximo 8)
 * @returns {Promise<Array>} Array de matches ordenados por probabilidad
 */
export const discoverCategoryByTitle = async (q, limit = 3) => {
  const token = await getValidToken();
  const url = `${ML_BASE}/sites/MLA/domain_discovery/search?limit=${limit}&q=${encodeURIComponent(q)}`;

  console.log(`[discoverCategoryByTitle] Buscando: "${q}" (limit=${limit})`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ML domain_discovery ${response.status}: ${body}`);
  }

  return await response.json();
};

/**
 * Lista todos los atributos de una categoría, opcionalmente filtrados por obligatoriedad.
 * @param {string} categoryId - ID de la categoría (ej: "MLA3530")
 * @param {boolean} onlyRequired - Si true, devuelve solo los obligatorios
 */
export const getCategoryAttributes = async (categoryId, onlyRequired = false) => {
  const token = await getValidToken();
  const url = `${ML_BASE}/categories/${categoryId}/attributes`;

  console.log(`[getCategoryAttributes] ${categoryId} (only_required=${onlyRequired})`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ML categories ${response.status}: ${body}`);
  }

  const allAttributes = await response.json();

  if (!onlyRequired) {
    return {
      category_id: categoryId,
      total: allAttributes.length,
      attributes: allAttributes,
    };
  }

  const required = allAttributes.filter(
    (a) =>
      a.tags?.required === true ||
      a.tags?.catalog_required === true ||
      a.tags?.conditional_required === true ||
      a.tags?.fixed === true
  );

  return {
    category_id: categoryId,
    total_attributes: allAttributes.length,
    required_count: required.length,
    required_attributes: required.map((a) => ({
      id: a.id,
      name: a.name,
      value_type: a.value_type,
      tags: a.tags,
      allowed_units: a.allowed_units,
      values_preview: a.values?.slice(0, 10),
    })),
  };
};