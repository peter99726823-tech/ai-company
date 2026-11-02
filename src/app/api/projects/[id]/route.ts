import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };

import { projectDetail, updateProject } from "@/server/projects/service";
export async function GET(_r: Request, { params }: P) { const d = projectDetail(getDb(), (await params).id); return d ? NextResponse.json(d) : NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }); }
export async function POST(req: Request, { params }: P) { try { return NextResponse.json(updateProject(getDb(), (await params).id, await body(req))); } catch (e) { return fail(e); } }
