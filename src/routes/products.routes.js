import express from 'express';
import * as productsController from '../controllers/products.controller.js';

const router = express.Router();

router.get('/', productsController.obtenerTodos);
router.get('/:id', productsController.obtenerPorId);
router.post('/', productsController.crearProducto);
router.put('/:id', productsController.actualizarProducto);
router.delete('/:id', productsController.eliminarProducto);

export default router;