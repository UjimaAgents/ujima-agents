import { ChromaClient } from 'chromadb';
import type { Collection, Where } from 'chromadb';
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed';
import type { MemoryEntry } from '@ujima/shared';

export const MEMORY_UNAVAILABLE_MESSAGE = 'memory is not available';

let chromaClient: ChromaClient | null = null;
let embedder: DefaultEmbeddingFunction | null = null;
let chromaCollection: Collection | null = null;

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const COLLECTION_NAME = 'ujima_memories';

async function initChroma(): Promise<Collection> {
  if (chromaCollection) return chromaCollection;

  try {
    if (!chromaClient) {
      chromaClient = new ChromaClient({ path: CHROMA_URL });
      await chromaClient.heartbeat();
    }
    embedder ??= new DefaultEmbeddingFunction();
    chromaCollection = await chromaClient.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: embedder,
    });
    return chromaCollection;
  } catch {
    throw new Error(MEMORY_UNAVAILABLE_MESSAGE);
  }
}

export async function upsertChromaMemory(entry: MemoryEntry): Promise<boolean> {
  const collection = await initChroma();

  try {
    await collection.upsert({
      ids: [entry.id],
      documents: [entry.content],
      metadatas: [
        {
          organizationId: entry.organizationId,
          memberId: entry.memberId ?? '__org__',
          key: entry.key,
          kind: entry.kind,
        },
      ],
    });
    return true;
  } catch (error) {
    if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) throw error;
    console.error('[ujima] Failed to upsert memory in Chroma:', error);
    throw new Error(MEMORY_UNAVAILABLE_MESSAGE);
  }
}

export async function deleteChromaMemoryById(memoryId: string): Promise<boolean> {
  const collection = await initChroma();

  try {
    await collection.delete({ ids: [memoryId] });
    return true;
  } catch (error) {
    if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) throw error;
    console.error(`[ujima] Failed to delete memory ID ${memoryId} from Chroma:`, error);
    throw new Error(MEMORY_UNAVAILABLE_MESSAGE);
  }
}

export async function deleteChromaMemory(
  organizationId: string,
  memberId: string | null,
  key: string
): Promise<boolean> {
  const collection = await initChroma();

  try {
    const filter: Record<string, string> = {
      organizationId,
      key,
      memberId: memberId ?? '__org__',
    };
    await collection.delete({ where: filter });
    return true;
  } catch (error) {
    if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) throw error;
    console.error(`[ujima] Failed to delete memory from Chroma:`, error);
    throw new Error(MEMORY_UNAVAILABLE_MESSAGE);
  }
}

export async function queryChromaMemories(
  organizationId: string,
  memberId: string | undefined,
  query: string,
  limit: number,
  kind?: string
): Promise<string[]> {
  const collection = await initChroma();

  try {
    const whereFilter = buildWhereFilter(organizationId, memberId, kind);
    const results = await collection.query({
      queryTexts: [query],
      nResults: limit,
      where: whereFilter,
    });

    if (results.ids && results.ids[0]) {
      return results.ids[0];
    }
    return [];
  } catch (error) {
    if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) throw error;
    console.error('[ujima] Failed to query Chroma memories:', error);
    throw new Error(MEMORY_UNAVAILABLE_MESSAGE);
  }
}

export async function getChromaMemoriesByMetadata(
  organizationId: string,
  memberId: string | undefined,
  limit: number,
  kind?: string
): Promise<string[]> {
  const collection = await initChroma();

  try {
    const whereFilter = buildWhereFilter(organizationId, memberId, kind);
    const results = await collection.get({
      where: whereFilter,
      limit,
    });
    return results.ids || [];
  } catch (error) {
    if ((error as Error).message === MEMORY_UNAVAILABLE_MESSAGE) throw error;
    console.error('[ujima] Failed to get Chroma memories by metadata:', error);
    throw new Error(MEMORY_UNAVAILABLE_MESSAGE);
  }
}

function buildWhereFilter(organizationId: string, memberId?: string, kind?: string): Where {
  const conditions: Where[] = [{ organizationId: { $eq: organizationId } }];

  if (memberId !== undefined) {
    conditions.push({
      $or: [
        { memberId: { $eq: memberId } },
        { memberId: { $eq: '__org__' } },
      ],
    });
  }

  if (kind !== undefined) {
    conditions.push({ kind: { $eq: kind } });
  }

  const [firstCondition] = conditions;
  if (conditions.length === 1 && firstCondition) {
    return firstCondition;
  }

  return { $and: conditions };
}
