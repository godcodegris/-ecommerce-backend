import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("<h1>TEST - API funcionando</h1>");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TEST http://localhost:${PORT}`));
