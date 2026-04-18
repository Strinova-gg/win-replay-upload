import type { ElectrobunConfig } from "electrobun";

const clerkKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";
const backendUrl = (process.env.BACKEND_URL ?? "").replace(/\/$/, "");

export default {
  app: {
    name: "Strinova Replay Uploader",
    identifier: "dev.winreplayupload.app",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      external: ["fsevents"],
      define: {
        "process.env.BACKEND_URL": JSON.stringify(backendUrl),
      },
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.tsx",
        define: {
          "process.env.NODE_ENV": JSON.stringify(
            process.env.NODE_ENV ?? "development",
          ),
          "process.env.CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkKey),
          "process.env.BACKEND_URL": JSON.stringify(backendUrl),
        },
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/ui/styles.css": "views/mainview/styles.css",
    },
  },
} satisfies ElectrobunConfig;
