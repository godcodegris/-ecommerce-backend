import * as mlService from "../services/mercadolibre.service.js";

const pkceStore = new Map();

export const iniciarAuth = (req, res) => {
  const { url, codeVerifier, state } = mlService.getAuthUrl();
  pkceStore.set(state, codeVerifier);
  res.redirect(url);
};

export const authCallback = async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).json({ error: "No se recibió código de autorización" });
  }
  const codeVerifier = pkceStore.get(state);
  pkceStore.delete(state);
  if (!codeVerifier) {
    return res.status(400).json({ error: "State inválido o expirado" });
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

export const obtenerPerfil = async (req, res) => {
  try {
    const perfil = await mlService.getUserProfile();
    res.json(perfil);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener perfil" });
  }
};

export const obtenerProductosML = async (req, res) => {
  const { user_id } = req.query;
  const userId = user_id || mlService.getTokens().user_id;
  if (!userId) {
    return res.status(400).json({ error: "No se encontró user_id" });
  }
  try {
    const productos = await mlService.getAllUserProducts(userId);
    res.json({ cantidad: productos.length, productos });
  } catch (error) {
    console.error("Error al obtener productos:", error);
    res.status(500).json({ error: "Error al obtener productos de ML" });
  }
};

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

export const publicarProducto = async (req, res) => {
  try {
    const resultado = await mlService.publishProductFromJSON(req.body);
    res.json({
      mensaje: "Producto publicado en MercadoLibre",
      id: resultado.id,
      permalink: resultado.permalink,
    });
  } catch (error) {
    console.error("Error publicando producto:", error.message);
    res.status(500).json({ error: error.message });
  }
};

export const estadoConexion = (req, res) => {
  const tokens = mlService.getTokens();
  res.json({
    conectado: tokens.access_token ? true : false,
    user_id: tokens.user_id || null,
  });
};
export const buscarCatalogo = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: "Falta el parámetro q" });
    }
    const resultado = await mlService.searchCatalogProduct(q);
    if (!resultado) {
      return res.status(404).json({ error: "No se encontraron productos en el catálogo" });
    }
    res.json(resultado);
  } catch (error) {
    console.error("Error buscando en catálogo:", error);
    res.status(500).json({ error: error.message });
  }
};