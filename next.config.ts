import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // R3F creates a WebGL context in a layout effect. React StrictMode double-invokes
  // effects in dev, mounting/unmounting the context twice and tripping "Context Lost".
  reactStrictMode: false,
  // Standalone output -> small self-contained server bundle for the Docker/Coolify deploy.
  output: "standalone",
};

export default nextConfig;
