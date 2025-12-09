import db from '../firebase.js';

// Crear un producto
export const crearProducto = async (producto) => {
  const docRef = await db.collection('productos').add(producto);
  return docRef.id;
};

// Obtener todos los productos
export const obtenerProductos = async () => {
  const snapshot = await db.collection('productos').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};


export const obtenerProductoPorId = async (id) => {
  const doc = await db.collection('productos').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};


export const actualizarProducto = async (id, datos) => {
  await db.collection('productos').doc(id).update(datos);
};


export const borrarProducto = async (id) => {
  await db.collection('productos').doc(id).delete();
};