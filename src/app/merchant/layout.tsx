import { redirect } from 'next/navigation'
import { getCurrentSession } from '@/backend/auth/session'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import Image from 'next/image'
import Link from 'next/link'

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession()
  if (session?.user.role !== 'MERCHANT' || !session.user.merchant) redirect('/')
  
  return (
    <div className="min-h-screen flex flex-col font-sans transition-colors relative overflow-hidden">
      
      {/* ================= GLOBAL LIGHT MODE BACKDROP ================= */}
      <div 
        className="fixed inset-0 block dark:hidden overflow-hidden bg-white -z-10 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at top right, rgba(255,255,255,0.6) 0%, transparent 60%),
            repeating-linear-gradient(
              112deg,
              #ffffff 0px,
              #f0f5fb 60px,
              #dbe6f5 160px,
              #bed1ed 275px,
              #ffffff 280px
            )
          `
        }}
      ></div>

      {/* ================= GLOBAL DARK MODE BACKDROP ================= */}
      <div 
        className="fixed inset-0 hidden dark:block overflow-hidden bg-black -z-10 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 50%, transparent 10%, #000 95%),
            repeating-linear-gradient(
              112deg,
              #000 0px,
              #01081a 80px,
              #072075 190px,
              #1342cc 275px,
              #000 280px
            )
          `
        }}
      ></div>

      {/* Global Top Navigation for Merchant Portal */}
      <header className="fixed top-0 left-0 right-0 h-16 z-50 px-6 flex items-center justify-between border-b border-gray-200/50 dark:border-gray-800/50 bg-white/50 dark:bg-black/20 backdrop-blur-md">
        <Link href="/merchant/portal" className="relative w-36 h-8 flex items-center">
          <Image src="/logo-light.svg" alt="Razorpay" fill className="object-contain object-left block dark:hidden" />
          <Image src="/logo-dark.png" alt="Razorpay" fill className="object-contain object-left hidden dark:block" />
        </Link>
        <div className="flex items-center gap-4">
           {/* Global Theme Toggle */}
           <ThemeToggle />
           
           <div className="w-8 h-8 rounded-full bg-[#2B64F5]/10 dark:bg-[#2B64F5]/20 flex items-center justify-center text-[#2B64F5] dark:text-blue-400 font-bold text-sm border border-[#2B64F5]/20">
             {session.user.name?.charAt(0) || 'M'}
           </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative z-0">
        {children}
      </main>
    </div>
  )
}
