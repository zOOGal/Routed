import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureUserId } from "./user-identity";

// ── Startup env-var validation ──────────────────────────────────────
const REQUIRED_ENV = [
  "GOOGLE_MAPS_API_KEY",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
] as const;

const OPTIONAL_ENV = [
  "OPENWEATHER_API_KEY",
  "DATABASE_URL",
  "MEMORY_ASSISTANT_URL",
  "MEMORY_ASSISTANT_API_KEY",
] as const;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `\n❌  Missing required environment variables:\n${missing.map((k) => `   - ${k}`).join("\n")}\n\nCopy .env.example to .env and fill in the values.\n`,
  );
  if (process.env.NODE_ENV !== "production") {
    process.exit(1);
  }
}

const unset = OPTIONAL_ENV.filter((k) => !process.env[k]);
if (unset.length > 0) {
  console.warn(
    `⚠️  Optional env vars not set (some features will be disabled): ${unset.join(", ")}`,
  );
}
// ────────────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Extend Express Request type to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Cookie parser for user identity
app.use(cookieParser());

// Ensure user ID cookie exists for all API routes
app.use("/api", ensureUserId);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Default to 5001 if not specified (5000 is used by macOS Control Center).
  // this serves both the API and the client.
  const port = parseInt(process.env.PORT || "5001", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
