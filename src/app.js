import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import usersRouter from "./routes/users.routes.js";
import productsRouter from "./routes/products.routes.js";

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
