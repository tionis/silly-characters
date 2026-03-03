import "express";

declare global {
  namespace Express {
    interface UserIdentity {
      id: string;
      email: string | null;
      displayName: string;
    }

    interface Request {
      sessionId?: string;
      currentUser?: UserIdentity;
    }
  }
}

export {};
