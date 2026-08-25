import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Party Games — real-time multiplayer mini-games",
  description: "Quick, real-time multiplayer mini-games. Pick a game, share a room code, play in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: `
  try {
    var t = localStorage.getItem('party-games:theme');
    if (t && t !== 'dark') document.documentElement.dataset.theme = t;
  } catch(e) {}
` }} />
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
