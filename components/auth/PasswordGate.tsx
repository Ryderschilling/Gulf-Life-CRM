'use client'

// Full-screen gate rendered by the CRM layout when a profile is
// deactivated. The auth ban blocks new sign-ins; this kicks out any
// session still alive.
//
// NOTE (Jul 23): the forced password-change gate that used to live here
// was removed on Ryder's call — logins are simple and permanent:
// username + password work as-is until an ADMIN changes them from
// Settings → Team. (profiles.must_change_password still exists in the
// DB but is unused.)

import { useRouter } from 'next/navigation'
import { LogOut, ShieldOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/kit'

export function DeactivatedScreen() {
  const router = useRouter()
  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: '#f7f5f0' }}>
      <div className="bg-card border border-line rounded-card shadow-pop w-full max-w-[420px] px-7 py-7 text-center">
        <div className="w-11 h-11 rounded-xl bg-bad-soft text-bad flex items-center justify-center mx-auto mb-4">
          <ShieldOff size={20} />
        </div>
        <h1 className="text-[19px] font-bold text-ink m-0 tracking-tight">Account deactivated</h1>
        <p className="text-[13.5px] text-ink-2 mt-1 mb-5">
          Your access to the Gulf Life CRM has been turned off. Talk to John or Ryder if this is a mistake.
        </p>
        <Button variant="secondary" onClick={signOut}><LogOut size={14} /> Sign out</Button>
      </div>
    </div>
  )
}
