let usuarios = [
  { id: 1, nombre: "Pepa", mail: "tumail@gmail.com" },
  {  id: 2, nombre: "Carlos", mail: "mimail@gmail.com"  },
  { id: 3, nombre: "Pedro", mail: "pedro@gmail.com" }
];

export const obtenerTodos = () => {
  return usuarios;
};

 export const obtenerPorId = (id) => {
  return usuarios.find(u => u.id == id);
};

export const crear = (datosDelNuevoUsuario) => {
  const nuevoUsuario = {
    id: usuarios.length + 1,
    nombre: datosDelNuevoUsuario.nombre,
    mail: datosDelNuevoUsuario.mail
  };
  usuarios.push(nuevoUsuario);
  return nuevoUsuario;
};

export const actualizar = (id, nuevosDatos) => {
  const usuario = usuarios.find(u => u.id == id);
  
  usuario.nombre = nuevosDatos.nombre;
  usuario.mail = nuevosDatos.mail;
  return usuario;
};

export const eliminar = (id) => {
  usuarios = usuarios.filter(u => u.id !== id);
  return { mensaje: "Usuario eliminado", id };
};