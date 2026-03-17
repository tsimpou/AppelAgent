import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent Assist',
  description: 'AI Βοηθός για Τηλεφωνικό Κέντρο',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  )
}
