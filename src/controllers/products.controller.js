import * as productService from '../services/products.service.js';

export const obtenerTodos = async (req, res) => {
  const productos = await productService.obtenerTodos();
  res.json(productos);
};

export const obtenerPorId = async (req, res) => {
  const producto = await productService.obtenerPorId(req.params.id);
  if (!producto) return res.status(404).json({ message: 'Producto no encontrado' });
  res.json(producto);
};

export const crearProducto = async (req, res) => {
  const nuevoProducto = await productService.crearProducto(req.body);
  res.status(201).json(nuevoProducto);
};

export const actualizarProducto = async (req, res) => {
  const productoActualizado = await productService.actualizarProducto(req.params.id, req.body);
  res.json(productoActualizado);
};

export const eliminarProducto = async (req, res) => {
  await productService.eliminarProducto(req.params.id);
  res.json({ message: 'Producto eliminado' });
};