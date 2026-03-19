import dotenv from "dotenv";
dotenv.config();

const ML_BASE = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.ar/authorization";
const ML_TOKEN = "https://api.mercadolibre.com/oauth/token";

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI = process.env.ML_REDIRECT_URI;

// Token storage (en producción usar BD)
let tokens = {};

// URL para iniciar OAuth
export const getAuthUrl = () => {
  return `${ML_AUTH}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=thundera`;
};

// Intercambiar code por access_token
export const exchangeCode = async (code) => {
  try {
    const response = await fetch(ML_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();
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

// Refrescar access_token
export const refreshToken = async () => {
  try {
    const response = await fetch(ML_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
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
export const setTokens = (newTokens) => { tokens = newTokens; };
