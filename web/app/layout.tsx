import type { Metadata, Viewport } from "next";
import { Sora, Newsreader } from "next/font/google";
import "./globals.css";
import TabBar from "./TabBar";
import Splash from "./Splash";
import DeepLink from "./DeepLink";
import AuthGate from "./AuthGate";
import PullRefresh from "./PullRefresh";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

// Light editorial serif for signature moments (greeting, onboarding headlines).
// Same family used on the LinkedIn infographic — ties the brand together.
const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "CALIBEX",
  description: "Your performance, measured.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CALIBEX" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-icon-180.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#07090f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // resize the layout viewport when the soft keyboard opens so bottom-anchored
  // controls (the Log button) stay above it instead of hiding underneath.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sora.variable} ${serif.variable}`}>
      <body><AuthGate>{children}<TabBar /><DeepLink /><PullRefresh /></AuthGate><Splash /></body>
    </html>
  );
}
