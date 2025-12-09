import {
  obtenerProductos,
  obtenerProductoPorId
} from '../models/productModel.js';

export const obtenerTodosLosProductos = async (req, res) => {
  try {
    const productos = await obtenerProductos();
    res.json(productos);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener productos' });
  }
};

export const obtenerProductoPorId = async (req, res) => {
  try {
    const id = req.params.id;
    const producto = await obtenerProductoPorId(id);
    if (producto) {
      res.json(producto);
    } else {
      res.status(404).json({ mensaje: 'Producto no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener el producto' });
  }
};