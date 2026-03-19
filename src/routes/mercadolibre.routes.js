import { Router } from "express";
import * as mlController from "../controllers/mercadolibre.controller.js";

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

// Estado de conexión
router.get("/estado", mlController.estadoConexion);

export default router;
