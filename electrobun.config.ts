import type { ElectrobunConfig } from "electrobun";

const backendUrl = (process.env.BACKEND_URL ?? "https://strinova.gg").replace(/\/$/, "");
const oauthIssuer = (process.env.CLERK_OAUTH_ISSUER ?? "https://clerk.strinova.gg").replace(
  /\/$/,
  "",
);
const oauthClientId = process.env.CLERK_OAUTH_CLIENT_ID ?? "9YfNu3Z7Vm9PvZ6G";
export const windowsIconPath = "assets/stringify.ico";

export default {
  app: {
    name: "Stringify Desktop",
    identifier: "gg.strinova.app",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    win: {
      icon: windowsIconPath,
    },
    bun: {
      entrypoint: "src/bun/index.ts",
      external: ["fsevents"],
      define: {
        "process.env.BACKEND_URL": JSON.stringify(backendUrl),
        "process.env.CLERK_OAUTH_ISSUER": JSON.stringify(oauthIssuer),
        "process.env.CLERK_OAUTH_CLIENT_ID": JSON.stringify(oauthClientId),
      },
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.tsx",
        define: {
          "process.env.NODE_ENV": JSON.stringify(
            process.env.NODE_ENV ?? "development",
          ),
          "process.env.BACKEND_URL": JSON.stringify(backendUrl),
          "process.env.CLERK_OAUTH_ISSUER": JSON.stringify(oauthIssuer),
          "process.env.CLERK_OAUTH_CLIENT_ID": JSON.stringify(oauthClientId),
        },
      },
    },
    copy: {
      [windowsIconPath]: windowsIconPath,
      "src/mainview/index.html": "views/mainview/index.html",
      "src/ui/styles.css": "views/mainview/styles.css",
    },
  },
} satisfies ElectrobunConfig;
