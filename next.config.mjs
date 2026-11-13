import bundleAnalyzer from '@next/bundle-analyzer'

// `ANALYZE=true bun run build` opens a report of what is in the JavaScript bundles.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    transpilePackages: ['lucide-react'],
    experimental: {
        // Import only the functions and icons actually used.
        optimizePackageImports: ['lodash', 'lucide-react', '@tiptap/react', '@tiptap/starter-kit'],
    },
};

export default withBundleAnalyzer(nextConfig);
