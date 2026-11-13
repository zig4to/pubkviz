import Link from "next/link";
import SsoBridge from "@/components/auth/SsoBridge";
import JoinForm from "@/components/play/JoinForm";
import Logo from "@/components/Logo";
import { IconShuffle } from "@/components/ui/icons";

// Javna vstopna stran za igralce: vpis kode sobe → /igra/KODA.
// (SsoBridge: hub Bitneverse odpre koren s fragmentom #sb_at=… → /admin.)
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-cyan-500/15 via-transparent to-violet-600/20 px-4 py-10">
      <SsoBridge />
      <div className="w-full max-w-sm text-center">
        <Logo className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-3xl font-bold tracking-tight">Garaža pub kviz</h1>
        <p className="mb-8 mt-1 text-sm text-gray-500 dark:text-gray-400">
          Vpiši kodo sobe s projektorja.
        </p>
        <JoinForm />
        <Link
          href="/zrebanje"
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-3 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <IconShuffle className="h-5 w-5" />
          Žrebaj skupine
        </Link>
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
