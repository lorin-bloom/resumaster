import { route, type Ctx } from "@/lib/http";
import { researchAndRewrite } from "@/lib/services";

export const maxDuration = 300;
/** Explicit, opt-in company research (web search) + rewrite of the "why this company" answer only. */
export const POST = route(async (_: Request, { params }: Ctx<{ id: string }>) => researchAndRewrite(Number((await params).id)));
