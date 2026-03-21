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

// Obtener productos del usuario de ML
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

// Importar productos de ML a Firebase
export const importarProductos = async (req, res) => {
  const { user_id } = req.body;
  const userId = user_id || mlService.getTokens().user_id;

  if (!userId) {
    return res.status(400).json({ error: "No se encontró user_id" });
  }

  try {
    const productosML = await mlService.getAllUserProducts(userId);
    const { db } = await import("../firebase.js");
    const imported = [];
    const errors = [];

    for (const producto of productosML) {
      try {
        // Verificar si ya existe (por ML ID)
        const existente = await db
          .collection("productos")
          .where("ml_id", "==", producto.id)
          .get();

        if (existente.empty) {
          // Crear nuevo
          const docRef = await db.collection("productos").add({
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            precio: producto.precio,
            imagen: producto.imagen,
            moneda: producto.moneda,
            stock: producto.stock,
            ml_id: producto.id,
            ml_permalink: producto.permalink,
            ml_categoria: producto.categoria,
            importado_desde_ml: true,
            fecha_importacion: new Date().toISOString(),
          });
          imported.push({ id: docRef.id, nombre: producto.nombre });
        } else {
          // Actualizar existente
          const docId = existente.docs[0].id;
          await db.collection("productos").doc(docId).update({
            precio: producto.precio,
            stock: producto.stock,
            imagen: producto.imagen,
            ultima_sincronizacion: new Date().toISOString(),
          });
          imported.push({ id: docId, nombre: producto.nombre, actualizado: true });
        }
      } catch (err) {
        errors.push({ producto: producto.nombre, error: err.message });
      }
    }

    res.json({
      mensaje: `Importación completada`,
      importados: imported.length,
      errores: errors.length,
      detalles: { imported, errors },
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
