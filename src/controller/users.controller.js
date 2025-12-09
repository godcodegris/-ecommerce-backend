import * as userService from "../services/users.service.js";

export const obtenerTodosLosUsuarios = (req, res) => {
  const usuarios = userService.obtenerTodos();
  res.json(usuarios);
};

export const obtenerUsuarioPorId = (req, res) => { 
    const id = req.params.id;
    const usuario = userService.obtenerPorId(id);
     if (usuario ){
       res.json(usuario);
    } else{
    res.status(404).json({ mensaje: "Usuario no encontrado" });
 };
 }

