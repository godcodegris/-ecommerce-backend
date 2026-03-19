import { db } from '../firebase.js';

// Datos temporales si Firebase no está disponible
const productosTemporales = [
  { id: "1", nombre: "Figura Goku Super Saiyan", descripcion: "Figura articulada de 25cm", precio: 45.99, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_640-MLA46029313018_052021-O.webp" },
  { id: "2", nombre: "Funko Pop Spider-Man", descripcion: "Funko Pop original de Marvel", precio: 29.99, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_680895-MLA46473691262_062021-O.webp" },
  { id: "3", nombre: "Comic Batman #1", descripcion: "Primera edicion coleccionista", precio: 35.00, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_744590-MLA46357279181_062021-O.webp" },
  { id: "4", nombre: "Manga Dragon Ball Vol 1", descripcion: "Tomo 1 en espanol", precio: 15.50, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_823090-MLA46198765432_052021-O.webp" },
  { id: "5", nombre: "Figura Naruto Sage Mode", descripcion: "Estatua de coleccion 30cm", precio: 55.00, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_956780-MLA46432109876_062021-O.webp" },
  { id: "6", nombre: "Funko Pop Iron Man", descripcion: "Funko Pop de Avengers", precio: 32.99, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_634210-MLA45987654321_052021-O.webp" },
  { id: "7", nombre: "Lego Star Wars X-Wing", descripcion: "Set de coleccion 700 piezas", precio: 89.99, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_789540-MLA46234567890_052021-O.webp" },
  { id: "8", nombre: "Camiseta Pikachu", descripcion: "Algodon premium talles S a XXL", precio: 22.00, imagen: "https://http2.mlstatic.com/D_NQ_NP_2X_567890-MLA46123456789_052021-O.webp" },
];

// Detectar si Firebase está disponible
let firebaseDisponible = false;
try {
  if (db && typeof db.collection === 'function') {
    firebaseDisponible = true;
  }
} catch (e) {
  firebaseDisponible = false;
}

export const obtenerTodos = async () => {
  if (firebaseDisponible) {
    const snapshot = await db.collection('productos').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  return productosTemporales;
};

export const obtenerPorId = async (id) => {
  if (firebaseDisponible) {
    const doc = await db.collection('productos').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }
  return productosTemporales.find(p => p.id == id) || null;
};

export const crearProducto = async (data) => {
  if (firebaseDisponible) {
    const docRef = await db.collection('productos').add(data);
    const nuevoDoc = await docRef.get();
    return { id: nuevoDoc.id, ...nuevoDoc.data() };
  }
  const nuevo = { id: String(productosTemporales.length + 1), ...data };
  productosTemporales.push(nuevo);
  return nuevo;
};

export const actualizarProducto = async (id, data) => {
  if (firebaseDisponible) {
    await db.collection('productos').doc(id).update(data);
    const docActualizado = await db.collection('productos').doc(id).get();
    return { id: docActualizado.id, ...docActualizado.data() };
  }
  const index = productosTemporales.findIndex(p => p.id == id);
  if (index === -1) return null;
  productosTemporales[index] = { ...productosTemporales[index], ...data };
  return productosTemporales[index];
};

export const eliminarProducto = async (id) => {
  if (firebaseDisponible) {
    await db.collection('productos').doc(id).delete();
    return { id };
  }
  const index = productosTemporales.findIndex(p => p.id == id);
  if (index !== -1) {
    productosTemporales.splice(index, 1);
  }
  return { id };
};
