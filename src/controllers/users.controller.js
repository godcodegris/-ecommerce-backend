import * as userService from "../services/users.service.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";



export const obtenerTodosLosUsuarios = async (req, res) => {
  const usuarios = await userService.obtenerTodos();
  res.json(usuarios);
};

export const obtenerUsuarioPorId = async (req, res) => { 
  const id = req.params.id;
  const usuario = await userService.obtenerPorId(id);
  if (usuario) {
    res.json(usuario);
  } else {
    res.status(404).json({ mensaje: "Usuario no encontrado" });
  }
};

export const registrar = async (req, res) => {
  const { email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const nuevoUsuario = await userService.crearUsuario({ email, password: hashedPassword });
  res.status(201).json({ id: nuevoUsuario.id, email: nuevoUsuario.email });
};

export const login = async (req, res) => {
  console.log("JWT_SECRET:", process.env.JWT_SECRET);
  const { email, password } = req.body;
  const usuario = await userService.obtenerPorEmail(email);
  if (!usuario) return res.status(401).json({ message: "Credenciales inválidas" });

  const passwordValida = await bcrypt.compare(password, usuario.password);
  if (!passwordValida) return res.status(401).json({ message: "Credenciales inválidas" });

const token = jwt.sign(
    { id: usuario.id, email: usuario.email },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );
  res.json({ token });
};