import { Router } from "express";
import * as mlController from "../controllers/mercadolibre.controller.js";
import { verificarToken } from "../middlewares/auth.js";

const router = Router();

// Iniciar autorización OAuth
router.get("/auth", mlController.iniciarAuth);

// Callback de Mercado Libre
router.get("/callback", mlController.authCallback);

// Perfil del usuario de ML
router.get("/perfil", mlController.obtenerPerfil);

// Obtener productos de ML (sin importar)
router.get("/productos", mlController.obtenerProductosML);

// Importar productos de ML a la BD
router.post("/importar", mlController.importarProductos);

router.post("/publicar", verificarToken, mlController.publicarProducto);

// Estado de conexión
router.get("/estado", mlController.estadoConexion);

router.get("/buscar-catalogo", verificarToken, mlController.buscarCatalogo);

router.get("/perfil", verificarToken, mlController.perfilML);

router.get("/tipos-listing", verificarToken, mlController.tiposListing);

router.get("/catalogo/:id", verificarToken, mlController.infoCatalogo);

router.post("/validar", verificarToken, mlController.validarItem);

router.post("/publicar-masivo", verificarToken, mlController.publicarMasivo);

// Endpoints de descubrimiento de categorías y atributos (debug/utility)
router.get("/debug/discover-category", mlController.discoverCategory);
router.get("/debug/category-attributes/:categoryId", mlController.categoryAttributes);

export default router;
