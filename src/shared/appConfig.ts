export const APP_UI_HOME_URL = "views://mainview/index.html";
export const APP_OAUTH_CALLBACK_HASH = "#/sso-callback";
export const APP_OAUTH_CALLBACK_HOST = "localhost";
export const APP_OAUTH_CALLBACK_PORT = 53918;
export const APP_OAUTH_CALLBACK_PATH = "/callback";
export const APP_OAUTH_CALLBACK_ORIGIN = `http://${APP_OAUTH_CALLBACK_HOST}:${APP_OAUTH_CALLBACK_PORT}`;
export const APP_OAUTH_CALLBACK_URL = `${APP_OAUTH_CALLBACK_ORIGIN}${APP_OAUTH_CALLBACK_PATH}`;
export const APP_OAUTH_ISSUER = (
  process.env.CLERK_OAUTH_ISSUER ?? "https://clerk.strinova.gg"
).replace(/\/$/, "");
export const APP_OAUTH_CLIENT_ID =
  process.env.CLERK_OAUTH_CLIENT_ID ?? "9YfNu3Z7Vm9PvZ6G";
export const APP_OAUTH_DISCOVERY_URL = `${APP_OAUTH_ISSUER}/.well-known/openid-configuration`;
export const APP_OAUTH_AUTHORIZE_URL = `${APP_OAUTH_ISSUER}/oauth/authorize`;
export const APP_OAUTH_TOKEN_URL = `${APP_OAUTH_ISSUER}/oauth/token`;
export const APP_OAUTH_USERINFO_URL = `${APP_OAUTH_ISSUER}/oauth/userinfo`;
export const APP_OAUTH_TOKEN_INFO_URL = `${APP_OAUTH_ISSUER}/oauth/token_info`;
export const APP_OAUTH_SCOPES = "profile email";

function withPrefix(value: string, prefix: "?" | "#"): string {
  if (!value) return "";
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

export function buildAppUiUrl({
  search = "",
  hash = "",
}: {
  search?: string;
  hash?: string;
} = {}): string {
  return `${APP_UI_HOME_URL}${withPrefix(search, "?")}${withPrefix(hash, "#")}`;
}

export function buildInternalAuthCallbackUrl(search = ""): string {
  const normalizedSearch = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";

  return buildAppUiUrl({
    hash: `${APP_OAUTH_CALLBACK_HASH}${normalizedSearch}`,
  });
}
