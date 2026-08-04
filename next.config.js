function normalizeAllowedOrigin(value, variableName) {
  const origin = value?.trim();
  if (!origin) return null;
  if (
    origin.includes("://") ||
    origin.includes("/") ||
    origin.includes("*") ||
    origin.includes("..") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(origin)
  ) {
    throw new Error(`${variableName} 必須是確切 hostname（可含 port），不得包含 protocol、path 或 wildcard`);
  }
  return origin;
}

const previewPort = process.env.NEXT_SERVER_ACTIONS_PREVIEW_PORT?.trim() || "3100";
const explicitPreviewOrigin = normalizeAllowedOrigin(
  process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN,
  "NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN",
);
const codespaceName = normalizeAllowedOrigin(process.env.CODESPACE_NAME, "CODESPACE_NAME");
const forwardingDomain = normalizeAllowedOrigin(
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN,
  "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN",
);
const codespacesPreviewOrigin =
  codespaceName && forwardingDomain
    ? `${codespaceName}-${previewPort}.${forwardingDomain}`
    : null;

// Server Actions 仍維持 Next.js 的 Origin/CSRF 驗證；只允許本機 Preview 與目前這一個
// Codespace 的確切 forwarded hostname。不得使用 *.app.github.dev 或 "*"。
const allowedServerActionOrigins = Array.from(
  new Set(
    [
      "localhost:3100",
      "127.0.0.1:3100",
      codespacesPreviewOrigin,
      explicitPreviewOrigin,
    ].filter(Boolean),
  ),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins,
    },
  },
};

module.exports = nextConfig;
