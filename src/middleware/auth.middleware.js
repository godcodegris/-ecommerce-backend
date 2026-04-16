export const adminAuth = (req, res, next) => {
  const { usuario, password } = req.body;

  if (
    usuario === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    next();
  } else {
    res.status(401).json({ error: "No autorizado" });
  }
};