import Link from "next/link";
import SsoBridge from "@/components/auth/SsoBridge";
import JoinForm from "@/components/play/JoinForm";
import Logo from "@/components/Logo";

// Javna vstopna stran za igralce: vpis kode sobe → /igra/KODA.
// (SsoBridge: hub TomsStudios odpre koren s fragmentom #sb_at=… → /admin.)
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-cyan-500/15 via-transparent to-violet-600/20 px-4 py-10">
      <SsoBridge />
      <div className="w-full max-w-sm text-center">
        <Logo className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-3xl font-bold tracking-tight">Kviz</h1>
        <p className="mb-8 mt-1 text-sm text-gray-500 dark:text-gray-400">
          Vpiši kodo sobe s projektorja.
        </p>
        <JoinForm />
      </div>
      <Link
        href="/admin"
        className="mt-12 text-sm text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400"
      >
        Voditelj? Uredi in vodi kvize →
      </Link>
    </div>
  );
}
