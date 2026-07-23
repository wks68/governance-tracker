/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "*.app.github.dev",
        "localhost:3000",
      ],
    },
  },
};

module.exports = nextConfig;
