import { Router, Request, Response } from "express";

const router = Router();

router.get("/health", async (req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
