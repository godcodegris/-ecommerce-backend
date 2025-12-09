import db from "./src/firebase.js";

async function testFirestore() {
  const productosRef = db.collection("productos");
  const snapshot = await productosRef.get();
  const productos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(productos);
}

testFirestore();