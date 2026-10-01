import express from "express";
import cookieParser from "cookie-parser";
import { errorHandlingMiddleware } from "./middlewares/errorHandlingMiddleware";
import apiRoutes from "./routes/api";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", message: "API is healthy" });
});

app.use("/api", (request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
});

app.use("/api", apiRoutes);
app.use(errorHandlingMiddleware);

export default app;
