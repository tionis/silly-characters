import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  WEB_ORIGIN: z.string().trim().url().default("http://127.0.0.1:5173"),
  SESSION_SECRET: z.string().trim().min(8).default("change-me"),
  NEXTCLOUD_BASE_URL: z.string().trim().url().optional().or(z.literal("")),
  NEXTCLOUD_APP_ID: z.string().trim().optional().or(z.literal("")),
  NEXTCLOUD_APP_SECRET: z.string().trim().optional().or(z.literal("")),
  NEXTCLOUD_REDIRECT_URI: z.string().trim().url().optional().or(z.literal(""))
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  NEXTCLOUD_BASE_URL: parsed.NEXTCLOUD_BASE_URL || "",
  NEXTCLOUD_APP_ID: parsed.NEXTCLOUD_APP_ID || "",
  NEXTCLOUD_APP_SECRET: parsed.NEXTCLOUD_APP_SECRET || "",
  NEXTCLOUD_REDIRECT_URI: parsed.NEXTCLOUD_REDIRECT_URI || ""
};
