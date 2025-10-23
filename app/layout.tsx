import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '实时转写 + 翻译',
  description: '实时语音转写和翻译工具',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
