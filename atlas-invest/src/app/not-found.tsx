import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <div className="text-sm text-muted-foreground">404</div>
        <h1 className="mt-1 text-2xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">O recurso não existe ou não pertence à sua conta.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm underline">Voltar ao dashboard</Link>
      </div>
    </div>
  );
}
