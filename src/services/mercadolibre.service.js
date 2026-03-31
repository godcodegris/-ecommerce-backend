import { randomBytes, createHash } from "crypto";
import pool from "../db.js";

const ML_BASE = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.ar/authorization";
const ML_TOKEN = "https://api.mercadolibre.com/oauth/token";

const generateCodeVerifier = () => randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier) =>
  createHash("sha256").update(verifier).digest("base64url");

// Token storage (en producción usar BD)
let tokens = {};

export const loadTokensFromDB = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM ml_tokens
       ORDER BY created_at DESC
       LIMIT 1`
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

// Leer env vars dentro de funciones (no al importar)
const getEnv = () => {
  console.log("CLIENT_ID:", process.env.ML_CLIENT_ID);
  console.log("CLIENT_SECRET length:", process.env.ML_CLIENT_SECRET?.length);
  console.log("REDIRECT_URI:", process.env.ML_REDIRECT_URI);
  return {
    clientId: process.env.ML_CLIENT_ID,
    clientSecret: process.env.ML_CLIENT_SECRET,
    redirectUri: process.env.ML_REDIRECT_URI,
  };
};

// URL para iniciar OAuth con PKCE
export const getAuthUrl = () => {
  const { clientId, redirectUri } = getEnv();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const url = `${ML_AUTH}?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  return { url, codeVerifier, state };
};

// Intercambiar code por access_token (PKCE)
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
    console.log("Respuesta ML exchangeCode:", JSON.stringify(data, null, 2));

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    console.log("Intentando guardar tokens en DB...");
    console.log("access_token:", data.access_token?.slice(0,20));
    console.log("refresh_token:", data.refresh_token?.slice(0,20));
    console.log("expiresAt:", expiresAt);

    const result = await pool.query(
      `INSERT INTO ml_tokens (access_token, refresh_token, expires_at)
       VALUES ($1,$2,$3) RETURNING id`,
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

    console.log("Tokens guardados en memoria también.");

    return tokens;

  } catch (error) {
    console.error("Error exchanging code:", error);
    throw error;
  }
};
// Refrescar access_token
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

    tokens = {
      ...tokens,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      created_at: Date.now(),
    };

    return tokens.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
};

// Obtener token válido (refresca si expiró)
const getValidToken = async () => {
  const now = Date.now();
  const elapsed = (now - tokens.created_at) / 1000;

  if (elapsed > tokens.expires_in - 60) {
    return await refreshToken();
  }

  return tokens.access_token;
};

// Obtener perfil del usuario de ML
export const getUserProfile = async () => {
  const token = await getValidToken();

  const response = await fetch(`${ML_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return await response.json();
};

// Obtener productos del usuario (paginado)
export const getUserProducts = async (userId, offset = 0, limit = 50) => {
  const token = await getValidToken();

  const response = await fetch(
    `${ML_BASE}/users/${userId}/items/search?offset=${offset}&limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return await response.json();
};

// Obtener detalle de un producto por ID
export const getProductDetail = async (itemId) => {
  const token = await getValidToken();

  const response = await fetch(`${ML_BASE}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return await response.json();
};

// Obtener múltiples productos (batch)
export const getProductsBatch = async (itemIds) => {
  const token = await getValidToken();
  const idsParam = itemIds.join(",");

  const response = await fetch(`${ML_BASE}/items?ids=${idsParam}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return await response.json();
};

// Obtener todos los productos del usuario (con paginación)
export const getAllUserProducts = async (userId) => {
  const allProducts = [];
  let offset = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const result = await getUserProducts(userId, offset, limit);

    if (result.results && result.results.length > 0) {
      const details = await getProductsBatch(result.results);

      for (const item of details) {
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

      offset += limit;
      hasMore = result.results.length === limit;
    } else {
      hasMore = false;
    }
  }

  return allProducts;
};

export const getTokens = () => tokens;
export const setTokens = (newTokens) => {
  tokens = newTokens;
};