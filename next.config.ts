import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  output: 'export', // Required for Capacitor static export
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
    unoptimized: true, // Required for next/image with static export
  },
};

export default nextConfig;
