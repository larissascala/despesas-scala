import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import uiRouter from "./routes/ui";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:5173",
  ...(process.env["RAILWAY_PUBLIC_DOMAIN"]
    ? [`https://${process.env["RAILWAY_PUBLIC_DOMAIN"]}`]
    : []),
  ...(process.env["ALLOWED_ORIGINS"]
    ? process.env["ALLOWED_ORIGINS"].split(",").map((o) => o.trim())
    : []),
]);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || process.env["NODE_ENV"] !== "production") return cb(null, true);
      cb(
        allowedOrigins.has(origin) ? null : new Error(`CORS: origin not allowed — ${origin}`),
        allowedOrigins.has(origin),
      );
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/", uiRouter);
app.use("/api", router);

export default app;
