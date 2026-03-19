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
  res.send("<h1>API funcionando correctamente</h1>");
});

app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/mercadolibre", mlRouter);
app.use("/auth", mlRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
