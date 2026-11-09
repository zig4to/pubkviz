import { networkInterfaces } from "node:os";

// Samo za `npm run dev`: če je oder odprt na localhost, QR koda ne bi
// delovala s telefonom („localhost“ na telefonu je telefon sam). Ta pot vrne
// naslov računalnika v lokalnem omrežju (npr. http://192.168.1.20:3009).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }
  const port = new URL(request.url).port;
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n!.address)
    .filter((a) => !a.startsWith("169.254."));
  // Domača omrežja (192.168.x, 10.x) imajo prednost pred npr. virtualnimi (172.x).
  const ip = ips.find((a) => a.startsWith("192.168.")) ?? ips.find((a) => a.startsWith("10.")) ?? ips[0];
  return Response.json({ origin: ip ? `http://${ip}${port ? `:${port}` : ""}` : null });
}
