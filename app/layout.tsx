// app/layout.tsx
import "./globals.css";

export const metadata = { title: "ADL 予後予測" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900">
        {children}
        {/* 免責の常時表示（個人利用版・医療機器ではない） */}
        <div className="fixed bottom-2 right-2 text-[11px] text-slate-600 bg-white/80 backdrop-blur px-2 py-1 rounded border">
          教育目的のシミュレーターです。医療機器ではありません。
        </div>
      </body>
    </html>
  );
}
