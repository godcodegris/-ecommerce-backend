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
      const cumpleSimilitud = similitud >= UMBRAL_SIMILITUD;
      const cumpleConfidence = !visionResult || visionResult.confidence >= MIN_VISION_CONFIDENCE;
      const tieneIdentificador = !visionResult || !REQUIERE_BRAND_O_MODEL ||
        (visionResult.attributes?.brand || visionResult.attributes?.alphanumeric_model);

      if (cumpleSimilitud && cumpleConfidence && tieneIdentificador) {
        catalogMatch = searchResult;
        console.log(`[publishProductFromJSON] ✅ Match de catálogo aceptado`);
      } else {
        // Armar motivo de rechazo para debug/logging
        const razones = [];
        if (!cumpleSimilitud) razones.push(`similitud ${similitud.toFixed(2)} < ${UMBRAL_SIMILITUD}`);
        if (!cumpleConfidence) razones.push(`vision confidence ${visionResult.confidence} < ${MIN_VISION_CONFIDENCE}`);
        if (!tieneIdentificador) razones.push(`sin brand ni alphanumeric_model`);
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
 */
export const publishProductAsFreeListing = async (
  productData,
  imageBuffer,
  mimeType,
  visionResult
) => {
  const token = await getValidToken();

  // 1. Obtener category_id con domain_discovery
  console.log("[publishAsFreeListing] Obteniendo category_id...");
  const discoveryResp = await fetch(
    `${ML_BASE}/sites/MLA/domain_discovery/search?limit=1&q=${encodeURIComponent(productData.title)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const discoveryData = await discoveryResp.json();

  if (!Array.isArray(discoveryData) || discoveryData.length === 0) {
    throw new Error("domain_discovery no devolvió categoría para este título");
  }

  const categoryId = discoveryData[0].category_id;
  console.log(`[publishAsFreeListing] category_id=${categoryId} (domain=${discoveryData[0].domain_id})`);

  // 2. Subir la foto a ML
  console.log("[publishAsFreeListing] Subiendo foto a ML...");
  const pictureId = await uploadPictureToML(imageBuffer, mimeType);

  // 3. Mapear atributos de Vision al formato ML
  const visionAttrs = visionResult.attributes || {};

  const attributes = [
    {
      id: "BRAND",
      value_name: visionAttrs.brand || "Sin marca",
    },
    {
      id: "MODEL",
      value_name: visionAttrs.alphanumeric_model || "Genérico",
    },
    {
      id: "COLLECTION",
      value_name: visionAttrs.collection || visionAttrs.character || "Sin colección",
    },
    {
      id: "VALUE_ADDED_TAX",
      value_id: "48405909",  // IVA 21% Argentina
    },
    {
      id: "EMPTY_GTIN_REASON",
      value_id: "12342907",  // "Not registered" — no tengo código de barras
    },
    {
      id: "IMPORT_DUTY",
      value_id: "12342907",  // "Not applicable" — producto nacional
    },
  ];

  const familyName =
    visionAttrs.character ||
    visionAttrs.collection ||
    productData.title.substring(0, 60);

  // 4. Construir payload
  const item = {
    title: productData.title.substring(0, 60),
    family_name: familyName,
    category_id: categoryId,
    price: productData.price,
    currency_id: "ARS",
    available_quantity: productData.stock || 1,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_pro",
    condition: productData.condition || "new",
    description: {
      plain_text: productData.description || productData.title,
    },
    pictures: [{ id: pictureId }],
    attributes: attributes,
  };

  console.log("[publishAsFreeListing] PAYLOAD enviado a ML:", JSON.stringify(item, null, 2));

  // 5. POST a ML
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
    // DEBUG: consultar atributos obligatorios de la categoría que ML devolvió
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
      console.error("[publishAsFreeListing] No pude consultar attrs de la categoría:", attrErr.message);
    }

    console.error(`[publishAsFreeListing] Respuesta completa de ML:`, JSON.stringify(data, null, 2));

    throw new Error(
      `ML rechazó publicación libre: ${data.message || data.error} — ${JSON.stringify(data.cause || data)}`
    );
  }

  console.log(`[publishAsFreeListing] ✅ Publicado: ${data.id}`);

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