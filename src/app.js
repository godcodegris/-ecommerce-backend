import "dotenv/config";
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
