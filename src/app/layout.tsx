import type { Metadata } from "next";
import { ThemeProvider } from "@/frontend/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Razorpay Clone",
  description: "Payment gateway and dashboard clone",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
