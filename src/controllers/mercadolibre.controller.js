import * as mlService from "../services/mercadolibre.service.js";

// state → code_verifier (válido por una sola sesión)
const pkceStore = new Map();

// Redirigir a Mercado Libre para autorización (PKCE)
export const iniciarAuth = (req, res) => {
  const { url, codeVerifier, state } = mlService.getAuthUrl();
  pkceStore.set(state, codeVerifier);
  res.redirect(url);
};

// Callback de Mercado Libre (recibe el code, completa PKCE)
export const authCallback = async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: "No se recibió código de autorización" });
  }

  const codeVerifier = pkceStore.get(state);
  pkceStore.delete(state);

  if (!codeVerifier) {
    return res.status(400).json({ error: "State inválido o expirado, iniciá el flujo desde /mercadolibre/auth" });
  }

  try {
    const tokens = await mlService.exchangeCode(code, codeVerifier);
    res.json({
      mensaje: "Autorización exitosa",
      user_id: tokens.user_id,
      access_token: tokens.access_token ? "obtenido" : "no obtenido",
    });
  } catch (error) {
    console.error("Error en callback:", error);
    res.status(500).json({ error: "Error al intercambiar código" });
  }
};

// Obtener perfil del usuario de ML
export const obtenerPerfil = async (req, res) => {
  try {
    const perfil = await mlService.getUserProfile();
    res.json(perfil);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener perfil" });
  }
};

// Obtener productos del usuario de ML (sin importar)
export const obtenerProductosML = async (req, res) => {
  const { user_id } = req.query;
  const userId = user_id || mlService.getTokens().user_id;

  if (!userId) {
    return res.status(400).json({ error: "No se encontró user_id" });
  }

  try {
    const productos = await mlService.getAllUserProducts(userId);
    res.json({
      cantidad: productos.length,
      productos,
    });
  } catch (error) {
    console.error("Error al obtener productos:", error);
    res.status(500).json({ error: "Error al obtener productos de ML" });
  }
};

// ✅ Importar productos de ML a PostgreSQL
export const importarProductos = async (req, res) => {
  const { user_id } = req.body;
  const userId = user_id || mlService.getTokens().user_id;

  if (!userId) {
    return res.status(400).json({ error: "No se encontró user_id" });
  }

  try {
    const productosML = await mlService.getAllUserProducts(userId);
    const resultado = await mlService.saveProductsToDB(productosML);

    res.json({
      mensaje: "Importación completada",
      total: productosML.length,
      insertados: resultado.insertados,
      errores: resultado.errores.length,
      detalles_errores: resultado.errores,
    });
  } catch (error) {
    console.error("Error importando productos:", error);
    res.status(500).json({ error: "Error al importar productos" });
  }
};

// Estado de la conexión con ML
export const estadoConexion = (req, res) => {
  const tokens = mlService.getTokens();
  const conectado = tokens.access_token ? true : false;
  res.json({
    conectado,
    user_id: tokens.user_id || null,
  });
};