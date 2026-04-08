import pool from '../db.js';

export const obtenerTodos = async () => {
  const result = await pool.query(
    `SELECT 
      id,
      ml_id,
      title AS nombre,
      title AS descripcion,
      price AS precio,
      thumbnail AS imagen,
      currency_id AS moneda,
      available_quantity AS stock,
      permalink
     FROM ml_products 
     ORDER BY id ASC`
  );
  return result.rows;
};

export const obtenerPorId = async (id) => {
  const result = await pool.query(
    `SELECT 
      id,
      ml_id,
      title AS nombre,
      title AS descripcion,
      price AS precio,
      thumbnail AS imagen,
      currency_id AS moneda,
      available_quantity AS stock,
      permalink
     FROM ml_products 
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

export const crearProducto = async (data) => {
  const { ml_id, title, price, currency_id, available_quantity, permalink, thumbnail } = data;
  const result = await pool.query(
    `INSERT INTO ml_products (ml_id, title, price, currency_id, available_quantity, permalink, thumbnail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [ml_id, title, price, currency_id, available_quantity, permalink, thumbnail]
  );
  return result.rows[0];
};

export const actualizarProducto = async (id, data) => {
  const { title, price, currency_id, available_quantity, permalink, thumbnail } = data;
  const result = await pool.query(
    `UPDATE ml_products 
     SET title = $1, price = $2, currency_id = $3, available_quantity = $4, permalink = $5, thumbnail = $6
     WHERE id = $7
     RETURNING *`,
    [title, price, currency_id, available_quantity, permalink, thumbnail, id]
  );
  return result.rows[0] || null;
};

export const eliminarProducto = async (id) => {
  await pool.query(`DELETE FROM ml_products WHERE id = $1`, [id]);
  return { id };
};