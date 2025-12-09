import { db } from '../firebase.js';

export const obtenerTodos = async () => {
  const snapshot = await db.collection('productos').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const obtenerPorId = async (id) => {
  const doc = await db.collection('productos').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
};

export const crearProducto = async (data) => {
  const docRef = await db.collection('productos').add(data);
  const nuevoDoc = await docRef.get();
  return { id: nuevoDoc.id, ...nuevoDoc.data() };
};

export const actualizarProducto = async (id, data) => {
  await db.collection('productos').doc(id).update(data);
  const docActualizado = await db.collection('productos').doc(id).get();
  return { id: docActualizado.id, ...docActualizado.data() };
};

export const eliminarProducto = async (id) => {
  await db.collection('productos').doc(id).delete();
  return { id };
};