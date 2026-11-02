import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional password gate. When APP_PASSWORD is set (required before exposing the app
 * beyond localhost), every page and API needs HTTP Basic auth: any username + that password.
 */
export function proxy(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (safeEqual(given, pw)) return NextResponse.next();
  }
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AI Company", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const config = { matcher: ["/((?!_next/static|_next/image|fonts/|favicon.ico).*)"] };
