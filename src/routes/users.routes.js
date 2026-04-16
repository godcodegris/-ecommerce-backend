import { Router } from "express";
import * as userController from "../controllers/users.controller.js";

const router = Router();

router.get("/", userController.obtenerTodosLosUsuarios);
router.get("/:id", userController.obtenerUsuarioPorId);


router.post("/registrar", userController.registrar);
router.post("/login", userController.login);

router.post("/", (req, res) => {
  res.send("POST usuarios pendiente");
});

router.put("/:id", (req, res) => {
  res.send("PUT usuarios pendiente");
});

router.delete("/:id", (req, res) => {
  res.send("DELETE usuarios pendiente");
});

export default router;