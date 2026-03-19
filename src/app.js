import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import usersRouter from "./routes/users.routes.js";
import productsRouter from "./routes/products.routes.js";
import mlRouter from "./routes/mercadolibre.routes.js";

dotenv.config();

const app = express();

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://ecommerce-backend-production-6dff.up.railway.app",
  ],
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("<h1>API funcionando correctamente</h1>");
});

app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/mercadolibre", mlRouter);

// Callback de ML (también accesible desde /auth/callback)
app.use("/auth", mlRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
