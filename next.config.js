const nextConfig = {
  devIndicators: false,
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  },
};

module.exports = nextConfig;