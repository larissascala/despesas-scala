import { Router, type IRouter } from "express";
import fs from "fs";
import path from "path";

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

const htmlPath = path.resolve(workspaceRoot, "artifacts/api-server/public/index.html");
const html = fs.readFileSync(htmlPath, "utf-8");

const router: IRouter = Router();

router.get("/", (_req, res): void => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export default router;
