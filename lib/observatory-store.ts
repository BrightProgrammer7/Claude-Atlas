import { get, put } from "@vercel/blob";
import { EMPTY_STATE, type ObservatoryState } from "@/lib/observatory-types";

const STATE_PATHNAME = "observatory/state.json";

export const isObservatoryStorageConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function readObservatoryState(): Promise<ObservatoryState> {
  if (!isObservatoryStorageConfigured()) return EMPTY_STATE;
  const file = await get(STATE_PATHNAME, { access: "private" });
  if (!file) return EMPTY_STATE;
  const parsed = JSON.parse(await new Response(file.stream).text()) as Partial<ObservatoryState>;
  return { ...EMPTY_STATE, ...parsed };
}

export async function writeObservatoryState(state: ObservatoryState): Promise<void> {
  await put(STATE_PATHNAME, JSON.stringify(state), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
