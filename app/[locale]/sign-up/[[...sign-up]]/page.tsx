import { SignUp } from '@clerk/nextjs'

export default function Page() {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-black px-4 py-10">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <SignUp />
    </div>
  )
}
