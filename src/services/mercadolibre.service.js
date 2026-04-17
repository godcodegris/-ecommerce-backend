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

export const publishProductFromJSON = async (productData) => {
  const token = await getValidToken();

  let item;

  if (productData.catalog_product_id) {
    item = {
      title: productData.title,
      category_id: productData.category_id || "MLA3422",
      family_name: productData.title,
      catalog_product_id: productData.catalog_product_id,
      price: productData.price,
      currency_id: "ARS",
      available_quantity: productData.stock || 1,
      buying_mode: "buy_it_now",
      listing_type_id: "gold_pro",
      condition: productData.condition || "new",
    };
  } else {
    item = {
      title: productData.title,
      category_id: productData.category_id || "MLA3422",
      price: productData.price,
      currency_id: "ARS",
      available_quantity: productData.stock || 1,
      buying_mode: "buy_it_now",
      condition: productData.condition || "new",
      listing_type_id: "gold_pro",
      description: { plain_text: productData.description || productData.title },
      pictures: productData.pictures
        ? productData.pictures.map((url) => ({ source: url }))
        : [],
      attributes: [
        { id: "BRAND", value_name: productData.brand || "Genérica" },
      ],
    };
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
    throw new Error(`ML Error: ${data.message} — ${JSON.stringify(data.cause)}`);
  }

  return data;
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