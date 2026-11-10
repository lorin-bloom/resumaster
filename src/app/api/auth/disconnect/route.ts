import { route } from "@/lib/http";
import { disconnect } from "@/lib/google/auth";
export const POST = route(async () => disconnect());
