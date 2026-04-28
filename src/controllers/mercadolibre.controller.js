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
export const perfilML = async (req, res) => {
  try {
    const perfil = await mlService.getUserProfile();
    res.json(perfil);
  } catch (error) {
    console.error("Error obteniendo perfil ML:", error);
    res.status(500).json({ error: error.message });
  }
};
export const tiposListing = async (req, res) => {
  try {
    const { category_id } = req.query;
    const tipos = await mlService.getListingTypes(category_id || "MLA3422");
    res.json(tipos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const infoCatalogo = async (req, res) => {
  try {
    const { id } = req.params;
    const info = await mlService.getCatalogProductInfo(id);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const validarItem = async (req, res) => {
  try {
    const resultado = await mlService.validateItem(req.body);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const publicarMasivo = async (req, res) => {
  try {
    const { productos, descripcion_default } = req.body;

    if (!productos || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "El campo productos es requerido y debe ser un array" });
    }

    const resultado = await mlService.publicarMasivo(productos, descripcion_default || "");

    res.json({
      mensaje: "Publicación masiva completada",
      resumen: {
        total: productos.length,
        publicados: resultado.publicados.length,
        fallidos: resultado.fallidos.length,
        pendientes_revision: resultado.pendientes_revision.length,
      },
      publicados: resultado.publicados,
      fallidos: resultado.fallidos,
      pendientes_revision: resultado.pendientes_revision,
    });

  } catch (error) {
    console.error("Error en publicación masiva:", error.message);
    res.status(500).json({ error: error.message });
  }
};
// ============================================
// DEBUG / UTILITY: Descubrimiento de categorías y atributos
// Útil para descubrir category_id y atributos requeridos
// antes de implementar nuevos flujos (comic, die_cast, etc.)
// ============================================




// ============================================
// DEBUG / UTILITY: Descubrimiento de categorías
// ============================================

export const discoverCategory = async (req, res) => {
  try {
    const { q, limit = 3 } = req.query;

    if (!q) {
      return res.status(400).json({
        error: "Falta query param 'q'",
        ejemplo: "/mercadolibre/debug/discover-category?q=Fierro Revista Comic Argentina",
      });
    }

    const resultado = await mlService.discoverCategoryByTitle(q, parseInt(limit));
    return res.json({ query: q, results: resultado });
  } catch (error) {
    console.error("[discoverCategory] Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
};

export const categoryAttributes = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { only_required = "false" } = req.query;

    const resultado = await mlService.getCategoryAttributes(
      categoryId,
      only_required === "true"
    );
    return res.json(resultado);
  } catch (error) {
    console.error("[categoryAttributes] Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
};