import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clickupRouter from "./clickup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clickupRouter);

export default router;
