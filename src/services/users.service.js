import pool from "../db.js";

export const obtenerTodos = async () => {
  const result = await pool.query("SELECT id, email, created_at FROM users");
  return result.rows;
};

export const obtenerPorId = async (id) => {
  const result = await pool.query("SELECT id, email, created_at FROM users WHERE id = $1", [id]);
  return result.rows[0];
};

export const obtenerPorEmail = async (email) => {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0];
};

export const crearUsuario = async ({ email, password }) => {
  const result = await pool.query(
    "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
    [email, password]
  );
  return result.rows[0];
};