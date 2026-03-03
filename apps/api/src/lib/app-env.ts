import type { AppUser } from "../types";

export type AppEnv = {
  Variables: {
    currentUser: AppUser;
    sessionId: string;
  };
};
