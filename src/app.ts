import express from "express";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", message: "API is healthy" });
});

export default app;
