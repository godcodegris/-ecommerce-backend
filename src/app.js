import dotenv from "dotenv";

import {
  publishProductFromJSON,
  loadTokensFromDB,
  getAllUserProducts,
  saveProductsToDB,
  getUserProfile
} from "./services/mercadolibre.service.js";
import chatRouter from "./routes/chat.routes.js";
import cron from "node-cron";

import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

import pool from "./db.js";

pool.query("SELECT NOW()")
  .then(res => {
    console.log("DB conectada:", res.rows[0]);
  })
  .catch(err => {
    console.error("Error conectando a DB:", err);
  });
console.log("ENV TEST:", process.env.ML_CLIENT_ID, process.env.ML_CLIENT_SECRET?.length, process.env.ML_REDIRECT_URI);

import express from "express";
import cors from "cors";
import usersRouter from "./routes/users.routes.js";
import productsRouter from "./routes/products.routes.js";
import mlRouter from "./routes/mercadolibre.routes.js";

const app = express();

app.use(cors({
 origin: [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://ecommerce-backend-production-e9f1.up.railway.app",
  "https://elojodethundera.netlify.app",
  "https://elojodethundera.com",
  "https://www.elojodethundera.com",
],
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("EXPRESS APP.JS RUNNING");
});

app.get("/debug-env", (req, res) => {
  res.json({
    ML_CLIENT_ID: process.env.ML_CLIENT_ID ? "✅ cargada" : "❌ undefined",
    ML_CLIENT_SECRET: process.env.ML_CLIENT_SECRET ? "✅ cargada" : "❌ undefined",
    ML_REDIRECT_URI: process.env.ML_REDIRECT_URI ? "✅ cargada" : "❌ undefined",
    NODE_ENV: process.env.NODE_ENV,
  });
});

app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/mercadolibre", mlRouter);
app.use("/auth", mlRouter);
app.use("/chat", chatRouter);

const PORT = process.env.PORT || 3000;

app.get("/ml/test-new", async (req, res) => {
  try {
    const titulo = req.query.title || "Funko Pop Batman 01";
    const result = await publishProductFromJSON({
      title: titulo,
      category_id: "MLA3530",
      price: 999999,
      condition: "new",
      pictures: []
    });
    res.json(result);
  } catch (error) {
    res.json({ error: error.message });
  }
});
app.listen(PORT, async () => {
  await loadTokensFromDB();
  console.log(`http://localhost:${PORT}`);

  // Cron job: sincronizar productos cada 6 horas
  cron.schedule("0 */6 * * *", async () => {
    console.log("CRON: Iniciando sincronización de productos ML...");
    try {
      const profile = await getUserProfile();
      const products = await getAllUserProducts(profile.id);
      const result = await saveProductsToDB(products);
      console.log("CRON: Sincronización completada:", result);
    } catch (error) {
      console.error("CRON: Error en sincronización:", error);
    }
  });

  console.log("Cron job configurado: sincronización cada 6 horas");
});
