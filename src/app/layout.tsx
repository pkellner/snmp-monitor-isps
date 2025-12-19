import React from "react";

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en" style={{ height: "auto", minHeight: 0 }}>
      <body suppressHydrationWarning style={{ margin: 0, padding: 0, height: "auto", minHeight: 0 }}>{children}</body>
    </html>
  );
}
