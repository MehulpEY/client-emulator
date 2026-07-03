/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // `pg` is a server-only native-ish dep; keep it external to the server bundle.
    serverComponentsExternalPackages: ["pg"],
    // Enable instrumentation.ts -> starts the event scheduler on server boot.
    instrumentationHook: true,
  },
};

export default nextConfig;
