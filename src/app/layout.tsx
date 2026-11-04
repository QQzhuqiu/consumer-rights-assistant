import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '凭证明白 · AI消费权益助手',
  description:
    '面向普通消费者的消费纠纷事实整理与法规查证助手：整理事实与证据，检索可核验的法规来源，生成有依据的沟通材料草稿。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
        {children}
      </body>
    </html>
  );
}
