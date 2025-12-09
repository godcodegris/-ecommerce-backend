import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '..', 'data', 'productos.json');

export const leerProductos = () => {
  const data = fs.readFileSync(dataPath, 'utf-8');
  return JSON.parse(data);
};

export const escribirProductos = (productos) => {
  fs.writeFileSync(dataPath, JSON.stringify(productos, null, 2));
};