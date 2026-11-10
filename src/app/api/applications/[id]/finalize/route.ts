import { route, type Ctx } from "@/lib/http";
import { finalize } from "@/lib/services";

export const maxDuration = 300;
export const POST = route(async (_: Request, { params }: Ctx<{ id: string }>) => finalize(Number((await params).id)));
